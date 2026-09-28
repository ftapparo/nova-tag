import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getTagValidatorInstance } from '../../core/antenna-manager';
import { successResponseSchema } from '../lib/response';
import { cacheTypeQuerySchema, listCacheDataSchema } from '../lib/tag-schemas';

const normalizeCacheType = (type: string): 'positive' | 'negative' | 'all' => {
    if (type === 'positive' || type === 'whitelist') return 'positive';
    if (type === 'negative' || type === 'blacklist') return 'negative';
    return 'all';
};

/**
 * Rota de leitura do cache de TAGs na v3 — só consulta, sem alterar
 * estado. Reaproveita o mesmo TagValidator singleton que a v2 usa.
 * Retorna dados de identificação de moradores (NOME, QUADRA, LOTE via
 * verifyData) — protegida por token de serviço.
 */
export async function cacheRoutes(app: FastifyInstance) {
    const typedApp = app.withTypeProvider<ZodTypeProvider>();

    typedApp.get('/cache', {
        schema: {
            querystring: z.object({ type: cacheTypeQuerySchema.optional() }),
            response: { 200: successResponseSchema(listCacheDataSchema) },
        },
    }, async (request, reply) => {
        const cacheType = normalizeCacheType(request.query.type ?? 'all');

        const tagValidator = getTagValidatorInstance();
        if (!tagValidator) {
            return reply.fail({
                type: 'upstream-error',
                title: 'TagValidator indisponível.',
                status: 503,
            });
        }

        const items = tagValidator.listCache(cacheType);
        const stats = tagValidator.getCacheStats();

        reply.ok({ type: cacheType, items, stats });
    });
}

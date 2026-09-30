import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getTagValidatorInstance } from '../../core/antenna-manager';
import { successResponseSchema } from '../shared/response';
import logger from '../../core/utils/logger';
import {
    cacheTypeQuerySchema,
    clearCacheResultSchema,
    listCacheDataSchema,
    removeCacheItemResultSchema,
} from '../shared/tag.schema';

const normalizeCacheType = (type: string): 'positive' | 'negative' | 'all' => {
    if (type === 'positive' || type === 'whitelist') return 'positive';
    if (type === 'negative' || type === 'blacklist') return 'negative';
    return 'all';
};

// Limpar o cache força revalidação na API central; limpar a lista negativa
// pode liberar uma TAG que deveria estar barrada até a próxima consulta
// (TAG-C-03). Operação rara: registra sempre quem fez.
const logCacheChange = (request: FastifyRequest, what: string) => {
    const actorId = request.headers['x-actor-id'] ?? 'desconhecido';
    const actorRole = request.headers['x-actor-role'] || 'sem papel';
    logger.warn(`[ApiV3] Cache alterado (${what}) por ${actorId} (${actorRole})`);
};

/**
 * Rotas do cache de TAGs na v3: leitura e limpeza. Reaproveita o mesmo TagValidator singleton que a v2 usa.
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

    typedApp.delete('/cache', {
        schema: {
            querystring: z.object({ type: cacheTypeQuerySchema.optional() }),
            response: { 200: successResponseSchema(clearCacheResultSchema) },
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

        tagValidator.clearCache(cacheType);
        logCacheChange(request, `limpeza ${cacheType}`);
        reply.ok({ type: cacheType, stats: tagValidator.getCacheStats() });
    });

    typedApp.delete('/cache/:tag', {
        schema: {
            params: z.object({ tag: z.string().trim().min(1).max(32) }),
            response: { 200: successResponseSchema(removeCacheItemResultSchema) },
        },
    }, async (request, reply) => {
        const { tag } = request.params;

        const tagValidator = getTagValidatorInstance();
        if (!tagValidator) {
            return reply.fail({
                type: 'upstream-error',
                title: 'TagValidator indisponível.',
                status: 503,
            });
        }

        if (!tagValidator.invalidateTag(tag)) {
            return reply.fail({ type: 'not-found', detail: 'TAG não encontrada no cache.', instance: request.url });
        }

        logCacheChange(request, `remoção da TAG ${tag}`);
        reply.ok({ tag });
    });
}

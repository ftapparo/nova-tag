import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isHealthcheckAwaitingResponse } from '../../core/antenna-manager';
import { successResponseSchema } from '../lib/response';

// Reaproveita o mesmo estado que a v2 usa (isHealthcheckAwaitingResponse,
// de core/antenna-manager) — health da v3 reflete o estado real da antena,
// não um valor fixo.
const healthDataSchema = z.object({
    status: z.literal('API Funcionando!'),
    environment: z.string(),
    antennaStatus: z.enum(['OK', 'HEALTHCHECK_PENDING']),
    antennaHealthcheckPending: z.boolean(),
});

export async function healthRoutes(app: FastifyInstance) {
    const typedApp = app.withTypeProvider<ZodTypeProvider>();

    const schema = {
        response: {
            200: successResponseSchema(healthDataSchema),
        },
    };

    const respondHealth = (reply: import('fastify').FastifyReply) => {
        const antennaHealthcheckPending = isHealthcheckAwaitingResponse();
        const antennaStatus = antennaHealthcheckPending ? 'HEALTHCHECK_PENDING' as const : 'OK' as const;

        reply.ok(
            {
                status: 'API Funcionando!' as const,
                environment: process.env.NODE_ENV || 'development',
                antennaStatus,
                antennaHealthcheckPending,
            },
            { status: antennaHealthcheckPending ? 503 : 200 },
        );
    };

    // Mesmo par de rotas da v2 (/health e /healthcheck apontando pro mesmo
    // handler), mantido por compatibilidade de convenção entre as versões.
    typedApp.get('/health', { schema }, async (_request, reply) => {
        respondHealth(reply);
    });

    typedApp.get('/healthcheck', { schema }, async (_request, reply) => {
        respondHealth(reply);
    });
}

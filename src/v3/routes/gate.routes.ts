import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AntennaManager } from '../../core/antenna-manager';
import { successResponseSchema } from '../lib/response';
import { gateStateSchema } from '../lib/tag-schemas';

/**
 * Rota de leitura do estado do portão na v3. Reaproveita o getter
 * getGateState da mesma instância de AntennaManager usada pela v2, sem
 * duplicar lógica de negócio.
 */
export async function gateRoutes(app: FastifyInstance, antennaInstance: AntennaManager) {
    const typedApp = app.withTypeProvider<ZodTypeProvider>();

    typedApp.get('/gate/state', {
        schema: { response: { 200: successResponseSchema(gateStateSchema) } },
    }, async (_request, reply) => {
        const state = antennaInstance.getGateState ? antennaInstance.getGateState : 'unknown';
        reply.ok({ state: state as 'closed' | 'opening' | 'open' | 'closing' | 'unknown' });
    });
}

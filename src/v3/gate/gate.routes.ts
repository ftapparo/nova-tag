import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AntennaManager } from '../../core/antenna-manager';
import { successResponseSchema } from '../shared/response';
import { gateStateSchema } from '../shared/tag.schema';

/**
 * Rota de leitura do estado do portão na v3. Lê o estado do GateController
 * (getControllerGateState) na mesma instância de AntennaManager da v2 —
 * o getter getGateState, que a v2 usa, só enxerga CLOSED.
 */
export async function gateRoutes(app: FastifyInstance, antennaInstance: AntennaManager) {
    const typedApp = app.withTypeProvider<ZodTypeProvider>();

    typedApp.get('/gate/state', {
        schema: { response: { 200: successResponseSchema(gateStateSchema) } },
    }, async (_request, reply) => {
        reply.ok(antennaInstance.getControllerGateState());
    });
}

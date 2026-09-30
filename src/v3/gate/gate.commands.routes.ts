import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AntennaManager } from '../../core/antenna-manager';
import logger from '../../core/utils/logger';
import { successResponseSchema } from '../shared/response';
import {
    confirmBodySchema,
    gateCommandResultSchema,
    openGateBodySchema,
    resolveAutoCloseDefaultSeconds,
    resolveAutoCloseMaxSeconds,
    restartResultSchema,
} from '../shared/tag.schema';

const resolveCooldownMs = (): number => {
    const value = Number(process.env.GATE_COOLDOWN_MS || '3000');
    return Number.isFinite(value) && value >= 0 ? value : 3000;
};

// Quem acionou: a nova-api repassa o ator do token em x-actor-id/role.
// Registro operacional — a auditoria imutável é item à parte (CHECKLIST 3.2).
const logCommand = (request: FastifyRequest, action: string, extra = '') => {
    const actorId = request.headers['x-actor-id'] ?? 'desconhecido';
    const actorRole = request.headers['x-actor-role'] || 'sem papel';
    logger.info(`[ApiV3] Comando ${action}${extra} solicitado por ${actorId} (${actorRole})`);
};

/**
 * Comandos do portão na v3 — acionam o motor físico. Mesmos métodos de
 * AntennaManager que a v2 usa (src/v2/controllers/gate.controller.ts).
 * Autorização por usuário/papel é decidida na nova-api; aqui só entra
 * quem tem o token de serviço.
 */
export async function gateCommandRoutes(app: FastifyInstance, antennaInstance: AntennaManager) {
    const typedApp = app.withTypeProvider<ZodTypeProvider>();

    // Cooldown local entre acionamentos (TAG-A-02): protege o motor mesmo
    // que o limite por conta da nova-api falhe ou seja contornado. Por
    // processo = por portão, já que cada TAG roda no seu container.
    let lastCommandAt = 0;
    const checkCooldown = (request: FastifyRequest, reply: FastifyReply): boolean => {
        const elapsed = Date.now() - lastCommandAt;
        const cooldownMs = resolveCooldownMs();
        if (elapsed < cooldownMs) {
            reply.header('Retry-After', String(Math.ceil((cooldownMs - elapsed) / 1000)));
            reply.fail({
                type: 'rate-limited',
                detail: 'Portão acionado recentemente. Aguarde.',
                instance: request.url,
            });
            return false;
        }
        lastCommandAt = Date.now();
        return true;
    };

    typedApp.post('/gate/open', {
        schema: {
            body: openGateBodySchema,
            response: { 200: successResponseSchema(gateCommandResultSchema) },
        },
    }, async (request, reply) => {
        const body = request.body ?? {};
        const maxSeconds = resolveAutoCloseMaxSeconds();
        if (body.autoCloseTime !== undefined && body.autoCloseTime > maxSeconds) {
            return reply.fail({
                type: 'validation-error',
                detail: 'Tempo de fechamento automático acima do permitido.',
                instance: request.url,
                validationErrors: [{ path: '/autoCloseTime', message: `Máximo de ${maxSeconds} segundos.` }],
            });
        }

        if (!checkCooldown(request, reply)) return;

        const keepOpen = body.keepOpen === true;
        const autoCloseSeconds = keepOpen ? null : (body.autoCloseTime ?? resolveAutoCloseDefaultSeconds());
        logCommand(request, 'open', keepOpen ? ' (manter aberto)' : ` (${autoCloseSeconds}s)`);

        const sent = await antennaInstance.openGate(
            autoCloseSeconds !== null ? autoCloseSeconds * 1000 : undefined,
            { keepOpen },
        );
        if (!sent) {
            // openGate só recusa com o portão em transição ou sem conexão.
            return reply.fail({
                type: 'conflict',
                title: 'Portão não aceitou o comando.',
                detail: 'Portão em movimento ou antena desconectada.',
                instance: request.url,
            });
        }

        reply.ok({ action: 'open', autoCloseSeconds, gate: antennaInstance.getControllerGateState() });
    });

    typedApp.post('/gate/close', {
        schema: { response: { 200: successResponseSchema(gateCommandResultSchema) } },
    }, async (request, reply) => {
        if (!checkCooldown(request, reply)) return;
        logCommand(request, 'close');

        const sent = await antennaInstance.closeGate();
        if (!sent) {
            return reply.fail({
                type: 'conflict',
                title: 'Portão não aceitou o comando.',
                detail: 'Portão não está aberto ou antena desconectada.',
                instance: request.url,
            });
        }

        reply.ok({ action: 'close', autoCloseSeconds: null, gate: antennaInstance.getControllerGateState() });
    });

    // Encerra o processo para o Docker reiniciar o container — mesma
    // sequência da v2. Exige confirm para que clique acidental ou retry
    // não derrube o portão.
    typedApp.post('/gate/restart', {
        schema: {
            body: confirmBodySchema,
            response: { 200: successResponseSchema(restartResultSchema) },
        },
    }, async (request, reply) => {
        if (request.body?.confirm !== true) {
            return reply.fail({
                type: 'validation-error',
                detail: 'Este comando exige confirmação explícita.',
                instance: request.url,
                validationErrors: [{ path: '/confirm', message: 'Envie confirm: true.' }],
            });
        }

        if (antennaInstance.isShuttingDown()) {
            return reply.fail({ type: 'conflict', detail: 'Aplicação já está em encerramento.', instance: request.url });
        }

        logCommand(request, 'restart');
        const shutdownDelayMs = Number(process.env.SHUTDOWN_DELAY_MS) || 2000;

        // Responde antes de encerrar; o exit fica agendado.
        reply.ok({ message: 'Reinício solicitado. Encerrando aplicação.', shutdownDelayMs });

        antennaInstance.shutdown();
        setTimeout(() => process.exit(1), shutdownDelayMs);
    });
}

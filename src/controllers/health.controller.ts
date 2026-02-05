import { Request, Response } from 'express';
import { AntennaManager } from '../core/antenna-manager';

/**
 * Realiza o health check da API.
 * @route GET /api/health
 * @param _req Express Request
 * @param res Express Response
 * @param antennaInstance Instância da AntennaManager correspondente
 */
export const healthCheck = async (_req: Request, res: Response, antennaInstance: AntennaManager): Promise<void> => {
    const env = process.env.NODE_ENV || 'UNKNOWN';
    const nowMs = Date.now();
    const maxSilenceMs = Number(process.env.ANTENNA_HEALTH_SILENCE_MS) || 15000;
    const failAfterMs = Number(process.env.ANTENNA_HEALTH_FAIL_AFTER_MS) || 60000;
    const restartCooldownMs = Number(process.env.ANTENNA_HEALTH_RESTART_COOLDOWN_MS) || 15000;

    const snapshot = antennaInstance.getHealthSnapshot(nowMs, maxSilenceMs, failAfterMs);

    if (snapshot.status !== 'healthy') {
        await antennaInstance.restartConnectionIfNeeded(nowMs, restartCooldownMs);
    }

    if (snapshot.shouldFail) {
        res.fail('Antena indisponível.', 503, {
            status: snapshot.status,
            lastActivityAt: snapshot.lastActivityAt,
            unhealthySince: snapshot.unhealthySince,
        });
        return;
    }

    res.ok({
        status: 'API Funcionando!',
        environment: env,
        antenna: {
            status: snapshot.status,
            lastActivityAt: snapshot.lastActivityAt,
            unhealthySince: snapshot.unhealthySince,
        },
    });
};
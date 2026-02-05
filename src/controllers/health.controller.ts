import { Request, Response } from 'express';
import { isHealthcheckAwaitingResponse } from '../core/antenna-manager';

/**
 * Realiza o health check da API.
 * @route GET /api/health
 * @param _req Express Request
 * @param res Express Response
 */
export const healthCheck = (_req: Request, res: Response) => {
    const env = process.env.NODE_ENV || 'UNKNOWN';
    const antennaHealthcheckPending = isHealthcheckAwaitingResponse();
    const antennaStatus = antennaHealthcheckPending ? 'HEALTHCHECK_PENDING' : 'OK';

    if (antennaHealthcheckPending) {
        return res.fail(
            'Antena sem resposta no healthcheck.',
            503,
            {
                status: 'API Funcionando!',
                environment: env,
                antennaStatus,
                antennaHealthcheckPending,
            }
        );
    }

    return res.ok({
        status: 'API Funcionando!',
        environment: env,
        antennaStatus,
        antennaHealthcheckPending,
    });
};
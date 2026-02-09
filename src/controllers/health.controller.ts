import { Request, Response } from 'express';
import { isHealthcheckAwaitingResponse } from '../core/antenna-manager';
import { AntennaManager } from '../core/antenna-manager';

/**
 * Realiza o health check da API.
 * @route GET /v2/api/health
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

/**
 * Reinicia a conexão com a antena.
 * @param req Express Request
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna mensagem de sucesso ou erro
 */
export const restartAntennaConnection = async (_req: Request, res: Response, antennaInstance: AntennaManager): Promise<void> => {
    try {
        if (antennaInstance.isShuttingDown()) {
            res.fail('Aplicação já está em encerramento.', 409);
            return;
        }

        const shutdownDelayMs = Number(process.env.SHUTDOWN_DELAY_MS) || 2000;

        res.ok({ message: 'Reinício forçado solicitado. Encerrando aplicação.' });
        console.log(`[GateController] Encerramento agendado em ${shutdownDelayMs}ms.`);

        antennaInstance.shutdown();

        setTimeout(() => {
            process.exit(1);
        }, shutdownDelayMs);
    } catch (error) {
        console.error('[GateController] Erro ao finalizar aplicação para reinício forçado:', error);
        res.fail('Erro inesperado ao finalizar aplicação para reinício forçado.', 500, error instanceof Error ? error.message : error);
    }
};

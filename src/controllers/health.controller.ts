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
export const restartAntennaConnection = async (req: Request, res: Response, antennaInstance: AntennaManager): Promise<void> => {
    try {
        if (!antennaInstance.restartConnection) {
            res.fail('Falha de implementação do método restartConnection.', 500);
            return;
        }

        const rawForceRestart = req.body?.forceRestart ?? req.query?.forceRestart;
        const forceRestart = parseBoolean(rawForceRestart);

        if (forceRestart) {
            res.ok({ message: 'Reinício forçado solicitado. Encerrando aplicação.' });
            setTimeout(() => {
                console.log('[GateController] Encerrando aplicação para reinício forçado.');
                process.exit(1);
            }, 100);
            return;
        }

        const result = await antennaInstance.restartConnection();

        if (result === true) {
            res.ok({ message: 'Conexão com a antena reiniciada com sucesso.' });
        } else {
            res.fail('Falha ao reiniciar conexão com a antena.', 500);
        }
    } catch (error) {
        console.error('[GateController] Erro ao reiniciar conexão com a antena:', error);
        res.fail('Erro inesperado ao reiniciar a conexão com a antena.', 500, error instanceof Error ? error.message : error);
    }
};

/**
 * Converte um valor arbitrário para booleano.
 * @param value Valor recebido via query ou body.
 * @returns `true` quando o valor indica ativação explícita.
 */
const parseBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
    }

    return false;
};

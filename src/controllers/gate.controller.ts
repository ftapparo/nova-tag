import { Request, Response } from 'express';
import { AntennaManager } from '../core/antenna-manager';

/**
 * Obtém o estado atual do portão.
 * @param req Request do Express
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna o estado atual do portão
*/
export const getGateState = (req: Request, res: Response, antennaInstance: AntennaManager): void => {
    const state = antennaInstance.getGateState ? antennaInstance.getGateState : 'UNKNOWN';
    res.ok({ state });
};

/**
 * Abre o portão.
 * @param req Request do Express
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna mensagem de sucesso ou erro
 */
export const openGate = async (req: Request, res: Response, antennaInstance: AntennaManager): Promise<void> => {
    try {
        if (!antennaInstance.openGate) {
            res.fail('Falha de implementação do método openGate.', 500);
            return;
        }

        const autoCloseTime = req.params.autoCloseTime
            ? parseInt(Array.isArray(req.params.autoCloseTime) ? req.params.autoCloseTime[0] : req.params.autoCloseTime, 10)
            : undefined;

        if (autoCloseTime !== undefined && Number.isNaN(autoCloseTime)) {
            res.fail('Parâmetro autoCloseTime inválido. Informe um número inteiro.', 400);
            return;
        }

        const autoCloseTimeMs = autoCloseTime !== undefined ? autoCloseTime * 1000 : undefined;
        const result = await antennaInstance.openGate(autoCloseTimeMs);

        if (result === true) {
            res.ok({ message: 'Comando de abertura enviado com sucesso.' });
        } else {
            res.fail('Falha ao enviar comando para abrir o portão.', 500);
        }
    } catch (error) {
        console.error('[GateController] Erro ao abrir portão:', error);
        res.fail('Erro inesperado ao abrir o portão.', 500, error instanceof Error ? error.message : error);
    }
};

/**
 * Fecha o portão.
 * @param req Request do Express
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna mensagem de sucesso ou erro
 */
export const closeGate = async (req: Request, res: Response, antennaInstance: AntennaManager): Promise<void> => {
    try {
        if (!antennaInstance.closeGate) {
            res.fail('Falha de implementação do método closeGate.', 500);
            return;
        }

        const result = await antennaInstance.closeGate();

        if (result === true) {
            res.ok({ message: 'Comando de fechamento enviado com sucesso.' });
        } else {
            res.fail('Falha ao enviar comando para fechar o portão.', 500);
        }
    } catch (error) {
        console.error('[GateController] Erro ao fechar portão:', error);
        res.fail('Erro inesperado ao fechar o portão.', 500, error instanceof Error ? error.message : error);
    }
};

/**
 * Reinicia a conexão com a antena.
 * @param req 
 * @param res 
 */
export const restartAntennaConnection = (req: Request, res: Response, antennaInstance: AntennaManager): void => {
    res.ok({ message: 'Conexão com a antena reiniciada com sucesso.' });
};

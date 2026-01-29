import { Request, Response } from 'express';
import { AntennaManager } from '../core/antenna-manager';

/**
 * Obtém o estado atual do portão.
 * @param req Request do Express
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna o estado atual do portão
*/
export const getGateState = (req: Request, res: Response, antennaInstance: AntennaManager) => {
    const state = antennaInstance.getGateState ? antennaInstance.getGateState : 'UNKNOWN';
    res.status(200).json({ state });
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
            res.status(500).json({ message: 'Falha de implementação do método openGate.' });
            return;
        }

        const autoCloseTime = req.params.autoCloseTime
            ? parseInt(Array.isArray(req.params.autoCloseTime) ? req.params.autoCloseTime[0] : req.params.autoCloseTime, 10)
            : undefined;

        const result = await antennaInstance.openGate(autoCloseTime);

        if (result === true) {
            res.status(200).json({ message: 'Comando de abertura enviado com sucesso.' });
        } else {
            res.status(500).json({ message: 'Falha ao enviar comando para abrir o portão.' });
        }
    } catch (error) {
        console.error('[GateController] Erro ao abrir portão:', error);
        res.status(500).json({ message: 'Erro inesperado ao abrir o portão.', error: error instanceof Error ? error.message : error });
    }
};

/**
 * Fecha o portão.
 * @param req Request do Express
 * @param res Response do Express
 * @param antennaInstance Instância da AntennaManager correspondente
 * @returns Retorna mensagem de sucesso ou erro
 */
export const closeGate = async (req: Request, res: Response, antennaInstance: AntennaManager) => {
    try {
        if (!antennaInstance.closeGate) {
            res.status(500).json({ message: 'Falha de implementação do método closeGate.' });
            return;
        }

        const result = await antennaInstance.closeGate();

        if (result === true) {
            res.status(200).json({ message: 'Comando de fechamento enviado com sucesso.' });
        } else {
            res.status(500).json({ message: 'Falha ao enviar comando para fechar o portão.' });
        }
    } catch (error) {
        console.error('[GateController] Erro ao fechar portão:', error);
        res.status(500).json({ message: 'Erro inesperado ao fechar o portão.', error: error instanceof Error ? error.message : error });
    }
};

/**
 * Reinicia a conexão com a antena.
 * @param req 
 * @param res 
 */
export const restartAntennaConnection = (req: Request, res: Response, antennaInstance: AntennaManager) => {
    res.status(200).json({ message: 'Conexão com a antena reiniciada com sucesso.' });
};

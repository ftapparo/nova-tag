import express from 'express';
import { getGateState, openGate, closeGate, restartAntennaConnection } from '../controllers/gate.controller';
import { AntennaManager } from '../core/antenna-manager';

export default (antennaInstance: AntennaManager) => {

    const router = express.Router();

    // Injetando a instância da antena no controlador de portão
    const gateControl = {
        getGateState: (req: express.Request, res: express.Response) => getGateState(req, res, antennaInstance),
        openGate: (req: express.Request, res: express.Response) => openGate(req, res, antennaInstance),
        closeGate: (req: express.Request, res: express.Response) => closeGate(req, res, antennaInstance),
        restartAntennaConnection: (req: express.Request, res: express.Response) => restartAntennaConnection(req, res, antennaInstance),
    };

    // Rota para obter o estado atual do portão
    router.get('/gate/state', gateControl.getGateState);

    // Rota para abrir o portão
    router.post('/gate/open', gateControl.openGate);

    // Rota para abrir o portão com tempo para fechamento automático
    router.post('/gate/open/:autoCloseTime', gateControl.openGate);

    // Rota para fechar o portão
    router.post('/gate/close', gateControl.closeGate);

    // Rota para reiniciar a conexão com a antena
    router.post('/gate/restart', gateControl.restartAntennaConnection);

    return router;
};

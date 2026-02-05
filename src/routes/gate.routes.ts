import express from 'express';
import { getGateState, openGate, closeGate } from '../controllers/gate.controller';
import { AntennaManager } from '../core/antenna-manager';

export default (antennaInstance: AntennaManager) => {

    const router = express.Router();

    // Rota para obter o estado atual do portão
    router.get('/gate/state', (req: express.Request, res: express.Response) => getGateState(req, res, antennaInstance));

    // Rota para abrir o portão (autoCloseTime opcional via body)
    router.post('/gate/open', (req: express.Request, res: express.Response) => openGate(req, res, antennaInstance));

    // Rota para fechar o portão
    router.post('/gate/close', (req: express.Request, res: express.Response) => closeGate(req, res, antennaInstance));


    return router;
};

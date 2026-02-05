import express from 'express';
import { healthCheck, restartAntennaConnection } from '../controllers/health.controller';
import { AntennaManager } from '../core/antenna-manager';

export default (antennaInstance: AntennaManager) => {

    const router = express.Router();

    // Rota de health check
    router.get('/health', healthCheck);

    // Rota de health check alternativa
    router.get('/healthcheck', healthCheck);

    // Rota para reiniciar a conexão com a antena
    router.post('/gate/restart', (req: express.Request, res: express.Response) => restartAntennaConnection(req, res, antennaInstance));

    return router;
};
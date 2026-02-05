import express from 'express';
import { healthCheck } from '../controllers/health.controller';
import { AntennaManager } from '../core/antenna-manager';

export default (antennaInstance: AntennaManager) => {
    const router = express.Router();

    const healthControl = {
        healthCheck: (req: express.Request, res: express.Response) => healthCheck(req, res, antennaInstance),
    };

    // Rota de health check
    router.get('/health', healthControl.healthCheck);

    // Rota de health check alternativa
    router.get('/healthcheck', healthControl.healthCheck);

    return router;
};

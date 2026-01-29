import express from 'express';
import { healthCheck } from '../controllers/health.controller';

const router = express.Router();

// Rota de health check
router.get('/health', healthCheck);

// Rota de health check alternativa
router.get('/healthcheck', healthCheck);

export default router;

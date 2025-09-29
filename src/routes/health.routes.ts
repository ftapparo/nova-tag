/**
 * @file health.routes.ts
 * @description Define as rotas relacionadas ao healthcheck da aplicação.
 * @date 2025-09-22
 */

import express from 'express';
import { healthCheck } from '../controllers/health.controller';

const router = express.Router();

router.get('/healthcheck', healthCheck);

export default router;

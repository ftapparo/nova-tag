import express from 'express';
import { healthCheck } from '../controllers/health.controller';

const router = express.Router();

router.get('/healthcheck', healthCheck);

export default router;

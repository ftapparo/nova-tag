import { Request, Response } from 'express';

/**
 * Realiza o health check da API.
 * @route GET /api/health
 * @param _req Express Request
 * @param res Express Response
 */
export const healthCheck = (_req: Request, res: Response) => {
    const env = process.env.NODE_ENV || 'UNKNOWN';
    res.ok({ status: 'API Funcionando!', environment: env });
};
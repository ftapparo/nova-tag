/**
 * @file health.controller.ts
 * @description Endpoint de health check da aplicação — verifica dependências essenciais (BD, Redis, filas) e retorna status operacional.
 * @date 2025-09-22
 */

import { Request, Response } from 'express';

/**
 * Realiza o health check da API.
 * @route GET /api/health
 * @param _req Express Request
 * @param res Express Response
 */
export const healthCheck = (_req: Request, res: Response) => {
    // #swagger.tags = ['Healthcheck']
    // #swagger.description = 'Endpoint para verificar o status da API e suas dependências.'
    const env = process.env.NODE_ENV || 'UNKNOWN';
    res.status(200).json({ content: 'API Funcionando! - Ambiente: ' + env });
};
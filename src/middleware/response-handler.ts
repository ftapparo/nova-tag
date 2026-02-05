import { NextFunction, Request, Response } from 'express';

export type ApiResponse<T> = {
    data: T | null;
    message: string | null;
    errors: unknown | null;
};

/**
 * Middleware que adiciona helpers de resposta padronizada ao `res`.
 * @param _req Requisição HTTP.
 * @param res Resposta HTTP.
 * @param next Função para seguir para o próximo middleware.
 */
export const responseHandler = (_req: Request, res: Response, next: NextFunction) => {
    res.ok = <T>(data: T, status = 200) =>
        res.status(status).json({
            data,
            message: null,
            errors: null,
        } satisfies ApiResponse<T>);

    res.fail = (message: string, status = 500, errors: unknown = null) =>
        res.status(status).json({
            data: null,
            message,
            errors,
        } satisfies ApiResponse<null>);

    next();
};

import { NextFunction, Request, Response } from 'express';

export type ApiResponse<T> = {
    data: T | null;
    message: string | null;
    errors: unknown | null;
};

const normalizeErrors = (requestId: string | undefined, errors: unknown): unknown => {
    const traceId = requestId || null;

    if (errors === null || errors === undefined) {
        return { traceId };
    }

    if (typeof errors === 'string') {
        return { traceId, details: errors };
    }

    if (typeof errors === 'object') {
        const errorObject = errors as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(errorObject, 'traceId')) {
            return errorObject;
        }
        return { traceId, ...errorObject };
    }

    return { traceId, details: errors };
};

/**
 * Middleware que adiciona helpers de resposta padronizada ao `res`.
 * @param _req Requisição HTTP.
 * @param res Resposta HTTP.
 * @param next Função para seguir para o próximo middleware.
 */
export const responseHandler = (req: Request, res: Response, next: NextFunction) => {
    if (req.requestId) {
        res.setHeader('x-request-id', req.requestId);
    }
    if (req.actor) {
        res.setHeader('x-actor', req.actor);
    }

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
            errors: normalizeErrors(req.requestId, errors),
        } satisfies ApiResponse<null>);

    next();
};

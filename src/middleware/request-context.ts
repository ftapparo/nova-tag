import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const resolveActor = (req: Request): string => {
    const headerActor = req.header('x-user')
        || req.header('x-operator')
        || req.header('x-username');

    if (headerActor && headerActor.trim()) {
        return headerActor.trim();
    }

    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : null;
    const bodyActor = body?.user || body?.usuario || body?.operator;
    if (typeof bodyActor === 'string' && bodyActor.trim()) {
        return bodyActor.trim();
    }

    return 'desconhecido';
};

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const incomingRequestId = req.header('x-request-id');
    const requestId = (incomingRequestId && incomingRequestId.trim()) ? incomingRequestId.trim() : randomUUID();
    const actor = resolveActor(req);

    req.requestId = requestId;
    req.actor = actor;

    res.setHeader('x-request-id', requestId);
    res.setHeader('x-actor', actor);

    next();
};

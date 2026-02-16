import 'express-serve-static-core';

declare module 'express-serve-static-core' {
    interface Request {
        requestId?: string;
        actor?: string;
    }

    interface Response {
        ok: <T>(data: T, status?: number) => this;
        fail: (message: string, status?: number, errors?: unknown) => this;
    }
}

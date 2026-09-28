import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import {
    API_VERSION,
    buildProblemDetails,
    type BuildProblemInput,
    type ErrorResponse,
    type PaginationMeta,
    type SuccessResponse,
} from './response';

declare module 'fastify' {
    interface FastifyReply {
        /** Responde com o envelope de sucesso padrão da v3. */
        ok<T>(data: T, opts?: { status?: number; pagination?: PaginationMeta }): FastifyReply;
        /** Responde com o envelope de erro padrão da v3 (RFC 7807 adaptado). */
        fail(input: BuildProblemInput): FastifyReply;
    }
}

const buildMeta = (req: FastifyRequest, pagination?: PaginationMeta) => ({
    timestamp: new Date().toISOString(),
    requestId: (req.headers['x-request-id'] as string | undefined) ?? req.id ?? null,
    version: API_VERSION,
    ...(pagination ? { pagination } : {}),
});

/**
 * Plugin Fastify que adiciona `reply.ok()`/`reply.fail()` — o mecanismo de
 * resposta da v3. Registrar uma vez no bootstrap (v3/server.ts); toda rota
 * passa a ter os dois métodos disponíveis em `reply`.
 */
export const responseHelpersPlugin = fp(async (app: FastifyInstance) => {
    app.decorateReply('ok', function (this: FastifyReply, data: unknown, opts?: { status?: number; pagination?: PaginationMeta }) {
        const body: SuccessResponse<unknown> = {
            success: true,
            data,
            meta: buildMeta(this.request, opts?.pagination),
        };
        return this.status(opts?.status ?? 200).send(body);
    });

    app.decorateReply('fail', function (this: FastifyReply, input: BuildProblemInput) {
        const problem = buildProblemDetails(input);
        const body: ErrorResponse = {
            success: false,
            error: problem,
            meta: buildMeta(this.request),
        };
        return this.status(problem.status).send(body);
    });
});

/**
 * Error handler global: qualquer exceção não tratada (throw dentro de um
 * handler, erro de validação Zod, 404 de rota) cai aqui e sai no mesmo
 * envelope de erro — nenhuma rota deveria formatar erro manualmente fora
 * de `reply.fail()`.
 */
export function registerErrorHandler(app: FastifyInstance) {
    app.setErrorHandler((error: FastifyError, request, reply) => {
        if (hasZodFastifySchemaValidationErrors(error)) {
            return reply.fail({
                type: 'validation-error',
                detail: 'Um ou mais campos da requisição são inválidos.',
                instance: request.url,
                validationErrors: error.validation.map((issue) => ({
                    path: issue.instancePath || issue.schemaPath,
                    message: issue.message ?? 'Valor inválido',
                })),
            });
        }

        const status = typeof error.statusCode === 'number' ? error.statusCode : 500;

        if (status === 429) {
            return reply.fail({ type: 'rate-limited', detail: error.message, instance: request.url });
        }

        request.log.error(error);
        return reply.fail({
            type: 'internal-error',
            detail: process.env.NODE_ENV === 'production' ? null : error.message,
            instance: request.url,
        });
    });

    app.setNotFoundHandler((request, reply) => {
        reply.fail({
            type: 'not-found',
            detail: `Rota ${request.method} ${request.url} não existe.`,
            instance: request.url,
        });
    });
}

import { z } from 'zod';

// =============================================================================
// Modelo de resposta padrão da v3 — só a v3 usa isto. A v2 mantém seu próprio
// formato, sem mudança. Padrão compartilhado com nova-api e nova-cie — ver
// docs/PADRAO-RESPOSTA-V3.md (raiz do workspace) antes de alterar aqui.
//
// Referências que embasaram este desenho:
// - RFC 7807 (Problem Details for HTTP APIs) para o formato de erro
// - Microsoft Azure Architecture Center, "API design best practices"
//   (códigos HTTP por verbo, paginação via limit/offset, versionamento)
// - Convenção comum de mercado (Stripe, GitHub, JSON:API) para o envelope
//   de sucesso com "meta" carregando informações transversais (paginação,
//   versão, request id) fora do "data" de negócio.
//
// Dois motivos para um envelope: (1) o cliente mobile sempre sabe onde
// achar o dado real (`data`) e onde achar metadado técnico (`meta`), sem
// inspecionar o corpo pra adivinhar; (2) erros carregam estrutura o
// suficiente para o app decidir automaticamente o que fazer (ex.: mostrar
// `title`/`detail`, ou reagir a um `type` específico), sem parsear texto.
// =============================================================================

export const API_VERSION = 'v3' as const;

// -----------------------------------------------------------------------------
// Sucesso
// -----------------------------------------------------------------------------

export const paginationMetaSchema = z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const responseMetaSchema = z.object({
    timestamp: z.iso.datetime(),
    requestId: z.string().nullable(),
    version: z.literal(API_VERSION),
    pagination: paginationMetaSchema.optional(),
});
export type ResponseMeta = z.infer<typeof responseMetaSchema>;

// Wrapper genérico para uso em runtime (montagem da resposta). Para os
// schemas de rota (documentação/validação Zod), use successResponseSchema.
export type SuccessResponse<T> = {
    success: true;
    data: T;
    meta: ResponseMeta;
};

// Gera o schema Zod de uma resposta de sucesso para um schema de dado
// específico — usado no `schema.response` de cada rota Fastify, para o
// Swagger documentar o formato real e o serializer validar a saída.
export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z.object({
        success: z.literal(true),
        data: dataSchema,
        meta: responseMetaSchema,
    });

// -----------------------------------------------------------------------------
// Erro — RFC 7807 (Problem Details), adaptado
// -----------------------------------------------------------------------------

// Enum fechado de tipos de erro conhecidos. Novo tipo de erro = adicionar
// aqui, não inventar string solta em algum controller.
export const ERROR_TYPES = [
    'validation-error',
    'not-found',
    'unauthorized',
    'forbidden',
    'rate-limited',
    'conflict',
    'upstream-error',
    'internal-error',
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

const errorTypeToUrn = (type: ErrorType): string => `urn:nova-tag:${type}`;

export const problemDetailsSchema = z.object({
    // URN fixo por tipo (ver errorTypeToUrn) — não é uma URL que precisa
    // resolver para uma página real; o RFC 7807 não exige isso.
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().nullable(),
    instance: z.string().nullable(),
    // Extensão local (permitida pelo RFC): detalhes estruturados de
    // validação Zod, quando o erro for 'validation-error'.
    validationErrors: z
        .array(
            z.object({
                path: z.string(),
                message: z.string(),
            }),
        )
        .optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export type ErrorResponse = {
    success: false;
    error: ProblemDetails;
    meta: ResponseMeta;
};

export const errorResponseSchema = z.object({
    success: z.literal(false),
    error: problemDetailsSchema,
    meta: responseMetaSchema,
});

// Status HTTP default por tipo de erro — usado quando quem chama não
// especifica um status próprio.
const DEFAULT_STATUS_BY_TYPE: Record<ErrorType, number> = {
    'validation-error': 400,
    'not-found': 404,
    unauthorized: 401,
    forbidden: 403,
    'rate-limited': 429,
    conflict: 409,
    'upstream-error': 502,
    'internal-error': 500,
};

// Título humano default por tipo — pode ser sobrescrito por chamada.
const DEFAULT_TITLE_BY_TYPE: Record<ErrorType, string> = {
    'validation-error': 'Dados de entrada inválidos',
    'not-found': 'Recurso não encontrado',
    unauthorized: 'Autenticação necessária',
    forbidden: 'Acesso negado',
    'rate-limited': 'Limite de requisições excedido',
    conflict: 'Conflito de estado',
    'upstream-error': 'Falha em serviço dependente',
    'internal-error': 'Erro interno',
};

export type BuildProblemInput = {
    type: ErrorType;
    detail?: string | null;
    instance?: string | null;
    title?: string;
    status?: number;
    validationErrors?: ProblemDetails['validationErrors'];
};

export const buildProblemDetails = (input: BuildProblemInput): ProblemDetails => ({
    type: errorTypeToUrn(input.type),
    title: input.title ?? DEFAULT_TITLE_BY_TYPE[input.type],
    status: input.status ?? DEFAULT_STATUS_BY_TYPE[input.type],
    detail: input.detail ?? null,
    instance: input.instance ?? null,
    ...(input.validationErrors ? { validationErrors: input.validationErrors } : {}),
});

export const statusForErrorType = (type: ErrorType): number => DEFAULT_STATUS_BY_TYPE[type];

import { z } from 'zod';

// Schemas Zod espelhando os tipos de src/core/tag-validator.ts e
// src/core/antenna-manager.ts. Mantidos separados do domínio (core/) de
// propósito: v3 é a única camada que precisa validar/documentar formato
// via Zod.

export const gateStateSchema = z.object({
    state: z.enum(['closed', 'opening', 'open', 'closing', 'unknown']),
    // true = portão travado aberto, sem fechamento automático.
    keepOpen: z.boolean(),
});

// AccessVerifyData: dados retornados pela API de verificação de acesso,
// incluem PII (NOME, QUADRA, LOTE) — rota protegida por token de serviço.
export const accessVerifyDataSchema = z.object({
    PERMITIDO: z.string().optional(),
    SEQPESSOA: z.union([z.string(), z.number()]).optional(),
    SEQCLASSIFICACAO: z.union([z.string(), z.number()]).optional(),
    CLASSIFAUTORIZADA: z.string().optional(),
    AUTORIZACAOLANC: z.string().optional(),
    TIPO: z.string().optional(),
    SEQIDACESSO: z.union([z.string(), z.number()]).optional(),
    QUADRA: z.string().optional(),
    LOTE: z.string().optional(),
    PANICO: z.string().optional(),
    MIDIA: z.string().optional(),
    IDENT: z.string().optional(),
    SEQVEICULO: z.union([z.string(), z.number()]).optional(),
    NOME: z.string().optional(),
    DESCRICAO: z.string().optional(),
});

export const tagCacheItemSchema = z.object({
    tag: z.string(),
    validatedAt: z.coerce.date(),
    isValid: z.boolean(),
    accessId: z.string().optional(),
    verifyData: accessVerifyDataSchema.optional(),
});

export const cacheStatsSchema = z.object({
    positiveSize: z.number(),
    negativeSize: z.number(),
    positiveTimeout: z.number(),
    negativeTimeout: z.number(),
});

export const listCacheDataSchema = z.object({
    type: z.enum(['positive', 'negative', 'all']),
    items: z.array(tagCacheItemSchema),
    stats: cacheStatsSchema,
});

export const cacheTypeQuerySchema = z.enum(['positive', 'negative', 'all', 'whitelist', 'blacklist']);

// -----------------------------------------------------------------------------
// Comandos
// -----------------------------------------------------------------------------

// Lidos no uso (não no topo do módulo) pelo mesmo motivo de sempre: o
// import roda antes de dotenv.config().
export const resolveAutoCloseDefaultSeconds = (): number => {
    const value = Number(process.env.GATE_AUTO_CLOSE_DEFAULT || '15');
    return Number.isInteger(value) && value > 0 ? value : 15;
};

export const resolveAutoCloseMaxSeconds = (): number => {
    const value = Number(process.env.GATE_AUTO_CLOSE_MAX || '120');
    return Number.isInteger(value) && value > 0 ? value : 120;
};

// Na v2, corpo vazio deixava o portão aberto indefinidamente (TAG-C-02).
// Aqui o padrão é fechar sozinho; ficar aberto exige keepOpen: true.
// O teto de autoCloseTime é conferido na rota (depende de env).
export const openGateBodySchema = z.object({
    autoCloseTime: z.number().int().min(1).optional(),
    keepOpen: z.literal(true).optional(),
}).strict().refine((body) => !(body.autoCloseTime !== undefined && body.keepOpen), {
    message: 'Use autoCloseTime ou keepOpen, não os dois.',
    path: ['keepOpen'],
}).optional();

export const confirmBodySchema = z.object({ confirm: z.boolean().optional() }).optional();

export const gateCommandResultSchema = z.object({
    action: z.enum(['open', 'close']),
    autoCloseSeconds: z.number().nullable(),
    gate: gateStateSchema,
});

export const restartResultSchema = z.object({
    message: z.string(),
    shutdownDelayMs: z.number(),
});

export const clearCacheResultSchema = z.object({
    type: z.enum(['positive', 'negative', 'all']),
    stats: cacheStatsSchema,
});

export const removeCacheItemResultSchema = z.object({ tag: z.string() });

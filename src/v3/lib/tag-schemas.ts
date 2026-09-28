import { z } from 'zod';

// Schemas Zod espelhando os tipos de src/core/tag-validator.ts e
// src/core/antenna-manager.ts. Mantidos separados do domínio (core/) de
// propósito: v3 é a única camada que precisa validar/documentar formato
// via Zod.

export const gateStateSchema = z.object({
    state: z.enum(['closed', 'opening', 'open', 'closing', 'unknown']),
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

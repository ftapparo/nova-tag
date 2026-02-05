import { Request, Response } from 'express';
import { getTagValidatorInstance } from '../core/antenna-manager';

/**
 * Lista entradas do cache de TAGs.
 * @route GET /v2/api/cache
 * @param req Express Request
 * @param res Response do Express
 */
export const listCache = (req: Request, res: Response): void => {
    const cacheType = parseCacheType(req.query?.type);
    if (!cacheType) {
        res.fail('Tipo de cache inválido. Use positive, negative, all, whitelist ou blacklist.', 400);
        return;
    }

    const tagValidator = getTagValidatorInstance();
    if (!tagValidator) {
        res.fail('TagValidator indisponível.', 503);
        return;
    }

    const items = tagValidator.listCache(cacheType);
    const stats = tagValidator.getCacheStats();

    res.ok({
        type: cacheType,
        items,
        stats
    });
};

/**
 * Limpa o cache de TAGs.
 * @route DELETE /v2/api/cache
 * @param req Express Request
 * @param res Response do Express
 */
export const clearCache = (req: Request, res: Response): void => {
    const cacheType = parseCacheType(req.query?.type);
    if (!cacheType) {
        res.fail('Tipo de cache inválido. Use positive, negative, all, whitelist ou blacklist.', 400);
        return;
    }

    const tagValidator = getTagValidatorInstance();
    if (!tagValidator) {
        res.fail('TagValidator indisponível.', 503);
        return;
    }

    tagValidator.clearCache(cacheType);
    res.ok({ message: 'Cache limpo com sucesso.', type: cacheType });
};

/**
 * Remove um item específico do cache de TAGs.
 * @route DELETE /v2/api/cache/:tag
 * @param req Express Request
 * @param res Response do Express
 */
export const removeCacheItem = (req: Request, res: Response): void => {
    const { tag } = req.params;
    if (!tag || tag.trim() === '') {
        res.fail('TAG inválida.', 400);
        return;
    }

    const tagValidator = getTagValidatorInstance();
    if (!tagValidator) {
        res.fail('TagValidator indisponível.', 503);
        return;
    }

    const removed = tagValidator.invalidateTag(tag);
    if (!removed) {
        res.fail('TAG não encontrada no cache.', 404);
        return;
    }

    res.ok({ message: 'TAG removida do cache com sucesso.', tag });
};

/**
 * Normaliza o tipo de cache recebido por query.
 * @param type Tipo de cache informado.
 * @returns Tipo normalizado ou null.
 */
const parseCacheType = (type: unknown): 'positive' | 'negative' | 'all' | null => {
    if (!type) {
        return 'all';
    }

    const value = Array.isArray(type) ? type[0] : type;
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'positive' || normalized === 'whitelist') {
        return 'positive';
    }

    if (normalized === 'negative' || normalized === 'blacklist') {
        return 'negative';
    }

    if (normalized === 'all') {
        return 'all';
    }

    return null;
};

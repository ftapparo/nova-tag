import express from 'express';
import { listCache, clearCache, removeCacheItem } from '../controllers/cache.controller';

const router = express.Router();

// Rotas para gerenciamento do cache de TAGs
router.get('/cache', listCache);

// Rota para limpar o cache, com tipo especificado via query parameter
router.delete('/cache', clearCache);

// Rota para remover um item específico do cache, com a tag especificada como parâmetro de rota
router.delete('/cache/:tag', removeCacheItem);

export default router;

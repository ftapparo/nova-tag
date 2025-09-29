/**
 * @file tag-validator.ts
 * @description Validação de TAG RFID, cache local, integração com API externa e registro de acesso.
 * @date 28/09/2025
 */

import logger from '../utils/logger';

/**
 * Resultado da validação de uma TAG RFID
 */
export interface ValidationResult {
    isValid: boolean;
    tag: string;
    reason?: string;
    timestamp: Date;
}

/**
 * Estrutura de cache para TAGs validadas
 */
export interface TagCache {
    tag: string;
    validatedAt: Date;
    isValid: boolean;
}

/**
 * Classe responsável por validar TAGs RFID, gerenciar cache e registrar acessos.
 */
export class TagValidator {
    private tagCache: Map<string, TagCache> = new Map();
    private readonly cacheTimeout: number;
    private readonly apiBaseUrl: string;
    private readonly apiTimeout: number;

    /**
     * Cria uma instância do validador de TAGs
     * @param cacheTimeout Tempo de cache em ms (default 5min)
     * @param apiBaseUrl URL base da API de validação
     * @param apiTimeout Timeout da requisição à API em ms
     */
    constructor(
        cacheTimeout: number = 300000, // 5 minutos
        apiBaseUrl: string = process.env.API_BASE_URL || 'http://localhost:3001',
        apiTimeout: number = 5000 // 5 segundos
    ) {
        this.cacheTimeout = cacheTimeout;
        this.apiBaseUrl = apiBaseUrl;
        this.apiTimeout = apiTimeout;
    }

    /**
     * Valida uma TAG RFID consultando cache local e API externa
     * @param tag TAG RFID a ser validada
     * @returns Resultado da validação
     */
    async validateTag(tag: string): Promise<ValidationResult> {
        try {
            // Sanitizar TAG
            const sanitizedTag = this.sanitizeTag(tag);

            if (!this.isValidTagFormat(sanitizedTag)) {
                return {
                    isValid: false,
                    tag: sanitizedTag,
                    reason: 'Formato de TAG inválido',
                    timestamp: new Date()
                };
            }

            // Verificar cache
            const cachedResult = this.getCachedValidation(sanitizedTag);
            if (cachedResult) {
                logger.info('[TagValidator] Validação de TAG via cache', {
                    tag: sanitizedTag,
                    cached: true,
                    valid: cachedResult.isValid
                });

                return {
                    isValid: cachedResult.isValid,
                    tag: sanitizedTag,
                    reason: cachedResult.isValid ? 'Cache hit - válida' : 'Cache hit - inválida',
                    timestamp: new Date()
                };
            }

            // Validar via API
            const apiResult = await this.validateViaAPI(sanitizedTag);

            // Atualizar cache
            this.updateCache(sanitizedTag, apiResult.isValid);

            logger.info('[TagValidator] Validação de TAG via API', {
                tag: sanitizedTag,
                cached: false,
                valid: apiResult.isValid
            });

            return apiResult;

        } catch (error) {
            logger.error('[TagValidator] Erro na validação de TAG', { tag, error });

            return {
                isValid: false,
                tag: tag,
                reason: `Erro na validação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                timestamp: new Date()
            };
        }
    }

    /**
     * Sanitiza a TAG removendo caracteres inválidos
     * @param tag TAG a ser sanitizada
     * @returns TAG sanitizada (apenas hexadecimais, maiúscula)
     */
    private sanitizeTag(tag: string): string {
        return tag.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    }

    /**
     * Verifica se o formato da TAG é válido (hexadecimal, 8-16 caracteres, par)
     * @param tag TAG já sanitizada
     * @returns true se formato válido
     */
    private isValidTagFormat(tag: string): boolean {
        // TAG deve ter entre 8 e 16 caracteres hexadecimais
        return /^[A-F0-9]{8,16}$/.test(tag) && tag.length % 2 === 0;
    }

    /**
     * Recupera validação do cache se ainda válida
     * @param tag TAG já sanitizada
     * @returns Cache ou null se expirado
     */
    private getCachedValidation(tag: string): TagCache | null {
        const cached = this.tagCache.get(tag);

        if (!cached) {
            return null;
        }

        const now = new Date();
        const cacheAge = now.getTime() - cached.validatedAt.getTime();

        if (cacheAge > this.cacheTimeout) {
            this.tagCache.delete(tag);
            return null;
        }

        return cached;
    }

    /**
     * Valida TAG via API externa
     * @param tag TAG já sanitizada
     * @returns Resultado da validação
     */
    private async validateViaAPI(tag: string): Promise<ValidationResult> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.apiTimeout);

        try {
            const response = await fetch(`${this.apiBaseUrl}/access/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'nova-tag/1.0.0'
                },
                body: JSON.stringify({ tag }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                isValid: data.authorized === true,
                tag,
                reason: data.authorized ? 'TAG autorizada pela API' : data.reason || 'TAG não autorizada',
                timestamp: new Date()
            };

        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Timeout na consulta à API');
            }

            throw error;
        }
    }

    /**
     * Atualiza cache com resultado da validação
     * @param tag TAG já sanitizada
     * @param isValid Resultado da validação
     */
    private updateCache(tag: string, isValid: boolean): void {
        this.tagCache.set(tag, {
            tag,
            validatedAt: new Date(),
            isValid
        });

        // Limitar tamanho do cache (máximo 100 TAGs)
        if (this.tagCache.size > 100) {
            const oldestKey = this.tagCache.keys().next().value;
            if (typeof oldestKey === 'string') {
                this.tagCache.delete(oldestKey);
            }
        }
    }

    /**
     * Registra acesso autorizado na API externa
     * @param tag TAG autorizada
     * @param antennaId Identificador da antena
     * @returns true se registro bem-sucedido
     */
    async registerAccess(tag: string, antennaId: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/access/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'nova-tag/1.0.0'
                },
                body: JSON.stringify({
                    tag,
                    antennaId,
                    timestamp: new Date().toISOString(),
                    direction: process.env[`${antennaId}_DIRECTION`] || 'UNKNOWN'
                })
            });

            if (!response.ok) {
                logger.error('[TagValidator] Falha ao registrar acesso', {
                    tag,
                    antennaId,
                    status: response.status
                });
                return false;
            }

            logger.info('[TagValidator] Acesso registrado com sucesso', { tag, antennaId });
            return true;

        } catch (error) {
            logger.error('[TagValidator] Erro ao registrar acesso', { tag, antennaId, error });
            return false;
        }
    }

    /**
     * Limpa entradas expiradas do cache
     */
    cleanExpiredCache(): void {
        const now = new Date();
        const expiredKeys: string[] = [];

        for (const [key, cached] of this.tagCache.entries()) {
            const cacheAge = now.getTime() - cached.validatedAt.getTime();
            if (cacheAge > this.cacheTimeout) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => this.tagCache.delete(key));

        if (expiredKeys.length > 0) {
            logger.info('[TagValidator] Limpeza de cache expirada', { quantidade: expiredKeys.length });
        }
    }

    /**
     * Retorna estatísticas do cache
     * @returns Quantidade de entradas e timeout
     */
    getCacheStats(): { size: number; timeout: number } {
        return {
            size: this.tagCache.size,
            timeout: this.cacheTimeout
        };
    }

    /**
     * Invalida entrada específica do cache
     * @param tag TAG a ser invalidada
     * @returns true se removida
     */
    invalidateTag(tag: string): boolean {
        const sanitizedTag = this.sanitizeTag(tag);
        return this.tagCache.delete(sanitizedTag);
    }

    /**
     * Limpa todo o cache de validação
     */
    clearCache(): void {
        this.tagCache.clear();
        logger.info('[TagValidator] Cache de validação limpo');
    }
}

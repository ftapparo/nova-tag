import axios, { AxiosError } from 'axios';
import logger from '../utils/logger';

/**
 * Resultado da validação de uma TAG RFID
 */
export interface ValidationResult {
    isValid: boolean;
    tag: string;
    accessId?: string;
    verifyData?: AccessVerifyData;
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
    accessId?: string;
    verifyData?: AccessVerifyData;
}

/**
 * Estrutura de dados retornada pela API de verificação
 */
export interface AccessVerifyData {
    PERMITIDO?: string;
    SEQPESSOA?: string | number;
    SEQCLASSIFICACAO?: string | number;
    CLASSIFAUTORIZADA?: string;
    AUTORIZACAOLANC?: string;
    TIPO?: string;
    SEQIDACESSO?: string | number;
    QUADRA?: string;
    LOTE?: string;
    PANICO?: string;
    MIDIA?: string;
    IDENT?: string;
    SEQVEICULO?: string | number;
    NOME?: string;
    DESCRICAO?: string;
}

/**
 * Contexto necessário para validação e registro de acesso
 */
export interface AccessContext {
    device: number;
    direction: string;
    antennaName: string;
    photo?: string;
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
    async validateTag(tag: string, context: AccessContext): Promise<ValidationResult> {
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
                    accessId: cachedResult.accessId,
                    verifyData: cachedResult.verifyData,
                    reason: cachedResult.isValid ? 'Cache hit - válida' : 'Cache hit - inválida',
                    timestamp: new Date()
                };
            }

            // Validar via API
            const apiResult = await this.validateViaAPI(sanitizedTag, context);

            // Atualizar cache
            this.updateCache(sanitizedTag, apiResult.isValid, apiResult.accessId, apiResult.verifyData);

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
    private async validateViaAPI(tag: string, context: AccessContext): Promise<ValidationResult> {
        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/v2/api/access/verify`,
                {
                    params: {
                        id: tag,
                        dispositivo: context.device,
                        foto: context.photo ?? null,
                        sentido: context.direction
                    },
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'nova-tag/2.0.0'
                    },
                    timeout: this.apiTimeout
                }
            );

            const payload = response.data as { status?: string; data?: AccessVerifyData; message?: string };

            if (payload?.status !== 'success') {
                return {
                    isValid: false,
                    tag,
                    reason: payload?.message || 'Falha ao consultar TAG na API',
                    timestamp: new Date()
                };
            }

            const verifyData = payload.data || {};
            const permitted = (verifyData.PERMITIDO || '').trim() === 'S';
            const accessId = (verifyData.IDENT || '').toString().trim() || undefined;

            return {
                isValid: permitted,
                tag,
                accessId,
                verifyData,
                reason: permitted ? 'TAG autorizada pela API' : 'TAG não autorizada',
                timestamp: new Date()
            };

        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;

                if (axiosError.code === 'ECONNABORTED') {
                    throw new Error('Timeout na consulta à API');
                }

                if (axiosError.response) {
                    throw new Error(
                        `API error: ${axiosError.response.status} ${axiosError.response.statusText}`
                    );
                }

                if (axiosError.request) {
                    throw new Error('Falha na conexão com a API');
                }
            }

            throw error;
        }
    }

    /**
     * Atualiza cache com resultado da validação
     * @param tag TAG já sanitizada
     * @param isValid Resultado da validação
     */
    private updateCache(tag: string, isValid: boolean, accessId?: string, verifyData?: AccessVerifyData): void {
        this.tagCache.set(tag, {
            tag,
            validatedAt: new Date(),
            isValid,
            accessId,
            verifyData
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
    async registerAccess(tag: string, verifyData: AccessVerifyData | undefined, context: AccessContext): Promise<boolean> {
        try {
            if (!verifyData) {
                logger.warn('[TagValidator] Registro ignorado: dados ausentes', {
                    tag,
                    antennaName: context.antennaName
                });
                return false;
            }

            await axios.post(
                `${this.apiBaseUrl}/access/register`,
                {
                    dispositivo: context.device,
                    pessoa: verifyData.SEQPESSOA,
                    classificacao: verifyData.SEQCLASSIFICACAO,
                    classAutorizado: (verifyData.CLASSIFAUTORIZADA || '').toString().trim(),
                    autorizacaoLanc: (verifyData.AUTORIZACAOLANC || '').toString().trim(),
                    origem: (verifyData.TIPO || '').toString().trim(),
                    seqIdAcesso: verifyData.SEQIDACESSO,
                    sentido: (context.direction || '').toString().trim(),
                    quadra: (verifyData.QUADRA || '').toString().trim(),
                    lote: (verifyData.LOTE || '').toString().trim(),
                    panico: (verifyData.PANICO || '').toString().trim(),
                    formaAcesso: (verifyData.MIDIA || '').toString().trim(),
                    idAcesso: (verifyData.IDENT || '').toString().trim(),
                    seqVeiculo: verifyData.SEQVEICULO
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'nova-tag/2.0.0'
                    },
                    timeout: this.apiTimeout
                }
            );

            if (process.env.DEBUG === 'true') {
                const timestamp = new Date().toTimeString().split(' ')[0];
                const sentido = context.direction === 'S' ? 'Saída' : 'Entrada';
                logger.info(
                    `[REGISTER] ID:${(verifyData.IDENT || '').toString().trim()} ${(verifyData.MIDIA || '').toString().trim()}, ${(verifyData.NOME || '').toString().trim()}, ${(verifyData.DESCRICAO || '').toString().trim()}, ${sentido} (${timestamp})`
                );
            }

            logger.info('[TagValidator] Acesso registrado com sucesso', { tag, antennaName: context.antennaName });
            return true;

        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                logger.error('[TagValidator] Falha ao registrar acesso', {
                    tag,
                    antennaName: context.antennaName,
                    status: error.response.status
                });
                return false;
            }

            logger.error('[TagValidator] Erro ao registrar acesso', { tag, antennaName: context.antennaName, error });
            return false;
        }
    }

    /**
     * Extrai motivo de erro da resposta da API
     * @param payload Resposta da API de verificação
     * @returns Motivo de erro
     */
    private extractApiErrorReason(payload: { message?: string | null; errors?: unknown }): string {
        if (payload?.message) {
            return payload.message;
        }

        if (payload?.errors) {
            if (typeof payload.errors === 'string') {
                return payload.errors;
            }

            try {
                return JSON.stringify(payload.errors);
            } catch {
                return 'TAG não autorizada';
            }
        }

        return 'TAG não autorizada';
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

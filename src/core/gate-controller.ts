import net from 'net';
import logger from '../utils/logger';

/**
 * Enum que representa os estados possíveis do portão
 */
export enum GateState {
    CLOSED = 'CLOSED',
    OPENING = 'OPENING',
    OPEN = 'OPEN',
    CLOSING = 'CLOSING'
}

/**
 * Interface de opções para inicialização do GateController
 */
export interface GateControllerOptions {
    relayOpenCmd: Buffer; // Comando para abrir o portão
    relayCloseCmd: Buffer; // Comando para fechar o portão
    socket: net.Socket; // Socket TCP conectado à antena
    openDurationMs?: number; // Tempo de portão aberto (ms)
    antennaId: number; // Identificador da antena
}

/**
 * Classe responsável por controlar o portão via comandos TCP, gerenciando estado, timers e logs.
 */
export class GateController {
    private state: GateState = GateState.CLOSED;
    private openTimer: NodeJS.Timeout | null = null;
    private readonly relayOpenCmd: Buffer;
    private readonly relayCloseCmd: Buffer;
    private readonly socket: net.Socket;
    private readonly openDurationMs: number;
    private readonly antennaId: number;

    /**
     * Cria uma instância do GateController
     * @param options Opções de configuração do controlador
     */
    constructor(options: GateControllerOptions) {
        this.relayOpenCmd = options.relayOpenCmd;
        this.relayCloseCmd = options.relayCloseCmd;
        this.socket = options.socket;
        this.openDurationMs = options.openDurationMs || 8000;
        this.antennaId = options.antennaId;
    }


    /**
     * Retorna o estado atual do portão
     */
    getState(): GateState {
        return this.state;
    }

    /**
     * Envia comando para abrir o portão, inicia timer de fechamento automático e atualiza estado
     * @returns Promise<boolean> true se comando enviado com sucesso
     */
    async openGate(autoCloseTime?: number): Promise<boolean> {
        if (this.state !== GateState.CLOSED) {
            logger.warn('[GateController] Tentativa de abrir portão já em estado', { state: this.state, antennaId: this.antennaId });
            return false;
        }
        try {
            this.sendCommand(this.relayOpenCmd);
            this.state = GateState.OPENING;
            logger.metric('OPEN_GATE', 1);
            logger.info('[GateController] Portão abrindo', { antennaId: this.antennaId });


            // Timer para fechamento automático
            this.openTimer = setTimeout(() => {
                // Comentário: fechamento automático após tempo configurado
                this.closeGate();
            }, autoCloseTime ?? this.openDurationMs);

            this.state = GateState.OPEN;
            return true;
        } catch (error) {
            logger.error('[GateController] Erro ao abrir portão', { error, antennaId: this.antennaId });
            return false;
        }
    }

    /**
     * Envia comando para fechar o portão e atualiza estado
     * @returns Promise<boolean> true se comando enviado com sucesso
     */
    async closeGate(): Promise<boolean> {
        if (this.state !== GateState.OPEN) {
            logger.warn('[GateController] Tentativa de fechar portão em estado', { state: this.state, antennaId: this.antennaId });
            return false;
        }
        try {
            this.sendCommand(this.relayCloseCmd);
            this.state = GateState.CLOSING;
            logger.metric('CLOSE_GATE', 1);
            logger.info('[GateController] Portão fechando', { antennaId: this.antennaId });


            // Após comando, considera fechado após 1s (tempo de resposta do relé)
            setTimeout(() => {
                this.state = GateState.CLOSED;
                logger.info('[GateController] Portão fechado', { antennaId: this.antennaId });
            }, 1000);

            if (this.openTimer) {
                clearTimeout(this.openTimer);
                this.openTimer = null;
            }
            return true;
        } catch (error) {
            logger.error('[GateController] Erro ao fechar portão', { error, antennaId: this.antennaId });
            return false;
        }
    }

    /**
     * Envia comando TCP para a antena
     * @param cmd Buffer com comando a ser enviado
     */
    public sendCommand(cmd: Buffer) {
        if (!this.socket || this.socket.destroyed) {
            logger.error('[GateController] Socket não conectado ao enviar comando', { antennaId: this.antennaId });
            throw new Error('Socket não conectado');
        }
        this.socket.write(cmd);
    }

    /**
     * Envia um comando via socket com tratamento de erro e callback opcional
     * @param cmd Comando a ser enviado
     * @param onSuccess Callback a ser chamado em caso de sucesso
     */
    public sendCommandCallback(cmd: Buffer, onSuccess?: () => void) {
        if (!this.socket || this.socket.destroyed) {
            logger.error('[GateController] Socket não conectado ao enviar comando', { antennaId: this.antennaId });
            throw new Error('Socket não conectado');
        }
        this.socket.write(cmd, (err) => {
            if (err) {
                logger.issue(`[ERROR] Falha ao enviar comando: ${err.message}`);
                this.socket.destroy();
            } else {
                onSuccess?.();
            }
        });
    }
}

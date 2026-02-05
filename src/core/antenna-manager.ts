import net from 'net';
import dotenv from 'dotenv';
import logger from '../utils/logger';
import { GateController } from './gate-controller';
import { TagValidator, AccessVerifyData } from './tag-validator';

// Tipagem da configuração da antena
export interface AntennaConfig {
  id: number;
  name: string;
  device: number;
  ip: string;
  port: number;
  direction: string;
  webserver: boolean;
  webserverPort: number;
}

// Enum para representar os estados possíveis do portão
enum GateState {
  CLOSED,
  OPENING,
  OPEN,
  CLOSING,
}

// Carrega variáveis de ambiente do arquivo .env
dotenv.config();

// Constantes de operação: intervalo de healthcheck, contagem máxima antes de enviar healthcheck,
// e os comandos em buffer para abrir/fechar portão e healthcheck
const HEALTHCHECK_TIMEOUT = Number(process.env.HEALTHCHECK_TIMEOUT) || 10000;
const ATTEMPT_RECONNECT = Number(process.env.ATTEMPT_RECONNECT) || 3;
const GATE_TIMEOUT_TO_CLOSE = Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000;
const RECENT_AUTHORIZED_LIMIT = Number(process.env.RECENT_AUTHORIZED_LIMIT) || 3;
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const FILTER_CMD = Buffer.from(String(process.env.FILTER_DATA) || "", "hex");

// Variáveis de controle do estado da aplicação
let healthCheckWaitResponse = false;
let gateState: GateState = GateState.CLOSED;
let closeGateTimeout: NodeJS.Timeout | null = null;
let isReconnecting = false;
let isShuttingDown = false;
let connectionRetry = 0;

// Variáveis globais para instâncias de GateController e TagValidator
let gateController: GateController;
let tagValidator: TagValidator;

/**
 * Classe responsável por gerenciar a antena RFID
 */
export class AntennaManager {

  // Configuração da antena gerenciada por esta instância
  public antenna: AntennaConfig;
  public antennaSocket: net.Socket;
  private recentAuthorizedTags: Map<string, AccessVerifyData | undefined> = new Map();
  private processingTags: Set<string> = new Set();
  private lastActivityAt: number | null = null;
  private unhealthySince: number | null = null;
  private lastRestartAt: number | null = null;
  private startedAt: number = Date.now();
  private hasEverConnected = false;
  private lastConnectedAt: number | null = null;

  /**
   * Inicia a conexão com a antena RFID e gerencia eventos de comunicação TCP
   * @param antenna Configuração da antena a ser gerenciada
   */
  constructor(antenna: AntennaConfig) {
    this.antenna = antenna;
    this.antennaSocket = new net.Socket();
  }

  /**
   * Conecta à antena RFID e gerencia eventos de comunicação TCP
   * @param antenna Configuração da antena a ser conectada
   */
  public connectToAntenna() {
    const client = new net.Socket();
    this.antennaSocket = client;

    // Reatribui instâncias globais se necessário
    gateController = new GateController({
      relayOpenCmd: RELAY_OPEN_CMD,
      relayCloseCmd: RELAY_CLOSE_CMD,
      socket: client,
      openDurationMs: Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000,
      antennaId: this.antenna.id
    });
    tagValidator = new TagValidator();

    // Evento da conexão do socket
    client.connect(this.antenna.port, this.antenna.ip, () => {

      const now = Date.now();
      this.lastActivityAt = now;
      this.unhealthySince = null;
      this.hasEverConnected = true;
      this.lastConnectedAt = now;

      // Reset de variáveis de estado ao conectar
      healthCheckWaitResponse = false;  //indica que não está esperando resposta do healthcheck
      gateState = GateState.CLOSED;     //estado do portão fechado
      isReconnecting = false;           //indica que não está reconectando

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      this.recentAuthorizedTags.clear();

      this.antennaSocket.setTimeout(HEALTHCHECK_TIMEOUT);
      logger.info(`[CONNECTED] Antena RFID [IP: ${this.antenna.ip}]`);
      logger.debug(`[HEALTHCHECK] Timeout de conexão ${HEALTHCHECK_TIMEOUT}ms`);

      gateController.sendCommandCallback(RELAY_CLOSE_CMD, () => {
        logger.debug(`[SYNC] Reset interno realizado e comando de fechamento enviado`);

        setTimeout(() => {
          logger.debug(`[MASK] Configurando filtro  - ${FILTER_CMD.toString('hex').toUpperCase()}`);
          gateController.sendCommand(FILTER_CMD);
        }, 1000);
      });

    });

    // Evento ao receber dados do socket
    client.on("data", async (data) => {

      this.lastActivityAt = Date.now();

      const hexData = data.toString("hex");   // Converte os dados recebidos para hexadecimal
      connectionRetry = 0;                    // Reseta o contador de tentativas de conexão
      healthCheckWaitResponse = false;        // Reseta o estado de espera por resposta do healthcheck

      //logger.debug(`Mensagem: ${hexData}`);

      // Resposta de HealthCheck
      if (hexData.startsWith("cf000050")) {
        logger.debug(`[HEALTHCHECK] Conexão estável, aguardando nova leitura`);
        return;
      }

      // Resposta de comando de configuração de filtro
      else if (hexData.startsWith("cf000076")) {
        if (hexData.startsWith("cf000076020001")) {
          logger.debug("[MASK] Filtro por máscara configurado com sucesso");

        }
        else {
          logger.error("[ERROR] Falha ao configurar filtro por máscara");
          setImmediate(() => this.antennaSocket.destroy());
        }
        return;
      }

      // Resposta de comando de fechamento
      else if (hexData.startsWith("cf000077020001")) {
        logger.debug(`[STATE] Portão fechado`);
        logger.counter("CLOSE_GATE");   // Incrementa o contador de abertura de portão
        gateState = GateState.CLOSED;
        return;
      }

      // Resposta de comando de abertura
      else if (hexData.startsWith("cf00007703")) {
        logger.debug(`[STATE] Portão aberto`);
        return;
      }

      // Leitura de TAG detectada
      else if (hexData.startsWith("cf00000112")) {
        const tagNumber = "0" + hexData.slice(-13, -4);   // Extrai o número da TAG do dado recebido
        logger.debug(`[READ] TAG ${tagNumber}`);

        //logger.debug(`[READ]  ${hexData}`);

        this.handleTagRead(tagNumber, this.antenna.name);
        return;
      }

      // Mensagem diferente do esperado
      else {
        //logger.debug(`[UNKNOWN] Mensagem desconhecida: ${hexData}`);
      }
    });

    // Evento de inatividade (timeout) no socket
    client.on("timeout", () => {

      if (gateState === GateState.OPEN) {
        logger.debug(`[TIMEOUT] Portão travado aberto. Reiniciando conexão.`);
        setImmediate(() => this.antennaSocket.destroy());
        return;
      }

      if (healthCheckWaitResponse) {
        logger.error(`[TIMEOUT] Antena ${this.antenna.ip} não respondeu ao HealthCheck. Reiniciando conexão.`);
        setImmediate(() => this.antennaSocket.destroy());
        return;
      }

      gateController.sendCommandCallback(HEALTHCHECK_CMD, () => {
        healthCheckWaitResponse = true;
        logger.warn(`[TIMEOUT] Inatividade detectada. HealthCheck enviado`);

        // Timeout adicional para aguardar resposta do healthcheck
        setTimeout(() => {
          if (healthCheckWaitResponse) {
            logger.issue(`[ERROR] A dispositivo excedeu o tempo de resposta`);
            if (!this.unhealthySince) {
              this.unhealthySince = Date.now();
            }
            setImmediate(() => this.antennaSocket.destroy());
          }
        }, 3000);
      });
    });

    // Evento de desconexão do socket
    client.on("close", () => {

      if (!this.unhealthySince) {
        this.unhealthySince = Date.now();
      }

      if (connectionRetry > ATTEMPT_RECONNECT) {
        logger.issue("[ERROR] Excedido o número de tentativas de reconexão");
        // Encerrar a aplicação
        process.exit(1);
      }

      if (!isReconnecting) {
        logger.warn(`[DISCONNECTED] Antena [${this.antenna.ip}]. Tentando reconectar...`);
        isReconnecting = true;

        if (closeGateTimeout) {
          clearTimeout(closeGateTimeout);
          closeGateTimeout = null;
        }

        connectionRetry++;
        setTimeout(() => { this.connectToAntenna() }, 3000);
      }
    });

    // Evento de erro no socket
    client.on("error", (err) => {
      if (!this.antennaSocket.destroyed) {
        logger.issue(`[ERROR] Antena [${this.antenna.ip}]: ${err.message}`);
        if (!this.unhealthySince) {
          this.unhealthySince = Date.now();
        }
        this.antennaSocket.destroy();
      }
    });
  }

  /**
   * Função para encerrar a aplicação com limpeza adequada do socket
   */
  public shutdown() {
    if (!isShuttingDown) {
      isShuttingDown = true;
      logger.issue("[SHUTDOWN] Encerrando aplicação...");
      this.antennaSocket?.destroy();

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      process.exit(1);
    }
  }

  public get getGateState(): string {
    switch (gateState) {
      case GateState.CLOSED:
        return 'closed';
      case GateState.OPENING:
        return 'opening';
      case GateState.OPEN:
        return 'open';
      case GateState.CLOSING:
        return 'closing';
      default:
        return 'unknown';
    }
  }
  public async openGate(autoCloseTime?: number, options?: { keepOpen?: boolean }): Promise<boolean> {
    if (!gateController) {
      return false;
    }

    try {
      return await gateController.openGate(autoCloseTime, options);
    } catch (error) {
      logger.error('[AntennaManager] Erro ao abrir portão via rota', { error, antennaId: this.antenna.id });
      return false;
    }
  }

  public async closeGate(): Promise<boolean> {
    if (!gateController) {
      return false;
    }

    try {
      return await gateController.closeGate();
    } catch (error) {
      logger.error('[AntennaManager] Erro ao fechar portão via rota', { error, antennaId: this.antenna.id });
      return false;
    }
  }

  /**
   * Reinicia a conexão TCP com a antena RFID.
   * Força o encerramento do socket atual e tenta reconectar.
   * @returns Retorna true se o fluxo de reinício foi disparado
   */
  public async restartConnection(): Promise<boolean> {
    try {
      this.lastRestartAt = Date.now();
      if (this.antennaSocket && !this.antennaSocket.destroyed) {
        logger.warn(`[RESTART] Reiniciando conexão da antena [${this.antenna.ip}]`);
        this.antennaSocket.destroy();
      } else {
        logger.warn(`[RESTART] Socket já estava encerrado para antena [${this.antenna.ip}]`);
      }

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      healthCheckWaitResponse = false;
      isReconnecting = false;
      connectionRetry = 0;
      this.unhealthySince = this.unhealthySince ?? Date.now();

      setTimeout(() => {
        this.connectToAntenna();
      }, 300);

      return true;
    } catch (error) {
      logger.error('[AntennaManager] Erro ao reiniciar conexão da antena', { error, antennaId: this.antenna.id });
      return false;
    }
  }

  /**
   * Verifica status de saúde da antena com base no tempo de inatividade.
   * @param nowMs Timestamp atual em ms
   * @param maxSilenceMs Máximo de inatividade tolerada em ms
   * @param failAfterMs Tempo para considerar falha crítica em ms
   * @returns Snapshot do status de saúde
   */
  public getHealthSnapshot(
    nowMs: number,
    maxSilenceMs: number,
    failAfterMs: number,
    startupGraceMs: number
  ): { status: 'healthy' | 'degraded' | 'unhealthy'; lastActivityAt: number | null; unhealthySince: number | null; shouldFail: boolean } {
    const inStartupGrace = nowMs - this.startedAt < startupGraceMs;
    const lastConnectedAt = this.lastConnectedAt;
    const inReconnectGrace = lastConnectedAt ? nowMs - lastConnectedAt < startupGraceMs : false;

    if (!this.hasEverConnected || inStartupGrace || inReconnectGrace) {
      return {
        status: 'healthy',
        lastActivityAt: this.lastActivityAt,
        unhealthySince: null,
        shouldFail: false,
      };
    }

    const lastActivityAt = this.lastActivityAt;
    const silenceMs = lastActivityAt ? nowMs - lastActivityAt : null;

    if (silenceMs === null || silenceMs > maxSilenceMs) {
      if (!this.unhealthySince) {
        this.unhealthySince = nowMs;
      }
    } else {
      this.unhealthySince = null;
    }

    const unhealthySince = this.unhealthySince;
    const shouldFail = unhealthySince !== null && nowMs - unhealthySince >= failAfterMs;
    const status = shouldFail ? 'unhealthy' : (unhealthySince ? 'degraded' : 'healthy');

    return {
      status,
      lastActivityAt,
      unhealthySince,
      shouldFail,
    };
  }

  /**
   * Reinicia a conexão respeitando um cooldown para evitar loops de restart.
   * @param nowMs Timestamp atual em ms
   * @param cooldownMs Intervalo mínimo entre reinícios
   * @returns True se reinício foi disparado
   */
  public async restartConnectionIfNeeded(nowMs: number, cooldownMs: number): Promise<boolean> {
    if (isReconnecting || this.antennaSocket?.connecting) {
      return false;
    }

    if (this.lastRestartAt && nowMs - this.lastRestartAt < cooldownMs) {
      return false;
    }

    return this.restartConnection();
  }

  /**
   * Função para tratar leitura de TAG usando TagValidator e GateController
   * @param tagNumber Número da TAG lida
   * @param antennaName Nome da antena que leu a TAG
   */
  private async handleTagRead(tagNumber: string, antennaName: string) {
    if (this.processingTags.has(tagNumber)) {
      logger.debug('[TAG] Leitura ignorada por processamento em andamento', { tagNumber, antennaName });
      return;
    }

    this.processingTags.add(tagNumber);

    const cachedVerifyData = this.recentAuthorizedTags.get(tagNumber);
    if (cachedVerifyData !== undefined) {
      this.logTagRead(tagNumber, true, cachedVerifyData);
      gateController.openGate();
      this.processingTags.delete(tagNumber);
      return;
    }

    try {
      const accessContext = {
        device: this.antenna.device,
        direction: this.antenna.direction,
        antennaName,
      };

      const result = await tagValidator.validateTag(tagNumber, accessContext);
      if (result.isValid) {
        this.logTagRead(tagNumber, true, result.verifyData);
        logger.counter('AUTHORIZED');
        this.recentAuthorizedTags.set(tagNumber, result.verifyData);
        if (this.recentAuthorizedTags.size > RECENT_AUTHORIZED_LIMIT) {
          const oldest = this.recentAuthorizedTags.keys().next().value;
          if (typeof oldest === 'string') {
            this.recentAuthorizedTags.delete(oldest);
          }
        }
        await tagValidator.registerAccess(tagNumber, result.verifyData, accessContext);
        gateController.openGate();
      } else {
        this.logTagRead(tagNumber, false, result.verifyData, result.reason);
        logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} não autorizada: ${result.reason}`);
      }
    } finally {
      this.processingTags.delete(tagNumber);
    }
  }

  /**
   * Registra log da leitura de TAG com dados do portador e status de autorização.
   * @param tagNumber Número da TAG
   * @param isAuthorized Status de autorização
   * @param verifyData Dados retornados pela validação
   * @param reason Motivo quando não autorizado
   */
  private logTagRead(tagNumber: string, isAuthorized: boolean, verifyData?: AccessVerifyData, reason?: string): void {
    const nome = (verifyData?.NOME || '').toString().trim();
    const media = (verifyData?.MIDIA || '').toString().trim();
    const descricao = (verifyData?.DESCRICAO || '').toString().trim();
    const status = isAuthorized ? 'AUTORIZADA' : 'NÃO AUTORIZADA';
    const detalhes = [media, nome, descricao].filter(Boolean).join(', ');
    const motivo = reason ? ` Motivo: ${reason}` : '';

    logger.info(`[TAG] ${tagNumber} ${status}${detalhes ? ` - ${detalhes}` : ''}${motivo}`);
  }
}
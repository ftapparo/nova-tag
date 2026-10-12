import net from 'net';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { GateController } from './gate-controller';
import { TagValidator, AccessVerifyData } from './tag-validator';
import { tagEvents } from './tag-events';

/**
 * Configuração de conexão e operação da antena RFID.
 */
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

/**
 * Estados possíveis do portão.
 */
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
const HEALTHCHECK_TIMEOUT = Number(process.env.HEALTHCHECK_TIMEOUT) || 30000;
const HEALTHCHECK_GUARD_MS = Number(process.env.HEALTHCHECK_GUARD_MS) || 500;
const HEALTHCHECK_ENABLED = process.env.HEALTHCHECK_ENABLED !== 'false';
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS) || 10000;
const GATE_TIMEOUT_TO_CLOSE = Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000;
const RECENT_AUTHORIZED_LIMIT = Number(process.env.RECENT_AUTHORIZED_LIMIT) || 3;
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const FILTER_CMD = Buffer.from(String(process.env.FILTER_DATA) || "", "hex");

// Variáveis de controle do estado da aplicação
let healthCheckWaitResponse = false;
let lastDataTimestamp: number = 0;
let gateState: GateState = GateState.CLOSED;
let closeGateTimeout: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let responseTimer: NodeJS.Timeout | null = null;
let unrecoverableExitTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let receivedSinceConnect = false;    // a conexão atual já recebeu algum byte da antena
let isRetryConnection = false;       // a conexão atual é a reconexão única após uma queda
let antennaUnrecoverable = false;    // a reconexão também não recebeu nada: aguarda o reinício do container

const RECONNECT_DELAY_MS = 3000;
const UNRECOVERABLE_EXIT_MS = 60000;

// Lida no uso, não no topo: imports resolvem antes do dotenv.config() do server.
const resolveCommandResponseTimeoutMs = (): number => Number(process.env.COMMAND_RESPONSE_TIMEOUT_MS) || 5000;

// Variáveis globais para instâncias de GateController e TagValidator
let gateController: GateController;
let tagValidator: TagValidator | null = null;

/**
 * Indica se o health deve responder 503: healthcheck da antena pendente, ou
 * antena sem resposta mesmo após a reconexão. No segundo caso o 503 leva o
 * autoheal a fazer stop/start do container — o mesmo stop/start manual no
 * Portainer que historicamente recupera a antena quando reconectar não basta.
 * @returns `true` quando o health deve sinalizar falha.
 */
export const isHealthcheckAwaitingResponse = (): boolean => healthCheckWaitResponse || antennaUnrecoverable;

/**
 * Retorna a instância atual do TagValidator, se disponível.
 * @returns Instância do TagValidator ou null quando indisponível.
 */
export const getTagValidatorInstance = (): TagValidator | null => tagValidator;

/**
 * Gerencia a conexão TCP com a antena RFID e a lógica de operação do portão.
 */
export class AntennaManager {

  // Configuração da antena gerenciada por esta instância
  public antenna: AntennaConfig;
  public antennaSocket: net.Socket;
  private recentAuthorizedTags: Map<string, AccessVerifyData | undefined> = new Map();

  /**
   * Cria uma instância do gerenciador de antena.
   * @param antenna Configuração da antena a ser gerenciada.
   */
  constructor(antenna: AntennaConfig) {
    this.antenna = antenna;
    this.antennaSocket = new net.Socket();
  }

  /**
   * Conecta à antena RFID e registra eventos de comunicação TCP.
   * @returns void.
   */
  public connectToAntenna() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const client = new net.Socket();
    this.antennaSocket = client;
    receivedSinceConnect = false;

    // Reatribui instâncias globais se necessário
    gateController = new GateController({
      relayOpenCmd: RELAY_OPEN_CMD,
      relayCloseCmd: RELAY_CLOSE_CMD,
      socket: client,
      openDurationMs: Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000,
      antennaId: this.antenna.id,
      onCommandSent: () => this.expectResponse(client),
    });
    tagValidator = new TagValidator();

    // Timeout de conexão: se o handshake TCP não completar nem falhar a tempo,
    // o socket travaria indefinidamente sem disparar "close" ou "error", impedindo
    // a reconexão e mantendo o container "unhealthy" para sempre sem reiniciar.
    client.setTimeout(CONNECT_TIMEOUT_MS);
    const onConnectTimeout = () => {
      logger.issue(`[ERROR] Timeout ao conectar na antena [${this.antenna.ip}]`);
      client.destroy();
    };
    client.once("timeout", onConnectTimeout);

    // Evento da conexão do socket
    client.connect(this.antenna.port, this.antenna.ip, () => {
      client.removeListener("timeout", onConnectTimeout);

      // Reset de variáveis de estado ao conectar
      healthCheckWaitResponse = false;  //indica que não está esperando resposta do healthcheck
      lastDataTimestamp = 0;            //reseta o timestamp do último dado recebido
      gateState = GateState.CLOSED;     //estado do portão fechado

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      this.recentAuthorizedTags.clear();

      this.antennaSocket.setTimeout(HEALTHCHECK_TIMEOUT);
      logger.info(`[CONNECTED] Antena RFID [IP: ${this.antenna.ip}]`);
      tagEvents.emitEvent('antenna.connection.changed', { connected: true });
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

      const hexData = data.toString("hex");   // Converte os dados recebidos para hexadecimal
      receivedSinceConnect = true;            // A antena respondeu nesta conexão
      if (responseTimer) {                    // Qualquer byte atende o comando que aguardava resposta
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      healthCheckWaitResponse = false;        // Reseta o estado de espera por resposta do healthcheck
      lastDataTimestamp = Date.now();         // Registra o momento do último dado recebido

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

      // O timeout de conexão (CONNECT_TIMEOUT_MS) dispara este mesmo evento depois
      // de destruir o socket; enviar healthcheck nele lançaria exceção e derrubaria
      // o processo. Socket substituído também não tem mais o que verificar.
      if (client.destroyed || client !== this.antennaSocket) {
        return;
      }

      // Guard: se um dado foi recebido recentemente, o timeout disparou concorrente com uma
      // transmissão da antena. Enviar healthcheck agora travaria o firmware. O timer de
      // inatividade vai resetar sozinho quando o evento data pendente for processado.
      const msSinceLastData = Date.now() - lastDataTimestamp;
      if (lastDataTimestamp > 0 && msSinceLastData < HEALTHCHECK_GUARD_MS) {
        logger.debug(`[TIMEOUT] Ignorado: dado recebido há ${msSinceLastData}ms`);
        return;
      }

      if (gateState === GateState.OPEN) {
        logger.debug(`[TIMEOUT] Portão travado aberto. Reiniciando conexão.`);
        setImmediate(() => this.antennaSocket.destroy());
        return;
      }

      if (!HEALTHCHECK_ENABLED) {
        logger.debug(`[TIMEOUT] Healthcheck desabilitado por configuração`);
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
          // Só derruba o socket que enviou o healthcheck, nunca uma reconexão posterior.
          if (healthCheckWaitResponse && client === this.antennaSocket) {
            logger.issue(`[ERROR] A dispositivo excedeu o tempo de resposta`);
            setImmediate(() => client.destroy());
          }
        }, 3000);
      });
    });

    // Evento de desconexão do socket
    client.on("close", () => {
      // Só o socket atual decide a reconexão. Antes, uma conexão que falhava
      // (timeout ao conectar) chegava aqui com a reconexão marcada como "em
      // andamento" e nada mais era agendado: o processo ficava vivo sem antena
      // até o autoheal reiniciar o container (crise de 10/10/2026).
      if (client !== this.antennaSocket || isShuttingDown) {
        return;
      }

      tagEvents.emitEvent('antenna.connection.changed', { connected: false });
      gateController.dispose();
      healthCheckWaitResponse = false;

      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      // Uma reconexão recupera a antena que reiniciou (pico de energia). Quando nem
      // ela recebe resposta, insistir não adianta: na crise de 10/10/2026 a antena
      // seguiu muda em reconexões a cada poucos segundos, inclusive após o processo
      // reiniciar sozinho, e só voltou com stop/start do container.
      if (!receivedSinceConnect && isRetryConnection) {
        this.markUnrecoverable();
        return;
      }

      logger.warn(`[DISCONNECTED] Antena [${this.antenna.ip}]. Tentando reconectar...`);
      this.scheduleReconnect(RECONNECT_DELAY_MS, true);
    });

    // Evento de erro no socket. O Node já marca o socket como destruído antes de
    // emitir "error", então o log não pode depender de `destroyed`.
    client.on("error", (err) => {
      logger.issue(`[ERROR] Antena [${this.antenna.ip}]: ${err.message}`);
      client.destroy();
    });
  }

  /**
   * Agenda uma nova conexão com a antena, substituindo um agendamento anterior.
   * @param delayMs Espera antes de conectar.
   * @param isRetry Se é a reconexão única após uma queda.
   * @returns void.
   */
  private scheduleReconnect(delayMs: number, isRetry: boolean) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      isRetryConnection = isRetry;
      this.connectToAntenna();
    }, delayMs);
  }

  /**
   * Aguarda resposta da antena a um comando: sem nenhum byte no prazo, a antena
   * está muda e a conexão é derrubada. Vale qualquer byte, não só a confirmação
   * do comando, para não depender de como as mensagens chegam agrupadas no TCP.
   * @param client Socket pelo qual o comando foi enviado.
   * @returns void.
   */
  private expectResponse(client: net.Socket) {
    // Já existe comando aguardando: o primeiro byte que chegar atende os dois.
    if (responseTimer) {
      return;
    }

    const timeoutMs = resolveCommandResponseTimeoutMs();
    responseTimer = setTimeout(() => {
      responseTimer = null;
      if (client === this.antennaSocket && !client.destroyed) {
        logger.issue(`[ERROR] Antena [${this.antenna.ip}] sem resposta ${timeoutMs}ms após comando. Reiniciando conexão`);
        client.destroy();
      }
    }, timeoutMs);
  }

  /**
   * Para de conectar e sinaliza falha no health para o autoheal fazer stop/start
   * do container. Se o reinício não vier (autoheal fora do ar), encerra o processo
   * para o Docker subir de novo em vez de ficar parado sem antena.
   * @returns void.
   */
  private markUnrecoverable() {
    antennaUnrecoverable = true;
    logger.issue(`[ERROR] Antena [${this.antenna.ip}] sem resposta após reconexão. Health sinalizando falha para reinício do container`);

    unrecoverableExitTimer = setTimeout(() => {
      logger.issue(`[ERROR] Container não reiniciado em ${UNRECOVERABLE_EXIT_MS}ms. Encerrando processo`);
      process.exit(1);
    }, UNRECOVERABLE_EXIT_MS);
  }

  /**
   * Encerra a aplicação com limpeza adequada do socket.
   * @returns void.
   */
  public shutdown() {
    if (!isShuttingDown) {
      isShuttingDown = true;
      logger.issue("[SHUTDOWN] Encerrando aplicação...");

      healthCheckWaitResponse = false;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (this.antennaSocket && !this.antennaSocket.destroyed) {
        this.antennaSocket.end();
        this.antennaSocket.destroy();
      }

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }
    }
  }

  /**
   * Indica se a aplicação está em processo de encerramento.
   * @returns `true` quando o shutdown já foi iniciado.
   */
  public isShuttingDown(): boolean {
    return isShuttingDown;
  }

  /**
   * Reinicia a conexão TCP com a antena RFID.
   * @returns `true` se o fluxo de reinício foi disparado.
   */
  public async restartConnection(): Promise<boolean> {
    try {
      healthCheckWaitResponse = false;
      antennaUnrecoverable = false;
      isRetryConnection = false;
      if (unrecoverableExitTimer) {
        clearTimeout(unrecoverableExitTimer);
        unrecoverableExitTimer = null;
      }

      // Com o socket aberto, o próprio evento "close" agenda a reconexão.
      if (this.antennaSocket && !this.antennaSocket.destroyed) {
        logger.warn(`[RESTART] Reiniciando conexão da antena [${this.antenna.ip}]`);
        this.antennaSocket.destroy();
      } else {
        logger.warn(`[RESTART] Socket já estava encerrado para antena [${this.antenna.ip}]`);
        this.scheduleReconnect(300, false);
      }

      return true;
    } catch (error) {
      logger.error('[AntennaManager] Erro ao reiniciar conexão da antena', { error, antennaId: this.antenna.id });
      return false;
    }
  }

  /**
   * Obtém o estado atual do portão.
   * @returns Estado atual do portão.
   */
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

  /**
   * Estado real do portão, lido do GateController (quem de fato transita
   * OPENING/OPEN/CLOSING). O getter getGateState acima lê uma variável que
   * só recebe CLOSED; fica como está porque a v2 o usa.
   * @returns Estado do portão em minúsculas, ou 'unknown' sem controlador.
   */
  public getControllerGateState(): { state: 'closed' | 'opening' | 'open' | 'closing' | 'unknown'; keepOpen: boolean } {
    if (!gateController) {
      return { state: 'unknown', keepOpen: false };
    }
    return {
      state: gateController.getState().toLowerCase() as 'closed' | 'opening' | 'open' | 'closing',
      keepOpen: gateController.isKeepOpen(),
    };
  }

  /**
   * Abre o portão, opcionalmente com fechamento automático.
   * @param autoCloseTime Tempo em segundos para fechamento automático.
   * @param options Opções adicionais de abertura.
   * @returns `true` quando o comando foi enviado com sucesso.
   */
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

  /**
   * Fecha o portão imediatamente.
   * @returns `true` quando o comando foi enviado com sucesso.
   */
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
   * Trata a leitura de TAG usando `TagValidator` e `GateController`.
   * @param tagNumber Número da TAG lida.
   * @param antennaName Nome da antena que leu a TAG.
   * @returns void.
   */
  private async handleTagRead(tagNumber: string, antennaName: string) {
    const cachedVerifyData = this.recentAuthorizedTags.get(tagNumber);
    if (cachedVerifyData !== undefined) {
      this.logTagRead(tagNumber, true, cachedVerifyData);
      this.emitTagRead(tagNumber, true);
      gateController.openGate();
      return;
    }

    const accessContext = {
      device: this.antenna.device,
      direction: this.antenna.direction,
      antennaName,
    };

    if (!tagValidator) {
      logger.error('[AntennaManager] TagValidator não inicializado', { antenna: this.antenna.name });
      return;
    }

    const result = await tagValidator.validateTag(tagNumber, accessContext);
    if (result.isValid) {
      this.logTagRead(tagNumber, true, result.verifyData);
      this.emitTagRead(tagNumber, true);
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
      this.emitTagRead(tagNumber, false, result.reason);
      logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} não autorizada: ${result.reason}`);
    }
  }

  private emitTagRead(tagNumber: string, authorized: boolean, reason?: string): void {
    tagEvents.emitEvent('tag.read', {
      tag: tagNumber,
      authorized,
      reason: reason ?? null,
      direction: this.antenna.direction,
    });
  }

  /**
   * Registra log da leitura de TAG com dados do portador e status de autorização.
   * @param tagNumber Número da TAG.
   * @param isAuthorized Status de autorização.
   * @param verifyData Dados retornados pela validação.
   * @param reason Motivo quando não autorizado.
   * @returns void.
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
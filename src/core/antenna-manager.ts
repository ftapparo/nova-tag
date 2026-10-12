import net from 'net';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { GateController, GateState as ControllerGateState } from './gate-controller';
import { PassageTracker } from './passage-tracker';
import { TagValidator, AccessVerifyData } from './tag-validator';
import { tagEvents } from './tag-events';
import { AntennaCmd, AntennaFrame, extractFrames } from './antenna-protocol';

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
// Comandos da antena (UHF Prime Reader User Manual V1.0). Nunca enviar o 0x0052
// (RFM_REBOOT): apesar do nome, restaura a configuração de fábrica (IP, porta,
// modo de trabalho, máscara). A antena não tem comando de reinício.
// RFM_MODULE_INT (0x0050): verificação de antena online indicada pelo manual, a de resposta mais curta.
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");
// RFM_RELEASE_CLOSE_RELAY (0x0077), opção 0x02 "close": aciona o relé por ValidTime = 10 s;
// depois o próprio hardware solta o relé, mesmo se a conexão cair.
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
// Com a TAG ainda sendo lida, o comando de abrir é reenviado 7 s após o último envio,
// 3 s antes de o relé soltar sozinho (o relé comanda o semáforo).
const RELAY_RENEW_AFTER_MS = 7000;

// Intrusas e gravação no ERP (core/passage-tracker.ts). Calibrado com a semana de 05 a
// 11/10/2026: com 60 s de intervalo mínimo, só as TAGs dos carros estacionados de frente
// para a antena da TAG2 seriam marcadas — nenhum carro de verdade nas duas antenas (com
// intervalo menor, a mesma passagem dividida em dois ciclos marcava carros normais).
const INTRUDER_MIN_GAP_MS = 60_000;
const INTRUDER_MAX_GAP_MS = 5 * 60_000;
const INTRUDER_CONFIRMATIONS = 3;          // leituras seguidas da intrusa sozinha (o dono saindo)
const READ_GAP_MS = 5_000;
const REGISTRATION_DEDUP_MS = 2 * 60_000;  // mesma passagem dividida em dois ciclos grava uma vez
const REGISTRATION_FLUSH_MS = 3_000;
// RFM_RELEASE_CLOSE_RELAY (0x0077), opção 0x01 "release": solta o relé.
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
// Máscara de leitura (0x0076, fora do manual V1.0; leitura com CFFF00760102AB1B). A antena
// ignora dados de máscara todos zero, como os do FILTER_DATA atual, e mantém os gravados
// pelo configurador (FF FF FF FF): o envio só garante máscara ligada, início 0 e 4 bytes.
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
let connectedThisAttempt = false;    // a tentativa atual chegou a abrir a conexão TCP
let unreachableSince: number | null = null;  // desde quando as tentativas nem conectam
let isRetryConnection = false;       // a conexão atual é a reconexão única após uma queda
let antennaUnrecoverable = false;    // a reconexão também não recebeu nada: aguarda o reinício do container

const RECONNECT_DELAY_MS = 3000;
const UNRECOVERABLE_EXIT_MS = 60000;
// Antena que não aceita conexão está desligada ou ligando (pico de energia): reiniciar
// o container não adianta, então insiste por este tempo antes de sinalizar falha.
const UNREACHABLE_LIMIT_MS = 30000;
// A nova-api aceita o horário da passagem até 10 min atrás; acima disso grava sem ele.
const PASSED_AT_MAX_AGE_MS = 9 * 60_000;

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
  private validatingTags: Set<string> = new Set();
  // Vive enquanto o processo vive: intrusa marcada só deixa de ser no reinício.
  private readonly tracker: PassageTracker;
  private readonly pendingRegistrations = new Set<Promise<unknown>>();

  /**
   * Cria uma instância do gerenciador de antena.
   * @param antenna Configuração da antena a ser gerenciada.
   */
  constructor(antenna: AntennaConfig) {
    this.antenna = antenna;
    this.antennaSocket = new net.Socket();
    this.tracker = new PassageTracker({
      detectionEnabled: process.env.INTRUDER_DETECTION !== 'false',
      intruderMinGapMs: INTRUDER_MIN_GAP_MS,
      intruderMaxGapMs: INTRUDER_MAX_GAP_MS,
      confirmations: INTRUDER_CONFIRMATIONS,
      readGapMs: READ_GAP_MS,
      dedupMs: REGISTRATION_DEDUP_MS,
    });
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
    connectedThisAttempt = false;

    // Reatribui instâncias globais se necessário
    gateController = new GateController({
      relayOpenCmd: RELAY_OPEN_CMD,
      relayCloseCmd: RELAY_CLOSE_CMD,
      socket: client,
      openDurationMs: Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000,
      antennaId: this.antenna.id,
      onCommandSent: () => this.expectResponse(client),
      relayRenewAfterMs: RELAY_RENEW_AFTER_MS,
      onCycleEnd: () => this.finishCycle(),
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
      connectedThisAttempt = true;
      unreachableSince = null;

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
    // Bytes de um quadro que ainda não chegou inteiro (por conexão)
    let pendingBytes: Buffer = Buffer.alloc(0);

    client.on("data", (data) => {

      receivedSinceConnect = true;            // A antena respondeu nesta conexão
      if (responseTimer) {                    // Qualquer byte atende o comando que aguardava resposta
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      healthCheckWaitResponse = false;        // Reseta o estado de espera por resposta do healthcheck
      lastDataTimestamp = Date.now();         // Registra o momento do último dado recebido

      const { frames, discarded, rest } = extractFrames(Buffer.concat([pendingBytes, data]));
      pendingBytes = rest;

      for (const bytes of discarded) {
        logger.warn(`[FRAME] Bytes descartados (fora de quadro ou CRC inválido): ${bytes.toString('hex')}`);
      }
      for (const frame of frames) {
        this.handleFrame(client, frame);
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

      // Antena que nem aceita a conexão (recusada ou sem resposta ao conectar) está
      // desligada ou ligando: tenta de novo a cada 3 s, sem gastar a reconexão única,
      // até UNREACHABLE_LIMIT_MS — uma antena que reinicia num pico de energia leva
      // mais que 3 s para voltar.
      if (!connectedThisAttempt) {
        unreachableSince ??= Date.now();
        if (Date.now() - unreachableSince < UNREACHABLE_LIMIT_MS) {
          logger.warn(`[DISCONNECTED] Antena [${this.antenna.ip}] não aceitou a conexão. Nova tentativa em ${RECONNECT_DELAY_MS}ms`);
          this.scheduleReconnect(RECONNECT_DELAY_MS, isRetryConnection);
          return;
        }
        this.markUnrecoverable();
        return;
      }

      // Uma reconexão recupera a antena que reiniciou (pico de energia). Quando ela
      // conecta e mesmo assim fica muda, insistir não adianta: na crise de 10/10/2026
      // a antena seguiu muda em reconexões a cada poucos segundos, inclusive após o
      // processo reiniciar sozinho, e só voltou com stop/start do container.
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
   * Interpreta um quadro já validado pelo CRC, pelo comando e pelo STATUS.
   * @param client Socket que recebeu o quadro.
   * @param frame Quadro recebido da antena.
   * @returns void.
   */
  private handleFrame(client: net.Socket, frame: AntennaFrame) {
    switch (frame.cmd) {
      // Resposta de HealthCheck
      case AntennaCmd.MODULE_INT:
        logger.debug(`[HEALTHCHECK] Conexão estável, aguardando nova leitura`);
        return;

      // Resposta de comando de configuração de filtro
      case AntennaCmd.MASK:
        if (frame.status === 0) {
          logger.debug("[MASK] Filtro por máscara configurado com sucesso");
        } else {
          logger.error(`[ERROR] Falha ao configurar filtro por máscara (status ${frame.status})`);
          setImmediate(() => client.destroy());
        }
        return;

      // Resposta do relé: Data[0] é a opção do comando (0x01 soltou, 0x02 acionou)
      case AntennaCmd.RELAY:
        if (frame.status !== 0) {
          logger.error(`[ERROR] Antena recusou comando do relé (status ${frame.status}): ${frame.raw.toString('hex')}`);
        } else if (frame.data[0] === 0x01) {
          logger.debug(`[STATE] Portão fechado`);
          logger.counter("CLOSE_GATE");   // Incrementa o contador de abertura de portão
          gateState = GateState.CLOSED;
        } else if (frame.data[0] === 0x02) {
          logger.debug(`[STATE] Portão aberto`);
        }
        return;

      // Leitura de TAG (modo ativo): Data[] = RSSI (2) | antena | canal | tamanho do EPC | EPC.
      // Só EPC de 12 bytes, como sempre: o número da TAG são os 9 últimos dígitos
      // hexadecimais do EPC, com um "0" na frente.
      case AntennaCmd.TAG_READ: {
        const epcLength = frame.data[4];
        if (frame.status !== 0 || epcLength !== 12 || frame.data.length !== 5 + epcLength) {
          logger.debug(`[READ] Quadro de leitura ignorado: ${frame.raw.toString('hex')}`);
          return;
        }
        const tagNumber = "0" + frame.data.subarray(5).toString("hex").slice(-9);
        // RSSI em 0,1 dBm, com sinal: mede se a TAG estava sob a antena ou longe dela
        // (ex.: carro estacionado no alcance da TAG2 sendo lido durante a saída de outro).
        const rssiDbm = frame.data.readInt16BE(0) / 10;
        logger.debug(`[READ] TAG ${tagNumber} (RSSI ${rssiDbm.toFixed(1)} dBm)`);
        this.handleTagRead(tagNumber, this.antenna.name);
        return;
      }

      // Mensagem diferente do esperado
      default:
        logger.debug(`[UNKNOWN] Mensagem desconhecida: ${frame.raw.toString('hex')}`);
    }
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

    unrecoverableExitTimer = setTimeout(async () => {
      logger.issue(`[ERROR] Container não reiniciado em ${UNRECOVERABLE_EXIT_MS}ms. Encerrando processo`);
      await this.waitForRegistrations(REGISTRATION_FLUSH_MS);
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

      // Grava no ERP as passagens do ciclo em andamento; quem encerra o processo
      // aguarda com waitForRegistrations (a v2 já espera SHUTDOWN_DELAY_MS).
      this.finishCycle();
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
      unreachableSince = null;
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
      // A v2 (painel da portaria) não registra nada próprio: sem esta linha, a abertura
      // manual só se distinguia no log por não ter leitura de TAG antes.
      const detail = autoCloseTime !== undefined ? `${Math.round(autoCloseTime / 1000)} s` : options?.keepOpen ? 'manter aberto' : 'tempo padrão';
      logger.info(`[API] Abertura manual (portaria/app): ${detail}`);

      const wasClosed = gateController.getState() !== ControllerGateState.OPEN;
      // Com o ciclo já aberto pelas leituras, o motor pode ter fechado depois da
      // passagem: o pedido da portaria/app sempre envia o comando de abrir.
      const opened = await gateController.openGate(autoCloseTime, { ...options, forcePulse: !wasClosed });
      // Aberto pela portaria/app: há um veículo no laço sem TAG lida, então a
      // intrusa lida neste ciclo é ignorada como se houvesse outra TAG.
      if (wasClosed && opened) {
        this.tracker.startCycle(Date.now(), null);
      }
      return opened;
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
      logger.info('[API] Fechamento manual (portaria/app)');
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
    // Toda leitura entra no ciclo, inclusive de TAG não autorizada: ela também
    // indica um veículo no laço, o que faz a intrusa ser ignorada.
    const readAt = Date.now();
    const decision = this.tracker.onRead(tagNumber, readAt);

    // Número com letras é TAG de outro sistema (pedágio) que passou pela máscara:
    // nenhuma TAG do condomínio tem letra, e a API sempre respondia 400 para elas.
    if (!/^\d+$/.test(tagNumber)) {
      const reason = 'Número fora do padrão do condomínio';
      this.logTagRead(tagNumber, false, undefined, reason);
      this.emitTagRead(tagNumber, false, reason);
      return;
    }

    if (decision.action === 'ignore') {
      logger.debug(`[INTRUSA] TAG ${tagNumber} ignorada: outro veículo no ciclo`);
      return;
    }
    if (decision.action === 'await') {
      logger.debug(`[INTRUSA] TAG ${tagNumber} lida sozinha ${decision.count}/${INTRUDER_CONFIRMATIONS}: aguardando confirmação`);
      return;
    }

    const cachedVerifyData = this.recentAuthorizedTags.get(tagNumber);
    if (cachedVerifyData !== undefined) {
      this.logTagRead(tagNumber, true, cachedVerifyData);
      this.emitTagRead(tagNumber, true);
      this.tracker.setAuthorized(tagNumber, cachedVerifyData, readAt);
      await this.openGateForTag(tagNumber);
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

    // Com os quadros tratados um a um, duas leituras da mesma TAG no mesmo pacote
    // TCP chegam juntas; sem esta trava, a passagem seria validada e registrada duas vezes.
    if (this.validatingTags.has(tagNumber)) {
      return;
    }
    this.validatingTags.add(tagNumber);

    try {
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
        // A gravação no ERP acontece quando o ciclo fecha (finishCycle), com a
        // passagem já confirmada; o portão abre sem esperá-la.
        this.tracker.setAuthorized(tagNumber, result.verifyData, readAt);
        await this.openGateForTag(tagNumber);
      } else {
        this.logTagRead(tagNumber, false, result.verifyData, result.reason);
        this.emitTagRead(tagNumber, false, result.reason);
        logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} não autorizada: ${result.reason}`);
      }
    } finally {
      this.validatingTags.delete(tagNumber);
    }
  }

  /**
   * Abre o portão para uma TAG autorizada. Com o ciclo já aberto, a primeira
   * leitura de uma TAG nova (próximo carro da fila) reenvia o comando de abrir:
   * o motor fecha logo após o carro anterior passar e só reabre com novo comando.
   * @param tagNumber TAG que pediu a abertura.
   * @returns void.
   */
  private async openGateForTag(tagNumber: string): Promise<void> {
    // "Fechando" conta como fechado: o GateController reabre e começa um ciclo novo
    // (o anterior já foi gravado no fechamento).
    const wasClosed = gateController.getState() !== ControllerGateState.OPEN;
    const forcePulse = !wasClosed && this.tracker.claimControl(tagNumber);
    const opened = await gateController.openGate(undefined, { fromTag: true, forcePulse });
    if (wasClosed && opened) {
      this.tracker.startCycle(Date.now(), tagNumber);
    }
  }

  /**
   * Fim do ciclo do portão: marca intrusas novas e grava no ERP as passagens
   * confirmadas, cada uma com o horário da primeira leitura.
   * @returns void.
   */
  private finishCycle(): void {
    const { registrations, skipped, marked } = this.tracker.endCycle(Date.now());

    for (const { tag, gapMs } of marked) {
      logger.warn(`[INTRUSA] TAG ${tag} marcada como intrusa: lida em dois ciclos seguidos, ${Math.round(gapMs / 1000)} s entre as aparições. Ignorada com outro veículo até o serviço reiniciar`);
    }
    for (const { tag, reason } of skipped) {
      logger.debug(`[REGISTER] TAG ${tag} não gravada: ${reason}`);
    }

    const validator = tagValidator;
    if (!validator || registrations.length === 0) {
      return;
    }
    const accessContext = { device: this.antenna.device, direction: this.antenna.direction, antennaName: this.antenna.name };
    for (const { tag, verifyData, passedAt } of registrations) {
      // Ciclo muito longo (carro parado no laço): a nova-api recusaria o horário
      // antigo e a passagem se perderia; sem ele, vale o horário da gravação.
      const tooOld = Date.now() - passedAt.getTime() > PASSED_AT_MAX_AGE_MS;
      if (tooOld) {
        logger.warn(`[REGISTER] TAG ${tag}: passagem de ${passedAt.toISOString()} gravada com o horário atual (ciclo longo demais)`);
      }
      const pending: Promise<unknown> = validator.registerAccess(tag, verifyData, accessContext, tooOld ? undefined : passedAt)
        .catch((error) => logger.error('[AntennaManager] Erro ao gravar passagem', { error, tag }))
        .finally(() => this.pendingRegistrations.delete(pending));
      this.pendingRegistrations.add(pending);
    }
  }

  /**
   * Aguarda as gravações no ERP em andamento, com limite de tempo (desligamento).
   * @param timeoutMs Espera máxima.
   * @returns Promise resolvida quando terminam ou o tempo acaba.
   */
  public async waitForRegistrations(timeoutMs: number): Promise<void> {
    if (this.pendingRegistrations.size === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled([...this.pendingRegistrations]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
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
    // O ERP numera a classificação ("3 INQUILINO"); no log fica só o nome dela.
    const descricao = (verifyData?.DESCRICAO || '').toString().trim().replace(/^\d+\s+/, '');
    // Unidade como apartamento e torre ("123 B"): LOTE é o apartamento, QUADRA a torre.
    const unidade = [verifyData?.LOTE, verifyData?.QUADRA].map((parte) => (parte ?? '').toString().trim()).filter(Boolean).join(' ');
    const status = isAuthorized ? 'AUTORIZADA' : 'NÃO AUTORIZADA';
    const detalhes = [status, nome, descricao, unidade].filter(Boolean).join(', ');
    const motivo = reason ? ` Motivo: ${reason}` : '';

    logger.info(`[TAG] ${tagNumber} ${detalhes}${motivo}`);
  }
}
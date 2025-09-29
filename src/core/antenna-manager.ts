// Importações de módulos essenciais
/**
 * @file antenna-manager.ts
 * @description Gerencia conexão, eventos e integração entre antena RFID, controle de portão e validação de TAGs.
 * @date 28/09/2025
 */

import net from 'net';
import dotenv from 'dotenv';
import logger from '../utils/logger';
import { GateController } from './gate-controller';
import { TagValidator } from './tag-validator';

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

      // Reset de variáveis de estado ao conectar
      healthCheckWaitResponse = false;  //indica que não está esperando resposta do healthcheck
      gateState = GateState.CLOSED;     //estado do portão fechado
      isReconnecting = false;           //indica que não está reconectando

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

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

      const hexData = data.toString("hex");   // Converte os dados recebidos para hexadecimal
      connectionRetry = 0;                    // Reseta o contador de tentativas de conexão
      healthCheckWaitResponse = false;        // Reseta o estado de espera por resposta do healthcheck

      //logger.debug(`Mensagem: ${hexData}`);

      // Resposta de HealthCheck
      if (hexData.startsWith("cf000050")) {
        logger.debug(`[HEALTHCHECK] Conexão estável, aguardando nova leitura`);
        return;
      }

      // Resposta de comando de fechamento
      else if (hexData.startsWith("cf000073")) {
        if (hexData.startsWith("cf000073020001")) {
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
            setImmediate(() => this.antennaSocket.destroy());
          }
        }, 3000);
      });
    });

    // Evento de desconexão do socket
    client.on("close", () => {

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
  public openGate(): boolean {
    if (gateController) {
      gateController.openGate();
      return true;
    }
    return false;
  }

  public closeGate(): boolean {
    if (gateController) {
      gateController.closeGate();
      return true;
    }
    return false;
  }

  /**
   * Função para tratar leitura de TAG usando TagValidator e GateController
   * @param tagNumber Número da TAG lida
   * @param antennaName Nome da antena que leu a TAG
   */
  private async handleTagRead(tagNumber: string, antennaName: string) {
    const result = await tagValidator.validateTag(tagNumber);
    if (result.isValid) {
      logger.info(`[AUTHORIZED] TAG ${tagNumber} autorizada`);
      logger.counter('AUTHORIZED');
      await tagValidator.registerAccess(tagNumber, antennaName);
      gateController.openGate();
    } else {
      logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} não autorizada: ${result.reason}`);
    }
  }
}
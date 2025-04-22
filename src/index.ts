// Importações de módulos essenciais
import net from "net";
import dotenv from "dotenv";
import logger from "./logger";
import axios from "axios";

// Tipagem da configuração da antena
interface AntennaConfig {
  device: number;
  ip: string;
  port: number;
  direction: string;
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

// Inicialização da antena com base no argumento de execução (TAG1 ou TAG2)
const selectedAntenna = process.argv[2];

if (!selectedAntenna || !["TAG1", "TAG2"].includes(selectedAntenna)) {
  logger.error("Antena não especificada. Use 'TAG1' ou 'TAG2' como argumento.");
  process.exit(1);
}

let antenna: AntennaConfig = {
  device: Number(process.env[`ANTENNA${selectedAntenna[3]}_DEVICE`]),
  ip: String(process.env[`ANTENNA${selectedAntenna[3]}_IP`]),
  port: Number(process.env[`ANTENNA${selectedAntenna[3]}_PORT`]),
  direction: String(process.env[`ANTENNA${selectedAntenna[3]}_DIRECTION`]),
};

// Constantes de operação: intervalo de healthcheck, contagem máxima antes de enviar healthcheck,
// e os comandos em buffer para abrir/fechar portão e healthcheck
const HEALTHCHECK_INTERVAL = Number(process.env.HEALTHCHECK_INTERVAL) || 1000;
const HEALTHCHECK_COUNT_LIMIT = Number(process.env.HEALTHCHECK_COUNT_LIMIT) || 30;
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");

// Variáveis de controle do estado da aplicação
const lastTags = new Set<string>();
let healthCheckWaitResponse = false;
let healthCheckCounter = 0;
let gateState: GateState = GateState.CLOSED;
let tagCloseTimer: NodeJS.Timeout | null = null;
let isReconnecting = false;
let socketInstance: net.Socket;
let connectionRetry = 0;
let isShuttingDown = false;

// Função principal que conecta à antena e gerencia eventos de comunicação TCP
function connectToAntenna(antenna: AntennaConfig) {
  const client = new net.Socket();
  socketInstance = client;

  // Evento da conexão do socket
  client.connect(antenna.port, antenna.ip, () => {
    // Reset de variáveis de estado ao conectar
    lastTags.clear();
    healthCheckWaitResponse = false;
    healthCheckCounter = 0;
    gateState = GateState.CLOSED;

    if (tagCloseTimer) {
      clearTimeout(tagCloseTimer);
      tagCloseTimer = null;
    }

    socketInstance.setTimeout(HEALTHCHECK_INTERVAL);
    logger.info(`[CONNECTED] Antena RFID [IP: ${antenna.ip}]`);

    sendCommand(RELAY_CLOSE_CMD);
    logger.warn(`[SYNC] Reset interno realizado e comando de fechamento enviado`);
  });

  // Evento ao receber dados do socket
  client.on("data", async (data) => {
    const hexData = data.toString("hex");
    healthCheckCounter = 0;
    connectionRetry = 0;

    // Resposta de HealthCheck
    if (hexData.startsWith("cf000050")) {
      logger.debug(`[HEALTHCHECK] Resposta da antena [${antenna.ip}]. Conexão estável.`);
      healthCheckWaitResponse = false;
      return;
    }

    // Leitura de TAG detectada
    if (hexData.startsWith("cf00000112")) {
      const tagNumber = "0" + hexData.slice(-13, -4);

      if (lastTags.has(tagNumber)) {
        logger.debug(`[AUTHORIZED] TAG ${tagNumber} já validada.`);
        openGate(tagNumber);
      } else {
        logger.info(`[READ] TAG ${tagNumber}`);
        validateTag(tagNumber);
      }
    }
  });

  // Evento de inatividade (timeout) no socket
  client.on("timeout", () => {
    if (gateState === GateState.OPEN) {
      sendCommand(RELAY_CLOSE_CMD, () => {
        lastTags.clear();
        gateState = GateState.CLOSED;
        logger.debug(`[COMMAND] Fechando portão`);
      });
      return;
    }

    if (healthCheckWaitResponse) {
      logger.error(`[TIMEOUT] Sem resposta ao HealthCheck. Reiniciando conexão com ${antenna.ip}`);
      connectionRetry++;
      setImmediate(() => socketInstance.destroy());
      return;
    }

    if (healthCheckCounter >= HEALTHCHECK_COUNT_LIMIT) {
      sendCommand(HEALTHCHECK_CMD, () => {
        healthCheckWaitResponse = true;
        logger.warn(`[TIMEOUT] Inatividade detectada. HealthCheck enviado`);
      });
    } else {
      healthCheckCounter++;
    }
  });

  // Evento de desconexão do socket
  client.on("close", () => {
    if (!isReconnecting) {
      logger.warn(`[DISCONNECTED] Antena [${antenna.ip}]. Tentando reconectar...`);
      isReconnecting = true;

      if (connectionRetry >= 10) {
        logger.error("[FATAL] Excedido o número de tentativas de reconexão");
        process.exit(1);
      }

      setTimeout(() => {
        isReconnecting = false;
        connectToAntenna(antenna);
      }, 5000);
    }
  });

  // Evento de erro no socket
  client.on("error", (err) => {
    if (!socketInstance.destroyed) {
      logger.error(`[ERROR] Antena [${antenna.ip}]: ${err.message}`);
      socketInstance.destroy();
    }
  });
}

// Envia um comando via socket com tratamento de erro e callback opcional
function sendCommand(cmd: Buffer, onSuccess?: () => void) {
  socketInstance.write(cmd, (err) => {
    if (err) {
      logger.error(`[ERROR] Falha ao enviar comando: ${err.message}`);
      socketInstance.destroy();
    } else {
      onSuccess?.();
    }
  });
}

// Valida a TAG via API externa e registra o acesso em caso de autorização
async function validateTag(tagNumber: string) {
  try {
    const validateData = {
      id: tagNumber,
      dispositivo: antenna.device,
      foto: null,
      sentido: antenna.direction,
    };

    const response = await axios.post("http://localhost:3000/access/verify", validateData);
    if (response.data.status !== "success") {
      logger.error(`[ERROR] Falha ao consultar TAG ${tagNumber}`);
      return;
    }

    const responseData = response.data.data;
    if (responseData.PERMITIDO.trim() !== "S") {
      logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} sem permissão`);
      return;
    }

    lastTags.add(tagNumber);
    logger.metric("LAST_TAG_READED", tagNumber);

    if (lastTags.size > 3) {
      const oldest = Array.from(lastTags)[0];
      lastTags.delete(oldest);
    }

    openGate(tagNumber);

    const registerData = {
      dispositivo: antenna.device,
      pessoa: responseData.SEQPESSOA,
      classificacao: responseData.SEQCLASSIFICACAO,
      classAutorizado: responseData.CLASSIFAUTORIZADA.trim(),
      autorizacaoLanc: responseData.AUTORIZACAOLANC.trim(),
      origem: responseData.TIPO.trim(),
      seqIdAcesso: responseData.SEQIDACESSO,
      sentido: antenna.direction.trim(),
      quadra: responseData.QUADRA.trim(),
      lote: responseData.LOTE.trim(),
      panico: responseData.PANICO.trim(),
      formaAcesso: responseData.MIDIA.trim(),
      idAcesso: responseData.IDENT.trim(),
      seqVeiculo: responseData.SEQVEICULO,
    };

    const regResponse = await axios.post("http://localhost:3000/access/register", registerData);
    if (regResponse.data.status !== "success") {
      logger.error(`[ERROR] Falha ao registrar acesso - TAG ${tagNumber}`);
    } else {
      const timestamp = new Date().toTimeString().split(" ")[0];
      const sentido = antenna.direction === "S" ? "Saída" : "Entrada";
      logger.info(`[REGISTER] ID:${responseData.IDENT.trim()} ${responseData.MIDIA.trim()}, ${responseData.NOME.trim()}, ${responseData.DESCRICAO.trim()}, ${sentido} (${timestamp})`);
    }
  } catch (error) {
    logger.error(`[ERROR] Comunicação com API: ${error}`);
  }
}

// Comando de abertura do portão, respeitando o estado atual
function openGate(tagNumber: string) {
  if (gateState === GateState.CLOSED) {
    sendCommand(RELAY_OPEN_CMD, () => {
      gateState = GateState.OPEN;
      logger.debug(`[COMMAND] Abrindo portão - TAG ${tagNumber}`);
    });
  } else {
    logger.debug(`[STATE] Portão aberto`);
  }
}

// Finaliza aplicação de forma segura
function shutdown() {
  if (!isShuttingDown) {
    isShuttingDown = true;
    logger.info("[SHUTDOWN] Encerrando aplicação...");
    socketInstance?.destroy();
    process.exit(1);
  }
}

// Inicia a conexão com a antena no momento da execução
connectToAntenna(antenna);

// Finaliza a aplicação com limpeza adequada do socket
process.on("SIGINT", () => shutdown());


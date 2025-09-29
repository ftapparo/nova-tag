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
//const selectedAntenna = "TAG1";

if (!selectedAntenna || !["TAG1", "TAG2"].includes(selectedAntenna)) {
  logger.issue("Antena não especificada. Use 'TAG1' ou 'TAG2' como argumento.");
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
const HEALTHCHECK_TIMEOUT = Number(process.env.HEALTHCHECK_TIMEOUT) || 10000;
const GATE_TIMEOUT_TO_CLOSE = Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 5000;
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const FILTER_CMD = Buffer.from(String(process.env.FILTER_DATA) || "", "hex");

// Variáveis de controle do estado da aplicação
const lastTags = new Set<string>();
let healthCheckWaitResponse = false;
let gateState: GateState = GateState.CLOSED;
let closeGateTimeout: NodeJS.Timeout | null = null;
let socketInstance: net.Socket;
let isReconnecting = false;
let isShuttingDown = false;
let connectionRetry = 0;

// Função principal que conecta à antena e gerencia eventos de comunicação TCP
function connectToAntenna(antenna: AntennaConfig) {
  const client = new net.Socket();
  socketInstance = client;

  // Evento da conexão do socket
  client.connect(antenna.port, antenna.ip, () => {

    // Reset de variáveis de estado ao conectar
    lastTags.clear();                 //limpa todas as tags lidas
    healthCheckWaitResponse = false;  //indica que não está esperando resposta do healthcheck
    gateState = GateState.CLOSED;     //estado do portão fechado
    isReconnecting = false;           //indica que não está reconectando

    if (closeGateTimeout) {
      clearTimeout(closeGateTimeout);
      closeGateTimeout = null;
    }

    socketInstance.setTimeout(HEALTHCHECK_TIMEOUT);
    logger.info(`[CONNECTED] Antena RFID [IP: ${antenna.ip}]`);
    logger.debug(`[HEALTHCHECK] Timeout de conexão ${HEALTHCHECK_TIMEOUT}ms`);

    sendCommand(RELAY_CLOSE_CMD, () => {
      logger.debug(`[SYNC] Reset interno realizado e comando de fechamento enviado`);
    
      setTimeout(() => {
        logger.debug(`[MASK] Configurando filtro  - ${FILTER_CMD.toString('hex').toUpperCase()}`);
        sendCommand(FILTER_CMD);
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
        setImmediate(() => socketInstance.destroy());
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

      if (lastTags.has(tagNumber)) {
        logger.info(`[AUTHORIZED] TAG ${tagNumber} autorizada`);
        openGate();      // Abre o portão se a TAG já foi validada
        return;
      } else {
        validateTag(tagNumber);   // Valida a TAG via API externa
        return;
      }
    }

    // Mensagem diferete do esperado
    else {
      //logger.debug(`[UNKNOWN] Mensagem desconhecida: ${hexData}`);
    }
  });

  // Evento de inatividade (timeout) no socket
  client.on("timeout", () => {

    if(gateState === GateState.OPEN) {
      logger.debug(`[TIMEOUT] Portão travado aberto. Reiniciando conexão.`);
      setImmediate(() => socketInstance.destroy());
      return;
    }

    if (healthCheckWaitResponse ) {
      logger.error(`[TIMEOUT] Antena ${antenna.ip} não respondeu ao HealthCheck. Reiniciando conexão.`);
      setImmediate(() => socketInstance.destroy());
      return;
    }

    sendCommand(HEALTHCHECK_CMD, () => {
      healthCheckWaitResponse = true;
      logger.warn(`[TIMEOUT] Inatividade detectada. HealthCheck enviado`);

      // Timeout adicional para aguardar resposta do healthcheck
      setTimeout(() => {
        if (healthCheckWaitResponse) {
          logger.issue(`[ERROR] A dispositivo excedeu o tempo de resposta`);
          setImmediate(() => socketInstance.destroy());
        }
      }, 3000);
    });
  });

  // Evento de desconexão do socket
  client.on("close", () => {

    if (connectionRetry >= 10) {
      logger.issue("[ERROR] Excedido o número de tentativas de reconexão");
      process.exit(1);
    }

    if (!isReconnecting) {
      logger.warn(`[DISCONNECTED] Antena [${antenna.ip}]. Tentando reconectar...`);
      isReconnecting = true;

      if (closeGateTimeout) {
        clearTimeout(closeGateTimeout);
        closeGateTimeout = null;
      }

      connectionRetry++;
      setTimeout(() => { connectToAntenna(antenna) }, 3000);
    }
  });

  // Evento de erro no socket
  client.on("error", (err) => {
    if (!socketInstance.destroyed) {
      logger.issue(`[ERROR] Antena [${antenna.ip}]: ${err.message}`);
      socketInstance.destroy();
    }
  });
}

// Envia um comando via socket com tratamento de erro e callback opcional
function sendCommand(cmd: Buffer, onSuccess?: () => void) {
  socketInstance.write(cmd, (err) => {
    if (err) {
      logger.issue(`[ERROR] Falha ao enviar comando: ${err.message}`);
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
      logger.issue(`[ERROR] Falha ao consultar TAG ${tagNumber}`);
      return;
    }

    const responseData = response.data.data;
    if (responseData.PERMITIDO.trim() !== "S") {
      logger.warn(`[UNAUTHORIZED] TAG ${tagNumber} não autorizada`);
      return;
    }

    logger.info(`[AUTHORIZED] TAG ${tagNumber} autorizada`);

    lastTags.add(tagNumber);
    logger.counter("AUTHORIZED"); // Incrementa o contador de tags autorizadas

    if (lastTags.size > 3) {
      const oldest = Array.from(lastTags)[0];
      lastTags.delete(oldest);
    }

    openGate();

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
      logger.issue(`[ERROR] Falha ao registrar acesso - TAG ${tagNumber}`);
    } else {
      const timestamp = new Date().toTimeString().split(" ")[0];
      const sentido = antenna.direction === "S" ? "Saída" : "Entrada";
      logger.info(`[REGISTER] ID:${responseData.IDENT.trim()} ${responseData.MIDIA.trim()}, ${responseData.NOME.trim()}, ${responseData.DESCRICAO.trim()}, ${sentido} (${timestamp})`);
    }
  } catch (error) {
    logger.issue(`[ERROR] Comunicação com API: ${error}`);
  }
}

// Comando de abertura do portão, respeitando o estado atual
function openGate() {
  if (gateState === GateState.CLOSED) {
    sendCommand(RELAY_OPEN_CMD, () => {
      logger.debug(`[COMMAND] Abrindo portão`);
      logger.counter("OPEN_GATE");   // Incrementa o contador de abertura de portão
      gateState = GateState.OPEN;
      resetCloseTimer();
    });
  } else {
    logger.debug(`[STATE] Portão aberto`);
    resetCloseTimer();
  }
}

// Reseta o timer de fechamento do portão, se necessário
function resetCloseTimer() {
  if (gateState === GateState.OPEN) {

    if (closeGateTimeout) clearTimeout(closeGateTimeout);

    closeGateTimeout = setTimeout(() => {

        sendCommand(RELAY_CLOSE_CMD, () => {
          gateState = GateState.CLOSING;
          logger.debug(`[COMMAND] Fechando portão`);          
        });

    }, GATE_TIMEOUT_TO_CLOSE);
  }
}

// Finaliza aplicação de forma segura
function shutdown() {
  if (!isShuttingDown) {
    isShuttingDown = true;
    logger.issue("[SHUTDOWN] Encerrando aplicação...");
    socketInstance?.destroy();

    if (closeGateTimeout) {
      clearTimeout(closeGateTimeout);
      closeGateTimeout = null;
    }

    process.exit(1);
  }
}

// Inicia a conexão com a antena no momento da execução
connectToAntenna(antenna);

// Finaliza a aplicação com limpeza adequada do socket
process.on("SIGINT", () => shutdown());


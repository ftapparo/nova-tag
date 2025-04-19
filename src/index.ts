import net from "net";
import dotenv from "dotenv";
import logger from "./logger";
import axios from "axios";

interface AntennaConfig {
  device: number;
  ip: string;
  port: number;
  direction: string;
}

enum GateState {
  CLOSED,
  OPENING,
  OPEN,
  CLOSING,
}


dotenv.config();

// Define qual antena será utilizada (TAG1 ou TAG2)
const selectedAntenna = process.argv[2];

if (!selectedAntenna || (selectedAntenna !== "TAG1" && selectedAntenna !== "TAG2")) {
  logger.error("Antena não especificada. Use 'TAG1' ou 'TAG2' como argumento.");
  process.exit(1);
}

let antenna: AntennaConfig;

if (selectedAntenna === "TAG1") {
  antenna = {
    device: Number(process.env.ANTENNA1_DEVICE),
    ip: String(process.env.ANTENNA1_IP),
    port: Number(process.env.ANTENNA1_PORT),
    direction: String(process.env.ANTENNA1_DIRECTION),
  };
} else {
  antenna = {
    device: Number(process.env.ANTENNA2_DEVICE),
    ip: String(process.env.ANTENNA2_IP),
    port: Number(process.env.ANTENNA2_PORT),
    direction: String(process.env.ANTENNA2_DIRECTION),
  };
}

// Constantes
const HEALTHCHECK_INTERVAL = Number(process.env.HEALTHCHECK_INTERVAL) || 10000;
const GATE_TIMEOUT_TO_CLOSE= Number(process.env.GATE_TIMEOUT_TO_CLOSE) || 6000;

// Buffers de comandos
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");

// Variáveis de controle
let lastTags: string[] = [];   
let waitHealthCheckResponse = false;
let gateState: GateState = GateState.CLOSED;
let tagCloseTimer: NodeJS.Timeout | null = null;

function connectToAntenna(antenna: AntennaConfig) {
  const client = new net.Socket();

  client.connect(antenna.port, antenna.ip, () => {

    // Reinicia todas as variáveis de controle
    lastTags = [];
    waitHealthCheckResponse = false;
    gateState = GateState.CLOSED;

    if (tagCloseTimer) {
      clearTimeout(tagCloseTimer);
      tagCloseTimer = null;
    }

    client.setTimeout(HEALTHCHECK_INTERVAL);

    logger.info(`[CONNECTED] Antena RFID [IP: ${antenna.ip}]`);

    // Força sincronização com o hardware
    client.write(RELAY_CLOSE_CMD);
    logger.warn(`[SYNC] Reset interno realizado e comando de fechamento enviado`);
  });

  client.on("data", async (data) => {
    const hexData = data.toString("hex");

    // Resposta ao healthcheck
    if (hexData.startsWith("cf000050")) {
      logger.debug(`[HEALTHCHECK] Resposta da antena [${antenna.ip}]. Conexão estável.`);
      waitHealthCheckResponse = false;
      return;
    }

    // Leitura de TAG válida
    if (hexData.startsWith("cf00000112")) {
      const tagNumber = "0" + hexData.slice(-13, -4);

      // Ignora se a TAG já foi tratada recentemente
      if (lastTags.includes(tagNumber)) {
        logger.debug(`[AUTHORIZED] TAG ${tagNumber} já validada.`);
        openGate(client, tagNumber);
        return;
      }
      else { 
        logger.info(`[READ] TAG ${tagNumber}`);
        validateTag(client, tagNumber);
        return;
      }
    }
  });

  client.on("timeout", () => {
    if (waitHealthCheckResponse) {
      logger.error(`[TIMEOUT] Antena ${antenna.ip} não respondeu ao HealthCheck. Reiniciando conexão.`);
      client.destroy();
      return;
    }

    logger.warn(`[TIMEOUT] Inatividade detectada. Enviando HealthCheck para ${antenna.ip}`);
    try {
      waitHealthCheckResponse = true;
      client.write(HEALTHCHECK_CMD);

      // Timeout adicional para aguardar resposta do healthcheck
      setTimeout(() => {
        if (waitHealthCheckResponse) {
          logger.error(`[ERROR] Sem resposta ao HealthCheck. Reiniciando conexão com ${antenna.ip}`);
          client.destroy();
        }
      }, 3000);
    } catch (e) {
      logger.error(`[ERROR] Falha ao enviar HealthCheck: ${e}`);
      client.destroy();
    }
  });

  client.on("close", () => {
    waitHealthCheckResponse = false;
    logger.warn(`[DISCONNECTED] Antena [${antenna.ip}]. Tentando reconectar...`);
    setTimeout(() => connectToAntenna(antenna), 3000);
  });

  client.on("error", (err) => {
    logger.error(`[ERROR] Antena [${antenna.ip}]: ${err.message}`);
    client.destroy();
  });
}

// Validação da TAG via API
async function validateTag(client: net.Socket, tagNumber: string) {

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

    // Atualiza lista das últimas TAGs lidas
    lastTags.unshift(tagNumber);
    if (lastTags.length > 3) lastTags.pop();

    openGate(client, tagNumber);

    // Registro do acesso
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
      logger.info(`[REGISTER] ID:${responseData.IDENT.trim()} ${responseData.MIDIA.trim()}, ${responseData.NOME.trim()}, ${responseData.DESCRICAO.trim()}, ${sentido} (${timestamp}), acesso registrado`);
    }
  } catch (error) {
    logger.error(`[ERROR] Comunicação com API: ${error}`);
  }
}

// Abre o portão e fecha após 2 segundos
function openGate(client: net.Socket, tagNumber: string) {
  if (gateState === GateState.CLOSED ){
    logger.debug(`[COMMAND] Abrindo portão - TAG ${tagNumber}`);
    client.write(RELAY_OPEN_CMD);
    gateState = GateState.OPEN;
  }
  else {
    logger.debug(`[STATE] Portão aberto`);
  }
  resetCloseTimer(client, tagNumber);
}

function resetCloseTimer(client: net.Socket, tagNumber: string) {
  if (gateState === GateState.OPEN){
    
    if (tagCloseTimer) clearTimeout(tagCloseTimer);
  
    tagCloseTimer = setTimeout(() => {
      logger.debug(`[COMMAND] Comando de fechamento - TAG ${tagNumber}`);
      client.write(RELAY_CLOSE_CMD);
  
      gateState = GateState.CLOSED;
      logger.debug(`[STATE] Portão fechando`);
  
      tagCloseTimer = null;
  
    }, GATE_TIMEOUT_TO_CLOSE);
  }
}


// Inicia conexão com a antena
connectToAntenna(antenna);

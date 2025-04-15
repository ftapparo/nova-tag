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
const HEALTHCHECK_TIMEOUT = Number(process.env.HEALTHCHECK_INTERVAL) || 10000;
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const HEALTHCHECK_CMD = Buffer.from("CFFF0050000726", "hex");

// Variáveis de controle
let lastTags: string[] = []; // Armazena as 3 últimas TAGs lidas
let isRelayBusy = false;     // Evita reabrir o portão durante o ciclo
let waitHealthCheckResponse = false; // Controla se está aguardando resposta do healthcheck

function connectToAntenna(antenna: AntennaConfig) {
  const client = new net.Socket();

  client.connect(antenna.port, antenna.ip, () => {
    waitHealthCheckResponse = false;
    client.setTimeout(HEALTHCHECK_TIMEOUT);
    logger.info(`[CONECTADA] Antena RFID [IP: ${antenna.ip}]`);
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
      logger.info(`[LEITURA] TAG ${tagNumber} detectada pela antena [${antenna.ip}]`);

      // Ignora se a TAG já foi tratada recentemente
      if (lastTags.includes(tagNumber)) {
        if (isRelayBusy) return;
        logger.debug(`[INFO] TAG ${tagNumber} já validada recentemente. Abrindo portão.`);
        openGate(client, tagNumber);
        return;
      }

      try {
        // Validação da TAG via API
        const validateData = {
          id: tagNumber,
          dispositivo: antenna.device,
          foto: null,
          sentido: antenna.direction,
        };

        const response = await axios.post("http://localhost:3000/access/verify", validateData);
        if (response.data.status !== "success") {
          logger.error(`[ERRO] Falha ao consultar acesso da TAG ${tagNumber}`);
          return;
        }

        const responseData = response.data.data;
        if (responseData.PERMITIDO.trim() !== "S") {
          logger.warn(`[NÃO AUTORIZADA] TAG ${tagNumber} sem permissão de acesso.`);
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
          logger.error(`[ERRO] Falha ao registrar acesso da TAG ${tagNumber}`);
        } else {
          const timestamp = new Date().toTimeString().split(" ")[0];
          const sentido = antenna.direction === "S" ? "Saída" : "Entrada";
          logger.info(`[REGISTRO] ID:${responseData.IDENT.trim()} ${responseData.MIDIA.trim()}, ${responseData.NOME.trim()}, ${responseData.DESCRICAO.trim()}, ${sentido} (${timestamp}), acesso registrado`);
        }
      } catch (error) {
        logger.error(`[ERRO] Comunicação com API: ${error}`);
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
          logger.error(`[ERRO] Sem resposta ao HealthCheck. Reiniciando conexão com ${antenna.ip}`);
          client.destroy();
        }
      }, 3000);
    } catch (e) {
      logger.error(`[ERRO] Falha ao enviar HealthCheck: ${e}`);
      client.destroy();
    }
  });

  client.on("close", () => {
    waitHealthCheckResponse = false;
    logger.warn(`[DESCONECTADA] Antena [${antenna.ip}]. Tentando reconectar...`);
    setTimeout(() => connectToAntenna(antenna), 3000);
  });

  client.on("error", (err) => {
    logger.error(`[ERRO] Antena [${antenna.ip}]: ${err.message}`);
    client.destroy();
  });
}

// Abre o portão e fecha após 2 segundos
function openGate(client: net.Socket, tagNumber: string) {
  if (isRelayBusy) return;

  isRelayBusy = true;

  logger.debug(`[COMANDO] Abrindo portão - TAG ${tagNumber}`);
  client.write(RELAY_OPEN_CMD);

  setTimeout(() => {
    logger.debug(`[COMANDO] Fechando portão - TAG ${tagNumber}`);
    client.write(RELAY_CLOSE_CMD);
    isRelayBusy = false;
  }, 2000);
}

// Inicia conexão com a antena
connectToAntenna(antenna);

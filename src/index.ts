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

const ANTENNAS: AntennaConfig[] = [
    {
        device: Number(process.env.ANTENNA1_DEVICE),
        ip: String(process.env.ANTENNA1_IP),
        port: Number(process.env.ANTENNA1_PORT),
        direction: String(process.env.ANTENNA1_DIRECTION)
    },
    {
        device: Number(process.env.ANTENNA2_DEVICE),
        ip: String(process.env.ANTENNA2_IP),
        port: Number(process.env.ANTENNA2_PORT),
        direction: String(process.env.ANTENNA2_DIRECTION)
    }
];

const HEALTHCHECK_INTERVAL = Number(process.env.HEALTHCHECK_INTERVAL) || 10000; // 10s padrão
const HEALTHCHECK_TIMEOUT = HEALTHCHECK_INTERVAL * 10; // Se não houver resposta em 30s, reinicia a conexão
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const HEALTHCHECK_CMD = Buffer.from("CFFF00720017A5", "hex");

const lastTagPerAntenna: Record<string, string | null> = {};
const lastValidatedTags: Record<string, any> = {};
const isRelayBusy: Record<string, boolean> = {};
const healthCheckTimers: Record<string, NodeJS.Timeout | null> = {};
const healthCheckIntervals: Record<string, number> = {};
const activeClients: Record<string, net.Socket | null> = {};

function connectToAntenna(antenna: AntennaConfig) {
    const client = new net.Socket();
    const antennaKey = `${antenna.device}`;

    lastTagPerAntenna[antennaKey] = null;
    lastValidatedTags[antennaKey] = null;
    isRelayBusy[antennaKey] = false;
    healthCheckTimers[antennaKey] = null;
    healthCheckIntervals[antennaKey] = HEALTHCHECK_INTERVAL;
    activeClients[antennaKey] = client;

    client.connect(antenna.port, antenna.ip, () => {
        logger.info(`[CONNECTED] Antena RFID [IP: ${antenna.ip} | Porta: ${antenna.port} | Dispositivo: ${antenna.device}]`);
        scheduleHealthCheck(client, antenna);
    });

    client.on("data", async (data) => {
        const hexData = data.toString("hex");

        if (hexData.startsWith("cf000072")) {
            logger.debug(`[HEALTHCHECK] Resposta da antena [${antenna.ip}]. Conexão estável.`);
            resetHealthCheckTimer(client, antennaKey);
            return;
        }

        if (hexData.startsWith("cf00000112")) {
            const tagNumber = "0" + hexData.slice(-13, -4);
            logger.info(`[READ] TAG ${tagNumber} na antena [${antenna.ip}]`);

            if (isRelayBusy[antennaKey]) return;

            if (tagNumber === lastTagPerAntenna[antennaKey]) {
                logger.debug(`[INFO] TAG ${tagNumber} já validada. Apenas abrindo portão.`);
                openGate(client, antennaKey, tagNumber);
                return;
            }

            try {
                const validateData = { id: tagNumber, dispositivo: antenna.device, foto: null, sentido: antenna.direction };
                const response = await axios.post("http://localhost:3000/access/verify", validateData);

                if (response.data.status !== "success") {
                    logger.error(`[ERROR] Falha ao consultar acesso da TAG ${tagNumber}`);
                    return;
                }

                const responseData = response.data.data;
                if (responseData.PERMITIDO.trim() !== "S") {
                    logger.warn(`[AUTH] TAG ${tagNumber} não tem permissão de acesso.`);
                    return;
                }

                lastTagPerAntenna[antennaKey] = tagNumber;
                lastValidatedTags[antennaKey] = responseData;

                openGate(client, antennaKey, tagNumber);

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
                    seqVeiculo: responseData.SEQVEICULO
                };

                const regResponse = await axios.post("http://localhost:3000/access/register", registerData);

                if (regResponse.data.status !== "success") {
                    logger.error(`[ERROR] Falha ao registrar acesso da TAG ${tagNumber}`);
                } else {
                    const timestamp = new Date().toTimeString().split(" ")[0];
                    const direction = antenna.direction === "S" ? "Saída" : "Entrada";
                    logger.info(`[REGISTER] ID:${responseData.IDENT.trim()} ${responseData.MIDIA.trim()}, ${responseData.NOME.trim()}, ${responseData.DESCRICAO.trim()}, ${direction} (${timestamp}), Acesso gravado`);
                }
            } catch (error) {
                logger.error(`[ERROR] Comunicação com API: ${error}`);
            }
        }
    });

    client.on("close", () => {
        logger.warn(`[DISCONNECTED] Antena [${antenna.ip}] desconectada. Tentando reconectar...`);
        setTimeout(() => connectToAntenna(antenna), 3000);
    });

    client.on("error", (err) => {
        logger.error(`[ERROR] Antena [${antenna.ip}]: ${err.message}`);
        client.destroy();
    });
}

function scheduleHealthCheck(client: net.Socket, antenna: AntennaConfig) {
    const antennaKey = `${antenna.device}`;

    if (!activeClients[antennaKey] || activeClients[antennaKey] !== client) return;

    logger.debug(`[HEALTHCHECK] Enviando para antena [${antenna.ip}]`);
    client.write(HEALTHCHECK_CMD);

    healthCheckTimers[antennaKey] = setTimeout(() => {
        logger.error(`[ERROR] Antena ${antenna.ip} não respondeu ao HealthCheck. Reiniciando conexão.`);
        if (activeClients[antennaKey] === client) {
            client.destroy();
        }
    }, HEALTHCHECK_TIMEOUT);

    setTimeout(() => {
        if (activeClients[antennaKey] === client) {
            scheduleHealthCheck(client, antenna);
        }
    }, HEALTHCHECK_INTERVAL);
}

function resetHealthCheckTimer(client: net.Socket, antennaKey: string) {
    if (healthCheckTimers[antennaKey]) {
        clearTimeout(healthCheckTimers[antennaKey]!);
    }
}

function openGate(client: net.Socket, antennaKey: string, tagNumber: string) {
    if (isRelayBusy[antennaKey]) return;

    isRelayBusy[antennaKey] = true;
    healthCheckIntervals[antennaKey] = HEALTHCHECK_INTERVAL * 5;

    logger.debug(`[COMMAND] Abrindo portão para TAG ${tagNumber}`);
    client.write(RELAY_OPEN_CMD);

    setTimeout(() => {
        logger.debug(`[COMMAND] Fechando portão para TAG ${tagNumber}`);
        client.write(RELAY_CLOSE_CMD);
        isRelayBusy[antennaKey] = false;
        healthCheckIntervals[antennaKey] = HEALTHCHECK_INTERVAL;
    }, 2000);
}

ANTENNAS.forEach((antenna) => connectToAntenna(antenna));

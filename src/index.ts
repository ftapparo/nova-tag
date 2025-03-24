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

const HEALTHCHECK_INTERVAL = Number(process.env.HEALTHCHECK_INTERVAL) || 1000;
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex");
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex");
const HEALTHCHECK_CMD = Buffer.from("CFFF00720017A5", "hex");

const lastTagPerAntenna: Record<string, string | null> = {};
const isRelayBusy: Record<string, boolean> = {};

function connectToAntenna(antenna: AntennaConfig) {
    const client = new net.Socket();
    const antennaKey = `${antenna.device}`;
    lastTagPerAntenna[antennaKey] = null;
    isRelayBusy[antennaKey] = false;

    // Conecta à antena
    client.connect(antenna.port, antenna.ip, () => {
        logger.info(`[CONNECTED] Antena RFID [IP: ${antenna.ip} | Porta: ${antenna.port} | Dispositivo: ${antenna.device}]`);
        setInterval(() => {
            client.write(HEALTHCHECK_CMD);
            logger.debug(`[HEALTHCHECK] Solicitado [IP: ${antenna.ip}]`);
        }, HEALTHCHECK_INTERVAL);
    });

    // Recebe dados da antena
    client.on("data", async (data) => {
        const hexData = data.toString("hex");
        logger.debug(`[RECEIVED] [${antenna.ip}] -> ${hexData}`);

        if (hexData.startsWith("cf000072")) {
            logger.debug(`[HEALTHCHECK] Recebido [IP: ${antenna.ip} | Status OK]`);
        }

        if (hexData.startsWith("cf00000112")) {
            const tagNumber = "0" + hexData.slice(-13, -4);
            logger.info(`[READ] TAG ${tagNumber} na antena [IP: ${antenna.ip} | Dispositivo: ${antenna.device}]`);

            if (isRelayBusy[antennaKey]) {
                logger.debug(`[READ] TAG ${tagNumber} ignorada pois o portão ainda está aberto.`);
                return;
            }

            if (tagNumber === lastTagPerAntenna[antennaKey]) {
                logger.debug(`[READ] TAG ${tagNumber} já lida nesta antena. Não registrar novamente.`);
                return;
            }

            const validateData = {
                id: tagNumber,
                dispositivo: antenna.device,
                foto: null,
                sentido: antenna.direction
            };

            try {
                const response = await axios.post("http://localhost:3000/access/verify", validateData);
                if (response.data.status !== "success") {
                    logger.error(`[ERROR] Falha ao consultar acesso da TAG ${tagNumber}`);
                    return;
                }

                const responseData = response.data.data;
                if (responseData.PERMITIDO !== "S") {
                    logger.warn(`[AUTH] TAG ${tagNumber} não tem permissão de acesso.`);
                    return;
                }

                logger.debug(`[COMMAND] Abrindo portão para TAG ${tagNumber}`);
                client.write(RELAY_OPEN_CMD);
                isRelayBusy[antennaKey] = true;

                setTimeout(() => {
                    logger.debug(`[COMMAND] Fechando o portão para TAG ${tagNumber}`);
                    client.write(RELAY_CLOSE_CMD);
                    isRelayBusy[antennaKey] = false;
                }, 2000);

                // Atualiza última tag lida por esta antena
                lastTagPerAntenna[antennaKey] = tagNumber;

                // Dados para registro
                const registerData = {
                    dispositivo: antenna.device,
                    pessoa: responseData.SEQPESSOA,
                    classificacao: responseData.SEQCLASSIFICACAO,
                    classAutorizado: responseData.CLASSIFAUTORIZADA,
                    autorizacaoLanc: responseData.AUTORIZACAOLANC,
                    origem: responseData.TIPO,
                    seqIdAcesso: responseData.SEQIDACESSO,
                    sentido: antenna.direction,
                    quadra: responseData.QUADRA,
                    lote: responseData.LOTE,
                    panico: responseData.PANICO,
                    formaAcesso: responseData.MIDIA,
                    idAcesso: responseData.IDENT,
                    seqVeiculo: responseData.SEQVEICULO
                };

                const regResponse = await axios.post("http://localhost:3000/access/register", registerData);

                if (regResponse.data.status !== "success") {
                    logger.error(`[ERROR] Falha ao registrar acesso da TAG ${tagNumber}`);
                } else {
                    const timestamp = new Date().toTimeString().split(" ")[0];
                    const direction = antenna.direction === "S" ? "Saída" : "Entrada";
                    logger.info(`[REGISTER] ID:${responseData.IDENT.trin()} ${responseData.MIDIA.trin()}, ${responseData.NOME.trin()}, ${responseData.DESCRICAO.trin()}, ${direction} (${timestamp}), Acesso gravado`);
                }
            } catch (error) {
                logger.error(`[ERROR] Comunicação com API: ${error}`);
            }
        }
    });

    // Eventos de desconexão e erro
    client.on("close", () => {
        logger.warn(`[DISCONNECTED] Antena [${antenna.ip}] desconectada. Tentando reconectar...`);
        setTimeout(() => connectToAntenna(antenna), 5000);
    });

    // Evento de erro
    client.on("error", (err) => {
        logger.error(`[ERROR] Antena [${antenna.ip}]: ${err.message}`);
        client.destroy();
    });
}

ANTENNAS.forEach((antenna) => {
    if (antenna.ip && antenna.port) {
        connectToAntenna(antenna);
    } else {
        logger.error(`[ERROR] Configuração inválida da antena: ${antenna.device}`);
    }
});

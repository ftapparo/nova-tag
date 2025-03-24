import net from "net";
import dotenv from "dotenv";
import { openGateVehicle } from "./firebird";
import logger from "./logger"; // 🔹 Importa o logger melhorado

interface AntennaConfig {
    device: number;
    ip: string;
    port: number;
    direction: string;
}

// 🔹 Carregar variáveis de ambiente
dotenv.config();

// 🔹 Configuração das antenas a partir do .env
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

// 🔹 Comandos para controle do relé
const RELAY_OPEN_CMD = Buffer.from("CFFF007702020AF27C", "hex"); // Abrir portão
const RELAY_CLOSE_CMD = Buffer.from("CFFF0077020100774E", "hex"); // Fechar portão
const HEALTHCHECK_CMD = Buffer.from("CFFF00720017A5 ", "hex"); // Solicita dados da antena

// 🔹 Função para conectar a uma antena
function connectToAntenna(antenna: AntennaConfig) {
    const client = new net.Socket();

    client.connect(antenna.port, antenna.ip, () => {
        logger.info(`[CONECTADO] Antena RFID [IP: ${antenna.ip} | Porta: ${antenna.port} | Dispositivo: ${antenna.device}]`);

        // 🔹 Envia healthcheck periodicamente
        setInterval(() => {
            client.write(HEALTHCHECK_CMD);
            logger.info(`[HEALTHCHECK] Solicitado [IP: ${antenna.ip}]`);
        }, HEALTHCHECK_INTERVAL);
    });

    // 🔹 Captura resposta da antena
    client.on("data", async (data) => {
        const hexData = data.toString("hex");
        logger.debug(`[RECEBIDO] [${antenna.ip}] -> ${hexData}`);

        // 🔹 Verifica se o pacote contém dados da antena
        //if (hexData.startsWith("cf000072")){
        //    logger.info(`[HEALTHCHECK] Recebido [IP: ${antenna.ip} | Status OK]`);
        //}

        // 🔹 Verifica se o pacote contém uma TAG RFID
       // if (hexData.startsWith("cf00000112")) {
        if (hexData.startsWith("cf000072")){

            const hexData = "cf0000011200fd4e01000c0000000000088880056245662082";
            const tagNumber = "0"  + hexData.slice(-13, -4); 

            logger.info(`[LEITURA] TAG ${tagNumber} na antena [IP: ${antenna.ip} | Dispositivo: ${antenna.device}]`);

            // 🔹 Consulta permissão de acesso no banco de dados
            const response = await openGateVehicle(antenna, tagNumber);

            if (response.success === true) {
                logger.info(`[AUTORIZADO] TAG ${tagNumber} validada. Abrindo portão...`);
                
                // 🔹 Comando para abrir o portão
                client.write(RELAY_OPEN_CMD);

                // 🔹 Captura a resposta da antena confirmando a abertura do portão
                client.once("data", (ackData) => {
                    const ackHex = ackData.toString("hex");
                    if (ackHex.startsWith("cf00007703")) {
                        logger.info(`[INFO] Portão aberto para TAG ${tagNumber}. Iniciando temporizador para fechamento.`);
                        
                        setTimeout(() => {
                            logger.info(`[INFO] Fechando o portão para TAG ${tagNumber}.`);
                            client.write(RELAY_CLOSE_CMD);
                        }, 2000);
                    }
                });

            } else {
                logger.warn(`[NEGADO] Acesso negado para a TAG ${tagNumber}.`);
            }
        }

        
    });

    // 🔹 Lida com desconexões
    client.on("close", () => {
        logger.warn(`[AVISO] Conexão fechada com a antena [IP: ${antenna.ip} | Dispositivo: ${antenna.device}]. Tentando reconectar...`);
        setTimeout(() => connectToAntenna(antenna), 5000);
    });

    // 🔹 Captura erros de conexão
    client.on("error", (err) => {
        logger.error(`[ERRO] Falha na comunicação com a antena [IP: ${antenna.ip} | Dispositivo: ${antenna.device}]: ${err.message}`);
        client.destroy();
    });
}

// 🔹 Iniciar conexão com todas as antenas
ANTENNAS.forEach((antenna) => {
    if (antenna.ip && antenna.port) {
        connectToAntenna(antenna);
    } else {
        logger.error(`[ERRO] Configuração inválida para a antena [Dispositivo: ${antenna.device}]. Verifique o arquivo .env.`);
    }
});

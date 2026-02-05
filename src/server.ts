import dotenv from 'dotenv';
import axios from 'axios';
import { StartWebServer } from './api/web-server.api';
import { AntennaManager, AntennaConfig } from './core/antenna-manager';

// Carrega variáveis de ambiente (.env é opcional em Docker)
const dotenvResult = dotenv.config();
if (dotenvResult.error) {
    console.warn('[Server] .env não carregado (ok em Docker)');
} else {
    console.log('[Server] .env carregado com sucesso');
}

/**
 * Bootstrap principal
 */
async function startService(): Promise<void> {
    // Proteções contra estados inválidos
    process.on('uncaughtException', err => {
        console.error('[Server] uncaughtException', err);
        process.exit(1);
    });

    process.on('unhandledRejection', err => {
        console.error('[Server] unhandledRejection', err);
        process.exit(1);
    });

    // Healthcheck da API externa (falha fatal)
    await checkExternalApiHealth();

    const tagId = process.env.TAG_ID;
    const port = Number(process.env.PORT || 4000);

    if (!tagId || tagId.trim() === '') {
        console.error('[Server] TAG_ID não definido (TAG1 ou TAG2)');
        process.exit(1);
    }

    const antenna: AntennaConfig = (() => {
        switch (tagId) {
            case 'TAG1':
                return {
                    id: 1,
                    name: 'TAG1',
                    device: 9,
                    ip: '192.168.0.236',
                    port: 2022,
                    direction: 'E',
                    webserver: true,
                    webserverPort: port,
                };

            case 'TAG2':
                return {
                    id: 2,
                    name: 'TAG2',
                    device: 10,
                    ip: '192.168.0.237',
                    port: 2023,
                    direction: 'S',
                    webserver: true,
                    webserverPort: port,
                };

            default:
                console.error(`[Server] TAG_ID inválido: ${tagId}`);
                process.exit(1);
        }
    })();

    let antennaInstance: AntennaManager | null = null;

    try {
        antennaInstance = new AntennaManager(antenna);
        antennaInstance.connectToAntenna();
        console.log(`[Server] Antena ${antenna.name} conectada`);

        await StartWebServer(antennaInstance);
        console.log(`[Server] WebServer ativo na porta ${port}`);

    } catch (err) {
        console.error(`[Server] Erro fatal na inicialização (${antenna.name})`, err);
        process.exit(1);
    }

    // Graceful shutdown (Docker / SIGTERM)
    const shutdown = (signal: string) => {
        console.log(`[Server] Recebido ${signal}, finalizando...`);
        try {
            antennaInstance?.shutdown();
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

}

/**
 * Healthcheck da API externa (pré-requisito para subir)
 */
async function checkExternalApiHealth(): Promise<void> {
    const apiBaseUrl =
        process.env.API_BASE_URL ??
        'https://api.condominionovaresidence.com/v2/api';

    const timeout = Number(process.env.API_HEALTHCHECK_TIMEOUT) || 5000;
    const endpoints = ['/healthcheck', '/health'];

    console.log('[Server] Verificando API externa...');

    for (const endpoint of endpoints) {
        try {
            await axios.get(`${apiBaseUrl}${endpoint}`, { timeout });
            console.log(`[Server] API OK: ${endpoint}`);
            return;
        } catch (err) {
            console.warn(`[Server] Falha em ${endpoint}`);
        }
    }

    console.error('[Server] API externa indisponível. Abortando.');
    process.exit(1);
}

// Bootstrap
startService();

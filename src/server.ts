import dotenv from 'dotenv';
import axios from 'axios';
import { StartWebServer } from './v2/api/web-server.api';
import { StartWebServerV3 } from './v3/server';
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

        // v3 (Fastify) — roda lado a lado da v2, porta propria, ainda em
        // construcao. Falha aqui nao deve derrubar a v2, que ja atende
        // producao.
        try {
            await StartWebServerV3(antennaInstance);
            console.log('[Server] WebServer v3 inicializado.');
        } catch (v3Err) {
            console.error('[Server] Falha ao iniciar a v3 (nao fatal, v2 segue operando):', v3Err);
        }

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
 * Healthcheck da API externa (pré-requisito para subir).
 *
 * Com API_V3_BASE_URL definida, confere a v3 (/v3/api/health) — é ela que
 * valida e registra as TAGs; sem ela, confere a v2 como antes.
 *
 * Espera a API em vez de encerrar: no boot do servidor os containers sobem
 * em qualquer ordem, e encerrar só gerava um loop de restart do Docker até
 * a API responder.
 */
async function checkExternalApiHealth(): Promise<void> {
    const v3BaseUrl = process.env.API_V3_BASE_URL?.trim().replace(/\/+$/, '');
    const targets = v3BaseUrl
        ? [`${v3BaseUrl}/health`]
        : ['/healthcheck', '/health'].map((endpoint) =>
            `${process.env.API_BASE_URL ?? 'https://api.condominionovaresidence.com/v2/api'}${endpoint}`);

    const timeout = Number(process.env.API_HEALTHCHECK_TIMEOUT) || 5000;
    const retryMs = Number(process.env.API_HEALTHCHECK_RETRY_MS) || 5000;

    console.log(`[Server] Verificando API externa (${v3BaseUrl ? 'v3' : 'v2'})...`);

    for (let attempt = 1; ; attempt += 1) {
        for (const url of targets) {
            try {
                await axios.get(url, { timeout });
                console.log(`[Server] API OK: ${url}`);
                return;
            } catch {
                console.warn(`[Server] Falha em ${url} (tentativa ${attempt})`);
            }
        }
        console.warn(`[Server] API externa indisponível, nova tentativa em ${retryMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
}

// Bootstrap
startService();

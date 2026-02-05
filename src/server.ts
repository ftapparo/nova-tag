import dotenv from 'dotenv';
import axios from 'axios';
import { StartWebServer } from './api/web-server.api';
import { AntennaManager, AntennaConfig } from './core/antenna-manager';

// Carrega variáveis de ambiente do arquivo .env
dotenv.config();

/**
 * Inicializa o serviço web (Express) e as conexões de socket com as antenas RFID (TAG1 e TAG2).
 * Cada instância de AntennaManager gerencia uma antena específica.
 */
async function StartService(): Promise<void> {

    await checkExternalApiHealth();

    let antenna: AntennaConfig;

    if (process.argv.includes('TAG1')) {
        antenna = {
            id: 1,
            name: 'TAG1',
            device: 9,
            ip: '192.168.0.236',
            port: 2022,
            direction: 'E',
            webserver: true,
            webserverPort: 4009,
        };
    }
    else if (process.argv.includes('TAG2')) {
        antenna = {
            id: 2,
            name: 'TAG2',
            device: 10,
            ip: '192.168.0.237',
            port: 2023,
            direction: 'S',
            webserver: true,
            webserverPort: 4010,
        };
    }
    else {
        console.error('[Server] Nenhum argumento de antena fornecido. Use "TAG1" ou "TAG2".');
        process.exit(1);
    }

    try {
        const instanceAntenna = new AntennaManager(antenna);
        instanceAntenna.connectToAntenna();
        console.log(`[Server] Antena ${antenna.id} inicializada.`);

        // Inicializa o serviço web
        await StartWebServer(instanceAntenna);
        console.log('[Server] Serviço web inicializado.');

        // Finaliza a aplicação com limpeza adequada do socket
        process.on("SIGINT", () => {
            if (instanceAntenna) {
                instanceAntenna.shutdown();
            }
        });

    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[Server] Erro ao inicializar a antena ${antenna.id}:`, err);
        process.exit(1);
    }
}

/**
 * Executa healthcheck na API externa antes de iniciar o serviço
 */
async function checkExternalApiHealth(): Promise<void> {
    const apiBaseUrl = process.env.API_BASE_URL || 'https://api.condominionovaresidence.com/v2/api';
    const timeout = Number(process.env.API_HEALTHCHECK_TIMEOUT) || 5000;
    const endpoints = ['/healthcheck', '/health'];

    console.log('[Server] Verificando healthcheck da API externa...');

    for (const endpoint of endpoints) {
        try {
            await axios.get(`${apiBaseUrl}${endpoint}`, { timeout });
            console.log(`[Server] Healthcheck OK em ${apiBaseUrl}${endpoint}`);
            return;
        } catch (error) {
            console.error(`[Server] Falha no healthcheck em ${apiBaseUrl}${endpoint}:`, error);
        }
    }

    console.error('[Server] Healthcheck da API externa falhou. Encerrando aplicação.');
    process.exit(1);
}

// Inicia o serviço
StartService();


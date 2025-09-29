import express from 'express';
import cors from 'cors';
import http from 'http';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../swagger.json';

import healthRoutes from '../routes/health.routes';
import gateRoutes from '../routes/gate.routes';
import { AntennaManager } from '../core/antenna-manager';

export async function StartWebServer(antennaInstance: AntennaManager): Promise<void> {
    const app = express();
    const port = antennaInstance.antenna.webserverPort;

    /**
     * Middleware de CORS para permitir requisições de qualquer origem e métodos principais.
     */
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true
    }));

    /**
     * Middleware para parsear JSON nas requisições.
     */
    app.use(express.json());

    /**
     * Registro das rotas principais da API.
     * - /api/health: Healthcheck
     * - /api/gate: Controle de Portão
     */
    app.use('/api', healthRoutes);
    app.use('/api', gateRoutes(antennaInstance));

    /**
     * Rota para servir a documentação Swagger UI.
     */
    app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

    /**
     * Endpoint para servir o arquivo swagger.json (OpenAPI spec).
     */
    app.get('/apispec_1.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerDocument);
    });

    /**
     * Middleware para tratar rotas não encontradas (404).
     */
    app.use((_req, res) => {
        res.status(404).send();
    });

    /**
     * Inicializa o servidor Express na porta configurada.
     */
    app.listen(port, () => {
        console.log(`[Api] WebServer rodando na porta ${port}`);
    });
}


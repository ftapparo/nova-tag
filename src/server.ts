import express, { Request, Response } from 'express';

/**
 * Determina qual instância inicializar baseado no argumento passado
 */
function startServer(): void {
    const app = express();

    let port: number;
    let tagName: string;

    // Identifica qual instância deve subir
    if (process.argv.includes('TAG1')) {
        port = 4009;
        tagName = 'TAG1';
    } else if (process.argv.includes('TAG2')) {
        port = 4010;
        tagName = 'TAG2';
    } else {
        console.error('[Server] Nenhum argumento de antena fornecido. Use "TAG1" ou "TAG2".');
        process.exit(1);
    }

    // Middleware para parse de JSON
    app.use(express.json());

    /**
     * Rota de health check para monitoramento do container
     * @route GET /health
     */
    app.get('/health', (req: Request, res: Response) => {
        res.status(200).json({
            status: 'OK',
            tag: tagName,
            port: port,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            pid: process.pid,
        });
    });

    /**
     * Rota raiz
     * @route GET /
     */
    app.get('/', (req: Request, res: Response) => {
        res.status(200).json({
            message: `Nova Tag - ${tagName}`,
            version: '1.1.1',
            port: port,
        });
    });

    // Inicia o servidor
    app.listen(port, () => {
        console.log(`[Server] ${tagName} rodando na porta ${port}`);
        console.log(`[Server] Health check disponível em: http://localhost:${port}/health`);
        console.log(`[Server] PID: ${process.pid}`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log(`\n[Server] ${tagName} finalizando...`);
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log(`\n[Server] ${tagName} finalizando...`);
        process.exit(0);
    });
}

// Inicia o servidor
startServer();


import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import logger from '../core/utils/logger';
import { AntennaManager } from '../core/antenna-manager';
import { healthRoutes } from './routes/health.routes';
import { gateRoutes } from './routes/gate.routes';
import { cacheRoutes } from './routes/cache.routes';
import { registerErrorHandler, responseHelpersPlugin } from './lib/reply-helpers';
import { registerServiceAuth } from './lib/service-auth';
import openapiDocument from './openapi.json';

/**
 * Bootstrap da v3 (Fastify + Zod). Roda num processo/porta própria,
 * lado a lado com a v2 (Express) — ambas chamam o mesmo core/, nunca
 * duplicam lógica de negócio nem abrem uma segunda conexão TCP com a
 * antena (AntennaManager é instância única, injetada aqui como na v2).
 *
 * Path público: /v3/api/*, em porta interna própria (PORT_V3), roteada
 * externamente por uma entrada dedicada no Cloudflare Tunnel. TAG1 e
 * TAG2 rodam em containers/processos separados, cada um com seu próprio
 * PORT/PORT_V3 — sem conflito entre instâncias.
 */
export async function StartWebServerV3(antennaInstance: AntennaManager): Promise<void> {
    const app = Fastify({
        logger: false, // usamos o logger próprio (winston) em vez do pino embutido
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Mecanismo de resposta padrão da v3 (reply.ok()/reply.fail()) e
    // tratamento central de erro — ver src/v3/lib/response.ts para o
    // desenho completo do envelope.
    await app.register(responseHelpersPlugin);
    registerErrorHandler(app);

    // Autenticação de serviço: só a nova-api (rede interna) conhece
    // TAG_SERVICE_TOKEN e pode chamar estas rotas. Autorização por
    // usuário/role continua sendo decidida na nova-api antes de repassar
    // a chamada — ver src/v3/lib/service-auth.ts.
    registerServiceAuth(app);

    // Flag própria da v3 (independente de qualquer flag da v2). Spec
    // escrito à mão em openapi.json, servido em mode: 'static' — mesmo
    // padrão de nova-api (ver docs/PADRAO-RESPOSTA-V3.md).
    const swaggerV3Enabled = process.env.SWAGGER_V3_ENABLED === 'true';
    if (swaggerV3Enabled) {
        await app.register(fastifySwagger, {
            mode: 'static',
            specification: { document: openapiDocument as never },
        });

        await app.register(fastifySwaggerUi, {
            routePrefix: '/v3/swagger',
        });

        app.get('/v3/apispec_1.json', async (_request, reply) => {
            reply.header('Content-Type', 'application/json').send(openapiDocument);
        });
    }

    await app.register(async (instance) => {
        instance.withTypeProvider<ZodTypeProvider>();
        await healthRoutes(instance);
        await gateRoutes(instance, antennaInstance);
        await cacheRoutes(instance);
    }, { prefix: '/v3/api' });

    const port = Number(process.env.PORT_V3 || 3031);

    try {
        await app.listen({ port, host: '0.0.0.0' });
        logger.info(`[ApiV3] WebServer (Fastify) rodando na porta ${port}`);
    } catch (err) {
        logger.error('[ApiV3] Falha ao iniciar o servidor Fastify:', err);
        throw err;
    }
}

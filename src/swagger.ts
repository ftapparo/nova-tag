/**
 * @file swagger.ts
 * @description Configuração do Swagger/OpenAPI para documentação automática da API.
 *
 * Este arquivo define o objeto swaggerSpec, que é utilizado para gerar a documentação interativa
 * da API (Swagger UI) e o arquivo OpenAPI JSON. Inclui informações como tags, descrição, servidores e paths das rotas/controllers.
 *
 * - Usa swagger-autogen para gerar o spec a partir de comentários JSDoc nas rotas/controllers.
 * - O fileExtension é ajustado conforme o ambiente para suportar .ts em desenvolvimento e .js em produção.
 * - As rotas e controllers devem conter comentários JSDoc compatíveis com Swagger para aparecerem na documentação.
 */

import dotenv from 'dotenv';
dotenv.config();

import swaggerAutogen from 'swagger-autogen';

/**
 * Define a extensão dos arquivos a serem lidos pelo swagger-autogen.
 * Usa .ts em desenvolvimento e .js em produção.
 */
const fileExtension = process.env.NODE_ENV === 'development' ? 'ts' : 'js';

/**
 * Define a porta do servidor, padrão 3000 se não especificada na variável de ambiente.
 */
const port = process.env.PORT || 3000;

/**
 * Configuração do Swagger/OpenAPI. Define informações da API, servidores, tags e paths.
 * As rotas e controllers devem conter comentários JSDoc compatíveis com Swagger para aparecerem na documentação.
 * O objeto 'doc' é usado pelo swagger-autogen para gerar a documentação automática.
 */
const doc = {

  info: {
    title: 'API Controle do Portão - Condomínio Nova Residence',
    description: '',
    version: '1.0.0',
  },
  servers: [
    {
      url: `http://localhost:${port}/api/`,
      description: 'Desenvolvimento local'
    },
    {
      url: 'https://gate.condominionovaresidence.com/api/',
      description: 'Servidor de Produção'
    }
  ],
  tags: [
    {
      name: 'Healthcheck',
      description: 'Verificações de status da aplicação',
    },
    {
      name: 'Gate',
      description: 'Funcionalidades para controle de portão: abertura, fechamento, status.'
    }
  ]
};

/**
 * Lista de arquivos de endpoints e controllers a serem incluídos na documentação.
 */

let endpointsFiles = [];

endpointsFiles.push(`./src/routes/health.routes.${fileExtension}`, `./src/controllers/health.controller.${fileExtension}`);
endpointsFiles.push(`./src/routes/gate.routes.${fileExtension}`, `./src/controllers/gate.controller.${fileExtension}`);

let swaggerFile = `../src/swagger.json`;

if (process.env.NODE_ENV !== 'development') {
  swaggerFile = `../dist/swagger.json`;
}

/**
 * Gera a documentação Swagger/OpenAPI automaticamente com base nos arquivos especificados.
 */
swaggerAutogen({ openapi: '3.0.1' })(swaggerFile, endpointsFiles, doc).then(() => {
  console.log('[Swagger] Documentação gerada com sucesso!');
});

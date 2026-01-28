<div align="center">

# 🏢 Nova Tag - Sistema de Controle de Acesso RFID

**Sistema inteligente de automação para controle de acesso veicular via RFID**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/ftapparo/nova-tag)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## 📋 Índice

- [Sobre o Projeto](#-sobre-o-projeto)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#-arquitetura)
- [Tecnologias](#-tecnologias)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Execução](#-execução)
- [API REST](#-api-rest)
- [Documentação Swagger](#-documentação-swagger)
- [Monitoramento](#-monitoramento)
- [Docker](#-docker)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Fluxo de Operação](#-fluxo-de-operação)
- [Changelog](#-changelog)
- [Licença](#-licença)
- [Autor](#-autor)

---

## 🎯 Sobre o Projeto

**Nova Tag** é um sistema completo de automação para controle de acesso veicular através de leitores RFID. Desenvolvido especificamente para o **Condomínio Nova Residence**, o sistema realiza a comunicação com antenas RFID via socket TCP, valida TAGs em tempo real, controla automaticamente portões de acesso e oferece uma API REST para gerenciamento remoto.

### ✨ Diferenciais

- **Comunicação TCP de baixo nível** com antenas RFID
- **Validação em tempo real** com API externa de autorização
- **Controle automático de portões** com temporizadores inteligentes
- **API REST** para gerenciamento e monitoramento remoto
- **Documentação automática** com Swagger UI
- **Arquitetura modular** baseada em camadas (MVC)
- **Monitoramento completo** com PM2+ e métricas
- **Healthcheck automático** e reconexão inteligente
- **Sistema de filtros** para bloqueio de TAGs indesejadas
- **Logs estruturados** com rotação diária

---

## 🚀 Funcionalidades

### Controle de Acesso
- ✅ Leitura automática de TAGs RFID via socket TCP
- ✅ Validação de TAGs com API de autorização externa
- ✅ Abertura automática de portão para TAGs autorizadas
- ✅ Fechamento automático com temporizador configurável
- ✅ Reinício de temporizador ao reler a mesma TAG
- ✅ Filtro de máscara RFID para bloqueio de TAGs específicas (ex: Sem Parar)

### Gerenciamento Remoto
- ✅ API REST para abertura/fechamento manual do portão
- ✅ Endpoint de healthcheck para monitoramento
- ✅ Status em tempo real da antena e portão
- ✅ Documentação interativa com Swagger UI

### Monitoramento e Confiabilidade
- ✅ Healthcheck periódico da antena via socket
- ✅ Reconexão automática com controle de tentativas
- ✅ Envio de métricas para PM2+ (TAGs autorizadas, aberturas, fechamentos)
- ✅ Registro automático de issues em caso de erros
- ✅ Logs estruturados com rotação diária (30 dias de retenção)

---

## 🏗️ Arquitetura

O projeto segue uma **arquitetura em camadas** com separação clara de responsabilidades:

```
┌─────────────────────────────────────────────┐
│          API REST (Express)                 │
│  Rotas, Controllers, Middleware, Swagger    │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│          Core Business Logic                │
│  AntennaManager, GateController,            │
│  TagValidator                                │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│          Integrations                       │
│  Socket TCP (RFID), External API,           │
│  PM2+ Metrics, Logger                       │
└─────────────────────────────────────────────┘
```

### Camadas do Sistema

**API Layer** (`src/api/`, `src/routes/`, `src/controllers/`)
- Exposição de endpoints REST
- Validação de requisições
- Tratamento de erros HTTP
- Documentação Swagger

**Core Layer** (`src/core/`)
- Lógica de negócio principal
- Gerenciamento de conexão com antena
- Controle de estado do portão
- Validação de TAGs

**Utils Layer** (`src/utils/`)
- Logger estruturado
- Utilitários compartilhados
- Configurações globais

---

## 🛠️ Tecnologias

### Runtime e Linguagem
- **Node.js 20.x** - Ambiente de execução
- **TypeScript 5.8** - Linguagem com tipagem estática

### Framework e API
- **Express 5.x** - Framework web minimalista
- **Swagger UI** - Documentação interativa da API
- **Swagger Autogen** - Geração automática de especificação OpenAPI

### Comunicação e Integrações
- **net** (Node.js TCP) - Socket TCP para comunicação com antena RFID
- **axios** - Cliente HTTP para APIs externas
- **cors** - Controle de CORS para API REST

### Logs e Monitoramento
- **winston** - Sistema de logs estruturado
- **winston-daily-rotate-file** - Rotação automática de arquivos de log
- **@pm2/io** - Métricas e monitoramento com PM2+

### Ambiente e Configuração
- **dotenv** - Gerenciamento de variáveis de ambiente
- **PM2** - Gerenciador de processos e monitoramento

### Desenvolvimento
- **ts-node-dev** - Hot reload para desenvolvimento
- **ESLint** - Linter para qualidade de código
- **TypeScript ESLint** - Regras específicas para TypeScript

---

## 📦 Instalação

### Pré-requisitos

- Node.js >= 20.x
- npm >= 10.x
- PM2 (opcional, para produção)
- Docker (opcional)

### Clonar o Repositório

```bash
git clone https://github.com/ftapparo/nova-tag.git
cd nova-tag
```

### Instalar Dependências

```bash
npm install
```

### Compilar TypeScript

```bash
npm run build
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto ou utilize os arquivos de ambiente específicos (`.env.local`, `.env.dev`, `.env.prod`):

```env
# Configuração da API de Autorização
API_URL=https://api.example.com
API_TOKEN=your_api_token_here

# Configuração de Timeouts
HEALTHCHECK_INTERVAL=30000        # Intervalo de healthcheck (ms)
GATE_TIMEOUT_TO_CLOSE=3000        # Tempo para fechar portão (ms)

# Modo Debug
DEBUG=false                        # true para logs detalhados

# Configuração das Antenas (definidas em código)
# TAG1: IP 192.168.0.236, Porta 2022, Direção E, Web Server Porta 4009
# TAG2: IP 192.168.0.237, Porta 2023, Direção S, Web Server Porta 4010
```

### Configuração das Antenas

As configurações específicas de cada antena estão definidas em [src/server.ts](src/server.ts#L14-L41):

**TAG1** (Entrada)
- Device ID: 9
- IP: 192.168.0.236
- Porta: 2022
- Direção: E (Entrada)
- Web Server: Porta 4009

**TAG2** (Saída)
- Device ID: 10
- IP: 192.168.0.237
- Porta: 2023
- Direção: S (Saída)
- Web Server: Porta 4010

---

## 🚀 Execução

### Modo Desenvolvimento

```bash
# TAG1 (Entrada)
npm run dev -- TAG1

# TAG2 (Saída)
npm run dev -- TAG2
```

### Modo Produção

```bash
# Compilar e executar
npm run build
npm start TAG1  # ou TAG2
```

### Com PM2 (Recomendado para Produção)

```bash
# TAG1
pm2 start dist/server.js --name "nova-tag-1" -- TAG1

# TAG2
pm2 start dist/server.js --name "nova-tag-2" -- TAG2

# Visualizar processos
pm2 list

# Monitorar em tempo real
pm2 monit

# Ver logs
pm2 logs nova-tag-1
pm2 logs nova-tag-2

# Salvar configuração para restart automático
pm2 save
pm2 startup
```

---

## 🌐 API REST

O sistema expõe uma API REST para gerenciamento remoto do portão e monitoramento do sistema.

### Base URLs

- **TAG1**: `http://localhost:4009`
- **TAG2**: `http://localhost:4010`

### Endpoints Disponíveis

#### 🔍 Health Check
```http
GET /health
```

**Resposta de Sucesso (200)**
```json
{
  "status": "OK",
  "antenna": {
    "name": "TAG1",
    "device": 9,
    "direction": "E",
    "connected": true
  },
  "gate": {
    "state": "CLOSED"
  },
  "uptime": 3600.5
}
```

#### 🔓 Abrir Portão
```http
POST /api/gate/open
```

**Resposta de Sucesso (200)**
```json
{
  "success": true,
  "message": "Portão aberto com sucesso.",
  "data": {
    "state": "OPEN"
  }
}
```

#### 🔒 Fechar Portão
```http
POST /api/gate/close
```

**Resposta de Sucesso (200)**
```json
{
  "success": true,
  "message": "Portão fechado com sucesso.",
  "data": {
    "state": "CLOSED"
  }
}
```

### Códigos de Status HTTP

| Código | Significado |
|--------|-------------|
| 200 | Operação realizada com sucesso |
| 400 | Requisição inválida |
| 500 | Erro interno do servidor |
| 503 | Serviço indisponível (antena desconectada) |

---

## 📚 Documentação Swagger

Acesse a documentação interativa da API em:

- **TAG1**: http://localhost:4009/swagger
- **TAG2**: http://localhost:4010/swagger

A documentação Swagger permite:
- ✅ Visualizar todos os endpoints disponíveis
- ✅ Testar requisições diretamente no navegador
- ✅ Ver exemplos de requisições e respostas
- ✅ Entender os modelos de dados

### Gerar Documentação Atualizada

```bash
npm run swagger
```

---

## 📊 Monitoramento

### Métricas Enviadas para PM2+

| Métrica | Descrição | Tipo |
|---------|-----------|------|
| `LAST_TAG_READED` | Último número de TAG lido | String |
| `AUTHORIZED` | Contador de TAGs autorizadas | Counter |
| `OPEN_GATE` | Quantidade de aberturas de portão | Counter |
| `CLOSE_GATE` | Quantidade de fechamentos de portão | Counter |

### Issues Automáticos

Erros críticos são registrados automaticamente como issues no PM2+ através do logger:

```typescript
logger.error('[Context] Mensagem de erro', error);
```

### Visualizar Métricas

```bash
# Dashboard do PM2
pm2 monit

# Conectar ao PM2+ (Keymetrics)
pm2 link <secret_key> <public_key>
```

### Logs do Sistema

Os logs são salvos em diretórios específicos por antena:

```
logs/
├── TAG1/
│   ├── application-2026-01-27.log
│   ├── error-2026-01-27.log
│   └── ...
└── TAG2/
    ├── application-2026-01-27.log
    ├── error-2026-01-27.log
    └── ...
```

**Características:**
- Rotação diária automática
- Retenção de 30 dias
- Separação entre logs de aplicação e erros
- Formato estruturado com timestamp, nível e contexto

---

## 🐳 Docker

### Construir Imagem

```bash
docker build -t nova-tag:2.0.0 .
```

### Executar Container

```bash
# TAG1
docker run -d \
  --name nova-tag-1 \
  -p 4009:4009 \
  --env-file .env \
  nova-tag:2.0.0 TAG1

# TAG2
docker run -d \
  --name nova-tag-2 \
  -p 4010:4010 \
  --env-file .env \
  nova-tag:2.0.0 TAG2
```

### Docker Compose (exemplo)

```yaml
version: '3.8'

services:
  tag1:
    build: .
    container_name: nova-tag-1
    ports:
      - "4009:4009"
    env_file:
      - .env
    command: TAG1
    restart: unless-stopped

  tag2:
    build: .
    container_name: nova-tag-2
    ports:
      - "4010:4010"
    env_file:
      - .env
    command: TAG2
    restart: unless-stopped
```

---

## 📁 Estrutura do Projeto

```
nova-tag/
├── src/
│   ├── server.ts                 # Entry point da aplicação
│   ├── swagger.ts                # Gerador de documentação Swagger
│   ├── swagger.json              # Especificação OpenAPI gerada
│   ├── api/
│   │   └── web-server.api.ts     # Inicialização do servidor Express
│   ├── controllers/
│   │   ├── gate.controller.ts    # Controller para operações do portão
│   │   └── health.controller.ts  # Controller para healthcheck
│   ├── core/
│   │   ├── antenna-manager.ts    # Gerenciamento de conexão com antena
│   │   ├── gate-controller.ts    # Lógica de controle do portão
│   │   └── tag-validator.ts      # Validação de TAGs com API externa
│   ├── routes/
│   │   ├── gate.routes.ts        # Rotas do portão
│   │   └── health.routes.ts      # Rotas de healthcheck
│   └── utils/
│       └── logger.ts             # Sistema de logs estruturado
├── bkp/                          # Arquivos de backup (versão anterior)
├── logs/                         # Logs gerados por antena
│   ├── TAG1/
│   └── TAG2/
├── .github/
│   └── instructions/
│       └── copilot.instructions.md  # Instruções de padrões de código
├── .env                          # Variáveis de ambiente (não versionado)
├── .env.example                  # Exemplo de configuração
├── .gitignore                    # Arquivos ignorados pelo Git
├── .editorconfig                 # Configuração de editores
├── CHANGELOG.md                  # Histórico de versões
├── README.md                     # Este arquivo
├── package.json                  # Dependências e scripts
├── tsconfig.json                 # Configuração do TypeScript
├── Dockerfile                    # Imagem Docker
└── LICENSE                       # Licença MIT
```

---

## 🔄 Fluxo de Operação

### 1️⃣ Inicialização
```
[Sistema] Carrega variáveis de ambiente
        ↓
[Sistema] Inicializa AntennaManager
        ↓
[Sistema] Conecta socket TCP com antena RFID
        ↓
[Sistema] Envia comando de fechamento (sincronização)
        ↓
[Sistema] Aplica filtro de máscara RFID
        ↓
[Sistema] Inicia servidor web Express
        ↓
[Sistema] Sistema pronto
```

### 2️⃣ Leitura de TAG
```
[Antena] TAG detectada
        ↓
[Sistema] Extrai número da TAG
        ↓
[Sistema] Envia para TagValidator
        ↓
[API Externa] Verifica autorização (POST /access/verify)
        ↓
[Sistema] TAG autorizada?
        ├─ SIM ─→ [Sistema] Abre portão
        │                 ↓
        │         [Sistema] Inicia temporizador de fechamento
        │                 ↓
        │         [API Externa] Registra acesso (POST /access/register)
        │                 ↓
        │         [Sistema] Incrementa métricas (AUTHORIZED, OPEN_GATE)
        │
        └─ NÃO ─→ [Sistema] Ignora TAG
```

### 3️⃣ Fechamento Automático
```
[Timer] Temporizador expira após GATE_TIMEOUT_TO_CLOSE
        ↓
[Sistema] Envia comando de fechamento
        ↓
[Antena] Confirma fechamento
        ↓
[Sistema] Atualiza estado para CLOSED
        ↓
[Sistema] Incrementa métrica CLOSE_GATE
```

### 4️⃣ Healthcheck
```
[Timer] A cada HEALTHCHECK_INTERVAL
        ↓
[Sistema] Envia comando HEALTHCHECK para antena
        ↓
[Antena] Responde?
        ├─ SIM ─→ [Sistema] Reset contador de tentativas
        │
        └─ NÃO ─→ [Sistema] Incrementa contador
                          ↓
                  [Sistema] Contador >= 10?
                          ├─ SIM ─→ [Sistema] Encerra aplicação (PM2 restart)
                          │
                          └─ NÃO ─→ [Sistema] Tenta reconectar
```

### 5️⃣ Controle Manual via API
```
[Cliente] POST /api/gate/open ou /api/gate/close
        ↓
[Controller] Valida requisição
        ↓
[GateController] Executa comando
        ↓
[AntennaManager] Envia comando para antena
        ↓
[Antena] Confirma execução
        ↓
[Controller] Retorna resposta JSON
```

---

## 🔐 Segurança

- ✅ Validação de TAGs com API externa autenticada via token
- ✅ CORS configurado para controle de origens
- ✅ Filtro de máscara RFID para bloquear TAGs específicas
- ✅ Logs de todas as operações sensíveis
- ✅ Variáveis de ambiente para credenciais
- ✅ Controle de tentativas de reconexão

---

## 🧪 Testes

```bash
# Testar endpoint de health
curl http://localhost:4009/health

# Abrir portão via API
curl -X POST http://localhost:4009/api/gate/open

# Fechar portão via API
curl -X POST http://localhost:4009/api/gate/close
```

---

## 📄 Changelog

Para ver o histórico completo de versões e alterações, consulte o [CHANGELOG.md](CHANGELOG.md).

**Versão Atual:** 2.0.0 (27/01/2026)

---

## 📝 Licença

Este projeto está licenciado sob a **MIT License** - veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 👤 Autor

**Flavio Eduardo Tapparo**

- GitHub: [@ftapparo](https://github.com/ftapparo)
- Projeto: [nova-tag](https://github.com/ftapparo/nova-tag)

---

## 🏢 Contexto

Sistema desenvolvido para o **Condomínio Nova Residence** para automação completa do controle de acesso veicular via tecnologia RFID.

---

<div align="center">

**Desenvolvido com ❤️ para automação inteligente**

[⬆ Voltar ao topo](#-nova-tag---sistema-de-controle-de-acesso-rfid)

</div>

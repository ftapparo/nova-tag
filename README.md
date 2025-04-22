# Módulo: Antena RFID - Controle de Acesso

Este módulo realiza a comunicação via socket TCP com leitores RFID, valida TAGs em uma API, aciona um relé de abertura de portão e envia métricas e logs para o **PM2+** para monitoramento e análise.

---

## 📁 Estrutura do Projeto

```
/antena-app
├── logger.ts
├── main.ts
├── .env
├── package.json
└── logs/
```

---

## 🔧 Variáveis de Ambiente (`.env`)

```env
# Antena 1
ANTENNA1_DEVICE=1
ANTENNA1_IP=192.168.0.10
ANTENNA1_PORT=4001
ANTENNA1_DIRECTION=E

# Antena 2
ANTENNA2_DEVICE=2
ANTENNA2_IP=192.168.0.11
ANTENNA2_PORT=4002
ANTENNA2_DIRECTION=S

# Intervalo e limite de healthcheck
HEALTHCHECK_INTERVAL=2000
HEALTHCHECK_COUNT_LIMIT=15
```

---

## 🚀 Execução

Inicie com o nome da antena desejada:

```bash
node dist/main.js TAG1
# ou
node dist/main.js TAG2
```

---

## 🔄 Comportamento

### Conexão com o Leitor RFID
- Estabelece socket TCP com IP e porta definidos.
- Após conectar, envia comando de **fechamento do portão** para sincronizar.

### Leitura de TAG
- Ao identificar uma TAG, envia para API `POST /access/verify`.
- Se a resposta for permitida, abre o portão e registra o acesso via `POST /access/register`.

### Timeout e Healthcheck
- A cada ciclo de inatividade, envia comando `HEALTHCHECK`.
- Após 15 ciclos sem resposta, **tenta reconectar**.
- Após 10 tentativas de reconexão, encerra o processo com `process.exit(1)`.

---

## 📊 Métricas e Monitoramento (PM2+)

### Métricas Enviadas

| Nome               | Descrição                            |
|--------------------|----------------------------------------|
| `LAST_TAG_READED` | Última TAG válida lida               |

Utiliza:

```ts
logger.metric("LAST_TAG_READED", tagNumber);
```

### Issues Automáticos

Chamadas a `logger.error(...)` registram issues automaticamente via:

```ts
io.notifyError(new Error(message));
```

---

## ✅ PM2 - Execução e Monitoramento

### Iniciar

```bash
pm2 start dist/main.js --name "antena-tag1" -- TAG1
```

### Visualizar métricas

```bash
pm2 monit
```

### Acompanhar logs

```bash
pm2 logs antena-tag1
```

---

## 📜 Logs

- Logs são gerados por antena: `logs/TAG1/`, `logs/TAG2/`
- Rotacionados diariamente com 30 dias de retenção

---

## 📄 Changelog

Confira o histórico completo de versões e mudanças em [CHANGELOG.md](./CHANGELOG.md)

---

## 📎 Contato e Manutenção

Módulo mantido por: **Flavio Eduardo Tapparo**  
Ambiente: **Condomínio Nova Residence**  
Desenvolvimento interno para controle de acesso RFID veicular.

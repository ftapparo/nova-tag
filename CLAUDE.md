# nova-tag

Serviço de controle de acesso veicular via RFID do Condomínio Nova Residence. Comunicação TCP de baixo nível com antenas RFID físicas, validação de TAGs contra a `nova-api`, controle automático de portões.

Veja `README.md` para visão completa (arquitetura, endpoints, monitoramento) e `CHANGELOG.md` para o histórico. Este arquivo é o contexto real do projeto; `AGENTS.md` tem as regras genéricas de processo/arquitetura (cohesion, boundaries, validation) — leia os dois, começando por este.

## 🔴 Regra absoluta: nunca tocar em `src/v2/`

Nunca editar, refatorar ou "atualizar para usar a v3" nenhum arquivo em `src/v2/`, em nenhuma circunstância — nem para fechar uma cadeia de segurança, nem como parte de outra tarefa. `v2/` é a superfície em produção real, atendendo o condomínio agora. Qualquer trabalho de v3 que pareça exigir mudança na v2 para funcionar deve parar e perguntar antes, nunca assumir que está autorizado. Vale para os 4 projetos do ecossistema, não só este.

## Commits

Este projeto usa um fluxo de commit específico — ver skill `commit` (`.claude/skills/commit/SKILL.md`). Resumo: separar commits por grupo lógico de mudança, mensagem com subject curto + corpo completo, atualizar `CHANGELOG.md` (seção `[Unreleased]`) antes do commit, apresentar para aprovação antes de commitar, perguntar antes de dar push. Nunca criar versão numerada nem tocar no `package.json` sem pedido explícito de "versionar".

## Arquitetura

```
src/
  core/              # lógica de negócio, sem framework HTTP
    antenna-manager.ts   # conexão TCP com a antena — instância ÚNICA por processo
    gate-controller.ts   # estado e temporizador do portão
    tag-validator.ts     # valida TAG lida contra a nova-api
    utils/logger.ts

  v2/                # API REST (Express) para gerenciamento remoto
    api/, controllers/, routes/, middleware/

  server.ts          # entry point: escolhe config de antena (TAG1/TAG2 via env TAG_ID),
                      # cria UMA instância de AntennaManager, injeta na v2
```

**Regra crítica**: existe **uma única conexão TCP física** com cada antena por processo. `AntennaManager` é criado uma vez em `server.ts` e injetado tanto na v2 (`StartWebServer(antennaInstance)`) quanto na v3 (`StartWebServerV3(antennaInstance)`) — nunca instanciar um segundo `AntennaManager` para a mesma antena.

### `v3/` — organizada por feature, não por camada

```
v3/
  health/         health.routes.ts — reflete estado real da antena (isHealthcheckAwaitingResponse)
  gate/           gate.routes.ts — estado do portão (getter getGateState)
  cache/          cache.routes.ts — cache de TAGs validadas (getTagValidatorInstance)
  shared/         response.ts, reply-helpers.ts, service-auth.ts (TAG_SERVICE_TOKEN), tag.schema.ts (usado por gate/ e cache/)
  openapi.json    spec escrito à mão, não gerado
  server.ts       bootstrap do Fastify, porta própria (PORT_V3)
```

Padrão completo (envelope de resposta, autenticação de serviço, convenção de pastas): `docs/PADRAO-RESPOSTA-V3.md` e `AI-Friendly Architecture Specification.md` (raiz do workspace). Ler só quando a tarefa envolver `v3/`.

## Este processo roda como TAG1 OU TAG2, nunca os dois

O mesmo código sobe duas vezes (dois containers/processos separados), um para cada antena física:

- **TAG1** (Entrada): device 9, IP `192.168.0.236:2022`, direção `E`
- **TAG2** (Saída): device 10, IP `192.168.0.237:2023`, direção `S`

Qual antena usar é decidido por `process.env.TAG_ID` (`TAG1` ou `TAG2`), lido em `server.ts`. Falha se não definido ou inválido.

## Stack

Node.js 20 + TypeScript, Express, `net` (socket TCP nativo), axios (chama a `nova-api`), Winston + rotação diária, PM2 (métricas e restart em produção).

## Comandos

```bash
npm run build
npm run dev -- TAG1     # ou TAG2
npm start TAG1          # ou TAG2, após build
npx tsc --noEmit
```

Sem suíte de testes automatizados — validação é manual, sempre com a antena física ou um mock de socket.

## Convenções

- Timeouts e configurações operacionais (healthcheck, reconexão, filtro RFID) vêm de env vars com defaults sensatos — nunca hardcodar um valor que já existe como variável.
- Comandos enviados à antena são sequenciais por natureza do protocolo (buffer único) — não paralelizar envios sem entender a ordem esperada pelo firmware.
- `FILTER_DATA` é uma máscara binária específica do protocolo Intelbras/antena — não alterar sem entender o formato do comando (ver comentários em `core/antenna-manager.ts`).

## Bugs de produção já resolvidos (não repetir)

- **Handshake TCP travado sem erro nem close**: se `client.connect()` trava sem completar nem falhar, o socket fica pendurado, impede reconexão automática. Corrigido com `CONNECT_TIMEOUT_MS` explícito — destrói o socket se o handshake não completar a tempo.
- **Race condition healthcheck vs. leitura de TAG**: enviar healthcheck no meio de uma leitura trava o firmware da antena, exige cold restart. Corrigido com `HEALTHCHECK_GUARD_MS` — suprime o healthcheck se dados chegaram recentemente.
- **`autoheal` com path errado no Windows**: volume do socket Docker precisa ser `//var/run/docker.sock` (barra dupla) no Docker Desktop Windows, não `/var/run/docker.sock`.

- **Processo vivo sem antena e sem reconectar**: uma reconexão que falhava deixava a reconexão marcada como "em andamento" e nada mais era agendado. Corrigido: só o socket atual decide a reconexão (`scheduleReconnect`).

### Protocolo da antena (UHF Prime Reader)

Manual: [`UHF_Prime_Reader.pdf`](UHF_Prime_Reader.pdf) (*UHF Prime Reader User Manual V1.0*, raiz do repositório). Quadro: `CF | ADDR | CMD (2) | LEN | STATUS + Data | CRC16` — separado e validado em `core/antenna-protocol.ts`, nunca por prefixo de texto.

- `0x0050` RFM_MODULE_INT: healthcheck (verificação de antena online, resposta mais curta).
- `0x0077` relé: opção `0x02` aciona por ValidTime (10 s, o hardware solta sozinho — confirmado em campo); `0x01` solta.
- **O relé comanda o semáforo, não segura o portão.** O comando de abrir dá o pulso no motor (ciclo de abertura ~3 s); o motor fica aberto por 30 s pelo próprio temporizador e fecha logo após o veículo passar pelo sensor. Semáforo: verde a partir da leitura, vermelho `GATE_TIMEOUT_TO_CLOSE` (3 s, decisão do usuário — 2 s soltava o relé com o carro parado entre leituras) após a última leitura; com o carro parado na antena, o comando de abrir é renovado a cada 7 s para o verde não cair no 10º segundo. Não estender o verde depois que as leituras param: o portão já está fechando.
- `0x0076` máscara (fora do manual V1.0; leitura `CFFF00760102AB1B`, mesma configuração do 0x0073 em formato estendido). A antena **ignora dados de máscara todos zero** — o `FILTER_DATA` atual só garante máscara ligada, início 0 e 4 bytes; os dados valendo (`FF FF FF FF`, gravados pelo configurador) barram as TAGs de pedágio. Decisão do usuário: manter o `FILTER_DATA` como está.
- 🔴 **Nunca enviar `0x0052` (RFM_REBOOT)**: restaura a configuração de fábrica (IP, porta, modo, máscara). Não existe comando de reinício; reiniciar a antena só pela energia.
- A antena aceita mais de uma conexão TCP ao mesmo tempo (o configurador pode ficar conectado junto com o serviço).
- A leitura é disparada por um **laço indutivo**: a antena só lê com um veículo sobre o sensor, e então lê **todas** as TAGs no alcance. Na TAG2 (saída, dentro da garagem), a TAG de um carro estacionado de frente para a antena (0000572943) era lida durante a saída dos outros e abria o portão por eles. A potência da TAG2 foi reduzida de 28 para 27 dB em 11/10/2026, sem efeito.
- 🔴 **RSSI e potência não separam a TAG intrusa — não propor de novo** (decisão do usuário, 12/10/2026). Com o RSSI no log, a intrusa parada ficou entre -60 e -71 dBm, no meio da faixa dos carros que passam sob a antena (-46 a -76, ~60% mais fracos que ela): limite de RSSI ou potência menor derrubariam carros reais primeiro. Também descartada a ideia de "intrusa se movendo" pelo RSSI. A solução é a detecção por ciclos abaixo. O RSSI segue no log só como diagnóstico.

### Passagens, intrusas e gravação no ERP (`core/passage-tracker.ts`)

- **Ciclo** = portão aberto → fechado no software (`GateController`, `onCycleEnd`). A validação na API continua na primeira leitura (decide se abre); a **gravação no ERP acontece no fim do ciclo**, uma por TAG autorizada, com `dataHora` da primeira leitura (campo da v3 da nova-api), sem regravar a mesma TAG em 2 min.
- **Intrusa** = TAG em dois ciclos seguidos com 60 s–5 min entre as aparições (calibrado com uma semana real: com menos de 60 s, a mesma passagem dividida em dois ciclos marcava carros normais). Marcada em memória até reiniciar, por decisão do usuário (vaga fixa). Com outro veículo no ciclo é ignorada; só intrusas no laço (uma ou mais, contadas juntas para duas não travarem a saída), libera na 3ª leitura seguida (`INTRUDER_CONFIRMATIONS`; 5 reduziria ainda mais as aberturas falsas, com ~4 s de espera para o dono). `INTRUDER_DETECTION=false` desliga.
- **Fila**: TAG nova autorizada com o ciclo aberto reenvia o comando de abrir (o motor fecha após cada passagem).
- **"Manter aberto"** (porteiro, veículo sem TAG): uma TAG autorizada lida o cancela (`openGate` com `fromTag`) e o portão fecha 3 s após a última leitura, como na abertura com tempo.

### Recuperação da antena (não reintroduzir reconexão insistente)

Reconectar em sequência, ou o processo reiniciar sozinho, **não** recupera uma antena muda (crise de 10/10/2026 na TAG1); o que recupera é o stop/start do container. Por isso: qualquer comando sem nenhum byte de volta em `COMMAND_RESPONSE_TIMEOUT_MS` derruba a conexão → **uma** reconexão → se ela também não recebe nada, o health responde 503 e o `autoheal` faz stop/start (healthcheck do Docker em 10 s × 2). Uma reconexão basta para o caso comum (antena reiniciou por pico de energia). A reconexão única só é gasta quando a antena **conecta e fica muda**; se ela **nem aceita a conexão** (desligada ou ainda ligando), tenta a cada 3 s por até 30 s antes do 503 — reiniciar o container não adianta para antena desligada.

Teste de integração (fora do repositório): o código compilado roda contra uma antena falsa em 127.0.0.1 e com o axios substituído no próprio processo — nunca contra a antena ou a nova-api reais.

Ver `CHANGELOG.md` para o histórico completo com datas e detalhes.

## Outros serviços do ecossistema

- `nova-api`: valida a TAG lida (`API_BASE_URL`) e registra o acesso. Se a API estiver fora do ar, o TAG aborta o startup (`checkExternalApiHealth` em `server.ts`).
- `nova-cie`: central de incêndio, sem relação direta com este serviço.
- `FRONT`: não consome este serviço diretamente — só via `nova-api`.

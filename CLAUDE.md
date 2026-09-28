# nova-tag

Serviço de controle de acesso veicular via RFID do Condomínio Nova Residence. Comunicação TCP de baixo nível com antenas RFID físicas, validação de TAGs contra a `nova-api`, controle automático de portões.

Veja `README.md` para visão completa (arquitetura, endpoints, monitoramento) e `CHANGELOG.md` para o histórico. Este arquivo é o contexto operacional para trabalhar no código.

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

**Regra crítica**: existe **uma única conexão TCP física** com cada antena por processo. `AntennaManager` é criado uma vez em `server.ts` e passado por injeção para a camada HTTP (`StartWebServer(antennaInstance)`) — nunca instanciar um segundo `AntennaManager` para a mesma antena, mesmo ao adicionar uma futura v3. v2 e v3 (se vier a existir) devem compartilhar a mesma instância.

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

Ver `CHANGELOG.md` para o histórico completo com datas e detalhes.

## Outros serviços do ecossistema

- `nova-api`: valida a TAG lida (`API_BASE_URL`) e registra o acesso. Se a API estiver fora do ar, o TAG aborta o startup (`checkExternalApiHealth` em `server.ts`).
- `nova-cie`: central de incêndio, sem relação direta com este serviço.
- `FRONT`: não consome este serviço diretamente — só via `nova-api`.

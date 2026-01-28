# Changelog - Módulo de Comunicação com Antena RFID

Todas as mudanças neste projeto são documentadas neste arquivo.

## [2.0.0] - 2026-01-27
### Adicionado
- Reestruturação completa da arquitetura do projeto com separação em camadas (controllers, core, routes, utils).
- API Web Server com Express para gerenciamento remoto do sistema.
- Documentação automática com Swagger em `/swagger`.
- Endpoint `/health` para monitoramento do status do sistema e antena.
- Endpoints REST para controle do portão: `/api/gate/open` e `/api/gate/close`.
- Classe `AntennaManager` centralizada para gerenciamento da conexão e comunicação com a antena.
- Classe `GateController` para lógica de controle do portão e temporizadores.
- Classe `TagValidator` para validação de TAGs com integração à API externa.
- Sistema de rotas modular com Express Router.
- Suporte a Docker com Dockerfile otimizado e múltiplos ambientes (.env).

### Melhorado
- Separação clara de responsabilidades entre camadas (API, Controllers, Core, Routes).
- Organização do código em módulos reutilizáveis e testáveis.
- Logger padronizado com suporte a contexto e tipos (`info`, `error`, `debug`).
- Tratamento de erros centralizado e respostas HTTP padronizadas.
- Configuração de ambiente mais robusta com validação de variáveis obrigatórias.
- Documentação do código com JSDoc e comentários de contexto.

### Alterado
- Migração de aplicação monolítica para arquitetura modular em camadas.
- Controle de portão agora pode ser acionado via API REST além da leitura RFID.
- Logger migrado para módulo utilitário com contexto personalizado.

## [1.1.1] - 2025-04-24  
### Corrigido  
- Corrigido problema em que o comando de filtro (`FILTER_CMD`) não era aplicado corretamente ao conectar a antena.
- Adicionada uma pausa de 1 segundo após o envio do comando de **fechamento do portão**, garantindo que o comando de filtro seja aceito pela antena.

### Melhorado  
- Execução sequencial dos comandos de sincronização (fechamento do portão e configuração do filtro), evitando colisões de buffer e falhas na inicialização da antena.


## [1.1.0] - 2025-04-24
### Adicionado
- Comando de filtro por máscara RFID (`FILTER_CMD`) ao iniciar a conexão com a antena, bloqueando leituras de TAGs indesejadas (ex: Sem Parar).
- Verificação da resposta da antena ao comando de filtro (`0x73`) com confirmação de sucesso ou erro.
- Validação da resposta da máscara via prefixo `cf000073020001`.
- Destruição imediata do socket e reconexão forçada em caso de falha ao aplicar a máscara.

### Corrigido
- `resetCloseTimer()` agora é chamado **somente após confirmação da abertura do portão**, garantindo que o estado já esteja `OPEN` antes do temporizador iniciar.
- Correção da ordem de envio dos comandos na conexão: agora o comando de sincronização (`RELAY_CLOSE_CMD`) é seguido corretamente pelo comando de máscara (`FILTER_CMD`).

### Melhorado
- Logs mais claros para depuração, incluindo:
  - Logs específicos para resposta de máscara aplicada.
  - Logs de erro em casos de falha na aplicação da máscara.
  - Identificação de mensagens desconhecidas com conteúdo em hexadecimal.
- Isolamento completo do controle de fluxo por máscara e maior confiabilidade ao conectar/reconectar.

## [1.0.6] - 2025-04-23
### Corrigido
- Corrigido erro de ordem na execução do temporizador de fechamento do portão (`resetCloseTimer`), que era disparado antes da atualização do estado `gateState` para `OPEN`.
- A função `resetCloseTimer` foi movida para dentro do callback de `sendCommand(RELAY_OPEN_CMD)` garantindo consistência entre o estado do portão e o acionamento do temporizador.

## [1.0.5] - 2025-04-23
### Adicionado
- Implementado temporizador global para fechamento automático do portão (`GATE_TIMEOUT_TO_CLOSE`).
- Portão agora é fechado automaticamente após um tempo definido, com reinício do contador ao ler a mesma TAG novamente.
- Adicionadas novas métricas: `OPEN_GATE`, `CLOSE_GATE`, `AUTHORIZED`.

### Corrigido
- Resposta da antena para comando de fechamento agora verifica `cf000077020001` como retorno válido.
- Timeout de healthcheck não interfere mais no fechamento do portão em andamento.

### Melhorado
- Organização do reset do temporizador `closeGateTimeout` para evitar múltiplas execuções concorrentes.
- Comentários adicionais no código para facilitar manutenção e entendimento futuro.

## [1.0.4] - 2025-04-22
### Adicionado
- Envio de métricas para o PM2+ com `logger.metric("LAST_TAG_READED", tagNumber)`.
- Logger agora suporta `logger.metric()` e `logger.issue()`.
- Adicionado controle de tentativas de reconexão do socket (`connectionRetry`) com encerramento forçado após 10 falhas para reinício via PM2.
- Organização e finalização de estrutura para encerramento seguro com `SIGINT`.

## [1.0.3] - 2025-04-22
### Corrigido
- Correção na utilização do `setImmediate` dentro dos eventos `timeout` e `error`.
- Correção do `logger.error` para gerar automaticamente um issue para o PM2+.
- Revisão da estrutura do logger para encapsular envio de métricas e erros com `@pm2/io`.

## [1.0.2] - 2025-04-21
### Corrigido
- Revisão dos eventos do socket para garantir destruição segura do `socketInstance`.
- Adicionado controle `isShuttingDown` para evitar múltiplas finalizações simultâneas.

## [1.0.1] - 2025-04-21
### Corrigido
- Substituído o uso do BetterStack por métricas e notificações do PM2+.
- Ajustado logger para remover integração com API externa e focar no ambiente de execução com PM2.

## [1.0.0] - 2025-04-21
### Adicionado
- Implementação da lógica de conexão TCP com a antena RFID.
- Identificação e validação de TAGs.
- Comunicação com API de autorização e registro de acesso.
- Controle automático de abertura e fechamento do portão com base na leitura.
- Mecanismo de healthcheck por timeout.
- Reconexão automática com backoff básico.
- Logger com `winston` e rotação de arquivos.
- Suporte a configuração via `.env`.

# Changelog - Módulo de Comunicação com Antena RFID

Todas as mudanças neste projeto são documentadas neste arquivo.

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

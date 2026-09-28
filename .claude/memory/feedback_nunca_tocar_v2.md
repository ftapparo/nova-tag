---
name: feedback-nunca-tocar-v2
description: REGRA ABSOLUTA — nunca editar código v2 (Express) em nenhum dos 4 projetos, em nenhuma circunstância
metadata:
  type: feedback
---

**Nunca editar, refatorar ou "atualizar para usar a v3" nenhum arquivo dentro de `src/v2/` (ou equivalente) em nenhum dos projetos (`nova-api`, `nova-tag`, `nova-cie`) — em nenhuma circunstância, mesmo que pareça conveniente para "fechar a cadeia de segurança ponta a ponta" ou simplificar uma migração.**

**Why:** dado em 28/09/2026 em maiúsculas e com múltiplas exclamações ("NA V2 EM QUALQUER PROJETO NÃO TOCA JAMAIS!!!"), depois de eu sugerir atualizar `cie-gateway.controller.ts` (v2 da nova-api) para chamar a v3 do CIE com o novo token de serviço. A v2 é a superfície em produção real, atendendo moradores e portaria agora — qualquer mudança nela é risco direto à operação do condomínio, mesmo que a intenção seja boa. Todo o racional de core/v2/v3 documentado no CLAUDE.md de cada projeto já dizia "v2 intocada", mas essa instrução eleva isso de convenção de arquitetura para regra inegociável de segurança operacional.

**How to apply:** ao planejar qualquer tarefa que envolva v3 (nova rota, nova integração, correção de bug até), nunca propor tocar em `src/v2/` como parte do escopo — nem como opção B, nem "só esse arquivo". Se uma tarefa parecer exigir mudança na v2 para funcionar, parar e perguntar antes de escrever qualquer diff ali, deixando claro que normalmente a resposta será não. A v2 só muda por decisão explícita e isolada do usuário, nunca como efeito colateral de trabalho na v3.

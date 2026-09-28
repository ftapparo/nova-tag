---
name: feedback-env-vars-top-level
description: Nunca ler process.env no topo de um módulo que é importado antes de dotenv.config() rodar
metadata:
  type: feedback
---

Em módulos que podem ser importados antes de `dotenv.config()` rodar (qualquer arquivo importado, direta ou indiretamente, por `server.ts` antes da linha do `dotenv.config()`), nunca ler `process.env.X` numa `const` no nível do módulo. Em CommonJS/ESM, todos os imports são resolvidos e seus módulos executados **antes** de qualquer código no nível do módulo que os importou — então uma leitura de env var no topo de um módulo importado captura sempre o valor anterior ao carregamento do `.env` (geralmente `undefined`).

**Why:** dado em 28/09/2026 ao criar as rotas de proxy `tag.routes.ts`/`cie.routes.ts` na `nova-api` — `TAG_SERVICE_TOKEN` e `CIE_SERVICE_TOKEN` eram lidos como `const` no topo do módulo, resultando em token vazio (`''`) enviado em toda chamada, causando `401` no TAG e comportamento incorreto no CIE. Diagnosticado testando a mesma rota diretamente contra o TAG com o token correto (funcionou), depois revisando a ordem de `import` vs. `dotenv.config()` em `server.ts`.

**How to apply:** sempre envolver a leitura de `process.env` numa função (`const resolveX = (): string => process.env.X ?? ''`) e chamar essa função no momento do uso (dentro do handler da rota, por exemplo), nunca capturar o valor numa constante de módulo. Vale para os 4 projetos — qualquer arquivo em `core/` ou `v3/routes/` que dependa de env var carregada via `.env`.

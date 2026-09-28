---
name: feedback-erros-auth-genericos
description: Mensagens de erro de autenticação/autorização são genéricas, sem detalhar o mecanismo interno
metadata:
  type: feedback
---

Mensagens de erro para falhas de autenticação/autorização (401/403) — tanto em runtime (`detail` do erro) quanto em documentação pública (spec OpenAPI, Swagger) — são genéricas, do tipo "Não autorizado.". Nunca mencionar o nome do mecanismo interno (ex.: "token de serviço", "CIE_SERVICE_TOKEN"), quem mais participa do fluxo (ex.: "nova-api"), nem explicar como a autenticação funciona.

**Why:** dado em 28/09/2026 ao revisar o spec OpenAPI do CIE — a descrição do `securityScheme` e as mensagens de erro explicavam em detalhe o esquema de token de serviço entre projetos. O usuário apontou que isso é reconhecimento de graça para um atacante: quanto menos informação um erro 401 revela sobre como a autenticação é feita, melhor. Renomeado de `ServiceToken` para `ApiToken` no spec, descrição reduzida a "Token de acesso à API.".

**How to apply:** ao escrever qualquer resposta de erro relacionada a auth (401 unauthorized, 403 forbidden) ou ao documentar um `securityScheme` num spec público, usar texto mínimo e genérico. Detalhes de arquitetura de autenticação (como o token é validado, quem mais está envolvido, nome de variáveis de ambiente) ficam só em `docs/` interno e comentários de código, nunca em algo que sai como resposta HTTP ou aparece em documentação pública. Vale para os 4 projetos.

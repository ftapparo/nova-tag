---
name: feedback-estilo-descricoes
description: Regra de estilo — descrições técnicas (código, specs OpenAPI, docs) são curtas, técnicas e na terceira pessoa impessoal
metadata:
  type: feedback
---

Toda descrição técnica escrita (comentários de código, campos `description`/`summary` de specs OpenAPI, documentação em `docs/`) deve ser: técnica, curta o suficiente mas com informação útil, e escrita na terceira pessoa do impessoal. Evitar primeira pessoa do plural ("nossa extensão", "usamos", "nosso padrão") e evitar se dirigir ao leitor na segunda pessoa ("você pode", "veja que").

**Why:** dado em 28/09/2026 ao revisar o `openapi.json` da v3 da `nova-api` — a descrição do endpoint de saúde estava longa e com tom explicativo demais; o usuário pediu texto técnico, direto, impessoal.

**How to apply:** ao escrever qualquer `description`/`summary` em specs OpenAPI, comentários de código voltados a documentação (não comentários de raciocínio interno), ou arquivos em `docs/`, preferir formas verbais na terceira pessoa ("confirma", "retorna", "verifica", "aplica-se") em vez de primeira pessoa ("garantimos", "nosso mecanismo") ou segunda pessoa ("você recebe"). Vale para os 4 projetos (API, TAG, CIE, FRONT) — é convenção de escrita, não específica de um repositório.

---
name: feedback-swagger-publico
description: Regra — o spec OpenAPI/Swagger é documentação pública da API, nunca cita documentos internos de desenvolvimento
metadata:
  type: feedback
---

O conteúdo de `openapi.json` (ou qualquer spec Swagger/OpenAPI servido publicamente) nunca referencia documentos internos de desenvolvimento (ex.: `docs/PADRAO-RESPOSTA-V3.md`), RFCs de design interno, ou nomes de framework/biblioteca usados na implementação (Fastify, Zod, etc.). Descrições no spec explicam o comportamento observável da API para quem a consome, não decisões de arquitetura interna.

**Why:** dado em 28/09/2026 ao revisar o `openapi.json` da v3 — a primeira versão citava `docs/PADRAO-RESPOSTA-V3.md`, RFC 7807 e "Fastify" nas descrições. O usuário apontou que isso é informação de desenvolvimento interno, sem lugar num documento que é exposto a quem consome a API (front, mobile, terceiros).

**How to apply:** ao escrever ou revisar qualquer `description`/`summary` dentro de um arquivo de spec OpenAPI, perguntar "um consumidor externo da API precisa saber disso?" — se a resposta for não (nome de framework, RFC de referência, doc interno), reescrever de forma comportamental (o que o campo representa/faz), sem a referência interna. Documentos como `docs/PADRAO-RESPOSTA-V3.md` continuam podendo citar RFCs e frameworks livremente — a restrição é só sobre o conteúdo do spec público em si.

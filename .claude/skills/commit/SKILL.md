---
name: commit
description: Fluxo padronizado de commit para este projeto — separação lógica de mudanças, mensagem completa, atualização do CHANGELOG e aprovação explícita antes de commitar e antes de dar push. Use sempre que o usuário pedir para "commitar", "fazer um commit" ou quando o trabalho da tarefa estiver pronto para ser salvo no git.
---

# Fluxo de commit

Este projeto usa um fluxo de commit específico, diferente do padrão genérico do Claude Code. Siga estes passos, nesta ordem, sempre que for commitar.

## 1. Revisar o que mudou

Rode `git status` e `git diff` (ou `rtk git status`/`rtk git diff`) para ver tudo que está pendente. Não assuma — leia o diff real antes de agrupar.

## 2. Separar por grupo lógico

Se as mudanças pendentes cobrem coisas **não relacionadas** (ex.: uma correção de bug + uma feature nova, ou uma mudança de infra + um ajuste de documentação), separe automaticamente em commits distintos por tipo/propósito de mudança. Não pergunte antes de propor a divisão — monte os grupos você mesmo e apresente todos de uma vez na etapa 4.

Critério prático: arquivos que mudaram pelo mesmo motivo (mesma causa raiz, mesma feature, mesma correção) formam um commit. Arquivos que mudaram por motivos diferentes, mesmo que na mesma sessão, viram commits separados.

## 3. Atualizar o CHANGELOG.md antes do commit

Para cada grupo de mudança que vai virar commit, adicione uma entrada correspondente em `CHANGELOG.md`, sempre sob a seção `## [Unreleased]` (nas subsecções `### Adicionado`, `### Corrigido`, `### Alterado`, conforme o caso — formato Keep a Changelog já usado neste projeto).

**Nunca crie uma seção de versão numerada nem toque no `package.json` nesta etapa.** Isso só acontece quando o usuário pedir explicitamente para "versionar" (ver seção 7 abaixo).

Inclua a atualização do `CHANGELOG.md` como parte do mesmo commit ao qual ela se refere (não um commit de changelog separado).

## 4. Montar a mensagem de commit completa

Formato: **subject curto no padrão atual do projeto** (mesmo estilo dos commits existentes — `tipo(escopo): descrição breve`) seguido de um **corpo completo** explicando o que foi feito e por quê. Não é um processo de duas etapas (não existe amend) — a mensagem já nasce completa.

```
tipo(escopo): descrição curta no padrão já usado no projeto

Corpo detalhado: o que mudou, por que mudou, e qualquer contexto que
alguém lendo o histórico depois vá precisar (causa raiz de um bug,
decisão de design, referência a uma issue/conversa). Pode ter várias
linhas e parágrafos.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

Consulte `git log --oneline -20` se precisar confirmar o padrão de subject usado neste repositório especificamente.

## 5. Apresentar para aprovação — ANTES de commitar

Mostre ao usuário, para cada commit proposto:
- Quais arquivos entram nele
- A mensagem completa (subject + body)
- O trecho correspondente que foi adicionado ao CHANGELOG.md

Espere aprovação explícita antes de rodar `git add`/`git commit`. Se houver múltiplos commits propostos, apresente todos juntos, na ordem em que seriam criados.

## 6. Commitar após aprovação, perguntar antes do push

Depois de aprovado, crie o(s) commit(s) na ordem apresentada. **Não dê push automaticamente.** Pergunte explicitamente se pode fazer push, e só rode `git push` após autorização explícita para aquele push específico (autorização de uma vez não vale para pushes futuros).

## 7. Versionamento — só quando pedido explicitamente

Quando (e somente quando) o usuário disser algo como "versionar", "criar uma versão", "fechar a release":

1. Decida o próximo número de versão (semver) com base no conteúdo de `[Unreleased]` — mudança incompatível → major, funcionalidade nova → minor, correção → patch. Se não estiver óbvio, pergunte.
2. Transforme a seção `## [Unreleased]` em `## [x.y.z] - AAAA-MM-DD` (data de hoje), mantendo o conteúdo.
3. Crie uma nova seção `## [Unreleased]` vazia no topo, para o próximo ciclo.
4. Atualize `"version"` no `package.json` do projeto para o mesmo número.
5. Apresente esse commit de versionamento separadamente dos demais (não misture com commits de código), seguindo o mesmo fluxo de aprovação das etapas 5 e 6.

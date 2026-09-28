---
name: feedback-padroes-compartilhados
description: Regra de processo — mudança em padrão compartilhado entre os 4 projetos exige perguntar antes de propagar
metadata:
  type: feedback
---

Sempre que uma mudança tocar num padrão compartilhado entre `nova-api`, `nova-tag`, `nova-cie` e `FRONT` (ex.: o modelo de resposta da v3, `docs/PADRAO-RESPOSTA-V3.md`; ou este próprio fluxo de commit), perguntar explicitamente ao usuário se deve replicar a mudança nos outros projetos antes de considerar o trabalho concluído. Nunca replicar automaticamente sem perguntar, e nunca deixar de perguntar.

**Why:** dado em 28/09/2026, logo depois de criar o padrão de resposta da v3 só na `nova-api`. O usuário apontou que qualquer ajuste feito num padrão compartilhado precisa necessariamente perguntar antes de propagar — do contrário os quatro projetos divergem silenciosamente e a v3 de cada backend acaba com um formato de resposta ligeiramente diferente, o que anula o propósito de ter um padrão único (motivação original: um único interceptor HTTP no app mobile, sem lógica por serviço).

**How to apply:** antes de fechar qualquer tarefa que mexeu em algo documentado como "vale para os 3 backends" ou que vive em `docs/` na raiz do workspace (não dentro de um repositório específico), parar e perguntar. Ver `[[commit]]` (skill) seção 8 para o texto operacional completo.

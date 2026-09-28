# Memory Index — nova-tag

Índice de memórias persistentes deste projeto. Cada linha aponta para um arquivo em `.claude/memory/` com contexto detalhado (decisão técnica, preferência de trabalho, ou fato de projeto).

- [Padrões compartilhados exigem pergunta antes de propagar](feedback_padroes_compartilhados.md) — mudar algo em `docs/PADRAO-RESPOSTA-V3.md` ou no fluxo de commit? pergunte antes de replicar nos outros 3 projetos
- [Descrições técnicas: curtas, terceira pessoa impessoal](feedback_estilo_descricoes.md) — vale para specs OpenAPI, comentários de doc e arquivos em docs/, nos 4 projetos
- [Spec OpenAPI/Swagger é documentação pública](feedback_swagger_publico.md) — nunca cita docs internos, RFCs de design ou nomes de framework/biblioteca
- [🔴 REGRA ABSOLUTA: nunca tocar em código v2](feedback_nunca_tocar_v2.md) — em nenhum dos 4 projetos, em nenhuma circunstância, mesmo que pareça conveniente
- [Erros de auth são genéricos, sem detalhar mecanismo](feedback_erros_auth_genericos.md) — 401/403 nunca mencionam nome do token/variável nem quem participa do fluxo
- [Nunca ler process.env em const de topo de módulo](feedback_env_vars_top_level.md) — sempre envolver em função, chamada no momento do uso; imports resolvem antes de dotenv.config()

<!-- Adicionar entradas conforme decisões relevantes forem tomadas. Formato: - [Título](arquivo.md) — gancho de uma linha -->

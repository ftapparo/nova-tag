---
applyTo: '**'
---

## Nomeação de Arquivos e Pastas

- Pastas e arquivos seguem nomes descritivos e em inglês, exceto rotas e controllers que podem usar português para clareza do domínio.
- Arquivos de teste usam o sufixo `.test.ts` e ficam em `__tests__/<domínio>/`.
- Arquivos → kebab-case
- Classes/Interfaces/Enums → PascalCase
- Variáveis/Funções/Métodos → camelCase
- Constantes globais/env → UPPER_SNAKE_CASE

## Padrão de Escrita de Código

- Utiliza TypeScript com tipagem estrita (`strict: true` no tsconfig).
- Funções e métodos exportados sempre tipados explicitamente.
- Preferência por funções assíncronas (`async/await`) para operações I/O.
- Variáveis de ambiente acessadas via `process.env` e validadas no início dos módulos.
- Uso de constantes para nomes de filas, exchanges, rotas e variáveis de ambiente.

## Comentários

- Cabeçalhos de seção em arquivos:
  ```ts
    /**
    * @file Nome do arquivo
    * @description Descrição completa do arquivo e seu propósito
    * @date Data de criação
    */
  ```
- Comentários de documentação em formato JSDoc acima de funções, métodos e controllers:
  ```ts
  /**
   * Descrição da função
   * @param param Descrição do parâmetro
   * @returns Descrição do retorno
   */
  ```
- Comentarios do Swagger. Todos os arquivos de controller possuem anotações Swagger:
  ```ts
  function example() {
    // #swagger.tags = ['Tag nome do arquivo']
    // #swagger.description = 'Descrição da rota'
  }
  ```
- Comentários explicativos em português, claros e objetivos.
- Blocos de código complexos recebem comentários de contexto.
- Controllers, services e integrações possuem comentários de alto nível sobre o propósito do módulo.

## Uso de console.log e console.error

- Logs de inicialização e eventos importantes usam `console.log` com prefixo identificador:
  ```ts
  console.log('[Api] Servidor rodando na porta 80');
  ```
- Erros e exceções usam `console.error` com contexto:
  ```ts
  console.error('[NotificationController] Erro ao enviar notificação:', error);
  ```
- O uso de logs de debug é controlado pela variável de ambiente `DEBUG`. Se `DEBUG=true`, logs adicionais são exibidos.
- Evitar `console.log` em produção para dados sensíveis.

## Documentação

- Documentação da API via Swagger, disponível em `/swagger`.
- Rotas e controllers possuem anotações Swagger para geração automática da documentação.

## Docker e Ambiente

- Dockerfile documentado e com build multiambiente.
- Uso de múltiplos arquivos `.env` para ambientes (`local`, `dev`, `qa`, `homol`, `prod`).
- Scripts npm para build, execução e testes descritos no README.

## Resumo dos Princípios

- Clareza e separação de responsabilidades
- Nomeação descritiva e consistente
- Tipagem explícita e uso de TypeScript
- Comentários de documentação e contexto
- Logs com contexto e controle por ambiente
- Testes automatizados e organizados
- Documentação automática via Swagger
- Facilidade de build e execução via Docker/npm

---

Essas instruções refletem o padrão de escrita, organização e boas práticas adotadas neste projeto.

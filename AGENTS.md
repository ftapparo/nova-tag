# AGENTS.md

## Purpose

This file is the operational guide for AI coding agents working in this repository.

Keep the working context minimal. Do not read large parts of the repository unless the task requires it.

Prefer local discovery over global exploration.

For project-specific context (what this service does, real architecture, hard rules, known bugs), see `CLAUDE.md` — read it first, always.

---

## Stack

- Runtime: Node.js 20
- Language: TypeScript
- HTTP framework: Express (`v2/`, current production) and Fastify (`v3/`, new)
- Validation: Zod (`v3/` only)
- Physical integration: raw TCP socket to the RFID antenna (`net`)
- Package manager: npm

---

## Repository Structure

```text
src/
├── core/           # Business logic, framework-agnostic — antenna-manager.ts owns the SINGLE TCP connection
├── v2/             # Express API — production surface, NEVER edit (see CLAUDE.md)
├── v3/             # Fastify + Zod API, feature-first modules
│   ├── health/
│   ├── gate/
│   ├── cache/
│   └── shared/     # Truly cross-cutting only: response envelope, service-auth, tag.schema (shared by gate/ and cache/)
└── server.ts       # Entry point — picks TAG1/TAG2 config, creates ONE AntennaManager

docs/                          # workspace root, shared across all 4 projects
└── PADRAO-RESPOSTA-V3.md      # v3 response envelope, service auth, folder convention

AI-Friendly Architecture Specification.md   # workspace root — architectural rationale
```

Do not load `docs/PADRAO-RESPOSTA-V3.md` or the architecture spec unless the task touches `v3/`.

---

## Context Strategy

For every task, minimize the amount of unrelated context loaded.

Use this discovery order:

1. Read `CLAUDE.md` (project context, hard rules, TAG1 vs TAG2 note).
2. Identify whether the task is `core/`, `v2/`, or `v3/`.
3. Inspect files inside that area.
4. Check whether the module contains its own `AGENTS.md` (rare — only for modules with non-obvious protocol/security context).
5. Read `docs/PADRAO-RESPOSTA-V3.md` only when the task touches `v3/`.
6. Use repository-wide search when local discovery is insufficient.

Do not explore the entire repository by default.

---

## Core Architecture Rules

### Feature Locality

Inside `v3/`, keep feature-specific code inside its own folder (`gate/gate.routes.ts`, `cache/cache.routes.ts`). Do not distribute a `v3/` feature across global `routes/`/`controllers/` folders — that pattern was tried and reverted.

### Cohesion

Keep related code together. Separate code when responsibilities differ, not merely because a pattern allows another file.

### Progressive Complexity

Start with the simplest structure that correctly represents the domain. `v3/` began as `routes/` + `lib/` and was reorganized to feature folders only once there was enough real code to justify it.

### Boundaries

- `core/` never imports Express or anything from `v2/`.
- There is exactly **one** physical TCP connection to each antenna per process. `AntennaManager` is created once in `server.ts` and injected into both `v2/` and `v3/` — never instantiate a second one.
- `v2/` is the production surface. **Never edit it** — see the hard rule in `CLAUDE.md`.

### Abstractions

Do not create interfaces, factories, or wrappers without concrete value. `v3/shared/tag.schema.ts` exists because both `gate/` and `cache/` use it — that is the bar for extracting a schema to `shared/`.

---

## Shared Code

`v3/shared/` is reserved for code genuinely shared across `v3/` features (response envelope, service-auth, schemas used by 2+ routes). A schema used by only one route stays inside that route's folder.

Do not use `lib/` or `utils/` as generic dumping grounds.

---

## Naming

Prefer `<feature>.routes.ts`, `<feature>.schema.ts` inside `v3/`. Avoid vague names like `manager.ts`, `helper.ts` when a more specific name is possible — the one exception already in the codebase (`antenna-manager.ts`, `gate-controller.ts`) predates this convention and is not being renamed without a concrete reason.

---

## Scope Discipline

Keep changes focused on the requested task. Do not perform unrelated refactoring, rename unrelated files, or modify `v2/` as a side effect of a `v3/` change.

---

## Validation

Before considering a change complete, run:

```bash
npx tsc --noEmit   # type check
npm run build      # full compile
```

**Do not run `npm run dev`/`npm start` against this repository locally.** This service connects to real physical hardware (the RFID antenna) — running it outside the actual deployment risks conflicting with production. Validate with type-check and build only; if runtime behavior must be verified, do it through the deployed server (with explicit user approval for anything that touches the physical antenna).

There is no lint or automated test suite configured in this project yet.

---

## Dependencies

Before adding a new dependency, verify the requirement cannot reasonably be implemented with what is already installed. Prefer established, maintained libraries.

---

## Comments

Comments explain **why**, not **what**. Non-obvious hardware/protocol constraints (handshake timeout, healthcheck guard window, filter mask format) are already documented as comments near the affected code — follow that pattern.

---

## Error Handling

- Never hardcode credentials, log secrets, or log tokens.
- `v3/` error responses (401/403) are generic ("Não autorizado.") — never name the internal mechanism (env var, token name) in a response that could be publicly visible via Swagger.

---

## Security

Treat all external input as untrusted. Validate inputs at system boundaries (Zod in `v3/`).

`TAG_SERVICE_TOKEN` authenticates the `nova-api` gateway, not end users — this is a service-to-service credential, not a substitute for user authorization (which is `nova-api`'s responsibility).

---

## Before Creating a New File

Ask:

1. Does this represent a distinct responsibility?
2. Could it remain coherently with existing code in the same feature folder?
3. Does separation improve context locality?

---

## Before Completing a Task

Verify:

- the requested behavior is implemented;
- `v2/` was not touched;
- `npx tsc --noEmit` passes;
- `npm run build` passes;
- the process was NOT run locally (physical hardware);
- CHANGELOG.md was updated (see the `commit` skill for the full flow);
- documentation was updated when `v3/` structure or the response envelope changed.

---

## Primary Principle

When choosing between two implementations, prefer the one that allows a future developer or agent to understand and modify the feature while loading the least amount of unrelated context.

> Keep related code together.
> Preserve meaningful boundaries.
> Prefer explicit, simple structures.
> Load context progressively.
> Optimize for relevant context, not minimum file count.

# Shared

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The foundation layer of the monorepo. Pure TypeScript types, branded IDs, message-protocol contracts, RPC type definitions, Zod schemas, and runtime-agnostic utilities consumed by **both** backend and frontend libs (and both apps).

## Boundaries

**Belongs here**: types, type guards, Zod schemas, branded IDs, message protocol envelopes, RPC contracts, pure utilities (no Angular / no VS Code / no Node-only APIs unless trivially gated), constants.
**Does NOT belong**: business logic, UI components, infrastructure (file I/O, IPC), framework-specific code, runtime side effects. This lib is the ONE place backend and frontend share — do not put one-sided concerns here.

## package.json

`@ptah-extension/shared`, `private`, `type: "commonjs"`, has a secondary entry `./testing`. Runtime deps: `uuid`, `zod`, `jsonrepair`, `reflect-metadata`, `tsyringe`. The presence of `tsyringe`/`reflect-metadata` is intentional — DI tokens are defined here so both sides bind against the same symbols.

## Public API (from `src/index.ts`)

### Type modules (`src/lib/types/*.types.ts`)

`agent-adapter`, `agent-permission`, `agent-process`, `ai-provider`, `anti-pattern-rules`, `auth-env`, `auth-strategy`, `branded`, `claude-domain`, `cli-skill-sync`, `command-builder`, `common`, `content-block`, `mcp-directory`, `model-autopilot`, `permission`, `ptah-cli`, `quality-assessment`, `reliable-workflow`, `rpc` (root + subfolder), `subagent-registry`, `tool-registry`, `webview-ui`.

### Type subfolders

- `src/lib/types/execution/` — `agent`, `factories`, `guards`, `node`, `schemas`, `stream`, `stream-background` (the execution tree / streaming model).
- `src/lib/types/messages/` — `envelope`, `message-type`, `message-constants`, `payload-map`, `schemas`, `helpers`, plus per-surface payload modules (`agent`, `chat`, `gateway`, `session`, `system`, `workspace`).
- `src/lib/types/rpc/` — one file per RPC namespace (agents, auth, chat, config, editor, error-codes, git, harness, indexing, memory, misc, persistence, providers, session, setup, terminal). **`rpc-error-codes.types.ts` is the single source of truth for error codes across backend + frontend.**
- `src/lib/types/wizard/` — `analysis`, `conventions`, `phase`, `recommendations`, `steps`.

### Type guards (`src/lib/type-guards/guards`)

Centralized runtime narrowing helpers.

### Utilities (`src/lib/utils/`)

- `Result` (Result type), `retry.utils`, `json.utils` (with `jsonrepair`), `WorkspacePathEncoder`, `assertNever`, `parseWorktreeList` (`git.utils`), `image-media-type`, `pickPrimaryModel` (`ModelUsageEntry`), `message-normalizer`, `pricing.utils`, `session-totals.utils`, `subagent-cost.utils`.
- Barrel: `src/lib/utils/index.ts`.

### Constants (`src/lib/constants/`)

`trial.constants`, `environment.constants`.

## Key Files

- `src/lib/types/branded.types.ts` — branded ID system (SessionId, MessageId, etc.).
- `src/lib/types/rpc.types.ts` + `src/lib/types/rpc/` — RPC namespace contracts. **Adding a new namespace requires changes here (compile-time) AND in the backend's `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES` (runtime guard) — missing the latter causes silent runtime crash** (see user memory `project_rpc_registration_pattern.md`).
- `src/lib/types/messages/message-type.ts` + `message-constants.ts` + `payload-map.ts` — message protocol; `payload-map.ts` maps message types to their payload shapes.
- `src/lib/utils/pricing.utils.ts` / `session-totals.utils.ts` / `subagent-cost.utils.ts` — cost/token math used by both sides; must remain deterministic and side-effect-free.

## Dependencies

**Internal**: none (foundation layer — must not import any other `@ptah-extension/*` lib).
**External**: `zod`, `uuid`, `jsonrepair`, `tsyringe`, `reflect-metadata`.

## Dependents

All backend libs, all frontend libs, both apps (`ptah-extension-vscode`, `ptah-extension-webview`, electron app, CLI).

## Guidelines

1. **Use branded IDs at every boundary** — never accept bare `string` for a domain ID.
2. **Never re-export from another `@ptah-extension/*`** — would invert the dependency graph.
3. **Keep utilities pure** — no `fs`, no `vscode`, no Angular, no DOM. If you need a side-effecting helper, put it in the relevant backend/frontend lib.
4. **Adding an RPC namespace = TWO sites.** Compile-time in `rpc.types.ts` / `rpc/` AND runtime in backend `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES`.
5. **Message protocol is append-only.** Adding a new `MessageType` requires extending `payload-map.ts` so the wire stays type-safe.
6. **Zod schemas live next to their types** (e.g. `messages/schemas.ts`, `execution/schemas.ts`) — backend validators and frontend parsers must use the same schema instance.
7. **Constants for trial/environment go here**, not in app-specific locations.

# Ptah CLI - Headless A2A Bridge

[Back to Main](../../CLAUDE.md)

> **Status — TASK_2026_104 Batch 11 (Final)**: The CLI is the headless
> agent-to-agent (A2A) bridge for the Ptah backend. The legacy Ink/React
> TUI shell has been deleted; `apps/ptah-cli` is now a pure
> `commander`-based router that drives the same DI graph used by the VS
> Code extension and the Electron app over JSON-RPC 2.0 stdio.

## Purpose

The **ptah-cli** application is the headless command-line surface for the
Ptah agent backend. It exposes the full DI container (agent-sdk,
rpc-handlers, workspace-intelligence, plugin loader, content download,
license + auth) as a single Node.js binary (`ptah` on PATH) intended to be
driven by external coding agents (OpenClaw / NemoClaw) via JSON-RPC 2.0
over `stdin`/`stdout`.

It provides:

- A `commander`-based subcommand router (`src/cli/router.ts`) with ~20
  first-class commands and ~70 sub-subcommands mapping 1:1 to the backend
  RPC handler graph (minus webview-only UI navigation)
- A persistent JSON-RPC 2.0 stdio session (`ptah interact`) that streams
  agent push events as notifications and accepts client-issued
  requests/responses (including approval gates and free-form questions)
  on stdin
- The same in-process RPC transport, DI container, and shared backend
  libraries used by Electron and the VS Code extension — there is no IPC
  boundary, the CLI runs the agent backend in-process

For user-facing documentation see [`README.md`](README.md). For protocol
details see [`docs/jsonrpc-schema.md`](docs/jsonrpc-schema.md). For
migration from the legacy TUI / `ptah run` / `ptah profile`, see
[`docs/migration.md`](docs/migration.md).

## Boundaries

**Belongs here**:

- Headless entry point (`src/main.ts`)
- Commander router (`src/cli/router.ts`) and command handlers
  (`src/cli/commands/*.ts`)
- JSON-RPC 2.0 server, encoder, push-event pipe, stdio approval bridge,
  chat bridge, OAuth URL openers, wizard phase-runner
  (`src/cli/jsonrpc/`, `src/cli/io/`, `src/cli/output/`,
  `src/cli/session/`, `src/cli/oauth/`, `src/cli/wizard/`)
- DI bootstrap (`src/di/container.ts`, `src/di/cli-adapters.ts`,
  `src/cli/bootstrap/with-engine.ts`)
- The in-process RPC transport (`src/transport/cli-message-transport.ts`,
  `cli-webview-manager-adapter.ts`, `cli-fire-and-forget-handler.ts`)
- The CLI RPC method registration service
  (`src/services/cli-rpc-method-registration.service.ts`)
- CLI-specific RPC handlers (`src/services/rpc/handlers/` — agent-rpc,
  workspace-rpc, git-rpc, settings-rpc, skills-sh-rpc re-implementations
  for the CLI runtime)
- Platform impls (`src/services/platform/cli-*.ts`) for commands, auth,
  save-dialog, model-discovery
- The `vscode` module shim (`src/shims/vscode-shim.ts`)

**Does NOT belong**:

- React / Ink UI components, contexts, hooks, themes (deleted in
  B11 — never coming back; see `docs/migration.md`)
- Business logic — belongs in backend libraries
  (`agent-sdk`, `rpc-handlers`, `workspace-intelligence`,
  `agent-generation`)
- Anthropic-compatible HTTP proxy (`ptah config proxy`) — Phase 2,
  out of scope for TASK_2026_104 (see `docs/migration.md` § Phase 1 vs
  Phase 2)

## Key Files

### Entry Points

- `src/main.ts` — headless entry point (parses argv, builds the
  `commander` router, dispatches to a command handler)
- `src/cli/router.ts` — full commander wiring; declares every subcommand
  - sub-subcommand and the resolved `GlobalOptions`
- `src/cli/bootstrap/with-engine.ts` — `withEngine({ mode })` DI bootstrap
  helper. Three modes:
  - `'none'` — no DI; for pure-`fs` commands (`harness init`,
    `harness status`, `agent list`, `config get/set/list`)
  - `'partial'` — Phase 0-2 only (config + logging + license); for
    light-weight RPC commands (`license status`, `auth status`,
    `provider status`)
  - `'full'` — all 5 phases (Sentry, License, Auth, RPC, agent-sdk,
    workspace-intel, agent-generation, vscode-lm-tools, plugin loader,
    content download); for chat / setup / wizard / generation commands
- `src/di/container.ts` — 5-phase DI bootstrap
- `src/di/cli-adapters.ts` — Logger + OutputManager adapters for the CLI
  runtime (`CliLoggerAdapter`, `CliOutputManagerAdapter`); honors
  `PTAH_LOG_LEVEL` (debug-level routes to stderr only)
- `src/services/cli-rpc-method-registration.service.ts` — registers the
  shared RPC handlers against the in-process transport. Post-B11 the
  exclusion list is ~22 entries (was ~62 pre-parity-audit); the
  `harness:*` / `mcpDirectory:*` / `skillsSh:*` / `agent:*` /
  `workspace:*` / `git:*` / `settings:*` clusters are all CLI-exposed.
- `src/transport/cli-message-transport.ts` — `transport.call(method,
params)` for in-process RPC
- `src/transport/cli-webview-manager-adapter.ts` — `EventEmitter` for push
  events
- `src/transport/cli-fire-and-forget-handler.ts` — permission/question
  response handler
- `src/shims/vscode-shim.ts` — minimal `vscode` module stub for the
  headless runtime

### Bridges + JSON-RPC primitives

- `src/cli/jsonrpc/types.ts` — JSON-RPC 2.0 envelope + `PtahNotification`,
  `PtahOutboundRequest`, `PtahInboundRequest`, `PtahErrorCode`,
  `ExitCode` enums (canonical schema source)
- `src/cli/jsonrpc/server.ts` — `JsonRpcServer.register` /
  `.unregister` / `.notify` / `.request` — pairs with stdin/stdout
- `src/cli/jsonrpc/encoder.ts` — JSON-RPC 2.0 envelope encoder
- `src/cli/io/stdin-reader.ts`, `src/cli/io/stdout-writer.ts` — NDJSON
  reader/writer (newline-delimited, with stdout drain awareness for
  Windows pipes)
- `src/cli/output/event-pipe.ts` — forwards backend push events
  (`setup-wizard.*`, `harness.*`, `plugin.*`, `mcp.*`, `agent.*`,
  `wizard.generation.*`) onto the JSON-RPC server as notifications
- `src/cli/output/formatter.ts` — `--human` mode pretty-printer
  (honors `NO_COLOR`, `PTAH_NO_TTY`)
- `src/cli/output/redactor.ts` — sensitive-key redaction for
  `--reveal`-gated commands
- `src/cli/session/chat-bridge.ts` — bridges the backend's
  fire-and-forget `chat:start | chat:continue` RPCs into JSON-RPC
  turn-completion semantics for `task.submit`; settles via
  `chat:complete | chat:error | task.cancel`
- `src/cli/session/approval-bridge.ts` — backend
  `permission.request | question.ask` ↔ JSON-RPC inbound
  `permission.response | question.response` requests; honors
  `PTAH_AUTO_APPROVE=true` for unattended runs
- `src/cli/oauth/headless-flow.ts`,
  `src/cli/oauth/jsonrpc-oauth-url-opener.ts`,
  `src/cli/oauth/stderr-oauth-url-opener.ts` — OAuth URL surfacing
  (JSON-RPC `oauth.url.open` request in `interact` mode; stderr print in
  one-shot mode)
- `src/cli/wizard/phase-runner.ts` — composable Setup-Wizard phase
  runner (used by `ptah setup`'s 5-phase orchestrator)

### Configuration

- `tsconfig.app.json` — TypeScript base
- `tsconfig.build.json` — build-time `paths.vscode` mapping to the shim
- `project.json` — Nx targets: `build`, `dev`, `serve`, `typecheck`,
  `lint`, `test`. The `external[]` list reflects the post-cleanup
  dependency set (no `react`, `ink*`, `@inkjs/ui`, `cli-highlight`,
  `marked-terminal`).
- `package.json` — declares `bin: { ptah: ./main.mjs }` and
  `name: '@ptah-extension/ptah-cli'` (will be flipped to
  `@ptah-extensions/cli` for the public npm publish)
- `jest.config.cjs` — Jest config (`displayName: 'ptah-cli'`)

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Node.js process (single, headless)                                  │
├──────────────────────────────────────────────────────────────────────┤
│  main.ts                                                             │
│    ↓                                                                 │
│  commander router (src/cli/router.ts)                                │
│    ├── ptah session start|resume|send|list|stop|delete|...           │
│    ├── ptah harness init|status|scan|apply|preset|chat|...           │
│    ├── ptah agent packs list|install / agent list|apply              │
│    ├── ptah agent-cli detect|config|models|stop|resume               │
│    ├── ptah auth status|login|logout|test                            │
│    ├── ptah provider status|set-key|default|models|tier              │
│    ├── ptah config get|set|list|model-switch|autopilot|effort        │
│    ├── ptah plugin list|enable|disable|config|skills                 │
│    ├── ptah skill search|installed|install|remove|popular|...        │
│    ├── ptah mcp search|details|install|uninstall|list|popular        │
│    ├── ptah prompts status|enable|disable|regenerate|show|download   │
│    ├── ptah websearch status|set-key|test|config                     │
│    ├── ptah git info|worktrees|stage|commit|...                      │
│    ├── ptah workspace info|add|remove|switch                         │
│    ├── ptah quality assessment|history|export                        │
│    ├── ptah license status|set|clear                                 │
│    ├── ptah settings export|import                                   │
│    ├── ptah new-project select-type|submit-answers|get-plan|approve  │
│    ├── ptah wizard submit-selection|cancel|retry-item|status         │
│    ├── ptah setup [--dry-run] [--auto-approve]                       │
│    ├── ptah analyze [--save] [--out]                                 │
│    ├── ptah run --task ... (DEPRECATED → session start)              │
│    ├── ptah execute-spec --id TASK_xxx                               │
│    └── ptah interact [--session <id>]                                │
│         ↓                                                            │
│         JSON-RPC 2.0 stdio loop (src/cli/jsonrpc/server.ts)          │
│           • notifications: ~80 method names across 11 clusters       │
│           • outbound requests: permission.request, question.ask,     │
│                                oauth.url.open                        │
│           • inbound requests:  task.submit, task.cancel,             │
│                                session.shutdown, session.history,    │
│                                permission.response, question.response│
│         ↓                                                            │
│  In-process RPC transport (transport/cli-message-transport.ts)       │
│    ↓                                                                 │
│  DIContainer (tsyringe, 5-phase bootstrap; see with-engine.ts)       │
│    ↓                                                                 │
│  Shared libs (agent-sdk, rpc-handlers, workspace-intelligence,       │
│               agent-generation, vscode-lm-tools, llm-abstraction)    │
└──────────────────────────────────────────────────────────────────────┘
```

Unlike the Electron app, the CLI has no IPC boundary — the JSON-RPC layer
and backend share one Node process. RPC still flows through
`rpcHandler.handle(...)` because the shared handler library is the source
of truth for message shapes and validation.

## Dependencies

### Internal Libraries

- `@ptah-extension/shared` — types and message protocol
- `@ptah-extension/platform-core` — platform interfaces and tokens
- `@ptah-extension/platform-cli` — CLI implementations of platform-core
- `@ptah-extension/vscode-core` — infrastructure (DI, logger, RPC, license,
  session watcher, subagent registry)
- `@ptah-extension/workspace-intelligence` — workspace analysis
- `@ptah-extension/agent-sdk` — Claude Agent SDK integration
- `@ptah-extension/agent-generation` — agent generation services
- `@ptah-extension/llm-abstraction` — CLI agent process manager and
  adapters
- `@ptah-extension/vscode-lm-tools` — MCP code execution
- `@ptah-extension/rpc-handlers` — shared RPC handler classes

### External NPM Packages

Post-B11 dependency set (Ink/React stack removed in B11 Stream A):

- `commander` — argv parsing + subcommand router
- `marked` — markdown rendering (kept; used by other libs)
- `tsyringe`, `reflect-metadata` — dependency injection
- `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`,
  `@openai/codex-sdk` — AI provider SDKs (external in bundle)

**Removed in B11**: `react`, `ink`, `@inkjs/ui`, `ink-text-input`,
`ink-select-input`, `ink-spinner`, `marked-terminal`, `cli-highlight`,
`react-devtools-core`, `@types/react`. If a downstream caller still
imports any of these, that's a bug — see `docs/migration.md`.

### Build Dependencies

- `@nx/esbuild` — bundles `main.ts` to a single ESM file

## Commands

```bash
# Development
npm run cli:dev                        # Watch mode (tsx)
npm run cli:build                      # Production build (esbuild)
npm run cli:serve                      # Build + run

# Direct via Nx
nx build ptah-cli
nx test ptah-cli
nx typecheck ptah-cli
nx lint ptah-cli
```

The built binary lives at `dist/apps/ptah-cli/main.mjs`. The
`package.json` declares `"bin": { "ptah": "./main.mjs" }`, so linking
the dist directory (or publishing `@ptah-extensions/cli`) yields a
`ptah` command on PATH.

## Build Process

1. **build**: esbuild bundles `src/main.ts` →
   `dist/apps/ptah-cli/main.mjs` with ESM output, Node 20 target. JSX is
   no longer enabled (post-B11 — React shell deleted).
2. **banner**: esbuild injects `createRequire`, `__filename`, and
   `__dirname` shims so CommonJS interop and `__dirname`-style path
   resolution still work in the ESM output.
3. **package.json copy**: the CLI `package.json` is copied alongside the
   bundle to declare the `ptah` bin entry.

## CLI-specific Concerns

### Headless / no TTY assumptions

The CLI must never assume `process.stdout.isTTY` is true. Default output
is JSON-RPC 2.0 NDJSON; `--human` switches to a pretty formatter for
terminal debugging. Set `PTAH_NO_TTY=1` to force headless mode in tests.
The formatter additionally honors `NO_COLOR` (any non-empty value
disables ANSI) and `FORCE_COLOR` (forces ANSI).

### Approval gates via JSON-RPC

When the agent requires permission, the server emits a
`permission.request` JSON-RPC request to stdout and awaits a
`permission.response` from stdin. Default timeout is 5 minutes; on
timeout the CLI emits `task.error{ ptah_code: 'auth_required' }` and
exits with code 3. Set `PTAH_AUTO_APPROVE=true` (or pass
`--auto-approve`) to bypass for unattended runs.

### CLI agent allowlist (locked)

`ptah agent-cli stop|resume|models list` only accept `--cli glm` or
`--cli gemini`. `copilot` and `cursor` are blocked at command
entry-point. The check ignores `PTAH_AGENT_CLI_OVERRIDE` entirely (the
env var is documented but never consulted — see
`apps/ptah-cli/src/cli/commands/agent-cli.ts`).

### The `vscode` module shim

Same pattern as the Electron app — `src/shims/vscode-shim.ts` provides
a minimal stub and `tsconfig.build.json` maps the `vscode` module to
it. This lets the CLI consume `vscode-core` and `vscode-lm-tools`
without the VS Code runtime.

### stdout drain

`process.stdout.write` is async on Windows pipes. Always `await` the
drain before `process.exit(...)` or events at the tail of a JSON-RPC
session can be lost. `StdoutWriter` handles this for the JSON-RPC server;
the `interact` graceful-shutdown path explicitly races the drain against
a 5-second cap (configurable via `InteractExecuteHooks.drainTimeoutMs`).

## Testing

```bash
nx test ptah-cli                       # Unit tests
node dist/apps/ptah-cli/main.mjs --version       # Smoke
echo '{"jsonrpc":"2.0","id":"1","method":"task.submit","params":{"task":"hi"}}' \
  | node dist/apps/ptah-cli/main.mjs interact    # JSON-RPC smoke
```

Integration tests for the JSON-RPC stdio loop, approval round-trip,
parse errors, EOF mid-task, and concurrent submit+cancel live in
`apps/ptah-cli/src/cli/commands/interact.spec.ts` and the matching
`session/{chat,approval}-bridge.spec.ts` files.

## Troubleshooting

**Binary prints nothing / hangs**:

- The CLI is headless. `ptah` with no subcommand prints help and exits.
  For interactive use start a session: `ptah session start --task "..."`
  or open the JSON-RPC bridge: `ptah interact`.

**`vscode` import fails at runtime**:

- Check `tsconfig.build.json` still maps `vscode` to
  `apps/ptah-cli/src/shims/vscode-shim.ts`. If a lib reaches a vscode
  API the shim doesn't cover, extend the shim.

**`license_required` / `auth_required` from a streaming command**:

- See [`README.md` § Troubleshooting](README.md#troubleshooting). Set the
  license via `ptah license set --key ptah_lic_...`; for headless OAuth
  in CI use `PTAH_AUTO_APPROVE=true` and pre-seed credentials via
  `ptah provider set-key`.

## JSON-RPC schema

Full notification + request taxonomy: [`docs/jsonrpc-schema.md`](docs/jsonrpc-schema.md).

## Migration

Migrating from the legacy Ink TUI, `ptah run`, or `ptah profile`:
[`docs/migration.md`](docs/migration.md).

## User-facing README

End-user command reference, install instructions, global flags, env vars,
exit codes, troubleshooting: [`README.md`](README.md).

## Related Documentation

- TASK plan: `.ptah/specs/TASK_2026_104/`
- [VS Code Extension App](../ptah-extension-vscode/CLAUDE.md)
- [Electron Desktop App](../ptah-electron/CLAUDE.md)
- [Platform CLI Library](../../libs/backend/platform-cli/CLAUDE.md)
- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
- [Conventions](../../CONVENTIONS.md)

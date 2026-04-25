# Ptah CLI - Headless A2A Bridge

[Back to Main](../../CLAUDE.md)

> **Status — TASK_2026_104 Batch 1 (Rename Pivot)**: This app is in the
> middle of a pivot from an Ink/React TUI into a headless command-line
> agent-to-agent (A2A) bridge. After Batch 1, the binary still launches
> the legacy Ink TUI (zero behavior change). Batches 2-7 will replace the
> entry point, scaffold a `commander`-based router with 7 subcommands,
> add a JSON-RPC 2.0 stdio loop, pipe push events as notifications, wire
> a stdio-gated approval flow, and delete the React shell. See
> `.ptah/specs/TASK_2026_104/` for the full plan.

## Purpose

The **ptah-cli** application is the headless command-line surface for the
Ptah agent backend. It exposes the full DI container (agent-sdk,
rpc-handlers, workspace-intelligence, plugin loader, content download,
license + auth) as a single Node.js binary (`ptah` on PATH) intended to be
driven by external coding agents (OpenClaw / NemoClaw) via JSON-RPC 2.0
over `stdin`/`stdout`.

It provides:

- A `commander`-based subcommand router (`config`, `harness`, `profile`,
  `run`, `execute-spec`, `interact`, `--version`)
- A persistent JSON-RPC 2.0 stdio session (`ptah interact --session <id>`)
  that streams agent push events as notifications and accepts
  client-issued requests/responses (including approval gates) on stdin
- The same in-process RPC transport, DI container, and shared backend
  libraries used by Electron and the VS Code extension — there is no IPC
  boundary, the CLI runs the agent backend in-process

## Boundaries

**Belongs here**:

- Headless entry point (`src/main.ts` — added in Batch 2)
- Commander router (`src/cli/router.ts`) and subcommand handlers
  (`src/cli/commands/*.ts`) — added in Batch 2-4
- JSON-RPC 2.0 server, encoder, push-event pipe, stdio approval gate
  (`src/cli/jsonrpc/`, `src/cli/output/`, `src/cli/approval/`) —
  added in Batches 5-6
- DI bootstrap (`src/di/container.ts`, `src/di/cli-adapters.ts`)
- The in-process RPC transport (`src/transport/cli-message-transport.ts`,
  `cli-webview-manager-adapter.ts`, `cli-fire-and-forget-handler.ts`)
- The CLI RPC method registration service
  (`src/services/cli-rpc-method-registration.service.ts`)
- Platform impls (`src/services/platform/cli-*.ts`) for commands, auth,
  save-dialog, model-discovery
- The `vscode` module shim (`src/shims/vscode-shim.ts`)

**Does NOT belong**:

- React / Ink UI components, contexts, hooks, themes (Batch 7 deletes
  `src/components/`, `src/context/`, `src/hooks/`, `src/lib/themes.ts`,
  `src/lib/diff-parser.ts`)
- Business logic — belongs in backend libraries
  (`agent-sdk`, `rpc-handlers`, `workspace-intelligence`)
- Anthropic-compatible HTTP proxy (`ptah config proxy`) — Phase 2,
  out of scope for TASK_2026_104

## Key Files

### Entry Points

- `src/main.tsx` — current entry (legacy Ink TUI, replaced in Batch 2 by
  `src/main.ts`)
- `src/di/container.ts` — 5-phase DI bootstrap (Sentry, License, Auth, RPC,
  agent-sdk, workspace-intel, agent-generation, vscode-lm-tools, plugin
  loader, content download)
- `src/di/cli-adapters.ts` — Logger + OutputManager adapters for the CLI
  runtime (`CliLoggerAdapter`, `CliOutputManagerAdapter`)
- `src/services/cli-rpc-method-registration.service.ts` — registers the 17
  shared RPC handlers against the in-process transport
  (`CliRpcMethodRegistrationService`, `CLI_EXCLUDED_RPC_METHODS`)
- `src/transport/cli-message-transport.ts` — `transport.call(method,
params)` for in-process RPC
- `src/transport/cli-webview-manager-adapter.ts` — `EventEmitter` for push
  events
- `src/transport/cli-fire-and-forget-handler.ts` — permission/question
  response handler
- `src/shims/vscode-shim.ts` — minimal `vscode` module stub for the
  headless runtime

### Configuration

- `tsconfig.app.json` — TypeScript base
- `tsconfig.build.json` — build-time `paths.vscode` mapping to the shim
- `project.json` — Nx targets: `build`, `dev`, `serve`, `typecheck`,
  `lint`, `test`
- `package.json` — declares the `ptah` binary (will flip
  `private: false` and become `@ptah-extensions/cli` for npm publish in
  a later batch)
- `jest.config.cjs` — Jest config (`displayName: 'ptah-cli'`)

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Node.js process (single, headless after Batch 2)                    │
├──────────────────────────────────────────────────────────────────────┤
│  main.ts                                                             │
│    ↓                                                                 │
│  commander router (src/cli/router.ts)                                │
│    ├── ptah config get/set/list                                      │
│    ├── ptah harness init/install-skill/list                          │
│    ├── ptah profile apply/list                                       │
│    ├── ptah run --task "..."                                         │
│    ├── ptah execute-spec --id TASK_xxx                               │
│    └── ptah interact --session <id>                                  │
│         ↓                                                            │
│         JSON-RPC 2.0 stdio loop (src/cli/jsonrpc/server.ts)          │
│           • notifications: agent.event, log, debug.di.phase          │
│           • requests in:  submit, cancel, permission.response        │
│           • requests out: permission.request                         │
│         ↓                                                            │
│  In-process RPC transport (transport/cli-message-transport.ts)       │
│    ↓                                                                 │
│  DIContainer (tsyringe, 5-phase bootstrap)                           │
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

**Currently bundled (legacy TUI — removed in Batch 7)**: `react`, `ink`,
`@inkjs/ui`, `ink-text-input`, `ink-select-input`, `ink-spinner`,
`marked-terminal`, `cli-highlight`, `react-devtools-core`.

**Going forward (headless CLI)**:

- `commander` — argv parsing + subcommand router (added in Batch 2,
  ~50 KB)
- `marked` — markdown rendering (kept; used by other libs)
- `tsyringe`, `reflect-metadata` — dependency injection
- `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`,
  `@openai/codex-sdk` — AI provider SDKs (external in bundle)

### Build Dependencies

- `@nx/esbuild` — bundles `main.tsx` (later `main.ts`) to a single ESM
  file

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

The built binary lives at `dist/apps/ptah-cli/main.mjs`. The `package.json`
declares `"bin": { "ptah": "./main.mjs" }`, so linking the dist directory
(or publishing `@ptah-extensions/cli`) yields a `ptah` command on PATH.

## Build Process

1. **build**: esbuild bundles `src/main.tsx` → `dist/apps/ptah-cli/main.mjs`
   with ESM output, Node 20 target. `automatic` JSX is still enabled in
   the esbuild options for the duration of Batch 1 (Batch 2 removes JSX
   when `main.ts` lands and React is gone).
2. **banner**: esbuild injects `createRequire`, `__filename`, and
   `__dirname` shims so CommonJS interop and `__dirname`-style path
   resolution still work in the ESM output.
3. **package.json copy**: the CLI `package.json` is copied alongside the
   bundle to declare the `ptah` bin entry.

## Planned Subcommands (TASK_2026_104 Batches 2-6)

| Command                                | Status  | Purpose                                                                        |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `ptah --version`                       | Batch 2 | Print package version, exit 0 — no DI                                          |
| `ptah config get/set/list`             | Batch 4 | File-backed settings (`~/.ptah/settings.json`); `--reveal` to bypass redaction |
| `ptah harness init/install-skill/list` | Batch 4 | Idempotent harness scaffolding + skill install                                 |
| `ptah profile apply/list`              | Batch 4 | Content-addressed profile apply (no-op on second run)                          |
| `ptah run --task "..."`                | Batch 5 | One-off agent invocation, JSON-RPC notifications to stdout, exit 0/1           |
| `ptah execute-spec --id TASK_xxx`      | Batch 5 | Resume a stored task spec via `agent-generation`                               |
| `ptah interact --session <id>`         | Batch 6 | Persistent JSON-RPC 2.0 stdio loop (bidirectional)                             |
| `ptah config proxy --port N`           | Phase 2 | Anthropic-compatible HTTP proxy — out of scope                                 |

## CLI-specific Concerns

### Headless / no TTY assumptions (Batch 5+)

The CLI must never assume `process.stdout.isTTY` is true. Default output
is JSON-RPC 2.0; `--human` switches to a pretty formatter for terminal
debugging. Set `PTAH_NO_TTY=1` to force headless mode in tests.

### Approval gates via JSON-RPC

When the agent requires permission, the server emits a
`permission.request` JSON-RPC request to stdout and awaits a
`permission.response` from stdin. Default timeout is 5 minutes; on
timeout the CLI emits `task.error{ptah_code: auth_required}` and exits
with code 3.

### The `vscode` module shim

Same pattern as the Electron app — `src/shims/vscode-shim.ts` provides
a minimal stub and `tsconfig.build.json` maps the `vscode` module to
it. This lets the CLI consume `vscode-core` and `vscode-lm-tools`
without the VS Code runtime.

### stdout drain

`process.stdout.write` is async on Windows pipes. Always `await` the
drain before `process.exit(...)` or events at the tail of a JSON-RPC
session can be lost.

## Testing

```bash
nx test ptah-cli                       # Unit tests
node dist/apps/ptah-cli/main.mjs       # Smoke (Batch 1: launches Ink TUI)
```

Integration tests for the JSON-RPC stdio loop, approval round-trip,
parse errors, EOF mid-task, and concurrent submit+cancel land with the
senior-tester pass after Batch 6.

## Troubleshooting

**Binary prints nothing / hangs (Batch 1)**:

- Stdout is not attached to a TTY. The legacy Ink TUI degrades to plain
  text but may still render nothing meaningful in pipes. Headless mode
  (Batch 2+) replaces this with deterministic JSON-RPC.

**`Cannot find module 'ink'` at runtime**:

- External deps are expected to be installed in the dist `package.json`.
  Run `npm install` inside `dist/apps/ptah-cli/` or link the monorepo
  root `node_modules`.

**`vscode` import fails at runtime**:

- Check `tsconfig.build.json` still maps `vscode` to
  `apps/ptah-cli/src/shims/vscode-shim.ts`. If a lib reaches a vscode
  API the shim doesn't cover, extend the shim.

**Platform discriminator type error in agent-sdk / rpc-handlers**:

- Batch 1 widens the `wireSdkCallbacks` `platform: 'tui' | 'electron' |
'vscode'` union to include `'cli'` (D2 user-approved). If a new
  callsite is added, extend the union there too.

## Related Documentation

- TASK plan: `.ptah/specs/TASK_2026_104/`
- [VS Code Extension App](../ptah-extension-vscode/CLAUDE.md)
- [Electron Desktop App](../ptah-electron/CLAUDE.md)
- [Platform CLI Library](../../libs/backend/platform-cli/CLAUDE.md)
- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
- [Conventions](../../CONVENTIONS.md)

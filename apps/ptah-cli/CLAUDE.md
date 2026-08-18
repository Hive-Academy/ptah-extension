# ptah-cli (`@hive-academy/ptah-cli`)

[Back to Main](../../CLAUDE.md)

## Purpose

Headless Node CLI that hosts the full Ptah agent backend in-process and exposes it via a `commander` subcommand router and a JSON-RPC 2.0 stdio session (`ptah interact`). No UI shell — the legacy Ink/React TUI is gone. Designed to be driven by external A2A bridges (OpenClaw/NemoClaw), CI, and scripted refactors.

## Boundaries

**Belongs here**: argv parsing + router, JSON-RPC server / encoder / NDJSON I/O, push-event pipe, approval + chat bridges, OAuth URL openers, CLI DI bootstrap, CLI-specific platform adapters, the `vscode` module shim, CLI RPC method registration.
**Does NOT belong**: React/Ink UI (deleted), business logic (backend libs), Anthropic-compatible HTTP proxy (out of scope here).

## Entry Points

- `src/main.ts` — installs SIGINT/SIGTERM handlers (exit 130/143), runs `checkSchemaVersionSkew()` against `PTAH_HOST_SCHEMA_VERSION`, then `buildRouter().parseAsync(process.argv)`, then `finalizeExit(resolveExitCode(process.exitCode))`. Calls `fixPath()` for nvm/npm-global PATH repair on Linux/macOS.
- `src/cli/io/finalize-exit.ts` — **the CLI's terminal step, and it is load-bearing.** `main()` used to set `process.exitCode` and return, waiting for the event loop to drain. It never drains: every `withEngine({ mode: 'full' })` command leaves a live chokidar `FSEventWrap` behind (`CliFileSystemProvider.createFileWatcher`, opened by the `workspace-intelligence` agent/command discovery services), and `container.clearInstances()` drops tsyringe's references without calling `dispose()` on anything. Measured with `process.getActiveResourcesInfo()` 30s after the command finished writing. The symptom was every full-mode command printing correct, complete output and then hanging until its caller's timeout — `ptah doctor --json` sat for 90s+ and exited 124. `finalizeExit` races the stdout drain against a 5s cap (Windows pipes are async; exiting on the write tick truncates) and then calls `process.exit`. `session start --once`, `interact` and `mcp-serve` already did this individually; this is that step hoisted so the other ~30 subcommands get it too. Chasing the watchers per-lib was rejected: they are correct for long-running hosts, and the audit regresses the moment a 28th lib opens a 3rd watcher.
- `src/cli/router.ts` — commander wiring; declares every subcommand and `GlobalOptions`.

## Key Wiring

- `src/di/container.ts` + `src/cli/bootstrap/with-engine.ts` — `withEngine({ mode, requireSdk })`. `mode: 'minimal'` skips RPC handler phase (used by pre-bootstrap config commands). `requireSdk: false` skips SDK init for chicken-and-egg auth flows.
- `src/transport/cli-message-transport.ts` — in-process `transport.call(method, params)`.
- `src/transport/cli-webview-manager-adapter.ts` — push-event `EventEmitter`.
- `src/transport/cli-fire-and-forget-handler.ts` — permission/question response handler.
- `src/services/cli-rpc-method-registration.service.ts` — registers shared RPC handlers against the in-process transport (with a CLI-specific exclusion list).
- `src/cli/jsonrpc/` — `server.ts`, `encoder.ts`, `types.ts` (`JSONRPC_SCHEMA_VERSION`, `PtahNotification`, `PtahErrorCode`, `ExitCode`).
- `src/cli/io/` — NDJSON `stdin-reader` / `stdout-writer` (Windows-pipe drain aware).
- `src/cli/session/` — `chat-bridge.ts` (turn semantics on top of fire-and-forget chat RPCs), `approval-bridge.ts` (honors `PTAH_AUTO_APPROVE=true`).
- `src/cli/commands/harness-doctor.ts` — `runHarnessDoctor` / `runHarnessRemove`, the two dispatch targets `harness.ts` `execute()` calls for the `doctor`/`remove` subcommands. Split out purely for size (TASK_2026_278 Batch 4).
- `src/cli/oauth/` — JSON-RPC + stderr URL openers.
- `src/cli/wizard/phase-runner.ts` — composable Setup Wizard phase orchestration.
- `src/shims/vscode-shim.ts` — minimal `vscode` shim; `tsconfig.build.json` maps the `vscode` module to it.

## Library Dependencies

- `@ptah-extension/platform-core`, `@ptah-extension/platform-cli`
- `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/agent-generation`, `@ptah-extension/llm-abstraction`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`
- External: `commander`, `tsyringe`, `reflect-metadata`, plus the three AI provider SDKs and the same heavy externals as Electron (better-sqlite3, sqlite-vec, web-tree-sitter, croner, ulid, grammy, discord.js, @slack/bolt, ffmpeg-static, nodejs-whisper, @huggingface/transformers, etc.).

## Build & Run

- `nx build ptah-cli` — esbuild ESM bundle to `dist/apps/ptah-cli/main.mjs` with `createRequire` + `__filename` + `__dirname` banner so the ESM bundle behaves like CJS for `require()`-using deps. `deleteOutputPath: true`.
- `nx dev ptah-cli` — `npx tsx apps/ptah-cli/src/main.ts`.
- `nx serve ptah-cli` — build then `node dist/apps/ptah-cli/main.mjs`.
- `nx test ptah-cli` (jest); `nx run ptah-cli:e2e` (separate `jest.e2e.config.cjs`, `--runInBand`).
- `nx run ptah-cli:e2e-pty` — TUI specs that press real keys on a real pseudo-terminal (`jest.pty.config.cjs`, `tests/e2e/**/*.pty.spec.ts`). Split from `e2e` solely because node-pty leaks a PIPEWRAP that needs `forceExit`; the JSON-RPC suite stays without it so a future leak there still surfaces.
- **Rebuild the bundle with `--skip-nx-cache` before trusting an e2e run against changed source.** `restore-cli-manifest` will happily serve a cached `tui.mjs` from a previous source state, and the specs then pass against code you did not write.
- `nx run ptah-cli:publish:dry-run` / `:publish` — runs from `dist/apps/ptah-cli`. Distribution is gated by the `publish-cli` GitHub workflow on `cli-v*` tag flow.
- `package.json` declares `"bin": { "ptah": "./main.mjs" }`. Assets copied into dist: `package.json`, `README.md`, `docs/jsonrpc-schema.md`, `docs/migration.md`, repo-root `LICENSE.md`.

## Guidelines

- Default output is NDJSON JSON-RPC 2.0. Never assume `process.stdout.isTTY`. `--human` opts into a pretty formatter; respect `NO_COLOR`, `FORCE_COLOR`, `PTAH_NO_TTY=1`.
- Always `await` stdout drain before `process.exit` in JSON-RPC paths (Windows pipes are async). `StdoutWriter` handles this; the `interact` shutdown explicitly races drain against a 5s cap.
- Approval-gated requests time out at 5 minutes -> exit code 3 (`auth_required`). `PTAH_AUTO_APPROVE=true` bypasses for unattended runs.
- `ptah agent-cli` only accepts `--cli glm`; the allowlist ignores `PTAH_AGENT_CLI_OVERRIDE`.
- Auth/config bootstrap commands pass `requireSdk: false` to `withEngine` so they can run before the SDK is configured.
- `ptah init` (`src/cli/commands/init.ts`) is the first-run setup entry point. Interactive (@clack) only on a real TTY with `--human`; in machine mode (non-TTY / `--json` / `--quiet`) it never prompts — it emits one `init.plan` notification (ordered `steps[]` + `ready/route/blockers`) and exits `0`. Agents drive setup off `init.plan` or `doctor.report`.
- **Slot-unification invariant**: `provider set-key` (`llm:setApiKey`) MUST write the same secret slot the SDK reads (`AuthSecretsService`: `ptah.auth.anthropicApiKey` / `ptah.auth.provider.<id>`) and persist `authMethod`, so a pure-CLI bootstrap (`set-key` → `default set` → `session start --once`) starts a session and `doctor`'s `effective.ready` agrees with `session start`. `set-key` validates the key (`verified`) and rejects malformed keys with exit `3`; `license set` rejects server-rejected keys with exit `4`. A fresh install ships `llm.defaultProvider: ""`, so a provider must be selected explicitly.
- New RPC namespaces need entries in both `rpc.types.ts` AND `rpc-handler.ts ALLOWED_METHOD_PREFIXES` (see user memory).
- `ptah harness doctor [--fix] [--json]` calls `harness:health` (or `harness:reconcile` under `--fix`) and emits one `harness.doctor` notification: a per-target table (detected, per-facet support, expected/found/missing/foreign/writeFailed/overwritten), then in `--human` mode the PATHS behind those counts grouped by kind (missing, foreign, adopted, removed — 20 per group, then `+N more`; `--json` always carries the full arrays), then sources status and a summary line from the shared `summarizeHarnessHealth()` reducer (`@ptah-extension/shared`). The path lists are load-bearing: a `foreign` entry is one Ptah is deliberately refusing to touch, so clearing it means the USER moving the file, which they cannot do from a count. It **exits 1 when the harness is degraded or in error** — any detected target missing entries, `sources !== 'ok'`, or a write failure — deliberately unlike `ptah spec doctor`, which always exits 0: this doctor is meant to work as a CI gate on harness drift, not a status readout over a tree still being authored.
- `ptah harness remove --yes` deletes every manifest-owned harness copy in the workspace via `harness:remove` (E22). `--yes` is required — there is no prompt, since the CLI's default mode is machine output on a pipe — and this is the first command in this CLI to require an explicit `--yes` confirmation flag.
- **`harness doctor` and `harness remove` boot `{ mode: 'full', requireSdk: false }`, and both halves are deliberate.** They are filesystem verbs — they walk `~/.ptah/user`, hash-compare against the per-target manifests, and copy or unlink — so neither may sit behind the SDK adapter's `initialize()`; with the default they died with `sdk_init_failed` on any machine without an API key, which is exactly the machine a CI gate on harness drift runs on. But `mode` must stay `'full'`: `harness:health` / `harness:reconcile` / `harness:remove` are registered in DI phase 4, and so are `PluginLoaderService.initialize()` and `bootHarness` — the wiring that gives the reconciler its desired state. Under `'minimal'` the doctor would still answer, over an empty plugin overlay, and report a clean harness for a workspace missing every plugin skill. Content download stays fire-and-forget and is never awaited: an offline run reports `pending-download` / `sources-missing`, which `summarizeHarnessHealth` grades `degraded`, so the exit code is still 1. Pinned by the `harness filesystem verbs boot without the SDK` block in `harness.spec.ts`, whose counterexample (`analyze-intent` keeps the default) is what gives the assertion meaning.

## JSON-RPC Schema

Canonical types live in `src/cli/jsonrpc/types.ts`. Human-facing schema doc: `apps/ptah-cli/docs/jsonrpc-schema.md`. Migration notes: `apps/ptah-cli/docs/migration.md`.

---
id: TASK_2026_171
status: done
type: REFACTORING
title: RPC host-profile architecture — one handler surface, capability-driven registration
description: Replace per-app RPC handler duplication and hand-maintained exclusion lists with a declarative handler manifest + per-app HostProfile + a single registerRpcSurface() engine in libs/backend/rpc-handlers. Apps stop containing RPC code entirely; per-host variation becomes data.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-02T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

### Problem (verified 2026-08-02 audit)

Host capability for the RPC surface is encoded imperatively in four mutually-unaware places, and handler classes are duplicated per app:

1. VS Code `ELECTRON_ONLY_METHODS` (26 method strings + 11 spread arrays) at `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts:69` — plus a DUPLICATE `exclude:` class array at `:138` in the same file.
2. cli-engine `CLI_EXCLUDED_RPC_METHODS` (24 entries) at `libs/backend/cli-engine/src/lib/rpc/cli-rpc-method-registration.service.ts:37` — applied to both CLI and TUI, already wrong for the TUI (excludes `file:pick` while the TUI has a file picker).
3. Three inline no-op memory stubs buried in `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:95-115`.
4. Electron excludes nothing (`ELECTRON_EXCLUDED_METHODS = []`).

Consequence: adding a provider/subsystem in Electron silently breaks VS Code at activation because nothing declares what each host supports. This has happened repeatedly.

Handler duplication on top of that:

- `AgentRpcHandlers` exists 3x: VS Code (973 LOC), Electron (868 LOC), cli-engine `CliAgentRpcHandlers` (865 LOC) — sharing business logic (`mergePtahCliAgents`, `resumePtahCliSession`, `isCursorApiKeyConfigured`, `sessionFileExists`, config clamping).
- `FileRpcHandlers` 2x (237 / 284), `CommandRpcHandlers` 2x (109 / 125), `EditorRpcHandlers` 2x (105 / 901 — Electron is a superset).
- Three per-app `RpcMethodRegistrationService` orchestrators (290 / 177 / 131 LOC).

### Target architecture (variation = data, behavior = libs, apps = composition roots)

1. **Handlers are lib code, period.** All handlers live in `libs/backend/rpc-handlers` (or their domain lib). Handlers that need host I/O declare small ports (`IFileDialog`, `IEditorHost`, `ICommandExecutor`, ...) implemented once per runtime in `platform-{vscode,electron,cli}` alongside their existing 13-15 sibling adapters.
2. **Handler manifest.** Each handler declares `{ methods, requires: Capability[] }` in a single manifest in `rpc-handlers`. The manifest is the one source of truth (can also feed `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46` so the dual-registration rule collapses to one registration point).
3. **HostProfile per app.** Each app ships exactly one declarative capability object (e.g. vscode: `{ memory: false, cron: false, gateway: false, voice: false, pty: false, editorHost: true, ... }`). This is the ONLY per-app RPC artifact.
4. **One `registerRpcSurface(container, profile)`** in `rpc-handlers`: filters manifest by profile, registers handlers, wires SDK callbacks/event listeners (already shared: `wireSdkCallbacks`, `wireAgentEventListeners`), derives exclusions, runs `verifyAndReportRpcRegistration`. Null implementations (e.g. `NullMemoryReader`) live next to their contracts (`memory-contracts`) and are registered by the same gate.
5. **Enforcement.** (a) Negative container smoke tests per app: tokens/methods that must NOT resolve on that host (extend existing `expected-resolvable.ts` pattern with an expected-absent list). (b) Nx module-boundary tags / lint rule preventing `@injectable` RPC handler classes under `apps/`.

### Phases

- **P1 — Profile + engine (no handler moves).** Introduce `Capability`, manifest metadata on existing lib handlers, `HostProfile` per app, `registerRpcSurface()`. Delete the three per-app registration services and all four exclusion lists. Gate: all three runtimes' container smoke tests + RPC verification report identical surface to pre-refactor per host (snapshot the method list before/after).
- **P2 — Negative tests + lint.** Expected-absent token/method lists for VS Code and CLI/TUI; boundary rule for handlers in apps. Fix the TUI `file:pick` exclusion as the first profile correction.
- **P3 — Handler unification (Electron-first, one family at a time).** Order: `AgentRpcHandlers` (largest shared core) → `FileRpcHandlers` → `CommandRpcHandlers` → `EditorRpcHandlers` (Electron's 901-LOC version becomes the lib implementation; VS Code's 105-LOC subset becomes profile-gated). Each family: move Electron's implementation (Electron always wins), port-ify host I/O, delete the VS Code/cli-engine twins, gate on Electron test suite unchanged.

### Constraints

- Electron is the reference implementation; its behavior and test baseline must not change at any phase boundary.
- No `@ts-expect-error`, no app-local handler additions during migration.
- `catch (error: unknown)`; Zod at RPC boundaries stays as-is.
- Marketplace rule: no trademarked names in non-JS files (spec text is fine, it is not shipped).

### Acceptance criteria

1. Zero RPC handler classes and zero registration orchestrators under `apps/`.
2. Zero hand-maintained method exclusion lists anywhere; exclusions derived from manifest x profile.
3. Adding a new Electron-only subsystem requires touching ONLY: the handler + manifest entry (lib) and the Electron profile — VS Code/CLI builds and negative tests stay green with no edits.
4. Per-host registered-method snapshots identical to pre-refactor (except documented intentional fixes, e.g. TUI `file:pick`).
5. Electron test suite identical to baseline at every phase gate.

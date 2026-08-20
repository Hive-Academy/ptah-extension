# Implementation Plan — TASK_2026_171 P3 (partial): Layout / Terminal / Update handler families

**Scope**: move `LayoutRpcHandlers`, `TerminalRpcHandlers`, `UpdateRpcHandlers` (+ `update-rpc.schema.ts` and its two specs) out of `apps/ptah-electron` into `libs/backend/rpc-handlers`.
**Explicitly out of scope**: `editor-rpc.handlers.ts` (both hosts) and `file-rpc.handlers.ts` (VS Code) — owned by TASK_2026_173.

No `## Clarifications Needed`. Every fork below was resolved from codebase evidence; the one genuinely contestable decision (`AppUpdateState` redeclaration vs importing `UpdateLifecycleState`) is resolved in §1.3 with the precedent that decides it, and made drift-proof at compile time rather than by convention.

---

## 0. Codebase investigation summary

### 0.1 Scaffolding that already exists (verified, not re-derived)

| Fact                                                                                     | Evidence                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Capabilities `layoutPersistence` / `pty` / `appUpdater` declared                         | `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts:56-60`    |
| Manifest entries `host.layout` / `host.terminal` / `host.update` with correct `requires` | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:361-375`      |
| Electron profile switches all three on and supplies the classes                          | `apps/ptah-electron/src/rpc-host-profile.ts:44-46, 52-54`                 |
| VS Code profile leaves all three off (only 5 caps on)                                    | `apps/ptah-extension-vscode/src/rpc-host-profile.ts:24-30`                |
| CLI/TUI profile leaves all three off                                                     | `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:29-37`           |
| All three already asserted absent on headless hosts                                      | `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:20-30`            |
| `layout:` / `terminal:` / `update:` already in `ALLOWED_METHOD_PREFIXES`                 | `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (allowlist block) |

**Consequence**: the dual-registration rule (root CLAUDE.md) needs **no work** in this task. Both halves are already in place for all six methods. The only manifest change is flipping three entries from host-owned to lib-owned.

### 0.2 Dependency surface of each handler

| Handler               | Injected                                                                                            | App-local?                 |
| --------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| `LayoutRpcHandlers`   | `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `PLATFORM_TOKENS.STATE_STORAGE`                              | **none** — pure relocation |
| `TerminalRpcHandlers` | + `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `ELECTRON_TOKENS.PTY_MANAGER_SERVICE` → `PtyManagerService` | 1 app-local                |
| `UpdateRpcHandlers`   | + `UPDATE_MANAGER_TOKEN` → `UpdateManager`                                                          | 1 app-local                |

`TerminalRpcHandlers` calls exactly two `PtyManagerService` members: `create({cwd, shell?, name?}) → {id, pid}` (`terminal-rpc.handlers.ts:62-67`) and `kill(id) → {success, error?}` (`:95`).
`UpdateRpcHandlers` calls exactly two `UpdateManager` members: `getCurrentState()` (`update-rpc.handlers.ts:40`) and `triggerCheck()` (`:52`).

Nothing else crosses the boundary. Both ports are therefore two methods each.

### 0.3 The stale header comment — verdict: **STALE, delete it**

`apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.ts:8-9`:

> `This handler is Electron-local and must NOT appear in libs/backend/rpc-handlers/ or the SHARED_HANDLERS list.`

**It is stale, and it was never a technical constraint — it was a statement about the pre-manifest world.** Evidence:

1. It predates the host-profile engine. The claim it encodes ("this must be Electron-only") is now expressed _as data_ by `requires: ['appUpdater']` (`manifest.ts:372-375`) combined with `appUpdater: false` on the VS Code and CLI profiles. The mechanism the comment was warning about no longer exists.
2. Its literal reading conflates two different things. "Must not appear in `SHARED_HANDLERS`" is **still true and still enforced** — see §4, the class does _not_ go into `registerSharedRpcHandlers`. "Must not appear in `libs/backend/rpc-handlers/`" is what is now wrong: `libs/backend/rpc-handlers` today contains 15 capability-gated handlers that are absent on some host (`MemoryRpcHandlers`, `CronRpcHandlers`, `VoiceRpcHandlers`, `PersistenceRpcHandlers`, `WorkspaceRpcHandlers`, … `manifest.ts:257-347`). Living in the lib has not implied "every host serves it" since P1.
3. It directly contradicts AC #1 ("Zero RPC handler classes … under `apps/`") and the eslint rule that already lists this exact file as _pending migration_ (`eslint.config.mjs:38`). An eslint exception whose comment says "each migration deletes its entry" (`eslint.config.mjs:23-31`) is the authoritative newer statement.
4. The sibling barrel carries the same fossil: `apps/ptah-electron/src/services/rpc/handlers/index.ts:8-10` says `WorkspaceRpcHandlers, SettingsRpcHandlers, and GitRpcHandlers live in @ptah-extension/rpc-handlers SHARED_HANDLERS` — `SHARED_HANDLERS` is not a symbol that exists anywhere in the repo any more (only `registerSharedRpcHandlers`, `register-shared-rpc-handlers.ts:42`). Both comments are from the same superseded vocabulary.

**Action**: delete lines 8-9 of the header when the file moves; replace with a note that host gating is `requires: ['appUpdater']`. Also drop the fossil paragraph from the app barrel in Batch 5.

---

## 1. Port definitions

### 1.1 `IPtyHost` — `libs/backend/platform-core/src/interfaces/pty-host.interface.ts` (CREATE)

Minimal: only `create` and `kill`. `write` / `resize` / `onData` / `onExit` / `disposeAll` / `killAllForWorkspace` / `getSessionsForWorkspace` are **deliberately excluded** — they are the binary-IPC path owned by `IpcBridge` (`apps/ptah-electron/src/ipc/ipc-bridge.ts:437-477`) and the shutdown path owned by `main.ts`, neither of which is RPC. Adding them would put the whole terminal lifecycle behind a port for no consumer.

```ts
/**
 * IPtyHost — the "spawn / kill a pseudo-terminal" port behind the `terminal:*`
 * RPC methods. Gated by the `pty` capability; only hosts that own a terminal
 * surface register an implementation.
 *
 * Intentionally NOT a full PTY lifecycle port: data flow (write/resize/onData/
 * onExit) and shutdown run over binary IPC in the host, never over JSON RPC,
 * and no library consumer needs them.
 */
export interface PtySpawnRequest {
  /** Working directory for the shell. Resolved by the caller — never empty. */
  readonly cwd: string;
  /** Shell executable override. Host picks its platform default when absent. */
  readonly shell?: string;
  /** Display name; carried for reference, not used to spawn. */
  readonly name?: string;
}

export interface PtySpawnResult {
  readonly id: string;
  readonly pid: number;
}

export interface PtyKillResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface IPtyHost {
  /** Spawn a session. Throws when the host's session limits are exceeded. */
  create(request: PtySpawnRequest): PtySpawnResult;
  /** Kill a session by id. Returns `{success:false}` for an unknown id. */
  kill(id: string): PtyKillResult;
}
```

`create` stays **synchronous** — `PtyManagerService.create` (`pty-manager.service.ts:64`) is synchronous today and the handler awaits nothing (`terminal-rpc.handlers.ts:62`). Making it async would be a gratuitous behaviour change.

`readonly` modifiers do not affect assignability, so `PtySpawnResult` → `TerminalCreateResult` and `PtyKillResult` → `TerminalKillResult` (`libs/shared/src/lib/types/rpc/rpc-terminal.types.ts:16-33`) both hold structurally.

### 1.2 `IAppUpdater` — `libs/backend/platform-core/src/interfaces/app-updater.interface.ts` (CREATE)

Minimal: only the two members the handler calls. `start()`, `dispose()`, `getCheckInterval()` are **deliberately excluded** — their only callers are `activation/post-window.ts:197-199` and `main.ts:185`, which keep resolving the concrete class through `UPDATE_MANAGER_TOKEN` (§2).

```ts
/**
 * IAppUpdater — the read+trigger port behind the `update:*` RPC methods.
 * Gated by the `appUpdater` capability.
 *
 * Start/stop/interval management is deliberately absent: those are host
 * activation-lifecycle concerns with no library consumer.
 *
 * `AppUpdateState` mirrors `UpdateLifecycleState` in `@ptah-extension/shared`.
 * It is redeclared rather than imported to keep platform-core free of
 * inter-lib dependencies (see settings-auth-key.ts:9-10 for the same call).
 * Drift is a compile error in both directions — see the port's implementor
 * (`implements IAppUpdater`) and its consumer (UpdateRpcHandlers' typed
 * `registerMethod<_, UpdateGetStateResult>` return site).
 */
export type AppUpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'available';
      currentVersion: string;
      newVersion: string;
      releaseDate?: string;
      releaseNotesMarkdown?: string | null;
      downloadUrl: string | null;
      releaseUrl: string;
    }
  | { state: 'dismissed' }
  | { state: 'error'; message: string };

export interface IAppUpdater {
  /** Latest known lifecycle state. Synchronous — no I/O. */
  getCurrentState(): AppUpdateState;
  /** Run an immediate check. Resolves once the state has been broadcast. */
  triggerCheck(): Promise<void>;
}
```

### 1.3 Why `platform-core`, and why the union is redeclared

**Home = `platform-core`.** Evidence, in order of weight:

1. **The task spec says so.** Target architecture item 1: handlers "declare small ports (`IFileDialog`, `IEditorHost`, `ICommandExecutor`, …)". `IFileDialog` is the worked example and it lives in `platform-core` (`src/interfaces/platform-abstractions.interface.ts`, token at `src/di/tokens.ts:87-92`). These two ports are its exact structural analogue: a single-capability port consumed by a capability-gated lib handler, unregistered on hosts whose profile leaves the capability off.
2. **`platform-core` already hosts ports whose adapters are NOT in `platform-{vscode,electron,cli}`** — `MEMORY_WRITER` (adapter in `memory-curator`, `tokens.ts:59-60`), `MCP_SERVER_STATUS` (adapter in `vscode-lm-tools`, `:68-69`), `SESSION_ATTACHMENT_GUARD` (adapter in `messaging-gateway`, `:74-79`). So "port in platform-core, implementation elsewhere" is established practice, not a compromise. This is what unblocks §3.
3. **Rejected: ports inside `rpc-handlers`.** `libs/backend/rpc-handlers/CLAUDE.md` Cross-Lib Rules: "Must not be imported by leaf libs (`platform-*`, `shared`, `memory-contracts`)". Even though Nx tags would technically permit `scope:electron → scope:extension`, co-locating the port there inverts the ports layer and forecloses ever putting an adapter in `platform-electron`.
4. **Rejected: a new `updater-contracts` / `pty-contracts` lib.** The `memory-contracts` / `voice-contracts` precedent exists for _subsystems_ with an error taxonomy and multiple implementors. Two two-method interfaces do not justify two Nx projects.
5. **`platform-core` stays interface-only.** Both additions are `export interface` / `export type` — no class, no runtime code. This does **not** replicate the `PtahFileSettingsManager` / `ContentDownloadService` violations flagged in CLAUDE.md; those are concrete services, these are pure types.

**Why `AppUpdateState` is redeclared instead of `import type { UpdateLifecycleState } from '@ptah-extension/shared'`:**

- `platform-core` has **zero** production imports from `@ptah-extension/*` today (verified: the only hits are `@ptah-extension/shared/testing` inside three `.spec.ts` files).
- The invariant is stated **in code**, not just in CLAUDE.md: `libs/backend/platform-core/src/settings-auth-key.ts:9-10` — _"Matches AuthMethod from @ptah-extension/shared (imported by value here to keep platform-core free of inter-lib dependencies on @ptah-extension/shared)."_ That is a decision the repo has already made for exactly this situation.
- Reinforced by `src/interfaces/session-attachment-guard.interface.ts`: _"This interface intentionally carries NO gateway types."_
- The usual objection to duplicating a wire contract — silent drift — **does not apply here**, because both directions are compile-checked for free:
  - `UpdateLifecycleState → AppUpdateState` is checked by `class UpdateManager implements IAppUpdater` (§2.3). If `shared` gains an arm the port lacks, `UpdateManager` stops compiling.
  - `AppUpdateState → UpdateLifecycleState` is checked at the handler's return site, because `UpdateRpcHandlers` types `registerMethod<UpdateGetStateParams, UpdateGetStateResult>` and `UpdateGetStateResult.state: UpdateLifecycleState` (`libs/shared/src/lib/types/rpc/rpc-update.types.ts:14-18`). If the port gains an arm `shared` lacks, the handler stops compiling.
  - No extra test is required. (An explicit bidirectional `const _a: X = null as unknown as Y` pair in `update-rpc.handlers.spec.ts` is cheap and makes the intent legible — optional, recommended.)

### 1.4 `libs/backend/platform-core/src/index.ts` additions

```ts
export type { IPtyHost, PtySpawnRequest, PtySpawnResult, PtyKillResult } from './interfaces/pty-host.interface';
export type { IAppUpdater, AppUpdateState } from './interfaces/app-updater.interface';
```

---

## 2. Token plan

### 2.1 Add to `PLATFORM_TOKENS` (`libs/backend/platform-core/src/di/tokens.ts`)

```ts
  /**
   * IPtyHost — spawn/kill pseudo-terminals for the `terminal:*` RPC methods.
   * Registered only by hosts whose profile sets `pty: true` (Electron today).
   */
  PTY_HOST: Symbol.for('PlatformPtyHost'),

  /**
   * IAppUpdater — read/trigger the desktop update lifecycle for `update:*`.
   * Registered only by hosts whose profile sets `appUpdater: true`.
   */
  APP_UPDATER: Symbol.for('PlatformAppUpdater'),
```

`Symbol.for('Platform…')` matches the dominant convention in the file (`tokens.ts:5-9` states it explicitly).

### 2.2 `ELECTRON_TOKENS.PTY_MANAGER_SERVICE` — **KEEP** (aliased, not removed)

Non-RPC callers exist. Removal would break the terminal data path:

- `apps/ptah-electron/src/activation/bootstrap.ts:223-247` resolves it and hands the instance to `IpcBridge`.
- `apps/ptah-electron/src/ipc/ipc-bridge.ts:437-477` uses `write`, `resize`, `onData`, `onExit`, `disposeAll` — none of which are on `IPtyHost` and none of which are RPC.

Registration in `apps/ptah-electron/src/di/phase-4-handlers.ts:163-166` becomes:

```ts
const ptyManagerService = new PtyManagerService(logger);
container.register(ELECTRON_TOKENS.PTY_MANAGER_SERVICE, {
  useValue: ptyManagerService,
});
// Alias: the RPC handler depends on the port, IpcBridge on the concrete class.
// Same instance — a second PtyManagerService would own a separate session map.
container.register(PLATFORM_TOKENS.PTY_HOST, {
  useToken: ELECTRON_TOKENS.PTY_MANAGER_SERVICE,
});
```

### 2.3 `UPDATE_MANAGER_TOKEN` — **KEEP** (aliased, not removed)

Non-RPC callers exist:

- `apps/ptah-electron/src/activation/post-window.ts:197-199` — `start()` + `getCheckInterval()`.
- `apps/ptah-electron/src/main.ts:185` — `dispose()`.

None of those three methods are on `IAppUpdater`, by design. Registration at `phase-4-handlers.ts:168` becomes:

```ts
container.registerSingleton(UPDATE_MANAGER_TOKEN, UpdateManager);
// Alias, NOT a second registerSingleton — see Risk R1.
container.register(PLATFORM_TOKENS.APP_UPDATER, {
  useToken: UPDATE_MANAGER_TOKEN,
});
```

`useToken` is the repo's established aliasing provider — `libs/backend/memory-curator/src/lib/di/register.ts:93,107,110` aliases port tokens onto existing registrations exactly this way; also `skill-synthesis/src/lib/di/register.ts:71-86`, `agent-generation/src/lib/di/register.ts:157`.

### 2.4 `implements` clauses (the compile-time seam)

- `apps/ptah-electron/src/services/pty-manager.service.ts:32` → `export class PtyManagerService implements IPtyHost {`
- `apps/ptah-electron/src/services/update/update-manager.ts:50` → `export class UpdateManager implements IAppUpdater {`

Both are satisfied by the current member signatures with **zero body changes**. These clauses are what turn any future drift into a build failure instead of a runtime `undefined is not a function` at the RPC boundary.

### 2.5 Nothing is removed

No token deletions in this task. `ELECTRON_TOKENS` keeps `PTY_MANAGER_SERVICE`; `update-tokens.ts` is untouched.

---

## 3. Adapter plan

### 3.1 `libs/backend/platform-electron` — **nothing lands here**

`PtyManagerService` and `UpdateManager` stay in `apps/ptah-electron`. Justification:

1. **Neither is an RPC handler.** AC #1 is "zero RPC handler _classes_ and zero registration _orchestrators_" under `apps/`, and the eslint rule (`eslint.config.mjs:23-39`) bans app-local RPC handler files specifically. Moving these two services is required by no acceptance criterion.
2. **Both are entangled with Electron activation lifecycle, not with platform I/O.** `PtyManagerService` is co-owned by `IpcBridge`'s binary channel wiring (`ipc-bridge.ts:437-477`) and disposed from `main.ts` will-quit; `UpdateManager` injects `TOKENS.WEBVIEW_MANAGER` to broadcast (`update-manager.ts:55-56, 250-260`) and is started/disposed by `post-window.ts` / `main.ts`. Relocating them would pull the app's activation graph into the adapter lib. `apps/ptah-electron/CLAUDE.md` puts "IPC bridge" and the multi-phase activation squarely in the app.
3. **Precedent covers it.** `platform-core` already hosts three ports whose adapters live outside the adapter trio (§1.3 item 2). "Port in `platform-core`, implementation at the Electron composition root" is the same shape.
4. **The reference-behaviour constraint argues against it.** Moving `PtyManagerService` means adding `node-pty` to `platform-electron`'s esbuild externals and rebuilding the native-module story for a second project — a change to the Electron runtime surface for zero AC benefit. The spec forbids exactly that ("Electron … behavior and test baseline must not change at any phase boundary").

If a second host ever grows a terminal or a self-updating shell, _that_ is the change that justifies an `ElectronPtyHost` in `platform-electron`. Doing it now is designing for a hypothetical runtime.

### 3.2 `platform-vscode` / `platform-cli` — **nothing, confirmed**

Confirmed against each host's profile, not assumed:

- VS Code (`apps/ptah-extension-vscode/src/rpc-host-profile.ts:24-30`) enables only `fileOpen`, `filePicker`, `filePickerImages`, `editorRevert`, `commandExecution`. `layoutPersistence`, `pty`, `appUpdater` are omitted ⇒ `false` via `capabilities()` (`host-profile.ts:67-97`).
- CLI/TUI (`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:29-37`) enables only the backend subsystems + conditional `filePicker`. Same three omitted, and the omission is already locked in by `expected-absent.ts:20-30`.

`resolveRpcHandlerPlan` (`register-rpc-surface.ts:103-129`) `continue`s past any entry whose `requires` are unsatisfied, so `PLATFORM_TOKENS.PTY_HOST` / `APP_UPDATER` / `STATE_STORAGE`-for-layout are never resolved on those hosts. An unregistered token is never touched — no null objects needed, no `installNullImplementations` change.

---

## 4. Registration plan

### 4.1 NOT `registerSharedRpcHandlers`

`registerSharedRpcHandlers` (`libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:42-50`) is invoked by **all three** hosts — `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:82`, `apps/ptah-electron/src/di/phase-4-handlers.ts:98`, `libs/backend/cli-engine/src/lib/container.ts`. It exists for the four handlers every host serves unconditionally. Putting a capability-gated class there would register a singleton on hosts that can never resolve its port — harmless at registration time (tsyringe is lazy) but exactly the invisible per-host coupling this task deletes, and it would poison the P2 negative-container tests.

### 4.2 Keep the existing per-host `registerSingleton`, change only the import

The Electron DI phase already registers every capability-gated lib handler it serves and nothing else — `MemoryRpcHandlers`, `CronRpcHandlers`, `GatewayRpcHandlers`, `VoiceRpcHandlers`, `PersistenceRpcHandlers`, `FilePickerRpcHandlers`, `FileSystemRpcHandlers`, … (`phase-4-handlers.ts:106-118`). VS Code registers only its subset (`phase-3-handlers.ts:76-77`). This task adds **zero new registration machinery**: the three `container.registerSingleton(...)` calls at `phase-4-handlers.ts:162, 167, 169` stay exactly where they are; only the import source changes from `'../services/rpc/handlers'` to `'@ptah-extension/rpc-handlers'`.

### 4.3 Manifest: flip to lib-owned **and rename the key**

```ts
  {
    key: 'layout',
    methods: LayoutRpcHandlers.METHODS,
    requires: ['layoutPersistence'],
    handler: LayoutRpcHandlers,
  },
  {
    key: 'terminal',
    methods: TerminalRpcHandlers.METHODS,
    requires: ['pty'],
    handler: TerminalRpcHandlers,
  },
  {
    key: 'update',
    methods: UpdateRpcHandlers.METHODS,
    requires: ['appUpdater'],
    handler: UpdateRpcHandlers,
  },
```

Moved from the `// --- host-owned (unification pending) ---` block into `// --- library-owned, capability-gated ---` (`manifest.ts:257`).

**The `host.` prefix drop is load-bearing, not cosmetic.** `HostOwnedRpcHandlerKey = Extract<RpcHandlerKey, \`host.${string}\`>` (`manifest.ts:382`) types `HostProfile.hostHandlers` (`host-profile.ts:56-58`). Renaming the key removes it from that union, so a leftover `'host.layout': LayoutRpcHandlers` in the Electron profile becomes a **compile error**. That converts the profile cleanup from a review checklist item into a compiler gate. It also matches the naming of every other lib-owned entry (`command`, `filePicker`, `fileSystem`, `cron`, …).

Each class gains `static readonly METHODS = [...] as const satisfies readonly RpcMethodName[]`, per the pattern at `command-rpc.handlers.ts:43-46`:

- `LayoutRpcHandlers.METHODS = ['layout:persist', 'layout:restore']`
- `TerminalRpcHandlers.METHODS = ['terminal:create', 'terminal:kill']`
- `UpdateRpcHandlers.METHODS = ['update:get-state', 'update:check-now']`

Method strings are unchanged, so `assertManifestInvariants` (`manifest.ts:391-421`) stays satisfied and `deriveRpcSurface` output is byte-identical for every host.

### 4.4 Barrels

`libs/backend/rpc-handlers/src/lib/handlers/index.ts` and `libs/backend/rpc-handlers/src/index.ts` each gain the three class exports. `apps/ptah-electron/src/services/rpc/handlers/index.ts` loses them (and its stale `SHARED_HANDLERS` paragraph, §0.3 item 4).

---

## 5. Batch sequencing

Five batches. Each compiles, passes lint and the full test suite, and is independently committable. Layout is fully separable (no port, no token) and goes first as the shape-proving batch. Every port batch is separated from its handler batch so a port/token addition never lands in the same commit as a behavioural move.

**Gate for every batch** (identical, run before commit):
`nx typecheck platform-core rpc-handlers ptah-electron` · `nx lint platform-core rpc-handlers ptah-electron` · `nx test rpc-handlers` · `nx test ptah-electron` · `nx build ptah-electron`.
The decisive assertion is `apps/ptah-electron/src/di/rpc-surface.spec.ts` — "excludes nothing" + "serves every method in the RPC registry". It must stay green at every boundary.

### Batch 1 — Layout (pure relocation, zero ports, zero tokens)

| File                                                                  | Action                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/rpc-handlers/src/lib/handlers/layout-rpc.handlers.ts`   | CREATE — verbatim body + `static readonly METHODS`; imports unchanged (`TOKENS.LOGGER/RPC_HANDLER`, `PLATFORM_TOKENS.STATE_STORAGE` are already lib-visible) |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`                 | MODIFY — export                                                                                                                                              |
| `libs/backend/rpc-handlers/src/index.ts`                              | MODIFY — export                                                                                                                                              |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`          | MODIFY — import + `host.layout` → lib-owned `layout`                                                                                                         |
| `apps/ptah-electron/src/rpc-host-profile.ts`                          | MODIFY — drop `LayoutRpcHandlers` import + `'host.layout'`                                                                                                   |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                       | MODIFY — import `LayoutRpcHandlers` from the lib                                                                                                             |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`               | MODIFY — drop export                                                                                                                                         |
| `apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.ts` | DELETE                                                                                                                                                       |
| `eslint.config.mjs`                                                   | MODIFY — drop the layout entry                                                                                                                               |

Keep the `'[Electron RPC] …'` log prefixes verbatim. They are the only observable difference a lib move could introduce, and E2E/log-scraping baselines may depend on them. Renaming is a separate concern, not this task.

### Batch 2 — PTY port + token (no handler move; zero runtime delta)

| File                                                              | Action                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/interfaces/pty-host.interface.ts` | CREATE (§1.1)                                                                                                  |
| `libs/backend/platform-core/src/di/tokens.ts`                     | MODIFY — `PTY_HOST`                                                                                            |
| `libs/backend/platform-core/src/index.ts`                         | MODIFY — export the four types                                                                                 |
| `apps/ptah-electron/src/services/pty-manager.service.ts`          | MODIFY — `implements IPtyHost` (no body change)                                                                |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                   | MODIFY — `useToken` alias (§2.2)                                                                               |
| `apps/ptah-electron/src/di/container.smoke.spec.ts`               | MODIFY — assert `resolve(PLATFORM_TOKENS.PTY_HOST) === resolve(ELECTRON_TOKENS.PTY_MANAGER_SERVICE)` (Risk R2) |

Green on its own: nothing resolves `PTY_HOST` yet, and `useToken` registration is lazy.

### Batch 3 — Terminal handler move

| File                                                                    | Action                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts`   | CREATE — inject `PLATFORM_TOKENS.PTY_HOST: IPtyHost`; `static readonly METHODS`; replace `require('os').homedir()` (`terminal-rpc.handlers.ts:53`) with a top-level `import { homedir } from 'node:os'` |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `src/index.ts`   | MODIFY — export                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`            | MODIFY — `host.terminal` → lib-owned `terminal`                                                                                                                                                         |
| `apps/ptah-electron/src/rpc-host-profile.ts`                            | MODIFY — drop import + `'host.terminal'`                                                                                                                                                                |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                         | MODIFY — import from the lib                                                                                                                                                                            |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                 | MODIFY — drop export                                                                                                                                                                                    |
| `apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.ts` | DELETE                                                                                                                                                                                                  |
| `eslint.config.mjs`                                                     | MODIFY — drop the terminal entry                                                                                                                                                                        |

The `require('os')` swap is mandatory, not optional: `@typescript-eslint/no-require-imports` is clean across `libs/backend/rpc-handlers/src` today (verified — the only textual hit is a doc comment in `test-utils/heavy-module-mocks.ts:15`), and importing a Node builtin at module top level is behaviourally identical.

Keep the `as unknown as Error` log-argument casts verbatim (`terminal-rpc.handlers.ts:59, 73, 93`). They are ugly but they are the current logging shape; changing them changes log output. Note as a follow-up, do not fix here.

### Batch 4 — App-updater port + token (no handler move; zero runtime delta)

| File                                                                 | Action                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/interfaces/app-updater.interface.ts` | CREATE (§1.2)                                                                                      |
| `libs/backend/platform-core/src/di/tokens.ts`                        | MODIFY — `APP_UPDATER`                                                                             |
| `libs/backend/platform-core/src/index.ts`                            | MODIFY — export `IAppUpdater`, `AppUpdateState`                                                    |
| `apps/ptah-electron/src/services/update/update-manager.ts`           | MODIFY — `implements IAppUpdater` (no body change)                                                 |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                      | MODIFY — `useToken` alias (§2.3)                                                                   |
| `apps/ptah-electron/src/di/container.smoke.spec.ts`                  | MODIFY — assert `resolve(PLATFORM_TOKENS.APP_UPDATER) === resolve(UPDATE_MANAGER_TOKEN)` (Risk R1) |

### Batch 5 — Update handler move (+ schema + both specs)

| File                                                                                                                                                  | Action                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.handlers.ts`                                                                                   | CREATE — inject `PLATFORM_TOKENS.APP_UPDATER: IAppUpdater`; `static readonly METHODS`; **delete the stale header lines 8-9** (§0.3) and replace with the `requires: ['appUpdater']` note                         |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.schema.ts`                                                                                     | CREATE — verbatim from `apps/…/update-rpc.schema.ts`                                                                                                                                                             |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.handlers.spec.ts`                                                                              | CREATE (move) — replace the `require('./update-rpc.handlers')` shim + `as never` cast (`spec:54-61, 83`) with a normal `import` and a mock typed as `IAppUpdater`; all five test cases keep identical assertions |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.schema.spec.ts`                                                                                | CREATE (move) — verbatim                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `src/index.ts`                                                                                 | MODIFY — export                                                                                                                                                                                                  |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`                                                                                          | MODIFY — `host.update` → lib-owned `update`                                                                                                                                                                      |
| `apps/ptah-electron/src/rpc-host-profile.ts`                                                                                                          | MODIFY — drop import + `'host.update'`; the `hostHandlers` map is now `{ 'host.fileOpen', 'host.editorRevert', 'host.editorPane' }` (all `EditorRpcHandlers`, TASK_2026_173's problem)                           |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                                                                                                       | MODIFY — import from the lib; refresh the two stale log payload arrays (`:123-145`, `:174-183`) which already list handlers that no longer live where they claim                                                 |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                                                                                               | MODIFY — drop export + the `SHARED_HANDLERS` fossil paragraph (§0.3)                                                                                                                                             |
| `apps/ptah-electron/src/services/rpc/handlers/{update-rpc.handlers.ts, update-rpc.schema.ts, update-rpc.handlers.spec.ts, update-rpc.schema.spec.ts}` | DELETE                                                                                                                                                                                                           |
| `eslint.config.mjs`                                                                                                                                   | MODIFY — drop the update entry                                                                                                                                                                                   |

**Batches 2+3 and 4+5 may be squashed** if the reviewer prefers fewer commits; the split exists so a port/token addition is never reviewed together with a behavioural move. Batch 1 must stay standalone.

### Deliberately NOT in any batch

**No Zod schemas for layout / terminal.** `libs/backend/rpc-handlers/CLAUDE.md` says "Zod schemas mandatory", and these two handlers ship none. Adding `.parse()` during the move would newly reject malformed payloads the Electron build accepts today — a direct violation of "Electron … behavior and test baseline must not change at any phase boundary" (AC #5). Additionally, `layout:persist` genuinely has no schema: its contract is "an arbitrary bag persisted to `IStateStorage`" (`layout-rpc.handlers.ts:43-44`), so any schema would be either a lie or a no-op passthrough. `update` already ships schemas and keeps them. File the schema gap as a follow-up with an explicit accepted-behaviour delta; do not smuggle it into a relocation.

---

## 6. Risk register

Ordered by expected damage. R1 and R2 are the only ones that can silently change the Electron runtime surface.

**R1 — Duplicate `UpdateManager` instance (HIGH, silent, user-visible).**
If `PLATFORM_TOKENS.APP_UPDATER` is wired as `container.registerSingleton(PLATFORM_TOKENS.APP_UPDATER, UpdateManager)` instead of an alias, tsyringe constructs a **second** `UpdateManager`. `post-window.ts:197` starts instance A (which does the GitHub check and mutates `_currentState`), while `update:get-state` reads instance B — permanently `{state:'idle'}`. The update banner would never appear, and no test would fail. _Mitigation_: `{ useToken: UPDATE_MANAGER_TOKEN }` (§2.3) plus the identity assertion in Batch 4's smoke-spec change. This is the single most important line in the plan.

**R2 — Duplicate `PtyManagerService` instance (HIGH, silent).** Same failure mode. Instance B would own a separate `sessions` Map, so `terminal:create` would return an id that `IpcBridge.write`/`resize` (bound to instance A, `bootstrap.ts:225` → `ipc-bridge.ts:437`) cannot find — terminals open but accept no input, and `disposeAll` leaks the real PTYs on quit. _Mitigation_: `useToken` alias + identity assertion (Batch 2). Note the existing registration is `useValue` with an explicitly constructed instance (`phase-4-handlers.ts:163`), which makes the alias the only correct form.

**R3 — Registration failure semantics tighten from warn to throw (MEDIUM, intentional).** `registerHandlers` (`register-rpc-surface.ts:182-195`) resolves `libOwned` entries unguarded and wraps host-owned ones in try/catch with a warning. After the flip, a resolve failure in any of the three families throws during `registerRpcSurface` instead of degrading to a drift warning. On Electron all three resolve today, so there is no runtime delta — but the blast radius of a future DI mistake grows from "one namespace silently missing" to "Electron fails to boot". This is the correct direction (a missing PTY port must not silently drop `terminal:create`) and is exactly what P1 chose for every other lib handler. Recorded, not mitigated.

**R4 — `assertOnDrift: true` on Electron (LOW).** The Electron profile asserts on drift in dev/E2E (`rpc-host-profile.ts:81`). Combined with R3, a mid-batch mistake surfaces as a hard boot failure in `nx serve electron` / E2E rather than a log line. Treat as a feature: run `nx serve ptah-electron` once per batch as a smoke gate, not just `nx build`.

**R5 — Manifest key rename ripple (LOW, compile-checked).** Renaming `host.layout|terminal|update` shrinks `HostOwnedRpcHandlerKey`. Verified consumers: only `HostProfile.hostHandlers` (`host-profile.ts:56-58`). `deriveRpcSurface` partitions by `methods`, not keys (`register-rpc-surface.ts:57-70`); `apps/ptah-electron/src/di/rpc-surface.spec.ts` compares method lists; `expected-absent.ts` lists capabilities. All unaffected. Any leftover is a compile error, not a runtime bug.

**R6 — `require('os')` → `import { homedir } from 'node:os'` (LOW).** `os` is a Node builtin; esbuild leaves builtins alone for the CJS/node output that both `rpc-handlers` and `ptah-electron` produce. Behaviour identical. Verify `nx build ptah-electron` and that `terminal:create` with no `cwd` and no workspace still lands in the home directory.

**R7 — Pre-existing: unvalidated `params.shell` reaches `pty.spawn` (MEDIUM, NOT introduced here).** `terminal-rpc.handlers.ts:53-66` passes a webview-supplied `shell` straight into `PtyManagerService.create` → `pty.spawn(shell, …)` (`pty-manager.service.ts:81, 89`). Arbitrary-executable spawn from the renderer. This ships today and the move does not change it. Flagged so the reviewer knows it was seen and consciously left alone — fixing it means adding validation, which §5 "Deliberately NOT in any batch" excludes on baseline-preservation grounds. **Recommend a follow-up task.**

**R8 — Log-prefix and log-shape churn (LOW).** `'[Electron RPC] layout:persist saved'`, `'[TerminalRpc] …'`, `'[UpdateRpcHandlers] …'` and the `as unknown as Error` casts must move verbatim. `update-rpc.handlers.spec.ts:165` asserts on the exact `'[UpdateRpcHandlers] update:check-now failed'` string. Do not "clean up" logging in a relocation commit.

**R9 — Circular-import shape in the manifest (LOW).** `manifest.ts` imports from `../handlers` (the barrel) while handlers do not import the manifest — three more entries follow the existing 38-entry pattern (`manifest.ts:27-67`). No new cycle.

**R10 — Spec relocation changes the DI story for `UpdateRpcHandlers` (LOW).** The app spec uses `require()` + `as never` to dodge typing `UpdateManager` (`spec:54-61, 83`). In the lib it becomes a plain import with the mock typed as `IAppUpdater` — a strictly better test that must still produce five passing cases with unchanged assertions. Diff the test names before/after.

---

## 7. `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` state after each batch

`D:/projects/ptah-extension/eslint.config.mjs:32-39`.

**Start (6 entries):**

```js
const APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION = ['apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.ts'];
```

**After Batch 1 (5) — layout removed:**

```js
const APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION = ['apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.ts'];
```

**After Batch 2 (5) — unchanged** (port/token only, no file moved).

**After Batch 3 (4) — terminal removed:**

```js
const APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION = ['apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.ts'];
```

**After Batch 4 (4) — unchanged** (port/token only).

**After Batch 5 (3) — final state for this task:**

```js
const APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION = ['apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts', 'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts', 'apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts'];
```

All three survivors belong to TASK_2026_173. The comment block at `eslint.config.mjs:23-31` stays as-is — the list is not empty, so the exception cannot be removed yet. Do **not** touch the three remaining entries in this task.

---

## 8. Team-leader handoff

**Recommended developer**: `backend-developer` (tsyringe DI, hexagonal ports, Nx boundaries — no UI work).
**Complexity**: MEDIUM. **Estimated effort**: 4-6 h across five commits. Batch 1 is ~45 min; the risk-bearing work is the two `useToken` aliases.

**Files affected — summary**

_CREATE (7)_
`libs/backend/platform-core/src/interfaces/pty-host.interface.ts` · `libs/backend/platform-core/src/interfaces/app-updater.interface.ts` · `libs/backend/rpc-handlers/src/lib/handlers/layout-rpc.handlers.ts` · `.../terminal-rpc.handlers.ts` · `.../update-rpc.handlers.ts` · `.../update-rpc.schema.ts` · (+ 2 moved specs into `libs/backend/rpc-handlers/src/lib/handlers/`)

_MODIFY (10)_
`libs/backend/platform-core/src/di/tokens.ts` · `libs/backend/platform-core/src/index.ts` · `libs/backend/rpc-handlers/src/lib/handlers/index.ts` · `libs/backend/rpc-handlers/src/index.ts` · `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` · `apps/ptah-electron/src/rpc-host-profile.ts` · `apps/ptah-electron/src/di/phase-4-handlers.ts` · `apps/ptah-electron/src/di/container.smoke.spec.ts` · `apps/ptah-electron/src/services/pty-manager.service.ts` · `apps/ptah-electron/src/services/update/update-manager.ts` · `apps/ptah-electron/src/services/rpc/handlers/index.ts` · `eslint.config.mjs`

_DELETE (6)_
`apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.ts` · `terminal-rpc.handlers.ts` · `update-rpc.handlers.ts` · `update-rpc.schema.ts` · `update-rpc.handlers.spec.ts` · `update-rpc.schema.spec.ts`

**Critical verification points before implementation**

1. Both new tokens are **aliases** (`useToken`), never second `registerSingleton` calls — R1/R2.
2. `PtyManagerService implements IPtyHost` and `UpdateManager implements IAppUpdater` compile with **zero body changes**. If either needs a body change, the port is wrong — stop and re-derive it.
3. `apps/ptah-electron/src/di/rpc-surface.spec.ts` — "excludes nothing" + full-registry parity — green after every batch.
4. Manifest keys renamed to `layout` / `terminal` / `update` so stale `hostHandlers` entries fail to compile.
5. `layout:` / `terminal:` / `update:` already in `ALLOWED_METHOD_PREFIXES` — do **not** re-add.
6. No Zod added to layout/terminal; no log strings changed; `require('os')` swapped for `import { homedir } from 'node:os'` in the terminal handler only.

**Not done here, file as follow-ups**: Zod schemas for `terminal:*` (with an explicit accepted-input delta), the `params.shell` → `pty.spawn` validation gap (R7), and the `as unknown as Error` logger-argument casts.

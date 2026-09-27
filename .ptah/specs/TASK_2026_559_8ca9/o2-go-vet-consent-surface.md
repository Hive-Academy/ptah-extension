# O2 — `go vet` consent surface (gates Batch 37a) — TASK_2026_559_8ca9

Amendment to `implementation-plan-languages.md` ("Diagnostics", Tier 1, `:369-405`; Batches 37a/37b), per User
Decision 19 (`context.md:59`): `go vet` only, opt-in, pyright excluded, no build-running checkers. This document
only designs; it does not implement. Revised once under User Decision 24 (`context.md:69`); the Batch 37a review
verifies the revision (see "Revision (review r1)").

Path prefixes: `PC` = `libs/backend/platform-core/src`, `WI` = `libs/backend/workspace-intelligence/src`,
`RH` = `libs/backend/rpc-handlers/src/lib`, `VC` = `libs/backend/vscode-core/src`, `FE` =
`libs/frontend/chat/src/lib/settings`. All paths are relative to
`D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

## 1. Consent store: the approved host-state contract, not settings

**Decision.** Consent is stored exactly where the approved plan put it (`implementation-plan-languages.md:380-384`,
`batches.md:4273`, `:4319`): host-owned per-workspace state, `getStorageForWorkspace(root)`, key
`ptah.diagnostics.goVet.consent`. The r0 draft's settings-file design (`diagnostics.goVet.enabled` as a
`workspace.<hash>.` override in the file settings store, a settings-core schema entry and a `SCOPED_SETTING_KEYS`
row) is **withdrawn in full**. Nothing is added to `PC/file-settings-keys.ts`, `libs/backend/settings-core`,
`libs/shared/src/lib/types/rpc/rpc-auth.types.ts` or the `config:getScopes` / `config:clearScopeOverride` handler.

Why the settings route loses (verified):

- The generic scope revoke is a no-op for a workspace-only key: `RH/handlers/config-scope-rpc.handlers.ts:112-114`
  treats any one-element `supportedTargets` list as global-only and returns success without clearing, and
  inspection repeats it at `:178`. Advertising that route would report "revoked" while consent stays on.
- The settings resolver's workspace write falls back to the GLOBAL key when no path is active
  (`libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:196-201`; `readForPath` `:149`,
  `hasOverrideForPath` `:168`).
- The checker lives in workspace-intelligence, which the settings-core consumer guard does not admit
  (`libs/backend/settings-core/src/settings-core.spec.ts:784-821`), and Electron registers the resolver only after
  `ElectronDIContainer.setup` (`apps/ptah-electron/src/activation/bootstrap.ts:218-234`).

Why the host-state route carries the case (verified):

| Evidence                                                                                                                                                                 | Location                                                                                                                                                                            | Implication                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getStorageForWorkspace(root)` returns `undefined` for a root the host did not register, and must not be papered over                                                    | `PC/interfaces/workspace-scoped-state-storage.interface.ts:32-40`; structural probe `:60-68`                                                                                        | "host-opened root" and "fail closed" come from the store itself                                         |
| Electron registers `WorkspaceAwareStateStorage` under `WORKSPACE_STATE_STORAGE` in Phase 1.6                                                                             | `apps/ptah-electron/src/di/phase-1-infra.ts:127-151`                                                                                                                                | available before WI registers (`apps/ptah-electron/src/di/phase-2-libraries.ts:173`)                    |
| cli-engine registers the same class under the same token                                                                                                                 | `libs/backend/cli-engine/src/lib/container.ts:447-459`; WI registers at `:620`                                                                                                      | same contract on the CLI; no single-storage fallback needed                                             |
| Roots are registered by the host's `WorkspaceContextManager` only; storage dir = `<userDataPath>/workspace-storage/<base64url(path.resolve(root))>/workspace-state.json` | `VC/services/workspace-context-manager.ts:81-107`; `VC/services/workspace-aware-state-storage.ts:155-160, :329-331`                                                                 | the value lives in the host's user-data directory, never in the repository                              |
| CLI `userDataPath` is host-selected: `options.userDataPath ?? ~/.ptah`                                                                                                   | `libs/backend/platform-cli/src/registration.ts:45`; file settings take the same directory `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:49-53`           | the doc names the host-selected directory, not a fixed home path                                        |
| The CLI waits for its workspace registration before any command runs                                                                                                     | `libs/backend/cli-engine/src/lib/container.ts:468-496`                                                                                                                              | a CLI GET/SET sees the registered root, or fails closed if registration failed                          |
| `update(key, undefined)` deletes the key in both hosts' storages                                                                                                         | `libs/backend/platform-cli/src/implementations/cli-state-storage.ts:31-35`; `libs/backend/platform-electron/src/implementations/electron-state-storage.ts:168` (worker path `:161`) | revoke is a real deletion                                                                               |
| Root lookup precedent: `path.resolve`, exact key, then win32 case-folded match over `getAllWorkspacePaths()`; `null` never falls back to the active workspace            | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:661-680`                                                                                                           | the consent store copies this lookup (a third context; kept local, not shared, per the simplicity rule) |

### 1.1 Superseded vs. current contract (explicit)

| Aspect         | r0 draft (withdrawn)                                                                  | Current (this revision; equals plan `:380-384`)                                                                       |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Store          | `~/.ptah/settings.json` file settings, `workspace.<hash16>.diagnostics.goVet.enabled` | `WORKSPACE_STATE_STORAGE` → `getStorageForWorkspace(root)` → `workspace-state.json` in the host user-data dir         |
| Key            | `diagnostics.goVet.enabled` (boolean)                                                 | `ptah.diagnostics.goVet.consent` (record, §1.2)                                                                       |
| Read           | `hasOverrideForPath` + `readForPath`                                                  | `GoVetConsentStore.read(root)`                                                                                        |
| Write / revoke | resolver `write(…,'workspace')` / `config:clearScopeOverride`                         | `GoVetConsentStore.grant` / `.revoke` (`update(key, undefined)`), only through `diagnostics:go-vet-consent-set`       |
| Failure        | resolver missing, global fallback risk                                                | storage not workspace-scoped, root unregistered, storage not ready, any throw, malformed or stale record → **denied** |

### 1.2 The consent record and its staleness rules

Value at `ptah.diagnostics.goVet.consent` in the root's own storage:

```ts
{ v: 1,
  rootRealpath: string,                 // fs.realpathSync.native(root) at grant
  rootId: string | null,                // `${dev}:${ino}` of fs.statSync(root, { bigint: true }); null when ino is 0
  goBinary: { path: string; size: number; mtimeMs: number }, // canonical binary accepted at grant (§4.1)
  grantedAt: string }                   // ISO time, display only
```

`GoVetConsentStore.read(root)` answers `{ state: 'off' } | { state: 'on', record } | { state: 'stale', reason }`:

- `off`: storage not workspace-scoped, root not registered, key absent, record fails a strict zod parse, or any
  throw (including `StateStorageNotReadyError`). Fail closed.
- `stale`, reason `root-moved`: `realpath(root)` differs from `rootRealpath` (the path now points elsewhere, e.g. a
  retargeted junction or symlink).
- `stale`, reason `root-replaced`: both `rootId` values are non-null and differ (the folder was deleted and
  re-created or re-cloned at the same path — the case a path-keyed store cannot see by itself). Limitation, stated:
  when the file system reports `ino` 0 (some network or FAT volumes) `rootId` is `null` and only the path and
  realpath checks apply.
- `stale`, reason `go-changed`: the binary §4.1 resolves now differs in canonical path, size or mtime from
  `goBinary` (an upgraded, replaced or re-pointed toolchain needs a fresh consent).

`stale` is treated exactly like `off` by the checker (nothing spawns; reason `consent-stale`). The record is not
auto-deleted; the UI and CLI show the reason, and re-enabling overwrites it.

**Repository files never grant consent.** No repository file is read for consent: not `.ptah/`, `.vscode/`,
`go.mod`, `go.work` or any settings file. The store lives in the host user-data directory. One further guard:
when that directory resolves inside the checked root (a CLI launched with its user-data path inside the repo), the
store answers `off` — **Assumption:** the store receives the user-data path as `PLATFORM_INFO.globalStoragePath`;
37b confirms that Electron's and cli-engine's `PLATFORM_INFO.globalStoragePath` equal the `userDataPath` passed to
`WorkspaceContextManager` (`phase-1-infra.ts:153-156`; `container.ts:461-464`), and otherwise passes that path
explicitly.

**Threat model (unchanged, stated honestly).** Consent separates the user's choice from repository content. It
does not defend against an agent the user already allowed to run shell commands or write the user-data directory:
such an agent could run `go vet` itself. No MCP tool writes workspace state for this key.

## 2. Components and ownership

| Component           | Lib / file                                                                                         | Responsibility                                        | Batch |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----- |
| `GoVetConsentStore` | `WI/diagnostics/external-checkers/go-vet-consent-store.ts` (+ spec)                                | root lookup (§1), record read/grant/revoke, staleness | 37a   |
| `resolveGoBinary`   | `WI/diagnostics/external-checkers/go-binary-resolver.ts` (+ spec)                                  | §4.1; also used by grant to record `goBinary`         | 37a   |
| `CheckerRunner`     | `WI/diagnostics/external-checkers/checker-runner.ts` (+ spec)                                      | spawn, env, limits, kill (`batches.md:4270`)          | 37a   |
| `GoVetChecker`      | `WI/diagnostics/external-checkers/go-vet-checker.ts` (+ spec, + hostile integration spec)          | invocation, parsing, consent re-check before spawn    | 37a   |
| WI exports          | `WI/index.ts`                                                                                      | export the store, resolver and checker types          | 37a   |
| Consent RPC         | `RH/handlers/diagnostics-consent-rpc.handlers.ts` (+ spec)                                         | GET/SET (§3)                                          | 37b   |
| Electron card       | `FE/ptah-ai/go-vet-consent-config.component.ts` (+ spec)                                           | §5.1                                                  | 37b   |
| CLI sub-command     | `apps/ptah-cli/src/cli/commands/config.ts`, `apps/ptah-cli/src/cli/router.ts` (+ `config.spec.ts`) | §5.2                                                  | 37b   |

**Dependency direction (verified).** WI already depends on platform-core (`libs/backend/workspace-intelligence/package.json:10`)
and imports nothing from settings-core for this work. rpc-handlers already depends on workspace-intelligence
(`libs/backend/rpc-handlers/package.json:17`), so the handler imports the store and resolver from WI; no new edge.

**DI timing (verified).** `WORKSPACE_STATE_STORAGE` exists before WI registration in both hosts (§1 table), so the
store can be built at registration. The spawner (`SDK_TOKENS.SDK_PROCESS_SPAWNER`) is registered later, by
`registerSdkServices` (`apps/ptah-electron/src/di/phase-2-libraries.ts:183`; `libs/backend/cli-engine/src/lib/container.ts:629`),
after `registerTypeScriptDiagnosticsProvider` (`:177` / `:624`). Therefore the checker receives the spawner as a
lazy getter `() => IProcessSpawner` resolved at first run; an unresolvable spawner at run time is outcome
`failed`, reason `no-spawner`, never "No issues". 37b owns where the checker is attached to the provider
(`WI/diagnostics/language-aware-diagnostics-provider.ts:398-432`, `WI/di/register.ts:86-105`).

## 3. RPC family `diagnosticsConsent`

Registered in `RPC_HANDLER_MANIFEST` (`RH/host-profile/manifest.ts:99`) with `requires: ['goVetDiagnostics']`, a
new capability appended to `RPC_CAPABILITIES` (`RH/host-profile/capabilities.ts:18-67`) and to `ALL_DISABLED`
(`RH/host-profile/host-profile.ts:67-83`), enabled only by the Electron profile
(`apps/ptah-electron/src/rpc-host-profile.ts:26-42`) and the CLI profile
(`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:26-31`). VS Code keeps the default `false`, so the family
is not served there (same pattern as `voice`, `manifest.ts:377-381`). Methods are typed in
`libs/shared/src/lib/types/rpc.types.ts` (`RpcMethodRegistry` `:677`, `RPC_METHOD_ENTRIES` `:3444`). Params are
parsed with strict zod schemas; unknown keys are rejected.

**`diagnostics:go-vet-consent-get`** `{}` →

```ts
{ supported: boolean;                     // false when WORKSPACE_STATE_STORAGE is not workspace-scoped
  workspace: { root: string } | null;     // the active, host-registered root, or null
  state: 'off' | 'on' | 'stale';
  staleReason?: 'root-moved' | 'root-replaced' | 'go-changed';
  goBinary?: string }                     // canonical path the grant would record / recorded (display)
```

Active root = `lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot()` — the expression both hosts already
use for their active-workspace source (`apps/ptah-electron/src/activation/bootstrap.ts:226-229`;
`libs/backend/cli-engine/src/lib/container.ts:737-740`), then matched to a registered storage key (§1 lookup).

**`diagnostics:go-vet-consent-set`** `{ enabled: boolean; workspaceRoot: string; source: 'settings-ui' | 'cli' }` →
`{ success: true; state: 'on' | 'off' } | { success: false; error: E }`, with
`E = 'invalid-params' | 'unsupported' | 'no-workspace' | 'workspace-changed' | 'no-go-binary' | 'persist-failed'`.

Order of checks, all before any write:

1. zod strict parse → `invalid-params`.
2. `supported` → else `unsupported`.
3. Current active root exists and is registered → else `no-workspace`.
4. **Stale-UI guard.** `workspaceRoot` (the root the caller last displayed) must equal the current active root
   after `path.resolve` (win32: case-folded). Mismatch → `workspace-changed`, nothing written or cleared. The caller
   value is a comparison token only; the write target is always the host's own active, registered root.
5. `enabled:true` → `resolveGoBinary(root)` (§4.1) → none → `no-go-binary`; else write the §1.2 record.
   `enabled:false` → `update(KEY, undefined)`.
6. Read back through `GoVetConsentStore.read(root)`; if the state is not the requested one → `persist-failed`
   (a thrown write is also `persist-failed`). Success is reported only after the read-back.
7. Audit line (§6).

**Queued work and revoke.** The checker calls `GoVetConsentStore.read(root)` immediately before each spawn, after
binary resolution and with no caching, and compares the resolved binary with the record. A revoke therefore stops
the next run. A run already spawned when the revoke lands is not killed; it is bounded by the 30 s timeout.

## 4. Fixed invocation and environment (37a)

### 4.1 Binary resolution (replaces `which`)

`which` is not used: on win32 it searches `process.cwd()` first and honours the inherited `PATHEXT`
(`node_modules/which/lib/index.js:19-26, :31-33`; `which` ^7.0.0 at `package.json:196`). `resolveGoBinary` instead:

1. Reads the parent PATH (win32: the `Path`/`PATH` key case-insensitively), splits on `path.delimiter`, strips one
   pair of surrounding quotes.
2. Keeps only absolute entries; on win32 also drops UNC and device paths (`\\server\…`, `\\?\…`, `\\.\…`). Empty,
   relative and drive-relative (`C:foo`) entries are dropped.
3. Canonicalises each directory with `fs.realpathSync.native`; drops directories that fail, that equal or lie inside
   the canonical checked root, or that lie inside the canonical host user-data directory; de-duplicates.
4. Candidate = `<dir>/go.exe` on win32, `<dir>/go` elsewhere. No other name, no `PATHEXT`, no current directory.
5. The candidate must be a regular file; POSIX: `fs.accessSync(X_OK)`. Canonicalise it; reject it when the
   canonical path is inside the root or, on win32, does not end in `.exe` (case-insensitive) — this keeps the
   wrapper rule for a `go.exe` symlink to a `.cmd`/`.bat`.
6. A rejected candidate does **not** end the search; the next directory is tried, so a hostile early entry cannot
   hide a valid installed toolchain. No accepted candidate → `not-run`, reason `no-go-binary`.

The child's `PATH` is the list of directories kept in step 3.

**Through the spawner adapter.** The host spawner reparses the command with cross-spawn
(`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:705-711`, parser `:162-170`). For an
absolute `…\go.exe`: `which` checks only the file itself when the command contains a separator
(`node_modules/which/lib/index.js:25`), and `.exe` matches `isExecutableRegExp`, so no `cmd.exe` wrapper is added
(`node_modules/cross-spawn/lib/parse.js:9, :27-40`; resolution `node_modules/cross-spawn/lib/util/resolveCommand.js:27-30`).
37b adds an adapter spec that proves it (§7.3).

### 4.2 Invocation

Argument array, no shell, through the host `IProcessSpawner` (`PC/interfaces/process-spawner.interface.ts:22-33`;
the request `env` is the child's complete environment):

```
<abs go.exe|go> vet -json <pkg> [<pkg> …]
```

- `cwd` = the nearest directory containing `go.mod` above the requested files, inside the root. No `go.mod`
  (GOPATH mode) → `unchecked`, reason `no-go-mod`; nothing runs.
- `<pkg>` = `./<rel dir>` for each distinct directory of a requested `.go` file, relative to `cwd`: stays under
  `cwd`, does not start with `-`, does not contain `...`; at most 20 packages, the rest `omittedByCap`.
- Scoped calls only; an unscoped call never runs vet (Go files `unchecked`, "pass files").
- No caller-supplied flags: the tool schema has no field for them.

### 4.3 Environment (built from scratch, never spread)

| Variable                                                                                                     | Value                           | Why                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PATH`                                                                                                       | the §4.1 kept directories       | —                                                                                                                                                                        |
| `HOME`/`USERPROFILE`, `SystemRoot`, `TEMP`, `TMP`, `LOCALAPPDATA` (win32), `XDG_CACHE_HOME` (if set), `LANG` | inherited                       | module and build cache location, locale                                                                                                                                  |
| `GOFLAGS`                                                                                                    | `-mod=readonly -buildvcs=false` | the only flags source; replaces a user `-toolexec`/`-vettool`/`-overlay`; `-buildvcs=false` stops `git` from being invoked (a repo `core.fsmonitor` could run a program) |
| `GOENV`                                                                                                      | `off`                           | ignores the user's go env file                                                                                                                                           |
| `GOTOOLCHAIN`                                                                                                | `local`                         | always the bundled toolchain; no switch or download                                                                                                                      |
| `GOPROXY` / `GOSUMDB`                                                                                        | `off` / `off`                   | no network; missing modules fail and are reported                                                                                                                        |
| `GONOPROXY`, `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE`, `GOCACHEPROG`                                           | empty                           | no direct VCS path, no external cache program                                                                                                                            |
| `GOWORK`                                                                                                     | `off`                           | no `go.work` pulling in outside modules                                                                                                                                  |
| `GO111MODULE`                                                                                                | `on`                            | module mode only                                                                                                                                                         |
| `CGO_ENABLED`                                                                                                | `0`                             | no C compiler; files that import C are excluded and reported                                                                                                             |
| `GOEXPERIMENT`, `GODEBUG`, `CC`, `CXX`, `CGO_*`, `NODE_*`, `PATHEXT`                                         | absent                          | —                                                                                                                                                                        |

**Toolchain behaviour (corrected).** Under `GOTOOLCHAIN=local` the go command always runs the bundled toolchain.
A newer **`toolchain`** line is only a suggestion and is ignored: vet runs with the local version. A newer **`go`**
line is a minimum requirement the local toolchain refuses to load; that is reported as `failed`, reason
`toolchain-mismatch` ([Go toolchains](https://go.dev/doc/toolchain): "declares a suggested toolchain"; "refuses to
load a module or workspace that declares a minimum required Go version greater than the toolchain's own version";
"When `GOTOOLCHAIN` is set to `local`, the `go` command always runs the bundled Go toolchain"). This matches the
plan's acceptance at `implementation-plan-languages.md:401-402`.

**Limits.** Timeout 30 s (inside the 45 s diagnostics budget), then a tree kill; stdout+stderr cap 2 MiB, then a
kill and `failed`, reason `too-large`; at most 500 diagnostics parsed.

**Honest failure.** A non-zero exit that is not a vet finding, unparseable output, a timeout, missing modules, a
toolchain mismatch or no `go.mod` gives `failed` or `unchecked` for Go with a fixed reason, never "No issues".
Other languages' results are kept.

**What still executes (stated for the user and the description).** Runs: the user's own Go toolchain (the `go`
command, the compiler front end, and the `vet` tool in `GOROOT/pkg/tool`); it reads the module's source and module
cache and writes the build cache. Does not run: `go:generate`, tests, build scripts, custom `-vettool`/`-toolexec`
programs, downloaded toolchains, network fetches, `git`, C compilers. Opt-in is authorisation, not a sandbox; the
guarantee covers only this invocation and environment.

## 5. Surfaces per host (the 37a gate: named files and tests)

### 5.1 Electron — Settings → Tools → "Run `go vet` for this workspace"

- **Files:** `FE/ptah-ai/go-vet-consent-config.component.ts` (new) + `FE/ptah-ai/go-vet-consent-config.component.spec.ts`
  (new); `FE/settings.component.ts` (add the import next to `VoiceConfigComponent`, `:31`, and to the standalone
  `imports` array, `:66-78`); `FE/settings.component.html` (inside the existing `@if (isElectron)` block of the
  `tools` tab, `:186-193`).
- **Pattern:** the sibling Electron-only card `FE/ptah-ai/voice-config.component.ts:191-217` and its spec
  `FE/ptah-ai/voice-config.component.spec.ts:107-233` (optimistic change reverted on failure, `:233`); RPC card
  shape `FE/pro-features/browser-settings.component.ts:62-100`.
- **Behaviour.** The card calls GET on init and again whenever `WorkspaceScopeService.scopeKey()` changes
  (`libs/frontend/core/src/lib/services/workspace-scope.service.ts:83-104`), using an `effect`. A GET response is
  applied only if `scopeKey()` still equals the key captured when the request started; the toggle is disabled while
  a GET or SET is in flight. It shows the workspace root from GET, the state (`off`/`on`/`stale` + reason), the Go
  binary path, and the fixed "what this runs" text (§4.3). The toggle sends SET with `workspaceRoot` = the displayed
  root and `source:'settings-ui'`. On `success:false` the toggle reverts and a fixed message per error is shown;
  `workspace-changed` also triggers a fresh GET. The card renders nothing when `supported:false`. Any
  success-message timer is cleared through `DestroyRef`.

### 5.2 CLI — `ptah config go-vet <status|on|off>`

- **Files:** `apps/ptah-cli/src/cli/commands/config.ts` (add `go-vet-status`/`go-vet-on`/`go-vet-off` to
  `ConfigSubcommand`, `:43-54`, the dispatch switch `:102-128`, header list `:1-17`); `apps/ptah-cli/src/cli/router.ts`
  (a `config go-vet` command group registered like `config autopilot`, `:325-345`);
  `apps/ptah-cli/src/cli/commands/config.spec.ts` (extend).
- **Flow.** `withEngine(globals, { mode: 'full', requireSdk: false }, …)` as in `runAutopilotSet`
  (`config.ts:398-432`). `status` calls GET and writes notification `config.goVet`
  `{ supported, workspaceRoot, state, staleReason?, goBinary? }`. `on`/`off` call GET, then SET with
  `workspaceRoot` from that GET and `source:'cli'`, then write the notification with the SET result. The root is the
  CLI's workspace (`--cwd` or cwd), fixed for the process.
- **Exit codes** (`apps/ptah-cli/src/cli/jsonrpc/types.ts:342-349`): success → `0`; `supported:false`, or SET
  `success:false` → `1` (`GeneralError`) with one fixed stderr line `ptah config go-vet: <error>`; bad sub-command →
  `2` (`UsageError`); transport failure → `5` (`InternalFailure`), as the existing catch in `config.ts:130-136`.
  Unlike `autopilot set` (which returns `0` whatever the RPC answered, `:430`), a failed consent change never exits
  `0`.

### 5.3 VS Code — not applicable

The capability stays `false`, the family is not served and the Electron card is inside `@if (isElectron)`. VS Code
diagnostics come from `vscode.languages.getDiagnostics()`
(`libs/backend/platform-vscode/src/implementations/vscode-diagnostics-provider.ts:57`); Go vet results appear there
only if the user's Go extension is installed and configured to run vet — Ptah does not claim that it is.

### 5.4 "Consent off" answer

The language-aware provider marks requested `.go` files `unchecked` with `checks:'syntax-only'`; they still get the
Tier 0 syntax check. The formatter adds one fixed line, varying with the state:

> Go files were syntax-checked only; `go vet` is off for this workspace. Enable it in Settings → Tools (desktop
> app) or run `ptah config go-vet on` in this workspace.

For `stale`: "…; `go vet` consent for this workspace is out of date (<reason>). Re-enable it in …". Not shown on VS
Code. No quoted token follows the word "from" in any user-facing string: the Electron bundle scanner treats
`from "<x>"` and a bare `import "<x>"` in a string as imports (`apps/ptah-electron/scripts/lib/bundle-imports.js:116-128`;
batch rule `batches.md:1948-1951`).

## 6. Audit log

Fixed-text `info` lines; no paths, raw output or error text. The root is logged as
`sha256(path.resolve(root)).slice(0,16)`.

- Per run: `[Diagnostics] go vet run` `{ workspaceHash, packages, durationMs, outcome: 'ok' | 'findings' | 'timeout'
| 'failed' | 'too-large' | 'not-run', reason?, goVersion? }`; `reason` ∈ `no-consent`, `consent-stale`,
  `no-go-binary`, `no-go-mod`, `no-spawner`, `toolchain-mismatch`, `missing-modules`, `unparseable`.
- Per consent change: `[Diagnostics] go vet consent changed` `{ workspaceHash, enabled, source: 'settings-ui' | 'cli' }`,
  written only after a successful read-back.

## 7. Specs (each fails before its code exists)

### 7.1 37a — fake-spawner and store specs (WI)

`go-vet-consent-store.spec.ts`:

1. Storage not workspace-scoped (plain `IStateStorage`) → `off`.
2. Root not registered → `off`; a registered sibling root with consent does not leak (no active fallback).
3. win32 drive-letter case variant of a registered root → found (plugin-loader lookup).
4. Malformed record (wrong `v`, extra keys, wrong types) → `off`.
5. `StateStorageNotReadyError` / any throw → `off`.
6. Realpath differs → `stale/root-moved`; `dev:ino` differs → `stale/root-replaced`; `rootId:null` → ino check
   skipped; binary size/mtime/path differs → `stale/go-changed`.
7. `revoke` → key deleted (`keys()` no longer lists it) and `read` → `off`.
8. A repository `.ptah/workspace-state.json`, `.ptah/settings.json` and `.vscode/settings.json` each containing
   `ptah.diagnostics.goVet.consent` and `diagnostics.goVet.enabled: true` → `off`.
9. User-data directory inside the root → `off`.

`go-binary-resolver.spec.ts` (temp dirs; win32 cases run on every OS through an injected `platform`):

10. PATH with `""`, `.`, a relative entry, `C:foo`, a UNC entry and an in-workspace entry → all dropped.
11. **Host cwd ≠ checked root and cwd contains `go.exe`**; sanitized PATH contains a valid toolchain → the PATH
    toolchain is chosen; the cwd binary is never returned.
12. `PATHEXT=.CMD;.BAT` in the parent env and a `go.cmd` / `go.bat` first on PATH → skipped; a later `go.exe` found.
13. A `go.exe` symlink resolving into the workspace, and one resolving to a `.cmd` → rejected, search continues,
    later valid binary returned.
14. Quoted PATH entry → unquoted and accepted.

`checker-runner.spec.ts` / `go-vet-checker.spec.ts`:

15. No consent → nothing spawned; `not-run/no-consent`. Stale → `not-run/consent-stale`.
16. **Grant → run (spawned) → revoke → next run: no spawn.** Consent read counted once per run, after binary
    resolution, before spawn.
17. The inherited env contains `GOFLAGS=-toolexec=evil`, `GOENV=/x`, `GOCACHEPROG=evil`, `GOTOOLCHAIN=auto`,
    `CGO_ENABLED=1`, `NODE_OPTIONS`, `CC`, `PATHEXT` → the spawned env equals the allowlist exactly (whole-object
    assertion).
18. Package argument validation: outside `cwd`, leading `-`, `...`, 21 packages (1 omitted).
19. Delayed spawn then timeout → tree kill; `failed/timeout`; the TS results in the same call are intact.
20. Output over 2 MiB → kill; `failed/too-large`.
21. Non-zero exit with unparseable output → `failed/unparseable`, never "No issues".
22. Cancellation mid-run → killed; no partial Go claim.
23. Spawner getter throws → `failed/no-spawner`.
24. Audit lines: no path substring; hash as §6.

### 7.2 37a — real-binary hostile fixture

`go-vet-hostile.integration.spec.ts`; skipped with a printed reason when no `go` resolves. Each claim has its own
package and its own observable evidence; a cgo failure alone never counts as exercising another case.

- **generate:** a `//go:generate` directive writes a marker file → marker absent after vet.
- **suggested toolchain:** `go.mod` with `go <local major.minor>` and `toolchain go1.99.0` → vet **runs**; no new
  directory under `$(go env GOMODCACHE)/golang.org/toolchain*`; the audit `goVersion` equals the local version.
- **minimum go version:** `go.mod` with `go 1.99` → `failed/toolchain-mismatch`; no new toolchain directory.
- **network:** a `require` of a non-cached module → `failed/missing-modules`; no new module-cache entry.
- **cgo:** a file whose import line for C is built by string concatenation in the spec (§5.4 scanner rule) →
  reported not built; no cgo output directory.
- **vcs:** a fixture `.git/config` with `core.fsmonitor` pointing at a marker-writing script → marker absent.
- **toolexec:** `GOFLAGS=-toolexec=<marker script>` in the parent env → marker absent.

### 7.3 37b — surface and wiring specs

`RH/handlers/diagnostics-consent-rpc.handlers.spec.ts` (real `WorkspaceAwareStateStorage` + `CliStateStorage` in a
temp user-data dir):

1. Grant persists in the root's own `workspace-state.json` under the user-data dir; no global/default-storage key
   and no settings-file key is written (no global fallback).
2. Restart: a new store over the same directory reads `on` (readback).
3. Isolation: grant on A; B (also registered) reads `off`; revoke on B leaves A `on`.
4. Revoke → key deleted; GET `off`; next checker run spawns nothing.
5. No active/registered root → `no-workspace`; nothing written.
6. Capability off / storage not workspace-scoped → GET `supported:false`, SET `unsupported`.
7. Invalid params (extra key, non-boolean `enabled`, missing `workspaceRoot`, unknown `source`) → `invalid-params`.
8. Write throws, or read-back disagrees → `persist-failed`; no audit "changed" line.
9. **Stale root:** GET on A; active becomes B; SET `{ workspaceRoot: A }` → `workspace-changed`, neither A nor B
   changed. GET on A; A closed, no workspace; SET → `no-workspace`. Same for revoke.
10. `workspaceRoot` naming a registered but non-active root, or an unregistered path → `workspace-changed`; nothing
    written (caller value is never a write target).
11. No Go binary → `no-go-binary`, nothing written.

`FE/ptah-ai/go-vet-consent-config.component.spec.ts`: renders root/state/binary from GET; hidden on
`supported:false`; toggle sends the displayed root; `workspace-changed` reverts and re-fetches; scope change while a
GET is in flight discards the old response and refetches; `persist-failed` reverts with no success message; stale
state shows its reason.

`apps/ptah-cli/src/cli/commands/config.spec.ts`: `status` prints the notification; `on` → GET then SET with GET's
root; `success:false` → exit `1` and no success notification; `supported:false` → exit `1`; unknown sub-command →
exit `2`; transport throw → exit `5`.

Host wiring (37b.1 files): an Electron and a cli-engine wiring spec (next to the existing container specs) assert
the capability is `true`, `diagnostics:go-vet-consent-get` answers `supported:true`, and the checker is attached.
**Missing wiring must fail these specs; `supported:false` does not satisfy 37b.** The VS Code profile keeps the
capability `false` (manifest / RPC-surface parity specs: `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`,
`apps/ptah-cli/src/test-utils/manifest-parity.spec.ts` — update if they enumerate methods).

Spawner adapter: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts` gains a case: an
absolute `…\go.exe` path with args `['vet','-json','./a']` on win32 → `parseCommand` yields the same command and
args, no `cmd.exe`, no `/d /s /c`, `windowsVerbatimArguments` false.

## 8. Batch footprint

**37a** (workspace-intelligence only): `WI/diagnostics/external-checkers/{checker-runner, go-vet-checker,
go-binary-resolver, go-vet-consent-store}.ts` + their specs, `…/go-vet-hostile.integration.spec.ts`, `WI/index.ts`.
The `batches.md:4273` rule ("`getStorageForWorkspace(root)` → `undefined` → denied; no fallback") stands as written.

**37b** — split so each part is independently green:

- **37b-i (backend):** `libs/shared/src/lib/types/rpc.types.ts`; `RH/host-profile/capabilities.ts`,
  `RH/host-profile/host-profile.ts`, `RH/host-profile/manifest.ts`; `RH/handlers/diagnostics-consent-rpc.handlers.ts`
  (+ spec); `apps/ptah-electron/src/rpc-host-profile.ts`; `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`;
  `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`; plus the 37b.1 wiring files
  (`batches.md:4306`) and their wiring specs.
- **37b-ii (Electron card):** `FE/ptah-ai/go-vet-consent-config.component.ts` (+ spec), `FE/settings.component.ts`,
  `FE/settings.component.html`.
- **37b-iii (CLI):** `apps/ptah-cli/src/cli/commands/config.ts`, `apps/ptah-cli/src/cli/router.ts`,
  `apps/ptah-cli/src/cli/commands/config.spec.ts`; `WIT/matrix/activations/b37b.ts`.

Projects: workspace-intelligence, shared, rpc-handlers, agent-sdk (spec only), cli-engine, ptah-electron,
frontend chat, ptah-cli. The 37b verification command (`batches.md:4325`) must add `@ptah-extension/rpc-handlers`,
`@ptah-extension/shared`, the chat frontend project and `ptah-cli`.

## Revision (review r1)

| #   | Finding                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                             | Section                                |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Generic revoke is a no-op for a workspace-only key | Generic route and `SCOPED_SETTING_KEYS` registration removed; settings store withdrawn; revoke only via the dedicated SET, which deletes the key and verifies by read-back; handler spec cases 4 and 8                                                                                                                                                                                                                             | §1, §1.1, §3, §7.3                     |
| 2   | Consent not bound to the displayed workspace       | GET returns `workspace.root`; SET requires `workspaceRoot` and rejects `workspace-changed` before any write/clear; caller value never a write target; UI refetch on `scopeKey` change with stale-response discard; A→B and A→none tests; grant→run→revoke→no-spawn; consent re-read before every spawn, in-flight run bounded by timeout. Also stale consent on disk: record binds realpath, `dev:ino` and the Go binary → `stale` | §1.2, §3, §5.1, §7.1 (16), §7.3 (9–10) |
| 3   | `which` searches cwd / honours PATHEXT on Windows  | `which` replaced by `resolveGoBinary`: sanitized absolute dirs only, `go.exe` only, canonical dirs and candidates, rejected candidates skipped, never cwd/PATHEXT; spawner-adapter proof for an absolute `.exe`; tests 10–14 incl. host cwd containing `go.exe`                                                                                                                                                                    | §4.1, §7.1, §7.3                       |
| 4   | Storage contract and reader ownership inconsistent | Returned to the approved `getStorageForWorkspace(root)` / `ptah.diagnostics.goVet.consent` contract; superseded r0 contract tabulated; WI-owned `GoVetConsentStore`, no settings-core import; DI timing and lazy spawner stated; both §3 assumptions resolved with citations (active-root sourcing, storage registration)                                                                                                          | §1, §1.1, §2                           |
| 5   | Surface file/test handoff incomplete               | Parent TS file, router, `config.spec.ts`, handler spec, wiring specs, adapter spec named; acceptance cases listed (persisted grant, no global fallback, readback, isolation, revoke, no root, unsupported, invalid params, failed persistence, stale root, repository files); SET result/error union and CLI exit codes; host-selected user-data dir described                                                                     | §3, §5, §7.3, §8                       |
| 6   | Hostile toolchain expectation wrong                | Prose corrected (suggested `toolchain` ignored; newer `go` minimum refused) with Go docs; split into two fixtures                                                                                                                                                                                                                                                                                                                  | §4.3, §7.2                             |
| 7   | Stale citations                                    | validate-deps rule now cites the scanner and `batches.md:1948-1951`; resolver lines corrected (`:149`, `:168`, `:196-201`); RPC types `:677`/`:3444`; card pattern lines refreshed                                                                                                                                                                                                                                                 | §1, §3, §5                             |

## Open questions for the user

None. Binding consent to the Go binary (§1.2 `go-changed`) is this design's choice; a Go upgrade therefore asks for
one re-enable. If the user prefers consent to survive toolchain upgrades, 37a drops the `goBinary` comparison and
keeps the per-run §4.1 checks — no other section changes.

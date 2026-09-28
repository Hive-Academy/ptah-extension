# O2 — `go vet` consent surface (gates Batch 37a) — TASK_2026_559_8ca9

Amendment to `implementation-plan-languages.md` ("Diagnostics", Tier 1, `:369-405`; Batches 37a/37b), per User
Decision 19 (`context.md:59`): `go vet` only, opt-in, pyright excluded, no build-running checkers. Revised once
under User Decision 24 (`context.md:69`) ("Revision (review r1)"). **Updated to the contract Lane K shipped**
(merged in `da21c936c`; `lane-k-closing-fix-report.md` in the Lane K worktree; closing review
`reviews/lane-k-closing-review-r3.md`; User Decisions 25 and 26, `context.md:71`, `:73`). See "Revision (as
shipped, Lane K)". Where this text and the merged source disagree, the source wins.

Path prefixes: `PC` = `libs/backend/platform-core/src`, `WI` = `libs/backend/workspace-intelligence/src`,
`EC` = `WI/diagnostics/external-checkers`, `RH` = `libs/backend/rpc-handlers/src/lib`, `SP` =
`libs/backend/agent-sdk/src/lib/helpers`, `VC` = `libs/backend/vscode-core/src`, `FE` =
`libs/frontend/chat/src/lib/settings`. All paths are relative to
`D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Line numbers are those of the merged
tree at `da21c936c`.

## 1. Consent store: a host-owned record file, not settings

**Decision (as shipped).** Consent is host-owned and exists only for a root the host registered: the root must
resolve through `getStorageForWorkspace(root)` (the approved plan's rule, `implementation-plan-languages.md:380-384`,
`batches.md:4273`; `EC/go-vet-consent-store.ts:359-375` `isRegistered`). The consent itself lives in **its own
record file**:

```
<userData>/go-vet-consent/<first 32 hex of sha256(path.resolve(root), case-folded on win32)>.json
```

(`GO_VET_CONSENT_DIR` `EC/go-vet-consent-store.ts:46`; `recordFile` `:313-320`). `userData` is
`PLATFORM_INFO.globalStoragePath` for both the checker (`WI/di/register.ts:140-146`) and the RPC handler
(`RH/handlers/diagnostics-consent-rpc.handlers.ts:124-127`), so both judge the same file.

- **Re-read at every decision.** `read(root, currentGoBinary)` reads the file from disk each time and keeps no
  copy (`EC/go-vet-consent-store.ts:182-212`, "never cached"). A revoke made by another process (a second CLI, the
  desktop app) is therefore seen by the next decision.
- **Grant is atomic.** The record is written to a unique temporary file (`flag: 'wx'`) and renamed over the record
  file; the temporary file is removed in `finally` (`:219-250`). Readers see the record only once the rename has
  committed it. There is no in-memory grant, so a failed write publishes nothing.
- **Revoke** deletes the file (`rm(…, { force: true })`, `:253-256`). `hasRecord` (`:263-270`) is the revoke
  read-back; when existence cannot be established it answers "present", so an uncertain revoke is never reported as
  done.
- An `on` answer carries `recordFile` and `recordSha256`, the SHA-256 of the exact bytes that were judged
  (`:195-201`); the launch guard (§3.3) binds those bytes.

Why not a key in `workspace-state.json` (the r1 design, superseded): both host storages answer `get` from a snapshot
loaded at construction and rewrite the whole object on every save (`update` at
`libs/backend/platform-cli/src/implementations/cli-state-storage.ts:31-35`;
`libs/backend/platform-electron/src/implementations/electron-state-storage.ts:168`). A revoke by another process
was invisible to a running host, and an unrelated write could restore a revoked key (Lane K closing review finding
1). No other state shares the record file, so no whole-object write elsewhere can recreate it.

Why not the settings file (the r0 draft, withdrawn):

- The generic scope revoke is a no-op for a workspace-only key: `RH/handlers/config-scope-rpc.handlers.ts:112-114`
  treats any one-element `supportedTargets` list as global-only and returns success without clearing, and
  inspection repeats it at `:178`.
- The settings resolver's workspace write falls back to the GLOBAL key when no path is active
  (`libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:196-201`; `readForPath` `:149`,
  `hasOverrideForPath` `:168`).
- The checker lives in workspace-intelligence, which the settings-core consumer guard does not admit
  (`libs/backend/settings-core/src/settings-core.spec.ts:784-821`).

Nothing is added to `PC/file-settings-keys.ts`, `libs/backend/settings-core`,
`libs/shared/src/lib/types/rpc/rpc-auth.types.ts` or the `config:getScopes` / `config:clearScopeOverride` handler.

Supporting evidence (verified):

| Evidence                                                                                                          | Location                                                                                                     | Implication                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `getStorageForWorkspace(root)` returns `undefined` for a root the host did not register                           | `PC/interfaces/workspace-scoped-state-storage.interface.ts:32-40`; probe `:60-68`                            | "host-opened root" and "fail closed"                              |
| Electron and cli-engine register `WorkspaceAwareStateStorage` under `WORKSPACE_STATE_STORAGE` before WI registers | `apps/ptah-electron/src/di/phase-1-infra.ts:127-151`; `libs/backend/cli-engine/src/lib/container.ts:447-459` | the registration check is available at WI registration            |
| Roots are registered by the host's `WorkspaceContextManager` only                                                 | `VC/services/workspace-context-manager.ts:81-107`                                                            | consent exists only for host-opened roots                         |
| CLI `userDataPath` is host-selected: `options.userDataPath ?? ~/.ptah`                                            | `libs/backend/platform-cli/src/registration.ts:45`                                                           | the record lives in the host-selected directory, not a fixed path |
| The CLI waits for its workspace registration before any command runs                                              | `libs/backend/cli-engine/src/lib/container.ts:468-496`                                                       | a CLI GET/SET sees the registered root or fails closed            |
| Root lookup: `path.resolve`, exact key, then win32 case-folded match; never falls back to the active workspace    | `EC/go-vet-consent-store.ts:359-375` (precedent `SP/plugin-loader.service.ts:661-680`)                       | no cross-root leak                                                |

### 1.1 Contract history (explicit)

| Aspect         | r0 draft (withdrawn)                                                    | r1 design (superseded)                                                    | As shipped (Lane K)                                                                                                    |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Store          | `~/.ptah/settings.json`, `workspace.<hash16>.diagnostics.goVet.enabled` | key `ptah.diagnostics.goVet.consent` in the root's `workspace-state.json` | record file `<userData>/go-vet-consent/<hash>.json`; root must be registered                                           |
| Read           | `hasOverrideForPath` + `readForPath`                                    | `GoVetConsentStore.read(root)` via cached storage                         | `read(root, currentGoBinary)`, file re-read every decision                                                             |
| Write / revoke | resolver write / `config:clearScopeOverride`                            | `update(key, value / undefined)`                                          | temp file + rename / file delete, only via `diagnostics:go-vet-consent-set`                                            |
| Failure        | global fallback risk                                                    | denied                                                                    | root unregistered, user-data inside root, file absent/unreadable/malformed, stale, any throw → **denied** (`:204-210`) |

Records written by pre-merge Lane K builds (never released) are not read; the user enables once.

### 1.2 The consent record and its staleness rules (User Decision 25)

Content of the record file:

```ts
{ v: 1,
  rootRealpath: string,                 // fs.realpathSync.native(root) at grant
  rootId: string | null,                // `${dev}:${ino}` of fs.statSync(root, { bigint: true }); null when unusable
  goBinary: { path: string; size: number; mtimeMs: number }, // canonical binary accepted at grant (§4.1)
  grantedAt: string }                   // ISO time, display only
```

`read` answers `off`, `on` (with `record`, `recordFile`, `recordSha256`) or `stale` with a reason:

- `off`: root not registered, user-data directory inside the root, record file absent, unreadable or failing the
  strict parse, or any throw. Fail closed.
- `stale/root-moved`: `realpath(root)` differs from `rootRealpath`.
- `stale/root-replaced`: both `rootId` values are usable and differ (folder deleted and re-created at the same
  path). When the volume gives no usable id, only the path checks apply.
- `stale/go-changed`: the binary §4.1 resolves now differs in canonical path, size or mtime from `goBinary`. Per
  User Decision 25, consent ends when the resolved Go binary changes (a Go upgrade needs a new opt-in).

`stale` is treated like `off` by the checker (nothing spawns; reason `consent-stale`). The record is not
auto-deleted; the UI and CLI show the reason, and re-enabling overwrites it.

**Repository files never grant consent.** No repository file is read for consent. The record lives in the host
user-data directory; when that directory resolves inside the checked root, consent is `off`.

**Threat model.** Consent separates the user's choice from repository content. It does not defend against an agent
the user already allowed to run shell commands or write the user-data directory. Per User Decision 26, **an
attacker who can write into the Go toolchain directory is outside the threat model**: the binary identity check
(path, size, mtime) is not an execution-by-handle or signature guarantee
(`PC/interfaces/process-spawner.interface.ts:26-38`).

## 2. Components and ownership (as shipped)

| Component                     | File                                                                                                                                                                                                    | Responsibility                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GoVetConsentStore`           | `EC/go-vet-consent-store.ts` (+ spec)                                                                                                                                                                   | registration check, record file read/grant/revoke, staleness, `confirmToken` / `recordRootToken` |
| `resolveGoBinary`             | `EC/go-binary-resolver.ts` (+ spec)                                                                                                                                                                     | §4.1                                                                                             |
| `runChecker`                  | `EC/checker-runner.ts` (+ spec)                                                                                                                                                                         | spawn, env, limits, kill; forwards `launchGuard`; maps a guard refusal to `refused`              |
| `GoVetChecker`                | `EC/go-vet-checker.ts` (+ spec, hostile integration spec)                                                                                                                                               | invocation, parsing, consent read, launch guard                                                  |
| Launch guard port + evaluator | `PC/interfaces/process-spawner.interface.ts` (`SpawnLaunchGuard` `:39`, `LAUNCH_GUARD_REFUSED` `:61`, `ProcessSpawnRequest.launchGuard` `:80`); `PC/utils/launch-guard.ts` (`launchGuardRefusal` `:26`) | the facts re-checked at process creation                                                         |
| Off-thread spawner            | `SP/off-thread-process-spawner.ts`, `SP/off-thread-process-spawner-source.ts`                                                                                                                           | evaluates the guard immediately before creating the child (worker and inline)                    |
| Consent RPC                   | `RH/handlers/diagnostics-consent-rpc.handlers.ts` (+ spec)                                                                                                                                              | GET/SET (§3)                                                                                     |
| Electron card                 | `FE/ptah-ai/go-vet-consent-config.component.ts` (+ spec)                                                                                                                                                | §5.1                                                                                             |
| CLI sub-command               | `apps/ptah-cli/src/cli/commands/config.ts`, `apps/ptah-cli/src/cli/router.ts:382` (+ `config.spec.ts`)                                                                                                  | §5.2                                                                                             |

**Dependency direction.** WI depends on platform-core (`libs/backend/workspace-intelligence/package.json:10`) and
imports nothing from settings-core; rpc-handlers already depends on workspace-intelligence
(`libs/backend/rpc-handlers/package.json:17`).

**DI timing.** The spawner (`SDK_TOKENS.SDK_PROCESS_SPAWNER`) is registered by `registerSdkServices`, after the
diagnostics provider, so the checker receives it as a lazy getter; an unresolvable spawner at run time is
`failed/no-spawner`, never "No issues".

## 3. RPC family `diagnosticsConsent` and the launch flow

Registered in `RPC_HANDLER_MANIFEST` with `requires: ['goVetDiagnostics']` (`RH/host-profile/manifest.ts:408`); the
capability is in `RPC_CAPABILITIES` (`RH/host-profile/capabilities.ts:69`) and `ALL_DISABLED`
(`RH/host-profile/host-profile.ts:83`), and is enabled only by the Electron profile
(`apps/ptah-electron/src/rpc-host-profile.ts:44`) and the CLI profile
(`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:38`). VS Code keeps it `false`. Types:
`libs/shared/src/lib/types/rpc.types.ts:3430-3503`. Params are parsed with strict zod schemas.

### 3.1 GET — `diagnostics:go-vet-consent-get` `{}`

```ts
{ supported: boolean;                     // false when the host has no per-workspace state storage
  workspace: { root: string } | null;     // the active, host-registered root, or null
  state: 'off' | 'on' | 'stale';
  staleReason?: 'root-moved' | 'root-replaced' | 'go-changed';
  goBinary?: string;                      // binary the record binds (on) or a grant would record; display
  confirmToken?: string }                 // present whenever workspace is
```

`confirmToken` (`rpc.types.ts:3463`; built at `RH/handlers/diagnostics-consent-rpc.handlers.ts:164`) is
`<rootHash>.<binaryHash>` (`EC/go-vet-consent-store.ts:279-291`): the root part covers `realpath(root)` and
`dev:ino`, the binary part covers the canonical path, size and mtime of the binary a grant would record.
`recordRootToken(record)` (`:294-299`) gives the root part of a stored record. The token is opaque to callers.

Active root = `lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot()` (the expression both hosts use,
`apps/ptah-electron/src/activation/bootstrap.ts:226-229`; `libs/backend/cli-engine/src/lib/container.ts:737-740`),
matched to a registered storage key.

### 3.2 SET — `diagnostics:go-vet-consent-set`

Params `{ enabled: boolean; workspaceRoot: string; confirmToken?: string; source: 'settings-ui' | 'cli' }`;
`confirmToken` is **required when enabling** (`rpc.types.ts:3480`) and ignored on a revoke.

Result `{ success: true; state: 'on' | 'off'; goBinary?: string } | { success: false; error: E }`, where
`E = 'invalid-params' | 'unsupported' | 'no-workspace' | 'workspace-changed' | 'go-changed' | 'no-go-binary' |
'persist-failed'` (`rpc.types.ts:3485-3502`). On a grant, `goBinary` is the binary the **committed** record binds.

Check order (`RH/handlers/diagnostics-consent-rpc.handlers.ts:186-270`); every refusal before the write writes
nothing:

1. Strict parse → `invalid-params`; `enabled:true` without `confirmToken` → `invalid-params` (`:189-192`).
2. Host storage not workspace-scoped → `unsupported` (`:194-196`).
3. No active registered root → `no-workspace` (`:197-198`).
4. **Stale-UI guard:** `workspaceRoot` must equal the active root (resolved; case-folded on win32), else
   `workspace-changed` (`:200-202`). The caller value is compared, never written to.
5. Enabling only: resolve the binary now → none → `no-go-binary`; recompute the token for the active root and that
   binary; a different root part → `workspace-changed`; same root, different binary part → `go-changed`
   (`:204-218`).
6. Write: atomic grant, or revoke (file delete). A throw → `persist-failed`, fixed-text warning, no path (`:220-235`).
7. **Re-check after the write** (enabling only, `targetMovedAfterGrant` `:237-252`, `:277-292`): the binary is
   resolved again and the committed record's root identity is compared with the confirmed root part. If either
   changed, the record is removed and the call refuses (`go-changed` / `workspace-changed`). Success is never
   reported for a target the user did not see. A revoke is never refused for a changed target.
8. Read-back (`readBackMatches` `:300-313`): grant → `read` is `on`; revoke → `!hasRecord && read → off`. Otherwise
   `persist-failed`.
9. Audit line (§6), then success.

### 3.3 Launch: consent and binary re-checked at process creation

The checker (`EC/go-vet-checker.ts`):

1. Resolves the binary, then reads consent against it (`:610`, no caching). `off` / `stale` → `not-run` with
   `no-consent` / `consent-stale` (+ reason); nothing is queued.
2. Builds a **launch guard** (`:646-664`) binding four facts: the consent record's exact bytes (`recordFile` +
   `recordSha256`); the verified binary (canonical path, size, mtime), which is also the only command ever spawned
   (`command: binary.path`, `:667`); the root's real path and `dev:ino` from the record; and the canonical module
   directory used as `cwd`.
3. Passes the guard through `runChecker` (`EC/checker-runner.ts:215-216`) to the spawner
   (`SP/off-thread-process-spawner.ts:735-736` → worker message `:312-313`).

The spawner evaluates the guard **immediately before creating the process**, on the thread that creates it: in the
worker (`SP/off-thread-process-spawner-source.ts:196-236`, called at `:238` before `spawn` at `:251`) and on the
inline fallback (`SP/off-thread-process-spawner.ts:800`). Any fact that no longer holds, or cannot be read, refuses:
no child is created and the error code is `ELAUNCHGUARD` (`LAUNCH_GUARD_REFUSED`,
`PC/interfaces/process-spawner.interface.ts:61`). The port requires every implementation to honour the guard or
refuse the request (`:76-80`); callers that send no guard are unaffected (`PC/utils/launch-guard.ts:29`).

`runChecker` maps `ELAUNCHGUARD` (thrown or emitted) to result `refused` (`EC/checker-runner.ts:111`, `:226`,
`:233`). On `refused` the checker re-reads consent against the binary resolved now and answers `unchecked` /
`not-run` with `no-consent`, `consent-stale` (e.g. `go-changed`) or `launch-refused` (folder or module directory
changed) (`EC/go-vet-checker.ts:677-699`). **A refused launch is never reported clean and credits no file.**

### 3.4 Revoke linearization (User Decision 26)

- **A revoke applies to every launch whose final check happens after the revoke completes.** A completed revoke
  (file deleted and read back) therefore stops a launch that is still queued, and any later run.
- **A launch already past its final check counts as started before the revoke**, like a running child: it is not
  killed and is bounded by the 30 s timeout.
- **Accepted window.** Between the worker's final consent read and process creation there remains a microsecond
  interval (review r3 finding 1 reproduced it with an instrumented barrier). User Decision 26 accepts it; there is no
  interprocess lock or lease.
- **Out of scope:** an attacker who can write into the Go toolchain directory (§1.2 threat model).

## 4. Fixed invocation and environment (37a)

### 4.1 Binary resolution (replaces `which`)

`which` is not used: on win32 it searches `process.cwd()` first and honours the inherited `PATHEXT`
(`node_modules/which/lib/index.js:19-26, :31-33`). `resolveGoBinary` instead:

1. Reads the parent PATH (win32: `Path`/`PATH` case-insensitively), splits on `path.delimiter`, strips one pair of
   surrounding quotes.
2. Keeps only absolute entries; on win32 also drops UNC and device paths. Empty, relative and drive-relative entries
   are dropped.
3. Canonicalises each directory; drops directories that fail, that lie inside the checked root, or inside the host
   user-data directory; de-duplicates.
4. Candidate = `<dir>/go.exe` on win32, `<dir>/go` elsewhere. No other name, no `PATHEXT`, no current directory.
5. The candidate must be a regular file (POSIX: executable). Canonicalise it; reject it when inside the root or, on
   win32, not ending in `.exe`.
6. A rejected candidate does not end the search. No accepted candidate → `not-run/no-go-binary`.

The child's `PATH` is the list of directories kept in step 3. The spawner receives the absolute verified path; for
an absolute `.exe`, cross-spawn resolves only that file and adds no `cmd.exe` wrapper
(`node_modules/which/lib/index.js:25`; `node_modules/cross-spawn/lib/parse.js:9, :27-40`).

### 4.2 Invocation

Argument array, no shell, through the host `IProcessSpawner` (`PC/interfaces/process-spawner.interface.ts:64-80`):

```
<abs go.exe|go> vet -json <pkg> [<pkg> …]
```

- `cwd` = the nearest directory containing `go.mod` above the requested files, inside the root (canonical). No
  `go.mod` → `unchecked/no-go-mod`; nothing runs.
- `<pkg>` = `./<rel dir>` per distinct directory, under `cwd`, not starting with `-`, without `...`; at most 20.
- Scoped calls only; no caller-supplied flags.

### 4.3 Environment (built from scratch, never spread)

| Variable                                                                                                     | Value                           | Why                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------- |
| `PATH`                                                                                                       | the §4.1 kept directories       | —                                                    |
| `HOME`/`USERPROFILE`, `SystemRoot`, `TEMP`, `TMP`, `LOCALAPPDATA` (win32), `XDG_CACHE_HOME` (if set), `LANG` | inherited                       | caches, locale                                       |
| `GOFLAGS`                                                                                                    | `-mod=readonly -buildvcs=false` | the only flags source; `-buildvcs=false` stops `git` |
| `GOENV`                                                                                                      | `off`                           | ignores the user's go env file                       |
| `GOTOOLCHAIN`                                                                                                | `local`                         | bundled toolchain only; no switch or download        |
| `GOPROXY` / `GOSUMDB`                                                                                        | `off` / `off`                   | no network                                           |
| `GONOPROXY`, `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE`, `GOCACHEPROG`                                           | empty                           | no direct VCS, no cache program                      |
| `GOWORK`                                                                                                     | `off`                           | no `go.work`                                         |
| `GO111MODULE`                                                                                                | `on`                            | module mode only                                     |
| `CGO_ENABLED`                                                                                                | `0`                             | no C compiler                                        |
| `GOEXPERIMENT`, `GODEBUG`, `CC`, `CXX`, `CGO_*`, `NODE_*`, `PATHEXT`                                         | absent                          | —                                                    |

**Toolchain behaviour.** Under `GOTOOLCHAIN=local` a newer `toolchain` line is only a suggestion and is ignored; a
newer `go` line is refused and reported as `failed/toolchain-mismatch` ([Go toolchains](https://go.dev/doc/toolchain)).

**Limits.** Timeout 30 s (inside the 45 s budget), then a tree kill; output cap 2 MiB → `failed/too-large`; at most
500 diagnostics parsed.

**Honest failure.** Non-vet non-zero exit, unparseable output, timeout, missing modules, toolchain mismatch, no
`go.mod` or a refused launch → `failed` / `unchecked` with a fixed reason, never "No issues".

**What still executes.** The user's own Go toolchain (the `go` command, compiler front end, `vet` tool). Not run:
`go:generate`, tests, build scripts, custom `-vettool`/`-toolexec`, downloaded toolchains, network, `git`, C
compilers. Opt-in is authorisation, not a sandbox.

## 5. Surfaces per host (as shipped)

### 5.1 Electron — Settings → Tools → "Run `go vet` for this workspace"

- **Files:** `FE/ptah-ai/go-vet-consent-config.component.ts` + spec; `FE/settings.component.ts:32`, `:78`;
  `FE/settings.component.html:193` (inside `@if (isElectron)`).
- **Behaviour.** GET on init and on every `WorkspaceScopeService.scopeKey()` change, discarding responses from an
  older scope. It shows the root, state (+ stale reason), Go binary and the "what this runs" text. When the user
  confirms enabling, the card captures the GET's `confirmToken` (`:446`) and sends it with the displayed root
  (`:474`). After success it shows the **committed** `goBinary`. Every refusal reverts the toggle with a fixed
  message; `workspace-changed` and `go-changed` also trigger a fresh GET. Hidden when `supported:false`.

### 5.2 CLI — `ptah config go-vet <status|on|off>`

- **Files:** `apps/ptah-cli/src/cli/commands/config.ts`, `apps/ptah-cli/src/cli/router.ts:382`,
  `apps/ptah-cli/src/cli/commands/config.spec.ts`.
- **Flow.** `status` → GET → notification `config.goVet`. `on`/`off` → GET, then SET with that GET's root and (for
  `on`) its `confirmToken` (`config.ts:586-588`), `source:'cli'`; the notification reports the committed
  `goBinary`.
- **Exit codes:** success `0`; `supported:false` or any SET refusal (including `go-changed`) `1`; bad sub-command
  `2`; transport failure `5`.

### 5.3 VS Code — not applicable

The capability stays `false`; the family is not served; the card is Electron-only. VS Code diagnostics come from
`vscode.languages.getDiagnostics()` (`libs/backend/platform-vscode/src/implementations/vscode-diagnostics-provider.ts:57`).

### 5.4 "Consent off" answer

Requested `.go` files are `unchecked` with `checks:'syntax-only'` and a fixed line naming Settings → Tools or
`ptah config go-vet on`; a stale consent names its reason. No quoted token follows the word "from" in user-facing
strings (`apps/ptah-electron/scripts/lib/bundle-imports.js:116-128`; `batches.md:1948-1951`).

## 6. Audit log

Fixed-text `info` lines; no paths, raw output or error text; the root is logged as a hash.

- Per run: `[Diagnostics] go vet run` `{ workspaceHash, packages, durationMs, outcome, reason?, goVersion? }`;
  `reason` includes `no-consent`, `consent-stale`, `launch-refused`, `no-go-binary`, `no-go-mod`, `no-spawner`,
  `toolchain-mismatch`, `missing-modules`, `unparseable`.
- Per consent change: `[Diagnostics] go vet consent changed` `{ workspaceHash, enabled, source }`, only after a
  successful re-check and read-back (`RH/handlers/diagnostics-consent-rpc.handlers.ts:262-266`). A failed write,
  a post-write refusal or a read-back mismatch logs a fixed warning instead.

## 7. Specs (shipped regressions that pin this contract)

- **Store** (`EC/go-vet-consent-store.spec.ts`): registration, isolation, malformed record, staleness
  (`root-moved`, `root-replaced`, `go-changed`), user-data inside root; cross-host revoke seen by the other host and
  not undone by an unrelated state write (`:393`); failed grant publishes nothing (`:411`); failed re-grant leaves
  the committed record unchanged and no temp file (`:421`); token parts react independently (`:444`).
- **Handler** (`RH/handlers/diagnostics-consent-rpc.handlers.spec.ts`): persisted grant, readback, isolation,
  revoke, no root, unsupported, invalid params (including enable without token), `persist-failed`, stale root;
  cross-host revoke while a checker is at the spawn stage (`:411`); real filesystem write failure (`:523`); binary
  changed after GET → `go-changed`, folder replaced / junction re-pointed → `workspace-changed`, binary changed
  during the write → `go-changed` with the record removed (`:659`).
- **Checker** (`EC/go-vet-checker.spec.ts:1095`): with a delayed worker applying the platform-core guard — normal
  launch spawns the verified path once; revoke after the launch was queued → no process, `unchecked/no-consent`;
  binary changed after queueing → no process, `unchecked/consent-stale/go-changed`; the guard carries exactly the
  four facts.
- **Spawner** (`SP/off-thread-process-spawner.spec.ts:961`, real `OffThreadProcessSpawner`): a holding guard
  spawns; deleted/rewritten consent or a changed binary → `ELAUNCHGUARD` and no child; the inline fallback throws
  `ELAUNCHGUARD`; the real worker program held before its message loop refuses after a revoke.
- **Surfaces:** `config.spec.ts` (SET carries the GET token; committed binary shown; `go-changed` → exit `1`);
  card spec (token sent; `go-changed` reverts and refetches; committed binary shown).
- **Hostile real-binary fixture** (`EC/go-vet-hostile.integration.spec.ts`): unchanged; skipped with a printed
  reason when no `go` resolves.
- **Not pinned, by decision:** the post-read revoke interval of §3.4 (User Decision 26).

## 8. Batch footprint

As merged in `da21c936c` (Lane K, Batches 37a/37b); see `lane-k-closing-fix-report.md` "Every changed path".

## Revision (review r1)

| #   | Finding                                            | Change                                                                                                                                         | Section        |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Generic revoke is a no-op for a workspace-only key | Generic route and settings store withdrawn; revoke only via the dedicated SET with read-back                                                   | §1, §3         |
| 2   | Consent not bound to the displayed workspace       | GET returns the root; SET requires it and refuses `workspace-changed`; UI refetch on scope change; record binds realpath, `dev:ino` and binary | §1.2, §3, §5.1 |
| 3   | `which` searches cwd / honours PATHEXT             | `resolveGoBinary`; absolute `.exe` through the spawner adapter                                                                                 | §4.1           |
| 4   | Storage contract inconsistent                      | Host-owned registered-root rule; WI-owned store; no settings-core import; lazy spawner                                                         | §1, §2         |
| 5   | Surface file/test handoff incomplete               | Files, specs, result union and exit codes named                                                                                                | §3, §5, §7     |
| 6   | Hostile toolchain expectation wrong                | Suggested `toolchain` ignored vs. newer `go` refused, two fixtures                                                                             | §4.3           |
| 7   | Stale citations                                    | Refreshed                                                                                                                                      | throughout     |

## Revision (as shipped, Lane K)

| Change                          | Was (r1)                                                                  | Now (merged `da21c936c`)                                                                                                                                                                                                                           | Section    |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Consent storage                 | key `ptah.diagnostics.goVet.consent` in the root's `workspace-state.json` | own record file `<userData>/go-vet-consent/<hash>.json`, re-read from disk at every decision; `GO_VET_CONSENT_KEY` replaced by `GO_VET_CONSENT_DIR`                                                                                                | §1, §1.1   |
| Grant / revoke                  | `update(key, value / undefined)`                                          | atomic temp (`wx`) + rename, no in-memory copy; revoke deletes the file; uncertain existence = "present"                                                                                                                                           | §1         |
| GET                             | root, state, `goBinary`                                                   | adds `confirmToken` (root identity + Go binary)                                                                                                                                                                                                    | §3.1       |
| SET                             | `{ enabled, workspaceRoot, source }`                                      | `confirmToken` required when enabling; new refusal `go-changed`; success returns the committed `goBinary`; the handler re-checks after the write and removes the record on a changed target                                                        | §3.2       |
| Launch                          | consent read once before queueing the spawn                               | launch guard re-checks consent bytes, binary identity, root and module directory immediately before process creation; spawns only the verified path; `ELAUNCHGUARD` → `unchecked` (`no-consent` / `consent-stale` / `launch-refused`), never clean | §3.3       |
| Revoke semantics                | "a revoke stops the next run"                                             | User Decision 26: a revoke applies to every launch whose final check follows its completion; the microsecond window after the final check is accepted; no interprocess lock; toolchain-directory attackers out of scope                            | §3.4, §1.2 |
| Staleness policy                | architect's choice                                                        | User Decision 25: consent ends when the binary changes or the folder moves or is replaced                                                                                                                                                          | §1.2       |
| Audit reasons                   | —                                                                         | adds `launch-refused`                                                                                                                                                                                                                              | §6         |
| Specs                           | proposed list                                                             | replaced by the shipped regressions with their locations                                                                                                                                                                                           | §7         |
| Open question on binary binding | open                                                                      | closed by User Decision 25                                                                                                                                                                                                                         | —          |

## Open questions for the user

None. User Decisions 25 and 26 settle the staleness policy and the revoke semantics.

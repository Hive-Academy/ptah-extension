# O2 — `go vet` consent surface (gates Batch 37a) — TASK_2026_559_8ca9

Amendment to `implementation-plan-languages.md` ("Diagnostics", Tier 1; Batches 37a/37b), per User Decision 19
(`context.md:59`): `go vet` only, opt-in, pyright excluded, no build-running checkers. This document only designs;
it does not implement. Batch 37a starts after a reviewer approves it.

Path prefixes: `PC` = `libs/backend/platform-core/src`, `SC` = `libs/backend/settings-core/src`,
`RH` = `libs/backend/rpc-handlers/src/lib`, `WI` = `libs/backend/workspace-intelligence/src`. All sit under
`D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

## 1. Settings plumbing reused (verified)

| Piece                                                                         | Location                                                                                                                                         | Use here                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| File-routed key registry                                                      | `PC/file-settings-keys.ts:154` (`FILE_BASED_SETTINGS_KEYS`)                                                                                      | add `diagnostics.goVet.enabled`                                                                            |
| File-routed defaults                                                          | `PC/file-settings-keys.ts:451` (`FILE_BASED_SETTINGS_DEFAULTS`)                                                                                  | `'diagnostics.goVet.enabled': false`                                                                       |
| `workspace.` prefix routes to the file store                                  | `PC/file-settings-keys.ts:727, :735-741` (`isFileBasedSettingKey`)                                                                               | the per-workspace physical key is file-routed with no further registration                                 |
| Per-workspace override keys `workspace.<sha256(normalised root)[0:16]>.<key>` | `SC/scope/workspace-scope-resolver.ts:16-40`                                                                                                     | consent is a workspace-scoped value                                                                        |
| Read for an explicit root; path-scoped override check                         | `SC/scope/workspace-scope-resolver.ts:156-167` (`readForPath`), `:175-184` (`hasOverrideForPath`)                                                | checker reads consent for the root being checked, not the active one                                       |
| Write with target `'workspace'`                                               | `SC/scope/workspace-scope-resolver.ts:181-213`                                                                                                   | **caveat:** with no active path it writes the GLOBAL key (`:196-199`); the consent RPC must refuse instead |
| Setting definitions                                                           | `SC/schema/definition.ts:30-76` (`SettingDefinition`, `defineSetting`); registry `SC/schema/index.ts:26` (`SETTINGS_SCHEMA`)                     | schema entry                                                                                               |
| Scoped-key allowlist for inspect/clear RPCs                                   | `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:308` (`SCOPED_SETTING_KEYS`); `RH/handlers/config-scope-rpc.handlers.ts:36-58, :60-64`          | `config:getScopes` / `config:clearScopeOverride` can inspect and revoke it                                 |
| Generic write RPC with allowlist                                              | `RH/handlers/settings-rpc.handlers.ts:144-170` (`settings:set` guarded by `isFileBasedSettingKey`)                                               | not used for consent (the renderer would need the hash); dedicated RPC below                               |
| RPC family registration for every host                                        | `RH/host-profile/manifest.ts:99-105` (`RPC_HANDLER_MANIFEST`, `requires: []`); method typing `libs/shared/src/lib/types/rpc.types.ts:847, :3491` | new `diagnosticsConsent` family                                                                            |
| CLI config command: file keys + RPC sub-subcommands                           | `apps/ptah-cli/src/cli/commands/config.ts:1-20` (header), `:39-54` (sub-command union), `:185-213` (`set`)                                       | new `ptah config go-vet <on\|off\|status>` routed through RPC, like `autopilot set`                        |
| Settings page pro-feature component pattern                                   | `libs/frontend/chat/src/lib/settings/pro-features/browser-settings.component.ts:63-100` (RPC get/set in a settings card)                         | Electron toggle                                                                                            |
| Host-owned roots only                                                         | Batch 2f F1 / 9b deviation 3 (`batches.md` Batch 9b "Deviations" 3)                                                                              | consent never applies to a caller-declared root the host did not open                                      |

## 2. The setting

- **Logical key:** `diagnostics.goVet.enabled`.
  - Type: boolean. Default `false`.
  - Scope: **workspace only**.
- **Physical key when granted:** `workspace.<hash16(normalised root)>.diagnostics.goVet.enabled = true` in
  `~/.ptah/settings.json`.
  - The hash and normalisation are the resolver's own (`workspace-scope-resolver.ts:16-40`): `path.resolve`, and a
    lower-case drive letter on win32.
- **Registration (37b files):**
  - `PC/file-settings-keys.ts`: add to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` (`false`).
  - `SC/schema/diagnostics-schema.ts` (new):

    ```ts
    DIAGNOSTICS_GO_VET_ENABLED_DEF = defineSetting({
      key: 'diagnostics.goVet.enabled', scope: 'global', sensitivity: 'plain',
      schema: z.boolean(), default: false, sinceVersion: <current schema version>,
    })
    ```

    It is appended to `SETTINGS_SCHEMA` (`SC/schema/index.ts:26`). `SettingScope` has no "workspace" value; the
    workspace restriction is enforced by the reader and writer below, not the schema.

  - `rpc-auth.types.ts:308` `SCOPED_SETTING_KEYS`: `'diagnostics.goVet.enabled': { appScopable: false,
supportedTargets: ['workspace'] }`. This lets the existing scope RPCs inspect and clear it (revoke).
- **Consent read (checker, fail closed).** Consent is granted only when **both** hold for the **host-opened** root
  the check runs in:
  - `resolver.hasOverrideForPath('diagnostics.goVet.enabled', root) === true`;
  - `resolver.readForPath<boolean>('diagnostics.goVet.enabled', root) === true`.

  The global key is ignored even when it is set, so an edited global value cannot enable every workspace. Consent
  is denied in each of these cases:
  - an unresolvable root;
  - a root the host did not open;
  - the resolver is unregistered;
  - any throw.

  Repository files are never read for consent. The value lives in the user's home, so a cloned repository cannot
  grant it.

- **Threat model (stated honestly).** The consent separates the user's choice from repository content. It does not
  defend against an agent the user already allowed to run shell commands or edit `~/.ptah/settings.json`: such an
  agent could run `go vet` itself. No MCP tool writes settings; `vscode-lm-tools` has no `setConfiguration` caller
  (verified by grep).

## 3. Surfaces per host

| Host         | Enable / revoke                                                                                                                                                                                                                                                                          | Notes                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Electron** | Settings page, new card **Diagnostics → "Run `go vet` for this workspace"**: `libs/frontend/chat/src/lib/settings/pro-features/diagnostics-settings.component.ts` (new, + spec), placed in `settings.component.html`                                                                     | The card shows the current workspace root and a short "what this runs" text (§5), then calls the RPCs below. It is hidden when `supported:false` |
| **CLI**      | `ptah config go-vet on \| off \| status` (new sub-subcommand in `apps/ptah-cli/src/cli/commands/config.ts`, same RPC route as `autopilot set`, `:15`; the router entry lives beside the config route)                                                                                    | Applies to the CLI's workspace root (cwd or `--cwd`). `status` prints `{ supported, workspaceRoot, enabled }`                                    |
| **VS Code**  | **Not applicable.** VS Code diagnostics come from `vscode.languages.getDiagnostics()` (`platform-vscode/.../vscode-diagnostics-provider.ts:57`); the Go extension already runs vet there. The checker is not registered, so the get RPC answers `supported:false` and the card is hidden | No `package.json` contribution (the key is file-routed)                                                                                          |

**RPC family `diagnosticsConsent`** (`RH/handlers/diagnostics-consent-rpc.handlers.ts`, new, + spec). It is
registered in `RPC_HANDLER_MANIFEST` with `requires: []`, and its methods are typed in `rpc.types.ts`.

- `diagnostics:go-vet-consent-get` `{}` → `{ supported, workspaceRoot?, enabled }`.
  - `supported` is true only when the host registered the go-vet checker (an optional DI token, absent on VS Code).
- `diagnostics:go-vet-consent-set` `{ enabled: boolean }`.
  - It writes through `resolver.write(key, true, 'workspace')` only when `resolver.getActivePath()` is defined **and**
    is a host-opened folder. Otherwise it answers `{ success:false, error:'No workspace folder is open' }`, and
    never takes the global fallback at `workspace-scope-resolver.ts:196-199`.
  - `enabled:false` clears the workspace key (`clearOverride`).
  - Params are validated with zod, strict: only `enabled`.
- **Assumptions (check before editing; they are 37b evidence):**
  - `SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER` is registered in Electron and in cli-engine.
  - The CLI's `IActiveWorkspaceSource` returns the CLI workspace root.

  If either fails, the consent RPC answers `supported:false`. That is fail-closed, and it is reported.

## 4. Answer when consent is off (or unsupported)

The `LanguageAwareDiagnosticsProvider` (25a) marks requested `.go` files `unchecked` (coverage) with
`checks:'syntax-only'`. They still get the Tier 0 syntax check. The formatter adds one fixed line:

> Go files were syntax-checked only; `go vet` is off for this workspace. Enable it in Settings → Diagnostics
> (desktop app) or run `ptah config go-vet on` in this workspace.

On VS Code the line is not shown: Go diagnostics come from the editor. The text contains no quoted token directly
after the word "from" (validate-deps rule, `batches.md:1940-1945`).

## 5. Fixed invocation and environment (37a)

**Binary.** `go` resolved with `which` against a **sanitised PATH**:

- absolute entries only; empty, relative and in-workspace entries are dropped;
- the result is canonicalised with `fs.realpathSync.native`;
- it is rejected if it resolves inside the workspace root or is a `.cmd`/`.bat` wrapper;
- on win32 it must be `go.exe`.

**Invocation** (argument array, no shell, through the host `IProcessSpawner`):

```
<abs go> vet -json <pkg> [<pkg> …]
```

- `cwd` = the nearest directory containing `go.mod` above the requested files, inside the root. With no `go.mod`
  (GOPATH mode), the answer is "not checked: no go.mod" and nothing runs.
- `<pkg>` = `./<rel dir>` for each distinct directory of a requested `.go` file, relative to `cwd`.
  - It must stay under `cwd`, must not start with `-`, and must not contain `...`.
  - At most 20 packages; the rest are `omittedByCap`.
- **Scoped calls only.** An unscoped call never runs vet (Go files are `unchecked` with "pass files").
- No caller-supplied flags: the tool schema has no field for them.

**Environment** (built from scratch, never spread):

| Variable                                                                                               | Value                           | Why                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATH`                                                                                                 | sanitised (above)               | —                                                                                                                                                                            |
| `HOME` / `USERPROFILE`, `SystemRoot`, `TEMP`, `TMP`, `LOCALAPPDATA` (win32), `XDG_CACHE_HOME` (if set) | inherited                       | module and build cache location                                                                                                                                              |
| `GOFLAGS`                                                                                              | `-mod=readonly -buildvcs=false` | the only flags source; replaces any user `-toolexec` / `-vettool` / `-overlay`; `-buildvcs=false` stops `git` from being invoked (repo `core.fsmonitor` could run a program) |
| `GOENV`                                                                                                | `off`                           | ignores the user's go env file                                                                                                                                               |
| `GOTOOLCHAIN`                                                                                          | `local`                         | no toolchain download or switch; a newer `go`/`toolchain` line fails and is reported                                                                                         |
| `GOPROXY` / `GOSUMDB`                                                                                  | `off` / `off`                   | no network; missing modules fail and are reported                                                                                                                            |
| `GONOPROXY`, `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE`                                                    | empty                           | no private-module direct VCS path                                                                                                                                            |
| `GOCACHEPROG`                                                                                          | empty                           | no external cache program                                                                                                                                                    |
| `GOWORK`                                                                                               | `off`                           | no `go.work` pulling in outside modules                                                                                                                                      |
| `GO111MODULE`                                                                                          | `on`                            | module mode only                                                                                                                                                             |
| `CGO_ENABLED`                                                                                          | `0`                             | no cgo or C compiler; files that import C are excluded and reported                                                                                                          |
| `GOEXPERIMENT`, `GODEBUG`, `CC`, `CXX`, `CGO_*`, `NODE_*`                                              | absent                          | —                                                                                                                                                                            |

**Limits:**

- timeout 30 s (inside the 45 s diagnostics budget), then a tree kill;
- stdout+stderr cap 2 MiB, then a kill and `failed.too-large`;
- at most 500 diagnostics parsed.

**Honest failure.** A non-zero exit that is not a vet finding, unparseable output, a timeout, missing modules, a
toolchain mismatch or no `go.mod` all give `failed` or `unchecked` for Go with a fixed reason. Such a result never
reads as "No issues". Other languages' results are kept (failure isolation).

**What still executes, inherently (stated for the user and the description).**

- **Runs:** the user's own Go toolchain from their PATH (`go`, the compiler front end, and the `vet` tool in
  `GOROOT/pkg/tool`). It reads the module's source and the user's module cache, and writes the user's build cache.
- **Does not run:**
  - `go:generate` directives, tests or test binaries, build scripts or custom `-vettool`/`-toolexec` programs
    (GOFLAGS fixed);
  - downloaded toolchains (`GOTOOLCHAIN=local`);
  - network fetches (`GOPROXY=off`);
  - `git` (`-buildvcs=false`, no VCS fetch);
  - C compilers (`CGO_ENABLED=0`).
- Opt-in is authorisation, not a sandbox. The guarantee covers only this invocation and environment.

## 6. Audit log

Fixed-text `info` lines. No paths, no raw output, no error text: the root is logged as its 16-hex hash, the same
hash as the settings key.

- Per run: `[Diagnostics] go vet run` with
  `{ workspaceHash, packages, durationMs, outcome: 'ok' | 'findings' | 'timeout' | 'failed' | 'too-large' | 'not-run', reason?, goVersion? }`.
  `reason` comes from a fixed enum: `no-consent`, `no-go-binary`, `no-go-mod`, `toolchain-mismatch`,
  `missing-modules`, `unparseable`.
- Per consent change: `[Diagnostics] go vet consent changed` with
  `{ workspaceHash, enabled, surface: 'settings-ui' | 'cli' }`.

## 7. Specs 37a must include (each fails before its code exists)

**Fake-spawner unit specs** (`go-vet-checker.spec.ts`, `checker-runner.spec.ts`):

1. No consent → nothing spawned; outcome `not-run/no-consent`.
2. A global-only `diagnostics.goVet.enabled = true` → still not run.
3. `getStorage`/resolver throws → not run.
4. A root the host did not open → not run.
5. PATH with `""`, `.`, a relative entry and an in-workspace entry → all dropped. A `go` that resolves (via
   symlink) into the workspace → rejected. A `go.cmd` on win32 → rejected.
6. The inherited env contains `GOFLAGS=-toolexec=evil`, `GOENV=/x`, `GOCACHEPROG=evil`, `GOTOOLCHAIN=auto`,
   `CGO_ENABLED=1`, `NODE_OPTIONS`, `CC`. The spawned env equals the allowlist exactly (asserted as a whole).
7. Package argument validation: a dir outside `cwd`, a leading `-`, `...`, and 21 packages (1 omitted).
8. Delayed spawn then timeout → tree kill called; Go `failed.timeout`; the TS results in the same call are intact.
9. Output over 2 MiB → kill; `failed.too-large`.
10. Non-zero exit with unparseable output → `failed/unparseable`, never "No issues".
11. Cancellation mid-run → the process is killed and no partial Go claim is made.
12. Audit lines are fixed text: no path substring, and the hash equals the settings-key hash.

**Real-binary hostile fixture** (`go-vet-hostile.integration.spec.ts`; skipped with a printed reason when no `go`
is on PATH). Each claim has its own package and its own observable evidence:

- **generate:** `//go:generate` writes a marker file → the marker stays absent after vet.
- **toolchain:** `go.mod` with `toolchain go9.99.0` → reported `toolchain-mismatch`; no new SDK directory
  appears under the module cache `golang.org/toolchain`.
- **network:** a `require` of a non-cached module → reported `missing-modules`; the module cache has no new
  entry.
- **cgo:** a file with an `import "C"` line (built by string concatenation in the spec, per the validate-deps rule)
  → reported not built; no `cgo` output dir.
- **vcs:** a fixture `.git/config` with `core.fsmonitor` pointing at a marker-writing script → the marker stays
  absent.
- **toolexec:** `GOFLAGS=-toolexec=<marker script>` in the parent env → the marker stays absent.

## 8. Files added to the plan by this amendment (37b)

- `PC/file-settings-keys.ts`
- `SC/schema/diagnostics-schema.ts` (new), `SC/schema/index.ts`
- `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`
- `RH/handlers/diagnostics-consent-rpc.handlers.ts` (new) + spec
- `RH/host-profile/manifest.ts`
- `libs/frontend/chat/src/lib/settings/pro-features/diagnostics-settings.component.ts` (new) + spec,
  `libs/frontend/chat/src/lib/settings/settings.component.html`
- `apps/ptah-cli/src/cli/commands/config.ts` (+ spec, + router entry)

That is ~13 files across 6 projects. The team-leader should split 37b into:

- **37b-i:** key, schema and RPC (platform-core, settings-core, shared, rpc-handlers);
- **37b-ii:** Electron card (frontend/chat);
- **37b-iii:** CLI sub-command and host checker wiring (ptah-cli, cli-engine, electron DI).

Each part is independently green.

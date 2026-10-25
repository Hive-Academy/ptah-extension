# Implementation Plan - TASK_2026_719_4f64 (revision 2, Gate 2 round 2)

Worktree root (W): `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. All paths
are relative to W. Revision 1 is kept unchanged in `implementation-plan-rev1.md`. This revision
applies findings 1-7 of `implementation-plan-review.md` (round 1 re-review). D-D and D-K are kept
as the reviewer accepted them. The batch-order caveat is withdrawn.

## Revision 2 changes

| Finding | What changed | Plan lines |
| --- | --- | --- |
| 1 Blocking: registry probe | The probe lists the parent key with `reg.exe query` and reads only exit 0 plus the key lines. A key is absent only when its parent lists without it. Every other result (non-zero exit, access denied, timeout, unclosed child, malformed or over-bound output) refuses with `unsupported-source`. The supported policy-source set is named. Unscanned sources are named as not detected; the runtime checks are named as the only backstop. Behaviour was checked on this machine (Verified vs Assumption). Six fixtures are in `claude-auth-settings-scan.spec.ts`. | 184-269, 735-737 |
| 2 Serious: migration 0060 | Backfill epoch and route revision from a consistent binding. Zero only for unbound ambient rows. Inconsistent rows become `quarantined`: kept, still blocking, never released by a command. `held()` reads the lease's own columns. Fixtures cover a nonzero bound lease, post-migration release/retain and a pre-binding nonzero-epoch release. | 364-447, 732-734 |
| 3 Serious: fallback completion | One owned-child ledger per sign-in. Every terminal transition (success, cancel, deadline, disposal, failure) in both console and fallback modes needs `allClosed()`. Any unproved child retains the reservation. The user's own terminal is unowned. The tests pin that `completeAuth` is never called. | 319-363 |
| 4 Serious: fallback cwd | Both scripts first change to the certified cwd (quoted, aborting on failure). They apply the same allowlist and the same NO_PROXY run-key rule as `buildCertifiedClaudeEnv`, using only names, never values. Tests cover a different workspace with an auth override, inherited selectors, and paths with spaces and quotes. | 270-318 |
| 5 Serious: batch graph | New dependency-valid sequence B1-B22. Implementations come before registration. Early helpers are additive. Each file is in exactly one batch. Each batch lists its projects, the existing specs it affects and its DI guard. Three batches exceed six files because their minimal closure is larger; this is proved per batch and split into ordered work packages. | 627-696, 716-731 |
| 6 Moderate: held note | `accounts-section.component.ts` and its spec are in B21. The note is removed and the copy pinned. The final production-copy audit (B22) covers the drawer fallback, the RPC COPY and every other surface. | 536-549, 686-693 |
| 7 Moderate: regression cases | Table of case → existing or new spec → batch. Public helper exports are assigned to `agent-sdk/src/index.ts` (beside `:453`) and `helpers/index.ts` in B3. D-K is stated exactly. | 153-158, 550-580, 703-715 |

## Inputs and constraints

- Requirements used: `task-description.md` (Gate 1 APPROVED, Requirements 1-8), `decisions.md`
  D1-D7 (D5 authoritative), `research-report.md`, `implementation-plan-review.md` (round 1 re-review),
  `implementation-plan-rev1.md`.
- Corrections applied: D5 (separate console window, never read; read-only fallback; no new surface;
  E2 before named runs). D-D and D-K are kept as accepted. The batch-order caveat is withdrawn.
- Design handoff used: none (D5: no new surface).
- Missing decision-critical input: none. One handoff constraint cannot be met literally (the cap of
  six files per batch for B7, B8 and B12). See Decision D-M and the handoff.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `authorization()` returns `release-held`; `environment()` throws | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:108-115` | Holds removed in B8 |
| Account COPY with `release-held` text | `claude-account-command.ts:6,20,26` | Neutral copy (D-D) in B8 |
| `store.admit` inserts binding and lease together; `commitRunBinding` aliases it | `provider-account.store.ts:124-126,296-331` | Split (B8) |
| `held()` reads `COALESCE(b.auth_epoch, 0)` through a binding join | `provider-account.store.ts:425-433` | Lease gets its own columns (B7, B8) |
| Only `reserveAuth` advances `auth_epoch`, and it is blocked by any lease on the route (`unoccupied(..., true)`) | `provider-account.store.ts:381-383,455-460` | A profile's epoch is constant while a lease on it exists. This supports the backfill rule. |
| Old `admit` writes the binding's epoch from the profile; ambient leases have no binding | `provider-account.store.ts:312-327` | Old leases: ambient means epoch 0; named means a consistent binding exists |
| Lease and binding tables | `persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts:58-84` | Backfill join on `run_id`, `provider`, `profile_id`, `route_fingerprint` |
| Bare `ALTER ... ADD COLUMN` is the migration convention; the runner applies each version once | `migrations/0055_skill_invocation_run_id.ts:16-25` | 0060 uses bare ALTERs |
| 19 specs pin the head migration version at 59; precedent commit `ea27188eb` bumped them with 0059 (22 files) | e.g. `0028_gateway_conversation_workspace_root.spec.ts:84`, `0059_provider_account_session_links.spec.ts:55`, `0044_memory_lifecycle.spec.ts:73-75`, `0046_memory_merge_subject_index.spec.ts:38-40` | The migration batch's closure is 22 files (D-M) |
| Account specs execute explicit migration versions | `provider-account.store.spec.ts:30` (58, 59), `provider-account-actions.service.spec.ts:22` (58), `di/register.spec.ts:170` (58) | Add 60 in B8 |
| Store spec builds the actions service and spies on `authorization`/`environment` | `provider-account.store.spec.ts:322-400`; `provider-account-actions.service.spec.ts:55-58,264-272`; `di/register.spec.ts:184-186` | Command, actions, store and DI change together (B8) |
| The no-SQLite fallback admission returns `release-held`, and two specs pin it | `auth-providers/src/lib/di/register.ts:162-185`; `di/register.spec.ts:116-131`; `rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts:330-347` | Changed in B8 together with both specs |
| The service constructor takes `(store, connection)`; specs construct it directly | `provider-account.service.ts:43-45`; `provider-account.store.spec.ts:87,258,596-652`; `provider-account-actions.service.spec.ts:66` | New constructor edge in B8 |
| Optional injection precedent on the lane manager | `cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:355-360` (`{ isOptional: true }`) | Selection reader without touching 8 manager specs |
| Manager working-directory default | `agent-process-manager.service.ts:440` | Selection is keyed by `spawnEnvironment.workspaceRoot()` |
| No producer of `accountAdmission` today | `cli-adapters/cli-adapter.interface.ts:72`; consumed only at `claude-cli.adapter.ts:275` | Manager produces it (B14) |
| Lane env and options use `applyClaudeAccountRouteEnv`; named final has `settingSources: []` | `cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:22-27,30-53,80,175-178` | Converted in B12 (missed by rev1) |
| Lane refusal default `release-held`; adapter default `release-held` | `claude-sdk-lane-runner.ts:271-275`; `claude-cli.adapter.ts:291` | Real codes (B12) |
| Read-only lane bindings refuse `release-held` | `cli-agent-runtime/src/lib/di/register.ts:134-139`; pinned by `register.agent-process-manager.smoke.spec.ts:304,324-330,368` | Changed in B12 with that smoke spec |
| The executor's default refusal and identity hash | `session-query-executor.service.ts:571,574-579,646-654` | Real codes; one hash function (B13) |
| Named env call sites | `sdk-query-options-builder.ts:899-918,1083-1084,1364-1382,1645-1649`; `sdk-query-runner.service.ts:176,649-666`; `sdk-model-service.ts:525-560,637-641` | Converted in B11 and B13 |
| The runner's `accountRoute` input has no producer | only `sdk-query-runner.service.ts:176,666`; the executor passes `accountRoute` to the options builder (`session-query-executor.service.ts:1145`), not the runner | Delete the field (B11) |
| Route-env spec checks named options through the builder | `claude-account-route-env.spec.ts:316-336` | Converted with the builder (B13) |
| Named model-discovery specs probe without a launch | `sdk-model-service.accounts.spec.ts:132-150`; `plan-limits/session-quota-probe.accounts.spec.ts:285-306` | Converted in B11 (D-K) |
| Root export of the env helper | `libs/backend/agent-sdk/src/index.ts:453`; `helpers/index.ts:264` | New helpers are exported from both files (B3) |
| Spawner request has `needsConsole` only; one implementation | `platform-core/src/interfaces/process-spawner.interface.ts:64-81`; `agent-sdk/.../off-thread-process-spawner.ts:660` | `userConsole` (B4) |
| Spawner details | `off-thread-process-spawner.ts:145,731,811-813`; `off-thread-process-spawner-source.ts:254`; `spawn-worker-pool.ts:104` | Both modes (B4) |
| Source guard: every production spawn sets `windowsHide` | `agent-sdk/src/lib/detector/windows-hide-spawn.guard.spec.ts:2-15` | Must keep passing in B4 |
| RPC handler injects the service class; sign-in/cancel/sign-out are held | `rpc-handlers/.../provider-account-rpc.handlers.ts:116,151-160,213-219,339-346` | B17 |
| Electron smoke resolves the handler with a `Pick<ProviderAccountService,'list'>` mock | `apps/ptah-electron/src/di/container.smoke.spec.ts:307-334` | The new handler dependency and the wiring change in the same batch (B17) |
| Held note in the Accounts section | `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:70-72,251-258,474`; spec `accounts-section.component.spec.ts:28,114,235` | B21 |
| Drawer fallback copy | `account-details-drawer.component.ts:91,353,358` | B20 |
| State service extracts the operation from the write result | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:589-597` | Extract `fallback` the same way (B20) |
| CLI copy "not available yet" | `apps/ptah-cli/src/cli/commands/agent-cli.ts:665-690`; spec `agent-cli.spec.ts:1240-1245` | B19 |
| Spawn-args text | `vscode-lm-tools/.../mcp-core/agent-spawn-args.schema.ts:48-56` | B18 |
| Hosts that register auth-providers | `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts` | DI guards for B8 include all three |
| Project names | each `project.json` `"name"` | `@ptah-extension/<lib>`; apps unprefixed (`ptah-electron`, `ptah-cli`, `ptah-extension-vscode`, `ptah-tui`, `ptah-extension-webview`) |

Rev1 rows not repeated here (session registry binding, metadata store methods, SDK null
registrations, router lines, adapter holds, UI producers) still hold. The reviewer spot-checked
them in round 1 (citations 1-6 ok).

## Architecture decision

- Chosen approach: admission takes a lease, then `ClaudeRouteCertifier` builds a backend-only
  `ClaudeCertifiedLaunchContext` under that lease. Every named child (status, logout, login
  console, SDK bootstrap, SDK final query, lane) is started from that context and checked against
  it at its boundary. Sign-in uses a separate console window that Ptah never reads (D5), or a
  read-only fallback script that starts in the certified cwd. The store keeps lease acquisition
  and binding commit separate. Each lease carries its own epoch.
- Rationale: the lifecycles, gate and settlement already exist (Codebase evidence). Revision 2
  closes the probe ambiguity, the migration epoch loss, fallback settlement, fallback cwd and the
  batch graph.
- Rejected alternatives: an embedded pty terminal (D5). A second admission in the router (two
  leases). SDK-bundled 2.1.278. An inherit-and-strip env. Registry absence from `reg query <key>`
  exit 1: exit 1 also means access denied (checked below). PowerShell `Get-Item` error
  categories: they distinguish the two cases (checked below), but they add a PowerShell start
  per admission and depend on profile and execution-policy state.
- Effect on existing code: ambient branches are byte-identical. `release-held` stays in the shared
  union (D-D). No production path returns it. Its COPY entries get neutral text.

## Component specifications

### 1. Contracts (auth-providers-tokens, shared)

- `provider-account-admission.port.ts`:
  - New closed type `ClaudeCertifiedLaunchContext` (backend-only, never logged, never in RPC):
    `executable: { command; prefixArgs: readonly string[]; sdkExecutablePath; version }`,
    `env: Readonly<Record<string,string>>` (complete certified child env), `envDigest` (SHA-256 of
    sorted `key=value` lines), `cwd`, `settingSources: readonly ('user'|'project'|'local')[]`,
    `policy: { managedFile: 'absent'|'scanned'; registry: 'absent'|'not-applicable' }`,
    `identityReference: string`.
  - `ClaudeAccountNamedResolvedResourceContext` gains `readonly launch?: ClaudeCertifiedLaunchContext`
    (D-K: optional only for type compatibility; see Decisions).
  - `ClaudeAccountAdmissionRequest` gains `readonly workingDirectory?: string`.
  - New `ClaudeAccountSelectionReader { readStoredSelection(workspaceRoot, scope): Promise<{ readonly profileId: string | null }> }`.
- `tokens.ts`: `SDK_PROVIDER_ACCOUNT_SELECTION_READER: Symbol.for('SdkProviderAccountSelectionReader')`.
- `auth-providers-tokens/src/index.ts`: export both new types.
- `rpc-provider-accounts.types.ts`: `ProviderStartAccountSignInResult` (`:196-200`) gains optional
  `fallback?: { readonly platform: 'win32' | 'posix'; readonly script: string }`.
- `rpc-agents.types.ts`: `AgentContinueErrorCode` (`:525`) gains `'account_refused'`.
- `rpc-chat.types.ts` and `chat-rpc.schema.ts`: optional `accountSelection` on start, continue and
  resume. It uses the existing `ProviderAccountSelection` schema, and strict schemas reject bad
  shapes. The service side already accepts it (`chat-session.service.ts:520` uses
  `ChatStartParams & MainSessionAccountSelection`). The RPC schema has no account field today
  (grep).
- `execution/node.ts`: `ChatSessionSummary.accountProfileId?: string` (`:223`).

### 2. Certified launch helpers (agent-sdk, new file; additive)

`libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`. `claude-account-route-env.ts`
is not touched until B13.

- `CLAUDE_CERTIFIED_ENV_KEYS`: the rev1 allowlist (`PATH, PATHEXT, SYSTEMROOT, … NODE_EXTRA_CA_CERTS`,
  unchanged). `isCertifiedClaudeEnvKey(name)` matches it case-insensitively.
- `buildCertifiedClaudeEnv(sourceEnv, canonicalConfigDir)`: returns a frozen object with only the
  allowlisted keys from `sourceEnv`, original casing kept. Then one deterministic run-key rule:
  every copied key whose upper-case name is `NO_PROXY` gets `,127.0.0.1,localhost` appended (empty
  value: set to `127.0.0.1,localhost`). If none was copied, `NO_PROXY=127.0.0.1,localhost` is set.
  Then `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` are set to the canonical
  directory. Nothing else is present.
- Run-policy keys: `CLAUDE_CODE_DISABLE_WORKFLOWS` and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`.
  They carry no auth, and their only allowed value is `'1'`. The SDK final options may add them
  (`sdk-query-options-builder.ts:1366-1378`). They are excluded from `envDigest` and checked by
  value. Every other key in an actual env must be part of the digest.
- `certifiedEnvDigest(env)`: SHA-256 hex of the sorted `key=value` lines, run-policy keys excluded.
- `certifiedNamedEnv(route, launch, runPolicy?)`: throws `ClaudeCertifiedLaunchRefusal`
  (`code: 'identity-unproved' | 'route-changed'`) in three cases: `launch` is absent; the two
  directory values differ from `route.canonicalConfigDir`; the digest of `launch.env` differs
  from `launch.envDigest`. Otherwise it returns a fresh copy of `launch.env` plus the requested
  run-policy keys.
- `assertCertifiedLaunch(launch, actual, mode)`: `final` requires an equal executable path, an
  equal digest, an equal cwd, equal setting sources and run-policy keys from the allowed set.
  `bootstrap` requires an equal executable and digest, `settingSources: []` and
  `cwd = os.tmpdir()`. Rationale: R3.3 and D-H, unchanged from rev1.
- `claude-identity-reference.ts`: `claudeIdentityReference(email, organization)` returns the
  SHA-256 hex of `ptah-quota-owner\0<email>\0<organization>` over trimmed values, or `null` for an
  empty email. This is the formula at `session-query-executor.service.ts:578`.
- Exports (finding 7): `helpers/index.ts` (beside `:264`) and `libs/backend/agent-sdk/src/index.ts`
  (beside the explicit line `:453`) both export `CLAUDE_CERTIFIED_ENV_KEYS`,
  `isCertifiedClaudeEnvKey`, `buildCertifiedClaudeEnv`, `certifiedEnvDigest`, `certifiedNamedEnv`,
  `assertCertifiedLaunch`, `ClaudeCertifiedLaunchRefusal` and `claudeIdentityReference`.
  auth-providers imports them from `@ptah-extension/agent-sdk`, as it already does for
  `ClaudeCliDetector` (`claude-account-command.ts` imports).

### 3. Claude CLI process owner (auth-providers `claude-account-command.ts`, REWRITE in B8)

`ClaudeAccountCommand` keeps its constructor `(detector, spawner)`. It becomes the only owner of
account child processes and implements `ClaudeCliProbe` (declared in the certifier file, B6).

- Deleted: `authorization()`, `environment()`, `execute()`, `certifyClaudeAccountEnvironment`,
  `parseClaudeAccountStatus`, `CLAUDE_ACCOUNT_SELECTOR_KEYS`. Kept: `accountActionResult` and COPY.
  `release-held` text becomes "Named accounts are not available on this host." (D-D).
- `certifyExecutable(signal)`: today's `installation()` (`:146-160`). Refuse WSL and direct
  execution without `cliJsPath`. Run `[...prefix,'--version']` with
  `buildCertifiedClaudeEnv(process.env, os.tmpdir())` and a 10 s limit. Parse
  `^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$`. Refuse below 2.1.301 (`unsupported-store`). Cache by
  path.
- `status(context, signal)`: `['auth','status','--json']` with `context.env` and `context.cwd`.
  Exit 0 and 1 reach the parser. It returns facts plus `terminated`.
- `logout(context, signal)`: `['auth','logout']`, same contract.
- `queryRegistry(path, signal)` (win32): runs `<SYSTEMROOT>\System32\reg.exe` (absolute; SYSTEMROOT
  from the certified env) with argv `['query', path, '/reg:64']`. Limits: 5 s, stdout at most
  64 KiB, stderr not read (the stream is drained and discarded). It returns
  `{ exitCode, stdout, terminated, timedOut, overflow }` to the scan module only. Output is never
  logged or returned further.
- The observe/kill/grace logic (`:162-231`) is kept for every child. Close is the only termination
  proof.

### 4. Status parser and policy scan (auth-providers, new files, B5)

- `claude-account-status.ts`, `parseClaudeAccountStatus(text, exitCode, canonicalDir)`: unchanged
  from rev1 (required keys, accepted metadata, version-tagged consistency for `apiKeySource` and
  `forcedLoginMethod`, exit code agreeing with `loggedIn`, normalized directory comparison). It
  returns `{ loggedIn:false }` or `{ loggedIn:true, identityReference }` using
  `claudeIdentityReference(email, orgName)`. A spec pins equality with the quota resolver formula
  (`auth-providers/src/lib/quota/provider-owner.resolver.ts`, same lib).
- `claude-auth-settings-scan.ts`, `scanClaudeAuthPolicy({ cwd, canonicalDir, platform, readFile, queryRegistry, signal })`.

  Supported policy-source set. These are the only sources this task detects:

  | Platform | Source | Rule |
  | --- | --- | --- |
  | all | `<canonicalDir>/settings.json` (user scope under `CLAUDE_CONFIG_DIR`) | Missing means empty. Present: parsed and scanned. Unreadable or unparsable: refuse. |
  | all | `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json` | same |
  | win32 | `C:\Program Files\ClaudeCode\managed-settings.json` | same; `policy.managedFile` |
  | darwin | `/Library/Application Support/ClaudeCode/managed-settings.json` | same |
  | linux | `/etc/claude-code/managed-settings.json` | same |
  | win32 | registry `HKLM\SOFTWARE\Policies\ClaudeCode`, `HKCU\SOFTWARE\Policies\ClaudeCode` | Registry probe below. Present or undetermined: refuse (values are not parsed). |
  | darwin | `/Library/Managed Preferences/com.anthropic.claudecode.plist` | `lstat` ENOENT means absent. Any other result means present or undetermined: refuse. |

  File scan rule (rev1, unchanged): refuse on `apiKeyHelper`, `awsAuthRefresh`,
  `awsCredentialExport`, `gcpAuthRefresh`, `forceLoginMethod` other than `claudeai`, or an `env`
  object with any key for which `isCertifiedClaudeEnvKey` is false. Limit 256 KiB per file. A
  helper is never run. A file read error other than ENOENT refuses.

  Registry probe (finding 1). Per hive H in (HKLM, HKCU), at most 2 queries:
  1. `queryRegistry('H\SOFTWARE\Policies')`.
  2. Exit 0: classify the output. Blank lines are ignored. A line equal to the queried path is
     ignored (the header shown when the key has values). Lines starting with four spaces are
     value lines: ignored and not kept. Lines starting with `<queried path>\` are subkeys, and
     the rest of the line is the name. Any other line, or `overflow`, is malformed: refuse. A
     subkey `ClaudeCode` (case-insensitive) means present: refuse `unsupported-source`. Otherwise
     the key is positively absent for H.
  3. Non-zero exit: Ptah does not interpret stderr text. It runs `queryRegistry('H\SOFTWARE')`.
     Exit 0 with a well-formed listing that has no `Policies` subkey means positively absent for
     H (the parent exists and lists, the child does not). A listing that does include `Policies`
     means the key exists but could not be read: refuse. Non-zero exit, malformed output or
     timeout: refuse.
  4. `timedOut`, a spawn error or `terminated:false` refuses, and `terminated` flows into lease
     settlement (an unproved child means retain).
  The refusal code is `unsupported-source`. The summary is fixed text that never contains a path
  or output.

  Verified on this machine (Windows 11, English locale, 2026-10-25; read-only commands):
  - `reg query HKLM\SOFTWARE\Policies\ClaudeCode`: exit 1, "unable to find".
  - `reg query HKLM\SECURITY\Policy`: exit 1, "Access is denied." So exit 1 alone cannot tell
    absent from unreadable.
  - `reg query HKLM\SOFTWARE\Policies`: exit 0, subkey lines with the full path.
  - `/reg:64`: accepted, same listing.
  - A key with values prints a blank line, the queried path, then four-space-indented value lines.
  - `reg query … /f ClaudeCode /k /e` with zero matches also exits 1. Rejected for that reason.
  - PowerShell `Test-Path` returns True for the access-denied key, so it is not usable.
    `Get-Item` errors are `PermissionDenied` vs `ObjectNotFound`; rejected for cost, as
    Architecture decision says.

  Assumptions:
  - Key path lines are not localized. Root names are canonical (`HKEY_LOCAL_MACHINE`). The probe
    never reads stderr text. Check: if a localized system prints anything else, step 2 classifies
    it as malformed and refuses (fail closed).
  - `HKCU\SOFTWARE` always exists and is readable by the user. If it does not list, the probe
    refuses.

  Not detected (no runtime refusal from the scan; stated, not claimed):
  - server-managed or remote settings;
  - managed-settings drop-in directories;
  - MDM profiles other than the plist above;
  - project settings in a directory other than `<cwd>/.claude/` (for example a repository root
    above `cwd`; Assumption: Claude Code reads `<cwd>/.claude/`);
  - policy selectors passed by env (`CLAUDE_CODE_MANAGED_SETTINGS_PATH`,
    `CLAUDE_CODE_REMOTE_SETTINGS_PATH`), which are removed by the allowlist.
  The only runtime backstop for these is the certified-context checks. Certification requires a
  status from the certified env and cwd with `loggedIn:true`, `authMethod:'claude.ai'`,
  `apiProvider:'firstParty'`, `apiKeySource` absent or `'none'`, and a matching identity
  reference. Each named run checks init `apiKeySource ∈ {'none','oauth'}`, the version and the
  `accountInfo()` identity before the prompt gate. These catch an override that takes effect.
  They do not catch a dormant policy. E4 records with the user whether such sources exist.
- Fixtures in `claude-auth-settings-scan.spec.ts` (fake `queryRegistry`, no real `reg.exe`):
  absent (Policies lists without `ClaudeCode`), absent-parent (Policies exit 1 and SOFTWARE lists
  without `Policies`), present, access-denied (exit 1 + "ERROR: Access is denied." and the parent
  listing includes `Policies`: refuse), generic failure (exit 2 / spawn error), timeout
  (`timedOut`, `terminated:false`: refuse and unproved), malformed (exit 0 with an unrecognized
  line; overflow). A canary asserts that no fixture output, value line or path reaches the
  result, the logger or the thrown summary.

### 5. Login console and fallback script (platform-core, agent-sdk spawner, auth-providers)

- `ProcessSpawnRequest.userConsole?: true` (platform-core): Windows only. The child gets a new
  visible console (`windowsHide: false`) and three `ignore` stdio slots. The handle's
  `stdin/stdout/stderr` are `null`. On non-win32 the spawner refuses with an `error` event and no
  child. `needsConsole` is unchanged.
- Off-thread spawner: plan field `stdioMode: 'pipe' | 'ignore'` (`off-thread-process-spawner.ts:145`).
  Inline spawn (`:811-813`) and worker spawn (`off-thread-process-spawner-source.ts:254`, message
  `spawn-worker-pool.ts:104`) use `['ignore','ignore','ignore']` for `ignore`. No stream is
  created or forwarded. The launch guard stays mandatory. `windowsHide` stays an explicit key, so
  `windows-hide-spawn.guard.spec.ts` passes.
- `claude-login-console.ts` (auth-providers), class `ClaudeLoginConsole(spawner, platform)`
  (platform injected; specs pass both values):
  - `launch(launch, signal)`: spawns `<SYSTEMROOT>\System32\conhost.exe` with args
    `[command, ...prefixArgs, 'auth','login','--claudeai']`, `env: launch.env`,
    `cwd: launch.cwd`, `userConsole: true`. It returns `{ kind:'started', child }` or
    `{ kind:'unavailable' }`. The handle stays inside the actions service.
  - `fallbackScript(launch, platform)` (finding 4): read-only text. The user runs it in their own
    terminal; the agent never does.
    - win32 (PowerShell), one script block so a failure stops every later step:
      `& { $ErrorActionPreference = 'Stop'; Set-Location -LiteralPath '<cwd>'; $allow = @(<allowlist names as literals>); Get-ChildItem Env: | Where-Object { $allow -notcontains $_.Name.ToUpperInvariant() } | Remove-Item; $env:NO_PROXY = if ($env:NO_PROXY) { "$env:NO_PROXY,127.0.0.1,localhost" } else { '127.0.0.1,localhost' }; $env:CLAUDE_CONFIG_DIR = '<dir>'; $env:CLAUDE_SECURESTORAGE_CONFIG_DIR = '<dir>'; & '<command>' <'prefixArg'…> auth login --claudeai }`.
      Quoting: single-quoted literals with `'` doubled. The drawer copy says to run it in a new
      PowerShell window, because it changes that window's environment.
    - posix, in a subshell so the user's shell is untouched:
      `( cd -- '<cwd>' && exec env -i ${PATH+"PATH=$PATH"} … ${no_proxy+"no_proxy=$no_proxy,127.0.0.1,localhost"} NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1,localhost" CLAUDE_CONFIG_DIR='<dir>' CLAUDE_SECURESTORAGE_CONFIG_DIR='<dir>' '<command>' '<prefixArg>'… auth login --claudeai )`.
      The allowlist names are emitted by reference only (each name and its lower-case variant).
      Single quotes become `'\''`.
    - Run-key normalization is the same rule as `buildCertifiedClaudeEnv` (one shared constant
      and rule; no second list). The script contains only `launch.cwd`, the canonical directory,
      the executable and the prefix arguments. It contains no inherited value.
    - Settings context: `launch.cwd` for auth operations is the canonical directory (Component 6).
      After the change-directory step, the CLI in the user's terminal sees the user scope (via
      `CLAUDE_CONFIG_DIR`), `<canonicalDir>/.claude/*` and the managed sources. That is the scanned
      set. A `.claude/settings.json` in the user's current workspace is not loaded. Completion is
      still decided only by Ptah's own certified status probe (Component 6), so a mismatch cannot
      be accepted.
  - Tests (`claude-login-console.spec.ts`):
    - The first statement changes directory to `launch.cwd` and aborts on failure (PowerShell
      script block with `Stop`; posix `&&` inside a subshell).
    - Start from a different workspace (`os.tmpdir()` fixture) whose `.claude/settings.json` holds
      an `apiKeyHelper`. Assert that the script never names that path and that the scanned cwd
      equals the script cwd.
    - Ptah's `process.env` fixture carries inherited `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`,
      `AWS_PROFILE` and `NO_PROXY=corp`. Assert that no value appears, that every allowlist name
      appears only by reference, and that selectors are never named.
    - Profile and executable paths with spaces, `'`, `$`, backtick and `;` round-trip through a
      reference parser for each dialect.
    - `userConsole` is never set on non-win32, and `unavailable` is returned.

### 6. Account actions (auth-providers `provider-account-actions.service.ts`, B8)

Constructor: `(store, commands, certifier, loginConsole)`. All are class tokens registered in B8.

- Auth-operation context: certifier steps 1-3 with `cwd = canonicalDir`. The CLI loads its own
  default sources; the scan covers them for that cwd (Component 4).
- `startSignIn`: `reserveAuth` (runs make it `busy`), auth context, then `loginConsole.launch`.
  It returns at once: `ok` + `pending`, or `ok` + `fallback` (script) when the console is
  `unavailable`. One `PendingSignIn` per profile holds the operation id, epoch, controller,
  deadline, poll timer and an owned-child ledger.
- Owned-child ledger (finding 3). One entry per Ptah-owned child: the console (console mode only)
  and each status or logout child. The state is `closed` once a `close` event is seen. A spawn
  that resolves `whenSpawned` to `null` with an `error` and no pid counts as closed (no process).
  Listeners stay until disposal, so a late `close` still marks its entry closed. `allClosed()` is
  true only when every entry is closed. The user's own terminal in fallback mode is not an entry.
  Ptah does not own it and never kills it; the copy tells the user to close it.
- Poll: a status child is started 2 s after the previous one closed, or after it was declared
  unproved (no close within its 10 s limit plus the 2 s kill grace). At most 3 unproved entries
  exist; at that point polling stops and only the deadline can end the operation.
- Common completion gate, used by every terminal transition in both modes (success, cancel,
  deadline 300 s, disposal, failure):
  1. Stop polling. Kill each unclosed owned child (`killProcessTree`) and wait up to 2 s.
  2. `ledger.allClosed()` true: `completeAuth(result, identityRef?)` (`signed-in` with the
     certified identity reference, `cancelled`, `timeout`, or the failure code). Fire
     `onStateChanged`.
  3. False: `completeAuth` is not called. The reservation stays (profile `pending`, every new
     auth op `busy`), and the result reports `busy`. `onStateChanged` fires with the snapshot.
     Manual recovery as in Component 7.
  A late success never overwrites `cancelled` or `timeout`.
- `readStatus` on a profile with an owned `PendingSignIn` runs one poll tick inside the existing
  reservation. A pending profile without an owner in this process is `busy` (today's rule).
- Sign-out: auth context, `logout`, then `status`. `signed-out` only when `loggedIn:false`, and
  `identity_ref` is cleared. Same ledger and gate.
- `onStateChanged(listener)` returns an unsubscribe.
- Tests in `provider-account-actions.service.spec.ts`. `jest.spyOn` is used on the store instance
  (not a module):
  - fallback mode: an unproved status child, then a success status: no `completeAuth`,
    `pending`, `busy`;
  - fallback mode: an unproved child, then cancel; then deadline; then disposal: no
    `completeAuth` in any of the three;
  - fallback mode with all children closed: success, cancel and deadline complete;
  - console mode: an unclosed console blocks completion, and a late close then allows it;
  - `fallback.script` in the result is the generated script for `launch`;
  - no accessor exposes the console handle.

### 7. Store, migration and admission (persistence-sqlite B7, auth-providers B8)

- Migration `0060_provider_account_lease_epoch` (B7), bare ALTERs as in `0055:16-25`, static SQL:
  - `ALTER TABLE provider_account_run_leases ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0);`
  - `ALTER TABLE provider_account_run_leases ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 0 CHECK (route_revision >= 0);`
  - `ALTER TABLE provider_account_run_leases ADD COLUMN lease_state TEXT NOT NULL DEFAULT 'live' CHECK (lease_state IN ('live','quarantined'));`
  - `ALTER TABLE provider_account_profiles ADD COLUMN identity_ref TEXT;`
  - Backfill from a consistent binding: `UPDATE provider_account_run_leases SET auth_epoch = (SELECT b.auth_epoch …), route_revision = (SELECT b.route_revision …) WHERE EXISTS (SELECT 1 FROM provider_account_run_bindings b WHERE b.run_id = provider_account_run_leases.run_id AND b.provider = provider_account_run_leases.provider AND b.profile_id = provider_account_run_leases.profile_id AND b.route_fingerprint = provider_account_run_leases.route_fingerprint);`
    Both subqueries use the same four-column predicate.
  - Quarantine inconsistent rows: `UPDATE … SET lease_state = 'quarantined' WHERE (profile_id IS NOT NULL AND NOT EXISTS (<consistent binding>)) OR (profile_id IS NULL AND EXISTS (SELECT 1 FROM provider_account_run_bindings b WHERE b.run_id = provider_account_run_leases.run_id));`
  - Result: an unbound ambient row (profile NULL, no binding) keeps 0/0 `live`, as old `admit`
    wrote it (`provider-account.store.ts:321-327`). A named row with a consistent binding gets
    the binding's epoch and revision, `live`. A named row without a consistent binding cannot
    come from the old atomic `admit`; it is `quarantined`, as is an ambient row with a binding.
    No row is deleted or cleared.
  - Why the binding is the right source: the old reservation's epoch was the profile epoch
    (`:327`), and the binding stores the same value (`:312-315`). That epoch cannot change while
    the lease exists (`:381-383,455-460`).
  - `identity_ref` stays NULL. Ptah cannot derive it from the DB. A `signed-in` profile with NULL
    refuses admission `identity-unproved` until a status check records it. Named sign-in was
    held before this task, so this is not expected in practice.
- Store API (B8; replaces `admit` and the `commitRunBinding` alias):
  - `acquireRunLease({ profileId, expectedRevision, route, runId, reservationId, operationId, selection?, existingBinding? })`:
    one immediate transaction, selection CAS, `routeProfile`, named profile `signed-in` with
    non-null `identity_ref`, and `unoccupied(fp,false)`. On resume (a binding row exists for
    `runId`) the binding must match the profile, fingerprint and route revision, and its epoch
    must be at most the profile epoch. It inserts the lease with the profile's `auth_epoch` and
    `route_revision`, `live`. It returns the reservation (epoch from the lease) and the existing
    binding or null. It never inserts a binding.
  - `commitRunBinding({ reservationId, operationId, authEpoch, runId, identity })`: the lease must
    exist, be `live` and match the owner, run and epoch. The profile epoch must still equal it,
    `identity.kind` must be `known`, and no binding may exist for `runId`. It inserts the binding
    from the lease columns and never inserts a lease.
  - `held()`: `SELECT l.auth_epoch, l.lease_state FROM provider_account_run_leases l WHERE l.lease_id = ? AND l.owner_id = ?`.
    It requires `live` and an equal epoch, else `conflict`. `release` deletes only after `held()`.
    `retain` only checks. A quarantined row is never released or retained by a command. It
    still blocks auth operations (`unoccupied` counts every lease) and counts in
    `activeRunCount`.
  - `identityRef(profileId)`. `completeStatus`/`completeAuth` gain `identityRef?: string | null`.
- `ProviderAccountService` (B8): constructor `(store, connection, certifier)`.
  `admitClaudeRoute`:
  1. Validate the request, including `workingDirectory`. Refuse `omitted`/`ambient`.
  2. Resolve the route and `acquireRunLease`.
  3. Certify with `cwd = workingDirectory ?? canonicalPath` and
     `settingSources ['user','project','local']`.
  4. A refusal with every probe child proved closed: `release(startup-failure)`. Any unproved
     child: `retain`.
  5. Success returns `{ code:'ok', resources:{ kind:'named', route, accountDataDir, filesystemIdentity, launch }, reservation }`.
  `commitRunBinding`, `releaseReservation`, `retainUnresolvedReservation` and `readStoredSelection`
  delegate to the store. A storage error returns `unavailable-storage`.
- `register.ts` (B8):
  - The no-SQLite admission refuses `unavailable-storage` (today `release-held`, `:162-174`).
  - Register `ClaudeRouteCertifier` (factory with `ClaudeAccountCommand`, `process.platform` and a
    `node:fs/promises` reader) and `ClaudeLoginConsole` (factory with `SDK_PROCESS_SPAWNER` and
    `process.platform`).
  - Register `SDK_PROVIDER_ACCOUNT_SELECTION_READER` (the service when SQLite is registered,
    otherwise a reader that returns `{ profileId: null }`), using the existing
    `isRegistered(SQLITE_CONNECTION)` pattern (`:176-185`).
  - The persistence adapter is not registered here (Component 8).
- Manual recovery for a retained or quarantined row: quit Ptah, confirm that no `claude` or
  `conhost` process uses that directory, then a support step deletes the row by id. There is no
  automatic reclaim.
- Tests:
  - `0060_provider_account_lease_epoch.spec.ts` (B7, real `node:sqlite` as in
    `0059…spec.ts:20-27`), after 0058 and 0059, with legacy rows:
    - (a) ambient unbound: 0/0, live;
    - (b) named lease with binding epoch 4 and revision 2: 4/2, live;
    - (c) named lease without binding: quarantined;
    - (d) a binding whose fingerprint or profile differs: quarantined;
    - (e) ambient lease with a binding: quarantined.
    It also checks the row count before equals after, registration after 59, and head version 60.
  - `provider-account.store.spec.ts` (B8):
    - post-migration on legacy row (b): `release` with epoch 4 deletes it; `retain` with epoch 4
      keeps it; `release` with epoch 0 is `conflict` and keeps it; release or retain of
      (c)/(d)/(e) is `conflict` and keeps the row; auth ops on (c)'s route are `busy`;
    - pre-binding nonzero epoch: three sign-in/out cycles take the profile to epoch 3, then
      `acquireRunLease` and `release(startup-failure, 3)` delete the row. A test against the old
      COALESCE semantics would fail here; this pins the bug;
    - pre-commit settlement: the lease at epoch 3, certification fails with closed children:
      released; with an unproved child: retained;
    - resume: a lease with an existing binding returns it and inserts no binding;
      `commitRunBinding` on that run is `conflict`; no second lease for the run (`run_id` UNIQUE);
    - chat and lane leases on two routes coexist.

### 8. Named persistence adapter and Electron wiring (auth-providers B9, Electron B17)

- `claude-named-account-persistence.ts` (B9): as in rev1. It implements `NamedAccountPersistencePort`
  and, structurally, the `ClaudeLaneAccountPersistence` members, with no cli-agent-runtime
  import. Delegates: the registry to `ProviderAccountService`; `saveAccountBound` and
  `resolveAccountBinding` to `SDK_TOKENS.SDK_SESSION_METADATA_STORE`; `assertRouteCurrent` to
  route revalidation plus the epoch; `onAuthEpochChanged` to `actions.onStateChanged`. It is
  exported from `auth-providers/src/index.ts` (B9). The `register.spec.ts` private-export list
  (`:155-160`) does not include it.
- Electron `phase-2-libraries.ts` (B17), after the SQLite block and only when
  `SQLITE_CONNECTION` is registered: `registerSingleton(ClaudeNamedAccountPersistence)`. Then bind
  `SDK_NAMED_ACCOUNT_PERSISTENCE`, `SDK_SESSION_IMPORT_BINDING_LOOKUP` and
  `CLAUDE_LANE_ACCOUNT_PERSISTENCE` (`satisfies ClaudeLaneAccountPersistence`) to it.
  `container.smoke.spec.ts` asserts that `SdkQueryRunner.accountPersistence` is non-null, that the
  three tokens and the selection reader resolve non-null, and that the handler resolves with the
  actions token. `expected-resolvable.ts` is unchanged (handler classes only). VS Code, CLI and
  TUI keep the null persistence, the `unavailable-storage` admission and the null reader.

### 9. Main chat named run (agent-sdk B11/B13/B15, rpc-handlers B15)

- Precedence table, router and chat-session changes: as in rev1 Component 9 (router gate
  `chat-slash-command-router.service.ts:89-155`; the selection is forwarded at
  `chat-session.service.ts:595,687,781,965,1125`).
- Executor `NamedAccountQueryAdmission` (B13):
  - Refuse `identity-unproved` before the bootstrap query when `resources.launch` is absent. The
    query factory is not called.
  - Bootstrap options: `buildNamedAccountBootstrapOptions(route, abort, launch)` uses
    `certifiedNamedEnv` and `assertCertifiedLaunch(…, 'bootstrap')`.
  - Final: `assertCertifiedLaunch(…, 'final')`. Init requires
    `claude_code_version === launch.executable.version` and `apiKeySource ∈ {'none','oauth'}`.
    The identity uses `claudeIdentityReference` (replaces `:574-579`).
  - `namedAccountRefusal` default becomes `identity-unproved` (`:571`). Catch blocks keep the
    specific code.
  - The lease is owned to termination (rev1).
- Options builder (B13): `accountLaunch` beside `accountRoute` (`:741`). The named final run uses
  `launch.executable.sdkExecutablePath`, `launch.cwd`, `launch.settingSources` and
  `certifiedNamedEnv(route, launch, runPolicy)` (`:1364-1382`). `:1083-1084` uses the same. Model
  discovery passes the launch (`:1649`).
- `claude-account-route-env.ts` (B13): the named branch throws `ClaudeCertifiedLaunchRefusal`.
  Named callers use `certifiedNamedEnv` instead. The ambient early return is unchanged.
- Runner (B11): delete the unused `accountRoute` field (`:176`) and the wrapper (`:649-666`). The
  ambient env literal stays byte-identical.
- Model service (B11): `getSupportedModels(route, signal, launch?)`. Named without `launch`
  returns `[]` and starts no child (D-K exception). With `launch`, the probe uses
  `certifiedNamedEnv`, `launch.cwd` and `launch.executable`.
- `sdk-agent-adapter.ts` (B15): live-resume and slash-command holds replaced as in rev1
  (`:1182-1185`, `:1653`).

### 10. Claude CLI lane named run (cli-agent-runtime B12/B14)

- B12 lane execution:
  - `claude-sdk-lane-options.ts`: `buildClaudeLaneEnv(authEnv, route, launch?)`. Named
    without launch throws (`identity-unproved`). Named uses `certifiedNamedEnv`. The bootstrap
    uses `assertCertifiedLaunch(…,'bootstrap')`. The named final uses `launch.cwd` and
    `launch.settingSources` instead of `[]` (`:175-178`).
  - `claude-sdk-lane-runner.ts`: `claudeLaneRefusal(code)` carries the real code
    (`:271-275`). `ClaudeNamedLaneAdmission` refuses when the launch is absent, checks `final`
    mode, compares the identity with `claudeIdentityReference`, and checks the init version
    before the task text.
  - `claude-cli.adapter.ts`: `refusalCode` starts as the admission's code (`:291`), and the
    launch passes to the options (`:137,162-165`).
  - `di/register.ts`: the read-only bindings return `unavailable-storage` (`:134-139`). The stale
    D7 comment (`:204-206`) is updated.
- B14 precedence: `AgentProcessManager` gains a trailing
  `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER, { isOptional: true }) accountSelections?`
  (precedent `:355-360`). For `cli === 'claude'`:
  - explicit named: admission request;
  - explicit ambient: today's path;
  - omitted: `readStoredSelection(this.spawnEnvironment.workspaceRoot(), 'lane')`. No reader
    means ambient; a reader error refuses `unavailable-storage`.
  It sets `accountAdmission: { provider:'claude', scope:'lane', selection, operationId, runId, workingDirectory }`.
  `AgentContinueErrorCode` (`:148`) gains `account_refused`. Non-Claude CLIs are unchanged.

### 11. Entry points and RPC (rpc-handlers B16/B17, vscode-lm-tools B18, ptah-cli B19)

- B16: `agent-rpc.handlers.ts` maps `instanceof LaneAccountResumeError` to `account_refused` with
  fixed text and forwards named resume selections for `claude`. `session-rpc.handlers.ts` fills
  `accountProfileId` from `metadata.accountBinding?.profileId`.
- B17: `provider-account-rpc.handlers.ts` adds
  `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS)`. Sign-in, cancel and sign-out call
  the actions port, and `releaseHeld` (`:339-346`) is deleted. `getAccountStatus` uses
  `actions.readStatus`. It subscribes to `onStateChanged` and notifies with the snapshot. COPY
  `release-held` (`:116`) gets the neutral text. `fallback` is never logged.
- B18: `agent-spawn-args.schema.ts` allows named for `cli: 'claude'`; new text at `:55`. The
  namespace builder text is updated.
- B19: `agent-cli.ts` copy at `:690` becomes "named accounts are not available in the CLI host;
  …", and the D7 comments (`:146,671`) are updated. The behaviour is unchanged (refused).

### 12. Electron UI (frontend B20-B21)

| # | Change | File | Spec | Batch |
| --- | --- | --- | --- | --- |
| U1 | Reused unchanged | `account-details-drawer.component.ts` | existing | — |
| U2 | Pending copy "Finish sign-in in the Claude window" | drawer | `account-details-drawer.component.spec.ts` | B20 |
| U3 | Fallback block: read-only script, copy button, "Run it in a new terminal window", "Check status"; `HELD_FALLBACK` (`:91`) neutral | drawer; `provider-accounts-state.service.ts` extracts `fallback` like `operationOf` (`:589-597`) | drawer spec; state service spec | B20 |
| U4 | Held note removed: delete `ACCOUNT_HELD_NOTE` (`:70-72`), the `routing-held` paragraph (`:251-258`) and `heldNote` (`:474`) | `accounts-section.component.ts` | `accounts-section.component.spec.ts`: delete the import (`:28`); replace `:235` with an assertion that `routing-held` is absent and that the section text contains none of "release authorization", "awaiting release", "not available in this release"; keep the `:114` HELD fixture as an unreachable code with neutral summary | B21 |
| U5 | Lane "Account: <label>" / "Default" / "Removed account" | `agent-card-header.component.ts`; `agent-monitor.store.ts` | their specs (running and finished) | B10 |
| U6 | Chat session "Account: <label>" / "Default" | `session-list-row.component.ts` | its spec (active and finished) | B21 |

Visual evidence (D5): visual-reviewer, Electron, dark and light, before and after: the drawer
(pending and fallback), the Accounts section routing cells, the lane card and the session row.

## Regression case table (finding 7)

| Case | Spec (C = new) | Batch |
| --- | --- | --- |
| Certified env allowlist; every research selector, `CLAUDE*`/`ANTHROPIC*`/cloud prefixes and `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` removed; casing; NO_PROXY rule; run-policy keys | `agent-sdk/.../helpers/claude-certified-launch.spec.ts` (C) | B3 |
| Context drift: executable, digest, cwd, setting sources, run-policy value (final and bootstrap) | `claude-certified-launch.spec.ts` (C) | B3 |
| Drift refused at the main-chat boundary before invoke | `session-query-executor.accounts.spec.ts` | B13 |
| Drift refused at the lane boundary before task text | `claude-sdk-lane-runner.spec.ts` | B12 |
| Two routes give different `CLAUDE_CONFIG_DIR` and no shared object | `claude-certified-launch.spec.ts` (C); store coexistence in `provider-account.store.spec.ts` | B3; B8 |
| Identity reference formula equals the executor and quota formulas | `claude-identity-reference.spec.ts` (C); `claude-account-status.spec.ts` (C) | B3; B5 |
| Spawner `userConsole` in inline and worker modes: ignore stdio, null streams, `windowsHide:false`; non-win32 refuses; pipe cases unchanged | `off-thread-process-spawner.spec.ts` | B4 |
| Registry: absent, absent-parent, present, access-denied, generic failure, timeout, malformed; no output leak | `claude-auth-settings-scan.spec.ts` (C) | B5 |
| Registry argv (absolute `reg.exe`, `/reg:64`), 5 s kill, output bound, close proof | `provider-account-auth-env.spec.ts` (rewritten as the command spec) | B8 |
| Migration backfill (a)-(e), no row lost, head 60 | `0060_provider_account_lease_epoch.spec.ts` (C) | B7 |
| Post-migration release/retain; pre-binding nonzero-epoch release; quarantine blocks | `provider-account.store.spec.ts` | B8 |
| Pre-commit nonzero-epoch settlement (closed: release; unproved: retain) | `provider-account.store.spec.ts` | B8 |
| Resume without a second binding or lease (store) | `provider-account.store.spec.ts` | B8 |
| Resume without a second binding or lease (chat) | `session-query-executor.accounts.spec.ts`; live resume in `sdk-agent-adapter.spec.ts` | B13; B15 |
| Resume without a second binding or lease (lane) | `claude-cli.adapter.spec.ts` | B12 |
| Cancellation during `commitRunBinding`; late admission after abort settled once | `session-query-executor.accounts.spec.ts`; `claude-sdk-lane-runner.spec.ts` | B13; B12 |
| Main chat omitted / same / conflicting / ambient selection on fresh and bound branches | `chat-slash-command-router.accounts.spec.ts` (C); `chat-session.account-binding.spec.ts` | B15 |
| Live session: omitted or same continues the owner's lease; different or ambient refuses `conflict` | `sdk-agent-adapter.spec.ts` | B15 |
| Lane precedence: explicit, omitted to stored, no reader, reader error | `agent-process-manager.account-binding.spec.ts` | B14 |
| Missing launch refuses before spawn: executor (factory never called), builder (`certifiedNamedEnv` throws), lane (no SDK call) | `session-query-executor.accounts.spec.ts`; `claude-account-route-env.spec.ts`; `claude-sdk-lane-runner.spec.ts` | B13; B13; B12 |
| Missing launch in model discovery: `[]` and no query factory call (D-K) | `sdk-model-service.accounts.spec.ts`; `session-quota-probe.accounts.spec.ts` | B11 |
| Fallback completion: unproved status child then success, cancel, deadline, disposal: `completeAuth` never called | `provider-account-actions.service.spec.ts` | B8 |
| Fallback script: cwd step, different workspace with override, inherited selectors, spaces and quotes | `claude-login-console.spec.ts` (C) | B6 |
| Certifier: order (executable, scan, env, status, revalidate), `terminated` propagation, identity mismatch | `claude-route-certifier.spec.ts` (C) | B6 |
| Copy pins (D-D): command COPY, RPC COPY, drawer, Accounts section, CLI, spawn-args | B8, B17, B20, B21, B19, B18 specs; final grep audit | B22 |
| Ambient pins unchanged | the rev1 list (Ambient-path non-regression) | every batch |

## Integration architecture

- Sign-in: UI → `provider:startAccountSignIn` → handler → actions → `reserveAuth` → certifier
  (executable, scan for canonical cwd, env) → console or fallback → poll → common completion
  gate → `completeAuth` → `onStateChanged` → `notify`.
- Main chat: chat RPC → router precedence → chat session → executor → `admitClaudeRoute` (lease,
  then certify) → bootstrap (bootstrap check) → identity → final (final check) → init version and
  source → `commitRunBinding` → attach → save → gate → termination → release once, or retain.
- Lane: MCP/RPC → validator → manager precedence → adapter `prepareNamed` → admission → lane
  owner checks → task text → close → release once.
- Failure and rollback: every child's `terminated` drives release or retain. There is no ambient
  retry. Quarantined rows block until manual recovery.
- Observability: fixed-text warn lines and binding rows. No secrets, paths or CLI text.

## Ambient-path non-regression (existing pins; expectations must not change)

Rev1 list unchanged: `claude-account-route-env.spec.ts` ambient same-object case; the
`sdk-query-options-builder*.spec.ts` family; the `session-query-executor.accounts.spec.ts` ambient
test; the `off-thread-process-spawner.spec.ts` pipe cases; the `sdk-agent-adapter.spec.ts` ambient
resume and slash cases; the manager, guard and workspace-scope specs; the `claude-cli.adapter.spec.ts`
ambient cases; `chat-rpc.handlers.spec.ts`; `chat-session.account-binding.spec.ts` ambient cases;
`rpc-surface.spec.ts`; `surface-composition.spec.ts`; `rpc-allowlist.spec.ts`. Added:
`sdk-query-runner.service.spec.ts` (ambient env literal) and `windows-hide-spawn.guard.spec.ts`.
A batch that must change an ambient expectation stops and reports.

## Live evidence (D5 order; senior-tester owns `test-report.md`)

Unchanged from rev1: E2 (before named runs), E4 (managed file and registry, yes/no, plus whether
the user has any source in "Not detected"), E5 (Credential Manager mapping procedure), E1 (console
behaviour), E3 (signed-in keys), E6 (runtime references). Requirement 8 steps 1-8 run as written.
A failure or "unresolved" keeps the task open.

## Architecture-level quality requirements

- Functional: Requirements 1-7 by the specs in the regression table; Requirement 8 live.
- Performance: per named admission, one cached version probe, up to 4 registry queries (2
  typical), and one status child. Ambient adds nothing.
- Security: one allowlisted env per route. No secret, email, org, path, URL or CLI text in logs,
  RPC, renderer or DB. The fallback script carries only the cwd, directory and executable. Login
  bytes never reach Ptah. Argument arrays only. `process.env` is never mutated.
- Maintainability: no host branch in host-neutral libs (only a win32 platform branch). The
  dependency direction is kept (agent-sdk does not import auth-providers). No new RPC method.
- Testability: no `process.cwd()`; no `jest.spyOn` on module namespaces; temp dirs from
  `os.tmpdir()`; fake spawners and a fake `queryRegistry`, never a real `claude` or `reg.exe`;
  platform injected.

## Team-leader handoff

- Executors: backend-developer B1-B9, B11-B19 and B22; frontend-developer B10, B20 and B21;
  senior-tester live; visual-reviewer D5 screenshots after B21.
- Complexity: HIGH. Spec coupling forces three large closures (D-M).
- Verification command for each batch: `npm run verify -- -t lint,test,typecheck -p <projects>`.
  Confirm that the header says "for N projects" with the requested N. Nx runs one task at a time
  and Jest uses 2 workers (`nx.json:4`, `jest.preset.js:17`).
- Rules for every executor and lane: no `process.cwd()`; no `jest.spyOn` on module namespaces;
  register every new `@inject` token in the same batch; list the specs that mock a changed member
  before editing; no builds, logins, installs or paid calls; lanes never commit, push or run git.
  Only the coordinating agent commits.
- Dependency rule: no batch references a symbol, file, token or registration that a later batch
  creates. Implementations come before their registration. Every batch passes its own lint,
  typecheck and test before commit. Nothing is deferred.
- Oversize batches (D-M): B7, B8 and B12 are each split into ordered work packages (WP) of at most
  6 files. One executor runs them in sequence. The batch is verified and committed once, because
  no intermediate WP compiles on its own.

| Batch | Files (C create, M modify, R rewrite, D delete) | `-p` projects | Existing specs affected by this transition | DI guard |
| --- | --- | --- | --- | --- |
| B1 | M `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; M `.../auth-providers-tokens/src/lib/tokens.ts`; M `.../auth-providers-tokens/src/index.ts`; M `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`; M `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` | `@ptah-extension/auth-providers-tokens,@ptah-extension/shared` | none (additive optional types; the shared union becomes a superset of the manager union, which assigns safely) | none |
| B2 | M `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`; M `libs/shared/src/lib/types/execution/node.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`; M `.../handlers/chat-rpc.schema.spec.ts` | `@ptah-extension/shared,@ptah-extension/rpc-handlers` | `chat-rpc.handlers.spec.ts` (requests without the field) | none |
| B3 | C `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`; C `.../helpers/claude-certified-launch.spec.ts`; C `.../helpers/claude-identity-reference.ts`; C `.../helpers/claude-identity-reference.spec.ts`; M `.../helpers/index.ts`; M `libs/backend/agent-sdk/src/index.ts` | `@ptah-extension/agent-sdk` | `__contracts__/deleted-exports.contract.spec.ts` (new names only) | none |
| B4 | M `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`; M `.../helpers/off-thread-process-spawner-source.ts`; M `.../helpers/spawn-worker-pool.ts`; M `.../helpers/off-thread-process-spawner.spec.ts` | `@ptah-extension/platform-core,@ptah-extension/agent-sdk` | `spawn-worker-pool.spec.ts`, `off-thread-process-spawner.perf.spec.ts`, `detector/windows-hide-spawn.guard.spec.ts` (unchanged, must pass) | none |
| B5 | C `libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts`; C `.../claude-account-status.spec.ts`; C `.../claude-auth-settings-scan.ts`; C `.../claude-auth-settings-scan.spec.ts` | `@ptah-extension/auth-providers` | none (new modules; imports B3) | none |
| B6 | C `.../accounts/claude-login-console.ts`; C `.../claude-login-console.spec.ts`; C `.../claude-route-certifier.ts` (declares `ClaudeCliProbe`); C `.../claude-route-certifier.spec.ts` | `@ptah-extension/auth-providers` | none (unregistered classes; imports B3, B4, B5) | none |
| B7 (22) | C `libs/backend/persistence-sqlite/src/lib/migrations/0060_provider_account_lease_epoch.ts`; C `.../0060_provider_account_lease_epoch.spec.ts`; M `.../migrations/index.ts`; M head-version pins 59 → 60, one line each (plus the history comment where present) in `0028…, 0030…, 0038…, 0039…, 0040…, 0041…, 0042…, 0043…, 0044…, 0045…, 0046…, 0047…, 0051…, 0052…, 0053…, 0054…, 0055…, 0056…, 0059_provider_account_session_links.spec.ts`. WP-a: the three substantive files; WP-b: the 19 pins | `@ptah-extension/persistence-sqlite` | the 19 pins; `migration-runner.spec.ts:726,756` (uses the last entry, unchanged). Account specs pick explicit versions (58/59), so they are unaffected until B8 | none |
| B8 (10) | WP-a: M `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`; M `.../provider-account.store.spec.ts`; M `.../provider-account.service.ts`; M `libs/backend/auth-providers/src/lib/di/register.ts`; M `.../di/register.spec.ts`; M `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts`. WP-b: R `.../accounts/claude-account-command.ts`; R `.../accounts/provider-account-auth-env.spec.ts` (becomes the command/process-owner spec); M `.../provider-account-actions.service.ts`; M `.../provider-account-actions.service.spec.ts` | `@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` | `store.spec:30,87,258-259,322-400,596-653`; `actions.spec:22,55-58,66,74,115,257,264-272`; `register.spec:116-131,170,184-186`; `activation.spec:330-347`; `auth-env.spec:4-86`. Specs add migration 60 | `register.spec.ts` (edited); host smokes `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts` and cli-engine `container-*.spec.ts` run unchanged |
| B9 | C `.../accounts/claude-named-account-persistence.ts`; C `.../claude-named-account-persistence.spec.ts`; M `libs/backend/auth-providers/src/index.ts` | `@ptah-extension/auth-providers` | `register.spec.ts:155-160` private-export list (unchanged, passes) | none (not registered) |
| B10 | M `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`; M `.../agent-monitor.store.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`; M `.../agent-card-header.component.spec.ts` | `@ptah-extension/chat-streaming,@ptah-extension/chat` | none beyond the edited specs (reads the existing `AgentProcessInfo.accountBinding`, `agent-process.types.ts:524`) | none |
| B11 | M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`; M `.../sdk-model-service.accounts.spec.ts`; M `.../plan-limits/session-quota-probe.accounts.spec.ts`; M `.../sdk-query-runner.service.ts` | `@ptah-extension/agent-sdk` | `sdk-model-service.spec.ts`, `sdk-query-runner.service.spec.ts` (ambient, unchanged) | none |
| B12 (7) | WP-a: M `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; M `.../claude/claude-sdk-lane-runner.ts`; M `.../claude/claude-sdk-lane-runner.spec.ts`; M `.../cli-agents/cli-adapters/claude-cli.adapter.ts`; M `.../cli-adapters/claude-cli.adapter.spec.ts`. WP-b: M `.../di/register.ts`; M `.../di/register.agent-process-manager.smoke.spec.ts` | `@ptah-extension/cli-agent-runtime,ptah-electron,ptah-cli` | `lane-runner.spec:125-180,485,557`; `adapter.spec:230-238,589-891`; `smoke.spec:290-305,324-330,360-370`; `ptah-cli-registry.ts:743` (calls `buildClaudeSdkLaneOptions` ambient; registry specs unchanged); `session-spawner.accounts.spec.ts:57` and `account-binding.spec:191` (pass-through codes, unchanged) | `register.agent-process-manager.smoke.spec.ts` (edited); host smokes run |
| B13 | M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; M `.../helpers/claude-account-route-env.ts`; M `.../helpers/claude-account-route-env.spec.ts`; M `.../session-lifecycle/session-query-executor.service.ts`; M `.../session-lifecycle/session-query-executor.accounts.spec.ts` | `@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime` | `route-env.spec:316-336` (named via the builder); `executor.accounts.spec:77-392` (fixtures gain `launch`; HELD defaults); `sdk-query-options-builder*.spec.ts` (ambient, unchanged); cli-agent-runtime suites (no named caller left after B12) | none |
| B14 | M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`; M `.../cli-agents/agent-process-manager.account-binding.spec.ts` | `@ptah-extension/cli-agent-runtime,ptah-electron` | the 7 other `new AgentProcessManager(` specs (optional trailing param, unchanged) | `register.agent-process-manager.smoke.spec.ts` and the Electron smoke run unchanged |
| B15 | M `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`; M `.../sdk-agent-adapter.spec.ts`; M `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`; C `.../chat-slash-command-router.accounts.spec.ts`; M `.../chat-session.service.ts`; M `.../chat-session.account-binding.spec.ts` | `@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers` | `chat-session.account-binding.spec:81-523` (HELD admission mocks become real outcomes); `chat-rpc.handlers.spec.ts` ambient | none |
| B16 | M `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; M `.../agent-rpc.handlers.spec.ts`; M `.../session-rpc.handlers.ts`; M `.../session-rpc.handlers.spec.ts` | `@ptah-extension/rpc-handlers` | `session-rpc.handlers.spec:2746-2786,3051` (fixture codes, unchanged) | none |
| B17 | M `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`; M `.../provider-account-rpc.handlers.spec.ts`; M `apps/ptah-electron/src/di/phase-2-libraries.ts`; M `apps/ptah-electron/src/di/container.smoke.spec.ts` | `@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode` | `container.smoke.spec:307-334`; `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `rpc-allowlist.spec.ts` (unchanged) | `container.smoke.spec.ts` (edited); VS Code smoke runs |
| B18 | M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`; M `.../agent-spawn-args.schema.spec.ts`; M `.../agent-spawn-accounts.spec.ts`; M `.../namespace-builders/agent-namespace.builder.ts`; M `.../agent-namespace.builder.spec.ts` | `@ptah-extension/vscode-lm-tools` | the three edited specs | none |
| B19 | M `apps/ptah-cli/src/cli/commands/agent-cli.ts`; M `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts` | `ptah-cli` | `agent-cli.spec:1225-1245` | none |
| B20 | M `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`; M `.../provider-accounts-state.service.spec.ts`; M `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`; M `.../account-details-drawer.component.spec.ts` | `@ptah-extension/core,@ptah-extension/chat` | drawer spec HELD cases | none |
| B21 | M `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts`; M `.../accounts-section.component.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts`; M `.../session-list-row.component.spec.ts` | `@ptah-extension/chat` | `accounts-section.spec:28,114,235` | none |
| B22 | none: host check and production-copy audit | `ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` | all host suites | all host smokes |

- Order: B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → B9 → B10 → B11 → B12 → B13 → B14 → B15 → B16 →
  B17 → B18 → B19 → B20 → B21 → B22. Hard edges:
  - B3 needs B1. B5 needs B3. B6 needs B4 and B5. B8 needs B6 and B7. B9 needs B8.
  - B13 needs B11 and B12: after B13 the named branch of `applyClaudeAccountRouteEnv` throws, so
    every named caller must already use `certifiedNamedEnv`.
  - B15 needs B13 (executor checks before the holds go). B16 needs B12 and B14. B17 needs B8 and
    B9. B18 needs B12, B14 and B17. B20 needs B1.
  - B10 and B19-B21 are independent of each other and may run in parallel after their edges.
- Safety order (each path opens only after its checks exist):
  - main chat opens at B15, with persistence active at B17 (until then `unavailable-storage`);
  - Accounts sign-in opens at B17;
  - lanes open at B18;
  - B8 enables certified admission, but no consumer path reaches it before those batches.
- Files affected: the manifest above is complete. Each file appears once. Deleted: none (the
  auth-env spec is rewritten in place).
- B22 production-copy audit, a grep over non-spec sources in `libs/` and `apps/`:
  - must be empty: "release authorization", "awaiting release", "not available in this
    release", "not available yet", "release-held (D7)", and any `'release-held'` producer;
  - allowed: the union member `provider-account.types.ts:52`, the two COPY entries with neutral
    text (`claude-account-command.ts:20`, `provider-account-rpc.handlers.ts:116`), and the
    drawer's neutral `HELD_FALLBACK` for an unreachable code.
  Each surface is also pinned in its owning batch's spec.
- Verification points: Electron smoke resolves the four account tokens and the runner
  persistence as non-null. Ambient pins are unchanged. `rpc-allowlist`, `rpc-surface` and
  `surface-composition` are unchanged.

## Decisions

- D-A to D-J, D-L: unchanged from rev1 (see `implementation-plan-rev1.md` Decisions).
- D-D (kept, accepted): `'release-held'` stays in the union and COPY with neutral text. No
  production path returns it. B21 removes the separate Accounts-section held note. B22 audits
  every surface.
- D-K (kept, accepted, stated exactly):
  - `ClaudeAccountNamedResolvedResourceContext.launch` is optional only so existing fixtures
    compile.
  - Every named execution boundary refuses `identity-unproved` when it is absent. The checks
    run before any child starts or any prompt or task text is handed off: the executor bootstrap
    and final, the lane admission, `certifiedNamedEnv` and the named branch of
    `applyClaudeAccountRouteEnv`. There is no ambient retry.
  - The one exception is named model discovery (`getSupportedModels` without a launch). It
    returns `[]`, starts no child and has no refusal channel. It is fail closed because nothing
    executes.
  - Consumer specs pin both behaviours (regression table).
  - Optional typing keeps compilation only. Positive named fixtures gain a `launch` in their
    batch (B12, B13, B15).
- D-M (new; residual of finding 5): three batches exceed six files because their minimal closure
  under "each file once, each batch green" is larger.
  - B7 (22): adding version 60 breaks 19 head-version pins (one line each), precedent
    `ea27188eb`.
  - B8 (10): deleting `authorization`/`environment` breaks the spies in `store.spec`,
    `actions.spec` and `register.spec`. The store split breaks `service.ts` (it uses `admit`'s
    return type), `store.spec` and `actions.spec:266`. The fallback refusal code is pinned in
    both `register.spec` and the rpc-handlers activation spec.
  - B12 (7): `claudeLaneRefusal` and the lane options are pinned together in `lane-runner.spec`,
    `adapter.spec` and the cli smoke, and the cli smoke also pins the read-only bindings in the
    cli `register.ts`.
  Options:
  - (a) Recommended: one batch, ordered work packages of at most 6 files, one commit.
  - (b) Allow specific spec files in two consecutive batches so each batch stays at most 6. This
    conflicts with "each file exactly once".
  Reversible: it only affects how the work is split.
- D-N (new): legacy inconsistent leases are quarantined, not cleared or guessed. Evidence: the old
  `admit` never writes a named lease without its binding (`provider-account.store.ts:296-331`).
  Reversible by manual recovery.
- D-O (new): registry absence is established positively, by parent enumeration, not by exit code
  or localized text. The source set is closed and named, and the unscanned sources are named.
  Reversible.

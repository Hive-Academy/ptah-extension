# Implementation Plan - TASK_2026_719_4f64 (revision 1, Gate 2 round 1)

Worktree root (W): `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. All paths
are relative to W. This revision applies findings 1-11 of `implementation-plan-review.md`.

## Inputs and constraints

- Requirements used: `task-description.md` (Gate 1 APPROVED, Requirements 1-8), `research-report.md`,
  `decisions.md` D1-D6 (D5 is current for the login window, UI scope and E2), `context.md`,
  `implementation-plan-review.md` (findings 1-11, traceability table, citation spot-checks 1-21).
  Predecessor: `../TASK_2026_712_5d7c/implementation-plan.md` components 1-3 and A1-A3 (lines 80-82),
  `../TASK_2026_712_5d7c/HANDOFF.md` "Open problems", its D22, D28, D37, D39, D41.
- Corrections applied:
  - D5 accepts the console window (plan D-A) and supersedes the D2/D3 terminal choice. U1-U6 add
    no surface, so no designer step and no Gate 1.7. Completion needs visual-reviewer
    before/after screenshots (dark and light) in Electron for the Accounts drawer, the lane card
    and the chat session row. E2 runs with the user at the live session before any named run;
    until E2 passes, named runs refuse at the 15 s deadline.
  - Review citations 19-21: SDK and SQLite registrations are in `phase-2-libraries.ts`; the
    accounts migration is `0058_provider_accounts.ts`; the executor accounts spec is
    `session-query-executor.accounts.spec.ts`.
- Design handoff used: none (D5: no new surface).
- Missing decision-critical input: none. Live unknowns have fail-closed defaults (section "Live
  evidence").

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `authorization()` returns `release-held`; `environment()` throws | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:109,114-116` | Remove both holds |
| Baseline allowlist, selector refusal, empty-settings gate | `claude-account-command.ts:43-77` | Replaced by one certified context (Component 2) |
| Parser expects `configDir` and four keys | `claude-account-command.ts:86-100` | Rewrite (real key `configDirectory`) |
| Observe/kill/grace logic; close is termination proof | `claude-account-command.ts:163-231` | Reuse; propagate `terminated` to settlement |
| Admission refuses `release-held`; release/retain refuse `conflict` | `provider-account.service.ts:68-90` | Real admission |
| `store.admit` inserts binding AND lease in one transaction; `commitRunBinding` is an alias of `admit` | `provider-account.store.ts:124-126,296-331` | Split into acquire-lease and commit-binding (finding 3) |
| `held()` reads `COALESCE(b.auth_epoch, 0)` through a LEFT JOIN to the binding | `provider-account.store.ts:425-433` | Lease needs its own epoch column |
| Lease table columns; `run_id` UNIQUE; profile table `provider_account_profiles` | `libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts:11-24,74-83` | Migration 0060 adds `auth_epoch`, `route_revision` to leases and `identity_ref` to profiles |
| Latest migration 0059 | `migrations/0059_provider_account_session_links.ts` | New file is 0060 |
| `admit` checks only operations, not runs (`unoccupied(db, fp, false)`) | `provider-account.store.ts:313,457-462` | Chat and lane may run on the same route; auth ops are blocked by runs (`includeRuns` true in `reserveAuth`) |
| No-storage fallback port refuses `release-held` | `libs/backend/auth-providers/src/lib/di/register.ts:165-186` | Change to `unavailable-storage` |
| Port types; named route closed, no env bag | `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:40-50,74-79,156-162,170-176` | Launch context goes on the resolved resource context, not on the route |
| Tokens | `libs/backend/auth-providers-tokens/src/lib/tokens.ts:67,72` | One new token |
| `NamedAccountQueryAdmission` (bootstrap, gate, init wait, binding commit, SDK attach, metadata save, release/retain); named owner ends at line 818 | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:559-818` | Main chat lifecycle exists |
| Catch blocks replace codes with the default refusal | `session-query-executor.service.ts:705-708,774-777` | Pass the specific code through |
| Identity hash `ptah-quota-owner\0email\0organization` | `session-query-executor.service.ts:574-579` | One exported function |
| Named env is a denylist on a spread env | `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts:5-76`; callers `sdk-query-options-builder.ts:908,1084,1364`, `sdk-query-runner.service.ts:649`, `sdk-model-service.ts:547` | Named branch returns the certified env only |
| Bootstrap uses `cwd: tmpdir()`, `settingSources: []` | `sdk-query-options-builder.ts:899-918` | Bootstrap is a certified subset (Component 2) |
| Ambient settingSources | `sdk-query-options-builder.ts:1358-1363` | Named final run uses `['user','project','local']`, scanned |
| Live-query hold on resume | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1182-1185` | Finding 2 |
| Unconditional hold on slash command | `sdk-agent-adapter.ts:1653` | Finding 2 |
| Registry binds route per session (`accountBinding` with fingerprint, revision, epoch) | `helpers/session-lifecycle/session-registry.service.ts:428-466` | Live continuation reads it |
| Metadata `saveAccountBound`, `getAccountBound`, `resolveAccountBinding` | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:732-775`; token `SDK_TOKENS.SDK_SESSION_METADATA_STORE` `di/tokens.ts:27` | Persistence adapter delegates here |
| `SDK_NAMED_ACCOUNT_PERSISTENCE` and `SDK_SESSION_IMPORT_BINDING_LOOKUP` registered as `null` | `libs/backend/agent-sdk/src/lib/di/register.ts:218-223`; `session-importer.service.ts:36-40,212-213` | Electron overrides both |
| `SdkQueryRunner` injects persistence at construction | `sdk-query-runner.service.ts:312-314`; registered `di/register.ts:485` | Override must precede first resolution |
| Electron order: auth 205, SDK 218, CLI runtime 297, SQLite 369-383 | `apps/ptah-electron/src/di/phase-2-libraries.ts` | Register overrides after line 383, prove order in smoke spec |
| `EXPECTED_RESOLVABLE` lists handler classes only | `apps/ptah-electron/src/di/expected-resolvable.ts:1-26` | Token checks go in `container.smoke.spec.ts` (precedent `:98-110,307-335`) |
| Spawner request has `needsConsole`, no stdio mode | `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:64-81` | Add `userConsole` |
| Off-thread spawner: `windowsHide: needsConsole !== true` (`:731`), inline stdio pipes (`:811`), worker stdio pipes (`off-thread-process-spawner-source.ts:254`), plan field (`:145`), worker message (`spawn-worker-pool.ts:104`) | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts` | Transport change is in agent-sdk |
| Lane admission `prepareNamed`, owner class | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:270-358`; `claude/claude-sdk-lane-runner.ts:242-300` | Lane lifecycle exists |
| `claudeLaneRefusal` fixed `release-held` | `claude-sdk-lane-runner.ts:270-275` | Carry the real code |
| `AgentContinueErrorCode` / `AgentContinueError` | `cli-agents/agent-process-manager.service.ts:148,270`; shared copy `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:524-534` | Add `account_refused` to both |
| `LaneAccountResumeError` | `cli-agents/lane-resume-gate.ts:154` | D28 `instanceof` |
| `LaneAccountBindingPort` | `cli-adapters/cli-adapter.interface.ts:31-` | Structural lane port |
| cli-agent-runtime depends on auth-providers | `libs/backend/cli-agent-runtime/package.json` (lists `@ptah-extension/auth-providers`) | auth-providers must not import cli-agent-runtime |
| Accounts RPC holds sign-in/cancel/sign-out in the handler; status reads the list only | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:212-220,257-272,339-350` | Handler must call the actions port |
| Push `provider:accountsChanged` with a snapshot | `libs/shared/src/lib/types/messages/message-constants.ts:349`; handler `notify` `:398-415`; `ProviderAccountsChangedNotification` `rpc-provider-accounts.types.ts:120-123` | Reuse for async sign-in |
| Chat session gates then forwards raw `params.accountSelection` | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:595,687,781,965,1125` | Forward the resolved selection |
| `ChatSessionSummary` has no account field; producer `session-rpc.handlers.ts`; consumer `session-list-row.component.ts` | `libs/shared/src/lib/types/execution/node.ts:223-235` | Add `accountProfileId` |
| Lane UI model `MonitoredAgent`; card header | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:393`; `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts` | Add `accountProfileId` |
| Project names | each `project.json` `"name"` | `@ptah-extension/<lib>`; apps unprefixed |

## Architecture decision

- Chosen approach: admission takes the lease first, then a new `ClaudeRouteCertifier` builds a
  backend-only `ClaudeCertifiedLaunchContext` (executable, effective env, cwd, setting sources,
  policy evidence, version, identity reference) under that lease. Every named child (status,
  login, logout, SDK bootstrap, SDK final query, lane) is launched from that context and
  validated against it at its boundary. Login runs in a separate console window that Ptah never
  reads (D5). The store separates lease acquisition from binding commit.
- Rationale: the lifecycles, gate and settlement already exist (Codebase evidence). The gaps were
  context equality (finding 1), live-query holds (2), store settlement (3) and child-termination
  settlement (4).
- Rejected alternatives: embedded node-pty terminal (D5); a second admission in the router
  (two leases contradict F1); SDK-bundled 2.1.278 (unobserved status JSON, path not a repository
  contract); an inherit-and-strip env (cannot prove equality; finding 1).
- Effect on existing code: ambient branches are byte-identical. `release-held` stays in the
  shared union for type stability but no production path returns it (Decision D-D). The identity
  hash moves to one function used by the executor, lane runner and status parser; the quota
  resolver copy (`auth-providers/src/lib/quota/provider-owner.resolver.ts`) stays and a spec pins
  equality.

## Component specifications

### 1. Contracts (auth-providers-tokens, shared)

- `provider-account-admission.port.ts`:
  - New closed type `ClaudeCertifiedLaunchContext` (backend-only, never logged, never in RPC):
    `executable: { command: string; prefixArgs: readonly string[]; sdkExecutablePath: string; version: string }`,
    `env: Readonly<Record<string, string>>` (complete child env), `envDigest: string` (SHA-256 of
    sorted `key=value` lines), `cwd: string`, `settingSources: readonly ('user'|'project'|'local')[]`,
    `policy: { readonly managedFile: 'absent' | 'scanned'; readonly registry: 'absent' | 'not-applicable' }`,
    `identityReference: string`.
  - `ClaudeAccountNamedResolvedResourceContext` gains `readonly launch?: ClaudeCertifiedLaunchContext`.
    It is optional only for type compatibility of existing fixtures; every named consumer refuses
    `identity-unproved` when it is absent. The named route stays closed.
  - `ClaudeAccountAdmissionRequest` gains `readonly workingDirectory?: string`.
  - New `ClaudeAccountSelectionReader { readStoredSelection(workspaceRoot: string, scope: ProviderAccountScope): Promise<{ readonly profileId: string | null }> }`.
- `tokens.ts`: `SDK_PROVIDER_ACCOUNT_SELECTION_READER: Symbol.for('SdkProviderAccountSelectionReader')`.
- `rpc-provider-accounts.types.ts`: start-sign-in result gains optional
  `fallback?: { readonly platform: 'win32' | 'posix'; readonly script: string }` (Component 6).
- `rpc-agents.types.ts`: `AgentContinueErrorCode` gains `'account_refused'`.
- `rpc-chat.types.ts` and `chat-rpc.schema.ts`: optional `accountSelection` on start, continue and
  resume, using the existing `ProviderAccountSelection` schema; strict schemas reject bad shapes.
- `execution/node.ts`: `ChatSessionSummary.accountProfileId?: string`.
- Verification: `chat-rpc.schema.spec.ts` accepts omitted/ambient/named and rejects extra keys and
  bad IDs.

### 2. Certified launch context and env (agent-sdk helpers + auth-providers certifier)

- `claude-account-route-env.ts` (agent-sdk):
  - `buildCertifiedClaudeEnv(sourceEnv, canonicalConfigDir)` returns a new frozen object with only
    these keys copied from `sourceEnv` (matched case-insensitively, original casing kept):
    `PATH, PATHEXT, SYSTEMROOT, SYSTEMDRIVE, WINDIR, COMSPEC, TEMP, TMP, TMPDIR, HOME, USERPROFILE,
    HOMEDRIVE, HOMEPATH, APPDATA, LOCALAPPDATA, PROGRAMDATA, PROGRAMFILES, PROGRAMFILES(X86),
    PROGRAMW6432, COMMONPROGRAMFILES, NUMBER_OF_PROCESSORS, PROCESSOR_ARCHITECTURE, OS, USERNAME,
    USERDOMAIN, COMPUTERNAME, USER, LOGNAME, SHELL, LANG, LANGUAGE, LC_ALL, LC_CTYPE, TERM,
    COLORTERM, TZ, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_RUNTIME_DIR, HTTPS_PROXY,
    HTTP_PROXY, ALL_PROXY, NO_PROXY, SSL_CERT_FILE, SSL_CERT_DIR, NODE_EXTRA_CA_CERTS`.
    It then sets the Ptah run keys `NO_PROXY` (value `127.0.0.1,localhost` appended to any copied
    value, as at `sdk-query-options-builder.ts:1368`) and
    `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` only where `experimentalBetaEnv` sets it for a
    first-party route, and finally `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the
    canonical directory. Every other key is absent, so every research selector, every
    `CLAUDE*`/`ANTHROPIC*`/`AWS_*`/`GOOGLE_*`/`GCLOUD*`/`CLOUDSDK_*`/`AZURE_*`/`CLOUD_*`/`VERTEX*`/`BEDROCK*`
    key and `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` are removed. `ANTHROPIC_DEFAULT_*` tier defaults
    are not set for named runs (models are passed as options).
  - `applyClaudeAccountRouteEnv(baseEnv, route, launch?)`: ambient early return unchanged (`:51`).
    Named: throws a typed refusal when `launch` is absent, when `launch.env` directory values differ
    from `route.canonicalConfigDir`, or when the digest of `launch.env` differs from
    `launch.envDigest`; otherwise returns a copy of `launch.env`. `baseEnv` is ignored for named.
  - `assertCertifiedLaunch(launch, actual: { executable?: string; env: Record<string, string | undefined>; cwd?: string; settingSources?: readonly string[] }, mode: 'final' | 'bootstrap')`:
    `final` requires equal executable path, equal env digest, equal cwd and equal setting
    sources. `bootstrap` requires equal executable and env digest, `settingSources` empty and cwd
    = `os.tmpdir()`. Rationale (R3.3): the bootstrap loads no settings, so it can only remove
    auth sources; the authoritative identity and version checks repeat on the final query under
    the final context before the gate opens.
  - `claude-identity-reference.ts`: `claudeIdentityReference(email, organization)` = trimmed
    values, SHA-256 hex of `ptah-quota-owner\0<email>\0<organization>`; `null` for empty email.
- `claude-route-certifier.ts` (auth-providers), class `ClaudeRouteCertifier`, injected probe
  `CLAUDE_CLI_PROBE = Symbol.for('PtahClaudeCliProbe')` (interface in the same file, implemented by
  `ClaudeAccountCommand`):
  1. `probe.certifyExecutable(signal)` (Component 3).
  2. Policy scan (Component 4) for `cwd` and the canonical directory, before any child that reads
     settings.
  3. Build env with `buildCertifiedClaudeEnv(process.env, canonicalPath)`.
  4. `probe.status(context, signal)` with that env and `cwd`; require signed-in, matching
     directory, `claude.ai`, `firstParty`; identity reference equals the profile's stored
     `identity_ref` (else `identity-mismatch`).
  5. Revalidate the route (`revalidateProviderAccountRoute`, `route-changed`).
  Returns `{ ok: true, launch }` or `{ ok: false, code, terminated }`, where `terminated` is
  false when any probe child's close was not observed.
- Login, status and logout from the Accounts UI use the same certifier steps 1-3 with
  `cwd` = canonical directory and `settingSources` = `['user']`.

### 3. Claude CLI probe and commands (auth-providers `claude-account-command.ts`, REWRITE)

- Delete `authorization()` and its call; delete `certifyClaudeAccountEnvironment` and
  `parseClaudeAccountStatus` (moved to Component 4); keep `CLAUDE_ACCOUNT_SELECTOR_KEYS` only if
  still imported (the builder does not need it; delete if unused).
- `certifyExecutable(signal)`: today's `installation()` (`:147-161`), refuse WSL and
  `useDirectExecution` without `cliJsPath`; run `[...prefix, '--version']` with
  `buildCertifiedClaudeEnv(process.env, os.tmpdir())`, 10 s; parse
  `^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$`; refuse below 2.1.301 or on other text
  (`unsupported-store`). Cache by `installation.path` for the process life.
- `status(context, signal)`: `['auth','status','--json']`, `context.env`, `context.cwd`, the launch
  guard (`:137-138`). Exit 0 and exit 1 both reach the parser. Returns parsed facts plus
  `terminated`.
- `logout(context, signal)`: `['auth','logout']`.
- Login is not run here; see Component 5.
- No stdout/stderr content is logged or returned; stdout bound 16 KiB (today `:206`).

### 4. Status parser and policy scan (auth-providers, new files)

- `claude-account-status.ts`, `parseClaudeAccountStatus(text, exitCode, canonicalDir)`:
  - Required: `loggedIn` boolean, `authMethod` string, `apiProvider` string,
    `configDirectory` string. Accepted metadata (values discarded): `analyticsDisabled`,
    `projectsDirectory`, `email`, `orgId`, `orgName`, `subscriptionType`, `apiKeySource`,
    `forcedLoginMethod`. Any other key refuses.
  - Version-tagged consistency (finding 9; source: research Evidence row "Logged-in JSON adds",
    CLI 2.1.278 strings): `apiKeySource` is added only when an API key is the source, so for a
    signed-in result `apiKeySource` present with any value other than `'none'` refuses as a
    foreign source; `apiKeySource: 'none'` is accepted. For a signed-out result `apiKeySource` is
    accepted and ignored. `forcedLoginMethod` is accepted when it equals `'claudeai'` or is
    absent; any other value refuses (policy forces another method). Positive fixtures cover both
    accepted values.
  - Signed-out: `loggedIn:false`, `authMethod:'none'`, exit 1. Signed-in: `loggedIn:true`,
    `authMethod:'claude.ai'`, non-empty `email`, exit 0. `apiProvider === 'firstParty'`. Exit
    code must agree with `loggedIn`. Directory compare after normalization (`\` → `/`, trailing
    `/` removed, case-insensitive on win32).
  - Returns `{ loggedIn: false }` or `{ loggedIn: true, identityReference }`.
  - Fixtures: `cli 2.1.310 observed` (signed-out), `cli 2.1.278 source-derived` (signed-in).
- `claude-auth-settings-scan.ts`, `scanClaudeAuthPolicy({ cwd, canonicalDir, platform, readFile, queryRegistry })`:
  - Managed file: win32 `C:\Program Files\ClaudeCode\managed-settings.json`, darwin
    `/Library/Application Support/ClaudeCode/managed-settings.json`, linux
    `/etc/claude-code/managed-settings.json`. Absent → `absent`. Present and readable → parsed
    and scanned (`scanned`). Unreadable or unparsable → refuse.
  - Registry (win32): `reg.exe query HKLM\SOFTWARE\Policies\ClaudeCode` and
    `reg.exe query HKCU\SOFTWARE\Policies\ClaudeCode` through `IProcessSpawner`, argument arrays,
    5 s each. Exit 1 → absent. Exit 0 (present) → refuse (registry policy is not parsed). Any
    other exit, error or timeout → refuse. darwin: managed preference
    `/Library/Managed Preferences/com.anthropic.claudecode.plist` present → refuse. linux: none.
  - Files scanned for auth: managed (if present), `<canonicalDir>/settings.json`,
    `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`. Missing = empty.
    Unreadable or unparsable present file → refuse. Refuse on `apiKeyHelper`,
    `awsAuthRefresh`, `awsCredentialExport`, `gcpAuthRefresh`, `forceLoginMethod` other than
    `claudeai`, or an `env` object with any key that `buildCertifiedClaudeEnv` would not keep.
    Bound 256 KiB per file. Never runs a helper.
  - Assumption with fail-closed default: managed paths and registry key come from Claude Code
    docs (https://code.claude.com/docs/en/settings); a policy source outside this list is not
    detected. E4 records whether the user has any. The implementer records the fetch date in the
    file header.

### 5. Login console transport (platform-core port, agent-sdk spawner, auth-providers console)

- `ProcessSpawnRequest.userConsole?: true` (platform-core): Windows only. The child gets a new
  visible console (`windowsHide: false`), all three stdio slots `ignore`; the returned handle has
  `stdin`, `stdout`, `stderr` = `null`. On non-win32 the spawner refuses the request with an
  `error` event (no child). `needsConsole` semantics are unchanged.
- Off-thread spawner: plan gains `stdioMode: 'pipe' | 'ignore'` (`off-thread-process-spawner.ts:145`),
  set from `userConsole`; `windowsHide` false for `userConsole`; inline spawn (`:811`) and worker
  (`off-thread-process-spawner-source.ts:254`, message type `spawn-worker-pool.ts:104`) use
  `['ignore','ignore','ignore']` for `ignore`; no stream is created, forwarded, buffered or
  logged. The launch guard (`:735`) stays mandatory.
- `claude-login-console.ts` (auth-providers): `launch(launch, signal)` spawns
  `%SystemRoot%\System32\conhost.exe` (path from `launch.env.SYSTEMROOT`, absolute check) with
  args `[launch.executable.command, ...launch.executable.prefixArgs, 'auth', 'login', '--claudeai']`,
  `env: launch.env`, `cwd: canonicalDir`, `userConsole: true`, the route launch guard. Returns
  `{ kind: 'started', handle }` or `{ kind: 'unavailable' }` (non-win32, spawn error, `whenSpawned`
  null). Ptah keeps only `whenSpawned`, `close`, `error` and the pid for `killProcessTree`.
  Termination proof: conhost `close`. Rationale: conhost started with a command line exits when
  its client exits; E1 records this. The handle is held only inside the actions service; no
  registry, terminal list, MCP tool or RPC can reach it. There is no agent terminal tool in
  `vscode-lm-tools` or `rpc-handlers` (grep for terminal tools finds none), so R2.2 is pinned by a
  spec that the actions service exposes no accessor and the spawner returns null streams.
- `fallbackScript(launch, platform)`: read-only text for the user's own terminal.
  - win32 (PowerShell): removes every environment variable whose name is not in the
    Component 2 allowlist (`Get-ChildItem Env: | Where-Object { $allow -notcontains $_.Name.ToUpper() } | Remove-Item`),
    sets both directory variables, then `& '<command>' <prefixArgs> auth login --claudeai`.
    Single-quoted literals with `'` doubled.
  - posix: `env -i` with the allowlisted variables named by reference (`HOME="$HOME"` style, no
    values from Ptah), both directory variables as single-quoted literals (`'` → `'\''`), then the
    quoted executable and arguments.
  - The script contains only the canonical directory and the executable path. It contains no
    inherited value. The agent never runs it.

### 6. Account actions (auth-providers `provider-account-actions.service.ts`)

- `startSignIn`: `reserveAuth` (runs make it `busy`, R2.9); certifier steps 1-3 with
  `settingSources ['user']`; launch console. Returns at once: `ok` + state `pending`, or
  `ok` + `fallback` when the console is `unavailable`. One `PendingSignIn` record per profile
  holds the operation id, epoch, controller, console handle (or none), deadline timer and poll
  timer.
- Poll: serialized. The next 2 s timer starts only after the previous status child closed. Close
  evidence of every status child is aggregated; one unproved status child marks the operation
  `unproved`.
- Success (`loggedIn:true`, matching directory, `claude.ai`, `firstParty`): kill the console tree;
  wait for conhost `close` up to the 2 s grace. If console and all status children are proved
  closed: `completeAuth(..., 'signed-in', identityRef)`. If not: do not call `completeAuth`; the
  reservation stays (profile `pending`, result `busy`); the push reports the snapshot. Existing
  rule kept: no `completeAuth` when termination is unproved.
- Fallback mode (no owned child): Ptah owns no process, so success completes on status alone;
  cancel and deadline complete as `cancelled`/`timeout` and the copy tells the user to close
  their terminal window.
- `readStatus` on a profile with a `PendingSignIn` owned by this service: runs one poll tick inside
  the existing reservation (no new reservation) and returns its result; the today rule
  (`busy` for a pending profile without an owner in this process) stays.
- Cancel: abort → kill tree → state `cancelled` only after proved close, else retained
  (`busy`). A late success never overwrites `cancelled`.
- Deadline 300 s: same as cancel with `timeout`.
- Sign-out: certified context (`settingSources ['user']`), `auth logout`, then status; `signed-out`
  only when status says `loggedIn:false`; clears `identity_ref`; unproved child → retained.
- `onStateChanged(listener)` returns an unsubscribe; fired after each completion. Disposal kills
  owned consoles, clears timers and listeners, and retains unproved reservations.

### 7. Store, migration and admission (auth-providers, persistence-sqlite)

- Migration `0060_provider_account_lease_epoch` (forward only):
  `ALTER TABLE provider_account_run_leases ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0)`;
  `ALTER TABLE provider_account_run_leases ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 0 CHECK (route_revision >= 0)`;
  `ALTER TABLE provider_account_profiles ADD COLUMN identity_ref TEXT`.
  Existing lease rows get epoch 0, which equals today's `COALESCE(..., 0)` result.
- Store API (replaces `admit` and the `commitRunBinding` alias):
  - `acquireRunLease({ profileId, expectedRevision, route, runId, reservationId, operationId, selection? })`:
    one immediate transaction; selection CAS (today `:304-309`); `routeProfile` (`:436`); profile
    state `signed-in` and `identity_ref` not null for named; `unoccupied(fp, false)`; when a
    binding row exists for `runId` (resume) it must match profile, fingerprint and route revision
    and have `auth_epoch <= profile.auth_epoch`; insert the lease with the profile's `auth_epoch`
    and `route_revision`. Returns the reservation (epoch from the lease) and the existing binding
    or null. No binding insert.
  - `commitRunBinding({ reservationId, operationId, authEpoch, runId, identity })`: one
    transaction; lease row must exist with matching owner, run id and epoch; profile epoch must
    still equal the lease epoch (`conflict`); `identity.kind` must be `known`; no binding row for
    `runId` (else `conflict`); insert the binding from the lease's profile, fingerprint, route
    revision and epoch. No lease insert.
  - `held()` reads `l.auth_epoch` directly (no join). `release` and `retain` keep their shape.
  - `identityRef(profileId)`; `completeStatus`/`completeAuth` gain `identityRef?: string | null`
    (set on `signed-in`, null on `signed-out`).
- `ProviderAccountService.admitClaudeRoute`: validate (schema plus `workingDirectory`), refuse
  `omitted` and `ambient` (callers resolve precedence; ambient never calls admission), resolve
  the route, `acquireRunLease`, then `certifier.certify(...)` under the lease with
  `cwd = workingDirectory ?? canonicalPath` and `settingSources ['user','project','local']`.
  Refusal with all probe children proved closed → `release(startup-failure)`; with any unproved
  child → `retain`. Success → `{ code:'ok', resources: { kind:'named', route, accountDataDir, filesystemIdentity, launch }, reservation }`.
  Late completion after abort is settled by the caller (existing `session-query-executor.service.ts:679-681`).
- `commitRunBinding(route, reservation, identity)` delegates to the store API.
- `releaseReservation`/`retainUnresolvedReservation` delegate to `store.release`/`store.retain`.
- `readStoredSelection` wraps `store.selection`; storage error → `unavailable-storage`.
- `register.ts`: fallback admission refuses `unavailable-storage`; register
  `ClaudeRouteCertifier`, `CLAUDE_CLI_PROBE` (→ `ClaudeAccountCommand`), `ClaudeLoginConsole`,
  `SDK_PROVIDER_ACCOUNT_SELECTION_READER` (service when SQLite is registered, else a reader that
  returns `{ profileId: null }`), and `ClaudeNamedAccountPersistence` as a class singleton.
- Manual recovery for a retained lease or operation: quit Ptah, confirm no `claude` or `conhost`
  process uses that directory, then a support step deletes the row by id. No automatic reclaim.

### 8. Named persistence adapter and Electron wiring

- `claude-named-account-persistence.ts` (auth-providers): implements `NamedAccountPersistencePort`
  (`session-query-executor.service.ts:559-568`) and, structurally, the extra members of
  `ClaudeLaneAccountPersistence` (`available: true`, `lookupBySdkSession`, `validateResume` from
  `LaneAccountBindingPort`). It imports no cli-agent-runtime type (cycle; Codebase evidence).
  Delegates: registry methods → `ProviderAccountService`; `saveAccountBound`/`resolveAccountBinding`
  → `SDK_TOKENS.SDK_SESSION_METADATA_STORE` (`session-metadata-store.ts:732-775`) with
  `lookupBySdkSession` as the authoritative callback; `assertRouteCurrent` → route revalidation
  and epoch compare; `onAuthEpochChanged` → `ProviderAccountActionsService.onStateChanged`.
  It also serves `SessionImportBindingLookup.lookupBySdkSession`.
- Electron `phase-2-libraries.ts`, after the SQLite block (`:369-383`) and only when
  `SQLITE_CONNECTION` is registered: register `SDK_NAMED_ACCOUNT_PERSISTENCE`,
  `SDK_SESSION_IMPORT_BINDING_LOOKUP` and `CLAUDE_LANE_ACCOUNT_PERSISTENCE` to the
  `ClaudeNamedAccountPersistence` singleton (lane token with `satisfies ClaudeLaneAccountPersistence`
  in the app, which may import both libs). Ordering proof: `container.smoke.spec.ts` resolves
  `SdkQueryRunner` from the fully built container and asserts `accountPersistence` is non-null,
  and resolves the three tokens plus `SDK_PROVIDER_ACCOUNT_SELECTION_READER` as non-null.
  `expected-resolvable.ts` is not changed (it lists handler classes only).
- New constructor edges: `ProviderAccountService` ← `ClaudeRouteCertifier`;
  `ClaudeRouteCertifier` ← `CLAUDE_CLI_PROBE`, `SDK_PROCESS_SPAWNER` (registry query);
  `ProviderAccountActionsService` ← `ClaudeRouteCertifier`, `ClaudeLoginConsole`;
  `ClaudeLoginConsole` ← `SDK_PROCESS_SPAWNER`; `ClaudeNamedAccountPersistence` ←
  `ProviderAccountService`, `ProviderAccountActionsService`, `SDK_TOKENS.SDK_SESSION_METADATA_STORE`;
  `ProviderAccountRpcHandlers` ← `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS`;
  `AgentProcessManager` (via cli-agent-runtime register deps) ← `SDK_PROVIDER_ACCOUNT_SELECTION_READER`.
  VS Code, CLI and TUI register no SQLite, so they keep `null` persistence, the
  `unavailable-storage` admission and the null selection reader.

### 9. Main chat named run (agent-sdk, rpc-handlers)

- Precedence (R4 table), owned by the router gate function (`chat-slash-command-router.service.ts:89-133`):

| Run | Explicit | Stored `main` | Result |
| --- | --- | --- | --- |
| Fresh | named | any | named (explicit) |
| Fresh | ambient | any | ambient; no account call (`:121`) |
| Fresh | omitted | named | named (stored, `:128-131`) |
| Fresh | omitted | none | ambient |
| Bound | omitted or same | any | binding (`:117-119`) |
| Bound | different or ambient | any | refuse `conflict`, conversation kept |
| Any | any, provider not `claudeCli` | any | today's behavior (`:126`) |

- Router: delete the admit/release/`release-held` tail (`:134-155`); return the resolved
  selection. `chat-session.service.ts` passes the returned selection (not the raw param) at
  `:687,781` and the resume/continue paths, with `workspacePath` as working directory.
- `NamedAccountQueryAdmission` (executor):
  - Admission request carries `workingDirectory`. Refuse when `resources.launch` is absent.
  - Bootstrap options use `launch` (executable `sdkExecutablePath`, env via
    `applyClaudeAccountRouteEnv(_, route, launch)`); `assertCertifiedLaunch(..., 'bootstrap')`
    before invoke. Runtime identity must equal `launch.identityReference` (fresh) and the stored
    binding (resume), else `identity-mismatch`; empty email → `identity-unproved`.
  - `launch()`: `assertCertifiedLaunch(..., 'final')` on the final options before invoke; in the
    init loop (`:732-738`) require `claude_code_version === launch.executable.version` and init
    `apiKeySource` in `{'none','oauth'}` (research Evidence row; E2 records the real value;
    unknown value refuses); then the existing commit/attach/save/verify before `gate.commit()`.
  - Catch blocks keep the specific refusal code.
  - Lease: acquired in `bootstrap` before the bootstrap query; owned by this object to
    termination; `dispose()` releases once on proved termination or retains (`:785-818`).
- Options builder: named final options take `launch` from the run input (new optional
  `accountLaunch` beside `accountRoute`, `sdk-query-options-builder.ts:741`), use
  `launch.executable.sdkExecutablePath`, `launch.cwd`, `settingSources: launch.settingSources`, and
  env from `applyClaudeAccountRouteEnv`. Ambient lines unchanged.
- `sdk-query-runner.service.ts:649` and `sdk-model-service.ts:547`: named branch requires a launch
  context; `getAccountModels` without one returns `[]` (fail closed; not on the path).
- `sdk-agent-adapter.ts` (finding 2):
  - `resumeSession` live-query branch (`:1182-1185`): read the live record's `accountBinding`
    (`session-registry.service.ts:428-455`) and the metadata binding. Live named session: omitted
    or same profile → `persistence.assertRouteCurrent(route)` (route and epoch) and
    `claudeIdentityReference` from `existingSession.query.accountInfo()` equal to the binding
    identity, then return the existing stream (the current owner keeps its lease). Different
    named or ambient → refuse `conflict`. Live ambient session with explicit named → refuse
    `conflict`. Live ambient with omitted/ambient → today's path. Persistence absent → refuse
    `unavailable-storage` for named only.
  - `executeSlashCommand` (`:1653`): remove the hold; the router has already resolved the
    selection by binding; pass it to the relaunch so `executeQuery` builds the certified named
    lifecycle (resume with the stored binding).
- No-storage hosts: `SDK_NAMED_ACCOUNT_PERSISTENCE` null → named refuses `unavailable-storage`;
  ambient unchanged (named path built only for a named selection, `:931-943`).

### 10. Claude CLI lane named run (cli-agent-runtime)

- `AgentProcessManager`, `cli === 'claude'` only: precedence with scope `lane`. Explicit named →
  admission request; explicit ambient → today's path (no admission); omitted →
  `readStoredSelection(this.spawnEnvironment.workspaceRoot(), 'lane')` (`:440`; same root the
  Accounts handler keys by, `provider-account-rpc.handlers.ts:248`). Reader absent → none
  (ambient). Reader error → refuse `unavailable-storage`. Pass
  `accountAdmission: { provider:'claude', scope:'lane', selection, operationId, runId, workingDirectory }`
  in the `runSdk` options. Bound continue/resume: existing `prepareNamed` stored-binding path
  (`claude-cli.adapter.ts:283-358`); different explicit selection refuses before admission.
- `AgentContinueErrorCode` adds `'account_refused'` (`agent-process-manager.service.ts:148`).
- `claudeLaneRefusal(code)` throws `LaneAccountResumeError` with the real code
  (`claude-sdk-lane-runner.ts:270-275`); `prepareNamed` passes `refusalCode`.
- `ClaudeNamedLaneAdmission`: launch from `resources.launch` (executable, env, cwd, setting
  sources) with `assertCertifiedLaunch(..., 'final')`; identity equals `launch.identityReference`;
  init version equals `launch.executable.version` before the lane receives task text.
- Non-`claude` CLIs unchanged.
- `di/register.ts:195-210`: inject the selection reader beside `admission`; update the stale
  comment.
- D39 spec: "list/message capabilities match handle" in `claude-cli.adapter.spec.ts`.
- Concurrency spec: chat and lane admitted on two routes; assert the two child envs carry
  different `CLAUDE_CONFIG_DIR` values.

### 11. Entry points and RPC (vscode-lm-tools, rpc-handlers, ptah-cli)

- `agent-spawn-args.schema.ts`: named allowed for `cli: 'claude'`; still refused for other CLIs;
  new text at `:55`. Specs pin MCP HTTP, MCP stdio and `execute_code` to this one validator
  (`agent-spawn-accounts.spec.ts`).
- `agent-namespace.builder.ts`: description text for `accountSelection`.
- `agent-rpc.handlers.ts`: `laneAccountRefusalCode` uses `instanceof LaneAccountResumeError`; map
  to `account_refused` with fixed text; `resumeSpawnAccountSelection` forwards named for `claude`.
  Update the barrel mocks in `agent-rpc.handlers.spec.ts` to include the class.
- `provider-account-rpc.handlers.ts`: inject the actions port; sign-in, cancel, sign-out call it
  (delete `releaseHeld`); `getAccountStatus` calls `actions.readStatus` then returns the summary;
  subscribe to `onStateChanged` and `notify` with the snapshot of the workspace root that started
  the operation; never log `fallback`.
- `session-rpc.handlers.ts`: fill `ChatSessionSummary.accountProfileId` from
  `metadata.accountBinding?.profileId` (running and finished sessions).
- `apps/ptah-cli/src/cli/commands/agent-cli.ts`: CLI host keeps refusing named (no storage) with
  `unavailable-storage`; update comments/copy that say release-held.

### 12. Electron UI (frontend)

| # | UI change | Kind | File | Test owner |
| --- | --- | --- | --- | --- |
| U1 | Sign in / Cancel / Sign out / Check status, state badges | Reused unchanged | `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts` | existing spec |
| U2 | Pending copy "Finish sign-in in the Claude window" | Copy change | same drawer | `account-details-drawer.component.spec.ts` (B17) |
| U3 | Fallback block: read-only script with copy button, "Check status" | Small block in existing drawer | same drawer | same spec (B17) |
| U4 | `release-held` mapping no longer reachable; state service handles async push | Existing service | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts` | its spec (B17) |
| U5 | Lane "Account: <label>" / "Default" / "Removed account" | One text field | `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`; model `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (`MonitoredAgent.accountProfileId` from `AgentProcessInfo.accountBinding?.profileId`) | `agent-card-header.component.spec.ts`, `agent-monitor.store.spec.ts` (B16): running and finished lanes |
| U6 | Chat session "Account: <label>" / "Default" | One text field | `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts` (producer `session-rpc.handlers.ts`, type `ChatSessionSummary`) | `session-list-row.component.spec.ts` (B17) for active and finished rows; `session-rpc.handlers.spec.ts` (B14) for the producer |

- Labels resolve in the renderer from the account list by `profileId`. Secret-canary specs: RPC
  payload, summary and push contain no email/org/path (except the fallback script field).
- Visual evidence (D5): visual-reviewer, Electron, dark and light, before and after, for the
  drawer (pending and fallback), the lane card and the session row. Owner: orchestrator after
  B17.

## Integration architecture

- Sign-in: UI → `provider:startAccountSignIn` → handler → actions → `reserveAuth` → certifier
  (executable, policy scan, env) → console launch → `pending` (or `fallback`) → serialized poll
  → success → kill console → proved close → `completeAuth(signed-in, ref)` → `onStateChanged` →
  handler `notify` → UI.
- Status: handler → `actions.readStatus` → status reservation (or pending tick) → certified
  status child → `completeStatus`.
- Sign-out: `reserveAuth` → certified `auth logout` → status → `signed-out`, ref cleared.
- Main chat: chat RPC → router precedence → chat session (resolved selection) → executor →
  bootstrap: `admitClaudeRoute` (lease → certifier) → bootstrap query (bootstrap mode check) →
  identity compare → close → `launch` (final mode check) → init version and source check →
  `commitRunBinding` (known runtime ref) → SDK attach → metadata save → identity re-check → gate
  commit → termination → release once / retain.
- Lane: MCP/RPC → validator → manager precedence (reader) → `runSdk` with admission →
  `prepareNamed` → admission → lane owner (same checks) → task text → close → release once.
- Failure and rollback: every certification child's `terminated` flows into release vs retain;
  no ambient retry; auth ops `busy` while any lease or unproved operation exists.
- Observability: fixed-text warn lines; binding rows readable from the registry; no secrets.

## Ambient-path non-regression (existing pins; expectations must not change)

- `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts` — ambient
  same-object return case.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts` and
  `sdk-query-options-builder.{betas,capabilities,auto-compact-argv,host-data,output-style,subagent-ttl,cli-notice,ptah-ui-hint}.spec.ts`.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
  ambient test at line 274.
- `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts` existing pipe cases.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` ambient resume and slash cases.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`,
  `agent-process-manager.guard.spec.ts`, `agent-process-manager.workspace-scope.spec.ts`
  (non-Claude CLIs and ambient Claude spawn).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
  ambient cases.
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts` (requests without
  `accountSelection`), `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`
  ambient cases.
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `surface-composition.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` (no new RPC method).
- A batch that must edit an expectation in these ambient cases stops and reports.

## Live evidence (D5 order; senior-tester owns `test-report.md` for all of Requirement 8)

| ID | When | Check (no secret read; no paid call except R8 step 6 Haiku) | Fail-closed default |
| --- | --- | --- | --- |
| E2 | Live session, before any named run | User-approved script, ambient login, no prompt: booleans (init before prompt, `accountInfo` keys present), `apiProvider`, `tokenSource`, init `apiKeySource`, `claude_code_version` | Named runs refuse at the 15 s deadline |
| E4 | Before step 3 | User reports managed file present (yes/no) and registry keys present (yes/no) | Present → certification refuses |
| E5 | Before step 3 (procedure), steps 3 and 8 (data) | Backend establishment without secrets: Ptah sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` and strips `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`; the cached flag `tengu_windows_credman` may still select Credential Manager (research:28). Mapping evidence requires the binary's target naming, which research did not read (research:29). Procedure: the user lists Credential Manager generic targets (names and last-modified only) before step 3, after step 3 and after step 8. A target counts as mapped to a profile only by an evidenced naming rule from the executable (for example a directory hash shown in the target name that the user can match by computing it from the profile path with a provided read-only command). No substring or creation-order inference. File existence is never proof of backend. | No evidenced rule → step 8 check "unresolved"; task not reported as done |
| E1 | Step 3 | Console opens, CLI shows its login UI, window closes when the CLI exits; user reports behavior only | Fallback script path |
| E3 | Step 4 | Real signed-in key names; developer updates the fixture tag | Unknown key refuses |
| E6 | Step 7 | Runtime refs equal step 4 refs per profile | Mismatch refuses `identity-mismatch` |

- Requirement 8 steps 1-8 run exactly as written in `task-description.md`; each failure is
  recorded in `test-report.md` with step number and safe code; any failure or "unresolved" keeps
  the task open.

## Architecture-level quality requirements

- Functional: Requirements 1-7 by specs; 8 live.
- Performance: per named admission one cached version probe, two registry queries (win32), one
  status child. Ambient adds nothing. One serialized poll per pending sign-in.
- Security: one allowlisted env per route; no secret, email, org, URL, CLI text in logs, RPC,
  renderer or DB; the fallback script carries only the directory and executable path; login bytes
  never reach Ptah; argument arrays only; host `process.env` never mutated.
- Maintainability: no host branch in host-neutral libs (win32 platform branch only); dependency
  direction kept; no new RPC method; no flag.
- Testability: no `process.cwd()`; no `jest.spyOn` on module namespaces; temp dirs from
  `os.tmpdir()`; fake spawners, never a real binary.

## Team-leader handoff

- Executors: backend-developer B1-B15; frontend-developer B16-B17; senior-tester for the live
  test; visual-reviewer for D5 screenshots.
- Complexity: HIGH.
- Ordering: B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → B9 → (B10, B12 parallel) → B11 → B13 →
  B14 → B15 → (B16, B17 parallel) → B18. B7 registers `CLAUDE_CLI_PROBE` to
  `ClaudeAccountCommand`, which implements the probe only from B8; Electron smoke runs in B9.
- Verification command form (all batches): `npm run verify -- -t lint,test,typecheck -p <projects>`;
  confirm the header says "for N projects"; Nx runs one task at a time (`nx.json`) and Jest uses 2
  workers (`jest.preset.js`).
- Literal manifest (every file in exactly one batch; C = create, M = modify, R = rewrite):

| Batch | Files | Projects |
| --- | --- | --- |
| B1 | M `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; M `libs/backend/auth-providers-tokens/src/lib/tokens.ts`; M `libs/backend/auth-providers-tokens/src/index.ts`; M `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`; M `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` | `@ptah-extension/auth-providers-tokens,@ptah-extension/shared` |
| B2 | M `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`; M `libs/shared/src/lib/types/execution/node.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` | `@ptah-extension/shared,@ptah-extension/rpc-handlers` |
| B3 | M `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts`; M `.../helpers/claude-account-route-env.spec.ts`; C `.../helpers/claude-identity-reference.ts`; C `.../helpers/claude-identity-reference.spec.ts`; M `.../helpers/index.ts` | `@ptah-extension/agent-sdk` |
| B4 | M `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`; M `.../helpers/off-thread-process-spawner-source.ts`; M `.../helpers/spawn-worker-pool.ts`; M `.../helpers/off-thread-process-spawner.spec.ts` | `@ptah-extension/platform-core,@ptah-extension/agent-sdk` |
| B5 | C `libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts`; C `.../claude-account-status.spec.ts`; C `.../claude-auth-settings-scan.ts`; C `.../claude-auth-settings-scan.spec.ts`; C `.../claude-login-console.ts`; C `.../claude-login-console.spec.ts` | `@ptah-extension/auth-providers` |
| B6 | C `libs/backend/persistence-sqlite/src/lib/migrations/0060_provider_account_lease_epoch.ts`; C `.../migrations/0060_provider_account_lease_epoch.spec.ts`; M `.../migrations/index.ts` | `@ptah-extension/persistence-sqlite` |
| B7 | M `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`; M `.../provider-account.store.spec.ts`; C `.../claude-route-certifier.ts`; M `.../provider-account.service.ts`; M `libs/backend/auth-providers/src/lib/di/register.ts`; M `libs/backend/auth-providers/src/lib/di/register.spec.ts` | `@ptah-extension/auth-providers` |
| B8 | R `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`; C `.../claude-account-command.spec.ts`; M `.../provider-account-auth-env.spec.ts`; M `.../provider-account-actions.service.ts`; M `.../provider-account-actions.service.spec.ts`; C `.../provider-account.admission.spec.ts` | `@ptah-extension/auth-providers` |
| B9 | C `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.spec.ts`; C `.../claude-named-account-persistence.ts`; C `.../claude-named-account-persistence.spec.ts`; M `libs/backend/auth-providers/src/index.ts`; M `apps/ptah-electron/src/di/phase-2-libraries.ts`; M `apps/ptah-electron/src/di/container.smoke.spec.ts` | `@ptah-extension/auth-providers,ptah-electron` |
| B10 | M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`; M `.../session-lifecycle/session-query-executor.accounts.spec.ts`; M `.../helpers/sdk-query-options-builder.ts`; M `.../helpers/sdk-query-runner.service.ts`; M `.../helpers/sdk-model-service.ts`; M `libs/backend/agent-sdk/src/lib/di/register.ts` | `@ptah-extension/agent-sdk` |
| B11 | M `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`; M `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`; M `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`; C `.../chat/session/chat-slash-command-router.accounts.spec.ts`; M `.../chat/session/chat-session.service.ts`; M `.../chat/session/chat-session.account-binding.spec.ts` | `@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers` |
| B12 | M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`; M `.../cli-agents/agent-process-manager.account-binding.spec.ts`; M `.../cli-agents/cli-adapters/claude-cli.adapter.ts`; M `.../cli-agents/cli-adapters/claude-cli.adapter.spec.ts`; M `.../claude/claude-sdk-lane-runner.ts`; M `.../claude/claude-sdk-lane-runner.spec.ts` | `@ptah-extension/cli-agent-runtime` |
| B13 | M `libs/backend/cli-agent-runtime/src/lib/di/register.ts`; M `.../di/register.agent-process-manager.smoke.spec.ts`; M `.../cli-agents/cli-adapters/cli-adapter.interface.ts` (comment); M `.../session-children/session-spawner.accounts.spec.ts`; M `apps/ptah-cli/src/cli/commands/agent-cli.ts`; M `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts` | `@ptah-extension/cli-agent-runtime,ptah-cli` |
| B14 | M `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; M `.../handlers/agent-rpc.handlers.spec.ts`; M `.../handlers/provider-account-rpc.handlers.ts`; M `.../handlers/provider-account-rpc.handlers.spec.ts`; M `.../handlers/session-rpc.handlers.ts`; M `.../handlers/session-rpc.handlers.spec.ts` | `@ptah-extension/rpc-handlers` |
| B15 | M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`; M `.../mcp-core/agent-spawn-args.schema.spec.ts`; M `.../mcp-core/agent-spawn-accounts.spec.ts`; M `.../namespace-builders/agent-namespace.builder.ts`; M `.../namespace-builders/agent-namespace.builder.spec.ts` | `@ptah-extension/vscode-lm-tools` |
| B16 | M `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`; M `.../agent-monitor.store.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`; M `.../agent-card/agent-card-header.component.spec.ts` | `@ptah-extension/chat-streaming,@ptah-extension/chat` |
| B17 | M `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`; M its `.spec.ts`; M `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`; M `.../account-details-drawer.component.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts`; M `.../session-list-row/session-list-row.component.spec.ts` | `@ptah-extension/core,@ptah-extension/chat` |
| B18 | none (host check) | `ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` |

- Verification points: no production code returns `'release-held'` (grep; the union member and
  its COPY entry remain, Decision D-D); no flag switches named admission; Electron smoke resolves
  the four account tokens non-null and `SdkQueryRunner.accountPersistence` non-null; ambient pins
  above unchanged; `rpc-allowlist`/`rpc-surface`/`surface-composition` unchanged.
- Spec rules for every implementer: no `process.cwd()`; no `jest.spyOn` on module namespaces;
  register every new `@inject` token; list existing specs that mock a changed member before
  editing; no builds, logins or paid calls.

## Decisions

- D-A (accepted by D5): separate console window via `conhost.exe`, never read; fallback script.
- D-B: installed CLI from `ClaudeCliDetector.findExecutable()` for all named children,
  `pathToClaudeCodeExecutable` pinned; floor 2.1.301, no ceiling. Evidence: research Local
  consequences; `claude-account-command.ts:126-135`. Reversible.
- D-C: one enumerated allowlist env per route for every named child (Component 2). Consequence:
  cloud credentials are absent inside named sessions. Evidence: R3.1; SDK `env` replaces the child
  env (research). Reversible.
- D-D (revised): keep `'release-held'` in `ProviderAccountResultCode` and COPY (neutral text "Named
  accounts are not available on this host."); no production path returns it. Removing the union
  member touches 40 files (repository grep), most of them specs and comments, with no behavior
  gain. R1.4 is met by the producer removal and copy change. Follow-up: union removal as a named
  later item. Reversible.
- D-E: identity reference reuses the existing `ptah-quota-owner` formula; status side uses
  `orgName`. E6 verifies; mismatch fails closed.
- D-F: one admission per run; the router resolves only (`session-query-executor.service.ts:671-688,785-818`).
- D-G: lease first, certification under the lease; release only when every probe child is proved
  closed, else retain.
- D-H: bootstrap is a certified subset (no settings, tmp cwd); final query is checked under the
  final context before the gate (Component 2 rationale).
- D-I: managed policy: file scanned when present, refused when unreadable; Windows registry
  policy and macOS managed preferences refuse when present or unreadable (not parsed).
- D-J: persistence adapter lives in auth-providers without cli-agent-runtime imports
  (cli-agent-runtime depends on auth-providers); Electron binds the lane token structurally.
- D-K: `ClaudeAccountNamedResolvedResourceContext.launch` is type-optional to keep existing
  fixtures compiling; every consumer refuses when it is absent.
- D-L: named-later P1F-*/P1E-* items are not on the path.

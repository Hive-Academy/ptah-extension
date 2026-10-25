# Implementation Plan - TASK_2026_719_4f64 (revision 4, D13)

Worktree root (W): `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. All paths
are relative to W. Revision 1 is kept in `implementation-plan-rev1.md` and revision 2 in
`implementation-plan-rev2.md`. Revision 3 applies only review round 2 (`implementation-plan-review.md`)
New finding 1 and its four Minor notes, as D10 authorizes. Everything else is revision 2 unchanged.
D-D, D-K and D-M stay accepted.

## Revision 4 changes

Applies D13 (`decisions.md:75-81`, the user's decision: personal accounts only, Option 1 + 3),
scoped review finding 2 and the two non-blocking notes of `implementation-plan-review.md`, and
closes finding 1 through D13. Revision 3 is kept in `implementation-plan-rev3.md`. Line numbers
below are measured in this revision after all edits.

| Item | What changed | Plan lines (rev4) |
| --- | --- | --- |
| D13 classification | Class P/O from the sanitized status; verified 2.1.310 status keys and subscription words; `orgId`/`orgName` are not signals (A-C2); class O refuses named runs with `unsupported-source`; auth actions stay available for class O; Decision D-S | 270-298; 343; 505; 612; 1144-1168 |
| D13 proved evidence | A-S1 proved (S1 row). A-S12 proved: `managedSettings`/`--managed-settings` refused at both boundaries and pinned by builder tests (S12 row, Component 2). Post-init tripwire on `tokenSource`/`apiKeySource`/`subscriptionType` before the gate. Server-managed eligibility labelled DA-1 (documentation-based, cited). Residual R-1 stated | 335; 203-209; 346; 348-373; 428-438; 795-798; 831 |
| Finding 1: unresolved policy treated as positive absence | Cache/consent-file absence is no longer proof (D-Q revised). S9 is resolved by class plus DA-1; the files are refusal signals only. A-S1/A-S12 are no longer assumptions. Remaining labels DA-1, A-C2, A-T1 and R-1 are explicit | 343; 348-373; 1133-1137 |
| Finding 2: per-child SDK checks | Contract `ClaudeLaunchBoundaryOutcome` (B1), implementation `checkLaunch` (B6), adapter `checkLaunchBoundary` (B9), awaited call sites in the executor (B13) and lane runner (B12) before each bootstrap and final child; settlement; B12/B13 fixtures; performance | 156-161; 480-487; 752-758; 783-794; 825-831; 907-918; 982-990 |
| Note: version cache | Stat fingerprint in the cache key; an in-place update re-probes; run boundaries compare without spawning; fixtures | 242-249 |
| Note: scan/version ordering | `knownVersion` input; which fixture lives in the scan spec and which in the certifier spec | 449-454 |
| N accounts, concurrent | Each profile is its own route; main chat on A and lane on B at the same time; regression row | 934-938; 918 |
| Live evidence | E4 checks class P on the user's accounts | 960-975 |

Batch graph: no file was added to or removed from any batch; file counts and `-p` projects are
unchanged. B1, B3, B5, B6, B8, B9, B12 and B13 gain content and spec cases (rows 1021-1033). One
edge note is added (1047-1051). D-P (win32 + 2.1.310 only) is kept unchanged: D13 removes the
remote-file proof but does not show that other builds or platforms read no new source.

## Revision 3 changes

| Item | What changed | Plan lines (rev3) |
| --- | --- | --- |
| Finding 1 Serious: unresolved policy coverage | Policy coverage is now step 1-2 of certification and runs before every settings-reading child (status, login console, logout, SDK bootstrap/final, lane). A closed coverage table `CLAUDE_POLICY_COVERAGE` keyed by platform and exact CLI version names every source the inspected build reads and, per source, scan / positive absence / refusal. Only win32 + 2.1.310 is covered (read-only inspection of the installed binary). darwin, linux and every other version refuse `unsupported-source` before any child. Remote/server-managed cache, drop-in directory, ancestor (git-root) local settings, env selectors, flag tier and parent/plugin channels each get a mechanism. The "no runtime refusal from the scan" rule is deleted. Absence is never inferred from status or `accountInfo()`. Managed policy is never disabled. Runtime identity checks stay as defense in depth. | 163-168 (shared rule, flag tier); 218-316 (coverage prerequisite, table, S1-S12, assumptions); 318-352 (former list resolved, defense in depth, B5 fixtures); 353-400 (Component 4a certifier and B6 tests); 432-441 (fallback "Settings context" narrowed); 460-470 (actions `checkCoverage`, B8 tests); 707-726 (regression rows); 762-775 (E4); 816-817 (B5/B6 rows); 906-926 (D-O to D-R) |
| Note: B7 work packages | WP-a three substantive files; WP-b, WP-c, WP-d six pins each; WP-e one pin. One commit, one verify. | 818 (B7 row) |
| Note: copy audit scope | Audit covers user-facing text and real producers only. Internal historical comments are exempt, for example `libs/shared/src/lib/types/agent-process.types.ts:334`. B22 stays "files: none". | 850-859 |
| Note: registry hive normalization | Requests use `HKLM`/`HKCU`. Output uses `HKEY_LOCAL_MACHINE`/`HKEY_CURRENT_USER` (verified: `reg query HKCU\SOFTWARE\Policies /reg:64` prints `HKEY_CURRENT_USER\SOFTWARE\Policies\…`). Both are normalized to the long form, case-insensitively, before comparing. Fixtures pair short requests with long output. | 277-282; 333-336 |
| Note: certifier handoff | Full certifier sequence restated as Component 4a (rev1 lines 149-161 carried over), with the rev2 structural probe/factory injection (`ClaudeCliProbe` interface declared in the certifier file; no token, no registration in B6) and the coverage refusal. | 353-400; 817 |

Batch graph: no file was added to or removed from any batch; counts and `-p` projects are
unchanged (B3, B5, B6, B8 and B13 gain content and spec cases only). Edges are unchanged: B5 needs
B3 (`claudeSettingsOverride`), B6 needs B4 and B5, B8 implements the probe and registers the
certifier. Line numbers in this table were measured before this paragraph was added: add 6 to
each.

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
  `implementation-plan-rev1.md`. Revision 4 adds `decisions.md` D8-D13 (D13 is the user's
  classification decision), `research-report-2.md` and the scoped re-check in
  `implementation-plan-review.md`.
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
    `policy: { coverage: string /* coverage entry id, e.g. 'win32@2.1.310' */; managedFile: 'absent'|'scanned'; managedDropIn: 'absent'|'scanned'; registry: 'absent'|'not-applicable'; remoteSignals: 'absent' }`,
    `accountClass: 'personal'` (revision 4, D13: a launch exists only for class P; a closed
    literal, so another class needs a type change), and `executable.fingerprint: { size: number;
    mtimeMs: number }` (revision 4 note: the stat of `sdkExecutablePath` taken with the version),
    `identityReference: string`.
  - `ClaudeAccountNamedResolvedResourceContext` gains `readonly launch?: ClaudeCertifiedLaunchContext`
    (D-K: optional only for type compatibility; see Decisions).
  - `ClaudeAccountAdmissionRequest` gains `readonly workingDirectory?: string`.
  - New `ClaudeAccountSelectionReader { readStoredSelection(workspaceRoot, scope): Promise<{ readonly profileId: string | null }> }`.
  - Revision 4 (finding 2): `ClaudeLaunchBoundary = 'bootstrap' | 'final'` and
    `ClaudeLaunchBoundaryOutcome = { readonly ok: true } | { readonly ok: false; readonly code:
    'unsupported-source' | 'identity-unproved' | 'route-changed'; readonly terminated: boolean }`.
    They live here because agent-sdk (`session-query-executor.service.ts:28`) and
    cli-agent-runtime (`claude-sdk-lane-runner.ts:15`) already import this package; no new
    dependency edge. Exported from `auth-providers-tokens/src/index.ts`.
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
  Revision 3: `actual` also carries `flagSettings?: string` (the SDK `settings` option, which the
  main-chat builder sets to `buildFlagSettingsArg(...)` at `sdk-query-options-builder.ts:1325`,
  defined at `:704-734`). `final` parses it and applies `claudeSettingsOverride`; anything other
  than `'none'` refuses `identity-unproved`. The flag tier is a policy source the CLI reads.
  Revision 4 (D13, A-S12 proved): `actual` also carries `managedSettings?: unknown` and
  `extraArgs?: Record<string, string | null>`. Both modes refuse `identity-unproved` when
  `managedSettings` is present (any value, `{}` included) or an `extraArgs` key is
  `managed-settings`. The parent-managed channel is exactly the SDK `Options.managedSettings`,
  which the CLI receives as `--managed-settings` (research-report-2.md:54; binary argv builder).
  `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is not in `CLAUDE_CERTIFIED_ENV_KEYS`, so
  `buildCertifiedClaudeEnv` drops it; a B3 fixture sets it in `sourceEnv` and pins its absence.
- `claudeSettingsOverride(value: unknown): 'none' | 'override' | 'malformed'` (revision 3, moved
  here so agent-sdk and auth-providers share one rule; dependency direction unchanged): the rev1
  file scan rule (`apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `gcpAuthRefresh`,
  `forceLoginMethod` other than `claudeai`, `forceLoginOrgUUID` with any value (revision 4,
  D13: an org-binding signal; the key occurs in the 2.1.310 binary), an `env` key for which `isCertifiedClaudeEnvKey` is
  false) plus a non-empty `enabledPlugins` (plugin-contributed settings are not covered). A
  non-object value is `malformed`. Exported from both barrels with the other helpers.
  `bootstrap` requires an equal executable and digest, `settingSources: []` and
  `cwd = os.tmpdir()`. Rationale: R3.3 and D-H, unchanged from rev1.
- `claude-identity-reference.ts`: `claudeIdentityReference(email, organization)` returns the
  SHA-256 hex of `ptah-quota-owner\0<email>\0<organization>` over trimmed values, or `null` for an
  empty email. This is the formula at `session-query-executor.service.ts:578`.
- Exports (finding 7): `helpers/index.ts` (beside `:264`) and `libs/backend/agent-sdk/src/index.ts`
  (beside the explicit line `:453`) both export `CLAUDE_CERTIFIED_ENV_KEYS`,
  `isCertifiedClaudeEnvKey`, `buildCertifiedClaudeEnv`, `certifiedEnvDigest`, `certifiedNamedEnv`,
  `assertCertifiedLaunch`, `ClaudeCertifiedLaunchRefusal`, `claudeIdentityReference`,
  `claudeSettingsOverride` and (revision 4) `CLAUDE_PERSONAL_SUBSCRIPTIONS = ['pro', 'max'] as const`.
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
  `^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$`. Refuse below 2.1.301 (`unsupported-store`). Cache
  (revision 4 note): the key is the resolved path plus an `fs.stat` fingerprint `{ size, mtimeMs }`
  of `sdkExecutablePath`. Before any reuse the file is stat-ed again. A different size or mtime,
  a different path, or a stat error drops the entry and re-runs `--version`, so an in-place
  auto-update re-probes. The fingerprint is copied into `launch.executable`. Run boundaries never
  spawn `--version`; they compare the fingerprint only (Component 4a `checkLaunch`), and the init
  `claude_code_version` check stays. Fixtures in the command spec (B8): same fingerprint, one
  `--version` spawn for two calls; mtime changed between calls, a second spawn and the new
  version returned; stat `ENOENT`, no cached result and `unsupported-store`.
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

- `claude-account-status.ts`, `parseClaudeAccountStatus(text, exitCode, canonicalDir)`: rev1 rules
  (required keys, accepted metadata, version-tagged consistency for `apiKeySource` and
  `forcedLoginMethod`, exit code agreeing with `loggedIn`, normalized directory comparison). It
  returns `{ loggedIn:false }` or `{ loggedIn:true, identityReference, accountClass }` using
  `claudeIdentityReference(email, orgName)`. A spec pins equality with the quota resolver formula
  (`auth-providers/src/lib/quota/provider-owner.resolver.ts`, same lib).

  **Account class (revision 4, D13).** Verified status shape (installed 2.1.310, read-only
  `grep -a` of the binary, 2026-10-25): the builder sets `loggedIn`, `authMethod`, `apiProvider`,
  `analyticsDisabled`, `projectsDirectory`, `configDirectory`; then `forcedLoginMethod` only when
  policy sets it, `allowedProviders` only when policy sets it (a key research-report.md:75 did not
  list), `apiKeySource` only when a key source other than `none` exists; and for
  `authMethod === 'claude.ai'`: `email`, `orgId` (`organizationUuid ?? null`), `orgName`
  (`organizationName ?? null`), `subscriptionType` (`?? null`). The same build compares the
  subscription with `"team"`/`"enterprise"` (`e==="team"||e==="enterprise"`) and with
  `"pro"`/`"max"` (`subscriptionType==="pro"||subscriptionType==="max"`). Class P holds only when
  all of these are true:
  1. `loggedIn:true`, `authMethod === 'claude.ai'`, `apiProvider === 'firstParty'`;
  2. `subscriptionType` is exactly `'pro'` or `'max'` (`CLAUDE_PERSONAL_SUBSCRIPTIONS`, B3);
  3. no `forcedLoginMethod` key, no `allowedProviders` key, `apiKeySource` absent or `'none'`;
  4. every key is in the known set above (an unknown key is not ignored);
  5. `orgId` and `orgName` are a string or `null`. They are not class signals: the CLI fills them
     from the OAuth account's `organizationUuid`/`organizationName` for every claude.ai login, and
     a personal account is expected to carry its own personal organization (Assumption A-C2;
     check: E4 records only whether `orgId` is non-null on each of the user's accounts).
     Refusing on their presence would refuse every personal account.
  Every other result is class O: `team`, `enterprise`, `null`, a missing or unknown
  `subscriptionType`, a policy key, an unknown key or a malformed value. Class O is never
  certified for a named run (Component 4a step 6b, fixed code `unsupported-source`, Decision
  D-S). The parser returns the class, never the raw values, and nothing logs the class together
  with an identity field.
  Fixtures in `claude-account-status.spec.ts` (B5): `max` and `pro` with a non-null `orgId` give
  P; `max` with `orgId:null` gives P; `team`, `enterprise`, `null`, missing, `'Max'` and
  `'claude_max'` give O; `max` plus `forcedLoginMethod`, plus `allowedProviders`, plus
  `apiKeySource:'apiKeyHelper'`, plus an unknown key `orgRole` give O; a canary asserts that no
  email, org value or subscription word reaches the result or the logger.
- `claude-auth-settings-scan.ts` exports `CLAUDE_POLICY_COVERAGE`, `claudePolicyCoverage(platform)`
  and `scanClaudeAuthPolicy({ cwd, canonicalDir, platform, coverage, knownVersion?, fs: { readFile, lstat, readdir }, queryRegistry, signal })`.
  It starts no Claude child. Its only child is `reg.exe` (Component 3), which reads no Claude
  settings.

  **Coverage prerequisite (revision 3, round 2 finding 1).** Certification has a hard
  prerequisite: the effective policy-source set of the certified executable, version, platform
  and context is known, and every source in it is scanned or positively shown absent. The
  certifier (Component 4a) enforces it before any settings-reading child. Absence is never
  inferred from a successful `auth status`, the init message or `accountInfo()`. Managed policy is
  never disabled or bypassed (no `settingSources` trick for status/login/logout, no policy env).
  An unresolved source or precedence returns the fixed code `unsupported-source` before the child
  launches. The rev2 rule "no runtime refusal from the scan" is deleted.

  `CLAUDE_POLICY_COVERAGE` is a closed, data-only table. Each entry is
  `{ id, platform, versions: readonly string[] /* exact x.y.z */, sources }` for one inspected CLI
  build. `claudePolicyCoverage(platform)` returns the platform's entry or `null`. Entries in this
  revision:

  | Entry id | Platform | Versions | Evidence |
  | --- | --- | --- | --- |
  | `win32@2.1.310` | win32 | `2.1.310` only | Read-only inspection (2026-10-25) of the installed `%USERPROFILE%\.local\bin\claude.exe`, `claude --version` = `2.1.310 (Claude Code)`; strings cited per row below |

  darwin and linux have no entry: `managed-settings.json` paths for both are present in the
  bundle (`"/Library/Application Support/ClaudeCode"`, `"/etc/claude-code"`, one occurrence each),
  but the macOS MDM reader is not in the inspected win32 build (`Managed Preferences` and
  `com.anthropic.claudecode` have zero occurrences), so their source sets cannot be established
  here. They refuse `unsupported-source` before any child (Decision D-P). Any version not in an
  entry's list also refuses `unsupported-source`; below 2.1.301 keeps `unsupported-store`. Adding
  a row needs the same read-only inspection, recorded in `research-report.md`, and is a data-only
  change to this table and its spec.

  Sources of entry `win32@2.1.310` (every one must resolve; the first unresolved source refuses):

  | # | Source (CLI evidence) | Mechanism | Outcome |
  | --- | --- | --- | --- |
  | S1 | User settings `<canonicalDir>/settings.json`. The CLI resolves `userSettings` against its config home (`case"userSettings":return Yp(Ne(),n)`), which `CLAUDE_CONFIG_DIR` sets; status `configDirectory` must equal `canonicalDir` (Component 4 parser, defense in depth). Revision 4: A-S1 is proved (docs `settings` and `authentication` "Log in with multiple accounts"; binary config-dir getter reads `process.env.CLAUDE_CONFIG_DIR`; t3code `ClaudeAdapterV2.ts:3987`; research-report-2.md:52) | read + `claudeSettingsOverride`. ENOENT = empty | scanned |
  | S2 | Project settings `<P>/.claude/settings.json` with `P = projectConfigDir ?? cwd` (`case"projectSettings":return pe(n.projectConfigDir??Kir(n))`; `Kir` returns `e.cwd`). `projectConfigDir` comes only from `host.launchOptions.projectConfigRoot()` | Ptah's argv is fixed (status/login/logout arrays in Component 3; SDK `extraArgs` holds only `replay-user-messages` and `name`, `sdk-query-options-builder.ts:1470-1505`) and the env is allowlist-built, so no launch option sets it: `P = cwd`. Read + rule | scanned |
  | S3 | Local settings `<L>/.claude/settings.local.json`, `L = projectConfigDir ?? yB(cwd, canonicalGitRoot)`. On win32 `Fwi` refuses canonicalization ("this platform has no uid semantics … the store stays at the session cwd (canonicalization is POSIX-only)"), so `L = cwd` | read + rule at `cwd` | scanned |
  | S4 | Ancestor context: on POSIX `L` can be the canonical git root above `cwd`. Not read on win32 (S3), but guarded on every platform so a future POSIX entry and any misread of S3 fail closed | for each strict ancestor `A` of `cwd` (at most 64, else refuse): `lstat A/.git`; ENOENT → next; present → `lstat A/.claude/settings.local.json` must be ENOENT; present, or any error other than ENOENT on either lstat → refuse | proved absent or refused |
  | S5 | Managed file `C:\Program Files\ClaudeCode\managed-settings.json` (`policySettings`; WSL mirror `kO="/mnt/c/Program Files/ClaudeCode"` confirms the directory) | read + rule; ENOENT = absent | `policy.managedFile` |
  | S6 | Managed drop-in directory `C:\Program Files\ClaudeCode\managed-settings.d\` (the CLI lists entries that are files or symlinks, end in `.json`, do not start with `.`, sorted) | `readdir`: ENOENT → absent. Otherwise at most 32 entries (else refuse); every entry the CLI would load is read + rule; an entry that is a symlink, or any read or readdir error other than ENOENT → refuse | `policy.managedDropIn` |
  | S7 | Registry `HKLM\SOFTWARE\Policies\ClaudeCode`, `HKCU\SOFTWARE\Policies\ClaudeCode` (bundle strings `HKCU\SOFTWARE\Policies\ClaudeCode`, `mdm`, `hkcu`) | registry probe below; present → refuse (values are never parsed) | proved absent or refused |
  | S8 | WSL-inherited Windows policy (`wslInherits`, `/mnt/c/...` paths) | not applicable: native win32 only; Component 3 refuses WSL execution | not applicable |
  | S9 | Server-managed (remote) settings. Docs: delivered only to Claude for Teams and Claude for Enterprise; the fetch does not block startup except on a first interactive sign-in or `forceRemoteSettingsRefresh`; a non-interactive run applies approval-requiring payloads (including `apiKeyHelper`) without the dialog (research-report-2.md:11-13,53,58-60). Cache `n6(){return cE()??kl(Ne(),"remote-settings.json")}`; consent files `remote-settings-consent.json`, `remote-settings-helper-consent` under the same base | Revision 4 (D13, D-Q revised): resolved by account class, not by files. Class P: not applicable under documentation-based assumption DA-1 (below), backed at run time by the post-init tripwire (Components 9 and 10). Class O: refused (Component 4a step 6b). The three files stay an extra refusal signal only: `lstat` each; present, or any error other than ENOENT, refuses; all ENOENT proves nothing and is recorded as `remoteSignals:'absent'` | class P: not applicable (DA-1), signals absent; class O or a signal present: refused |
  | S10 | Env policy selectors (`CLAUDE_CODE_MANAGED_SETTINGS_PATH`, `CLAUDE_CODE_REMOTE_SETTINGS_PATH`, both present in the bundle) and every other non-allowlisted name | positively absent by construction: the child env is `buildCertifiedClaudeEnv` (allowlist), checked by digest at each boundary (Component 2) | proved absent |
  | S11 | Flag settings tier (`flagSettings`). Ptah sets `settings` for the main-chat final query (`sdk-query-options-builder.ts:1325`) | status/login/logout argv carry no `--settings`; the SDK final check applies `claudeSettingsOverride` to the actual value (Component 2) | scanned at the run boundary |
  | S12 | Parent-managed and host-supplied settings (`host.settingsSource.parentManagedSettings()`, `useCoworkPlugins()`) and plugin settings (`case"plugin"`) | Revision 4: A-S12 is proved (docs `managed-settings` "Let an embedding host add policy"; docs `agent-sdk/typescript` `Options.managedSettings`; binary argv builder `...n.managedSettings?["--managed-settings",n.managedSettings]:[]`; research-report-2.md:54). The only channel is `Options.managedSettings` / `--managed-settings`, and Ptah never passes either: `assertCertifiedLaunch` refuses both at bootstrap and final (Component 2), and builder tests pin their absence in the named main-chat options (B13, `claude-account-route-env.spec.ts`) and the named lane options (B12, `claude-cli.adapter.spec.ts`). `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is dropped by the allowlist (B3 fixture). The `plugins` key is absent from both builders (grep 2026-10-25); `enabledPlugins` in any scanned file refuses | proved absent |

  Verified vs Assumption (revision 4): every string cited above was read from the installed
  2.1.310 binary text (read-only `grep -a`, no run besides `--version`). A-S1 and A-S12 are proved
  (rows S1 and S12). Remaining labels:
  - **DA-1 (documentation-based assumption, D13):** server-managed settings reach only Claude for
    Teams and Claude for Enterprise organizations; a personal Pro/Max login has no admin console
    that could configure them. Citation: docs `server-managed-settings` (Note and Requirements,
    fetched 2026-10-25), recorded in research-report-2.md:12,53,58. Not proved: whether a personal
    login contacts the settings endpoint at all is undocumented (research-report-2.md:82). DA-1 is
    what makes S9 not applicable to class P. If Anthropic documents remote settings for personal
    plans, or E4 shows a personal account receiving them, `CLAUDE_PERSONAL_SUBSCRIPTIONS` is
    emptied (data change) and every named context refuses until a new decision.
  - **A-C2:** personal accounts report a personal `orgId`/`orgName` (Component 4 parser). Not a
    gate; E4 records it.
  - **A-T1:** `accountInfo().subscriptionType` uses the same words as status `subscriptionType`
    (the binary fills it from an internal `subscription` field). The tripwire refuses a word
    outside `CLAUDE_PERSONAL_SUBSCRIPTIONS` (fail closed). Check: E4 records the word for each of
    the user's accounts; a different spelling is a one-constant data change, reported.
  - **R-1 (residual, accepted by D13):** the classification read is itself an `auth status`
    child, so it runs before the class is known. It runs only after S1-S8, S10 and the S9 signals
    pass, and it starts no model turn. Whether `auth status` of a Team/Enterprise account fetches
    remote settings is unknown (the docs exempt `claude auth` subcommands from
    `forceRemoteSettingsRefresh`, research-report-2.md:60). D13 names `auth status --json` as the
    classifier (decisions.md:79), so this read is the decided mechanism, not an unscanned source.
    Named runs, where the R3.5 hazard lives (an `apiKeyHelper` applied without a dialog in a
    non-interactive run), never start for class O.
  The rev3 rule "cache and consent files absent means no remote policy" is removed (D-Q revised).

  File scan rule: `claudeSettingsOverride` (Component 2). Limit 256 KiB per file. A helper is
  never run. A file read error other than ENOENT refuses. `override` or `malformed` refuses.

  Registry probe (finding 1). Per hive H in (HKLM, HKCU), at most 2 queries:
  1. `queryRegistry('H\SOFTWARE\Policies')`.
  Hive normalization (revision 3 note): requests use `HKLM`/`HKCU`; `reg.exe` prints
  `HKEY_LOCAL_MACHINE`/`HKEY_CURRENT_USER` (verified 2026-10-25: `reg query HKCU\SOFTWARE\Policies
  /reg:64` exit 0, lines `HKEY_CURRENT_USER\SOFTWARE\Policies\Microsoft`, …). Before any
  comparison both the queried path and each output line are normalized: a leading `HKLM\` or
  `HKCU\` becomes the long name, and comparison is case-insensitive. "Queried path" below means the
  normalized form.
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

  Former "Not detected" list (rev2), now resolved: server-managed/remote settings → S9 by account
  class (revision 4);
  drop-in directories → S6; other MDM profiles → S7 on win32, and darwin/linux refuse (no
  coverage entry); project settings above `cwd` → S2/S3 (project and local are read at `cwd` on
  win32, verified) and S4 (ancestor guard); env policy selectors → S10. Nothing is left
  "detected at run time only".

  Defense in depth and tripwire (revision 4): certification requires the certified status
  (`loggedIn:true`, `authMethod:'claude.ai'`, `apiProvider:'firstParty'`, `apiKeySource` absent
  or `'none'`, class P, matching identity reference). Each named run checks, before the prompt or
  task text is released: init `apiKeySource` in `{'none','oauth'}`; init `claude_code_version`
  equal to the certified version; and `accountInfo()` with `tokenSource === 'claude.ai'`
  (verified: the 2.1.310 credential resolver returns `{source:"claude.ai",hasToken:!0}` for a
  claude.ai login and reports `tokenSource` `"none"` when an API key is also present),
  `apiKeySource` absent or `'none'`, `subscriptionType` in `CLAUDE_PERSONAL_SUBSCRIPTIONS` (A-T1)
  and the same identity reference. Any mismatch closes the child before the gate opens and
  refuses `identity-unproved`. The tripwire is the runtime backstop for DA-1, not a substitute
  for the class rule.
- Fixtures in `claude-auth-settings-scan.spec.ts` (fake `fs`, fake `queryRegistry`, no real
  `reg.exe`, platform and coverage injected):
  - Registry: absent (Policies lists without `ClaudeCode`), absent-parent (Policies exit 1 and
    SOFTWARE lists without `Policies`), present, access-denied (exit 1 + "ERROR: Access is
    denied." and the parent listing includes `Policies`: refuse), generic failure (exit 2 / spawn
    error), timeout (`timedOut`, `terminated:false`: refuse and unproved), malformed (exit 0 with
    an unrecognized line; overflow). Each request is `HKLM\…`/`HKCU\…` and each fake output uses
    `HKEY_LOCAL_MACHINE\…`/`HKEY_CURRENT_USER\…` (mixed case in one fixture); absent must still
    resolve to absent.
  - Coverage: `claudePolicyCoverage('darwin')` and `('linux')` are `null`; no `fs` or
    `queryRegistry` call. Ordering note (revision 4): `scanClaudeAuthPolicy` takes an optional
    `knownVersion`. When the caller already knows the version (`checkLaunch` on an existing
    launch, Component 4a) and it is not in the entry, the scan refuses with no `fs` or
    `queryRegistry` call (fixture here). In the initial certifier flow the version is not yet
    known, so the scan runs first and step 3 refuses the uncovered version afterwards; that
    fixture is in the certifier spec (B6) and asserts that `status` is never called.
  - Unknown source: drop-in directory with one `.json` file holding `apiKeyHelper` → refuse;
    drop-in with only `.hidden.json` and `README.txt` → absent; drop-in readdir `EACCES` → refuse;
    a symlink entry → refuse; 33 entries → refuse.
  - Remote signals: each of the three S9 files present (one fixture each) refuses; `lstat`
    `EPERM` refuses; all ENOENT gives `remoteSignals:'absent'` (recorded, not proof; revision 4).
  - Ancestor ambiguity: `cwd` with an ancestor holding `.git` and `.claude/settings.local.json`
    → refuse; an ancestor with `.git` only → pass; an ancestor holding only
    `.claude/settings.json` (the user's home pattern) and no `.git` → pass; `lstat .git` `EACCES`
    → refuse; 65 ancestors → refuse.
  - Rule: `enabledPlugins` non-empty in `<cwd>/.claude/settings.json` → refuse.
  - A canary asserts that no fixture output, value line or path reaches the result, the logger or
    the thrown summary.

### 4a. Route certifier (auth-providers `claude-route-certifier.ts`, B6; restated from rev1 lines 149-161)

`ClaudeRouteCertifier` is a plain class. Its constructor takes
`(probe: ClaudeCliProbe, platform: NodeJS.Platform, fs: { readFile, lstat, readdir })`.
`ClaudeCliProbe` is an interface declared in this file
(`certifyExecutable`, `status`, `logout`, `queryRegistry`); B8's `ClaudeAccountCommand` implements
it structurally, and B8 registers the certifier with a factory (Component 7 `register.ts`). B6
declares no token and registers nothing, so B6 has no forward dependency. Methods:
`certify({ route, profile, cwd, settingSources, signal })` for runs and
`authContext({ route, signal })` (steps 1-5 with `cwd = canonicalDir`) for sign-in, status and
sign-out. `checkCoverage(context, signal)` re-runs steps 1-2 (S9 signals included) against an
auth context; the actions service calls it before every status or logout child and before the
console. Revision 4 (finding 2): `checkLaunch(launch, signal)` is the run-boundary check. It
re-runs steps 1-2 for `launch.cwd` and the entry `launch.policy.coverage` with
`knownVersion = launch.executable.version`, re-reads the S9 signals, stats
`launch.executable.sdkExecutablePath` and compares the fingerprint (no `--version` child), and
requires `launch.accountClass === 'personal'`. It starts no Claude child; its only children are
`reg.exe` probes. Result `ClaudeLaunchBoundaryOutcome` (Component 1): a scan refusal or a present
signal gives `unsupported-source`; a fingerprint change or stat error gives `identity-unproved`;
`terminated:false` when a `reg.exe` close was not observed.

1. Coverage entry: `claudePolicyCoverage(platform)`; `null` refuses `unsupported-source`. No child.
2. Policy scan (Component 4) for `cwd`, `canonicalDir` and the entry, the three S9 signals
   included. Any unresolved source or a present signal refuses `unsupported-source`. No Claude
   child has run yet.
3. `probe.certifyExecutable(signal)` (Component 3: `--version`, `cwd = os.tmpdir()`, certified
   env, cached by path and stat fingerprint). Below 2.1.301 refuses `unsupported-store`; a version
   not in the entry's `versions` refuses `unsupported-source`. (Steps 1-2 run first so the source
   set of the only covered build is checked before even this child. Assumption A-V: `--version`
   reads no auth setting; it is the existing rev2 probe.)
4. `buildCertifiedClaudeEnv(process.env, canonicalDir)`; `envDigest`.
5. For `authContext` stop here and return the context (`identityReference` empty until a status
   records it).
6. `probe.status(context, signal)`: the only settings-reading child of certification and the
   classification read (D13; residual R-1). Require signed-in, matching normalized directory,
   `claude.ai`, `firstParty`, `apiKeySource` absent or `'none'`, and identity reference equal to
   the profile's stored `identity_ref` (else `identity-mismatch`).
   6b. Revision 4: require `accountClass === 'P'` from the parser. Class O refuses
   `unsupported-source` (Decision D-S). The launch records `accountClass:'personal'`.
7. After the status child closes, re-read the three S9 signals (`lstat`); present refuses
   `unsupported-source`. (Revision 4: a refusal signal only; absence proves nothing.)
8. Revalidate the route (`revalidateProviderAccountRoute`, `route-changed`).
Returns `{ ok: true, launch }` or `{ ok: false, code, terminated }`; `terminated` is false when any
owned child's close was not observed (registry probe children included), which drives retain.

Tests in `claude-route-certifier.spec.ts` (fake probe object, fake `fs`, platform injected):
- order: coverage, scan, executable, env, status, class, signal re-check, revalidate;
- coverage refusal on `darwin`, `linux` and win32 version `2.1.311`: `probe.status`,
  `probe.logout` and `probe.certifyExecutable` mocks are never called (darwin/linux) and `status`
  is never called (version; the scan ran first because the version was unknown, see the ordering
  note in Component 4);
- unresolved managed source with a status mock that would succeed (drop-in file with
  `apiKeyHelper`; registry `HKLM` present; remote signal present): `unsupported-source`, and the
  `status` mock is never invoked;
- ancestor ambiguity (`cwd` below a `.git` ancestor with `settings.local.json`): refused before
  `status`;
- class (revision 4): a status mock returning class O (`team`, `enterprise`, missing
  `subscriptionType`, `allowedProviders` present) gives `unsupported-source`, no launch,
  `terminated:true` with all probe children closed; class P with every S9 signal absent gives
  `ok` and `launch.accountClass === 'personal'`. No case asserts file absence as proof;
- remote signal appearing after a successful status close (fake `lstat` flips): `unsupported-source`;
- `checkLaunch` (revision 4): unchanged sources give `ok`; a drop-in file with `apiKeyHelper`
  added after certification gives `unsupported-source`; a remote signal added gives
  `unsupported-source`; fingerprint mtime changed gives `identity-unproved` with
  `probe.certifyExecutable` never called; `knownVersion` outside the entry is refused with no
  `fs`/registry call; a `reg.exe` timeout gives `terminated:false`; `probe.status` is never
  called by `checkLaunch`;
- N accounts (revision 4): three profiles certified in one test give three launches with distinct
  `canonicalDir`, `env.CLAUDE_CONFIG_DIR` and `envDigest`; a class O third profile refuses and
  the other two launches are unaffected;
- `terminated` propagation and identity mismatch (rev2 cases).

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
      `CLAUDE_CONFIG_DIR`), `<canonicalDir>/.claude/*` and the machine sources. Revision 3
      narrows the claim: these equal the sources of coverage entry `win32@2.1.310` (S1-S12) only
      when the user's terminal runs that same executable and version on win32. The script names
      the certified executable path, but Ptah cannot observe the user's terminal, and any source
      Ptah does not control in that terminal (for example a remote fetch after the user signs in)
      is not proved before the user runs it. So the script is offered only after `authContext`
      succeeded (steps 1-4 passed, so coverage held at that moment), and nothing from the user's
      run is trusted: completion is decided only by Ptah's own status polls, each preceded by
      `checkCoverage` (Component 6). A `.claude/settings.json` in the user's current workspace is
      not loaded because of the change-directory step.
      Revision 4: the account class is unknown until the first status after sign-in. The console
      and the fallback are the user's own sign-in (D5) and start no Ptah model run; the class
      decides named runs only (Component 4a step 6b). The remote fetch after sign-in mentioned
      above is no longer "covered" by S9 files (D-Q revised): for class P it is DA-1, and class O
      runs refuse.
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

- Auth-operation context: `certifier.authContext` (Component 4a steps 1-5, `cwd = canonicalDir`).
  The CLI loads its default sources; coverage entry S1-S12 covers them for that cwd (Component 4).
  Revision 3: `certifier.checkCoverage(context)` runs immediately before every settings-reading
  child this service starts: the login console, each status poll, `readStatus`, logout and the
  status after logout. A coverage refusal starts no child. It is a terminal failure
  (`unsupported-source`) of the reserved operation and goes through the common completion gate
  below (with no owned child, `allClosed()` is true, so the reservation is settled). After each
  owned status or logout child closes, S9 is re-checked; present → the same terminal failure.
  Revision 4: S9 here is the signal check only. Auth actions (sign-in, status, sign-out) stay
  available for class O profiles, so the user can see such an account and sign out of it; the
  class gates named runs only (D-S). A status that reports class O completes sign-in as
  `signed-in`; the account's first named run refuses `unsupported-source`.
  Tests in `provider-account-actions.service.spec.ts` (B8) use a certifier fake whose
  `authContext`/`checkCoverage` refuse: the `commands.status` and `commands.logout` spies and the
  `ClaudeLoginConsole.launch` fake record zero calls for sign-in, `readStatus` and sign-out, and
  a refusal between two polls stops polling with no further `status` call.
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
  - Register `ClaudeRouteCertifier` (factory with `ClaudeAccountCommand`, `process.platform` and
    `node:fs/promises` `readFile`, `lstat`, `readdir`) and `ClaudeLoginConsole` (factory with `SDK_PROCESS_SPAWNER` and
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
- Revision 4 (finding 2): it also implements `checkLaunchBoundary(route, launch, boundary, signal)`:
  first the `assertRouteCurrent` semantics (revalidation plus epoch; failure gives `route-changed`,
  certifier not called), then `ClaudeRouteCertifier.checkLaunch(launch, signal)` (class token
  registered in B8), returning that outcome unchanged. The constructor gains the certifier. It
  keeps no per-run state, so N concurrent runs on N routes each check their own `launch`; nothing
  is shared between routes. Spec (B9): ok; certifier refusal passes `code` and `terminated`
  through; revalidation failure gives `route-changed` with the certifier mock never called.
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
  - Boundary checks (revision 4, finding 2). `NamedAccountPersistencePort`
    (`session-query-executor.service.ts:559-568`) gains
    `checkLaunchBoundary(route, launch, boundary: ClaudeLaunchBoundary, signal): Promise<ClaudeLaunchBoundaryOutcome>`
    (types from B1). The executor awaits it through `this.wait(...)` at two places, before the
    child exists: bootstrap, after `assertRouteCurrent` (`:694`) and before `invokeNamedQuery`
    (`:697`); final, at the top of `launch()` before `invokeNamedQuery` (`:722`), where today
    nothing persistence-side runs (`:721-722`). `ok:false` throws `namedAccountRefusal(code)`, the
    query factory is not called for that child, and `dispose()` settles the lease once: release
    when every owned child (the closed bootstrap child, the boundary's `reg.exe` probes) is proved
    closed, retain when `terminated` is false. No post-child S9 check runs for SDK children: the
    bootstrap child's effect is covered by the final boundary check, and after the final child
    the next admission's scan refuses (S9 files are refusal signals only).
  - Tripwire: `namedIdentity` (`:700`, `:783`) also requires `tokenSource === 'claude.ai'`,
    `apiKeySource` absent or `'none'` and `subscriptionType` in `CLAUDE_PERSONAL_SUBSCRIPTIONS`
    (Component 4, defense in depth) before the gate opens; a mismatch refuses
    `identity-unproved`.
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
  - Boundary checks (revision 4, finding 2): `ClaudeLaneAccountPersistence`
    (`claude-sdk-lane-runner.ts:242-269`) gains the same `checkLaunchBoundary` member. The runner
    awaits it in `bootstrap()` before `this.open(...)` (`:444`) and in `launch()` before
    `this.open(...)` (`:494`). `ok:false` refuses with `claudeLaneRefusal(code)`, `queryFn` is not
    called and no task text is sent; the lane settles release or retain from `terminated` and the
    bootstrap child's close proof, once. `assertRouteCurrent` in `readIdentity` (`:401`) stays.
    `readIdentity` (`:398-415`) applies the same tripwire as the executor.
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
| Registry: absent, absent-parent, present, access-denied, generic failure, timeout, malformed; HKLM/HKCU request vs HKEY_* output normalization; no output leak | `claude-auth-settings-scan.spec.ts` (C) | B5 |
| Coverage: darwin/linux/uncovered version refuse with no `fs`/registry call; drop-in, remote cache, ancestor `.git` + `settings.local.json`, `enabledPlugins` refuse; benign drop-in and home `.claude/settings.json` pass | `claude-auth-settings-scan.spec.ts` (C) | B5 |
| Flag settings tier with an override refused at the final boundary | `claude-certified-launch.spec.ts` (C); `session-query-executor.accounts.spec.ts` | B3; B13 |
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
| Certifier: order (coverage, scan, executable, env, status, remote re-check, revalidate), `terminated` propagation, identity mismatch | `claude-route-certifier.spec.ts` (C) | B6 |
| Certifier coverage refusal: unresolved managed source (drop-in, registry, remote cache) and ancestor ambiguity with a status mock that would succeed: `unsupported-source`, `status` mock never invoked; darwin/linux: no probe call | `claude-route-certifier.spec.ts` (C) | B6 |
| Actions coverage refusal: zero `status`/`logout`/console calls for sign-in, `readStatus`, sign-out; refusal between polls stops polling | `provider-account-actions.service.spec.ts` | B8 |
| Account class from status: `pro`/`max` with or without `orgId` give P; `team`/`enterprise`/`null`/missing/unknown word, `forcedLoginMethod`, `allowedProviders`, `apiKeySource`, unknown key give O; no raw value leaks | `claude-account-status.spec.ts` (C) | B5 |
| Certifier: class O refused after status with `unsupported-source` and no launch; class P certifies with signals absent | `claude-route-certifier.spec.ts` (C) | B6 |
| `checkLaunch`: source added after certification, remote signal, fingerprint change (no `--version`), known uncovered version (no fs/registry call) | `claude-route-certifier.spec.ts` (C) | B6 |
| Version cache: same fingerprint reuses; in-place update (mtime change) re-probes; stat error refuses | `provider-account-auth-env.spec.ts` (command spec) | B8 |
| Boundary adapter: ok, certifier refusal pass-through, revalidation first | `claude-named-account-persistence.spec.ts` (C) | B9 |
| A-S12: `managedSettings` or `extraArgs['managed-settings']` refused in both modes; `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` dropped; `forceLoginOrgUUID` is an override | `claude-certified-launch.spec.ts` (C) | B3 |
| A-S12: named main-chat options carry no `managedSettings` key and no `managed-settings` extra arg | `claude-account-route-env.spec.ts` | B13 |
| A-S12: named lane options carry no `managedSettings` key and no `managed-settings` extra arg | `claude-cli.adapter.spec.ts` | B12 |
| Main-chat boundary: a source changes after certification (fake `checkLaunchBoundary` refuses at bootstrap) and between bootstrap and final (ok, then refuses): `unsupported-source`, query factory not called for that child, lease released once when all closed, retained when `terminated:false` | `session-query-executor.accounts.spec.ts` | B13 |
| Lane boundary: the same two cases: `unsupported-source`, no `queryFn` call, task text never sent, release once or retain | `claude-sdk-lane-runner.spec.ts` | B12 |
| Tripwire: `accountInfo()` with `tokenSource` other than `claude.ai`, `apiKeySource:'apiKeyHelper'` or `subscriptionType:'team'` refused before the gate | `session-query-executor.accounts.spec.ts`; `claude-sdk-lane-runner.spec.ts` | B13; B12 |
| N accounts: three profiles; chat on A and lane on B hold live leases at once with distinct `CLAUDE_CONFIG_DIR` and digests; class O profile C refuses without touching A's or B's leases | `provider-account.store.spec.ts` (coexistence on three routes); `claude-route-certifier.spec.ts` (C) | B8; B6 |
| Copy pins (D-D): command COPY, RPC COPY, drawer, Accounts section, CLI, spawn-args | B8, B17, B20, B21, B19, B18 specs; final grep audit | B22 |
| Ambient pins unchanged | the rev1 list (Ambient-path non-regression) | every batch |

## Integration architecture

- Sign-in: UI → `provider:startAccountSignIn` → handler → actions → `reserveAuth` → certifier
  (coverage, scan for canonical cwd, executable, env) → `checkCoverage` → console or fallback →
  poll (`checkCoverage` before each status) → common completion
  gate → `completeAuth` → `onStateChanged` → `notify`.
- Main chat: chat RPC → router precedence → chat session → executor → `admitClaudeRoute` (lease,
  then certify, class included) → `checkLaunchBoundary` → bootstrap (bootstrap check) → identity
  and tripwire → `checkLaunchBoundary` → final (final check) → init version and source → `commitRunBinding` → attach → save → gate → termination → release once, or retain.
- Lane: MCP/RPC → validator → manager precedence → adapter `prepareNamed` → admission → lane
  owner checks (`checkLaunchBoundary` before the bootstrap and the final child; tripwire) → task
  text → close → release once.
- N accounts at once (revision 4): each profile is its own route (own `canonicalDir`, env, digest
  and lease row). The store keeps one lease per run (`run_id` UNIQUE) and leases on different
  routes coexist (Component 7 store tests), so the main chat on account A and a lane on account B
  run at the same time. Nothing in the certifier, launch context or adapter is keyed to two
  accounts; the profile table has no count cap (`0058_provider_accounts.ts` has no limit clause).
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

Unchanged from rev1: E2 (before named runs), E5 (Credential Manager mapping procedure), E1 (console
behaviour), E3 (signed-in keys), E6 (runtime references). Requirement 8 steps 1-8 run as written.
A failure or "unresolved" keeps the task open.

E4 (revision 4; read-only, user-operated, no settings change, no login beyond Requirement 8):
- `claude --version` on the live machine equals a covered version (`2.1.310`). If not, record it;
  every named context refuses `unsupported-source` until a coverage row is added (D-P).
- Yes/no per coverage source S5, S6, S7 and the three S9 signals on that machine, and whether the
  canonical profile directory has a `.git` ancestor (S4).
- Class P on each of the user's personal accounts (two or more), after each sign-in (Requirement
  8), from Ptah's own sanitized status result, recording booleans and one word only (never an
  email, org name or id): `authMethod` is `claude.ai`; `apiProvider` is `firstParty`; the
  `subscriptionType` word (`pro` or `max` expected); `forcedLoginMethod` and `allowedProviders`
  absent; `apiKeySource` absent; `orgId` non-null yes/no (A-C2); certified as class P yes/no.
- On the first named main-chat run and the first named lane run: `accountInfo()` `tokenSource` is
  `claude.ai`, `apiKeySource` absent, and the `subscriptionType` word (A-T1). The main chat on one
  account and a lane on the other run at the same time once (N-accounts check).
- An expected class P that shows class O, or a word outside `pro`/`max`, is recorded and reported.
  Only `CLAUDE_PERSONAL_SUBSCRIPTIONS` data changes, after a decision; nothing is worked around.
  The S9 files are recorded. Their absence no longer decides remote eligibility (D-Q revised);
  their presence or unreadability still refuses `unsupported-source` (D14 note 3).
- Any certification refusal `unsupported-source` during Requirement 8 is recorded with the source
  number (never a path or value).

## Architecture-level quality requirements

- Functional: Requirements 1-7 by the specs in the regression table; Requirement 8 live.
- Performance: per named admission, one coverage scan (at most 4 registry queries, 2 typical; up
  to 3 + 32 file reads; at most 64 ancestor pairs of `lstat`; 3 S9 `lstat`), one version probe
  (reused when the stat fingerprint is unchanged: one `stat`), one status child and one S9 re-read
  after it. Revision 4: each named run adds two awaited `checkLaunchBoundary` calls (bootstrap and
  final, for the main chat and for a lane), each one scan with the same bounds plus one `stat`
  and no Claude child. A named run start therefore does at most three scans and at most 12
  `reg.exe` queries (5 s limit each), all before its child starts; this adds latency to named
  starts only. Each sign-in poll tick repeats the scan before its status child (2 s spacing,
  300 s deadline). Ambient adds nothing.
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
| B1 | M `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; M `.../auth-providers-tokens/src/lib/tokens.ts`; M `.../auth-providers-tokens/src/index.ts`; M `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`; M `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` | `@ptah-extension/auth-providers-tokens,@ptah-extension/shared` | none (additive optional types; the shared union becomes a superset of the manager union, which assigns safely; rev4: `accountClass`, `executable.fingerprint`, `remoteSignals`, `ClaudeLaunchBoundary` and `ClaudeLaunchBoundaryOutcome` are additive and have no implementer yet) | none |
| B2 | M `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`; M `libs/shared/src/lib/types/execution/node.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`; M `.../handlers/chat-rpc.schema.spec.ts` | `@ptah-extension/shared,@ptah-extension/rpc-handlers` | `chat-rpc.handlers.spec.ts` (requests without the field) | none |
| B3 | C `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts` (rev3: also `claudeSettingsOverride` and the final-mode `flagSettings` check; rev4: `forceLoginOrgUUID`, the `managedSettings`/`managed-settings` refusal in both modes, `CLAUDE_PERSONAL_SUBSCRIPTIONS`); C `.../helpers/claude-certified-launch.spec.ts`; C `.../helpers/claude-identity-reference.ts`; C `.../helpers/claude-identity-reference.spec.ts`; M `.../helpers/index.ts`; M `libs/backend/agent-sdk/src/index.ts` | `@ptah-extension/agent-sdk` | `__contracts__/deleted-exports.contract.spec.ts` (new names only) | none |
| B4 | M `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`; M `.../helpers/off-thread-process-spawner-source.ts`; M `.../helpers/spawn-worker-pool.ts`; M `.../helpers/off-thread-process-spawner.spec.ts` | `@ptah-extension/platform-core,@ptah-extension/agent-sdk` | `spawn-worker-pool.spec.ts`, `off-thread-process-spawner.perf.spec.ts`, `detector/windows-hide-spawn.guard.spec.ts` (unchanged, must pass) | none |
| B5 | C `libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts` (rev4: account class); C `.../claude-account-status.spec.ts` (rev4: class P/O fixtures); C `.../claude-auth-settings-scan.ts` (rev3: `CLAUDE_POLICY_COVERAGE`, S1-S12, hive normalization); C `.../claude-auth-settings-scan.spec.ts` (rev3: coverage, unknown-source, remote, ancestor and normalization fixtures; rev4: `knownVersion` ordering fixture, remote signals only) | `@ptah-extension/auth-providers` | none (new modules; imports `claudeSettingsOverride`, `isCertifiedClaudeEnvKey` and `CLAUDE_PERSONAL_SUBSCRIPTIONS` from B3) | none |
| B6 | C `.../accounts/claude-login-console.ts`; C `.../claude-login-console.spec.ts`; C `.../claude-route-certifier.ts` (declares the `ClaudeCliProbe` interface; Component 4a steps 1-8 with 6b, `authContext`, `checkCoverage`, `checkLaunch`; constructor `(probe, platform, fs)`, no token, no registration); C `.../claude-route-certifier.spec.ts` (rev3: coverage refusal with a succeeding status mock never invoked, ancestor ambiguity, remote re-check; rev4: class O refusal after status, `checkLaunch` cases, three-profile case) | `@ptah-extension/auth-providers` | none (unregistered classes; imports B3, B4, B5; B8 implements the probe and registers the factory) | none |
| B7 (22) | C `libs/backend/persistence-sqlite/src/lib/migrations/0060_provider_account_lease_epoch.ts`; C `.../0060_provider_account_lease_epoch.spec.ts`; M `.../migrations/index.ts`; M head-version pins 59 → 60, one line each (plus the history comment where present) in `0028…, 0030…, 0038…, 0039…, 0040…, 0041…, 0042…, 0043…, 0044…, 0045…, 0046…, 0047…, 0051…, 0052…, 0053…, 0054…, 0055…, 0056…, 0059_provider_account_session_links.spec.ts`. Work packages (rev3 note): WP-a the three substantive files (0060 migration, its spec, `index.ts`); WP-b pins 0028, 0030, 0038, 0039, 0040, 0041; WP-c pins 0042, 0043, 0044, 0045, 0046, 0047; WP-d pins 0051, 0052, 0053, 0054, 0055, 0056; WP-e pin 0059. One commit and one scoped verify after WP-e | `@ptah-extension/persistence-sqlite` | the 19 pins; `migration-runner.spec.ts:726,756` (uses the last entry, unchanged). Account specs pick explicit versions (58/59), so they are unaffected until B8 | none |
| B8 (10) | WP-a: M `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`; M `.../provider-account.store.spec.ts`; M `.../provider-account.service.ts`; M `libs/backend/auth-providers/src/lib/di/register.ts`; M `.../di/register.spec.ts`; M `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts`. WP-b: R `.../accounts/claude-account-command.ts`; R `.../accounts/provider-account-auth-env.spec.ts` (becomes the command/process-owner spec); M `.../provider-account-actions.service.ts`; M `.../provider-account-actions.service.spec.ts` | `@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` | `store.spec:30,87,258-259,322-400,596-653`; `actions.spec:22,55-58,66,74,115,257,264-272`; `register.spec:116-131,170,184-186`; `activation.spec:330-347`; `auth-env.spec:4-86` (rev4: version-cache fingerprint fixtures; the store coexistence case grows to three routes). Specs add migration 60. Rev3: `actions.spec` gains the coverage-refusal cases (zero `status`/`logout`/console calls), file list unchanged | `register.spec.ts` (edited); host smokes `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts` and cli-engine `container-*.spec.ts` run unchanged |
| B9 | C `.../accounts/claude-named-account-persistence.ts` (rev4: `checkLaunchBoundary`; the constructor gains the certifier); C `.../claude-named-account-persistence.spec.ts` (rev4: boundary cases); M `libs/backend/auth-providers/src/index.ts` | `@ptah-extension/auth-providers` | `register.spec.ts:155-160` private-export list (unchanged, passes) | none (not registered) |
| B10 | M `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`; M `.../agent-monitor.store.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`; M `.../agent-card-header.component.spec.ts` | `@ptah-extension/chat-streaming,@ptah-extension/chat` | none beyond the edited specs (reads the existing `AgentProcessInfo.accountBinding`, `agent-process.types.ts:524`) | none |
| B11 | M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`; M `.../sdk-model-service.accounts.spec.ts`; M `.../plan-limits/session-quota-probe.accounts.spec.ts`; M `.../sdk-query-runner.service.ts` | `@ptah-extension/agent-sdk` | `sdk-model-service.spec.ts`, `sdk-query-runner.service.spec.ts` (ambient, unchanged) | none |
| B12 (7) | WP-a: M `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; M `.../claude/claude-sdk-lane-runner.ts`; M `.../claude/claude-sdk-lane-runner.spec.ts`; M `.../cli-agents/cli-adapters/claude-cli.adapter.ts`; M `.../cli-adapters/claude-cli.adapter.spec.ts`. WP-b: M `.../di/register.ts`; M `.../di/register.agent-process-manager.smoke.spec.ts` | `@ptah-extension/cli-agent-runtime,ptah-electron,ptah-cli` | rev4: the `ClaudeLaneAccountPersistence` member `checkLaunchBoundary`, its two awaited call sites and the tripwire land here; the only fakes of that interface are in `claude-sdk-lane-runner.spec.ts` and `claude-cli.adapter.spec.ts` (grep `assertRouteCurrent`, 2026-10-25), both in this batch; `lane-runner.spec:125-180,485,557`; `adapter.spec:230-238,589-891`; `smoke.spec:290-305,324-330,360-370`; `ptah-cli-registry.ts:743` (calls `buildClaudeSdkLaneOptions` ambient; registry specs unchanged); `session-spawner.accounts.spec.ts:57` and `account-binding.spec:191` (pass-through codes, unchanged) | `register.agent-process-manager.smoke.spec.ts` (edited); host smokes run |
| B13 | M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; M `.../helpers/claude-account-route-env.ts`; M `.../helpers/claude-account-route-env.spec.ts`; M `.../session-lifecycle/session-query-executor.service.ts`; M `.../session-lifecycle/session-query-executor.accounts.spec.ts` | `@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime` | `route-env.spec:316-336` (named via the builder); `executor.accounts.spec:77-392` (fixtures gain `launch`; HELD defaults; rev3: the executor passes the final options' `settings` as `flagSettings`, and one case with an override in the flag tier refuses before invoke; rev4: `NamedAccountPersistencePort.checkLaunchBoundary`, its two call sites and the tripwire, whose only port fake is in `session-query-executor.accounts.spec.ts`; the A-S12 builder pin is in `route-env.spec`); `sdk-query-options-builder*.spec.ts` (ambient, unchanged); cli-agent-runtime suites (no named caller left after B12) | none |
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
  - Revision 4: B9 implements `checkLaunchBoundary` before B12 and B13 add it to the two ports.
    A class may carry an extra member, so B9 compiles alone, and its types come from B1. The
    ports are checked against the class only at the B17 bindings (`satisfies
    ClaudeLaneAccountPersistence`), after B12 and B13. B12 and B13 add a required member whose
    only fakes are in specs they already edit.
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
- B22 production-copy audit (rev3 note: scoped to user-facing text and real producers), a grep
  over non-spec sources in `libs/` and `apps/`, read hit by hit:
  - must be empty in user-facing strings (COPY maps, templates, RPC/CLI messages, schema
    descriptions) and in producers (code that returns or assigns `'release-held'`): "release
    authorization", "awaiting release", "not available in this release", "not available yet",
    "release-held (D7)";
  - exempt: internal historical comments that no user sees and that produce nothing, for example
    `libs/shared/src/lib/types/agent-process.types.ts:334` ("spawn while named lane admission is
    release-held (D7), so the value that"). B22 records each exempt hit by file:line and stays
    "files: none"; it edits nothing;
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
- D-O (revised in rev3): registry absence is established positively, by parent enumeration, not
  by exit code or localized text, with hive names normalized before comparison. The source set is
  closed per coverage entry; there is no "unscanned but accepted" source. Reversible.
- D-P (rev3; serves R3.5, review round 2 finding 1): policy coverage is a closed table keyed by
  platform and exact CLI version. Options: (a) chosen, exact-version entries built from read-only
  binary inspection, everything else refuses `unsupported-source`; (b) a minimum-version rule
  that trusts later builds to read no new source. (b) loses because a later build can add a
  source (2.1.310 already has drop-ins, remote cache and the flag tier) and R3.5 requires refusal
  when precedence cannot be determined. Consequences, stated plainly: darwin and linux named
  accounts refuse until their entries are inspected; a CLI auto-update to an uncovered version
  refuses named contexts until a data-only row is added. The posix fallback dialect (Component 5)
  stays because D5 names it, and it becomes reachable as soon as a posix entry exists. Reversible
  (data only). Evidence: the binary strings in Component 4.
- D-Q (revised in rev4, D13): the rev3 rule "cache and consent files absent means no remote
  policy" is withdrawn. The docs contradict it: the fetch does not block startup, so a missing
  file proves nothing (research-report-2.md:11,53). The three files stay a refusal signal only
  (present or unreadable refuses) at certification, before each auth-action child and at each
  run boundary. Remote applicability is decided by the account class (D-S) and DA-1. Reversible.
- D-R (rev3): Ptah-controlled channels (env allowlist, fixed argv, SDK options without
  managed-settings or plugin keys, flag tier scanned at the final boundary) are proved closed by
  construction and pinned by tests. A CLI channel outside those is an assumption (A-S12), not an
  accepted gap: a new channel found later removes the version from its entry. Revision 4: A-S12
  is proved (research-report-2.md:54). The channel is `Options.managedSettings` /
  `--managed-settings`, refused at both boundaries and pinned by builder tests (S12).
- D-S (revision 4; implements the user's decision D13, decisions.md:75-81): account
  classification.
  - Requirement: R3.5 (`task-description.md:235-240`) as written, no waiver; the user's goal of a
    main chat on one personal account and a lane on another, for N accounts.
  - Rule (class P): status `loggedIn:true`, `authMethod:'claude.ai'`, `apiProvider:'firstParty'`,
    `subscriptionType` exactly `pro` or `max`, no `forcedLoginMethod`, no `allowedProviders`,
    `apiKeySource` absent or `'none'`, only known keys. `orgId`/`orgName` are not signals (A-C2).
    Everything else is class O and refuses named runs with `unsupported-source`.
  - Evidence: the status builder and subscription comparisons in the installed 2.1.310 binary
    (Component 4, verified 2026-10-25); server-managed eligibility from the docs (DA-1, labelled
    documentation-based); A-S1 and A-S12 proved (research-report-2.md:52,54).
  - Code options: (a) chosen: reuse `unsupported-source`, which the task brief allows. Its copy
    "The account authentication source cannot be verified." (`claude-account-command.ts:11`,
    `provider-account-rpc.handlers.ts:107`) is accurate for class O, so no copy batch changes and
    the B22 audit is unchanged. (b) a new code `unsupported-account` with the copy "This account
    type is not supported for named runs yet.": rejected here because `PROVIDER_ACCOUNT_RESULT_CODES`
    (`libs/shared/src/lib/types/provider-account.types.ts:38-50`) feeds closed COPY maps
    (`claude-account-command.ts:6-26`, `provider-account-rpc.handlers.ts` COPY), so the union, both
    maps and their specs would have to move into B1 ahead of B8, a graph change for copy only.
    Reversible: the follow-up org-accounts task (D13, `claude doctor`, Option 2) can add it.
  - Rejected alternative: refuse when `orgId` is present (research-report-2.md:69). The CLI fills
    `orgId` from `organizationUuid` for every claude.ai login, so it would refuse the user's
    personal accounts.
  - Effect on existing code: parser, certifier, launch type and runtime tripwire only. Class O
    accounts can still sign in, show status and sign out.

# Batches - TASK_2026_719_4f64

Total tasks: 22 | Batches: 22 (B1-B22; B7, B8, B12 run as work packages) | Complete: 5/22 (B1-B4, B7)

Source: `implementation-plan.md` revision 4 (Gate 2 APPROVED, D14), "Team-leader handoff" manifest
(plan lines 1001-1082). The manifest is authoritative: each file appears in exactly one batch; no
batch was redesigned. Worktree for every read, edit, check and commit:
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts` (branch
`feat/claude-named-accounts`, base main `396f0135b`). Paths below are relative to that worktree
root; every executor prompt must expand them to absolute paths.

## Rules for every executor (repeat verbatim in every prompt)

1. Work only in `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. Never edit
   the main checkout.
2. No `process.cwd()` in code or tests. Temp dirs from `os.tmpdir()`. Platform is injected.
3. No `jest.spyOn` on module namespaces. Spy on instances, or inject fakes.
4. Register every new `@inject` token in the same batch that adds the injection (implementation
   before registration; no batch references a symbol, file, token or registration a later batch
   creates).
5. Before editing a changed member, list the existing specs that mock or pin it (grep), and name
   them in your report. Ambient-path pins (plan lines 943-953) must not change; if one must, stop
   and report.
6. Run `ptah_get_diagnostics` with `files` set to the files you changed only. Never an unscoped
   call.
7. No builds, `serve`, `dev`, `e2e` or `package` targets; no logins; no installs (never
   `npm ci` / `npm install` in the worktree: `node_modules` is a junction to the main checkout);
   no paid model calls; never a real `claude`, `conhost.exe` or `reg.exe` in tests (fake
   spawners, fake `queryRegistry`).
8. Never commit, push, stash or run any state-changing git command. The team-leader owns git.
   Do not edit `batches.md` or `task.md`.
9. At most 6 files per run; tool-call ceiling 45 per run. If a run would exceed either, stop and
   report what is left.
10. Electron first. Keep every host compiling; no TUI or VS Code feature work.
11. Real code only: no stubs, placeholders, TODO markers, empty bodies or mock data standing in
    for logic. Security: no secret, email, org name/id, path, URL or CLI text in logs, RPC,
    renderer or DB; argument arrays only; never mutate `process.env`.
12. Do not run `npm run verify`; the team-leader runs the batch's one scoped command. If you must
    check one spec, report it instead of running wide suites.
13. Report: each task's completion with evidence, the absolute path of every file created or
    modified, the specs that mock changed members, and how each listed risk was handled.

## Execution defaults (recorded decisions)

- Executor: Claude `backend-developer` / `frontend-developer` subagents per the plan handoff
  (plan line 1003). Subagent reason (applies to every batch): the user pinned Claude subagents
  for implementation and codex lanes for cross-side review in this task family (decisions.md D1
  Gate 0.1). Fallback order: other Claude subagent run (fresh) -> CLI lane with the same
  capability -> stop and report.
- Review family: implementer Claude, phase reviewer codex lane (no role, `workingDirectory` =
  worktree, reads `git diff <phase base>..HEAD`). Different family; no exception needed.
- Verify per batch, run by the team-leader from the worktree, foreground, output filtered:
  `npm run verify -- -t lint,test,typecheck -p <projects>`; confirm the header says
  "for N projects" with the N listed below.
- D-M work packages (D8): B7, B8, B12 are each one batch, one scoped verify and one commit. Each
  WP is one developer run (at most 6 files), run strictly in order; intermediate WPs are not
  expected to compile. The team-leader verifies once after the last WP.
- Execution order follows the plan (B1 ... B22) with one reorder inside the plan's free edges:
  B10 (no hard edge, plan line 1057) runs after B16 so each phase's combined diff is one
  contiguous commit range. Reversible; changes nothing in what ships.
- The task folder `.ptah/specs/TASK_2026_719_4f64/` is committed with B1 (it is tracked:
  `.gitignore:139 !.ptah/specs/**`).
- Commit subject convention: `feat(<scope>[,<scope>]): batch N - <description>`, at most 72
  chars, body lines at most 100 (wrap at 72), scopes from `.commitlintrc.json`.

## Phases

| Phase | Batches (execution order) | Phase review |
| --- | --- | --- |
| P1 Contracts and helpers | B1, B2, B3, B4 | code-logic + style (new public API: B1 exported types, B3 exports) |
| P2 Account core | B5, B6, B7, B8, B9 | code-logic + style (B9 new export from `auth-providers/src/index.ts`) |
| P3 Run paths | B11, B12, B13, B14, B15 | code-logic |
| P4 Entry points and UI | B16, B10, B17, B18, B19, B20, B21 | code-logic + visual (Electron, dark + light, before/after: drawer pending + fallback, Accounts section routing cells, lane card, session row; "before" from base `396f0135b`) |
| P5 Host check and copy audit | B22 | none (measurement only, no source files) |

Phase review is requested only after the phase's last batch commits; one fix round, then one
re-review scoped to the fix commits. Then senior-tester (Requirement 8 live test, E1-E6) after
Mode 3.

## Plan validation

Status: PASSED WITH RISKS

Producer/consumer checks done for this decomposition: every M path in the manifest exists on disk
at base `396f0135b`; every C path is absent (no "create" overwrites working code); the B7 pin list
matches exactly the 19 migration specs that pin version 59 (grep; 0057 and 0058 specs do not pin
the head); the B18 builder path is
`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`.
Review-level contract checks (port/adapter, boundary insertion points, fake ownership) were done
by the Gate 2 reviewer (implementation-plan-review.md citation spot-checks) and are not repeated.

Assumptions:

- A-C2 (`orgId` filled for every claude.ai login, not a class signal) — unverified; recorded by
  E4 live test; B5 fixtures pin `pro`/`max` with or without `orgId` as class P.
- A-T1 (`accountInfo().subscriptionType` words) — unverified; tripwire fails closed on unknown
  words (B12, B13); checked in E4.
- DA-1 (server-managed settings reach Team/Enterprise only) — documentation-based, accepted by
  D13; class O refuses (B5/B6).
- R-1 (the pre-classification status child is authorized) — accepted by D13; B6 order test pins
  status as the only settings-reading child.
- A-V (`--version` reads no auth setting) — unverified, existing probe; B6 runs coverage and scan
  before it.
- D-P: only `win32@2.1.310` is covered; darwin/linux and other versions refuse
  `unsupported-source`. E4 confirms the live CLI version before named runs.
- D14 note 3 (docs): E4 wording corrected in `implementation-plan.md` line 975-976: S9 absence no
  longer decides remote eligibility; presence or unreadability still refuses. No code effect.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| D14 note 1: injected fs contract lacks `stat` (plan 470-471, 711-712) while 483 requires it | MEDIUM | Task 6 adds `stat` (returns `{ size, mtimeMs }`) to the certifier's fs contract and every B6 fake; Task 8 passes `stat` from `node:fs/promises` in the `register.ts` factory |
| D14 note 2: class-O error precedence ambiguous (plan 501-506) | LOW | Task 6: parsed class O returns `unsupported-source` before the identity comparison; `identity-mismatch` only for a class-P identity/directory mismatch; certifier spec pins `apiKeySource:'apiKeyHelper'` and a non-`firstParty` provider next to `team`/`enterprise`. Task 5 parser spec keeps those inputs as class O |
| D-M batches have red intermediate WPs | MEDIUM | WPs run in order by one executor family; one verify after the last WP; no WP is committed alone |
| Known pre-existing lint error on main: `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15,28` would fail B20's `@ptah-extension/core` lint | MEDIUM | Task 20.0: before B20, the team-leader confirms whether main still fails that lint (shared Nx cache). If it does, the orchestrator decides (recommended: one separate `fix(core)` commit on this branch before B20 touching only that file); the batch is never committed on a red lint |
| B8 verify spans 6 projects incl. three host smokes (heavy) | LOW | One foreground run under the verify lock, output tailed; host smokes are pins, not edits |
| Named path opened before its checks exist | HIGH | Safety order kept (plan 1058-1062): main chat opens at B15 (persistence at B17), sign-in at B17, lanes at B18; B13 runs only after B11 and B12 |
| Ambient expectation drift | HIGH | Rule 5; every batch's verify runs the ambient pins; any change stops the batch |
| CLI auto-update to an uncovered version during live test | LOW | Data-only coverage row after a decision (D-P); never worked around |

Edge cases:

- Class O account can sign in, show status and sign out, but its named runs refuse — Tasks 5, 6, 8.
- Fingerprint change / stat error / in-place CLI update — Tasks 6 (`checkLaunch`), 8 (version cache).
- Unproved child close (retain vs release) — Tasks 6, 8, 12, 13.
- Source appears between bootstrap and final — Tasks 12, 13.
- Three profiles concurrently, class O third refuses without touching A/B — Tasks 6, 8.
- Cancellation during `commitRunBinding`; resume without a second binding/lease — Tasks 8, 12, 13, 15.
- Non-win32 console start returns `unavailable` -> fallback script — Tasks 4, 6, 8.
- Legacy inconsistent leases quarantined (D-N) — Tasks 7, 8.

---

## Batch 1: Contracts (auth-providers-tokens, shared) — COMPLETE (590bafbf1)

- Recommended executor: subagent backend-developer
- Execution mode: sequential
- Fallback order: fresh Claude subagent -> CLI lane same capability -> stop and report
- Subagent reason: user-pinned Claude implementers (D1 Gate 0.1)
- Review family: implementer Claude, reviewer codex (different)
- Tasks: 1 | Depends on: none
- Phase: P1 | Phase review: code-logic + style (due after B4)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers-tokens,@ptah-extension/shared` (N = 2)
- Commit also stages: `.ptah/specs/TASK_2026_719_4f64/` (task folder)
- Suggested subject: `feat(auth-providers-tokens,shared): batch 1 - named launch contracts`

### Task 1.1: Additive contract types and token — COMPLETE

- Files: M `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; M `libs/backend/auth-providers-tokens/src/lib/tokens.ts`; M `libs/backend/auth-providers-tokens/src/index.ts`; M `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`; M `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- Plan reference: implementation-plan.md:140-172 (Component 1), 1022
- Existing specs affected: none (additive optional types; shared union becomes a superset of the manager union)
- DI guard: none
- Implementation details: `ClaudeCertifiedLaunchContext` (incl. `accountClass:'personal'` closed literal, `executable.fingerprint {size,mtimeMs}`, `policy.remoteSignals:'absent'`), optional `launch` on `ClaudeAccountNamedResolvedResourceContext`, `workingDirectory?` on the admission request, `ClaudeAccountSelectionReader`, `ClaudeLaunchBoundary`, `ClaudeLaunchBoundaryOutcome`; token `SDK_PROVIDER_ACCOUNT_SELECTION_READER = Symbol.for('SdkProviderAccountSelectionReader')`; index exports; `fallback?` on `ProviderStartAccountSignInResult`; `'account_refused'` on `AgentContinueErrorCode`.
- Acceptance: all new types exported from `auth-providers-tokens/src/index.ts`; no implementer yet and nothing else changes; both projects typecheck; no new dependency edge.

## Batch 2: Chat RPC account selection schema — COMPLETE (2e4dfb615)

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B1 (order) | Phase: P1
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/rpc-handlers` (N = 2)

### Task 2.1: Optional `accountSelection` on start/continue/resume — COMPLETE

- Files: M `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`; M `libs/shared/src/lib/types/execution/node.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
- Plan reference: implementation-plan.md:167-172, 1023
- Existing specs affected: `chat-rpc.handlers.spec.ts` (requests without the field, must pass unchanged)
- DI guard: none
- Implementation details: reuse the existing `ProviderAccountSelection` schema; strict schemas reject bad shapes; `ChatSessionSummary.accountProfileId?: string` (`node.ts:223`).
- Acceptance: schema spec covers valid named/ambient selection, omitted field, and rejected malformed shapes on all three methods.

## Batch 3: Certified launch helpers (agent-sdk) — COMPLETE (0cdc66248; P1 fix ada51ea3b)

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B1 (hard) | Phase: P1
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/agent-sdk` (N = 1)

### Task 3.1: `claude-certified-launch` and `claude-identity-reference` — COMPLETE

- Files: C `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`; C `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts`; C `libs/backend/agent-sdk/src/lib/helpers/claude-identity-reference.ts`; C `libs/backend/agent-sdk/src/lib/helpers/claude-identity-reference.spec.ts`; M `libs/backend/agent-sdk/src/lib/helpers/index.ts`; M `libs/backend/agent-sdk/src/index.ts`
- Plan reference: implementation-plan.md:174-229 (Component 2), 1024; regression rows 879-881, 883, 887, 909
- Existing specs affected: `libs/backend/agent-sdk/src/__contracts__/deleted-exports.contract.spec.ts` (new names only)
- DI guard: none
- Implementation details: `CLAUDE_CERTIFIED_ENV_KEYS`, `isCertifiedClaudeEnvKey`, `buildCertifiedClaudeEnv`, `certifiedNamedEnv`, `assertCertifiedLaunch(...,'bootstrap'|'final')` incl. final-mode `flagSettings` check, `claudeSettingsOverride` (incl. `forceLoginOrgUUID`), `managedSettings` / `extraArgs['managed-settings']` refusal in both modes, `CLAUDE_PERSONAL_SUBSCRIPTIONS`, `ClaudeCertifiedLaunchRefusal`; `claudeIdentityReference(email, orgName)`. `claude-account-route-env.ts` is NOT touched (B13).
- Acceptance: env allowlist drops every selector, `CLAUDE*`/`ANTHROPIC*`/cloud prefixes and `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`/`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, keeps casing, NO_PROXY rule; drift (executable, digest, cwd, setting sources, run-policy) refused in both modes; two routes give different `CLAUDE_CONFIG_DIR` and no shared object; flag-tier override refused at final; identity formula equals executor and quota formulas.

## Batch 4: User console spawn mode — COMPLETE (9d1ccad35)

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: none (order after B3) | Phase: P1 (last; request P1 review after commit)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/platform-core,@ptah-extension/agent-sdk` (N = 2)

### Task 4.1: `ProcessSpawnRequest.userConsole` with `ignore` stdio — COMPLETE

- Files: M `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner-source.ts`; M `libs/backend/agent-sdk/src/lib/helpers/spawn-worker-pool.ts`; M `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`
- Plan reference: implementation-plan.md:540-550 (Component 5 spawner), 1025; regression row 884
- Existing specs affected (unchanged, must pass): `spawn-worker-pool.spec.ts`, `off-thread-process-spawner.perf.spec.ts`, `detector/windows-hide-spawn.guard.spec.ts`
- DI guard: none
- Implementation details: plan field `stdioMode: 'pipe'|'ignore'`; inline and worker paths use `['ignore','ignore','ignore']`; `windowsHide:false` stays an explicit key; non-win32 refuses with an `error` event and no child; `needsConsole` unchanged.
- Acceptance: inline and worker modes give null streams and `windowsHide:false`; non-win32 refuses; all pipe cases unchanged.

## Batch 5: Status parser and policy scan — IMPLEMENTED (verify running, not committed)

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B3 (hard) | Phase: P2
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers` (N = 1)

### Task 5.1: `claude-account-status` and `claude-auth-settings-scan` — IMPLEMENTED

- Files: C `libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-account-status.spec.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.spec.ts`
- Plan reference: implementation-plan.md:261-467 (Component 4), 1026; D-S (plan Decisions); regression rows 882, 885-886, 897
- Existing specs affected: none (new modules; imports `claudeSettingsOverride`, `isCertifiedClaudeEnvKey`, `CLAUDE_PERSONAL_SUBSCRIPTIONS` from B3)
- DI guard: none
- Validation notes (D14 note 2, parser side): the parser returns `accountClass`; `apiKeySource` other than absent/`'none'`, `apiProvider` other than `firstParty`, `forcedLoginMethod`, `allowedProviders`, `team`/`enterprise`/null/missing/unknown subscription and any unknown key all yield class O. `orgId`/`orgName` are not signals.
- Acceptance: class P for `pro`/`max` with or without `orgId`; class O cases as above; no raw value leaks; identity formula equals the quota resolver; `CLAUDE_POLICY_COVERAGE` win32@2.1.310 only; registry absent / absent-parent / present / access-denied / generic failure / timeout / malformed, hive normalization, no output leak; darwin/linux/uncovered version refuse with no fs/registry call; drop-in, remote cache, ancestor `.git` + `settings.local.json`, `enabledPlugins` refuse; benign drop-in and home `.claude/settings.json` pass; `knownVersion` ordering fixture; S9 files are refusal signals only (no case asserts absence as proof).

## Batch 6: Login console and route certifier — IMPLEMENTED (verify running, not committed)

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B4, B5 (hard) | Phase: P2
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers` (N = 1)

### Task 6.1: `ClaudeLoginConsole` and `ClaudeRouteCertifier` (unregistered) — IMPLEMENTED

- Files: C `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.spec.ts`
- Plan reference: implementation-plan.md:468-539 (Component 4a), 550-599 (console/fallback), 1027; regression rows 894-896, 898-899, 913
- Existing specs affected: none (unregistered; declares `ClaudeCliProbe`; no token, no registration)
- DI guard: none
- Validation notes:
  - D14 note 1: constructor `(probe, platform, fs)` with `fs: { readFile, lstat, readdir, stat }`; `stat` returns `{ size, mtimeMs }`; every fake in both specs implements `stat`. `checkLaunch` uses `fs.stat` for the fingerprint; stat error -> `identity-unproved`.
  - D14 note 2: after the status child, a parsed class O returns `unsupported-source` BEFORE the identity comparison; `identity-mismatch` only for a class-P identity or directory mismatch. Spec pins `apiKeySource:'apiKeyHelper'` and a non-`firstParty` provider as `unsupported-source` (not `identity-mismatch`) next to `team`/`enterprise`.
- Acceptance: order coverage, scan, executable, env, status, class, S9 re-check, revalidate; darwin/linux/2.1.311 coverage refusal with the listed probe mocks never called; unresolved managed source and ancestor ambiguity refuse before `status`; class O -> `unsupported-source`, no launch, `terminated:true`; class P -> `launch.accountClass === 'personal'`; S9 flip after status -> refuse; `checkLaunch` cases (unchanged ok, added drop-in, added remote signal, mtime change -> `identity-unproved` with no `certifyExecutable`, uncovered `knownVersion` no fs/registry call, `reg.exe` timeout -> `terminated:false`, never `probe.status`); three profiles give distinct dirs/digests and class O third leaves the others unaffected; fallback script: cwd first step aborting on failure, different-workspace `apiKeyHelper` never named, inherited selectors/values never emitted, quoting round-trip for both dialects, non-win32 `unavailable`.

## Batch 7: Migration 0060 lease epoch (D-M, 22 files) — COMPLETE (30318803b)

- Recommended executor: subagent backend-developer (one run per WP, in order) | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 (5 WPs) | Depends on: none (order after B6) | Phase: P2
- Verify once after WP-e: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/persistence-sqlite` (N = 1)
- One commit for all 22 files. Suggested subject: `feat(persistence-sqlite): batch 7 - lease epoch migration 0060`

### Task 7.1: Migration 0060 and head-version pins 59 -> 60 — COMPLETE

Migrations dir: `libs/backend/persistence-sqlite/src/lib/migrations/`.

- WP-a (3 substantive): C `0060_provider_account_lease_epoch.ts`; C `0060_provider_account_lease_epoch.spec.ts`; M `index.ts`
- WP-b (6 pins): M `0028_gateway_conversation_workspace_root.spec.ts`, `0030_skill_event_metrics.spec.ts`, `0038_gateway_message_turn_state.spec.ts`, `0039_reap_orphaned_queue_rows.spec.ts`, `0040_skill_candidate_workspace_root.spec.ts`, `0041_skill_md_migration_state.spec.ts`
- WP-c (6 pins): M `0042_db_integrity_check_state.spec.ts`, `0043_memory_retention.spec.ts`, `0044_memory_lifecycle.spec.ts`, `0045_skill_backlog_cleanup.spec.ts`, `0046_memory_merge_subject_index.spec.ts`, `0047_memory_retention_health.spec.ts`
- WP-d (6 pins): M `0051_skill_lifecycle.spec.ts`, `0052_memory_boot_scan_failures.spec.ts`, `0053_memory_boot_scan_failure_generation.spec.ts`, `0054_lane_outcome_records.spec.ts`, `0055_skill_invocation_run_id.spec.ts`, `0056_skill_nullable_grades.spec.ts`
- WP-e (1 pin): M `0059_provider_account_session_links.spec.ts`
- Plan reference: implementation-plan.md:659-686 (Component 7 migration), 1028; precedent commit `ea27188eb`; D-N
- Existing specs affected: the 19 pins (one line each, plus the history comment where present); `migration-runner.spec.ts:726,756` unchanged (uses last entry); account specs pick explicit 58/59 (unaffected until B8)
- DI guard: none
- Implementation details: bare static ALTERs as in `0055:16-25` (`auth_epoch`, `route_revision`, `lease_state` with CHECKs on leases; `identity_ref` on profiles); backfill from a consistent binding (same four-column predicate in both subqueries); quarantine inconsistent rows; nothing deleted.
- Acceptance: backfill cases (a)-(e): unbound ambient row stays 0/0 `live`; named row with consistent binding gets binding epoch/revision `live`; named row without consistent binding and ambient row with binding become `quarantined`; no row lost; head version 60; `identity_ref` NULL.

## Batch 8: Account core — store, service, command, actions, registration (D-M, 10 files) — PENDING

- Recommended executor: subagent backend-developer (WP-a then WP-b) | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 (2 WPs) | Depends on: B6, B7 (hard) | Phase: P2
- Verify once after WP-b: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` (N = 6)
- One commit for all 10 files.

### Task 8.1: Store API, service, registration, command rewrite, actions — PENDING

- WP-a (6): M `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`; M `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`; M `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`; M `libs/backend/auth-providers/src/lib/di/register.ts`; M `libs/backend/auth-providers/src/lib/di/register.spec.ts`; M `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts`
- WP-b (4): R `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`; R `libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts` (becomes the command/process-owner spec); M `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`; M `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`
- Plan reference: implementation-plan.md:230-260 (Component 3), 600-658 (Component 6), 686-742 (Component 7 store/service/register), 1029; regression rows 888, 890-893, 900-901, 906, 913
- Existing specs affected: `store.spec:30,87,258-259,322-400,596-653`; `actions.spec:22,55-58,66,74,115,257,264-272`; `register.spec:116-131,170,184-186`; `activation.spec:330-347`; `auth-env.spec:4-86`. Specs add migration 60.
- DI guard: `register.spec.ts` (edited); host smokes `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts` and cli-engine `container-*.spec.ts` run unchanged.
- Validation notes:
  - D14 note 1: the `ClaudeRouteCertifier` factory in `register.ts` passes `{ readFile, lstat, readdir, stat }` from `node:fs/promises`. The command's version cache keys on path + `stat` `{ size, mtimeMs }`.
  - Register in this batch every token the new constructors inject: `ClaudeRouteCertifier` (factory: `ClaudeAccountCommand`, `process.platform`, fs), `ClaudeLoginConsole` (factory: `SDK_PROCESS_SPAWNER`, `process.platform`), `SDK_PROVIDER_ACCOUNT_SELECTION_READER` (service when SQLite is registered, else `{ profileId: null }` reader via `isRegistered(SQLITE_CONNECTION)`). The persistence adapter is NOT registered here.
  - No-SQLite admission refuses `unavailable-storage` (was `release-held`); `release-held` COPY becomes "Named accounts are not available on this host."
- Acceptance: `acquireRunLease` / `commitRunBinding` / `held()` semantics; post-migration release/retain; pre-binding nonzero-epoch release; quarantine blocks; pre-commit settlement (closed release, unproved retain); resume without second binding/lease; three-route coexistence; `reg.exe` argv (absolute, `/reg:64`), 5 s kill, output bound, close proof; version cache (same fingerprint one spawn; mtime change re-probes; stat `ENOENT` -> `unsupported-store`); actions: coverage refusal makes zero `status`/`logout`/console calls for sign-in, `readStatus`, sign-out, refusal between polls stops polling; fallback-mode unproved child blocks `completeAuth` on success/cancel/deadline/disposal; console mode unclosed console blocks then late close allows; `fallback.script` returned; class O sign-in completes `signed-in`; no accessor exposes the console handle. Deleted members (`authorization`, `environment`, `execute`, `certifyClaudeAccountEnvironment`, old `parseClaudeAccountStatus`, `CLAUDE_ACCOUNT_SELECTOR_KEYS`) have no remaining references.

## Batch 9: Named account persistence adapter — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B8 (hard) | Phase: P2 (last; request P2 review after commit)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers` (N = 1)

### Task 9.1: `ClaudeNamedAccountPersistence` with `checkLaunchBoundary` — PENDING

- Files: C `libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.ts`; C `libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.spec.ts`; M `libs/backend/auth-providers/src/index.ts`
- Plan reference: implementation-plan.md:743-756 (Component 8), 1030; regression row 908
- Existing specs affected: `register.spec.ts:155-160` private-export list (unchanged, passes)
- DI guard: none (not registered; B17 binds it)
- Implementation details: implements `NamedAccountPersistencePort` and structurally `ClaudeLaneAccountPersistence` with no cli-agent-runtime import; constructor gains the certifier; `checkLaunchBoundary` = `assertRouteCurrent` semantics first, then `certifier.checkLaunch`, outcome unchanged; no per-run state.
- Acceptance: ok; certifier refusal passes `code` and `terminated` through; revalidation failure gives `route-changed` with the certifier mock never called.

## Batch 11: Model service and runner cleanup — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B3 (types), order after B9 | Phase: P3
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/agent-sdk` (N = 1)

### Task 11.1: `getSupportedModels(route, signal, launch?)`; runner field removal — PENDING

- Files: M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`; M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.accounts.spec.ts`; M `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.accounts.spec.ts`; M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
- Plan reference: implementation-plan.md:805-812 (Component 9 runner/model service), 1032; regression row 893
- Existing specs affected: `sdk-model-service.spec.ts`, `sdk-query-runner.service.spec.ts` (ambient, unchanged)
- DI guard: none
- Acceptance: named without `launch` returns `[]` and no query factory call; with `launch` the probe uses `certifiedNamedEnv`, `launch.cwd`, `launch.executable`; runner's unused `accountRoute` field and wrapper deleted; ambient env literal byte-identical.

## Batch 12: Claude CLI lane named run (D-M, 7 files) — PENDING

- Recommended executor: subagent backend-developer (WP-a then WP-b) | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 (2 WPs) | Depends on: B3, B9 (adapter shape), order after B11 | Phase: P3
- Verify once after WP-b: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime,ptah-electron,ptah-cli` (N = 3)
- One commit for all 7 files.

### Task 12.1: Lane options, runner boundaries, adapter, read-only bindings — PENDING

- WP-a (5): M `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; M `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`; M `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`; M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`; M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
- WP-b (2): M `libs/backend/cli-agent-runtime/src/lib/di/register.ts`; M `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`
- Plan reference: implementation-plan.md:814-833 (Component 10 B12), 1033; regression rows 880, 889, 891, 892, 910, 912, 913
- Existing specs affected: `lane-runner.spec:125-180,485,557`; `adapter.spec:230-238,589-891`; `smoke.spec:290-305,324-330,360-370`; `ptah-cli-registry.ts:743` (ambient caller, registry specs unchanged); `session-spawner.accounts.spec.ts:57`, `account-binding.spec:191` (pass-through codes, unchanged). Only fakes of `ClaudeLaneAccountPersistence` are in the two WP-a specs.
- DI guard: `register.agent-process-manager.smoke.spec.ts` (edited); host smokes run
- Acceptance: named without launch throws `identity-unproved`, no SDK call; bootstrap uses `assertCertifiedLaunch(...,'bootstrap')`; named final uses `launch.cwd` and `launch.settingSources`; `claudeLaneRefusal(code)` carries the real code; `checkLaunchBoundary` awaited before both `this.open(...)`; boundary refusal at bootstrap and between bootstrap and final -> `unsupported-source`, no `queryFn` call, no task text, release once or retain from `terminated`; tripwire (`tokenSource` not `claude.ai`, `apiKeySource:'apiKeyHelper'`, `subscriptionType:'team'`) refuses before the gate; drift refused before task text; resume without second binding/lease; cancellation during commit settled once; options carry no `managedSettings` key or `managed-settings` extra arg; read-only bindings return `unavailable-storage`; stale D7 comment updated.

## Batch 13: Main chat executor and options builder — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B11, B12 (hard) | Phase: P3
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime` (N = 2)

### Task 13.1: Certified named main-chat run with boundary checks — PENDING

- Files: M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; M `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts`; M `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts`; M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`; M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- Plan reference: implementation-plan.md:772-804 (Component 9 executor/builder/route-env), 1034; regression rows 880, 887, 890, 891, 892, 910, 911, 912
- Existing specs affected: `route-env.spec:316-336`; `executor.accounts.spec:77-392` (fixtures gain `launch`; HELD defaults); `sdk-query-options-builder*.spec.ts` (ambient, unchanged); cli-agent-runtime suites (no named caller left after B12). Only port fake of `NamedAccountPersistencePort` is in `session-query-executor.accounts.spec.ts`.
- DI guard: none
- Acceptance: missing launch refuses `identity-unproved` before bootstrap (factory never called); `certifiedNamedEnv` used; named branch of `applyClaudeAccountRouteEnv` throws `ClaudeCertifiedLaunchRefusal`, ambient early return unchanged; final passes the final options' `settings` as `flagSettings` and an override in the flag tier refuses before invoke; init requires `claude_code_version === launch.executable.version` and `apiKeySource` in `{'none','oauth'}`; `checkLaunchBoundary` awaited at bootstrap (after `assertRouteCurrent`, before `invokeNamedQuery`) and at the top of `launch()`; refusal -> no query for that child, lease released once when all closed, retained when `terminated:false`; tripwire refuses before the gate; `namedAccountRefusal` default `identity-unproved`; options carry no `managedSettings` / `managed-settings`; resume without second binding/lease; cancellation during commit settled once.

## Batch 14: Lane account precedence in AgentProcessManager — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B1 (token), B8 (token registered), order after B13 | Phase: P3
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime,ptah-electron` (N = 2)

### Task 14.1: Optional selection reader and Claude precedence — PENDING

- Files: M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`; M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts`
- Plan reference: implementation-plan.md:834-845 (Component 10 B14), 1035; regression row 890 (lane precedence)
- Existing specs affected: the 7 other `new AgentProcessManager(` specs (optional trailing param, unchanged)
- DI guard: `register.agent-process-manager.smoke.spec.ts` and Electron smoke run unchanged
- Acceptance: trailing `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER, { isOptional: true })`; explicit named -> admission request with `workingDirectory`; explicit ambient -> today's path; omitted -> `readStoredSelection(workspaceRoot, 'lane')`; no reader -> ambient; reader error -> `unavailable-storage`; non-Claude CLIs unchanged.

## Batch 15: Main chat holds lifted (adapter, router, chat session) — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B13 (hard) | Phase: P3 (last; request P3 review after commit)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers` (N = 2)

### Task 15.1: Live-resume and slash-command holds replaced; router gate — PENDING

- Files: M `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`; M `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`; M `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`; C `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.accounts.spec.ts`; M `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`; M `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`
- Plan reference: implementation-plan.md:768-771, 812-813 (Component 9), 1036; regression rows 889, 888 (chat), 890 (main chat selection), live session row
- Existing specs affected: `chat-session.account-binding.spec:81-523` (HELD admission mocks become real outcomes); `chat-rpc.handlers.spec.ts` ambient
- DI guard: none
- Safety: main chat named path opens here; persistence is still null until B17 (`unavailable-storage`).
- Acceptance: omitted / same / conflicting / ambient selection on fresh and bound branches; live session omitted or same continues the owner's lease, different or ambient refuses `conflict`; live resume without second binding/lease; ambient resume and slash cases unchanged.

## Batch 16: Agent and session RPC handlers — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B12, B14 (hard) | Phase: P4 (first)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/rpc-handlers` (N = 1)

### Task 16.1: `account_refused` mapping and `accountProfileId` — PENDING

- Files: M `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:848-850 (Component 11 B16), 1037
- Existing specs affected: `session-rpc.handlers.spec:2746-2786,3051` (fixture codes, unchanged)
- DI guard: none
- Acceptance: `instanceof LaneAccountResumeError` maps to `account_refused` with fixed text; named resume selections forwarded for `claude`; `accountProfileId` from `metadata.accountBinding?.profileId`.

## Batch 10: Lane card account label — PENDING

- Recommended executor: subagent frontend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: none (runs after B16 by the recorded reorder) | Phase: P4
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat-streaming,@ptah-extension/chat` (N = 2)

### Task 10.1: U5 "Account: <label>" / "Default" / "Removed account" — PENDING

- Files: M `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`; M `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`; M `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.spec.ts`
- Plan reference: implementation-plan.md:861-874 (Component 12 U5), 1031
- Existing specs affected: none beyond the edited specs (reads existing `AgentProcessInfo.accountBinding`, `agent-process.types.ts:524`)
- DI guard: none
- Acceptance: running and finished lane cards show the label, "Default" for ambient, "Removed account" for a missing profile; existing card layout reused (no new surface).

## Batch 17: Provider account RPC and Electron wiring — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B8, B9 (hard) | Phase: P4
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode` (N = 3)

### Task 17.1: Actions port in the handler; Electron persistence bindings — PENDING

- Files: M `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`; M `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`; M `apps/ptah-electron/src/di/phase-2-libraries.ts`; M `apps/ptah-electron/src/di/container.smoke.spec.ts`
- Plan reference: implementation-plan.md:757-767 (Component 8 Electron), 851-855 (Component 11 B17), 1038
- Existing specs affected: `container.smoke.spec:307-334`; `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `rpc-allowlist.spec.ts` (unchanged)
- DI guard: `container.smoke.spec.ts` (edited); VS Code smoke runs
- Safety: Accounts sign-in opens here; main-chat persistence becomes active here.
- Acceptance: handler injects `SDK_PROVIDER_ACCOUNT_ACTIONS`; sign-in, cancel, sign-out call the actions port; `releaseHeld` deleted; `getAccountStatus` uses `actions.readStatus`; subscribes to `onStateChanged` and notifies the snapshot; COPY `release-held` neutral; `fallback` never logged. Electron, only when `SQLITE_CONNECTION` is registered: `registerSingleton(ClaudeNamedAccountPersistence)` and bind `SDK_NAMED_ACCOUNT_PERSISTENCE`, `SDK_SESSION_IMPORT_BINDING_LOOKUP`, `CLAUDE_LANE_ACCOUNT_PERSISTENCE` (`satisfies ClaudeLaneAccountPersistence`). Smoke: `SdkQueryRunner.accountPersistence` non-null; the three tokens and the selection reader resolve non-null; the handler resolves with the actions token. `expected-resolvable.ts` unchanged; VS Code/CLI/TUI keep null persistence.

## Batch 18: Agent spawn args allow named Claude — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B12, B14, B17 (hard) | Phase: P4
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/vscode-lm-tools` (N = 1)

### Task 18.1: Schema and namespace builder text — PENDING

- Files: M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-accounts.spec.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
- Plan reference: implementation-plan.md:856-857, 1039
- Existing specs affected: the three edited specs
- DI guard: none
- Safety: lanes open here.
- Acceptance: named selection allowed for `cli: 'claude'` only; new text at `:55`; builder text updated; copy pins (no "release" hold wording).

## Batch 19: CLI host copy — PENDING

- Recommended executor: subagent backend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: none (order) | Phase: P4
- Verify: `npm run verify -- -t lint,test,typecheck -p ptah-cli` (N = 1)

### Task 19.1: "named accounts are not available in the CLI host" — PENDING

- Files: M `apps/ptah-cli/src/cli/commands/agent-cli.ts`; M `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts`
- Plan reference: implementation-plan.md:858-859, 1040
- Existing specs affected: `agent-cli.spec:1225-1245`
- DI guard: none
- Acceptance: copy at `:690` changed; D7 comments at `:146,671` updated; behaviour unchanged (refused).

## Batch 20: Drawer pending and fallback — PENDING

- Recommended executor: subagent frontend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 2 | Depends on: B1 (hard) | Phase: P4
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/core,@ptah-extension/chat` (N = 2)

### Task 20.0: Pre-existing core lint baseline (team-leader, before the executor) — PENDING

- File: `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15,28` (not a task file)
- Action: confirm whether main still fails `@ptah-extension/core` lint there. If it does, report to the orchestrator with the recommendation of one separate minimal `fix(core)` commit before B20. B20 is not committed on a red lint.

### Task 20.1: U2 pending copy, U3 fallback block — PENDING

- Files: M `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`; M `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts`; M `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`; M `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts`
- Plan reference: implementation-plan.md:861-874 (U2, U3), 1041
- Existing specs affected: drawer spec HELD cases
- DI guard: none
- Acceptance: pending copy "Finish sign-in in the Claude window"; fallback block inside the existing drawer: read-only script, copy button, "Run it in a new terminal window", "Check status"; state service extracts `fallback` like `operationOf` (`:589-597`); `HELD_FALLBACK` neutral; no new surface.

## Batch 21: Accounts section and session row — PENDING

- Recommended executor: subagent frontend-developer | Mode: sequential | Fallback/Subagent reason/Review family: as B1
- Tasks: 1 | Depends on: B2 (`accountProfileId`), B16 | Phase: P4 (last; request P4 code-logic + visual review after commit)
- Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat` (N = 1)

### Task 21.1: U4 held note removed; U6 session "Account: <label>" / "Default" — PENDING

- Files: M `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts`; M `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts`; M `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts`; M `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.spec.ts`
- Plan reference: implementation-plan.md:861-874 (U4, U6), 1042
- Existing specs affected: `accounts-section.spec:28,114,235`
- DI guard: none
- Acceptance: `ACCOUNT_HELD_NOTE` (`:70-72`), the `routing-held` paragraph (`:251-258`) and `heldNote` (`:474`) deleted (copy removal, not a capability removal, D5/D41); session row shows label or "Default" for active and finished sessions.

## Batch 22: Host check and production-copy audit — PENDING

- Recommended executor: team-leader (no source files) | Mode: sequential
- Tasks: 1 | Depends on: all of B1-B21 | Phase: P5 | Phase review: none
- Verify: `npm run verify -- -t lint,test,typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` (N = 5)
- Commit: the audit record in this file (task-folder docs commit), so the batch carries a SHA.

### Task 22.1: Host suites and copy grep — PENDING

- Files: none (records results here)
- Plan reference: implementation-plan.md:1065-1082
- Acceptance: all host suites and smokes pass; grep over non-spec sources in `libs/` and `apps/` is empty in user-facing strings and producers for "release authorization", "awaiting release", "not available in this release", "not available yet", "release-held (D7)"; exempt historical comments recorded by file:line (e.g. `libs/shared/src/lib/types/agent-process.types.ts:334`); allowed hits only `provider-account.types.ts:52` union member, the two neutral COPY entries, drawer `HELD_FALLBACK`; Electron smoke resolves the four account tokens and runner persistence non-null; ambient pins, `rpc-allowlist`, `rpc-surface`, `surface-composition` unchanged.

## Batch verification (applies to every batch)

- Every listed artifact exists and contains the required work (team-leader reads the files).
- The batch's one scoped verify command passes with the stated N; output tailed, never pasted.
- No per-batch review; the phase review covers the batch in the combined diff.
- The edge cases and D14 notes mapped to the batch are addressed.
- `git status --short` / `git diff --name-only` checked; only batch files (plus the task folder in
  B1) staged by explicit path.

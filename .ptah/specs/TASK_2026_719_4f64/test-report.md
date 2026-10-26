# Test Report - TASK_2026_719_4f64 (acceptance coverage, part A; live plan, part B)

Branch `feat/claude-named-accounts`, worktree `claude-named-accounts`. Method: read task-description.md,
implementation-plan.md rev 4 regression table (`:875-920`) and listed the test titles of the committed specs
(`it(` lines). No spec outside the two files below was changed. Only the new/changed specs were run.

## Coverage

Paths are relative to `libs/backend/` unless stated. "L" = line of the `it(` title.

| Requirement / regression row | Test file:line | Status |
| --- | --- | --- |
| R1.1 certified named admit returns ok + reservation | `auth-providers/src/lib/accounts/claude-route-certifier.spec.ts:210`; `auth-providers/src/lib/accounts/provider-account.store.spec.ts:668`; `agent-sdk/.../session-query-executor.accounts.spec.ts:194` | covered |
| R1.2 no flag/env/setting switch | no spec. Source search done in this run: no `NAMED_ACCOUNTS_ENABLED`-style flag in `libs`/`apps` non-spec code | covered by search only (no automated guard) |
| R1.3 host without storage refuses typed; ambient unchanged | `rpc-handlers/src/lib/chat/session/chat-slash-command-router.accounts.spec.ts:101`; `auth-providers/src/lib/di/register.spec.ts:109-137`; `cli-agent-runtime/.../agent-process-manager.account-binding.spec.ts:685,692` | covered |
| R1.4 user copy no longer says "awaiting release" | `libs/frontend/chat/.../accounts-section.component.spec.ts:241`; `.../account-details-drawer.component.spec.ts:267`; production source search found no such copy | covered (see Defects D-1 for the remaining internal `release-held` code) |
| R2.1 login argv `['auth','login','--claudeai']`, both dirs, no foreign selector, no `--console` | `auth-providers/src/lib/accounts/claude-login-console.spec.ts:145` (exact-array equality, so `--console` cannot appear); `agent-sdk/.../claude-certified-launch.spec.ts:100-160` | covered |
| R2.2 login in user-only terminal, agent/MCP terminal tools cannot see it | superseded by D5: sign-in opens a separate OS console, Ptah never reads it. Console spawn pins: `agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts` (`userConsole`: ignore stdio, null streams) | covered by design (D5); no terminal-tool test is needed because no pty/terminal session exists |
| R2.3 console cannot start -> fallback script + Check status | `auth-providers/.../claude-login-console.spec.ts` (fallback script cases); `provider-account-actions.service.spec.ts:169`; drawer spec (fallback block, B20) | covered |
| R2.4 no credential/login URL in renderer/RPC/log/DB | `claude-account-status.spec.ts:189` (canary); `provider-account-actions.service.spec.ts:688` (secrets in dependency errors map to fixed sentences) | covered |
| R2.5 completion only by status polling, then end process tree | `provider-account-actions.service.spec.ts:169,182,203,228` | covered |
| R2.6 cancel ends tree, state `cancelled`, late success cannot overwrite | `provider-account-actions.service.spec.ts:189-194,216,663` | covered |
| R2.7 5 min deadline -> timeout, tree ended | `provider-account-actions.service.spec.ts:189,196,221` (`advance(300_000)`) | covered |
| R2.8 sign-out: `auth logout`, `signed-out` only after later status `loggedIn:false`; others unchanged | `provider-account-actions.service.spec.ts:349,361,620` | covered |
| R2.9 sign-in/out on active or unresolved lease -> `busy` | `provider-account-actions.service.spec.ts:203,267,346,651`; `provider-account.store.spec.ts:383` | covered |
| R2.10 status exit 1 + loggedIn:false = signed-out | `claude-account-status.spec.ts:46`; `provider-account-auth-env.spec.ts:267` | covered |
| R2.11 malformed/inconsistent/foreign status -> unsupported-source | `claude-account-status.spec.ts:54,61,69,76,81,140` | covered |
| R2.12 fixtures tagged by CLI version; signed-in, signed-out, foreign, inconsistent, Windows path normalization | `claude-account-status.spec.ts:46-100,170,175,181` | covered |
| R3.1 frozen certified env, selectors/CREDMAN removed | `agent-sdk/.../claude-certified-launch.spec.ts:100-159` | covered |
| R3.2 unknown/low/unreadable version refuses | `provider-account-auth-env.spec.ts:160-181`; `claude-route-certifier.spec.ts:255,266` | covered |
| R3.3 same executable/env/cwd/settings; different executable refused | `claude-certified-launch.spec.ts:344-345`; `claude-route-certifier.spec.ts:210,455` | covered |
| R3.4 runtime version missing/different closes run before prompt | `session-query-executor.accounts.spec.ts:317`; `cli-agent-runtime/.../claude-cli.adapter.spec.ts:608`; `claude-sdk-lane-runner.spec.ts:664` | covered |
| R3.5 auth override or undeterminable precedence refuses; no apiKeyHelper run | `claude-route-certifier.spec.ts:274-298,317`; `claude-auth-settings-scan.spec.ts` (registry/coverage cases) | covered |
| R3.6 identity reference derived once, same formula as `accountInfo()`, no raw values | `claude-account-status.spec.ts:149-189`; `agent-sdk/.../claude-identity-reference.spec.ts:17-46` | covered |
| R3.7 runtime identity read before prompt gate; missing/mismatch closes run | `session-query-executor.accounts.spec.ts:236,302,394,408,587`; `claude-sdk-lane-runner.spec.ts:730` | covered |
| R3.8 replaced/aliased directory -> `route-changed` | `claude-certified-launch.spec.ts:271,282`; `claude-account-route-env.spec.ts:214,261`; `claude-route-certifier.spec.ts:236` | covered |
| R3.9 selectors, sources, unknown version, runtime mismatch, other executable, identity missing/mismatch, two directories, **`process.env` not mutated** | all as above; two directories `claude-route-certifier.spec.ts:435`; `process.env` guard was missing | added (see Tests added, A) |
| R4.1 main chat uses stored/explicit named certified env; binding records profile + identity ref | `chat-session.account-binding.spec.ts:335,347`; `session-query-executor.accounts.spec.ts:194,222,428` | covered |
| R4.2 RPC `accountSelection` accepted; invalid rejected, no side effect | `chat-rpc.schema.spec.ts:365-434`; `chat-session.account-binding.spec.ts:702` | covered |
| R4.3 bound session: omitted/same continue, different refuses | `chat-session.account-binding.spec.ts:405,436,469`; `sdk-agent-adapter.spec.ts:4060,4071` | covered |
| R4.4 admission/certification failure: fixed safe message, typed code, no ambient retry | `chat-slash-command-router.accounts.spec.ts:222`; `chat-session.account-binding.spec.ts:361,512`; `session-query-executor.accounts.spec.ts:350,631` | covered |
| R4.5 API-key/third-party provider ignores stored `main` | `chat-slash-command-router.accounts.spec.ts:92`; `chat-session.account-binding.spec.ts:301` | covered |
| R4.6 ambient fresh turn unchanged | `chat-slash-command-router.accounts.spec.ts:84,196`; `chat-session.account-binding.spec.ts:282`; `session-query-executor.accounts.spec.ts:452` | covered |
| R4.7 precedence table rows (omitted+stored, omitted none, explicit ambient, explicit named, bound omitted, bound conflicting) | `chat-session.account-binding.spec.ts:282,335,347,376,405,469`; `chat-slash-command-router.accounts.spec.ts:134,182,208` | covered |
| R4.8 lease before preflight, transferred to query owner, held for the run | `session-query-executor.accounts.spec.ts:194,519`; `sdk-agent-adapter.spec.ts:4092` | covered |
| R4.9 lease released exactly once on normal end, startup failure, cancel, abort, timeout, disposal | normal end `session-query-executor.service.spec.ts:996`; startup failure `...accounts.spec.ts:350,358`; cancel/abort `:439,535,549`; disposal `:218` and `service.spec.ts:753`. No test is titled "timeout" for the named main chat; the 15 s bootstrap deadline (`session-query-executor.service.ts:693`) has no named-path timer test | partial (see Not checked N-2) |
| R4.10 unproved termination retains reservation | `session-query-executor.accounts.spec.ts:371,383,535,549` | covered |
| R4.11 sign-in/out `busy` on active chat lease | `provider-account-actions.service.spec.ts:651`; `provider-account.store.spec.ts:383` | covered |
| R4.12 Electron registers persistence + import-binding ports | `rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts`; `auth-providers/src/lib/di/register.spec.ts`; `apps/ptah-electron/src/di/container.smoke.spec.ts`; `cli-agent-runtime/.../register.agent-process-manager.smoke.spec.ts` | covered |
| R5.1 fresh lane with stored `lane` selection runs named | `agent-process-manager.account-binding.spec.ts:668` | covered |
| R5.2 explicit named lane via MCP HTTP/stdio/execute_code; other CLIs still refused | `vscode-lm-tools/.../agent-spawn-accounts.spec.ts:178,240,256,342`; `agent-spawn-args.schema.spec.ts`; `agent-spawn-surface-parity.spec.ts` | covered |
| R5.3 lane lease from before preflight to child close; released once | `claude-sdk-lane-runner.spec.ts:527,645,663,730`; `claude-cli.adapter.spec.ts` (named admission cases) | covered |
| R5.4 unproved child retains; sign-in/out `busy` | `claude-sdk-lane-runner.spec.ts` (retain cases, `:777`); `provider-account-actions.service.spec.ts:267` | covered |
| R5.5 bound lane continue/resume uses binding; conflicting refused; never ambient | `agent-process-manager.account-binding.spec.ts:704,238,222`; `agent-spawn-accounts.spec.ts:212,227` | covered |
| R5.6 `account_refused` code, `instanceof` | `rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts:415,428,452,472,795` | covered |
| R5.7 D39: `claude` handle capabilities match the handle | handle flags were pinned (`claude-cli.adapter.spec.ts:261-263`) but never compared with `adapter.capabilities()` | added |
| R5.8 chat on A and lane on B hold two leases, distinct `CLAUDE_CONFIG_DIR` | `provider-account.store.spec.ts:668`; `claude-route-certifier.spec.ts:435`; `claude-certified-launch.spec.ts` (two routes) | covered |
| R5.9 ambient lane unchanged | `agent-process-manager.account-binding.spec.ts:659,676,685,716`; `claude-cli.adapter.spec.ts` ambient cases | covered |
| R5.10 lane precedence cases | `agent-process-manager.account-binding.spec.ts:650-716`; `agent-spawn-accounts.spec.ts:227` | covered |
| R5.11 lane identity check before task text | `claude-sdk-lane-runner.spec.ts:730,663` | covered |
| R6.1 binding names profile + verified identity ref; failed check persists none | `provider-account.store.spec.ts` (binding cases); `session-query-executor.accounts.spec.ts:394,408`; `claude-sdk-lane-runner.spec.ts:730` | covered |
| R6.2 label or "Default" visible on lane and chat session | `agent-card-header.component.spec.ts`; `agent-monitor.store.spec.ts`; `session-list-row.component.spec.ts` (all under `libs/frontend`) | covered (rendering confirmed live in step 7 of the live plan) |
| R6.3 account info has no email/org/token/raw output | `claude-account-status.spec.ts:189`; `session-query-executor.accounts.spec.ts:631`; `claude-sdk-lane-runner.spec.ts:442` | covered |
| R7.1 ambient env/options unchanged | rev 4 ambient pin list (`claude-account-route-env.spec.ts`, `sdk-query-options-builder*.spec.ts`, ambient cases above) unchanged | covered |
| R7.2 host typecheck/tests | not run here (rule: no `npm run verify`) | not run |
| R7.3 non-Claude lanes unchanged | `agent-process-manager.account-binding.spec.ts:249,716`; `agent-spawn-accounts.spec.ts:256` | covered |
| R8 live test | part B below | pending, user-run |

Regression table rows (`implementation-plan.md:879-920`): every row has a committed spec. Rows 879-884,
888-919 were matched by title above (B3, B5, B6, B8, B9, B11-B15 specs listed in the table exist and contain
the named cases). Rows I did not open case by case: `0060_provider_account_lease_epoch.spec.ts` (890),
`off-thread-process-spawner.spec.ts` registry/user-console rows (885), `claude-auth-settings-scan.spec.ts`
registry rows (886-887), copy pins for CLI and spawn-args (919). They exist; titles were not re-verified one by one.

## Tests added

| File | Tests | Result |
| --- | --- | --- |
| `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.process-env.spec.ts` (new) | 1: R3.9 `process.env` and the source object are unchanged after building two route envs; foreign selector, CREDMAN and gateway keys stripped; two routes get distinct env objects, dirs and digests | `npx jest -c libs/backend/agent-sdk/jest.config.ts <spec> --maxWorkers=2 --coverage=false`: 1 passed, 0 failed |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts` (+1 test, `reports adapter capabilities that match the handle it returns (D39)`) | 1 added; suite total 61 | `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts <spec> --maxWorkers=2 --coverage=false`: 61 passed, 0 failed |

Both specs use no `process.cwd()` and no `jest.spyOn` on module namespaces. The new process-env spec restores every
`process.env` key it sets. The agent-sdk run printed only the usual "Failed to load the ES module jest.config.ts"
warning, then ran normally. Typecheck of the two files was not run separately.

## Defects

- D-1 (low, Requirement 1 criterion 4 wording): `release-held` is still produced by production paths as an internal
  catch-all refusal code: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:596,688,693,696,799,816,824,827,829,841,868`
  and `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:311,328` (default code). The user-facing
  sentence for it is neutral ("Named accounts are not available on this host.", `claude-account-command.ts:35`), and
  copy searches find no "awaiting release". If the criterion is read literally ("`release-held` no longer produced by any
  production path"), the code name still exists for abort/timeout/stream-end and foreign errors. Needs a production
  decision (rename to a neutral code or accept); not changed here.

## Live test plan (Requirement 8)

Run with the user, in Electron, Windows. The agent never types, sees or stores credentials, and reads only these
non-secret sources: (a) the Accounts section state label, (b) sanitized `auth status --json` results produced by
Ptah's own status action (booleans, `authMethod`, `apiProvider`, class word `pro`/`max`, normalized directory name;
never an email, org name or id), (c) these DB columns only, read from the Ptah SQLite file with a read-only query:
`provider_account_profiles` (`profile_id`, `label`, `state`, `identity_ref`, `route_fingerprint`),
`provider_account_run_bindings` (`run_id`, `profile_id`, `identity_kind`, `owner_key_hash`),
`provider_account_run_leases` (`run_id`, `profile_id`, `route_fingerprint`), `provider_account_session_links`
(`sdk_session_id`, `run_id`); (d) fixed-text log lines, which carry codes only (look for the refusal codes
`unsupported-source`, `identity-mismatch`, `identity-unproved`, `route-changed`, `busy`). The agent must never
select any other column, open any file under a profile directory, or read `%USERPROFILE%\.claude\.credentials.json`.

Common rule for "proof of own account without reading secrets": compare opaque values only.
Two references are equal or different, never decoded. Per run the proof is the chain
profile row (`identity_ref`) -> run binding (`profile_id`, `owner_key_hash`) -> session link (the chat or lane SDK
session) -> the UI label. Chat A and lane B must show different `profile_id`, different `route_fingerprint`, and
different `identity_ref`/`owner_key_hash`; each run's value must equal its own profile's step-4 value.

### E2 - pre-prompt identity proof (A2), before any named run

1. User: approve and run the E2 script (booleans and version only, no prompt) on the ambient login. Agent observes:
   the script output (booleans + version). Pass: the SDK `accountInfo()` before the first prompt is available
   (true) and reports a source and class; version printed. Fail/stop: any `false`; named runs stay refused at the
   15 s deadline (fail closed) and the task is not done.
2. Agent: record the sanitized ambient `auth status --json` (`loggedIn`, `authMethod`, `apiProvider`, directory,
   identity ref if signed in). Pass: recorded; this is the "ambient before" record used in steps 1 and 8.

### E1 - login console behaviour

1. User: in Accounts, add "Account 1" and "Account 2". Agent observes: two rows in `provider_account_profiles`,
   `state` signed-out, distinct `route_fingerprint`. Pass: two rows, two fingerprints.
2. User: click Sign in on Account 1. Agent observes: the drawer shows "Finish sign-in in the Claude window"
   (pending); a separate OS console window appears (the agent does not read its text). Pass: window opened, pending
   state shown, no login URL or code appears in the Ptah UI or logs.
3. User: complete the official login in the browser/console personally. Agent observes: state changes to
   "Signed in" after Ptah's own status poll (not on console text); the console process tree is ended (no leftover
   console after success). Pass: `state` = signed-in, console gone. Record the path taken (console or fallback) and
   whether the window needed manual closing. If the console cannot start: the fallback block (script, copy,
   "Run it in a new terminal window", "Check status") appears; user runs it themselves and clicks Check status;
   pass is the same signed-in state.
4. Repeat 2-3 for Account 2.
5. Optional negative check (user): start sign-in on Account 2 and Cancel. Pass: state `cancelled`, then returns to
   the true status; a late login does not flip the cancelled operation.

### E3 - signed-in status key set (names only)

1. Agent: for each profile trigger "Check status". Observe the sanitized result: `loggedIn:true`,
   `authMethod:'claude.ai'`, `apiProvider:'firstParty'`, normalized `configDirectory` equal to that profile's own
   directory (drive-letter case and slash style may differ). Pass: all four on both profiles.
2. User or agent with a parser debug view: report the signed-in JSON key names only (no values). Pass: every key is
   in the accepted set (required four + documented metadata). Any unknown key is recorded; if the parser returns
   `unsupported-source`, record and stop. Update the "source-derived" fixture label in `claude-account-status.spec.ts`
   with the real key set and CLI version.

### E4 - class P, coverage sources, version (read-only, user-operated)

1. User: run `claude --version`. Pass: equals `2.1.310`; otherwise record and stop (every named context refuses
   `unsupported-source`).
2. Agent records, per profile and from Ptah's sanitized status only: `authMethod` claude.ai, `apiProvider`
   firstParty, subscription word (`pro` or `max`), `forcedLoginMethod`, `allowedProviders`, `apiKeySource` absent,
   `orgId` non-null yes/no, certified as class P yes/no. Pass: both profiles class P with word `pro`/`max`.
   A class O result or another word is recorded and reported; no data is changed to work around it.
3. User answers yes/no for coverage sources S5, S6, S7 and the three S9 signals on the machine, and whether either
   profile directory has a `.git` ancestor (S4). Pass: no S9 signal present or unreadable, no S4 ancestor with
   `.claude/settings.local.json`.
4. During step 6 below, on the first named chat run and first named lane run, agent records `accountInfo()`
   `tokenSource` = `claude.ai`, `apiKeySource` absent and the subscription word (A-T1). Any refusal during the test is
   recorded as `unsupported-source` plus the source number, never a path or value.

### E5 - Credential Manager mapping (conditional)

1. Agent/architecture: establish which storage backend the installed CLI uses with the named env (file backend ->
   mark "not applicable"). Pass: backend named.
2. If Credential Manager is active: user lists the relevant target identifiers and non-secret modification times
   (`cmdkey /list` filtered for the Claude targets; identifiers only) before step 3, after step 3 and after step 8.
   Agent maps targets to profiles from the evidenced mapping, not by name substring. Pass: no two named profiles share
   a target; no ambient target changed, vanished or was reused by a named profile. If the backend or mapping cannot be
   established: record "unresolved", never "passed".

### E6 - runtime references equal status references

1. After steps 6-7, agent reads `provider_account_profiles.identity_ref` (step 4 value) per profile and
   `provider_account_run_bindings.owner_key_hash` for the chat run and the lane run. Pass: chat binding `profile_id`
   = Account 1 and its reference corresponds to Account 1's `identity_ref`; lane binding `profile_id` = Account 2 and
   corresponds to Account 2's; the two runtime references differ. (If the hash column is a one-way function of
   `identity_ref`, the check is equality of the two values computed by Ptah's own export, not decoding.)

### Requirement 8 main run (steps 1-8)

| Step | User does | Agent observes | Pass condition |
| --- | --- | --- | --- |
| 1 | Report only: if the reviewer needs it, check that `%USERPROFILE%\.claude\.credentials.json` exists/absent and its modification time | E2 step 2 ambient status record | Ambient state recorded and not changed; file result is "exists/absent" + mtime only |
| 2 | Add "Account 1", "Account 2" | profile rows (E1.1) | two signed-out rows |
| 3 | Sign in to each personally | state label, path taken (E1.2-4) | both "Signed in" |
| 4 | none | status per profile (E3), `identity_ref` per profile | both `loggedIn:true`, claude.ai, firstParty, own directory; the two refs differ |
| 5 | Set main chat -> Account 1, Claude lane -> Account 2; Haiku for both | selection rows in `provider_account_selections`; model setting | selections name the two profile ids; Haiku shown for both |
| 6 | Send one short chat message; ask the chat agent to spawn one Claude CLI lane with a short task | during the run: two rows in `provider_account_run_leases` (different `route_fingerprint`); no refusal code in logs | both runs complete; leases coexist while both run |
| 7 | Look at the session row and the lane card | UI label "Account: Account 1" on the chat session, "Account: Account 2" on the lane; run bindings (E6) | labels correct; binding `profile_id` per run correct; references equal the step 4 values and differ from each other. Optionally the user checks each account's own usage view |
| 8 | Sign out of Account 2 | Account 2 status `loggedIn:false`; Account 1 status still `loggedIn:true` with its step 4 ref; ambient status equals step 1 record; leases table has no rows left (or `busy` was seen if a run was still active) | all three conditions; user repeats the credentials-file check if step 1 used it and reports unchanged existence and mtime; E5 closing check if applicable |

After steps 6-8, agent confirms the leases table is empty (each lease released once) and that no run binding was
written for a run that failed the identity check. On any failure: record the step number and the safe code in this
file and do not report the task done.

## Not checked

- N-1: No part of the live flow ran (no login, no real `claude`, no paid call, no Electron launch), as required.
- N-2: R4.9 "timeout" exit for the named main chat has no test titled as such; abort and cancel share the signal path.
  If the 15 s bootstrap deadline (`session-query-executor.service.ts:693`) needs its own proof, it requires a fake-timer
  case in `session-query-executor.accounts.spec.ts`; I did not add it because the fixture there is large and the
  coverage-by-abort argument was judged acceptable. Flagged for the reviewer.
- N-3: `process.env` immutability was added for the agent-sdk env builder only. The auth-providers env builder
  (`claude-account-command.ts` / `provider-account-auth-env.spec.ts`) and the login console were not given an
  equivalent assertion; they receive injected environments.
- N-4: R1.2 has no automated guard; a source-search spec was not added because it would scan production files, which
  is foreign to this suite.
- N-5: Titles of the B4, B5, B7 and copy-pin specs were matched from the regression table, not re-read case by case.
- N-6: R7.2 (typecheck and tests for `ptah-electron`, `ptah-extension-vscode`, `ptah-cli`, `ptah-tui`) was not run;
  the rule for this job forbids `npm run verify`.

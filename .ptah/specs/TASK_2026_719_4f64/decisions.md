# Decisions — TASK_2026_719_4f64

## D1 — Pre-flight and Gate 0.1 (2026-10-25, orchestrator)

- Type FEATURE, depth Full (new behavior across auth-providers, agent-sdk, cli-agent-runtime, rpc-handlers, chat UI; live auth). `ptah_route_decide` not listed → rules.
- Flow: PM → researcher (Claude CLI login/config-dir behavior, A1-A3) → architect → team-leader → developers → QA → live test. No new UI surface planned; if the plan adds one, insert designer + Gate 1.7.
- Gate 0.1: lanes `enabled`, approval `lane-review`. Source: the user's current instruction for this task family ("Spawn Codex review lanes without a role so they can read the git diff") and the TASK_2026_712 practice (Claude subagents implement, codex reviews, D40). Memory has conflicting older preferences (one says never codex); the current instruction wins. Codex: installed, confirmed room (weekly 3%). Implementation: Claude subagents (≤6 files each). Cross-side reviews: codex lanes without a role.
- Inherited user decisions: D41 of TASK_2026_712 — lift D7 fully; start from main after merges (done: base 396f0135b includes #820).
- Never authorized here: entering credentials (the user signs in), paid probes beyond the user-approved Haiku live test, merges.

## D2 — Login handoff without a TTY (2026-10-25, orchestrator, evidence step)

- Question (task-description.md "Open questions"): how the user completes `claude auth login` when it needs a terminal.
- Evidence: research-report.md — the CLI binary contains Ink "Raw mode is not supported" text, so `auth login` likely needs a TTY; a plain pipe spawn (today's `execute('login')`) likely fails. Ptah Electron already ships `node-pty` terminals.
- Decision: run `claude auth login --claudeai` in a Ptah-owned `node-pty` session with the named profile's stripped env (`CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`), shown to the user so they complete the browser OAuth or paste a code personally; detect completion only by polling `claude auth status --json` (never read credential files). Fallback text shows the command and directory for the user's own terminal if the pty cannot start. Not user-reserved: no credential is seen by the agent, no outward action beyond the user's own login. Reversible.

## D3 — Gate 1 review round 1 (2026-10-25, orchestrator)

- Reviewer: codex lane (no role), cross-side to the Claude PM subagent. Verdict REVISE, 8 findings (1 Blocking, 4 Serious, 2 Moderate, 1 Minor) in `task-description-review.md`. All accepted; revise round 1 of 2 goes to a fresh PM subagent.
- Finding 1 resolution (refines D2): the login terminal is a **user-only authentication terminal** — a dedicated Electron node-pty session that shows only to the user. Scoped privacy exception: its bytes may cross the main→renderer terminal channel for display only; no agent tool, MCP terminal tool, capture, replay, persistence, log or telemetry can read it; it is not a normal Ptah terminal tab. Completion is detected only by sanitized `auth status --json` polling. Fallback: the user runs the shown command in their own terminal. Command is `['auth','login','--claudeai']` with `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` set. TTY need stays "unverified".
- Finding 6 resolution: no agent reads credential bytes. Isolation proof uses sanitized `auth status --json` results per profile and for ambient (recorded before and after), plus a user-operated existence/mtime check if needed.

## D4 — Gate 1 passed (2026-10-25, lane-review)

- task-description.md: author Claude PM subagent (draft + round 1), orchestrator (round 2 Credential Manager edit). Reviewer codex lane (no role), cross-side. Round 1: 8/8 fixed, 1 new Moderate; round 2: fixed. Final verdict APPROVED (`task-description-review.md`). No removals proposed. Gate 1 passes in `lane-review` mode without a user wait.
- Next: software-architect. If the plan adds or redesigns a UI surface (for example the user-only authentication terminal or a per-run account indicator), the orchestrator inserts designer + Gate 1.7 before team-leader.

## D5 — Architect findings: login window and UI scope (2026-10-25, orchestrator, evidence step)

- D2/D3 premise corrected: verified that no app/lib code imports `node-pty` (only `apps/ptah-cli/tests/e2e/_harness/pty-runner.ts`), and the only xterm package is `@xterm/headless` (root package.json). There is no in-app terminal to reuse.
- Decision (accepts plan D-A, supersedes the D2/D3 terminal choice): sign-in opens a separate OS console window (`conhost.exe` on Windows) started by Ptah with the named stripped env and `['auth','login','--claudeai']`; Ptah never reads its output. Completion only by sanitized `auth status --json` polling. Other platforms, or a window start failure → read-only fallback (command + profile directory + "Check status"). The D3 scoped renderer exception is no longer needed (stricter privacy). Live check E1 proves the window gives the CLI a console and keeps the env; if E1 fails, an embedded pty terminal returns as a new surface with designer + Gate 1.7.
- UI scope: U1 reused unchanged; U2 copy change; U3 fallback block inside the existing drawer; U4 removal of `release-held` copy (the hold is lifted, D41 — not a capability removal); U5/U6 one "Account: <label>"/"Default" text field on the existing lane card and chat session. None adds or redesigns a surface → no designer and no Gate 1.7; completion needs visual-reviewer before/after screenshots (dark + light) in Electron for the drawer, lane card and chat session.
- E2 (A2 pre-prompt identity proof): a user-approved script with no prompt on the ambient login, reporting booleans and version only. Run it with the user at the live-test session, before named runs; until it passes, named runs refuse at the 15 s deadline (fail closed).

## D6 — Gate 2 review round 1 (2026-10-25, orchestrator)

- Reviewer: codex lane (no role), cross-side to the Claude architect subagent. Verdict REVISE, 11 findings (1 Blocking: certified launch context; Serious: sdk-agent-adapter holds, lease/binding store contract, plus others; Moderate: batch manifest, D5 incorporation) in `implementation-plan-review.md`. All accepted; revise round 1 of 2 goes back to the same architect (resumed, not fresh: its read of the code base is needed and a fresh architect would repeat it).

## D7 — Gate 2 re-review round 1 result (2026-10-25, orchestrator)

- Codex lane (fresh session; the old one exceeded the resume limit) re-reviewed revision 1: Verdict REVISE, 7 remaining findings in `implementation-plan-review.md` (round 0 backup: `implementation-plan-review-round0.md`): 1 Blocking (`reg.exe query` exit 1 treated as absence; must separate missing key from unreadable/failed query), 4 Serious (migration 0060 loses existing reservation epochs; fallback completion bypasses owned status-probe uncertainty; fallback scripts run outside the certified cwd; batch graph has forward dependencies — B7 registers CLAUDE_CLI_PROBE before B8 implements it), 2 Moderate (`ACCOUNT_HELD_NOTE` in accounts-section.component.ts:70-72 unowned; key regression tests not committed per batch).
- Next: revise round 2 of 2 (the last) by a software-architect subagent, then codex re-review. REVISE after round 2 escalates to the user. Paused at the session handoff.

## D8 — Revise round 2 and batch-cap exception D-M (2026-10-25, orchestrator, evidence step; peer check by the Gate 2 reviewer)

- Backups before round 2: `implementation-plan-review-round1.md`, `implementation-plan-rev1.md`. A fresh software-architect subagent wrote revision 2 (22 batches, B1-B22).
- The architect reports that three batches cannot stay at six files and stay green with each file in one batch: B7 (migration 0060; 19 specs pin the latest migration version, precedent commit `ea27188eb` did the same 22-file bump for 0059), B8 (account core, 10 files), B12 (lane, 7 files).
- Decision: accept plan D-M. Each of B7, B8 and B12 is one commit with one scoped verify, implemented in ordered work packages of at most six files each. Reason: "each batch passes its own lint/typecheck/test" (CLAUDE.md, review finding 5) is the stronger rule; editing a spec in two batches would break "each file once" and give red intermediate states. The six-file cap is a lane cost rule (agent-lanes §8), and work packages keep each developer run small. Reversible. The codex re-review validates it as the peer step.

## D9 — Gate 2 re-review round 2 result: REVISE at the cap (2026-10-25, orchestrator)

- Codex lane f7f0fcc7 (no role, cross-side) re-reviewed revision 2. All 7 round-1 findings are fixed. D-M is ACCEPTED (peer check passed for D8).
- One new Serious finding: plan lines 248-261 list policy sources that the scan does not detect (server-managed/remote settings, managed-settings drop-in directories, other MDM profiles, project settings above `cwd`) and say "no runtime refusal from the scan". This contradicts task-description.md R3.5 ("precedence cannot be determined → certification shall refuse"). Exact fix in `implementation-plan-review.md` finding 1.
- Four Minor non-blocking notes for batches.md (B7 work-package split WP-a..e, copy-audit scope, registry hive-name normalization, certifier steps handoff).
- The revise cap (2 rounds) is reached. Gate 2 escalates to the user with the open item. Implementation does not start before the user decides.

## D10 — User decision on Gate 2 escalation (2026-10-25, user)

- The user chose "Apply fix, 1 extra round": a fresh architect applies review finding 1 (round 2) exactly; then one codex re-check scoped to that fix. Requirement 3.5 is unchanged. Backups: `implementation-plan-rev2.md`, `implementation-plan-review-round2.md`.
- A source that cannot be scanned or positively shown absent keeps named certification refused (`unsupported-source`); E4 records it in the live test.

## D11 — Gate 2 scoped re-check result: still REVISE (2026-10-25, orchestrator)

- Architect subagent wrote revision 3 (D-P exact platform+version coverage table: win32 + CLI 2.1.310 only; D-Q server-managed cache/consent files; D-R Ptah-controlled channels). Backup of the rev2 plan: `implementation-plan-rev2.md`.
- Codex lane b93f7ceb (scoped re-check; review backed up as `implementation-plan-review-round3.md`): the 4 Minor notes are fixed; no forward dependency or duplicate file found; D-M stays accepted; the lane path uses the installed executable (no always-refused bundled 2.1.278 path); D-P costs are compliant trade-offs. Verdict REVISE with 2 Serious findings:
  1. Remote/server-managed settings (A-S9), parent-managed input (A-S12) and the config base (A-S1) are still assumptions, but the plan treats them as positive absence. Strict R3.5 needs refusal until read-only evidence settles them.
  2. Per-child coverage checks are not assigned to the SDK main-chat and lane bootstrap/final boundaries.
- The user-authorized extra round is used. Escalated to the user again.

## D12 — User direction after D11 (2026-10-25, user)

- The user asked for more research before Gate 2 closes: (a) study the t3code repository to see how it lets a user run two Claude accounts, and (b) collect evidence for A-S1, A-S9 and A-S12. The user's goal: main Claude agent on one account, and a Ptah CLI lane on another account.
- Next: researcher-expert writes `research-report-2.md`. Then the orchestrator brings the findings and options back to the user before any plan change. Implementation stays blocked.

## D13 — User decision: personal accounts only, Option 1 + 3 (2026-10-25, user)

- Evidence: `research-report-2.md` (researcher subagent). t3code uses one `CLAUDE_CONFIG_DIR` per account with user-run `claude auth login` and no policy certification. A-S1 and A-S12 are proved by docs and binary strings. A-S9 is not provable, and docs say server-managed settings reach Team/Enterprise accounts only; a missing cache file proves nothing because the fetch does not block startup.
- The user's accounts are two (or more) personal claude.ai Max plans (USD 200 and USD 100), no Team/Enterprise seat.
- Decision: Option 1 + Option 3. Certification classifies each account from sanitized `auth status --json`. Class P (claude.ai login, personal Pro/Max subscription, no org signals) certifies from proved evidence (A-S1 file reads, A-S12 "never pass managedSettings", registry/managed-file scan, post-init tripwire on `apiKeySource`/`tokenSource`). Class O (Team/Enterprise, org signals, or any unknown) refuses with a named reason in this release. Drop the "cache/consent file absent ⇒ no remote policy" rule. Support N named accounts (two or more). R3.5 stays as written, no waiver. The documented Teams/Enterprise eligibility is a labelled documentation-based assumption, which the reviewer checks.
- Also fix scoped review finding 2 (coverage check at every SDK main-chat and lane bootstrap/final boundary).
- Follow-up task (not in this release): `claude doctor` experiment (Option 2) for org accounts.

## D14 — Gate 2 passed (2026-10-25, lane-review)

- implementation-plan.md revision 4: author Claude software-architect subagents (rev1-rev4), reviewer codex lane 97c02976 (no role, cross-side). Verdict APPROVED, no Blocking/Serious findings. No removals proposed. Gate 2 passes in `lane-review` mode; the user directed the extra rounds (D10, D12, D13).
- Three non-blocking notes go into batches.md: (1) Moderate: add `stat` (size/mtimeMs) to the injected filesystem contract, factory and B6 fakes (B6/B8); (2) Minor: class O returns `unsupported-source` before the identity comparison, `identity-mismatch` stays for class P mismatch; pin an apiKeySource / non-firstParty case at certifier level; (3) Minor: fix E4 wording (S9 absence no longer decides; presence/unreadability still refuses).
- Next: team-leader decomposition (batches.md).

## D15 — Implementation start and pre-existing agent-sdk lint error (2026-10-25, orchestrator, evidence step)

- Team-leader MODE 1 wrote `batches.md` (22 batches, phases P1-P5, B10 moved after B16). The orchestrator runs verify and commits per the user's handoff; batch states in `batches.md` are updated by the orchestrator.
- B2, B3 and B4 ran in parallel (file-disjoint, no edges between them) and were verified together (`-p shared,rpc-handlers,agent-sdk,platform-core`): 11/12 tasks passed.
- The failing task was `@ptah-extension/agent-sdk:lint`: 2 `no-unexpected-multiline` errors in `session-query-executor.accounts.spec.ts:174,183`. The file is unchanged from main, so the error is pre-existing. Decision: fix it in its own `fix(agent-sdk)` commit (join `it.each([...])` with its call). Reason: B11 and B13 verify agent-sdk again, and lint must be green. The change has no runtime effect; B13 still owns the later functional edits to that spec. Reversible.

## D16 — Phase P1 code review (2026-10-25, orchestrator)

- Reviewer: codex lane (no role), different family from the Claude implementers. Verdict REVISE 7/10 (`code-logic-review-p1.md`): 2 Serious (env digest newline ambiguity; settings bypass via bootstrap `flagSettings` and `extraArgs.settings`), 1 Minor (fallback doc comment). All accepted and fixed in one round by a fresh backend-developer subagent (`p1-fix-report.md`); exported signatures unchanged.
- Re-review: fresh codex lane (resume refused for context size). Verdict APPROVED (`code-logic-review-p1-rereview.md`); it re-ran the three adversarial inputs and each now refuses.
- B7 pin packages ran on the smaller `sonnet` model (mechanical 59 -> 60 edits); WP-a ran on the default model.

## D17 — Pre-existing persistence-sqlite lint errors (2026-10-25, orchestrator, evidence step)

- B7 verify: test and typecheck pass; `@ptah-extension/persistence-sqlite:lint` fails with 10 `no-restricted-syntax` errors (SQL template interpolation) in `0057_drop_skill_pipeline.ts`, `0057_drop_skill_pipeline.spec.ts` and `0058_provider_accounts.spec.ts`. Those files are unchanged from main; ESLint on the 22 B7 files alone reports 0 errors (3 warnings).
- Decision: commit B7; do not edit shipped migrations in this task. Report the main-branch lint debt in the PR; if CI lint blocks the PR, decide then (a separate minimal fix commit for the specs, never for shipped migration SQL without review). Reversible.

## D18 — B5/B6 verify: pre-existing failures only (2026-10-25, orchestrator, evidence step)

- `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers`: typecheck passes; test 79/81 suites pass (all new B5/B6 specs included), 6 tests fail in `translation/translation-proxy.sdk.integration.spec.ts` (untouched; `EPERM` in its `removeTree` temp-dir cleanup on Windows); lint has 3 errors, all in files unchanged from main (`auth-providers/package.json` dependency-check for persistence-sqlite, `provider-account.store.ts:16` no-control-regex, `provider-account.store.spec.ts:132` no-unexpected-multiline). ESLint on the 8 new B5/B6 files: 0 errors.
- Decision: commit B5 and B6. The orchestrator added `import 'reflect-metadata';` to the two B5 specs (B6 developer found the agent-sdk barrel needs it). B8 owns `provider-account.store.ts` and its spec: the B8 executor must fix those two lint errors while it edits them. The package.json dependency-check error and the integration-spec EPERM stay main-branch debt; report them in the PR. Reversible.

## D19 — B8/B9 verify: pre-existing failures only (2026-10-25, orchestrator, evidence step)

- B8 verify (6 projects, 64 tasks): 62 pass. `auth-providers:test` fails only in the unchanged `translation-proxy.sdk.integration.spec.ts` (5 tests, `EPERM` cleanup). `auth-providers:lint` has 1 error: the unchanged `package.json` `@nx/dependency-checks` (persistence-sqlite). The two D18 store lint errors are fixed. B9 verify (auth-providers): same two pre-existing failures (4 EPERM tests this run), typecheck passes.
- WP-a hit its tool-call ceiling after 4 files and was resumed inside the cache window to finish 2 files (rule: resume only under 5 minutes).
- `register.spec.ts:145` keeps the string `'certifyClaudeAccountEnvironment'` in its "must not be exported" list. It is a negative guard for the deleted member, not a reference. Kept.
- Decision: commit B8 (`28e3bbd4d`) and B9. Reversible.

## D20 — Phase P2 code review (2026-10-25, orchestrator)

- Codex lane (no role, reviewer family codex, implementer Claude): REVISE 7/10 (`code-logic-review-p2.md`). 1 Serious (auth children lost the reserved directory physical-identity guard), 2 Moderate (late probe close never unblocks a pending auth operation; empty or headerless successful registry output treated as absence).
- Decision: fix all three in one fix round. Moderate 2 leaves a profile pending with a persisted operation that needs manual recovery (state loss); Moderate 3 is a fail-open policy check (security). Both meet the "can break config or lose data" bar. Style note (add an explicit `implements` clause in B9 if the interface is importable without a boundary violation) is taken in the same round.
- Fix run 1: finding 1. Fix run 2: findings 2 and 3 and the style note. Sequential (shared files). Then one short codex re-review on the fix diff.

## D21 — B11 runner deletion moved to B13 (2026-10-25, orchestrator, evidence step)

- Deleting the runner's unused `accountRoute` field and wrapper (`sdk-query-runner.service.ts`) breaks typecheck in `claude-account-route-env.spec.ts` (one-shot cases at lines 156-183, the `'one-shot'` `describe.each` row at 291, the call at 347). That spec belongs to B13. The B11 executor reverted the runner to HEAD.
- Decision: B11 ships the model-service change only. B13 takes `sdk-query-runner.service.ts` as a sixth file and does the runner deletion together with the spec edit (B11 report has the verified edit: env literal identical to its pre-`697b7e31a` form). File-disjointness holds; B13 grows from 5 to 6 files. Reversible.
- B11 also removed the optional `cliDetector` constructor dependency from `SdkModelService` (its only use was the named path; only the two B11 specs passed it). Accepted; the agent-sdk verify covers DI.

## D22 — P2 fix round details (2026-10-26, orchestrator, evidence step)

- Fix run 1 (finding 1): reserved route carried in the auth context; revalidation and a file-identity launch guard before each status/logout/console spawn; revalidation after close; `route-changed` with real termination facts. Run 2 makes the route field required and adds service-level tests.
- Fix run 3 (finding 3): a successful registry listing must contain the queried-key header or at least one subkey line; value lines count only after the header. Not "header in every listing": per the verified `reg.exe` output in implementation-plan.md:386-408 the header appears only when a key has values, so the literal fix would refuse every real machine. Side effect: a key with no values and no subkeys refuses (fail closed). Accepted; the re-review checks it.
- Style note (explicit `implements`) deferred as Minor: `NamedAccountPersistencePort` is not in the `@ptah-extension/agent-sdk` public index. Recorded for a later task.

## D23 — B12 refusal codes (2026-10-26, orchestrator, evidence step)

- B12 WP-a chose `unsupported-source` for tripwire refusals and `route-changed` for an init CLI version change. implementation-plan.md:428-437 says any init or tripwire mismatch refuses `identity-unproved`. Decision: tripwire and version mismatch refuse `identity-unproved`; `unsupported-source` stays for a `checkLaunchBoundary` refusal (batches.md B12 acceptance). B13's main-chat tripwire uses the same codes. Three adapter-spec expectations moved from `release-held` to `identity-unproved` for identity mismatch (B12 removes the `release-held` default, plan line 94). Reversible.

## D24 — P2 fix round closed; required route deferred (2026-10-26, orchestrator, evidence step)

- Findings 1-3 fixed across fix runs 1-4 (p2-fix-1..4-report.md). Registry probes now return close receipts that the actions ledger tracks (late close unblocks; no close keeps the block; disposal removes listeners).
- Making `ClaudeAuthContext.route` type-required was a fix-run-1 self-proposed hardening, not a review finding. Two runs hit the file cap on it (it fans out to 5 spec files). At runtime a missing route already fails closed (no spawn, `route-changed`). Decision: defer as Minor (later task); record in the PR. Reversible.
- Verify: one combined run for the P2 fixes and B12 (both touch projects that ptah-electron depends on), then two commits with explicit paths.

## D25 — P2 re-review REVISE 8/10; one bounded correction (2026-10-26, orchestrator)

- Codex re-review (`code-logic-review-p2-rereview.md`): findings 1 and 3 closed; deviations D22 (registry rule) and D24 (optional route type) accepted. Finding 2 open for one path (status action drops registry receipts). New Moderate: `certifyExecutable` and run certification drop receipts without disposal (listener leak on a never-closing child).
- The fix-round cap is used. Per agent-lanes §6: one bounded correction (fix run 5, both items only), then one independent scoped review. If that review finds defects, report them to the user and stop; the cap is not reset.

## D26 — Phase P2 closed (2026-10-26, orchestrator)

- Bounded correction (fix run 5) reviewed by a fresh codex lane: APPROVED 9/10, both items closed, no new defects (`code-logic-review-p2-correction.md`). Phase P2 (B5-B9) is closed.
- Open Minor items for later tasks: explicit `implements NamedAccountPersistencePort` (D22); type-required `ClaudeAuthContext.route` (D24).

## D27 — B14 resume precedence (2026-10-26, orchestrator, evidence step)

- On a lane resume with no explicit selection, `AgentProcessManager` does not read the stored workspace selection; the resumed session keeps its own account (its existing binding). An explicit named selection on resume is still forwarded. Reason: reading the stored selection would refuse older ambient sessions once a named lane account is stored, and it would conflict with "resume without a second binding or lease". Accepted; the P3 review checks it. Reversible.

## D28 — Phase P3 code review (2026-10-26, orchestrator)

- Codex lane (reviewer codex, implementer Claude): REVISE 6/10 (`code-logic-review-p3.md`). Serious: 1 lane init `apiKeySource` not checked; 2 omitted bound-lane resume has no admission (D27 policy accepted, implementation incomplete); 3 explicit conflicting named selection overwritten on lane resume; 4 main-chat admission omits `workingDirectory` (runs in the account folder); 6 named main-chat path logs raw stderr. Moderate: 5 lane refuses allowed account-info `apiKeySource:'none'`; 7 missing persistence refuses `release-held` instead of `unavailable-storage`.
- Decision: fix all seven in one round. Moderate 5 refuses valid personal logins (breaks lane runs); Moderate 7 is a one-line code mapping in a file already in the round. Two parallel file-disjoint runs: lane (cli-agent-runtime: 1, 2, 3, 5) and main chat (agent-sdk: 4, 6, 7). Then one scoped codex re-review.

## D29 — Phase P3 closed; P4 follow-ups (2026-10-26, orchestrator)

- P3 fix round (p3-fix-lane-report.md, p3-fix-chat-report.md) re-reviewed by a fresh codex lane: APPROVED 9/10, all seven findings closed, no new defects (`code-logic-review-p3-rereview.md`). Accepted: a named main-chat run with no project path refuses `conflict`; a launch certified for another directory refuses `identity-unproved`; named-run stderr skips MCP back-off and the connectors notice (no raw CLI text). Out of scope (predates P3): a fresh handoff from a bound named lane is refused. Prettier hunks in `sdk-query-options-builder.ts` are behavior-neutral formatting (commas, parentheses).
- B16 follow-ups: `agent:resumeCliSession` result gains optional `code?: 'account_refused'` in libs/shared (additive RPC contract change); the resume-parent-session spec mock gains `LaneAccountResumeError`. B19 follow-up: `router.ts` `--account` help text uses the CLI host copy.
- B10: `AgentProcessInfo` has no typed `accountBinding`; the store narrows the backend field from `unknown` with `in` checks (no unsafe cast). Adding the field to the shared type is a later task.

## D30 — chat:lint module-boundary errors not from this task (2026-10-26, orchestrator, evidence step)

- Combined verify (8 projects, 68 tasks): 67 pass; `@ptah-extension/chat:lint` fails with 138 `@nx/enforce-module-boundaries` "Static imports of lazy-loaded libraries are forbidden" errors (156 files), all pointing at `chat/src/lib/services/artifact.store.ts` and `artifact-message-handler.service.ts`. None of the error files changed since base `396f0135b`; this task adds no runtime dynamic `import()` (only two type-level `typeof import(...)` in backend specs). ESLint on the two B10 chat files: 0 errors.
- Decision: commit; report the chat lint debt in the PR and decide if CI blocks it. Reversible.
- D30 addendum (B21): the main checkout at `871d733e4` reports the same error on the unchanged `accounts-section.component.ts:15`. Cause: `artifact.store.ts:57` and `artifact-message-handler.service.ts:13` dynamically import `@ptah-extension/shared/mcp-apps-contracts`, which makes the rule flag every static `@ptah-extension/shared` import in chat. Pre-existing on main; not fixed in this task.
- B21 decisions accepted: "Default" only for Claude-route sessions (`providerId` absent or `anthropic`); the row loads the Claude account list once, only for a session bound to a named account; `RoutingCell.named` removed with its only reader (copy removal, D5/D41).

## D31 — Phase P4 code review (2026-10-26, orchestrator)

- Codex lane (reviewer codex, implementer Claude): REVISE 7/10 (`code-logic-review-p4.md`). Moderate 1: a refused sign-out replaces and then deletes the live sign-in operation handle in the provider account handler (Cancel and fallback lost after refresh). Moderate 2: the frontend state service writes operation/fallback from a rejected stale snapshot (old script and old Cancel operation id can return). Minor 3: no production teardown caller for the handler's `onStateChanged` subscription. Minor 4: duplicate snapshots per action transition.
- Decision: fix Moderate 1 and 2 in one round (both lose or corrupt sign-in state). Minor 3 and 4 become named later tasks (recorded in the PR). Two parallel file-disjoint runs (backend handler, frontend state service), then one scoped codex re-review.

## D32 — P4 re-review REVISE 7/10; one bounded correction (2026-10-26, orchestrator)

- Codex re-review (`code-logic-review-p4-rereview.md`): finding 1 closed; finding 2 partly closed. New Moderate (regression from the fix): a refused overlapping same-profile request advances the epoch, so the valid earlier sign-in reply loses its Cancel handle and fallback. Moderate (pre-existing, assessment requested): `refreshAccountStatus` replies install or delete the operation without generation/epoch checks.
- Per agent-lanes §6: one bounded correction (state service + spec only), then one independent scoped review. If that review finds defects, report them to the user and stop; the cap is not reset.

## D33 — Phase P4 code review closed (2026-10-26, orchestrator)

- Bounded correction (p4-fix-state-2-report.md) reviewed by a fresh codex lane: APPROVED 9/10, both items closed, no new defects (`code-logic-review-p4-correction.md`). Phase P4 code-logic review is closed. Open Minor items for later tasks: P4 Minor 3 (no production teardown caller for the provider account handler's `onStateChanged` subscription) and Minor 4 (duplicate snapshots per action transition).

## D34 — P4 visual review REVISE 6.5/10 (2026-10-26, orchestrator)

- Visual reviewer (Electron, Playwright with faked RPC, dark + light, before = base `396f0135b`, after = `cf398919d`): `visual-review.md`. Passed in both themes: drawer pending copy, fallback block and buttons, held note removed, session row labels.
- D1 Serious: the lane account badge exists only in `ptah-agent-card-header` (card presentation); Electron lane surfaces use `presentation="flat"` (`ptah-execution-header`), so the badge never shows. Fix: show the same label in the flat header. D3 Moderate: session-row account label has no 10rem cap. Fix with the same cap and title as the lane badge.
- D2 Moderate (profile id on Accounts cards and drawer Overview): identical in the base build, not introduced by this task; the new surfaces render no profile id. Recorded as a later task, not fixed here.
- One fix run for D1 and D3, then a scoped visual re-check of those two screens (after only).

## D35 — Senior tester findings; release-held producers removed (2026-10-26, orchestrator, evidence step)

- test-report.md: R1-R7 map to committed specs; tester added 2 tests (R3.9 process env; D39 adapter capabilities). Gaps: R4.9 timeout exit (now added, `session-query-executor.accounts.spec.ts:372`); R1.2 no feature flag (source search only, no automated guard; accepted).
- Low defect: production code still returned `'release-held'` as an internal catch-all, against implementation-plan.md:135-136 ("No production path returns it"). Fixed (release-held-fix-report.md): unproved or unclassified named-run failures -> `identity-unproved`; registry bind refusal, resume-id mismatch, attach refusal -> `conflict`; missing admission/persistence ports in the adapter -> `unavailable-storage`. Settlement (release/retain) unchanged. Remaining non-spec hits are only the allowed ones (union member, two neutral COPY entries, drawer held fallback).
- A binding that arrives without an admission request keeps the plan's default `identity-unproved`. Reversible.

## D36 — Visual re-check and late-fix review (2026-10-26, orchestrator)

- Visual re-check (`visual-review-recheck.md`): APPROVED. D1 fixed (flat lane header badge "Account: <label>" / "Default" / "Removed account", 160px cap with title, nothing for non-Claude lanes, contrast 11.6-15:1, dark and light). D3 fixed (session row label 160px cap). Screens 1-3 unchanged. Card presentation not reachable in Electron (unit tests only).
- N1 Moderate (new): the flat lane header row wraps to two lines (35px -> 63px) for a long label or "Removed account"; nothing clipped, stable. Not a config or data risk: recorded as a later task (lean rule 4).
- Late fixes `7bd38efa8` (release-held producers) and `b8031e3fd` (flat header badge) reviewed by a fresh codex lane: APPROVED 9/10, no defects (`code-logic-review-final-fixes.md`).

## D37 — B22 host check and copy audit (2026-10-26, orchestrator, evidence step)

- `npm run verify -- -t lint,test,typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` (5 projects, 62 tasks): 61 pass. All host tests and typechecks pass, including the Electron, VS Code and CLI container smokes. `ptah-extension-webview:lint` fails with one error, `app.routes.ts:224` circular dependency webview <-> `@ptah-extension/command-center`; neither project changed since base `396f0135b`, and the main checkout at `871d733e4` reports the same error. Pre-existing on main.
- Copy audit (`git grep` over non-spec `libs/**/*.ts`, `apps/**/*.ts` for "release authorization", "awaiting release", "not available in this release", "not available yet", "release-held (D7)"): two hits, both exempt. `libs/shared/src/lib/types/agent-process.types.ts:334` (historical comment named in the plan). `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:92` ("This agent is not available yet."; agent loading, not accounts; unchanged since base). Producer audit: no non-spec code returns `'release-held'` (D35).
- Screenshots (14 MB, 109 files) stay local in `screenshots/` and are not committed; only the capture script is committed.

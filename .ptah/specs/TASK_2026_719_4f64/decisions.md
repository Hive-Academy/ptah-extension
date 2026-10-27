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

## D38 — PR #827 review fixes and CI shard 4 guard (2026-10-26, orchestrator)

- Fix 4 (`pr-fix-4-report.md`): `sdk-query-options-builder.ts` keeps the literal `settingSources: includesUserSettingSource(` for the ambient value that the output-styles source guard requires; a named run overrides it with a later spread. Same runtime result for both routes.
- Independent review of fixes 1-4: codex lane (reviewer codex, implementer Claude), APPROVED 9/10, no findings (`code-logic-review-pr-fixes.md`). Known limit kept: `prepareSdkHandleSpawn` (Ptah CLI registry path) still forwards the gate reference on `fresh`; not part of the CodeRabbit finding, recorded for a later task.
- `@ptah-extension/output-styles` is added to the verify project list from now on.

## D39 — Live test: sign-in console never shows (2026-10-26, orchestrator, evidence step)

- Live Electron test (R8) stopped at E1.2: "Sign in" shows pending, but no window. Process watch: `conhost.exe` + `claude.exe` start and stop at once; no log line.
- Probes (temp config dir, output never read): `conhost.exe claude auth login --claudeai` with `stdio: 'ignore'` exits 0 after ~800 ms with the allowlisted env and with the full env. `cmd /c start /wait` and a hidden `powershell -EncodedCommand` running `Start-Process -Wait -PassThru` both keep claude open in a new visible console; `taskkill /T` on the PowerShell PID stops the tree.
- Cause: libuv always passes std handles (NUL for `ignore`); conhost hands them to claude, which sees no terminal and quits.
- Decision: launch through a hidden PowerShell `Start-Process -Wait` (quoting via `quotePowerShell`, arguments as one CommandLineToArgvW string, script by `-EncodedCommand`). Fix run `live-fix-1-report.md`; then verify, a codex review, rebuild, and repeat E1. Reversible.
- E2 step 1 has no separate probe script: the named-run bootstrap already proves `accountInfo()` before the first prompt and fails closed at 15 s; step 6 records that proof.
- User UX feedback recorded for a new phase P5 (designer → prototype → cross-side review → Gate 1.7): (1) move Accounts into the Claude (Subscription) connection drawer; (2) show the existing Claude login as one connected account and let the user add the second, so the two selection cards do not both read "Use existing default"; (3) Manage opens on the Access tab when the account is not signed in; (4) remove the profile UUID and "Unknown owner" noise from the card and Overview.
- Electron build for the live test ran outside the verify lock, by the user's explicit choice.

## D40 — Login launcher correction and P5 user decisions (2026-10-26, orchestrator + user)

- Live fix 1 review (codex, REVISE 8/10): finding 1 Moderate — `Start-Process -WorkingDirectory` treats `[`/`]` as wildcards (reproduced: exit 1, no child). Fix 1b uses .NET `ProcessStartInfo` with `UseShellExecute` (probe: works for plain, bracket and backtick paths; real login stays open; tree kill clean). Finding 2 Minor (test/harness spawners ignore `ignoreStdio`) recorded, not fixed.
- Verify of live fix 1 (auth-providers, agent-sdk, platform-core, ptah-electron; 18 tasks): only the known pre-existing `EPERM` integration tests and the `package.json` dependency-check fail.
- P5 design review (codex, REVISE 6/10, `design-spec-p5-review.md`). User decisions (AskUserQuestion):
  1. Ambient row: add a read-only host status check for the existing Claude login (Connected / Not signed in / Unknown), UI-safe fields only.
  2. Remove the one-step "Set as default" (both scopes); the two "Use for" selects replace it. User-approved removal.
  3. Remove the "Verified identity" badge and the UUID suffixes in selects; account names must be unique (add/rename validation). User-approved removal.
  Also user-approved (D39 item 4): remove the card UUID and "Unknown owner" from the card and Overview.
- Orchestrator decisions (evidence step): no account-count cap (no host contract); Add does not chain sign-in — after Add, the new account opens on Access with a Sign in button; no Advanced tab; the "Window did not open?" link only when the host supplied a fallback script.

## D41 — P5 before the live test; connected-accounts badge on the card (2026-10-26, user)

- User (live test, E1.2): the old Accounts section is still on the base Providers page. Implement P5 first, then
  resume the live test on the new UI. Order changed: Gate 1.7 → plan → implement → verify → review → visual
  review → live test.
- User request: the "Claude (Subscription)" card shows a badge for the connected accounts. This replaces
  design-spec-p5 Decision 9 ("no count link on the base card").
- Orchestrator decisions (evidence step, reversible): the badge is display-only (not a link; the card's Manage
  keeps opening Overview). Text "N connected", N = named accounts with state signed-in, plus 1 when the ambient
  login status is `connected`. Hidden when N = 0, while loading, and when the read fails (no error on the card).
  Data: one `provider:listAccounts` read when the Providers page shows the card, plus the cached ambient status
  read (no forced probe from the card). The count refreshes when the drawer closes or an account changes state.
  No secrets, no labels on the card.

## D42 — Gate 1.7 for P5 passed by the user with two binding rules (2026-10-26, user)

- Codex re-review round 2 (`design-spec-p5-review-r2.md`): REVISE 8/10. R1, R2, R4, R5 closed; R3 partly.
  Revise cap reached, so the items went to the user.
- User: "Approve with fixes". No more design rounds. Binding rules for implementation (checked in code review):
  1. Account removal never assigns a selection locally; the last authoritative snapshot stays until the host
     returns its committed snapshot. Absent named targets are handled in general, not by fixture.
  2. After an async operation, focus returns to the waiting target only if focus is still there and the view is
     still active; otherwise current focus stays and the live region announces completion. §3.7 controls the
     busy rule; the older "focus stays on the select" wording (spec §5, parity row 25) is superseded.
- Both rules were sent to the architect for `implementation-plan-p5.md`.

## D43 — Gate 2 for P5 passed; batch execution (2026-10-26, orchestrator)

- Plan `implementation-plan-p5.md` (software-architect, Claude) reviewed cross-side by codex: REVISE 6/10
  (`implementation-plan-p5-review.md`) → Revision 1 → REVISE 8/10 (`-review-r1.md`, one new Moderate: queued
  read vs 30 s RPC timeout) → Revision 2 (25 s queue-inclusive host deadline, P5-D16) → APPROVED 9/10
  (`-review-r2.md`). Approval mode lane-review: notice, no wait.
- The plan's "## Batches" section (B1-B3, F1-F7, with file lists and verify commands derived from the
  dependency graph) is the P5 batch list; no separate team-leader decomposition (evidence: the batches were
  part of the Gate-2 review). The orchestrator runs each batch verify and commits. Executors: Claude subagents
  (backend-developer, frontend-developer). Phase reviews: codex (different family), one per phase (backend
  B1-B3, frontend F1-F7). Reversible.

## D44 — B3 verify: one new typecheck failure fixed by the orchestrator (2026-10-26, orchestrator)

- B3 verify (N = 10): 5 failed tasks. Three are the known pre-existing failures (auth-providers test EPERM,
  auth-providers lint dependency-checks, webview lint circular dependency; files unchanged since `396f0135b`).
  New: `@ptah-extension/core:typecheck` and `ptah-extension-webview:typecheck`, TS2339 `snapshot` at
  `provider-accounts-state.service.ts:619/632/651`. Cause: `AccountWriteMethod` excludes only the two read
  methods, so the new read method `provider:getAmbientClaudeStatus` entered the write union.
- Fix (one-line type edit, trivial-edit exception): exclude `provider:getAmbientClaudeStatus` from
  `AccountWriteMethod`. B3 commit becomes 9 files. The codex backend phase review covers the edit.
  Evidence: the compiler errors; the method is a read (plan §5). Reversible.

## D45 — Backend phase review: one fix round (2026-10-26, orchestrator)

- Codex code-logic review `code-logic-review-p5-backend.md`: REVISE 6/10, 1 Serious, 1 Moderate.
- Serious 1 (late PID after kill grace is never killed, `claude-account-command.ts` `run()`): the code is from an
  earlier commit of this branch, but the ambient probe path makes it reachable (worker-backed spawner) and a
  retained receipt then blocks later probes. Fix in this round.
- Moderate 2 (A→B→A environment change around certification caches B's status under key A,
  `claude-ambient-login-status.ts`): fixed in this round, because it can report `connected` for the wrong login
  (rule 4: wrong state shown to the user is treated like data loss). One environment snapshot feeds both the key
  and the child.
- B3 open point (reader throw → "Account storage is unavailable."): reviewer found no reachable path; no change.
- Executor: backend-developer subagent; then a short codex re-review scoped to the fix. Reversible.

## D46 — Post-cap correction of the late-PID fix (2026-10-26, orchestrator)

- Re-review r1 (`code-logic-review-p5-backend-r1.md`, codex): REVISE 6/10. Env snapshot fix closed. New Serious:
  after receipt disposal a close is no longer observed, so a later PID could still be killed (possible PID reuse).
- The one fix round was used, so the orchestrator made a bounded correction (agent-lanes §6) in
  `claude-account-command.ts` `run()`: the main close handler sets `exited`; `detach()` adds a `once('close')`
  observer only while the PID is unknown; `whenSpawned.then(pidSettled, pidSettled)` removes it; the kill guard
  is `exited || (settled && !receipt)`. A first attempt with a permanent extra listener broke existing
  listener-count specs and was replaced. Four regression specs added (dispose→close→PID, dispose→live→PID,
  receipt-closed→PID, null PID). Focused jest 130/130.
- Independent check: codex re-review r2 scoped to the correction. Reversible.

## D47 — Order kept; F3 and F4 overlap (2026-10-26, user + orchestrator)

- User asked about the waits. Cause: the shared verify lock (4 checks from other sessions in the queue) and
  starting each frontend batch only after the previous verify. Orchestrator change: F4 started while the F3
  verify was queued; one verify run may cover F3 and F4. Later verifies use the 2-slot script from main (PR #828).
- User choice: keep the plan order (F5 → F6 → F7 → frontend review → visual review → Electron build → live
  test). The early live test after F5 was offered and declined.

## D48 — Parallel batches (2026-10-26, user request + orchestrator)

- User asked to use CLI lanes with subagents in parallel. Evidence: F4 and F5 change disjoint files; the plan's
  "F5 after F4" is a commit-order rule (no commit may lose the accounts capability), so F5 is developed in parallel
  and committed after F4. F6 needs F5 (page imports the old section) and F7 needs F6 (old files use setDefault),
  so F6+F7 run as one mechanical deletion batch after F5, on a CLI lane (Glm, ptah-cli). The frontend phase review
  stays on codex so the review remains independent of the implementers. Reversible.

## D49 — Frontend phase review: one fix round, two parallel developers (2026-10-26, orchestrator)

- Codex `code-logic-review-p5-frontend.md`: REVISE 5/10 — Serious F1 (Check status has no busy/outcome), F2 (Escape
  in the nested Remove modal closes the drawer), F3 (Accounts unreachable when the Claude CLI is not installed and
  another provider is selected); Moderate F4 (focus return checks an area, not the exact waiting target), F5 (no
  completion announcement after sign-in/out/cancel). B-1 and D41 pass.
- All five fixed in one round: F4/F5 are fixed although Moderate, because they break user-approved binding rule
  B-2 (D42). Developer A (accounts-tab + state service), developer B (native modal in `libs/frontend/ui` +
  providers page). F2 is fixed in the modal (stop Escape propagation), not the drawer. F3: the Claude
  (Subscription) card stays listed whenever accounts are available. Then a short codex re-review. Reversible.
- Push of F4-F7 failed three times with GitHub "Internal Server Error" (request C0E7:7CC1C:1624E9FD:1D9BFF55:
  6ADF63B0); a new remote branch was not used (would need a deletion). Retrying.

## D50 — CI webview-e2e on 05f459308: update the providers scene for the Accounts tab (2026-10-26, orchestrator)

- `webview-e2e` failed only on `settings-providers.e2e.spec.ts` "card -> drawer (claude-cli)" for the Electron
  host: the drawer now shows Accounts second (F4, approved in D41). VS Code passed (no account support there).
- Fix: the scene expects Accounts second for Electron claude-cli only. Test expectation change, no product
  change. Verified with the harness lint/typecheck; the e2e itself runs in CI (no local e2e per CLAUDE.md).
- Electron build for the visual review started in parallel with the verify and the codex re-review (D47 order is
  kept: the visual review starts only after the fix round is committed). If the re-review needs code changes,
  rebuild. Reversible.

## D51 — P5 visual review: one fix round (2026-10-26, orchestrator)

- `visual-review-p5.md`: REVISE (Breaking 2: rows collapse and the detail view scrolls sideways at 245 px /
  200% zoom; Serious 1: the Use-for block stays above the detail view; Moderate 3).
- Fixed in one round: both Breaking, the Serious, and two Moderate items that are small and in the same files
  (focus box on the programmatic-only status target; `title` on long labels). The 10 px chip and badge text is
  recorded as later guidance (not an AA failure, used elsewhere in the app). Then rebuild Electron and a short
  visual re-check at 245 px, 200% zoom and 520 px. CI on 29ed77782: all green except GitGuardian 39008928 (known
  false positive); test shard 4 first failed in `npm ci` (node-gyp download), passed on rerun. Reversible.

- D51 result: `visual-review-p5-recheck.md` APPROVED (0 Breaking, 0 Serious). Moderate: about 49 px empty gap
  above the "All accounts" link at 520 px; recorded as later polish, not fixed now.

## D52 — P6: account selectors move to the chat and lane forms (2026-10-26, user)

- User feedback on the running P5 build: the Accounts tab is noisy (too much text, tight spacing). Account choice
  belongs where the work starts: the main chat provider form shows an account select when Claude is chosen; the
  Claude CLI lane setup shows an account select. The Accounts tab keeps the list with "Used by" chips, Sign in /
  Manage and Add account; no Use-for block, no helper sentences, short toasts instead of inline status lines.
- User decisions: live Haiku test after the redesign; Accounts tab = list + "Used by" chips.
- Evidence (Explore): main chat provider select `main-agent-reassign-popover.component.ts:97-104`; Claude CLI lane
  entry `cli-orchestration-matrix.component.ts:113-117`; both scopes persist through one RPC
  `provider:setAccountSelection` (scope `main` | `lane`), so no backend change is expected.
- Flow: architect parity inventory (inventory-only) and designer prototype in parallel (the capability set is small
  and known), codex cross-side review, then Gate 1.7 shown to the user (the user criticized the last design).
- Separate follow-up (not this phase): the "Claude API" card shows whenever any non-empty legacy API key is stored
  (`providers-settings-state.service.ts:498-509` `configured: auth.hasApiKey`; `auth-status-probes.ts:66-82`);
  pre-existing since #317, no validity check.

## D53 — P6 Gate 1.7 escalated to the user (2026-10-26, orchestrator)

- Design `design-spec-p6.md` + `prototype/p6/` (designer subagent, Claude) reviewed by codex lane: REVISE 6/10 →
  revision 1 → REVISE 7/10 (`design-spec-p6-review-r1.md`). Cap reached, so the gate goes to the user.
- The two new Serious items were spec wording contradictions; the orchestrator corrected State contract 4: an
  ambient selection is a valid write, and an `unconfirmed` account write shows only the uncertainty toast (never
  "Account not saved"). Remaining PARTIAL items (prototype-only async focus, live-region persistence, real 200%
  zoom) are carried into the implementation plan as acceptance criteria and checked by the Electron visual review.
- Proposed removals (copy only, `parity-inventory-p6.md`): 10 helper sentences and 3 inline status lines; two
  flagged (existing-login signed-out cue, status-unknown cue). Removals need the user's approval.

## D54 — Gate 1.7 for P6 passed by the user (2026-10-26, user)

- Approved: `design-spec-p6.md` (with the D53 correction) and `prototype/p6/`. Approved removals: all 13 copy items in
  `parity-inventory-p6.md`, except the two flagged existing-login cues (signed-out cue, status-unknown cue), which stay
  as a short tooltip on the status word (no visible sentence; also reachable by screen readers).
- Next: architect plan P6 (`implementation-plan-p6.md`, batches ≤ 6 files) → codex cross-side review (Gate 2,
  lane-review mode) → developers in parallel → verify → codex code review → Electron visual review → live test.

## D55 — P6 Gate 2 review: REVISE 7/10 (2026-10-26, orchestrator)

- Codex lane `f12cbae2` reviewed `implementation-plan-p6.md`: REVISE 7/10 (`implementation-plan-p6-review.md`).
  Serious 1: the Save-click account revision is not preserved across the awaited provider write (the service
  captures the snapshot at `setSelection` call time). Moderate 2: partial-save lock contradicts the Save predicate
  (model/effort dirty branch keeps Save enabled). Minor 3: acceptance 20 forbids live regions that the design
  requires (stale badge, load-error row). Passed: contracts exist, no backend change, batches file-disjoint and
  compile in order, parity complete, no unapproved removal (P6-A4/A5/A6 accepted).
- Next (session 9): one architect revision round on these three items, short codex re-review (resume session
  `019a…` not kept; spawn fresh with a full brief), then wave 1.

## D56 — P6 plan Revision 1: MP guards the Save-click account revision (2026-10-26, architect)

- Decision: MP captures the account intent (choice, `selections.main.revision`, named `revision`) synchronously at
  Save; after the provider await it re-checks against the current snapshot and calls the unchanged three-argument
  `setSelection` synchronously only when unchanged; a mismatch is handled as a confirmed refusal ("Provider saved.
  Account not saved.", lock per D57). Plan P6-A12.
- Options: frontend guard in MP (chosen); add a revision parameter to `ProviderAccountsStateService` (core public
  contract change); write the account before the provider (breaks the approved provider-first order).
- Evidence: `provider-accounts-state.service.ts:390,407,555` (call-time snapshot), `main-agent-reassign-popover.component.ts:490-499`
  (provider await first), `provider-account.store.ts:376-380` (host treats a stale revision as `conflict`). Review finding 1.
- Reversible: yes.

## D57 — P6 plan Revision 1: explicit account-refusal lock on MP's Save (2026-10-26, architect)

- Decision: `accountRefused` signal set on confirmed account refusal (failed, unavailable, D56 conflict), never on
  `unconfirmed`; while set `saveReady` is false even with model/effort drafts; reset only by a new enabled Account
  choice or reopening the popover; model/effort drafts kept. P6-A3 focus rule applies on that disable. Plan P6-A13.
- Options: explicit lock (chosen); clear only the account draft (Save stays enabled via model/effort, contradicts the
  design); discard model/effort drafts (loses input).
- Evidence: `design-spec-p6.md` contract 4 ("Save is disabled until the account changes again");
  `main-agent-reassign-popover.component.ts:360-364` (OR-branch). Review finding 2.
- Reversible: yes.

## D58 — P6 plan Revision 1: acceptance 20 limited to duplicate mutation announcers (2026-10-26, architect)

- Decision: acceptance 20 forbids only duplicate mutation-feedback announcers in P6 surfaces; the AT load-error
  `role=alert` row and the `Out of date` `role=status` badge, and MP's existing provider/model regions, are retained.
- Options: scoped prohibition (chosen); keep the blanket prohibition (contradicts the approved design).
- Evidence: `design-spec-p6.md:102-103`; `accounts-tab.component.ts:146,163`. Review finding 3.
- Reversible: yes.

## D59 - Gate 2 passed for P6 (lane-review)
- Decision: the revised `implementation-plan-p6.md` (Revision 1, D56-D58) passes Gate 2. Wave 1 starts.
- Evidence: `implementation-plan-p6-review-r1.md` (codex, APPROVED 8/10; findings 1-3 fixed, no new defects).
- Author: Claude software-architect subagent. Reviewer: codex lane (cross-side).
- Reversible: yes.

## D60 - P2 open points settled from the design
- Decision: (a) the duplicate-name alert toast uses `ACCOUNT_COPY.nameTaken` ("That name is already used.");
  `validateAccountName` keeps its inline text until P9. (b) Both selectors (main popover and lane cell) show the
  ambient suffix from a ready answer. (c) A `null` from `selectionFeedback` shows no toast (no invented name).
- Evidence: `design-spec-p6.md:42,54,106,134`; `batch-p2-report.md` open points.
- Reversible: yes.

## D61 - P6 code review fix round scope
- Decision: fix review finding 1 (terminal sign-in result not announced; focus lost when a focused pending control
  disappears) in one round. Defer finding 2 (page and inline toast instances both announce one message) to a named
  later task "settings toast announcement owner".
- Evidence: `code-logic-review-p6.md` (codex, REVISE 6/10, 2 Moderate). Finding 1 misses `design-spec-p6.md:118`
  ("Signed in" toast) on the path the live test uses. Finding 2 existed before P6 (`batch-p1-report.md` open point 2),
  occurs on the Models & Tiers tab (not a P6 surface), and cannot break a lane config or lose data (orchestration
  rule 4).
- Reversible: yes.

## D62

- Decision: keep the agent account override as it is today. An explicit `accountSelection` from an agent
  on `ptah_agent_spawn` (including `ambient`) still wins over the stored workspace lane selection.
- Source: user decision (session 10, 2026-10-27): "let the agent choose the account as is now". The user
  wants the focus on why the named lane is refused on the same machine.
- Evidence: `agent-process-manager.service.ts:573-574`; `agent-spawn-args.schema.ts:108`.
- Reversible: yes.

## D63

- Decision: named-account runs accept a small, explicit allowlist of non-auth Claude Code feature and
  tuning `env` keys in user/project/local settings (first case: `ENABLE_TOOL_SEARCH`). Keys that can
  change the account, credentials, API endpoint, provider or config directory stay refused
  (`unsupported-source`).
- Source: user decision (session 10, 2026-10-27), option "Allow safe non-auth keys". Security review
  required (codex code-logic review on the allowlist diff).
- Evidence: `bugfix-lane-refusal-report.md` (S3 refusal of `D:\projects\property-hub` settings.local.json,
  one env key `ENABLE_TOOL_SEARCH`); `claude-certified-launch.ts:407-431` (`claudeSettingsOverride`).
- Reversible: yes.

## D64

- Decision: codex review `code-logic-review-lane-refusal.md` (REVISE 6/10). Finding 2 (misleading
  `unsupported-store` text) is fixed: the text now names the account directory or the installed CLI.
  Finding 1 (a throwing logger could replace the coded refusal) gets no change.
- Evidence for finding 1: the injected `Logger` is the repo-wide contract, and the code calls it without
  a guard on every refusal path that existed before this diff. Examples: `claude-sdk-lane-runner.ts`
  `[ClaudeLane] Child close was not confirmed` inside a catch, and `agent-process-manager.service.ts:585`
  before `LaneAccountResumeError`. A throwing sink already breaks those paths, so this diff adds no new
  class of risk. Orchestration rule 4: a Moderate finding that cannot break a lane config or lose data
  becomes a later task. Later task: decide on a no-throw logger contract for the whole repo.
- Reversible: yes.

## D65

- Decision: codex review `code-logic-review-env-allowlist.md` (REVISE 6/10). Part A is closed: the
  `unsupported-store` text covers every producer, and the reviewer accepts D64. Part B: both keys are
  removed from `CLAUDE_SETTINGS_SAFE_ENV_KEYS`, which now has 16 keys.
  `USE_BUILTIN_RIPGREP` (Serious: it can select a system executable) and
  `DISABLE_NON_ESSENTIAL_MODEL_CALLS` (Moderate: not confirmed in the current CLI reference).
- Evidence: the reviewer's remedy was "pinned CLI evidence or removal". Removal is the smaller and safer change.
- Reversible: yes. A later task can add a key again with pinned CLI evidence.

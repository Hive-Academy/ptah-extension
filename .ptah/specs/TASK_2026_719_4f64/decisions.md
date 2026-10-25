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

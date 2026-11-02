# HANDOFF - TASK_2026_857_f660 (lane learning integrity + host-side pre-flight routing)

Written 2026-10-31 ~16:20 UTC by the orchestrator (fourth session). Supersedes all earlier versions.
Read this, then `batches.md` ("Phases and reviews") and `decisions.md` rows 24-28.

## Goal

User asked (via `/orchestrate`, with subagents AND CLI lanes, Electron first):

1. **Learning integrity** - failed/limit/crashed lane runs write outcome rows; stale deliverable is
   not `delivered`; exit-0 API 429 = `failed` + `usage-limit`; taskKind explicit -> mapped ->
   classified -> unclassified with `taskKindSource`; subagent runs recorded.
2. **Host-side routing** - per-turn background scope check; pre-flight `route_decide` at "scope
   agreed"; `Routing:` reminder injected into the next turn via UserPromptSubmit `additionalContext`;
   at most one nudge and one pre-flight per scope revision; setting `agentOrchestration.hostRouting`.
3. **Quality signals** - host-captured review verdicts; learned cells blended toward seed (k = 10).
   Prompt/rule-text changes are out of scope (handled on another machine). Do not re-ask decisions
   already in decisions.md.

## Done (branch `feat/lane-learning-routing`, worktree

`D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing`, base `1d2fbd4b5`; NOT pushed, no PR)

All 23 batches committed (batches.md 23/23). This session added:

- `20dffd75e` B18 host routing coordinator - rpc-handlers verify 3/3, degradation-audit 1/1; Gate 2
  carry-forward checked in code + specs.
- `5c062d374` B19 admit chat turns to host routing - rpc-handlers 3/3 (193 suites), host typecheck 3/3.
- `f4a4e5f33` Phase A fix round 2 (bare-id early review join, reviewer identity required, no raw
  SDK error text in log) - 3 libs 9/9, host typecheck 4/4, degradation-audit ok.
- `6a7429833` B21 Electron wiring (classifier alias, observeSubagentEnded, registerHostRouting,
  DI guards) - ptah-electron 9/9, vscode+cli typecheck,test 44/44. No B22 needed.
- `d5cf5bb72` Phase B fix round 1 (setting-change reset via `HostRoutingSetting.onDidChange`,
  owner-tagged reminder queue `discardOwned`, coordinator captured in BootRefs and disposed via
  `nonFatal` in shutdown.ts, prettier on B13-B17 files) - 3 libs 9/9, ptah-electron 9/9, host
  typecheck 3/3, degradation-audit ok, prettier clean.
  Earlier: B1-B17, B20, Phase A fix round 1 `8ee2e1afb` (see batches.md).

Reviews:

- Phase A: closed. Round 2 (codex) REVISE 5/10 -> fixed in f4a4e5f33; round 3 (codex) REVISE 6/10
  with one OPEN Moderate defect (row 27, cap exhausted) - disclosed in future-enhancements.md and
  must be disclosed in the PR.
- Phase B: codex (B18/B19) REVISE 4/10, Claude logic (B13-17,B21) REVISE 7/10, Claude style REVISE
  7/10 -> triage row 28 -> fix round 1 d5cf5bb72. Re-review: Claude logic for the Electron quit path
  APPROVED 9/10 (`code-logic-review-phase-b-lanes-round2.md`). Codex re-review of the coordinator/
  queue part is STILL RUNNING (Background work). Phase B revise cap: 1 of 2 used.
- Phase C: done earlier (B20 fix approved 10/10).

`future-enhancements.md` is WRITTEN (all deferred items incl. the two open review-id defects).
R10 checked: migration 0064 is still free on origin/main (`4e2d1eb5e`).

## In progress

- Nothing uncommitted in code. Only the task folder `.ptah/specs/TASK_2026_857_f660/` is untracked
  (to be committed at ship time).

## Open problems and decisions

- **Merge conflicts with origin/main** (`git merge-tree --write-tree HEAD origin/main`, origin/main
  `4e2d1eb5e`): CONFLICT in `apps/ptah-electron/src/di/container.smoke.spec.ts`,
  `apps/ptah-electron/src/di/expected-resolvable.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`. Plan: merge origin/main
  INTO the branch with a merge commit (no rebase, no force push), resolve keeping both sides, then
  run the final checks on the merged result.
- Electron launch (B20 visual review + live checks) needs ONE AskUserQuestion before launching.
- Lane limits: codex has room (weekly ~52%+). Glm AT LIMIT until 2026-11-02 00:00 UTC; grok AT LIMIT
  until 2026-11-03 17:40 UTC; opencode at limit (monthly, 2026-11-04); kimi skipped this run;
  antigravity corrupts UTF-8 (keep off code).
- Pre-existing main lint errors (not ours): persistence-sqlite 0057/0058, skill-synthesis
  `skill-registry-catalog.service.ts:53`. Known flake: vscode-lm-tools `http-server.handler.spec.ts` port.

## Key files (task folder `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\`)

- `batches.md` - batch status, run constraints (top), "Phases and reviews" incl. fix rounds.
- `decisions.md` - rows 1-28 (26-28 from this session: Phase A r2/r3 and Phase B triage).
- `future-enhancements.md` - all deferred findings and the two open defects.
- `code-logic-review-phase-b-round2.md` - codex re-review deliverable (being written).
- `phase-b-fix-report.md`, `phase-a-fix-round2-report.md`, `batch-18/19/21-report.md` - executor evidence.
- `implementation-plan.md:1373-1393` - live checks list and Gate 2 carry-forward.

## Background work

- Codex lane `bf997a4b-9ade-4b76-b736-232ca7bb0c19` (CLI Session ID `01a192b2-c44f-7233-bcbd-a2f1918325f0`):
  read-only re-review of d5cf5bb72 (codex F1/F2 fixes: setting-change reset and owner-tagged queue).
  Deliverable `code-logic-review-phase-b-round2.md`. State: running. Its signal goes to the new session.
- No subagents running. The team-leader subagent of this session ends with it; start a fresh
  team-leader (Mode 2) for further commits.

## Next steps

**Current state (supersedes the steps below):** code complete at `65b14cc72` (Phase B round 3
REVISE 6/10 disclosed, decisions row 31; origin/main merged, row 32); task folder committed.
Next = push + `gh pr create` (step 5), then watch CI and reviews (step 6).

1. When the codex re-review signal arrives: read `code-logic-review-phase-b-round2.md`. APPROVED ->
   record in batches.md/decisions.md. REVISE with Critical/Serious -> one last fix round (round 2 of 2,
   backend-developer subagent), commit via team-leader Mode 2, then report remaining defects (no more
   rounds). Moderate items -> add to future-enhancements.md.
2. Merge origin/main into the branch (team-leader or backend-developer subagent, in the worktree):
   `git fetch origin main && git merge origin/main` (merge commit, hooks on), resolve the 3 conflicts
   keeping both sides' registrations/tokens/changes, then:
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui 2>&1 | tail -20`
   - `npm run verify -- -p ptah-electron 2>&1 | tail -40`
   - `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/lane-outcomes,@ptah-extension/lane-routing,@ptah-extension/agent-sdk 2>&1 | tail -40`
   - `npm run verify -- -t lint -p degradation-audit 2>&1 | tail -20`
     Re-check migration numbering after the merge (0064 must stay unique).
3. Ask the user ONCE (AskUserQuestion) whether to launch Electron for the B20 visual review (dark +
   light, decision model set/unset, before shots from `1d2fbd4b5`; navigation in batch-20-report.md
   ~114-120) and the live checks (implementation-plan.md:1373-1381 / batches.md B21 verification).
4. Commit the task folder (`.ptah/specs/TASK_2026_857_f660/`) via team-leader Mode 2, explicit paths.
5. Push + `gh pr create --base main` in ONE background command. Title < 70 chars, e.g.
   "feat: lane learning integrity and host-side routing". Body: `## Summary` (3 pieces), `## Test plan`
   with the real verify results above, the open defects from future-enhancements.md ("Open defects"),
   and checks not run (Electron live checks if skipped). End with the Claude Code footer.
6. Watch CI and reviews with `gh pr checks` / `gh pr view --comments` (background watcher); fix
   confirmed task defects with new commits; report PR URL, head, CI and review state.

Rules: work only in the worktree; node_modules is a junction (never npm install); memory-safe
verify only (`npm run verify -- -p ...`, foreground, long timeout, tail output); commits only via
team-leader Mode 2, one at a time, explicit paths, foreground, never bypass hooks, `npx prettier
--check` on staged files; no merges to main, no force push, no history rewrite, keep the worktree.

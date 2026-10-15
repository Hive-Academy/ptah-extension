# Context - TASK_2026_649_33c4

Epic: TASK_2026_647_1b0f (`../TASK_2026_647_1b0f/context.md`). Depends on TASK_2026_648_374e
(PR #733, open, base `main`; #732 merged 2026-10-15 as `4eef18165`).

## Request

User, 2026-10-15: "move to the next task in our epic" after 648; the user wants to test real
Setup Hub improvements. 649 is the first task whose result is visible in the Setup Hub.

Scope (epic phase 2): AI Team Builder and New Project builder on normal chat tabs through
`WorkflowTabLauncherService` and `ptah-session-embed` (648); fix epic defects 1-3 (no live
stream, snapshot misrouting, silent Apply); replace the duplicated chat infrastructure (own
composer, transcript, claim/rehydrate, SDK stream transport); wire the unused harness AI services
(`suggest-config`, `design-agents`, `generate-skills`, `generate-document`, `analyze-intent`) as
add-on actions or agent tools; keep intake, workspace pin, stack profile, preview, Apply, presets,
health. Implement Save as draft / Discard (652 D16-D18; requirements, UX and edge cases in
`../TASK_2026_652_7284/draft-workflow-plan.md`, which is SUPERSEDED for implementation).

Guiding rule (user): keep and fix, do not delete features. Any removal of a user-visible capability
goes under `## Proposed Removals` for user approval.

## Inputs

- `../TASK_2026_648_374e/implementation-plan.md` section "649 handoff", `decisions.md` D4-D9,
  `batches.md` follow-ups FU-648-1..3 (FU-648-2 is owned by 649).
- Add-on host contract (648 D8): 677 provides `SESSION_WORKFLOW_ADDONS` (multi token,
  `{ workflowKind, slot: inspectorSection | sessionHeaderChip | sessionHeaderAction, component }`,
  component declares `tabId = input.required<string>()`) in 677 batch B-3, not built yet. 649
  registers in the webview `app.config.ts`. 648's `[sessionHeader]`/`[sessionAddon]` embed slots
  are pass-through only.
- 652 carry-over: FU-17 (failed `chat:abort` still disposes; resolved by the D16/D17 draft design),
  FU-18 (webview-storage multi-panel limit), R1 port `rename`, MO-1..MO-6
  (`../TASK_2026_652_7284/completion-report.md` section 5). #732 manual checks still pending:
  New Project in dark and light; reload during Configure Harness restores the preview.
- Research: `../TASK_2026_647_1b0f/research/*.md`.

## Workflow (Gate 0.1, 2026-10-15)

- Type: BUGFIX per `task.md`, run as the broader flow because it replaces and redesigns surfaces:
  architect inventory-only (`parity-inventory.md`) -> designer + prototype -> cross-side review ->
  Gate 1.7 -> architect plan -> cross-side review -> Gate 2 -> team-leader -> batches -> one
  code-logic review.
- CLI lanes: enabled (user pin from 648: codex implements; code-logic review by another family,
  antigravity if it has room, else grok or opencode). Preference source: user instruction this
  session.
- Approval mode: `user` for Gates 1.7 and 2 (user approved the 648 plan directly, D2).
- Lane roster 2026-10-15: codex confirmed room (weekly 11%); grok confirmed room (weekly 30%);
  opencode near limit (monthly 92%); antigravity limit reader failed (unknown); copilot disabled;
  cursor and pi not installed; Glm (ptah-cli, Ollama Cloud) AT LIMIT, reset unknown.
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions`;
  branch for 649 is stacked on `feat/task-648-session-embed` (648 D1 precedent).

## Session 2 (2026-10-15)

- Design confirmed by the user (decisions D1, D2); follow-up TASK_2026_680_bc6c created.
- Branch `feat/task-649-builders-on-chat` created from `feat/task-648-session-embed`; #733 still
  OPEN (BLOCKED, review required).
- Lane roster: codex room (weekly 13%), grok room (weekly 40%), opencode near limit (monthly 92%),
  antigravity reader failed (unknown), Glm AT LIMIT. Designer and architect run as Claude
  subagents; their cross-side document reviews (Gates 1.7, 2) run on codex (most room). Code-logic
  review on shipping code: grok (antigravity unknown).
- 16:02 UTC: user asked antigravity to fix PR #733 (CI bundle budget + CodeRabbit comments) in
  worktree `.claude-worktrees/task-648-pr-fixes`. Lane `antigravity` (family antigravity) failed
  after 8 s: confirmed usage limit, `RESOURCE_EXHAUSTED (code 429): Individual quota reached`,
  resets in 70h46m (~2026-10-18 12:48 UTC). Skip antigravity until then.
- 16:30 UTC: messaged 677 session `ptah-ptah-extension-task-677-new-chat-vi-31eddc00002js2qeo7ft70l`
  with D1/D2 and the chrome contract request (D8, option A = `SESSION_EMBED_CHROME` token +
  embed `chrome` input). Waiting for its reply.
- Gate 1.7 review round 1: codex REVISE (design-spec-review.md), 8 findings; user decided D7 and
  D8; orchestrator decided D5, D6. Designer revision round 1 started. Reviewer lane CLI session
  for the re-review (resume): `01a14059-774b-79c2-9f6e-8b79132c0fb0`.
- 677 replied (677 decisions row 85): option B, recorded as D8.
- Gate 1.7 round 1 re-review (codex, fresh lane): REVISE, findings 4 and 5 PARTIAL. Orchestrator
  round-2 edits (§11 step 3e/3f, note 6, §5.4 rule 2). Round 2 re-review: REVISE, finding 4
  RESOLVED, finding 5 PARTIAL (reload turn attribution). Revise cap reached; goes to the user.
- PR #733 fix `c638c21fa` (codex, worktree `task-648-pr-fixes`): grok code-logic review APPROVED
  8/10, no findings (`../TASK_2026_648_374e/pr733-fix-code-logic-review.md`). All CI checks
  passed. #733 MERGED 2026-10-15 17:09 UTC as `35c80dfa0`. The 649 branch now rebases on `main`
  and its PR targets `main` (D3 retarget no longer needed). The 677 session was not reachable
  (no live session); message it when a 677 session appears.

## Session 3 (2026-10-15)

- Messaged 677 session `ptah-ptah-extension-task-677-new-chat-vi-58b5bd00002js2qeo7ft70t`:
  #733 merged as `35c80dfa0`; 649 D1/D8 unchanged; 649 PR targets `main`.
- Gate 1.7 re-presented to the user with open finding 5 and the recommended fix.
- Gate 1.7 APPROVED by the user with amendments D9 (finding 5 fix), D10 (Setup Hub home
  screen as is; only internal builder pages redesigned; §7.2 withdrawn) and D11 (sidebar
  scrolls). Next: software-architect plan.
- 18:05 UTC: user instruction relayed by the 677 session: Claude usage at 95%, so until
  2026-10-16 no Claude subagents; CLI lanes only, orchestrator plans and verifies. The Claude
  architect subagent was stopped before it wrote anything. Architect plan moved to a codex lane
  (role software-architect, agent 3549548c-65ba-45cb-9bfb-e34c5571c66e). Roster 18:07 UTC:
  codex room (weekly 16%), grok room (weekly 67%), opencode near limit (monthly 92%),
  antigravity reader failed (unknown), Glm AT LIMIT (reset unknown).
- Gate 2 document review plan: the author is a CLI lane (codex), and the opposite side
  (in-process subagent) is not allowed until 2026-10-16. Review runs same-side on grok
  (different family). Reason recorded; approval mode is `user` anyway.
- Codex architect lane delivered `implementation-plan.md` (9m 49s; CLI session
  `01a140bf-7bf9-7e13-9acc-6ad9e1c14e3b` for revise rounds). Grok plan review started
  (agent 69288181-75f3-4f6d-b290-47166ca332c8) -> `implementation-plan-review.md`.
- Grok plan review: REVISE (4 Serious: D9 capture overwritten by a later turn, cross-mode leave
  path, D11 proof not observable in jsdom, batches not file-disjoint; 1 Moderate; 1 Minor) and
  3 user decisions (abort warning, Hub confirm copy, relay error on the Hub). Grok CLI session
  `01a140c8-e1a6-7660-acdb-0c29ed369e6e`. Revise round 1 of 2 on codex (fresh lane with handoff
  brief, agent d9b65a0c-a989-45f0-b034-2e930eb44074; resume refused: context over 60k).
  Codex revision delivered (CLI session `01a140d8-394a-78a2-9288-9b5a4dc51342`).
- Grok re-review round 1: APPROVED, 6/6 findings RESOLVED, 1 new Minor (intake copy before
  intent clear), recorded in the plan's Open items. Gate 2 presented to the user with
  decisions (a) abort warning, (b) Hub confirm copy, (c) relay error on the Hub.
- Gate 2 APPROVED by the user (D12): Hub keeps its look; a1, b1, c1. Next: team-leader
  decomposition on a codex lane (no Claude subagents until 2026-10-16).

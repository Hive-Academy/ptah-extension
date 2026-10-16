# Batches - TASK_2026_677_efcd

Total tasks: 18 implementation batches + 1 measurement step (BUILD-1) | Batches: 19 | Complete: 14/19
Waves: 8 (W1-W7 implementation, W8 measurement) | Phase: one phase "clean-session-view" (all batches)
Delta 3 update (team-leader MODE 1 update, 2026-10-15): plan part D (`plan-part-d-stats.md`, Gate 2 delta APPROVED
9/10, `implementation-plan-review-delta3-r1.md`) adds batch D-1 to W3 and amends B-4, A1-3, CV-1, CV-2, B-5 in
their waves. Waves 1-2 unchanged. W3 status: B-3, A2-1, D-1 = COMPLETE after fix round 1 (MODE 2 session 7,
decisions.md rows 75-76; see "Wave 3 MODE 2 result"); W4 (A2-2, A1-2, B-4) = COMPLETE; W5 (A1-3 3582cf696,
CV-1 db7b896df) = COMPLETE (decisions rows 86-95); W6 (CV-2, B-5) next; C-3 = HOLD
until PR #733 (TASK_2026_648) merges and this branch rebases (decisions.md rows 55, 58, 62).

Root for every relative path: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`
(branch `feat/clean-session-view`). Every batch runs and is committed here. `F` = `libs/frontend`.
Plan: `implementation-plan.md` (Gate 2 APPROVED, `implementation-plan-review-r1.md`). Where the plan and a
part disagree, the plan wins (§6.3). Part files: A1 = `plan-part-a1-turn.md`, A2 = `plan-part-a2-header.md`,
B = `plan-part-b-inspector.md`, C = `plan-part-c-agents.md`. Read only the cited line ranges.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Every MODIFY / DELETE target in plan §3.3 exists and every CREATE target is absent - verified on disk
  (ls of all 38 MODIFY/DELETE paths; `agent-avatar/`, `session-agents/`, `session-inspector/`,
  `session-header/`, `molecules/turn/`, `organisms/session-inspector/`, `tasks-ui/src/presentation.ts`,
  `utils/turn-facts.utils.ts` absent; `chat/src/lib/tokens/` holds only `session-context.token.ts`).
- `AutopilotPopoverComponent` lives at `F/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`
  with a sibling spec - verified.
- `@ptah-extension/tasks-ui/services` is mapped only in `tsconfig.base.json:106` (no jest mapper) - verified;
  `/presentation` follows the same pattern. B-4 confirms chat jest resolves it.
- `canvas/src/index.ts` exports none of `CanvasSessionDetailsComponent`, `lane-owner`, lane tabs - verified (no
  barrel edit needed in B-5 or C-3).
- `CanvasSessionDetailsComponent` is used only by `canvas-rail-board.component.ts:28,63,182,209,240` and its
  spec - verified.
- `lane-owner` importers are exactly `canvas-lane-tabs.component.ts`, `canvas-lane-view.component.ts`,
  `canvas-needs-you-queue.ts` (the chat-ui `lane-usage-tile` hit is a `data-testid` string) - verified.
- `showCompactCard` computed at `chat-view.component.ts:974` - verified (CV-2 target).
- Webview project name `ptah-extension-webview`; `build` target at `project.json:9`; budgets
  `maximumError: "3.5mb"` (`:61`) and `anyComponentStyle` `maximumError: "20kb"` (`:66`) - verified.
- `canvas-rail-board.component.spec.ts:374-378` renders the real focus area with `imports: []` and
  `NO_ERRORS_SCHEMA`, so C-3's lane-tabs rewrite should not break it - verified; C-3 still runs the canvas suite.
- Agent node field equal to `SubagentRecord.parentToolUseId` (roster key for per-turn chips) - unverified; A1-3
  checks it against `openSubagentLane` (`chat-transcript.component.ts:769-791`).
- `tree.id` is the `message_start` id (A1 open check 2) - unverified; A1-4 checks, fallback keeps `Date.now()`.
- Commit convention `feat(<scopes>): batch <ID> - <desc>` - verified from `git log` (R9x, R9w, ...); scopes
  `chat`, `chat-ui`, `ui`, `chat-streaming`, `tasks-ui`, `canvas`, `webview` are in `.commitlintrc.json`.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Parallel batches of one wave share one worktree; a chat/canvas check can see another batch's half-done files | HIGH | Wave rule (below): team-leader verifies a wave once all its reports are in, runs each changed project's checks once on the combined tree, then commits batch by batch with explicit paths |
| `chat-view.component.{html,ts,css}` edited by three batches | HIGH | CV-1 -> CV-2 -> CV-3 strictly serial (W5, W6, W7); each runs the four chat-view specs |
| Three shared barrels | MEDIUM | append-only own lines, serial owners: `chat-ui/src/index.ts` C-1 (W1) -> A1-1 (W2) -> A2-2 (W4); `chat/src/lib/services/index.ts` C-2 (W2) -> B-3 (W3); `chat/src/index.ts` C-2 (W2) -> B-3 (W3) -> B-4 (W4) |
| Eager bundle ~10 kB vs ~10 kB headroom | HIGH | BUILD-1 (W8) is the one measurement; a failure needs a new user approval for a second build (row 43) |
| Per-turn chips match roster keys silently; wrong field = no chips | MEDIUM | A1-3 validation note; code-logic review checks the key |
| A1-D1 timestamp: `tree.id` not the `message_start` id | LOW | A1-4 fallback keeps `Date.now()` |
| `ownedBySession` exists twice between C-2 (W2) and C-3 (W3) | LOW | C-3 deletes `lane-owner.ts` and re-points the 3 importers |
| Latest-`TodoWrite` locator copied in B-4, source deleted in B-5 | LOW | B-4 copies verbatim from `canvas-session-details.component.ts:125-143`; B-5 deletes |
| C-3 could break `canvas-rail-board.component.spec.ts` (B-5's file) | LOW | Named exception: C-3 may add test providers there only if the canvas suite fails because of C-3, and must report it |
| CV-3 expected empty | LOW | CV-3 may close as a verified no-op (see CV-3) |
| 648 rebase conflicts (`chat-view.component.ts`, `canvas-focus-header.component.ts`, `chat/src/lib/components/index.ts`) | LOW | "After 648 merges" section (H1-H3); not batches now |
| Webview app suite (18 specs) runs in B-1 and B-3 instead of the plan's one-spec run | LOW | user rule "existing suites of every changed project" outranks plan §9; maxWorkers=2 |

Edge cases:

- Unknown or null tab -> roster is Orchestrator only, status `null` - C-2; callers guard null tab id - B-3, A1-3.
- No tab -> `needsYouCount` 0 for the live turn - A1-3.
- `formatAgentDuration` returns `null` under 1 s -> label `Worked` / `Working` - C-1, A1-2.
- Overlay band (< 960 px): sheet closed on load, on every tab/session switch and on resize into the band; never
  written to the per-tab docked choice; resize overlay -> docked with sheet open writes `manual = {open:true, mode}` - B-3, CV-1.
- `showDot()` is `null` while open; `need` > `sel` - B-3, CV-2.
- `SessionInspectorStore` map pruned when tabs close - B-3.
- Empty `SESSION_WORKFLOW_ADDONS` / no kind / no match -> no outlet - B-3 (token), B-4, CV-2.
- TASK section with no linked or unknown lead task renders nothing (row 44) - B-4.
- Reduced motion disables the stagger; late-mounted items fall back without animation - CV-2.
- `SESSION_CONTEXT` set (embed / Rail) -> chat-view hosts no inspector (`hostsInspector()` false) - CV-1, B-5.
- Tool rows render exactly as today through `ptah-execution-node` (row 32) - A1-3.
- Dock overflow keeps a `waiting` agent visible, hides a `done` one at small width - C-3.

### Plan validation - Delta 3 (MODE 1 update)

Status: PASSED WITH RISKS (Gate 2 delta APPROVED 9/10, no new Blocking or Serious finding)

Assumptions (Delta 3):

- Every D-1 CREATE target is absent and every D-1 MODIFY target exists - verified on disk 2026-10-15
  (`session-stats-view.ts`, `plan-limits/session-limit-summary.ts`, `atoms/context-ring.component.ts`,
  `session/inspector-stats/`, `background-agent-population.ts` absent; `session-stats-summary.component.ts`,
  `background-agent-strip.component.ts`, `plan-limits/{lane-usage-tile,plan-limit-tile,lane-subtotal-tile}.component.ts`
  and their specs present).
- A-D2 `LaneLimitState` literals `at-limit` / `near-limit` / `confirmed-room` / `unknown` - partly verified
  (`stats-limit-view-model.types.ts:126`, `plan-limit-tiles.ts:328-358` use `at-limit` / `near-limit`); D-1 confirms the
  full union in `lane-tiles.ts` before the exhaustive switch (D-O1).
- B-4 / CV-1 targets: `background-agent-tray.component.ts` + its two specs and `inline-agent-bubble.component.ts` (+ spec)
  exist; `chat/src/lib/services/session-stats/` absent; `services/session-agents/` holds only the C-2 files
  (`owned-by-session.ts`, `session-agent-roster{,.service}.ts`) - verified.
- `SessionBudgetState` import path for `session-stats-source.ts` - unverified; CV-1 copies it from
  `session-budget-actions.service.ts` (D3-8 assumption).
- Part B section input name `hasLaneSurface` on `inspector-agents-section` - set by B-4 itself (it creates the section).

| Risk (Delta 3) | Severity | Mitigation |
| --- | --- | --- |
| R-D1 D-1 delegation changes strip internals | MEDIUM | strip, agent-strip, lane-usage and plan-limit tile specs must pass UNCHANGED; any spec edit in D-1 is a reject reason for MODE 2 and the reviewer (Task D-1.1) |
| R-D2 W3 runs four batches incl. one lane | MEDIUM | executors run NO nx checks (row 59); MODE 2 runs each changed project's checks once on the combined tree |
| R-D3 B-4 grows (tray service, actions menu, mounts) | MEDIUM | decided now, before B-4 starts: NOT split (see Decisions); B-4 keeps one Claude executor and one project |
| R-D4 barrel orders `chat-ui` C-1 -> A1-1 -> D-1 -> A2-2; `chat` C-2 -> B-3 -> B-4 -> CV-1 | MEDIUM | wave order forces both (D-1 W3, A2-2 W4; B-3 W3, B-4 W4, CV-1 W5); append-only lines |
| R-D5 one source per value | MEDIUM | reviewer focus: no template outside the chat-ui pure layer formats context, tokens, cost, limit state (plan §9 risk 9) |
| R-D6 showcase scenes `canvas-orchestra.scene.ts:154`, `chat-code-edit.scene.ts:121` locate the strip | LOW | out of 677 scope (no e2e run); orchestrator records it in the handoff |
| Plan-limits refresh scope | MEDIUM | stays a chat-view field (C-39); reject any `registerScope` in the inspector, the source factory or the Rail board (CV-1, B-5) |
| D-O6 Rail board closed-state cue | LOW | B-5 reports to the orchestrator if the Rail aside can close while a limit is near/at; no invented cue |
| C-3 waits for PR #733; B-5 (W6) depends on C-3 | MEDIUM | C-3 floats (Wave rule): it joins the first wave that starts after #733 merges and the branch rebases; if #733 is not merged when W6 is due, MODE 2 stops before W6 and escalates |
| R2 removal of the tray component | LOW | user-approved (row 64); CV-1 renames the two specs with the same cases; parity rows C-6, C-40..C-48 checked in Mode 3 |

Edge cases (Delta 3):

- Unknown context / no live stats -> `—`, `No data yet`, no ring, no progressbar role; never `0` - D-1.
- `limits` null -> PLAN LIMITS / LANES omitted, `limitSummary.state = 'none'`, no chip / dot change / alert - D-1, B-4, CV-2.
- Main panel has no tab: stats come from the ChatStore branch, `inputs` null only when the view has no messages - CV-1.
- Tray action on a vanished context no-ops; steer `finally` clears `pendingSteerId`; menu returns focus - B-4.
- Completed foreground sub-agent keeps its model via `agentModelsByKey`; no Focus without a tray context (D-13) - B-4.
- `limitAwareDot`: `null` while open; pending `need` > `err` (at) > `need` (near) > base - D-1, CV-2.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Executor for every batch: Claude `frontend-developer` sub-agent (W1-W2; superseded for D-1 and C-3 by the Delta 3 rows below, USER row 60) | CLI lane (default) | user rule: Claude builds the frontend, CLI lanes only review (team-leader prompt; plan §1 line 19) | yes |
| 8 waves, max 3 parallel batches per wave, file-disjoint incl. barrels | plan §5 orders 1-10 as-is | plan §5 allows 4 in order 1; cap 3 moves A1-4 to W2; A2-1 stays in W3 per §5 | yes |
| A1-2 also depends on C-2 | plan §5 (A1-1, C-1 only) | chips consume `SessionAgent` (plan §2.2 C2 / "A1 consumption"); no ordering cost (A1-2 is W4) | yes |
| Wave-level verification, per-batch commits | verify and commit each batch alone | shared worktree; a per-batch check sees the sibling's uncommitted files | yes |
| Full webview test target in B-1 and B-3 | plan §9 one-spec run | team-leader prompt: existing suites of every changed project run per batch | yes |
| BUILD-1 after CV-3 (W8), label `webview-bundle` | right after B-5 | B-5 is the last Part B batch (W6); W8 still follows it and measures every eager delta | yes |
| CV-3 may close as a no-op without a commit | force an empty commit | plan §3.1 "None expected"; Mode 3 accepts `Commit: none (verified no-op)` for CV-3 only | yes |
| C-3 owns `canvas-focus-area.component.spec.ts` | leave to B-5 | C §handoff: stub input `sessionId` -> `tabId` (`:59-69`) follows C-3's binding change | yes |
| Delta 3: row 1 superseded for D-1 and C-3: D-1 on a CLI lane (`codex`, role frontend-developer); C-3 lane-suitable (`codex` or `grok`, ONE lane for the whole batch); every other remaining batch stays Claude `frontend-developer` | all Claude; more lane batches | USER row 60; plan §5 lane table (`implementation-plan.md:317-326`); Gate 2 delta ruling (`implementation-plan-review-delta3.md:21-29`) | yes |
| Delta 3: a lane-built batch is reviewed by a different family than its builder (D-1 codex -> Claude `code-logic-reviewer` or a grok lane); Claude-built batches keep the codex phase review | one codex review for all | USER row 60 | yes |
| Delta 3: max 4 batches per wave (W3 = B-3, A2-1, D-1, C-3) | max 3 | orchestrator brief; plan §5 "No wave grows past 4" | yes |
| Delta 3: executors of a parallel wave run NO nx checks; `ptah_get_diagnostics` scoped to their files only; MODE 2 runs each changed project's test / typecheck / lint once on the combined tree | executors run their own scoped checks | decisions.md row 59 (applied in W2, kept for W3-W7); one-heavy-check rule | yes |
| Delta 3: C-3 floats on HOLD - starts in the first wave after PR #733 merges and the branch rebases (rebase only between waves, clean tree); latest before W6 (B-5 depends on it) | keep C-3 pinned to W3 and block W4 | rows 55, 58, 62; C-3 is file-disjoint from every W4 / W5 batch (canvas only); W4 has 3 batches and W5 2, so adding C-3 keeps <= 4 | yes |
| Delta 3: B-4 NOT split | split agents additions into a new batch owning `inspector-agents-section` | plan §9 risk 8 / R-D3 (decide before B-4 starts); a split batch must precede CV-1 (CV-1 deletes the tray and renames its specs onto B-4's service files) and B-4's `session-inspector` imports the section, so a split adds one serial step to W4/W5 for one project; D-1 already delivers the finished SESSION / LIMITS sections | yes (split before B-4 starts if its executor reports overrun) |
| Delta 3: D-1 exceeds the 6-file batch guide (6 CREATE, 3-5 MODIFY, 1 barrel) | split D-1 | one project (`chat-ui`), plan D6 defines it as one lane batch with one contract D3-1..D3-7; splitting would put two owners on the chat-ui barrel in one wave | yes |
| Delta 3: CV-3 cannot fold into W6 as a batch; it stays W7 but closes inside the W6 MODE 2 invocation when A1-3 reported no chat-view binding | fold CV-3 into CV-2; run CV-3 parallel with CV-2 | CV-3 edits CV-2's files (chat-view chain is strictly serial, plan §3.1, §9 risk 1); plan §3.1 "None expected" and CV-3's only input is A1-3's report (W5); folding its scope into CV-2 would move A1's ownership to A2 contrary to §3.1 | yes |

## Wave rule (applies to W1-W7)

- The orchestrator spawns the wave's batches in parallel (at most 4 per wave: Claude `frontend-developer`
  sub-agents, and for D-1 / C-3 one CLI lane each, at most 3 lanes at once), waits for all of them, then
  re-invokes team-leader (Mode 2) once with every report path of the wave.
- **Executors in a parallel wave run NO nx checks (decisions.md row 59).** They use `ptah_get_diagnostics` scoped
  to their own files only. The "Scoped checks" listed in each batch are run by the team-leader in MODE 2, once per
  changed project on the combined tree, one heavy check at a time. A diagnostic located in another batch's file is
  reported, not fixed.
- Team-leader verifies each batch on disk, runs each changed project's test, typecheck and lint once on the
  combined tree, then commits each batch separately in the foreground with explicit paths. The next wave starts
  only after every batch of the current wave is COMPLETE.
- Exception C-3 (HOLD): it is not part of the W3 completion condition. It starts in the first wave that begins
  after PR #733 merges and this branch rebases onto main (rebase only between waves, on a clean tree, never while
  an executor runs). If #733 is still open when W6 is due, MODE 2 stops before W6 and escalates (B-5 needs C-3).

## STRICT executor rules

Quoted verbatim in every batch's "Executor notes (STRICT)" below; the orchestrator pastes that block into each
executor prompt.

## Wave 1 - C-1, B-1, B-2 (parallel)

- Verified (team-leader Mode 2): files on disk match each batch; no stub markers; no new spec files.
  Combined-tree checks, 6 projects (chat-ui, ui, ptah-extension-webview, tasks-ui, shared, task-specs),
  `--parallel=1 --skip-nx-cache`: typecheck, lint, test (`--maxWorkers=2`) all exit 0, header N = 6.
  The full webview test target passes now that the `node_modules` junction exists (decisions.md row 53).
  B-2 also owns `libs/shared/src/lib/types/task-spec.contract.ts` (decisions.md row 52, option b).

## Batch C-1: agent avatar vocabulary + monogram helpers (chat-ui, ui) - COMPLETE (commit dde4204b7)

- Wave: W1 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (one executor; parallel with B-1, B-2)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex (different family)
- Rationale: types and helpers that A1, B and C consume; first owner of the `chat-ui` barrel
- Tasks: 1 | Depends on: none
- Phase: clean-session-view | Phase review: code-logic (codex), style for new public API (see Phase review)

### Task C-1.1: create `ptah-agent-avatar` vocabulary and ui monogram helpers - COMPLETE

- Files:
  - CREATE `F/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.types.ts`
  - CREATE `F/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts`
  - CREATE `F/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts`
  - CREATE `F/chat-ui/src/lib/atoms/agent-avatar/agent-marks.ts`
  - CREATE `F/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts`
  - MODIFY `F/chat-ui/src/index.ts` (shared barrel, 1st owner; append-only own lines)
  - MODIFY `F/ui/src/lib/native/monogram-tile/index.ts`
- Plan reference: implementation-plan.md:58-71 (contract C1); C:121-224 (§1), C:293-304 (§3); decision D-C-1
  (implementation-plan.md §8, orchestrator avatar always lucide `Workflow`)
- Pattern to follow: `ptah-provider-mark` usage for CLI marks; `import type { LucideIconData } from 'lucide-angular'`
  (`F/chat/src/lib/settings/providers/setting-scope-row.component.ts:10`)
- Quality requirements: exactly one `cliId -> providerId` table; exhaustive status switches; no `Needs you` /
  `Error` status word in any avatar view; `host: { 'aria-hidden': 'true' }`, no outputs; sizes 24 | 28 | 32
- Validation notes: `formatAgentDuration(ms)` returns `null` under 1 s (A1 depends on it); unknown `agentType` ->
  `Bot`; unknown `cliId` -> monogram
- Existing specs to update: none expected; `chat-ui` `dependency-boundaries.spec.ts` must stay green
- Acceptance: all C1 exports (`AGENT_KIND_LABEL`, four `*StatusWord` mappers, `formatAgentDuration`,
  `agentAccessibleLabel`, `cliMarkFor`, `roleIconFor`, `AgentAvatarComponent` and types) importable from
  `@ptah-extension/chat-ui`; monogram helpers exported from the `monogram-tile` barrel
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs c1-test -- npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (header must say "Running target test for 2 projects")
  - `node .ptah/tmp/check-run.mjs c1-typecheck -- npx nx run-many -t typecheck -p @ptah-extension/chat-ui @ptah-extension/ui --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs c1-lint -- npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/ui --parallel=1 --skip-nx-cache`
- Commit: `feat(chat-ui,ui): batch C-1 - agent avatar vocabulary, monogram helpers`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch B-1: per-theme status-ink tokens (webview app) - COMPLETE (commit bc513eb5a)

- Wave: W1 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with C-1, B-2)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: mechanical token paste; inspector rows and chips read these utilities
- Tasks: 1 | Depends on: none
- Phase: clean-session-view | Phase review: as phase

### Task B-1.1: add per-theme status-ink tokens and tailwind utilities - COMPLETE

- Files:
  - MODIFY `apps/ptah-extension-webview/src/styles.css`
  - MODIFY `apps/ptah-extension-webview/tailwind.config.js`
  - MODIFY `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts` (existing spec, intended update)
- Plan reference: B:103-126 (§1); decisions rows 15, D24
- Pattern to follow: existing `state-*` tokens in `styles.css` and their tailwind mapping
- Quality requirements: dark and light values per theme; contrast spec covers each new ink
- Validation notes: `bg-state-need` is used by the header dot (B-3/CV-2); names must match B §1 exactly
- Existing specs to update: `state-ink-contrast.spec.ts` (listed above)
- Acceptance: tokens exist for both themes; tailwind exposes them; contrast spec passes
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b1-test -- npx nx test ptah-extension-webview --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b1-typecheck -- npx nx typecheck ptah-extension-webview --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b1-lint -- npx nx lint ptah-extension-webview --parallel=1 --skip-nx-cache`
- Commit: `feat(webview): batch B-1 - per-theme status-ink tokens`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch B-2: tasks-ui `/presentation` secondary entry + tasks-changed feed - COMPLETE (commit 34776d93d)

- Wave: W1 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with C-1, B-1)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: narrow entry the inspector TASK section imports; only batch touching `tsconfig.base.json`
- Tasks: 1 | Depends on: none
- Phase: clean-session-view | Phase review: as phase

### Task B-2.1: create `@ptah-extension/tasks-ui/presentation` and the tasks-changed feed - COMPLETE

- Files:
  - CREATE `F/tasks-ui/src/presentation.ts`
  - CREATE `F/tasks-ui/src/lib/tasks-changed.ts`
  - CREATE `F/tasks-ui/src/lib/task-stage.ts`
  - CREATE `F/tasks-ui/src/lib/services/tasks-changed-feed.service.ts`
  - MODIFY `tsconfig.base.json` (one path entry next to `@ptah-extension/tasks-ui/services`, `:106-107`)
  - MODIFY `F/tasks-ui/src/lib/services/tasks-store.service.ts`
- Plan reference: B:127-173 (§2); implementation-plan.md §4 rows B O4, B O5 (stage ladder `task-spec.contract.ts:74-96`)
- Pattern to follow: `@ptah-extension/tasks-ui/services` secondary entry (`tsconfig.base.json:106-107`)
- Quality requirements: `/presentation` exposes no store internals; tasks-store behaviour unchanged except the
  feed emission
- Validation notes: grep jest configs for `tasks-ui/services`; none map it today (verified), so add no mapper
  unless the chat suite fails in B-4
- Existing specs to update: tasks-store specs only if they assert the changed emission
- Acceptance: alias resolves in typecheck; tasks-ui suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b2-test -- npx nx test @ptah-extension/tasks-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b2-typecheck -- npx nx typecheck @ptah-extension/tasks-ui --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b2-lint -- npx nx lint @ptah-extension/tasks-ui --parallel=1 --skip-nx-cache`
- Commit: `feat(tasks-ui): batch B-2 - presentation entry, tasks-changed feed`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 2 - C-2, A1-1, A1-4 (parallel; after W1)

- Verified (team-leader Mode 2): files on disk match each batch; no stub markers; no new spec files.
  Combined-tree checks, 3 projects (chat, chat-ui, chat-streaming), `--parallel=1 --skip-nx-cache`:
  typecheck, lint, test (`--maxWorkers=2`) all exit 0, header N = 3.
  Accepted deviations: C-2 did not touch `F/chat/src/index.ts` (it already re-exports `./lib/services`);
  A1-1 did not add `formatCostUsd` (cost text reuses `formatUsdCost` from `@ptah-extension/shared`) and
  left the bubble's compaction literal for A1-3 to switch to `isCompactionContinuationMessage`.
  For the phase reviewer: C-2 runtime-unknown status reads `stopped` in the roster but `running` in compact
  rows; a permission whose `agentToolCallId` matches no owned agent is attached to no roster row.

## Batch C-2: session agent roster + lane status delegation (chat) - COMPLETE (commit 3db987a97)

- Wave: W2 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A1-1, A1-4)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: roster consumed by B-3, C-3, A1-2, A1-3; first owner of two chat barrels
- Tasks: 1 | Depends on: C-1
- Phase: clean-session-view | Phase review: as phase

### Task C-2.1: create `SessionAgentRosterService`, roster builder, `ownedBySession`; delegate `laneStatus` - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/services/session-agents/session-agent-roster.ts`
  - CREATE `F/chat/src/lib/services/session-agents/session-agent-roster.service.ts`
  - CREATE `F/chat/src/lib/services/session-agents/owned-by-session.ts`
  - MODIFY `F/chat/src/lib/services/index.ts` (shared barrel, 1st owner; append-only)
  - MODIFY `F/chat/src/index.ts` (shared barrel, 1st owner; append-only)
  - MODIFY `F/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts` (`laneStatus` only)
- Plan reference: implementation-plan.md:73-84 (contract C2); C:225-292 (§2), C:305-317 (§4); D-C-3, D-C-4
- Pattern to follow: `canvas-detail/lane-owner.ts` (move `ownedBySession` unchanged; canvas copy deleted in C-3)
- Quality requirements: roster order Orchestrator, sub-agents, CLI, background; `roster()` is a plain
  signal-reading method; sub-agent `pending`/`paused` -> `queued`; `buildLaneSummary` unchanged
- Validation notes: unknown tab -> Orchestrator only with status `null`; exact membership parity with today's lanes
- Existing specs to update: none expected (`compact-lane-rows.spec.ts` must stay green unchanged)
- Acceptance: `SessionAgentRosterService`, `SessionAgent`, `ownedBySession` importable from `@ptah-extension/chat`
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs c2-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs c2-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs c2-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch C-2 - session agent roster, lane status mapping`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch A1-1: turn utils + chat-ui formatter export - COMPLETE (commit b9d47a8df)

- Wave: W2 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with C-2, A1-4)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: pure utils A1-2/A1-3 build on; second owner of the `chat-ui` barrel
- Tasks: 1 | Depends on: C-1
- Phase: clean-session-view | Phase review: as phase

### Task A1-1.1: create turn-facts / turn-answer-split utils; extract `formatTokenCount`, `formatCostUsd` - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/utils/turn-facts.utils.ts`
  - CREATE `F/chat/src/lib/utils/turn-answer-split.utils.ts`
  - MODIFY `F/chat-ui/src/lib/atoms/token-badge.component.ts`
  - MODIFY `F/chat-ui/src/lib/atoms/cost-badge.component.ts`
  - MODIFY `F/chat-ui/src/index.ts` (shared barrel, 2nd owner; append-only)
- Plan reference: A1:46-82 (turn-facts, turn-answer-split), A1:168-174 (formatters); implementation-plan.md:113-114
  and §6.2 M-6 (use `formatAgentDuration`, no `formatTurnElapsed`); D-A1-2 (`E = max(timestamp + duration)`)
- Pattern to follow: existing pure utils in `F/chat/src/lib/utils/`
- Quality requirements: formatter extraction is behaviour-preserving; utils are pure
- Validation notes: no `TurnAgentChip` type, no `providerId` field (plan §6.3 override)
- Existing specs to update: none expected (token/cost badge specs stay green)
- Acceptance: formatters exported from `@ptah-extension/chat-ui`; utils compile and are used only by later A1 batches
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a11-test -- npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (header: 2 projects)
  - `node .ptah/tmp/check-run.mjs a11-typecheck -- npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a11-lint -- npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
- Commit: `feat(chat,chat-ui): batch A1-1 - turn facts utils, shared formatters`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch A1-4: finalization message-start timestamp (chat-streaming) - COMPLETE (commit 49c153d69)

- Wave: W2 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with C-2, A1-1)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: independent one-file fix in its own project (moved from W1 by the 3-per-wave cap)
- Tasks: 1 | Depends on: none
- Phase: clean-session-view | Phase review: as phase

### Task A1-4.1: pass the message-start timestamp on live finalization (A1-D1) - COMPLETE

- Files:
  - MODIFY `F/chat-streaming/src/lib/message-finalization.service.ts` (`:198-242`)
  - MODIFY (only if they assert `Date.now()` timestamps) `F/chat-streaming/src/lib/message-finalization.service.spec.ts`,
    `message-finalization.session-history.spec.ts`, `message-finalization.retention.spec.ts`,
    `message-finalization.cross-workspace.spec.ts`
- Plan reference: A1:175-180; A1 decisions A1-D1 (A1:284-316); implementation-plan.md §8 D-A1-1, §9 risk 5
- Pattern to follow: `history-message-builder.service.ts:216` (history timestamp), `factories.ts:37` default
- Quality requirements: live finalized timestamp equals the reloaded one; fallback keeps `Date.now()`
- Validation notes: confirm `tree.id` is the `message_start` id (A1 open check 2); if not, keep the fallback and
  report it
- Existing specs to update: the finalization specs above, only where they assert the old timestamp
- Acceptance: "Worked for" identical live and after reload; chat-streaming suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a14-test -- npx nx test @ptah-extension/chat-streaming --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a14-typecheck -- npx nx typecheck @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a14-lint -- npx nx lint @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache`
- Commit: `fix(chat-streaming): batch A1-4 - keep message start time on finalize`
- Executor notes (STRICT):
  - Run checks only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 3 - B-3, A2-1, D-1 (parallel; after W2) + C-3 (HOLD, PR #733)

- Status: B-3, A2-1, D-1 = COMPLETE (MODE 2 session 7, after fix round 1; commits `cd37b5a44`, `567a62a3f`,
  `9e36b8753`; decisions.md rows 68-76). C-3 = HOLD until PR #733 (TASK_2026_648) merges and this branch rebases (rows 55, 58, 62; #733 still
  OPEN at this update); C-3 is not part of the W3 completion condition.
- File-disjoint: B-3 (chat services, tokens, both chat barrels, webview `app.config.ts`), A2-1 (one new chat
  molecule), D-1 (chat-ui only, chat-ui barrel 3rd owner), C-3 (canvas only). No file is edited by two W3 batches.
- Executors run NO nx checks (row 59); MODE 2 runs: `@ptah-extension/chat`, `ptah-extension-webview`,
  `@ptah-extension/chat-ui` (+ `@ptah-extension/canvas` when C-3 lands) - test, typecheck, lint, once each.
- Reviews: B-3, A2-1 (Claude-built) -> codex phase review; D-1 (codex-built) -> Claude `code-logic-reviewer` or a
  grok lane; C-3 -> a family different from the lane that builds it.

### Wave 3 MODE 2 result (session 6) - NOT ACCEPTED, fix round 1

- File map (git status, 11 modified + 14 new source files, none unmapped): B-3 = `app.config.ts`, both chat barrels,
  `session-git-stats.store{,.spec}.ts`, `services/session-inspector/*` (6), `tokens/session-workflow-addons.token.ts`;
  A2-1 = `molecules/session-header/session-header.component.ts`; D-1 = chat-ui barrel, `background-agent-strip`,
  `session-stats-summary`, `plan-limits/{lane-usage,plan-limit,lane-subtotal}-tile`, `context-ring`,
  `background-agent-population`, `inspector-stats/*` (2), `session-limit-summary`, `session-stats-view`.
- On-disk check: real implementations, no TODO / stub / placeholder markers; chat-ui never imports chat; no chat-ui
  spec edited (R-D1 holds); TasksChangedFeed registered once (`app.config.ts:259`).
- `w3-typecheck` (3 projects): webview PASS; chat-ui FAIL, chat FAIL (chat fails on its own A2-1 file and on the D-1
  file through the chat-ui path). No B-3 file has an error; no other error in the log.
- `w3-lint` (3 projects): chat PASS; chat-ui FAIL (2 errors); webview FAIL (1 error).
- `w3-test` (3 projects, `--coverage=false --maxWorkers=2`): PASS for chat, chat-ui, webview (exit 0).
- Defects (fix round 1; each batch is fixed by the executor that built it; the fix files are disjoint, so the three
  fixes may run in parallel; MODE 2 then re-runs the three checks once):
  - A2-1 (typecheck TS2349) `session-header.component.ts:83,85`: the template ref `#title` (:80) shadows the `title`
    input, so `title()` is not callable. Fix: rename the ref (e.g. `#titleRef`) and the query string in
    `viewChild<ElementRef<HTMLElement>>('title')` (:160). Keep the public `titleEl` name.
  - D-1 (typecheck TS2339) `inspector-session-stats.component.ts:133-134`: `row.input` / `row.output` do not exist on
    the `modelUsageList` row. Fix: `row.inputTokens` / `row.outputTokens` (the fields `session-model-breakdown`
    shows under the same "Uncached input tokens" / "Output tokens" titles).
  - D-1 (lint `@angular-eslint/template/no-duplicate-attributes`) `lane-usage-tile.component.ts:155-156`: the new
    `linkPlanTiles` button has a static `class` and `[class]`. Fix: one class binding (fold the static classes into
    the bound expression); the default `<span>` branch stays byte-identical; specs unchanged (R-D1).
  - B-3 (lint `@nx/enforce-module-boundaries`) `app.config.ts:100`: static import of lazy-loaded `@ptah-extension/
    tasks-ui/presentation`. Fix (row 72): add `'@ptah-extension/tasks-ui/presentation'` to
    `checkDynamicDependenciesExceptions` in `eslint.config.mjs:279-284` with a short comment in the existing block
    (narrow entry: constants, pure functions and one `MESSAGE_HANDLERS` service, no components). `eslint.config.mjs`
    joins B-3's file list for this fix.
- Minor (recorded, not fixed): lint warning `inspector-session-stats.component.ts:195` non-null assertion (new file);
  A2-1 `--sel` in the dot colour is never defined, so it always resolves to `--ptah-gold` (row 71).

### Wave 3 MODE 2 result (session 7) - ACCEPTED after fix round 1

- Fix round 1: one fresh Claude frontend-developer fixed all 4 defects (`reports/batch-W3-fix-1.md`; row 75).
- On-disk check: `session-header.component.ts:80,160` ref `#titleRef` / `viewChild('titleRef')`;
  `inspector-session-stats.component.ts:133-134` `row.inputTokens` / `row.outputTokens`, `:195` local `primary`
  (row-68 minor also cleared, row 76); `lane-usage-tile.component.ts:154-162` one `[class]` binding on the new
  button, the `@else` `<span>` is context-only in `git diff` (byte-identical to pre-D-1); `eslint.config.mjs:284-285`
  `'@ptah-extension/tasks-ui/presentation'` with a one-line comment (row 72).
- `w3-typecheck`, `w3-lint`, `w3-test` (`run-many`, header N = 3, `--parallel=1 --skip-nx-cache`, Jest
  `--coverage=false --maxWorkers=2`): all exit 0; lint 0 warnings.
- Commits (foreground, explicit paths, import-independent so each compiles alone): B-3 `cd37b5a44` (incl.
  `eslint.config.mjs`), A2-1 `567a62a3f`, D-1 `9e36b8753`. Reports go with the docs commit.
- Review family (row 75): B-3, A2-1 (Claude) -> codex in the phase review; D-1 (codex-built, fix lines Claude-written)
  -> grok, else the D-1 review carries a weaker-evidence label. Still open (row 71): A2-1 `--sel` minor.

## Batch B-3: inspector services, add-on token, git branch (chat, webview app) - COMPLETE (commit cd37b5a44)

- Wave: W3 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A2-1, D-1; C-3 on HOLD)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (existing chat services, shared barrels, webview `app.config.ts`); row 60 keeps shared-barrel edits with Claude
- Delta 3: NOT amended (plan §5, M-10): `OrchestratorCardModel` model / context / tokens / cost fields are still built
  but B-4 does not render them (§6.3); `showDot()` stays as specified - CV-2 composes `limitAwareDot` outside B-3
- Review family: implementer Claude; phase reviewer codex
- Rationale: the store, open-state and shell controller that A1-3, A2-2, B-4, CV-1 and B-5 bind to; second owner of
  both chat barrels
- Tasks: 1 | Depends on: C-2 (and B-1 committed, since it shares the webview project)
- Phase: clean-session-view | Phase review: as phase

### Task B-3.1: create session-inspector services, `SESSION_WORKFLOW_ADDONS`, git `branch` + `sessionBranch` - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/services/session-inspector/session-inspector.types.ts`
  - CREATE `F/chat/src/lib/services/session-inspector/session-inspector-requests.ts`
  - CREATE `F/chat/src/lib/services/session-inspector/session-inspector.store.ts`
  - CREATE `F/chat/src/lib/services/session-inspector/inspector-open-state.service.ts`
  - CREATE `F/chat/src/lib/services/session-inspector/inspector-shell.controller.ts`
  - CREATE `F/chat/src/lib/services/session-inspector/index.ts`
  - CREATE `F/chat/src/lib/tokens/session-workflow-addons.token.ts`
  - MODIFY `F/chat/src/lib/services/session-git-stats/session-git-stats.store.ts` (+ `session-git-stats.store.spec.ts`)
  - MODIFY `F/chat/src/lib/services/index.ts` (shared barrel, 2nd owner; append-only)
  - MODIFY `F/chat/src/index.ts` (shared barrel, 2nd owner; append-only)
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts` (provider change only)
- Plan reference: implementation-plan.md:97-111 (B1, B2 contracts), §3.2 :195 (git seam), :260-269 (rows 38 dot and
  open contract), :421-446 (§7.2 token) (line refs re-pointed in MODE 2 session 6, row 73), §6.2 M-3 (`sessionWorkflowKind` returns `null` on main); B:174-306 (§3-4)
- Pattern to follow: `F/chat/src/lib/tokens/session-context.token.ts`; `session-git-stats.store.ts:55-70` (`toState`)
- Quality requirements: one `ResizeObserver` per controller with `disconnect()` on destroy; store map pruned on tab
  close; `showDot()` null while open, `need` > `sel`; `toggleLabel` never changes with the dot; A2 never starts git
  tracking
- Validation notes: overlay rules (sheet closed on load / tab switch / resize into band, never written to per-tab
  choice); `needsYouCount` = unique open request ids + `waiting` lanes with no open request;
  `PermissionRequest.agentToolCallId` at `libs/shared/src/lib/types/permission.types.ts:58`; 677 registers no add-on
- Existing specs to update: `session-git-stats.store.spec.ts` (`known` state gains `branch`)
- Acceptance: B1/B2 contracts, token, `sessionWorkflowKind`, `sessionBranch` importable from `@ptah-extension/chat`;
  webview typecheck green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b3-test -- npx nx run-many -t test -p @ptah-extension/chat ptah-extension-webview --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (header: 2 projects)
  - `node .ptah/tmp/check-run.mjs b3-typecheck -- npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b3-lint -- npx nx run-many -t lint -p @ptah-extension/chat ptah-extension-webview --parallel=1 --skip-nx-cache`
- Commit: `feat(chat,webview): batch B-3 - inspector store, controller, add-ons`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch C-3: agent dock rewrite (canvas) - COMPLETE (commit 8ef9bbe26)

- Wave: W3 (floating, see Wave rule exception) | Recommended executor: CLI lane, capability frontend-developer
  (`codex` or `grok`, whichever has room at spawn time; USER row 60); ONE lane builds the WHOLE batch
- HOLD: do not start until PR #733 (TASK_2026_648) merges and `feat/clean-session-view` rebases onto main (decisions.md
  rows 55, 58, 62; #733 OPEN at this update). 648 rewrites `canvas-lane-view.component.spec.ts` and touches canvas
  files this batch edits; building before the rebase means building twice. After the rebase, re-verify the C-3
  file list against main before spawning.
- Execution mode: sequential, one lane (ownership guard: no other lane or agent edits a C-3 file while it runs)
- Fallback order: other lane family with frontend capability -> Claude `frontend-developer` sub-agent
- Subagent reason: N/A (lane-suitable per plan §5 table, Gate 2 delta ruling)
- Review family: a family different from the builder (codex-built -> Claude `code-logic-reviewer` or grok lane;
  grok-built -> codex lane or Claude)
- Lane brief: before spawning, the orchestrator gives the lane this batch section verbatim plus absolute paths
  (root `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`, `F` = `libs\frontend`), the cited
  `plan-part-c-agents.md` ranges by absolute path, and the Executor notes below; workingDirectory = the worktree root
- Rationale: canvas-only rewrite on top of the roster and avatar; disjoint from chat batches
- Tasks: 1 | Depends on: C-1, C-2 (COMPLETE), PR #733 merged + rebase
- Phase: clean-session-view | Phase review: as phase (C-3 gets its own different-family code-logic review)

### Task C-3.1: rewrite `ptah-canvas-lane-tabs` as the agent dock; add card, menu, overflow; delete `lane-owner.ts` - COMPLETE

- Files:
  - REWRITE `F/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` (+ `canvas-lane-tabs.component.spec.ts`)
  - CREATE `F/canvas/src/lib/canvas-detail/agent-dock-card.component.ts`
  - CREATE `F/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts`
  - CREATE `F/canvas/src/lib/canvas-detail/dock-overflow.ts`
  - MODIFY `F/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts` (one binding `sessionId` -> `tabId`)
    (+ `canvas-focus-area.component.spec.ts:59-69` stub input `sessionId` -> `tabId`)
  - MODIFY `F/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (import re-point)
  - MODIFY `F/canvas/src/lib/canvas-needs-you-queue.ts` (import re-point)
  - DELETE `F/canvas/src/lib/canvas-detail/lane-owner.ts`
- Plan reference: C:318-436 (§5-6); C:512-570 (handoff: spec updates); D-C-2 (`displayName || cli`), D-C-4
- Pattern to follow: Floating UI service `floating-ui.service.ts:41-84`; `compact-lane-rows.ts:68` label rule
- Quality requirements: WCAG 1.4.13 hover/focus card; one ResizeObserver with `disconnect()` on destroy; no per-id
  template branch; dock avatars size 28; `ownedBySession` imported from `@ptah-extension/chat`
- Validation notes: hover card must flip/clamp inside a 400 / 760 px pane (visual review); `canvas-rail-board.component.spec.ts`
  is B-5's file: edit it only if the canvas suite fails there because of C-3 (add providers only) and report it
- Existing specs to update: `canvas-lane-tabs.component.spec.ts` (providers `TabManagerService`,
  `PermissionHandlerService` mocks; `setInput('sessionId')` -> `setInput('tabId')`; status in `aria-label`;
  ResizeObserver capacity), `canvas-focus-area.component.spec.ts:59-69`; expected unchanged
  `canvas-lane-view.component.spec.ts`, `canvas-needs-you-queue` spec(s)
- Acceptance: no file imports `lane-owner`; dock keeps a `waiting` agent and hides a `done` one at small width
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs c3-test -- npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs c3-typecheck -- npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs c3-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`
- Commit: `feat(canvas): batch C-3 - agent dock, hover card, overflow menu`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch A2-1: session header molecule (chat) - COMPLETE (commit 567a62a3f)

- Wave: W3 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with B-3, D-1; C-3 on HOLD)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (header contract is revisited by CV-2; one owner family avoids drift)
- Review family: implementer Claude; phase reviewer codex
- Delta 3: NOT amended (M-11). CV-2 is the named SECOND owner of `session-header.component.ts` and adds the four
  delta-3 inputs (`inspectorDot` incl. `'err'`, `limitCue`, `contextRingPercent`, `toggleDescription`). A2-1 builds
  the A2 contract only; keep the dot input and the toggle markup easy to extend (no closed union in a private helper)
- Rationale: one new presentational file; no barrel (chat-view imports it relatively in CV-2)
- Tasks: 1 | Depends on: none (placed in W3 per plan §5)
- Phase: clean-session-view | Phase review: as phase

### Task A2-1.1: create `SessionHeaderComponent` - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/components/molecules/session-header/session-header.component.ts`
- Plan reference: A2:29-45 (component 1), A2:142-157 (exact edits row 1), A2:158-193 (binding contract);
  implementation-plan.md §6.2 M-5 (presentational, inputs only), §8 D-A2-1 (no sidebar toggle)
- Pattern to follow: existing molecules in `F/chat/src/lib/components/molecules/`
- Quality requirements: inputs/outputs only, no injected controller; icons `PanelRight`, `GitBranch`; container
  query `@container (max-width: 639px)` hides the branch chip; dot `aria-hidden`; two `ng-content` slots for
  `sessionHeaderChip` / `sessionHeaderAction`; count chip copy `1 needs you` / `2 need you`
- Validation notes: binds `showDot` directly (no `inspectorDot` guard, plan §6.3); exposes toggle and title element
  refs for `controller.attach` (CV-2)
- Existing specs to update: none (not yet rendered anywhere)
- Acceptance: compiles standalone, OnPush; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a21-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a21-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a21-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch A2-1 - session header molecule`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch D-1: inspector stats presentation (chat-ui; Delta 3) - COMPLETE (commit 9e36b8753)

- Wave: W3 (4th batch) | Recommended executor: CLI lane `codex`, role frontend-developer (USER row 60; plan §5 lane
  table; Gate 2 delta ruling `implementation-plan-review-delta3.md:21-29`)
- Execution mode: sequential, one lane (parallel with B-3, A2-1)
- Fallback order: grok lane (frontend capability) -> Claude `frontend-developer` sub-agent
- Subagent reason: N/A (lane-suitable: new self-contained chat-ui files, behaviour-preserving delegations guarded by
  unchanged specs, one mechanical barrel append with exact names)
- Review family: implementer codex -> reviewer Claude (`code-logic-reviewer`) or a grok lane; never codex
- Rationale: builds the pure stats layer, limit summary, context ring and the SESSION / PLAN LIMITS / LANES sections
  that B-4 mounts, CV-1's source returns and CV-2's header cues read; file-disjoint from B-3, A2-1, C-3
- Tasks: 1 | Depends on: C-1, A1-1 (COMPLETE; chat-ui barrel order C-1 -> A1-1 -> D-1 -> A2-2)
- Phase: clean-session-view | Phase review: as phase + its own different-family code-logic review (new public API in
  `@ptah-extension/chat-ui`, so style focus on the exports too)

### Task D-1.1: pure stats layer, limit summary, context ring, inspector stats sections, population helper - COMPLETE

- Files (root `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`, `CU` = `libs\frontend\chat-ui\src`):
  - CREATE `CU\lib\molecules\session\session-stats-view.ts`
  - CREATE `CU\lib\molecules\session\plan-limits\session-limit-summary.ts`
  - CREATE `CU\lib\atoms\context-ring.component.ts`
  - CREATE `CU\lib\molecules\session\inspector-stats\inspector-session-stats.component.ts` (template inline or `.html` beside it)
  - CREATE `CU\lib\molecules\session\inspector-stats\inspector-limits-lanes.component.ts` (template inline or `.html` beside it)
  - CREATE `CU\lib\molecules\background-agent-population.ts`
  - MODIFY `CU\lib\molecules\session\session-stats-summary.component.ts` (computeds delegate; template, inputs, outputs unchanged)
  - MODIFY `CU\lib\molecules\background-agent-strip.component.ts` (`summaryText` delegates)
  - MODIFY `CU\lib\molecules\session\plan-limits\lane-usage-tile.component.ts` (opt-in `linkPlanTiles` / `planTileRequested`)
  - MODIFY only if D-O2 needs it: `CU\lib\molecules\session\plan-limits\plan-limit-tile.component.ts`,
    `CU\lib\molecules\session\plan-limits\lane-subtotal-tile.component.ts` (opt-in `variant` input, default `'strip'`)
  - MODIFY `CU\index.ts` (chat-ui barrel, 3rd owner; append-only, exact names below)
- Plan reference: `plan-part-d-stats.md:88-219` (D3-1..D3-7), `:429-441` (D5 failure), `:462-472` (D7 checks D-O1..D-O3);
  `implementation-plan.md:240` (§3.3 D-1 row), `:205-210` (§3.2 barrel order), `:540-541` (§9 risk 7);
  design `design-spec.md:1369-1531` (D3.1-D3.7), `:1532-1561` (D3.8 a11y); prototype
  `prototype/assets/delta3.js`, `prototype/assets/delta3.css` (visual reference only)
- Pattern to follow: `session-stats-summary.component.ts` (strip computeds and `StatsTileExpansionState` injection
  pattern), `plan-limits/stats-tile-expansion.state.ts`, existing atoms in `CU\lib\atoms\`
- Quality requirements: standalone, OnPush, signals, `input()` / `output()`, `inject()`; pure files import no Angular;
  strings MOVED verbatim (no re-derivation, no copy left behind); unknown -> `null` / `'—'`, never `0`; exhaustive
  switch over `LaneLimitState`; no `title` carrying detail text in the new sections; no `aria-live` except the PLAN
  LIMITS refresh notice (`role="status"`); no timer; chat-ui never imports `@ptah-extension/chat`
- Validation notes: R-D1 - the strip, agent-strip, lane-usage-tile and plan-limit-tile specs must pass UNCHANGED (a spec
  edit is a reject reason); D-O1 confirm the `LaneLimitState` union in `plan-limits/lane-tiles.ts` before coding;
  D-O2 add `variant` only where the tile face cannot meet D3.4 / D3.5 through host classes, strip markup
  byte-identical; D-O3 provenance mark: provider id only if the VM / `planSectionProvenance` already exposes one,
  else lucide `Gauge`, no new field
- Existing specs to keep green UNCHANGED: `session-stats-summary.component.spec.ts`, `session-budget-format.spec.ts`,
  `session-stats-format.spec.ts`, `background-agent-strip.component.spec.ts`, `lane-usage-tile.component.spec.ts`,
  `plan-limit-tile.component.spec.ts`, `stats-limit-*.spec.ts`; no new spec files
- Acceptance:
  1. Every D3-1..D3-7 export exists with the exact signatures of the Lane brief; the barrel gains exactly the D3-7 names.
  2. `sessionLimitSummary`: worst wins (at before near), tie keeps the session indicator then lane order; `extra` and
     `fullText` (`text (+{extra} more)`); `confirmed-room` / `unknown` never candidates; null VM -> state `'none'`.
  3. `limitAwareDot`: `null` while open; `'need'` when base `'need'`; else `'err'` at; else `'need'` near; else base.
  4. `inspectorToggleDescription` parts in order, each only when true, joined by one space.
  5. Context ring 80 / 95 ink rule, `aria-hidden` host, no ring rendered by callers when percent is null.
  6. Strip, agent strip and tiles render byte-identical markup (their specs unchanged and green in MODE 2).
  7. No TODO / stub / placeholder; no file outside the list touched.
- Scoped checks (run by team-leader MODE 2 on the combined tree, NOT by the lane):
  - `node .ptah/tmp/check-run.mjs d1-test -- npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs d1-typecheck -- npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs d1-lint -- npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
- Commit: `feat(chat-ui): batch D-1 - inspector stats, limits, context ring`

#### Lane brief (D-1, paste verbatim into the lane prompt; workingDirectory = worktree root)

You build batch D-1 of TASK_2026_677_efcd in the Angular Nx repo at
`D:\projects\ptah-extension\.claude-worktrees\clean-session-view` (branch `feat/clean-session-view`). You share no
context with anyone; this brief is complete. You have about 40 tool calls: read only the line ranges named here,
write each file in one go, and do not explore the repository.

Objective: create the chat-ui presentational layer that moves the session stats strip, plan limits and lanes into
the session inspector: one pure stats module, one limit-summary module, a context ring atom, two inspector section
components, one population helper; make the existing strip components delegate to the pure functions without any
markup change; append exact exports to the chat-ui barrel. Nothing in `libs/frontend/chat` is touched.

Read first (absolute paths, only these ranges):
- `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\plan-part-d-stats.md`
  lines 88-219 (contracts D3-1..D3-7), 429-441 (failure rules), 462-472 (open checks D-O1..D-O3).
- `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\design-spec.md`
  lines 1401-1531 (D3.3 SESSION, D3.4 PLAN LIMITS, D3.5 LANES, D3.7 cues) and 1532-1561 (a11y, motion, contrast).
- Source to move from: `libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts`
  (computeds ~140-380, AGENTS / known-subtotal texts ~186-190, context window rule ~193-218),
  `libs\frontend\chat-ui\src\lib\molecules\background-agent-strip.component.ts` (`summaryText` 491-514),
  `libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-tiles.ts` (LaneLimitState union),
  `...\plan-limits\stats-limit-view-model.types.ts` (`StatsLimitViewModel`), `...\plan-limits\lane-usage-tile.component.ts`,
  `...\plan-limits\stats-tile-expansion.state.ts`, `libs\frontend\chat-ui\src\index.ts` (barrel tail).

Files (all under `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\`):
CREATE `lib\molecules\session\session-stats-view.ts`, `lib\molecules\session\plan-limits\session-limit-summary.ts`,
`lib\atoms\context-ring.component.ts`, `lib\molecules\session\inspector-stats\inspector-session-stats.component.ts`,
`lib\molecules\session\inspector-stats\inspector-limits-lanes.component.ts`, `lib\molecules\background-agent-population.ts`;
MODIFY `lib\molecules\session\session-stats-summary.component.ts`, `lib\molecules\background-agent-strip.component.ts`,
`lib\molecules\session\plan-limits\lane-usage-tile.component.ts`, and `index.ts`; MODIFY
`lib\molecules\session\plan-limits\plan-limit-tile.component.ts` / `lane-subtotal-tile.component.ts` ONLY to add an
opt-in `variant = input<'strip' | 'inspector'>('strip')` where D-O2 requires it. No other file.

Contracts (exact signatures; full rules in plan lines cited):
- `session-stats-view.ts` (pure, no Angular): `interface SessionStatsInputs { sessionId: string | null; snapshot:
  SessionStatsEntry | null; liveModelStats: LiveModelStats | null; compactionCount: number; limits:
  StatsLimitViewModel | null; budget: SessionBudgetState | null; context: SessionContextCue; limitSummary:
  SessionLimitSummary }` (all readonly); `interface SessionContextCue { hasLive: boolean; known: boolean; percent:
  number | null; label: string; usedTokens: number | null }`; functions `sessionContextCue(live)`,
  `contextDetailsText(live, compactions): string | null` (appends `Number of context compactions during this session: {n}`
  only when `compactions > 0`), `tokenDetailsText(s, b): string`, `costDetailsText(s, b): string | null`,
  `knownSubtotalOf(s): { value: number } | null`, `agentCountOf(s): number | null`, `durationMsOf(s): number | null`,
  `lanesAriaLabelFor(count): string`; consts `KNOWN_SUBTOTAL_DETAILS`, `AGENTS_DETAILS` (verbatim strip text).
- `session-limit-summary.ts`: `interface SessionLimitSummary { state: 'none' | 'near' | 'at'; text: string | null;
  extra: number; source: 'session' | 'lane' | null; fullText: string | null }`; `sessionLimitSummary(vm:
  StatsLimitViewModel | null): SessionLimitSummary`; `inspectorToggleDescription(context: SessionContextCue, summary:
  SessionLimitSummary, needsYou: number): string`; `limitAwareDot(base: 'need' | 'sel' | null, open: boolean, summary:
  SessionLimitSummary | null): 'need' | 'err' | 'sel' | null`. Rules: plan lines 149-157.
- `ContextRingComponent` (`ptah-context-ring`): `percent = input.required<number>()`, `size = input<44 | 28>(44)`,
  host `aria-hidden="true"`, ink gold < 80, `--state-ink-need` 80-94, `--state-ink-err` >= 95; arc transition 400 ms
  `--ptah-ease-soft`, none under reduced motion. Plan lines 159-166.
- `InspectorSessionStatsComponent` (`ptah-inspector-session-stats`): `stats = input.required<SessionStatsInputs>()`,
  `limitsLinkActivated = output<'session' | 'lane'>()`, optional `turns = input<number | null>(null)` (D-O4; caption only
  when non-null); injects `ModelStateService` from `@ptah-extension/core` and `inject(StatsTileExpansionState,
  { optional: true }) ?? new StatsTileExpansionState()`. Plan lines 168-186.
- `InspectorLimitsLanesComponent` (`ptah-inspector-limits-lanes`): `limits = input.required<StatsLimitViewModel>()`,
  `sessionId = input<string | null>(null)`, public `focusHeading(which: 'session' | 'lane'): void`; renders PLAN
  LIMITS and LANES sections. Plan lines 188-205.
- `lane-usage-tile.component.ts`: add `linkPlanTiles = input<boolean>(false)`, `planTileRequested = output<string>()`;
  with `false` the chip stays today's `<span>` (byte-identical).
- `background-agent-population.ts`: `backgroundAgentPopulation(entries: readonly BackgroundAgentStripEntry[]): string`
  = body of `summaryText` verbatim; the strip delegates.
- Barrel `libs\frontend\chat-ui\src\index.ts`: APPEND only (never edit, reorder or delete existing lines) exports of
  `ContextRingComponent`, `InspectorSessionStatsComponent`, `InspectorLimitsLanesComponent`, `sessionContextCue`,
  `sessionLimitSummary`, `inspectorToggleDescription`, `limitAwareDot`, `backgroundAgentPopulation`, and types
  `SessionStatsInputs`, `SessionContextCue`, `SessionLimitSummary`. `LiveModelStats` is already exported: do not
  duplicate. Nothing else.

Acceptance: the seven numbered criteria under "Task D-1.1" in
`D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\batches.md` (read that
task block only; do not edit the file). Specs that must pass UNCHANGED: `session-stats-summary.component.spec.ts`,
`session-budget-format.spec.ts`, `session-stats-format.spec.ts`, `background-agent-strip.component.spec.ts`,
`lane-usage-tile.component.spec.ts`, `plan-limit-tile.component.spec.ts`, `stats-limit-*.spec.ts`. Do not edit any
spec and do not add a spec file.

STRICT rules (mandatory):
- Run NO nx, jest, build or npm command: this is a parallel wave (decisions.md row 59); the team-leader runs
  `nx test/typecheck/lint @ptah-extension/chat-ui` afterwards. If you have `ptah_get_diagnostics`, run it scoped to
  your changed files only.
- Never run workspace-wide checks, build, serve, dev, e2e, package, or npm install.
- No git at all (no commit, push, stash, restore, checkout, reset, clean); never touch D:\projects\ptah-final-run-ws.
- Never kill processes by image name. Do not edit `batches.md`, `task.md` or any `.ptah/specs` file.
- Angular: standalone, OnPush, signals, `input()` / `output()`, `inject()`; no `[innerHTML]` with untrusted content;
  lucide-angular icons; `ptah-provider-mark` / `ProviderMarkComponent` for CLI marks; imports only through lib
  public `index.ts` aliases across libs; chat-ui never imports `@ptah-extension/chat`.
- No TODO, stub, placeholder or mock data standing in for logic. Handoff files, if any, are handoff-N.md.

Return: every created or modified absolute path; for each of D-O1, D-O2, D-O3 what you found and decided; the barrel
lines you appended; confirmation that no spec file changed; anything you could not finish.

## Wave 4 - A2-2, A1-2, B-4 (parallel; after W3)

- C-3 may join W4 as a 4th batch if PR #733 has merged and the branch is rebased by then (Wave rule exception).
- B-4 now also depends on D-1; A2-2 is the 4th owner of the chat-ui barrel (after D-1).
- File check: A2-2 (`chat-input.*`, `autopilot-popover.*`, `chat-ui/src/index.ts`), A1-2 (`molecules/turn/*`), B-4
  (`organisms/session-inspector/*`, `services/session-agents/session-agent-tray{,.service}.ts`,
  `background-agent-tray.component.ts`, `components/index.ts`, `chat/src/index.ts`). Disjoint.
- W4 MODE 2 (session 8): combined-tree checks via check-run.mjs, header N=2 (chat, chat-ui) each: typecheck exit 0;
  lint run 1 exit 1 (6 `no-duplicate-attributes` errors, all A1-2: `turn-activity-panel:160-161`,
  `turn-agent-chips:109`, `turn-disclosure-row:50-51`; team-leader folded static `class` into `[class]`, row 79),
  lint run 2 exit 0, typecheck re-run exit 0, test exit 0. No `enforce-module-boundaries` finding for chat ->
  `tasks-ui/presentation`. Commits d389caab0 (A2-2), b5d707631 (A1-2), d5951a2f7 (B-4). C-3 stays HOLD (PR #733 open).

## Batch A2-2: composer chips + autopilot trigger re-skin (chat, chat-ui) - COMPLETE (d389caab0)

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A1-2, B-4)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: composer files only; reads `sessionBranch` (B-3); fourth owner of the `chat-ui` barrel (after D-1)
- Tasks: 1 | Depends on: B-3, A1-1, D-1 (chat-ui barrel order C-1 -> A1-1 -> D-1 -> A2-2)
- Phase: clean-session-view | Phase review: as phase

### Task A2-2.1: composer top strip, bar order, send restyle; autopilot popover trigger re-skin - COMPLETE

- Files:
  - MODIFY `F/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` (+ `chat-input.component.spec.ts`)
  - MODIFY `F/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts` (+ `autopilot-popover.component.spec.ts`)
  - MODIFY `F/chat-ui/src/index.ts` only if a new export is needed (shared barrel, 4th owner after D-1; expected none)
- Plan reference: A2:52-55 (component 3), A2:105-141 (component 5), A2:142-157 (exact edits rows 5-6);
  implementation-plan.md §4 A2 O3-O7 (O4: keep both Stop and Send)
- Pattern to follow: current `chat-input.component.ts` structure; popover content unchanged
- Quality requirements: no capability removed (Stop and Send both kept); form landmark; placeholder per §6.3
- Validation notes: branch hint via `sessionBranch(tab, gitState)`; A2 never starts git tracking
- Existing specs to update: `chat-input.component.spec.ts` (send classes, placeholder, popover position, attach
  label if renamed); `autopilot-popover.component.spec.ts` if it asserts trigger classes/labels
- Acceptance: chat and chat-ui suites green with the updated assertions
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a22-test -- npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (header: 2 projects)
  - `node .ptah/tmp/check-run.mjs a22-typecheck -- npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a22-lint -- npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`
- Commit: `feat(chat,chat-ui): batch A2-2 - composer chips, autopilot trigger`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch A1-2: turn molecules (chat) - COMPLETE (b5d707631)

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A2-2, B-4)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: four new files only, consumed by A1-3
- Tasks: 1 | Depends on: A1-1, C-1, C-2 (chips take `SessionAgent`)
- Phase: clean-session-view | Phase review: as phase

### Task A1-2.1: create disclosure row, activity panel, live line, agent chips - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/components/molecules/turn/turn-disclosure-row.component.ts`
  - CREATE `F/chat/src/lib/components/molecules/turn/turn-activity-panel.component.ts`
  - CREATE `F/chat/src/lib/components/molecules/turn/turn-live-line.component.ts`
  - CREATE `F/chat/src/lib/components/molecules/turn/turn-agent-chips.component.ts`
- Plan reference: A1:23-43 (components), A1:83-89; implementation-plan.md:102-114 ("A1 consumption": chips bind
  `kind`, `status`, `cliId`, `agentType` from `SessionAgent`, avatar size 24; `formatAgentDuration`, `null` ->
  `Worked` / `Working`)
- Pattern to follow: existing chat molecules; `ptah-agent-avatar` from `@ptah-extension/chat-ui`
- Quality requirements: no timer or observer per item (one transcript clock passed as `now` input); activity
  panel opened on demand (bundle fallback candidate for `@defer`)
- Validation notes: no `TurnAgentChip` type, no `providerId`; CLI lanes are not turn-scoped
- Existing specs to update: none (new files)
- Acceptance: four standalone OnPush components compile; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a12-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a12-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a12-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch A1-2 - turn disclosure, activity panel, agent chips`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch B-4: inspector component tree + task reader (chat) - COMPLETE (d5951a2f7)

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A2-2, A1-2)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: new organism files; single owner of `components/index.ts`, third owner of `chat/src/index.ts`;
  Delta 3 (amended, plan §3.3 B-4 row, Part D §D3-9..D3-10): tray service + actions menu, SESSION / PLAN LIMITS /
  LANES mounts from D-1, slimmer Orchestrator card. Not split (Decisions, R-D3)
- Tasks: 1 | Depends on: B-2, B-3, C-1, C-2, D-1
- Phase: clean-session-view | Phase review: as phase

### Task B-4.1: create `ptah-session-inspector` and its sections, `SessionTaskReader` - COMPLETE

- Files:
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-orchestrator-card.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-request-panel.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-task-section.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-todos-section.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts`
  - CREATE `F/chat/src/lib/components/organisms/session-inspector/session-task-reader.ts`
    (exact file names per B §5-6 if they differ in suffix)
  - CREATE (Delta 3) `F/chat/src/lib/components/organisms/session-inspector/inspector-agent-actions-menu.component.ts`
  - CREATE (Delta 3) `F/chat/src/lib/services/session-agents/session-agent-tray.ts` (pure: moved `agentLabel`,
    `agentSummary`, `basename`, `tidyAgentSummary`, `backgroundStatus`, `fromSubagent`, `fromBackground`,
    `buildTrayContexts`, `agentModelsByKey`; `TrayAgentContext`, `AgentRowExtras`)
  - CREATE (Delta 3) `F/chat/src/lib/services/session-agents/session-agent-tray.service.ts` (`SessionAgentTrayService`, root)
  - MODIFY (Delta 3) `F/chat/src/lib/components/organisms/background-agent-tray.component.ts` (delegate to the moved
    code and the service; no duplicate copy; its two specs stay green UNCHANGED in B-4; CV-1 deletes it, R2)
  - MODIFY `F/chat/src/lib/components/index.ts` (single owner; append-only)
  - MODIFY `F/chat/src/index.ts` (shared barrel, 3rd owner; append-only)
- Plan reference: B:307-425 (§5-6); implementation-plan.md:305-331 (§7.2 rendering: `inspectorSection` outlets after
  the Orchestrator card, before AGENTS), :254-256 (row 44), §4 B O4, B O6, B O7; §8 D-B-1, D-B-3, D-B-4;
  Delta 3: `plan-part-d-stats.md:277-369` (D3-9 tray service, D3-10 inspector amendments), :429-441 (D5),
  :469 (D-O4 turns); implementation-plan.md:241 (§3.3 B-4 row), §6.2 M-9, §6.3 (Delta 3 overrides of Part B),
  §8 D-D-1
- Pattern to follow: latest-`TodoWrite` locator copied verbatim from
  `F/canvas/src/lib/canvas-detail/canvas-session-details.component.ts:125-143` (B-5 deletes the source);
  `FILE_LINK_OPENER` (`tasks-store.service.ts:1351-1376`) for artifact open
- Quality requirements: AGENTS rows use avatar size 32; `st-r` + `--i` on inspector rows; TASK section renders
  nothing when no or unknown lead task; lead task = primary else most recent `createdAt`; imports tasks only via
  `@ptah-extension/tasks-ui/presentation`; token injected `{ optional: true }`
- Validation notes: lint must show no `@nx/enforce-module-boundaries` error for chat -> `tasks-ui/presentation`;
  if chat jest cannot resolve `/presentation`, report it (assumption from B-2)
- Delta 3 tasks (D3-9, D3-10):
  - `session-inspector`: input `stats = input<SessionStatsInputs | null>(null)` REPLACES Part B's optional `usage`
    input; order D45: Orchestrator, add-on slot, SESSION (`ptah-inspector-session-stats` when `stats` non-null),
    AGENTS, PLAN LIMITS + LANES (`ptah-inspector-limits-lanes` when `stats?.limits`), TASK, TODOS, GIT; wire
    `limitsLinkActivated` to `viewChild(InspectorLimitsLanesComponent)?.focusHeading(source)`; new sections count as
    stagger rows (cap 6 unchanged).
  - `inspector-orchestrator-card`: dot, `Orchestrator`, state line WITHOUT model, request line; no context bar, no
    stats `dl`, no `Usage and limits` disclosure (B-3's model / context / tokens / cost fields not read).
  - `inspector-agents-section`: population summary line via `backgroundAgentPopulation(...)` (omitted when empty);
    `extras = computed(() => tray.extrasFor(sessionId(), rows()))` over ALL roster rows; model token from
    `extras.model` via `resolveModelDisplayName` (`title` raw id, hidden `aria-describedby` span); `· {tokens} tokens`
    when known; 28 x 28 ellipsis actions button when `extras.tray` has an action; inline `ptah-agent-steer-input`
    with section-level `pendingSteerId`; row activation order: lane surface -> `laneRequested(row.key)`; else tray
    context -> `SessionAgentTrayService.focus(extras.tray)`; else select only, no Focus label (D-13).
  - `SessionAgentTrayService` per D3-9 signatures (`contextsFor`, `extrasFor`, `focus`, `steer`, `stop`,
    `sendToBackground`, `viewTranscript`); `buildTrayContexts` keeps today's `agentVisibleInSession` filter, the
    `toolCallId` dedupe (background wins) and the active-only foreground population; `agentModelsByKey` walks the
    roster's own store reads (completed sub-agents keep their model). `SessionAgent` (C-2) is NOT changed.
  - `inspector-agent-actions-menu`: `role="menu"`, `menuitem`s by flags, Up / Down / Home / End, `Esc` closes and
    returns focus to the trigger; one open menu per section.
  - D-O4: pass B-3's `OrchestratorCardModel.turns` to the SESSION section's `turns` input only if B-3 built a
    non-null count; else omit (no invented value).
- Delta 3 failure rules: tray action on a vanished context no-ops; steer `finally` clears `pendingSteerId`; menu
  closes and focus returns; unknown model -> no token, no placeholder; no `registerScope` anywhere in the inspector.
- Existing specs to update: none (new files); keep `background-agent-tray.component.spec.ts` and
  `background-agent-tray.scope.spec.ts` green UNCHANGED (they are renamed in CV-1, R2)
- Acceptance: `SessionInspectorComponent` exported from `@ptah-extension/chat`; inspector renders D45 order with
  SESSION / PLAN LIMITS / LANES from `stats`; AGENTS shows model, tokens, actions, steer and the Focus fallback;
  tray component delegates (no duplicated mapping code); chat suite, typecheck, lint green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b4-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b4-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b4-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch B-4 - session inspector component tree`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 5 - A1-3, CV-1 (parallel; after W4)

- File check: A1-3 owns `message-bubble.*`, `chat-transcript.*` and (Delta 3) `inline-agent-bubble.component.*`;
  CV-1 owns `chat-view.component.*` + chat-view specs, (Delta 3) `services/session-stats/session-stats-source.ts`,
  `chat/src/index.ts` (4th owner), the tray component delete and the two spec renames. Disjoint.
- C-3 may join W5 if it did not run in W4 and PR #733 has merged and the branch is rebased (Wave rule exception).
  Decisions row 58 also prefers the rebase before CV-1; if #733 merged, rebase before W5 starts.

## Batch A1-3: message bubble assistant branch + transcript (chat) - COMPLETE (3582cf696)

- MODE 2 (W5, session 9): combined-tree checks for chat (N=1) after one fix round. Typecheck and lint exit 0
  (twice). Test run 1: 22 failed / 3911 passed, 4 suites. 21 were A1-3: `rootHasActivity`
  (`turn-answer-split.utils.ts:49`) dereferenced a missing tree. 1 was CV-1. Fixed by one Claude frontend-developer
  (decisions rows 86-87). Test run 2 exits 0. Keep-alive bubble stub hunks committed here (row 88).

- Wave: W5 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with CV-1)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: the turn rewrite; owns the five `.st-t` hooks CV-2 indexes
- Tasks: 1 | Depends on: A1-2, C-2, B-3
- Phase: clean-session-view | Phase review: as phase

### Task A1-3.1: rewrite assistant branch of `message-bubble`; wire turn, roster and needs-you in `chat-transcript` - COMPLETE

- Files:
  - MODIFY/REWRITE `F/chat/src/lib/components/organisms/message-bubble.component.ts`
  - REWRITE (lines 1-192, keep 193-347) `F/chat/src/lib/components/organisms/message-bubble.component.html`
  - MODIFY `F/chat/src/lib/components/organisms/message-bubble.component.css`
  - MODIFY `F/chat/src/lib/components/organisms/message-bubble.component.spec.ts` (existing)
  - MODIFY `F/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
  - MODIFY `F/chat/src/lib/components/organisms/transcript/chat-transcript.component.html` (`:47-60`)
  - MODIFY existing transcript specs where they break (see below)
  - MODIFY (Delta 3) `F/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`: remove the model
    badge block (`:515-523`), `rawModelId` / `modelDisplayName` (`:889-904`), and the `ModelStateService` injection /
    `resolveModelDisplayName` import if nothing else uses them (+ `inline-agent-bubble.component.spec.ts` only if it
    asserts the badge). The ONE sanctioned execution-tree edit; row 32 still forbids any tool-row diff
    (plan-part-d-stats.md:397-401, implementation-plan.md:242)
- Plan reference: A1:90-167; A1:187-234 (parity map, data flow + empty/failure); implementation-plan.md:102-114
  ("A1 consumption"), :179 (`st-t` on the five items: user `<article aria-label="You">`,
  `ptah-turn-disclosure-row` host, `.cs-answer`, `ptah-turn-agent-chips` host, action-row wrapper; class only,
  no `--i`), :257-259 (row 32), §8 R1 (assistant avatar + `Claude` + time removed, USER approved row 45)
- Pattern to follow: `openSubagentLane(key)` (`chat-transcript.component.ts:769-791`) for the roster key
- Quality requirements: tool rows render through the unchanged `ptah-execution-node` with the root `'message'`
  inputs - no diff in tool-row templates/styles; one transcript clock; roster read once via `computed`
- Validation notes: chips = roster entries whose key equals `laneKey('subagent', node.toolCallId)` /
  `laneKey('background', node.toolCallId)`; verify the node field equals `SubagentRecord.parentToolUseId`;
  `[needsYouCount]` from `inspectorStore.modelFor(tabId)().needsYouCount` for the live turn only, `0` with no tab
- Existing specs to update: `message-bubble.component.spec.ts` (`:143-204` cost/footer now in the closed activity
  panel; `:91` agent tile forwarding on a child `ptah-execution-node`; `:123` stays);
  `chat-transcript.component.spec.ts:1034` stub `ptah-message-bubble` gains the new inputs/outputs and drops
  `messageIndex`/`totalMessages`; re-run `chat-transcript.display`, `.ptah-ui`, `.replay-*` specs and fix only
  intended breaks
- Acceptance: closed turn shows disclosure row, answer, chips, action row; live turn shows live line; inline
  sub-agent bubble shows no model badge (the model lives in the AGENTS row, C-49); chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a13-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a13-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a13-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch A1-3 - clean turn in message bubble and transcript`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch CV-1: chat-view shell + inspector host (chat, owner B) - COMPLETE (db7b896df)

- MODE 2 (W5, session 9): same combined-tree checks as A1-3. One failure ("formats times in the host zone",
  `chat-view.component.spec.ts:1778` read the moved `_limitTime`), fixed in the same fix round (row 87). The
  deviations are accepted (rows 89-90). `@ptah-extension/tasks-ui/presentation` resolves in chat Jest (row 91).
  The tray spec renames are staged as delete + add pairs (row 92).

- Wave: W5 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A1-3; first of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: first chat-view edit; hosts the deferred inspector and provides the controller; Delta 3 (amended):
  removes the strip and tray mounts, creates the one stats source, deletes the tray component (R2)
- Tasks: 1 | Depends on: B-4 (and transitively D-1)
- Phase: clean-session-view | Phase review: as phase

### Task CV-1.1: shell root, inert main column, deferred inspector aside, controller wiring - COMPLETE

- Files:
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.html`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.css`
  - MODIFY where they break: `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`,
    `chat-view.memo.spec.ts` (same folder; provide `SessionInspectorStore` / `InspectorShellController`)
  - CREATE (Delta 3) `F/chat/src/lib/services/session-stats/session-stats-source.ts` (`injectSessionStatsSource`,
    `SessionStatsHost`, `SessionStatsSource`; MOVED `toStatsLimitLaneRun`, `recordedOwnerKeys`, `sameStrings`)
  - MODIFY (Delta 3) `F/chat/src/index.ts` (shared barrel, 4th owner after B-4; append-only: `injectSessionStatsSource`
    and its types, for the Rail board)
  - DELETE (Delta 3, R2, USER-approved decisions.md row 64) `F/chat/src/lib/components/organisms/background-agent-tray.component.ts`
  - RENAME + harness rewrite (R2; same cases, none added or dropped, no new spec file; `git mv`-style so history follows):
    `F/chat/src/lib/components/organisms/background-agent-tray.component.spec.ts` ->
    `F/chat/src/lib/services/session-agents/session-agent-tray.service.spec.ts` (action cases against
    `SessionAgentTrayService`); `F/chat/src/lib/components/organisms/background-agent-tray.scope.spec.ts` ->
    `F/chat/src/lib/services/session-agents/session-agent-tray.spec.ts` (population / scope / dedupe cases against
    `buildTrayContexts`). The executor uses a file move, not git; the team-leader stages the delete + add pair
- Plan reference: implementation-plan.md:121-131 (§3.1 CV-1 row), §7.1 (inside an embed `hostsInspector()` is false),
  §7.3 (no `[inspectorSection]` re-projection); B:426-463 (§7 a-e); Delta 3: implementation-plan.md:182 (§3.1 CV-1
  delta 3 row), :243 (§3.3), §6.1 R2, §6.2 M-8; `plan-part-d-stats.md:221-276` (D3-8 source), :371-385 (D3-11 CV-1),
  :539-556 (Proposed Removals 1, approved)
- Pattern to follow: existing `afterNextRender` usage in `chat-view.component.ts`
- Quality requirements: root `<div class="cs-shell ...">` + `container-type: inline-size`; `[attr.inert]` on the
  main column; inspector `@if` / `@defer (on immediate)` with `id="inspector"` on the aside;
  `[attr.data-request-id]` on `ptah-question-card`; `providers: [InspectorShellController]`; `hostsInspector`,
  `hasLaneSurface`, tab-feed effect calling `onTabChanged()`, `openLaneFromInspector`, `focusQuestionCard`;
  `controller.attach(...)` in `afterNextRender` with lazy opener/title getters
- Validation notes: no compact-card change here (CV-2 owns A-6 / A-16); `SESSION_CONTEXT` present -> no inspector
- Cross-task contract with TASK_2026_649 (decisions row 85): CREATE
  `F/chat/src/lib/tokens/session-embed-chrome.token.ts` with EXACTLY this content (649 may add a byte-identical copy;
  do not reformat it):
  ```ts
  import { InjectionToken } from '@angular/core';

  /**
   * How much session chrome a hosted chat view renders. `'bare'` hides the
   * session header and the "This session" inspector, because the host page
   * brings its own. Absent or `'full'` keeps the default chrome.
   */
  export type SessionEmbedChrome = 'full' | 'bare';

  export const SESSION_EMBED_CHROME = new InjectionToken<SessionEmbedChrome>(
    'SESSION_EMBED_CHROME',
  );
  ```
  and append to `F/chat/src/index.ts`:
  `export { SESSION_EMBED_CHROME, type SessionEmbedChrome } from './lib/tokens/session-embed-chrome.token';`.
  Chat-view reads `inject(SESSION_EMBED_CHROME, { optional: true }) === 'bare'` once (a readonly field); when bare,
  render no inspector, never auto-open it (D36 default-open is skipped) and attach no shell controller. Absent or
  `'full'` = unchanged behaviour. CV-2 reuses the same field for the header (see CV-2 note).
- Answer-miss carry-over from B-4 (W4 MODE 2, decisions row 83): `SessionInspectorStore.reportAnswerMiss` does not
  exist (B-3 never added it) and no inspector row renders a miss error. CV-1 owns plan-part-b-inspector.md:353-358 in
  full: `focusQuestionCard` waits 1 s for the `[data-request-id]` card, else calls `reportAnswerMiss(requestId)`; ADD
  that method to `F/chat/src/lib/services/session-inspector/session-inspector.store.ts` (a transient signal keyed by
  `requestId`, cleared on `Retry` or success) and render the row error + `Retry` in
  `F/chat/src/lib/components/organisms/session-inspector/inspector-request-panel.component.ts` (B-4 file, CV-1 may
  extend it; no other W5 batch owns it). Confirm the exact store file name on disk first.
- Delta 3 tasks (D3-8, D3-11): delete the strip block (`chat-view.component.html:35-51`) and the tray block (`:53-64`);
  drop `SessionStatsSummaryComponent` / `BackgroundAgentTrayComponent` imports (`chat-view.component.ts:34,39,231,235`),
  `showBackgroundStrip`, `traySessionId`, `resolvedSessionStats`, `resolvedLiveModelStats`, `resolvedCompactionCount`,
  `resolvedStatsLimits`, `sessionLaneRuns`, `sessionRunOwnerKeys`, `_limitTime` - their bodies MOVE verbatim into the
  source (tab values when `tab()` non-null, else ChatStore; never null just because the main panel has no tab); add
  `protected readonly stats = injectSessionStatsSource({ tab: () => this.resolvedTab(), sessionId: () =>
  this.resolvedSessionId(), budget: () => this.resolvedSessionBudget(), available: () =>
  this.resolvedMessages().length > 0 })`; scope effect (`:1328-1337`) reads `stats.runOwnerKeys()`; KEEP
  `_planLimitsScope` (the ONE scope, C-39), `resolvedSessionBudget`, the `StatsTileExpansionState` provider; bind
  `[stats]="stats.inputs()"` on the inspector. Confirm the `SessionBudgetState` import path from
  `session-budget-actions.service.ts` before writing the factory. No `registerScope` and no timer in the source.
- Existing specs to update: the four chat-view specs above, only for the new providers / host markup; Delta 3:
  `chat-view.component.spec.ts:68` re-points `toStatsLimitLaneRun` to `../../services/session-stats/session-stats-source`,
  strip / tray mount assertions removed; the two renamed tray specs (same cases)
- Acceptance: main panel renders the inspector aside without `SESSION_CONTEXT`; the inspector's SESSION / PLAN LIMITS /
  LANES show the values the strip showed (ChatStore fallback, active session id, view budget) from the first message
  on; no `ptah-session-stats-summary` / `ptah-background-agent-tray` in chat-view; no file references
  `background-agent-tray.component`; renamed specs hold the same case count as before; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs cv1-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv1-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv1-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch CV-1 - chat-view shell and inspector host`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 6 - CV-2, B-5 (parallel; after W5)

- File check: CV-2 owns `chat-view.component.*` + chat-view specs and (Delta 3) `session-header.component.ts`; B-5
  owns canvas `canvas-rail-board.*`, `canvas-focus-header.*`, the session-details delete. Disjoint.
- Gate: C-3 must be COMPLETE before W6 (B-5 depends on it). If PR #733 is still open, MODE 2 stops and escalates.
- CV-3 (W7) is closed inside this wave's MODE 2 invocation when A1-3 reported no chat-view binding (see CV-3).

## Batch CV-2: chat-view header, motion, compact-card retirement (chat, owner A2) - COMPLETE (commit 833914b34)

- Wave: W6 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with B-5; second of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: the one owner of A-6 / A-16; needs CV-1's controller, A2-1's header and A1-3's `.st-t` hooks;
  Delta 3 (amended): header closed-state cues; second owner of `session-header.component.ts` (A2-1 -> CV-2 serial)
- Tasks: 1 | Depends on: CV-1, A2-1, A1-3 (D-1 transitively via CV-1)
- Phase: clean-session-view | Phase review: as phase

### Task CV-2.1: header block, add-on outlets, session-switch stagger, compact-card retirement - COMPLETE

- Files:
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.html`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.css`
  - MODIFY where they break: `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`,
    `chat-view.memo.spec.ts`
  - MODIFY (Delta 3; named SECOND owner after A2-1, M-11) `F/chat/src/lib/components/molecules/session-header/session-header.component.ts`
- Plan reference: implementation-plan.md:126 (CV-2 row), :129-131, :326-327 (header slot outlets, `ngProjectAs`),
  §8 (D-A2-2 withdrawn; trigger `resolvedTabId`); A2:46-51 (component 2), A2:56-104 (component 4 stagger),
  A2:142-157 (chat-view rows), A2:158-193 (binding contract); Delta 3: implementation-plan.md:183-189 (§3.1 CV-2
  delta 3 row, second owner), §6.2 M-10, M-11; `plan-part-d-stats.md:386-395` (D3-11 CV-2), :472 (D-O7)
- Delta 3 tasks: header inputs `inspectorDot: 'need' | 'err' | 'sel' | null` (widens A2-1's dot input),
  `limitCue = input<SessionLimitSummary | null>(null)` (chip `Limit near` / `At limit`, `role="status"`, 22 px,
  `TriangleAlert` 12 dropped below 440 px, `title` + sr-only `: {fullText}`, only while the inspector is closed and
  state not `none`), `contextRingPercent = input<number | null>(null)` (28 px `ptah-context-ring` around `panel-right`
  while closed and known), `toggleDescription = input<string>('')` (`aria-describedby`, per-instance id; accessible
  NAME unchanged). chat-view computeds: `inspectorDot = limitAwareDot(shell.showDot(), shell.isOpen(),
  stats.inputs()?.limitSummary ?? null)` (REPLACES the A2 `shell.isOpen() ? null : shell.showDot()` binding),
  `limitCue = stats.inputs()?.limitSummary ?? null`, `contextRingPercent = stats.inputs()?.context.percent ?? null`,
  `toggleDescription = inspectorToggleDescription(context, summary, inspectorModel().needsYouCount)` ('' without stats).
  D-O7: grep templates for `modelDisplayName`, `formatModelName`, `Model ` - no model text left in the main column
  except the composer selector
- Pattern to follow: `chat-view.component.ts:974` `showCompactCard` -> `this._forcedCard?.() ?? false`
- Quality requirements: compact view renders the transcript; forced Rail card path (A-5) untouched;
  `expandToFullView` kept only if the forced branch still binds it; stagger keyed on `resolvedTabId`,
  `playEnter()` in `afterNextRender`, one `.st-t` index pass `--i = min(k+1, 8)` in DOM order, timer released;
  `ptahStaggerUp` keyframes and reduced-motion block; composer wrapper `class="st-f" style="--d:120ms"`;
  header binds `showDot()` directly
- Validation notes: header renders above the one branch; late-mounted items get no animation; empty add-on list
  renders nothing; component-style budget 20 kB (`project.json:66`) - keep CSS lean
- Existing specs to update: chat-view specs (header element, count chip copy, toggle `aria-pressed`, dot; compact
  view now renders the transcript)
- Acceptance: header + stagger visible on session switch; compact card shows only when forced; with the inspector
  closed the header shows the limit chip, context ring and dot (`err` at limit, `need` near / pending) and the
  toggle description, all read from `stats.inputs()` (one source); none of them while open; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs cv2-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv2-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv2-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch CV-2 - session header, stagger, compact card retire`
- Cross-task contract with TASK_2026_649 (decisions row 85): when chat-view's `SESSION_EMBED_CHROME` field (CV-1)
  is `'bare'`, render no `ptah-session-header` (and no header-only chips or limit dot). Absent or `'full'` =
  unchanged.
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Batch B-5: Rail board inspector, delete session details (canvas; last Part B batch) - COMPLETE (commit 58d2084dc)

- Wave: W6 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with CV-2)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: canvas-only; replaces `ptah-canvas-session-details` with `ptah-session-inspector` in the Rail board
- Tasks: 1 | Depends on: B-4, C-3, CV-1
- Phase: clean-session-view | Phase review: as phase

### Task B-5.1: host `ptah-session-inspector` in Rail board asides; gate focus-header details; delete session details - COMPLETE

- Files:
  - MODIFY `F/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` (+ `canvas-rail-board.component.spec.ts`)
  - MODIFY `F/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`
    (+ `canvas-focus-header.component.spec.ts` only if it asserts the details gate)
  - DELETE `F/canvas/src/lib/canvas-detail/canvas-session-details.component.ts`
  - DELETE `F/canvas/src/lib/canvas-detail/canvas-session-details.component.spec.ts`
- Plan reference: B:464-480 (§8); implementation-plan.md:159-160 (focus-header seam), :183-184 (canvas barrel: none
  exports it, verified); §4 B O8 (`canvas-focus-header.component.ts:55-70`), B O9 (`canvas-detail.service.ts`
  `answerRequested` forwarding, accepted degradation otherwise); §8 D-B-2
- Pattern to follow: current asides at `canvas-rail-board.component.ts:182, 209, 240`
- Quality requirements: board provides `InspectorShellController`; parity D-1..D-11 mapped to the inspector;
  no canvas -> chat-internal imports (public `@ptah-extension/chat` only)
- Delta 3 (amended, `plan-part-d-stats.md:402-407`, :471 D-O6; implementation-plan.md:244): the board adds
  `StatsTileExpansionState` to its `providers` and binds the board inspector's `[stats]` from
  `injectSessionStatsSource({ tab: focusedTab, sessionId: () => focusedTab()?.claudeSessionId ?? null, budget: () =>
  focusedTab()?.sessionBudget ?? null, available: () => focusedTab() !== null })` imported from `@ptah-extension/chat`
  (CV-1 export). No `registerScope`. D-O6: if the Rail aside can be closed while a limit is near / at, report it to
  the orchestrator for a design call; do not invent a cue
- Validation notes: one inspector in Rail (the board aside); `SESSION_CONTEXT` hosts never show chat-view's
- Existing specs to update: `canvas-rail-board.component.spec.ts` (`DetailsStub` -> inspector stub);
  `canvas-focus-header.component.spec.ts` if the gate changes an assertion
- Acceptance: no reference to `canvas-session-details` remains; the Rail board inspector shows SESSION / PLAN
  LIMITS / LANES for the focused tab; D-O6 outcome reported; canvas suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b5-test -- npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b5-typecheck -- npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b5-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`
- Commit: `feat(canvas): batch B-5 - Rail board inspector, drop session details`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 7 - CV-3 (alone; after W6)

## Batch CV-3: chat-view leftovers from A1 (chat; expected empty) - COMPLETE (Commit: none (verified no-op))

- Wave: W7 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (third and last of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none
- Subagent reason: plan §5 lane table: NO lane (inspector tree, execution-tree edit, chat-view chain, Rail integration, shared barrels stay with Claude; USER row 60)
- Review family: implementer Claude; phase reviewer codex
- Rationale: any chat-view binding A1-3 discovered lands here, after CV-2
- Delta 3 decision (fold into W6?): NO as a batch - CV-3 edits the same three chat-view files as CV-2 (strictly serial
  chain, plan §3.1, §9 risk 1), and folding its scope into CV-2 would move A1's ownership to A2 against §3.1. Delta 3
  adds nothing to CV-3 (plan D6). Fast path: its only input is A1-3's report (W5). If that report names no
  chat-view binding, the team-leader confirms it by reading chat-view and the transcript bindings during the W6
  MODE 2 invocation, after CV-2 commits, and records `Commit: none (verified no-op)` here - no executor, no extra
  wave. Only a reported binding spawns a W7 executor.
- Tasks: 1 | Depends on: CV-2, A1-3
- Phase: clean-session-view | Phase review: as phase
- A1-3 input (W5 MODE 2, decisions row 93): `reports/batch-A1-3.md:88-89` names NO chat-view binding. The
  transcript reads `viewMode`, the roster and the needs-you count itself. So CV-3 takes the fast path: the team-leader
  verifies the no-op in W6 MODE 2 after CV-2 commits and records `Commit: none (verified no-op)`.

### Task CV-3.1: apply chat-view bindings A1-3 reported, or confirm none are needed - COMPLETE (no-op)

- Files: `F/chat/src/lib/components/templates/chat-view.component.{html,ts,css}` + chat-view specs, only if needed
- Plan reference: implementation-plan.md:127 (CV-3 row); A1:181-186
- Quality requirements: no compact-card or header change (CV-2 owns them)
- Validation notes: the A1-3 report is the input; nothing reported -> executor confirms by reading chat-view and
  the transcript bindings, and returns "no-op"
- Existing specs to update: chat-view specs only if a binding changes
- Acceptance: either a committed binding change with green checks, or a verified no-op recorded here as
  `Commit: none (verified no-op)` (accepted exception for Mode 3)
- Scoped checks (only when files changed):
  - `node .ptah/tmp/check-run.mjs cv3-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv3-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv3-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit (if any): `feat(chat): batch CV-3 - chat-view turn bindings`
- Executor notes (STRICT):
  - Parallel wave: run NO nx / jest checks yourself (decisions.md row 59); use `ptah_get_diagnostics` scoped to your
    changed files only. The team-leader MODE 2 runs the Scoped checks once on the combined tree. Any check that
    is ever run goes only through `node .ptah/tmp/check-run.mjs <label> -- <command>` from the worktree root.
  - Changed projects only: `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, `npx nx typecheck <project> --parallel=1 --skip-nx-cache`, `npx nx lint <project> --parallel=1 --skip-nx-cache`. Several projects: `npx nx run-many -t test -p A B --parallel=1 --skip-nx-cache` (never positional `nx test A B`).
  - One heavy check at a time across all agents. Never push while a check or build runs. No workspace-wide runs.
  - No build/serve/dev/e2e/package, except the Electron renderer rebuild (visual review) and the one webview bundle build (BUILD-1). No npm install.
  - No git in D:\projects\ptah-final-run-ws. Executors never commit, push, stash, restore, checkout, reset or clean; the team-leader MODE 2 commits in the foreground with explicit paths.
  - Never kill processes by image name.
  - Angular: standalone, OnPush, signals, input()/output(), inject(); no [innerHTML] with untrusted content; lucide-angular icons; `ptah-provider-mark` for CLI marks; imports only via lib public index.ts aliases; canvas -> chat direction only; chat-ui never imports chat.
  - Commits: `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Handoff files are handoff-N.md, never HANDOFF.md.
  - No new spec files; update an existing spec only where this batch changes behaviour it asserts. Do not edit batches.md.

## Wave 8 - BUILD-1 measurement step (alone; after W7, so after B-5, the last Part B batch) - FAIL, fix in phase fix round

- Owner: orchestrator runs it (or a frontend-developer told to run only this command); no code change, no commit
- Depends on: every batch above COMPLETE; no other check or push in flight
- Command (the ONE allowed webview bundle build, user decision row 43; project name verified
  `apps/ptah-extension-webview/project.json:2`):
  `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`
- Pass: no budget error against `initial` `maximumError: "3.5mb"` (`project.json:61`) and `anyComponentStyle`
  `maximumError: "20kb"` (`:66`). Record initial-bundle size and any warnings here.
- Fail: do not rebuild. Candidate fix: move the largest new eager unit behind `@defer` (the turn activity panel
  first; B-4 inspector is already deferred), then a second build only with a new user approval.
- Result: FAIL (2026-10-15 18:35 UTC, log `629-check-webview-bundle.log`): initial total 3.67 MB raw (777.97 kB transfer); `X [ERROR] bundle initial exceeded maximum budget. Budget 3.50 MB was not met by 174.05 kB`. No anyComponentStyle error. Fix in the phase fix round, then one measurement build (decisions row 103). Measurement build 2 (after FIX-2 `0cf3936f6`, log `629-check-webview-bundle-2.log`): 3.62 MB raw (764.27 kB transfer), 116.96 kB over 3.5 MB; no anyComponentStyle error. Budget raised to 3.7 MB in `35f70fb34` (row 107).

## Phase review (after W8)

- Phase: clean-session-view = all 18 implementation batches; combined diff = parent of the first batch commit
  (`2e273fd3c`, current HEAD before W1) to `HEAD`.
- Step 0 (Delta 3, USER row 60): lane-built batches get a code-logic review from a different family than their
  builder, scoped to that batch's commit: D-1 (codex-built) -> Claude `code-logic-reviewer` or a grok lane, with
  R-D1 (strip specs unchanged), R-D5 (one source per value) and the D3-7 export list as focus; C-3 -> the family not
  used to build it. These may run as soon as the batch commits; their findings join the one fix round of Step 2.
- Step 1: one codex code-logic review of the phase diff (orchestrator spawns it; implementer family Claude,
  reviewer family codex). Delta 3 focus additions: plan §9 risks 7-10 (D-1 strip specs unchanged, B-4 tray service
  and Focus fallback D-13, one source per value, no `registerScope` outside chat-view), R2 renamed specs keep their
  case count, D-O7 (no model text in the main column). The phase adds new public API (`@ptah-extension/chat-ui` avatar vocabulary,
  `@ptah-extension/chat` roster, inspector services, `SESSION_WORKFLOW_ADDONS`), so a style pass on those exports
  is due by the team-leader rule; recommended folded into the same codex lane as a second focus.
  Reviewer focus: plan §9 (one `cliId -> providerId` table, exhaustive switches, no per-item timer/observer,
  store map pruning, focus paths §8.3 1-7), risk 4 (chip key), C-3 `paused` -> `queued`, row 32 (no tool-row
  diff), no TODO / stub / placeholder.
- Step 2: at most one fix round (Blocking + Serious; Moderate only if it can break config or lose data), as one
  fix batch added here, then one re-review scoped to the fix commits.
- Step 3: visual-reviewer, dark + light, against `prototype/`; after screenshots compared with
  `screenshots/before/` (capture method in `visual-before.md`, Electron renderer rebuild allowed); include Rail at
  400 / 760 px and a split pane for the dock hover card (C open check 2).
- Result Step 0-1: codex phase review `code-logic-review.md` REVISE 5/10 (row 104); grok B-5 review
  `code-logic-review-B-5.md` REVISE 5/10 (row 105).
- Result Step 2: FIX-1 `ccc43b737`, FIX-2 `0cf3936f6`, FIX-3 `6e96c36c3` (codex lanes, row 105); grok
  re-review `code-logic-review-fixes.md` APPROVED 7/10 (row 108). Moderate items -> "TASK_2026_677 follow-ups".
- Result Step 3: codex `visual-review.md` FAIL (2 Serious, 1 Moderate; row 109) -> FIX-4 `5594828d3`
  (row 110) -> codex re-check `visual-recheck-FIX-4.md` PASS: 3/3 FIXED dark + light,
  no new issues; screenshots `screenshots/after-fix4/`, inspected by the orchestrator (row 112).

## After 648 merges (not batches now; plan §7.4)

- H1 `F/chat/src/lib/tokens/session-workflow-addons.token.ts`: `sessionWorkflowKind` body ->
  `return tab?.workflow ?? null;` (turns on workflow initial-open, `sel` dot and add-on lookup in both hosts).
- H2 same file: `workflowKind: string` -> `workflowKind: WorkflowKind` (from `@ptah-extension/chat-types`).
- H3 rebase conflicts, keep both sides: `chat-view.component.ts` (648 `forgetWorkflowSession`),
  `canvas-focus-header.component.ts` (648 badge vs B-5 gate), `chat/src/lib/components/index.ts` (exports).
- Orchestrator tells the 648/652 session: register 649 sections through `SESSION_WORKFLOW_ADDONS`; the embed's
  `[sessionHeader]` / `[sessionAddon]` slots stay theirs.

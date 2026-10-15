# Batches - TASK_2026_677_efcd

Total tasks: 17 implementation batches + 1 measurement step (BUILD-1) | Batches: 18 | Complete: 6/18
Waves: 8 (W1-W7 implementation, W8 measurement) | Phase: one phase "clean-session-view" (all batches)

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

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Executor for every batch: Claude `frontend-developer` sub-agent | CLI lane (default) | user rule: Claude builds the frontend, CLI lanes only review (team-leader prompt; plan §1 line 19) | yes |
| 8 waves, max 3 parallel batches per wave, file-disjoint incl. barrels | plan §5 orders 1-10 as-is | plan §5 allows 4 in order 1; cap 3 moves A1-4 to W2; A2-1 stays in W3 per §5 | yes |
| A1-2 also depends on C-2 | plan §5 (A1-1, C-1 only) | chips consume `SessionAgent` (plan §2.2 C2 / "A1 consumption"); no ordering cost (A1-2 is W4) | yes |
| Wave-level verification, per-batch commits | verify and commit each batch alone | shared worktree; a per-batch check sees the sibling's uncommitted files | yes |
| Full webview test target in B-1 and B-3 | plan §9 one-spec run | team-leader prompt: existing suites of every changed project run per batch | yes |
| BUILD-1 after CV-3 (W8), label `webview-bundle` | right after B-5 | B-5 is the last Part B batch (W6); W8 still follows it and measures every eager delta | yes |
| CV-3 may close as a no-op without a commit | force an empty commit | plan §3.1 "None expected"; Mode 3 accepts `Commit: none (verified no-op)` for CV-3 only | yes |
| C-3 owns `canvas-focus-area.component.spec.ts` | leave to B-5 | C §handoff: stub input `sessionId` -> `tabId` (`:59-69`) follows C-3's binding change | yes |

## Wave rule (applies to W1-W7)

- The orchestrator spawns the wave's batches in parallel (one `frontend-developer` sub-agent each, at most 3),
  waits for all of them, then re-invokes team-leader (Mode 2) once with every report path of the wave.
- Executors may run their own scoped checks, one heavy check at a time across all agents; a failure located in
  another batch's file is reported, not fixed.
- Team-leader verifies each batch on disk, runs each changed project's test, typecheck and lint once on the
  combined tree, then commits each batch separately in the foreground with explicit paths. The next wave starts
  only after every batch of the current wave is COMPLETE.

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

## Wave 3 - B-3, C-3, A2-1 (parallel; after W2)

## Batch B-3: inspector services, add-on token, git branch (chat, webview app) - IN_PROGRESS

- Wave: W3 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with C-3, A2-1)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: the store, open-state and shell controller that A1-3, A2-2, B-4, CV-1 and B-5 bind to; second owner of
  both chat barrels
- Tasks: 1 | Depends on: C-2 (and B-1 committed, since it shares the webview project)
- Phase: clean-session-view | Phase review: as phase

### Task B-3.1: create session-inspector services, `SESSION_WORKFLOW_ADDONS`, git `branch` + `sessionBranch` - IN_PROGRESS

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
- Plan reference: implementation-plan.md:86-100 (B1, B2 contracts), :135-138 (git seam), :260-269 (rows 38 dot and
  open contract), :305-331 (§7.2 token), §6.2 M-3 (`sessionWorkflowKind` returns `null` on main); B:174-306 (§3-4)
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

## Batch C-3: agent dock rewrite (canvas) - IN_PROGRESS

- Wave: W3 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with B-3, A2-1)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: canvas-only rewrite on top of the roster and avatar; disjoint from chat batches
- Tasks: 1 | Depends on: C-1, C-2
- Phase: clean-session-view | Phase review: as phase

### Task C-3.1: rewrite `ptah-canvas-lane-tabs` as the agent dock; add card, menu, overflow; delete `lane-owner.ts` - IN_PROGRESS

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

## Batch A2-1: session header molecule (chat) - IN_PROGRESS

- Wave: W3 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with B-3, C-3)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: one new presentational file; no barrel (chat-view imports it relatively in CV-2)
- Tasks: 1 | Depends on: none (placed in W3 per plan §5)
- Phase: clean-session-view | Phase review: as phase

### Task A2-1.1: create `SessionHeaderComponent` - IN_PROGRESS

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

## Wave 4 - A2-2, A1-2, B-4 (parallel; after W3)

## Batch A2-2: composer chips + autopilot trigger re-skin (chat, chat-ui) - PENDING

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A1-2, B-4)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: composer files only; reads `sessionBranch` (B-3); third owner of the `chat-ui` barrel
- Tasks: 1 | Depends on: B-3, A1-1
- Phase: clean-session-view | Phase review: as phase

### Task A2-2.1: composer top strip, bar order, send restyle; autopilot popover trigger re-skin - PENDING

- Files:
  - MODIFY `F/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` (+ `chat-input.component.spec.ts`)
  - MODIFY `F/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts` (+ `autopilot-popover.component.spec.ts`)
  - MODIFY `F/chat-ui/src/index.ts` only if a new export is needed (shared barrel, 3rd owner; expected none)
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

## Batch A1-2: turn molecules (chat) - PENDING

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A2-2, B-4)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: four new files only, consumed by A1-3
- Tasks: 1 | Depends on: A1-1, C-1, C-2 (chips take `SessionAgent`)
- Phase: clean-session-view | Phase review: as phase

### Task A1-2.1: create disclosure row, activity panel, live line, agent chips - PENDING

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

## Batch B-4: inspector component tree + task reader (chat) - PENDING

- Wave: W4 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A2-2, A1-2)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: new organism files; single owner of `components/index.ts`, third owner of `chat/src/index.ts`
- Tasks: 1 | Depends on: B-2, B-3, C-1, C-2
- Phase: clean-session-view | Phase review: as phase

### Task B-4.1: create `ptah-session-inspector` and its sections, `SessionTaskReader` - PENDING

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
  - MODIFY `F/chat/src/lib/components/index.ts` (single owner; append-only)
  - MODIFY `F/chat/src/index.ts` (shared barrel, 3rd owner; append-only)
- Plan reference: B:307-425 (§5-6); implementation-plan.md:305-331 (§7.2 rendering: `inspectorSection` outlets after
  the Orchestrator card, before AGENTS), :254-256 (row 44), §4 B O4, B O6, B O7; §8 D-B-1, D-B-3, D-B-4
- Pattern to follow: latest-`TodoWrite` locator copied verbatim from
  `F/canvas/src/lib/canvas-detail/canvas-session-details.component.ts:125-143` (B-5 deletes the source);
  `FILE_LINK_OPENER` (`tasks-store.service.ts:1351-1376`) for artifact open
- Quality requirements: AGENTS rows use avatar size 32; `st-r` + `--i` on inspector rows; TASK section renders
  nothing when no or unknown lead task; lead task = primary else most recent `createdAt`; imports tasks only via
  `@ptah-extension/tasks-ui/presentation`; token injected `{ optional: true }`
- Validation notes: lint must show no `@nx/enforce-module-boundaries` error for chat -> `tasks-ui/presentation`;
  if chat jest cannot resolve `/presentation`, report it (assumption from B-2)
- Existing specs to update: none (new files)
- Acceptance: `SessionInspectorComponent` exported from `@ptah-extension/chat`; chat suite, typecheck, lint green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b4-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b4-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b4-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch B-4 - session inspector component tree`
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

## Wave 5 - A1-3, CV-1 (parallel; after W4)

## Batch A1-3: message bubble assistant branch + transcript (chat) - PENDING

- Wave: W5 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with CV-1)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: the turn rewrite; owns the five `.st-t` hooks CV-2 indexes
- Tasks: 1 | Depends on: A1-2, C-2, B-3
- Phase: clean-session-view | Phase review: as phase

### Task A1-3.1: rewrite assistant branch of `message-bubble`; wire turn, roster and needs-you in `chat-transcript` - PENDING

- Files:
  - MODIFY/REWRITE `F/chat/src/lib/components/organisms/message-bubble.component.ts`
  - REWRITE (lines 1-192, keep 193-347) `F/chat/src/lib/components/organisms/message-bubble.component.html`
  - MODIFY `F/chat/src/lib/components/organisms/message-bubble.component.css`
  - MODIFY `F/chat/src/lib/components/organisms/message-bubble.component.spec.ts` (existing)
  - MODIFY `F/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
  - MODIFY `F/chat/src/lib/components/organisms/transcript/chat-transcript.component.html` (`:47-60`)
  - MODIFY existing transcript specs where they break (see below)
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
- Acceptance: closed turn shows disclosure row, answer, chips, action row; live turn shows live line; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs a13-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a13-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs a13-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch A1-3 - clean turn in message bubble and transcript`
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

## Batch CV-1: chat-view shell + inspector host (chat, owner B) - PENDING

- Wave: W5 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with A1-3; first of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: first chat-view edit; hosts the deferred inspector and provides the controller
- Tasks: 1 | Depends on: B-4
- Phase: clean-session-view | Phase review: as phase

### Task CV-1.1: shell root, inert main column, deferred inspector aside, controller wiring - PENDING

- Files:
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.html`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.css`
  - MODIFY where they break: `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`,
    `chat-view.memo.spec.ts` (same folder; provide `SessionInspectorStore` / `InspectorShellController`)
- Plan reference: implementation-plan.md:121-131 (§3.1 CV-1 row), §7.1 (inside an embed `hostsInspector()` is false),
  §7.3 (no `[inspectorSection]` re-projection); B:426-463 (§7 a-e)
- Pattern to follow: existing `afterNextRender` usage in `chat-view.component.ts`
- Quality requirements: root `<div class="cs-shell ...">` + `container-type: inline-size`; `[attr.inert]` on the
  main column; inspector `@if` / `@defer (on immediate)` with `id="inspector"` on the aside;
  `[attr.data-request-id]` on `ptah-question-card`; `providers: [InspectorShellController]`; `hostsInspector`,
  `hasLaneSurface`, tab-feed effect calling `onTabChanged()`, `openLaneFromInspector`, `focusQuestionCard`;
  `controller.attach(...)` in `afterNextRender` with lazy opener/title getters
- Validation notes: no compact-card change here (CV-2 owns A-6 / A-16); `SESSION_CONTEXT` present -> no inspector
- Existing specs to update: the four chat-view specs above, only for the new providers / host markup
- Acceptance: main panel renders the inspector aside without `SESSION_CONTEXT`; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs cv1-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv1-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv1-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch CV-1 - chat-view shell and inspector host`
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

## Wave 6 - CV-2, B-5 (parallel; after W5)

## Batch CV-2: chat-view header, motion, compact-card retirement (chat, owner A2) - PENDING

- Wave: W6 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with B-5; second of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: the one owner of A-6 / A-16; needs CV-1's controller, A2-1's header and A1-3's `.st-t` hooks
- Tasks: 1 | Depends on: CV-1, A2-1, A1-3
- Phase: clean-session-view | Phase review: as phase

### Task CV-2.1: header block, add-on outlets, session-switch stagger, compact-card retirement - PENDING

- Files:
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.html`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `F/chat/src/lib/components/templates/chat-view.component.css`
  - MODIFY where they break: `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`,
    `chat-view.memo.spec.ts`
- Plan reference: implementation-plan.md:126 (CV-2 row), :129-131, :326-327 (header slot outlets, `ngProjectAs`),
  §8 (D-A2-2 withdrawn; trigger `resolvedTabId`); A2:46-51 (component 2), A2:56-104 (component 4 stagger),
  A2:142-157 (chat-view rows), A2:158-193 (binding contract)
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
- Acceptance: header + stagger visible on session switch; compact card shows only when forced; chat suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs cv2-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv2-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs cv2-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`
- Commit: `feat(chat): batch CV-2 - session header, stagger, compact card retire`
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

## Batch B-5: Rail board inspector, delete session details (canvas; last Part B batch) - PENDING

- Wave: W6 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (parallel with CV-2)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: canvas-only; replaces `ptah-canvas-session-details` with `ptah-session-inspector` in the Rail board
- Tasks: 1 | Depends on: B-4, C-3, CV-1
- Phase: clean-session-view | Phase review: as phase

### Task B-5.1: host `ptah-session-inspector` in Rail board asides; gate focus-header details; delete session details - PENDING

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
- Validation notes: one inspector in Rail (the board aside); `SESSION_CONTEXT` hosts never show chat-view's
- Existing specs to update: `canvas-rail-board.component.spec.ts` (`DetailsStub` -> inspector stub);
  `canvas-focus-header.component.spec.ts` if the gate changes an assertion
- Acceptance: no reference to `canvas-session-details` remains; canvas suite green
- Scoped checks:
  - `node .ptah/tmp/check-run.mjs b5-test -- npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b5-typecheck -- npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`
  - `node .ptah/tmp/check-run.mjs b5-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`
- Commit: `feat(canvas): batch B-5 - Rail board inspector, drop session details`
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

## Wave 7 - CV-3 (alone; after W6)

## Batch CV-3: chat-view leftovers from A1 (chat; expected empty) - PENDING

- Wave: W7 | Recommended executor: `frontend-developer` (Claude sub-agent)
- Execution mode: sequential (third and last of the chat-view chain)
- Fallback order: other Claude frontend-developer instance -> none (CLI lanes review only)
- Subagent reason: user rule, Claude builds the frontend; CLI lanes only review
- Review family: implementer Claude; phase reviewer codex
- Rationale: any chat-view binding A1-3 discovered lands here, after CV-2
- Tasks: 1 | Depends on: CV-2, A1-3
- Phase: clean-session-view | Phase review: as phase

### Task CV-3.1: apply chat-view bindings A1-3 reported, or confirm none are needed - PENDING

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

## Wave 8 - BUILD-1 measurement step (alone; after W7, so after B-5, the last Part B batch) - PENDING

- Owner: orchestrator runs it (or a frontend-developer told to run only this command); no code change, no commit
- Depends on: every batch above COMPLETE; no other check or push in flight
- Command (the ONE allowed webview bundle build, user decision row 43; project name verified
  `apps/ptah-extension-webview/project.json:2`):
  `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`
- Pass: no budget error against `initial` `maximumError: "3.5mb"` (`project.json:61`) and `anyComponentStyle`
  `maximumError: "20kb"` (`:66`). Record initial-bundle size and any warnings here.
- Fail: do not rebuild. Candidate fix: move the largest new eager unit behind `@defer` (the turn activity panel
  first; B-4 inspector is already deferred), then a second build only with a new user approval.
- Result: (pending)

## Phase review (after W8)

- Phase: clean-session-view = all 17 implementation batches; combined diff = parent of the first batch commit
  (`2e273fd3c`, current HEAD before W1) to `HEAD`.
- Step 1: one codex code-logic review of the phase diff (orchestrator spawns it; implementer family Claude,
  reviewer family codex). The phase adds new public API (`@ptah-extension/chat-ui` avatar vocabulary,
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

## After 648 merges (not batches now; plan §7.4)

- H1 `F/chat/src/lib/tokens/session-workflow-addons.token.ts`: `sessionWorkflowKind` body ->
  `return tab?.workflow ?? null;` (turns on workflow initial-open, `sel` dot and add-on lookup in both hosts).
- H2 same file: `workflowKind: string` -> `workflowKind: WorkflowKind` (from `@ptah-extension/chat-types`).
- H3 rebase conflicts, keep both sides: `chat-view.component.ts` (648 `forgetWorkflowSession`),
  `canvas-focus-header.component.ts` (648 badge vs B-5 gate), `chat/src/lib/components/index.ts` (exports).
- Orchestrator tells the 648/652 session: register 649 sections through `SESSION_WORKFLOW_ADDONS`; the embed's
  `[sessionHeader]` / `[sessionAddon]` slots stay theirs.

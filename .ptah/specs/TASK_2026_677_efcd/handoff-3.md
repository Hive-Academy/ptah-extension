# TASK_2026_677_efcd — HANDOFF 3

> File name: `handoff-3.md`. NEVER write `HANDOFF.md` (user rule; it overrides the session-budget banner, decisions
> row 8). The next handoff is `handoff-4.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch `feat/clean-session-view`
> (from main `c57a9a1e7`). Origin has commits up to `5ed660524`. LOCAL ONLY (not pushed): `3693f9227`, `a3ab54448`,
> `bfc3c3819`, `4fd86f186`, plus the handoff-3 commit (see §2). No PR yet. No product code changed yet.

## 1. Goal

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (live work log → "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live
line), "This session" inspector (orchestrator card, AGENTS, TASK, TODOS, GIT), header + composer chips, staggered
session-switch animation, T1 carry-over (`reference/pr730-followup-map.md`), plus delta 2: the agent dock (thread
switcher, option B) and agent tiles with provider marks / role icons. Frontend only.

User rules: Claude (orchestrator + Claude sub-agents) builds the frontend; CLI lanes only REVIEW. Approval mode
lane-review (codex APPROVED passes Gates 1, 1.7, 2). Ask the user only for removals, scope or irreversible actions.
Testing postponed (no new spec files); existing suites, typecheck and lint of every changed project still run.
Use lucide-angular icons and `ptah-provider-mark` CLI marks.

## 2. Done (this session)

- **Delta 2 user choice** (decisions rows 30-32): option B agent dock + hover/focus card; no Gemini (Antigravity is the
  real lane type); orchestrator avatar = session provider mark; no new lane types; tool-call rows in the work log stay
  EXACTLY as today (row 32, req 20, D39).
- **Design merge**: `design-spec.md` §4.7 (agent tile/icon system), §4.8 (`[inspectorSection]` slot), §5 header slots
  (`[sessionHeaderChip]`, `[sessionHeaderAction]`), Delta 2 section, D34-D43; `prototype/index.html` + `assets/app.*`,
  `capture.mjs` (170 PASS / 0 FAIL, orchestrator re-ran it: log `%TEMP%\629-check-proto-checks3.log`),
  `DELTA-2-NOTES.md`, screenshots `prototype/screenshots/delta2-merged-*.png` (git-ignored).
- **PM delta**: `task-description.md` reqs 18 (avatar), 19 (agent dock), 20 (tool-call rows unchanged), PM-13..16;
  `parity-inventory.md` rows B-5a, E-1..E-18. No removals.
- **Gate 1.7 delta 2 PASSED** (lane-review): codex `design-spec-review-delta2.md` REVISE 7/10 → designer round 1 →
  codex `design-spec-review-delta2-r1.md` APPROVED 8/10 (rows 33, 37, 38). Two Moderates handed to the plan
  (toggle-dot precedence; overlay tab-switch rule).
- **Coordination with TASK_2026_648** (rows 34-36; 648 decisions D5/D6): 648 lands first; its chat-view edit is only an
  additive `forgetWorkflowSession` call; its canvas-focus-header badge is its own element. 677 provides
  `[inspectorSection]`, header slots, and workflow-tab inspector initial-open (open in every mode where the inspector
  docks; closed with a dot at overlay widths, D43 — 648 accepted). 677 must NOT touch tab-bar, tab-item,
  canvas-rail-card, app-shell, canvas-detail-transcript. A new 648 session will message this task's session with the
  `ptah-session-embed` hosting contract after its Batch 2 commit — check for it.
- **Commit** `4fd86f186` docs(task-specs): delta 2 agent dock, Gate 1.7 pass.
- **Implementation plan, in 4 parts** (two single architects hit the 250k context limit; split, row 40-41):
  `plan-part-a1-turn.md`, `plan-part-a2-header.md`, `plan-part-b-inspector.md`, `plan-part-c-agents.md`.
  NOT yet merged into `implementation-plan.md`; NOT yet reviewed (Gate 2 open).
- **Follow-up filed** (row 39): `TASK_2026_679_45ff` "Move the session list sidebar into a 'Previous sessions' modal"
  (backlog) in the MAIN checkout `D:\projects\ptah-extension\.ptah\specs\TASK_2026_679_45ff\` (untracked: task.md +
  context.md). Starts after 677 and 648 merge.

## 3. In progress / open at handoff

No agent or lane is running. Open items:

1. **Merge the 4 plan parts into `implementation-plan.md`** and settle the cross-part seams:
   - `chat-view.component.html/.ts/.css` is shared by A1, A2, B → serialize: B (root div, `inert`, `@defer` inspector,
     `data-request-id`) → A2 (header + motion) → A1 (thread). One owner removes the compact card (A-6/A-16).
   - `session-git-stats.store.ts` `branch` field: A2 needs it, B owns the git section → assign to B.
   - `libs/frontend/chat/src/lib/services/index.ts`, `chat/src/index.ts`, `chat-ui/src/index.ts`: append-only by B/C/A.
   - A2 open check O1 (needs B) and O2 (header above the compact card?); A1 open check 3 and 8 (needs C's per-turn
     agent status source and B's needs-you count); C open checks (lucide icon data type name, hover-card clipping at
     400/760 px, `paused` → `queued` mapping for the code-logic reviewer); B's 12 open checks.
   - Contracts: C's `ptah-agent-avatar` API (chat-ui atoms; inputs `kind`, `status`, `size` 24|28|32, `cliId`,
     `agentType`) and `SessionAgentRosterService` (chat; `roster(tabId)`, `requestsForTab(tabId)`); B's
     `InspectorShellController` (`isOpen`, `showDot`, `toggleLabel`, `toggle`, `attach()`) and
     `SessionInspectorStore.modelFor(tabId)().needsYouCount`.
2. **Spec deviations the plan introduces** (Gate 2 reviewer must rule; ask the user only if a removal):
   - A2-1: new `ptah-session-header` has NO sidebar toggle (spec §5 item 1); the existing `ptah-sidebar-tab` toggles.
   - A2 motion: stagger whole message slots (last 8) on `resolvedTabId` change, not per turn block (spec §7 row 2).
   - A1-D2: duration end E from messages that have both timestamp and duration (spec §3.9 says every message).
   - A1-D1: fix live finalization timestamp (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:228-240`,
     `factories.ts:37`) so live = reload (`history-message-builder.service.ts:216`).
   - C: canvas `lane-owner.ts` deleted, `ownedBySession` moves to chat (move, not removal); dock shows CLI
     `displayName`; pending/paused sub-agents show `queued`; orchestrator ALWAYS neutral `Workflow` glyph (no provider
     field exists).
   - B: task artifacts open via `FILE_LINK_OPENER` (Tasks-board path), not `editor:openFile`; Rail shows the
     inspector in the Rail board aside.
3. **USER decisions pending** (ask in ONE AskUserQuestion, bundled):
   - Allow ONE webview build after the last Part B batch to measure the bundle (plan adds ~10 kB eager; headroom
     ~10 kB under the 3.5 MB error budget). CLAUDE.md forbids build unless the user asks.
   - TASK section with no linked task: req 17.6 "No task linked to this session" text vs D27 render nothing
     (architect recommends D27).

### 3.4 TASK_2026_648 embed hosting contract (received after the plan parts; decisions row 42)

648 Batch 2 commit `db30cc25d` (branch `feat/task-648-session-embed`, local, stacked on PR #732):
- `SessionEmbedComponent` `ptah-session-embed` (`@ptah-extension/chat`,
  `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts`) hosts ONE unchanged `ChatViewComponent`
  via `*ngComponentOutlet` with a child EnvironmentInjector created once.
- Inputs: `tabId` (req), `visible`, `contentVisible`, `focused`, `minContentWidth`, `startGuard`, `cardActions`,
  `retainRailTranscript`.
- Child-injector tokens: SESSION_CONTEXT = tabId signal; SESSION_VISIBLE = parent SURFACE_ACTIVE && visible &&
  contentVisible; SESSION_FOCUSED = SESSION_VISIBLE && focused; SURFACE_ACTIVE = SESSION_VISIBLE; RAIL_MIN_CONTENT_WIDTH
  (canvas split 360); SESSION_START_GUARD, SESSION_CARD_ACTIONS, RAIL_TRANSCRIPT_RETENTION (optional);
  RailTranscriptRetentionCoordinator only if the parent has one.
- Visible tabs: `TabManagerService.registerVisibleTab(tabId)` is now reference-counted per owner; `visibleTabIds()`
  keeps a tab until its last owner unregisters.
- Embed slots: only `[sessionHeader]` (before) and `[sessionAddon]` (after), plain pass-through.
- `canvas-detail-transcript.component.ts` now renders `<ptah-session-embed>` (677 does not touch it).
- PLAN IMPACT (architect check 6 / plan part B §inspectorSection): the embed creates ChatViewComponent through
  `*ngComponentOutlet`, so content projection into ChatView's `[inspectorSection]` / header slots is NOT automatic —
  it needs `ngComponentOutletContent` (projectable nodes) or the registry-token fallback keyed by workflow kind.
  Prefer the registry token for 649 add-ons; confirm in implementation-plan.md and tell the 648/652 session.
- 648 Batch 3 next (launcher, workflow badges, additive forgetWorkflowSession in app-shell + chat-view); that session
  will message when the stacked PR opens.

## 4. Decisions to know (decisions.md rows 1-42)

Rows 18-20 duration/inspector/message-duration rules; 21-23 user decisions (TASK section; Gate 1; visibility: B-16
visible at rest, B-14/B-15 hover reveal kept — WCAG 2.4.7 limitation accepted); 24 rail question focus; 25 never kill
by image name; 30-32 delta 2 user choices; 33/37/38 Gate 1.7 delta 2; 34-36 648 coordination; 39 follow-up 679;
40-41 plan split and architect decisions.

## 5. Exact next steps

1. Read this file, then `decisions.md` rows 30-41, then the 4 plan parts (offset/limit; they total ~1,900 lines —
   do not load them all into one agent).
2. Ask the user the two §3.3 questions in ONE AskUserQuestion.
3. Merge the plan parts into `implementation-plan.md` (orchestrator, or one fresh `software-architect` with a strict
   write-early protocol and ~120k budget: read part headings + "Files", "Decisions", "Open checks", "batches"
   sections only). Resolve the §3.1 seams; keep each part as an appendix by reference, not by copy.
4. Gate 2: fresh codex lane (complete brief; codex resume is refused above 60k context) reviews
   `implementation-plan.md` + the 4 parts → `implementation-plan-review.md`; it must rule on the §3.2 deviations.
   APPROVED passes Gate 2 (lane-review). Max 2 revise rounds; then the user.
5. `team-leader` MODE 1 → `batches.md` (file-disjoint; chat-view serialized B → A2 → A1; C's avatar/roster batch
   first because A1 and B consume it) → parallel Claude `frontend-developer` batches (worktree path in every prompt)
   → fresh team-leader MODE 2 per batch (scoped checks, commit) → codex code-logic review of the phase diff
   (`code-logic-review.md`; different family from Claude) → one fix round → `visual-reviewer` dark + light vs
   `prototype/` (Electron renderer rebuild only; before screenshots from base `c57a9a1e7`/current main, after
   screenshots) → final commit → push + `gh pr create` as ONE background command (PR body ends with the Claude Code
   line).
6. Before rebasing/merging: check whether TASK_2026_648 (branch `feat/task-648-session-embed`, stacked on PR #732) has
   merged; rebase onto main after it merges; hook `TabState.workflow` into the per-tab initial-open input and the
   slots (one-line hook-ups named in plan part B / A2).
7. Verification (per changed project, one at a time, from the worktree root):
   ```
   node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx typecheck <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx lint <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs proto-checks -- node .ptah/specs/TASK_2026_677_efcd/prototype/assets/capture.mjs checks
   ```
   Expected changed projects: chat, chat-ui, chat-streaming, canvas (and possibly chat-state, core for theme tokens).

## 6. Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\`
  - `task-description.md`, `parity-inventory.md`, `design-spec.md`, `design-delta-2-options.md`, `decisions.md`
  - reviews: `design-spec-review-r2.md`, `design-spec-review-delta2.md`, `design-spec-review-delta2-r1.md`
  - plan parts: `plan-part-a1-turn.md`, `plan-part-a2-header.md`, `plan-part-b-inspector.md`, `plan-part-c-agents.md`
  - `prototype/index.html`, `prototype/options-delta-2.html`, `prototype/assets/*`, `prototype/DELTA-2-NOTES.md`
  - `handoff-1.md`, `handoff-2.md`, this file
- Main source touch points: `libs/frontend/chat/src/lib/components/templates/chat-view.component.*`,
  `libs/frontend/chat/.../message-bubble.component.*`, `chat-transcript.component.*`, `chat-input.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`, `libs/frontend/chat-ui/src/lib/atoms/`,
  `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`.

## 7. Rules (repeat in every lane and sub-agent prompt)

Never kill processes by image name (stop only own PIDs); give designers/architects a context budget (~120k, write the
deliverable early and extend it per section, offset/limit reads, <= 2-3 PNG views) and split large work into
file-disjoint agents; codex resume is refused above 60k context → give fresh lanes complete briefs. Checks only via
`node .ptah/tmp/check-run.mjs <label> -- <command>`; changed projects only, `--parallel=1 --skip-nx-cache`, Jest
`--maxWorkers=2`; one heavy check at a time (never push while a check or build runs); no workspace-wide runs; no
build/serve/dev/e2e/package except the Electron renderer rebuild (and the webview bundle build only if the user allows
it, §3.3); no npm install; no git in `D:\projects\ptah-final-run-ws`; UI changes need before/after screenshots dark +
light; commits foreground, explicit paths, `.commitlintrc.json` scopes (`task-specs`, `chat`, `chat-ui`, `canvas`,
`chat-streaming`, ...), subject <= 72, body lines <= 100, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; at most 3 parallel CLI lanes;
handoff files are `handoff-N.md`, never `HANDOFF.md`. Sub-agent results go to the orchestrator. End each turn with a
short summary of what is done and what is left.

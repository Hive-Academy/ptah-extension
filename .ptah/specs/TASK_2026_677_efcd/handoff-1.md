# TASK_2026_677_efcd — HANDOFF (first handoff)

> File name: `handoff-1.md`. NEVER write `HANDOFF.md` (user rule). The next handoff is `handoff-2.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view` — branch `feat/clean-session-view`
> (from main `c57a9a1e7`, the PR #730 merge). No PR yet.

## 1. Goal

Clean session view, one-to-one with the user's screenshots (`reference/01-clean-chat-turns.png`,
`reference/02-session-shell-with-inspector.png`; PNGs are git-ignored and exist only in this worktree):

1. Clean turn replaces the compact turn view: live work log while streaming, then a collapsed "Worked for Xm Ys ›"
   disclosure, the final answer, a status-coloured agent chip row (sub-agent / CLI lane with provider mark /
   background command), copy + activity actions, "● Orchestrating · 2m 07s" live line.
2. "This session" right inspector: orchestrator card (model · state, context bar, tokens / cost / turns), AGENTS rows
   (icon, name, kind badge, status + duration, activity line, permission request), TODOS, GIT.
3. Header chips (branch, "N needs you"), composer chips (workspace, branch, approval mode, model · effort).
4. Staggered session-switch animation (reduced-motion off).
5. Carry-over T1-01..T1-40 (`reference/pr730-followup-map.md`).

User rules for this task: Claude (orchestrator + Claude sub-agents) builds the frontend; CLI lanes only REVIEW.
Approval mode lane-review; ask the user only for removals / irreversible actions. **Testing postponed**: no new
spec-writing batches (T2 parity tests postponed); existing suites, typecheck and lint of each changed project still run.
Stunning, clean UI with lucide-angular icons and `ptah-provider-mark` CLI icons. Parallelize freely (max 3 CLI lanes).

## 2. Done (this session)

- **TASK_2026_629 closed:** PR #730 merged into main as `c57a9a1e7` (CI 18/18, initial bundle 3.49 MB < 3.50 MB;
  `@defer` on Rail session details + needs-you queue, commit `828b0e66e`). 629 `task.md` status `done`, decision row
  139 (merge used `--admin` like #727/#728; CodeRabbit skipped the last incremental review; 0 open threads).
- **TASK_2026_677_efcd opened** (commit `06c74e984`): `task.md`, `context.md`, `reference/pr730-followup-map.md`.
- **Design (round 0):** `design-spec.md` (40 kB, 15 decisions in §10, data flags in §9, replaced surfaces §12),
  `prototype/index.html` + `prototype/assets/{tokens.css,app.css,app.js,sprite.js,contrast-check.mjs}`,
  `prototype/README.md`, `prototype/screenshots/*.png` (14, dark + light; git-ignored, local only).
- **Codex Gate 1.7 review:** `design-spec-review.md` — **REVISE 5/10** (details §3).
- `decisions.md` rows 1-9.

## 3. In progress / open

- **Gate 1.7 revise round 1 (of max 2)** — not started. Fix the codex findings in `design-spec-review.md`:
  1. Blocking: surface-by-surface parity table + "Proposed removals (user decision)" for message bubble (fork/rewind on
     user bubbles, attachments, tool/file counts, token/cost/duration badges, compaction continuation), chat view
     (stats strip with limits/budget, background tray, compaction markers, permission badge, question cards), Rail
     details aside. Removals go to the USER (AskUserQuestion), never approved by a reviewer.
  2. Serious: routing for Review / Answer per request type and host (session permission, lane permission, question),
     several requests, success/error/closed states, Electron fallback (T1-07); add a question-row prototype state.
  3. Serious: one session-scoped aggregation contract; de-duplicate "needs you" requests; loading/unknown/partial per
     section; hide ahead/behind until a source exists; per-item todos via `parseTodoList`.
  4. Serious: prototype overlay focus entry / inert background / focus return on every close path (400 px sheet).
  5. Moderate: Review/Answer/+N more/Retry targets >= 24x24; 6 px alignment + composer spacing vs reference; label the
     Codex provider mark and the Review button as intentional departures; audit the light focus ring with
     gold-strong (`styles.css:695-708`); state the theme scope (anubis pair measured; other themes = T4).
  6. Minor: verify lucide exports `PanelLeft, PanelRight, GitBranch, ShieldAlert, LoaderCircle, TriangleAlert` (the
     worktree has no `node_modules`; check in `D:\projects\ptah-extension\node_modules\lucide-angular`).
- **PM step not done:** `task-description.md` and `parity-inventory.md` do not exist. The PM was stopped (decision
  row 7). Its exploration results are condensed in §4 — give them to the new PM run; it must not re-explore.

## 4. Code facts (from three exploration helpers; use instead of re-exploring)

Prefixes: C = `libs/frontend/chat/src/lib/components`, CU = `libs/frontend/chat-ui/src/lib`, CS =
`libs/frontend/chat-state/src/lib`, CV = `libs/frontend/canvas/src/lib`.

**Old "compact" = two things, neither per-turn:** (a) tab `viewMode` 'full'|'compact' (`chat-types.ts:507,782`;
`CS/tab-manager.service.ts:3089-3108` toggle/set/get; persisted `CS/tab-persistence.ts:161-175`; toggles in
`CU/molecules/session/tab-item.component.ts:72-83`, `CV/canvas-rail/canvas-focus-header.component.ts:57-60`;
`SESSION_FORCED_CARD` token; `chat-view.component.ts:962-978` `showCompactCard` → `ptah-compact-session-card`
`C/molecules/compact-session/compact-session-card.component.ts:108`); (b) per-message auto-collapse in
`C/organisms/message-bubble.component.ts:216-281` (index < total-4, local, not persisted) with header
(chevron, title, tool/file counts) `message-bubble.component.html:39-89`, badges `:137-185`, copy `:157-163`.
No "Worked for", no stagger, no live turn start time exist today.

**Turn rendering:** `C/organisms/transcript/chat-transcript.component.html:35-68` (`ptah-message-bubble`,
`[isStreaming]` by `streamingBoundary`, render window), execution tree `C/organisms/execution/execution-node.component.ts:167-340`
(text/markdown, `[ptahUi]`, thinking, SDK cards, tool cards `tool-call-item`, inline permission card, agent node →
`ptah-subagent-tile` in the main transcript, `ptah-inline-agent-bubble` elsewhere), session-level permission badge
and question cards `C/templates/chat-view.component.html:165-183`, stats strip `:36-51`, background tray `:59-64`.

**Inspector data sources:** existing near-match `CV/canvas-detail/canvas-session-details.component.ts:103-178`
(context %, tokens, cost, turns, todos summary, branch, +/-). Model: `TabState.overrideModel`/`sessionModel`/
`ModelStateService` (resolution lives in `model-selector.component.ts:192-208`). Effort: `EffortSelectorComponent.effectiveEffort`.
State: `TabState.status` (no "waiting on user"; derive from permissions/questions). Context: `liveModelStats.{contextKnown,
contextWindow,contextPercent}`. Tokens/cost/turns: `TabState.sessionStats` (`messageCount` = assistant messages).
Sub-agents: `AgentMonitorStore.subagents` / `sessionSubagentsForSession()` (`SubagentRecord`, no start time,
`lastToolName` only). CLI lanes: `AgentMonitorStore.agentsOwnedBySession()` (`MonitoredAgent`: cli, status, startedAt,
segments, permissionQueue, displayName, model). Background: `BackgroundAgentStore.agentsForSession()`. Unified rows:
`buildLaneSummary()` `C/molecules/compact-session/compact-lane-rows.ts:52`. Needs-you: `buildNeedsYouItems()`
`CV/canvas-needs-you-queue.ts:28` + per-tab filters `compact-session-card.component.ts:363-381`. Todos:
`summarizeTodos()` / `parseTodoList` `CU/molecules/compact-session/compact-session-metrics.ts:67,105`. Git +/-:
`SessionGitStatsStore.stateFor(root)` (`track(root, tabId)`); branch: `agentOrigin.branch` or workspace-wide
`GitStatusService.branch`. Workspace: `ElectronLayoutService.activeWorkspace`. Approval: `AutopilotStateService.stateFor(sessionId)`.
Provider marks: `ptah-provider-mark` (`providerId`, `fallback`, `size`), slugs `brand-slugs.ts:74-95`; no gemini.
lucide-angular: per-component `LucideAngularModule` + icon objects (`libs/frontend/ui` avoids lucide by design).
Gaps: decision row 9.

**Budget:** webview initial ~3.49 MB of 3.50 MB → new UI must be lazy (`@defer`) or replace eager code 1:1.

## 5. Exact next steps

1. In parallel (Claude sub-agents; worktree above):
   - `project-manager`: write `task-description.md` + `parity-inventory.md` from §4 + `design-spec.md` +
     `design-spec-review.md` finding 1 (no new exploration; read-only; list removals under "Proposed removals").
   - `ui-ux-designer`: revise round 1 on `design-spec.md` + prototype for findings 1-8 (parity table §12, routing,
     aggregation contract, focus handling in `app.js`, 24 px targets, fidelity, focus-ring audit, lucide check).
2. Codex re-review (resume CLI session or fresh lane; `design-spec-review-r1.md`), plus codex review of
   `task-description.md` (`task-description-review.md`). Revise cap: one more round, then escalate to the user.
3. If any capability is proposed for removal → one `AskUserQuestion` to the user (removals are user-reserved).
4. Gate 1/1.7 pass on APPROVED (lane-review) → `software-architect` (`implementation-plan.md`; codex review, Gate 2)
   → `team-leader` MODE 1 (`batches.md`, file-disjoint) → parallel Claude `frontend-developer` batches → team-leader
   MODE 2 per batch → codex code-logic review of the phase diff → visual-reviewer dark + light vs prototype
   (Electron renderer rebuild only) → commit → push + `gh pr create` (PR body ends with the Claude Code line).
5. Verification (per changed project, one at a time, via the lock script; copy exists at `.ptah/tmp/check-run.mjs`):
   ```
   node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx typecheck <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx lint <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run ptah-electron:build-dev   # then: npx nx copy-renderer-dev ptah-electron --parallel=1
   ```
   Note: canvas `typecheck` uses `tsconfig.lib.json` only (specs not type-checked) — read spec types when you touch them.

## 6. Housekeeping still open (ask the user first — removals)

- Remove worktree `.claude-worktrees/feat-task-629-canvas-board-697f422f00f5` (PR #730 merged)?
- Remove the empty folder `D:\projects\ptah-s13-empty-ws` (created by a visual reviewer; listed as a workspace)?
- The 628 session note (handoff-8.md §3 step 11 of TASK_2026_629) was NOT delivered: session
  `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` is not reachable. Send it when that session is live.
- Other follow-up tasks T3-T6 from `reference/pr730-followup-map.md` have no task folders yet (T2 postponed by the user).

## 7. Rules (repeat in every lane and sub-agent prompt)

Checks only via `node .ptah/tmp/check-run.mjs <label> -- <command>`; changed specs `npx nx test <project>
--testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (never --testPathPattern); Mode 2 =
full suite, typecheck, lint per changed project, `--parallel=1 --skip-nx-cache`; one heavy check at a time (never push
while a check or build runs); no workspace-wide runs; no build/serve/dev/e2e/package except the Electron renderer
rebuild; no npm install; ask before `npm rebuild better-sqlite3` or a package.json change; no git in
`D:\projects\ptah-final-run-ws`; UI changes need before/after screenshots dark + light; reviewer briefs write only the
named deliverable; shipping code gets a different-family (codex) review; commits foreground, explicit paths,
`.commitlintrc.json` scopes, subject <= 72, body lines <= 100, ending `Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>`; push + `gh pr create` in one background command, PR body ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`; at most 3 parallel CLI lanes; handoff files are
`handoff-N.md`, never `HANDOFF.md`. Sub-agent results go to the orchestrator: never brief a sub-agent to wait for its
own helpers' reports (decision row 7).

# HANDOFF — TASK_2026_699_833e: session inspector as a resizable side dock

Written 2026-10-19 at session wrap-up (token budget). No lane or subagent is running.

## Goal

Exact user request is in `context.md` (same folder). Summary:

1. The session inspector ("This session" panel) becomes a resizable side dock. A vertical
   `ptah-sidebar-tab` ("Session"), the same as the Workspaces and Git rails, opens and closes it.
2. A drag resize handle (`ptah-split-handle` with a new `inverted` input) sets the width. The width
   persists and is clamped (300–560 px, chat column floor 624 px). The default is wider on large
   screens: 336 / 400 / 448 px at the 1100 / 1500 px breakpoints.
3. Narrow widths keep the current sheet/modal presentation.
4. Added later by the user: each PLAN LIMITS window becomes a card. Its center item (status text or
   progress bar, reset text, source badge) gets its own full-width row. This change applies only to
   the inspector `variant="inspector"`; the `strip` variant stays the same.
5. Evidence required: Electron screenshots, dark + light, at 1440 and 760.

## Locations

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock`
  (branch `feat/inspector-side-dock`, from `main` at `7267c1f4c`). `node_modules` is a junction to
  the main checkout.
- Task folder: `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\.ptah\specs\TASK_2026_699_833e`
- The main checkout `D:\projects\ptah-extension` stays on `main`. Do not edit it.

## Done

| Phase | Result | Artifact |
|---|---|---|
| Requirements (PM) | Gate 1 APPROVED by codex (rev 2; AC 3.6 amended in rev 3 per decision 10) | `task-description.md`, `parity-inventory.md`, `task-description-review.md` |
| Design | Gate 1.7 APPROVED by the user (rev 3) | `design-spec.md`, `prototype/` (index.html, README.md, 4 screenshots), `design-spec-review.md` |
| Plan | Gate 2 APPROVED by codex (rev 3) | `implementation-plan.md`, `implementation-plan-review.md` |
| Decomposition | 4 batches, 10 tasks, all COMPLETE | `batches.md`, `batch-{1..4}-report.md` |

Commits on `feat/inspector-side-dock` (not pushed, no PR yet):

- `9d5063f43` feat(chat-ui): batch 1 - split handle grip, inverted and cancel
- `309cb2bca` feat(chat): batch 2 - inspector dock width store and controller
- `431e7cf75` feat(chat): batch 3 - session tab and resizable inspector dock
- `5fc888d16` feat(chat-ui): batch 4 - inspector plan limit card layout

Uncommitted in the worktree: `batches.md` (Batch 4 SHA on its header), `code-style-review.md`,
`code-logic-review.md`, this `HANDOFF.md`. Commit them with the fix round.

Scoped checks passed after each batch (team-leader re-ran them):
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1` and the same for
`@ptah-extension/chat`.

## In progress: phase review (fix round not started)

Both reviews are codex (a different family from the Claude implementers) over `9d5063f43^..5fc888d16`.

**`code-logic-review.md` — REJECTED 6/10 (0 Blocking, 0 Serious, 1 Moderate, 1 Minor).** The
reviewer's scoped Nx tests for chat-ui and chat passed. It did not run measured overflow or screenshot QA.

1. Moderate, **fix it** (it breaks AC 3.2 and ARIA): `inspectorMaxWidthFor` returns a fractional
   maximum (`inspector-shell.controller.ts:75-82`). `inspectorDockWidth` then rounds up
   (`:106-115`). Example: shell 960.5 + preference 560 → dock 337, max 336.5, chat 623.5, and
   `aria-valuenow > aria-valuemax` (`chat-view.component.html:295-297,322`). Fix: floor the
   effective max to an integer before you clamp, render and bind ARIA. Add a fractional-width test.
2. Minor (record it; fix only if cheap): `split-handle.component.ts:227-229,307-309` clears
   `document.body.style.cursor/userSelect` to empty instead of restoring the previous values.

**`code-style-review.md` — REJECTED 5/10 (1 Blocking, 1 Serious, 1 Moderate)**

1. Blocking: export `type SplitHandleAppearance` from `libs/frontend/chat-ui/src/index.ts:17-20`.
2. Serious: move the dock block `chat-view.component.ts:1162-1245` (persistence binding, draft
   width, width computation, tab-opener lookup, commit policy, reset) into a small
   controller/store next to `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts`.
   Keep the view as a binding surface. The file grew from 2041 to 2135 lines.
3. Moderate: `split-handle.component.ts:44-95` duplicates the separator element in the grip and
   line branches. Use one separator with shared bindings, and branch only the visual children and
   classes. The default `line` render must not change (R4). Per the fix-round rule, Moderate is
   optional. It is cheap and lowers the a11y risk, so fixing it is recommended.

Fix-round rule (orchestration): one fix round, fix Blocking + Serious (+ the logic Moderate above),
then one re-review by codex scoped to the fix commits.

## Not started

- **Visual review** (`visual-review.md`, `screenshots/`) by the `visual-reviewer` subagent in the
  Electron dev app. Required: 4 screenshots (dark/light × 1440/760) compared to `prototype/`, plus
  Plan Limits cards at a 300 px dock, a 560 px dock (shell ≥ 1184 px) and the 760 sheet, with
  measured `scrollWidth <= clientWidth` per card (11 shots in total, plan QA item 5).
  **The Electron dev app is shared:** other sessions announce "Electron: <task> launching" and
  "Electron: free". After wrap-up, session 662 sent "Electron: free" (port 9390 closed). Another session can take it
again, so check for new peer messages before you launch. Before you
  launch, send "Electron: 699 launching, port <n>" to peers, and send "Electron: free" after.
- Team-leader Mode 3 (completion: parity-inventory row-by-row, write-path trace) and Gate 3.
- Push and PR. **Branch `feat/inspector-side-dock` is local-only.**

## Open problems and decisions

- `decisions.md` rows 1–12 hold all decisions. Notable ones:
  - Row 5: the open/closed state stays per tab in memory.
  - Row 6: Electron screenshots only; component tests cover VS Code.
  - Row 8: an unknown-usage 5-hour window is expandable.
  - Row 10: the width is install-wide in Electron and per view type in VS Code.
  - Row 12: Claude subagents implement; codex reviews (user memory: frontend → Claude writes, lanes review).
- Later tasks recorded in `batches.md` notes:
  - The existing `[class.w-1.5]` host binding in the split handle renders 4 px (not fixed per R4).
  - 15 NG0101 warnings in the chat-view spec, which also exist on main.
- Peer branch `fix/chat-column-alignment` (session 685) owns `chat-transcript.component.css/html`,
  `message-bubble.component.css/html` and `chat-input.component.ts`. Do not edit them.

## Key files

- `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts` (+ `.spec.ts`)
- `libs/frontend/chat-ui/src/index.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts` (+ spec), `stats-tile.styles.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html,css,spec.ts}`
- `libs/frontend/chat/src/lib/services/session-inspector/{inspector-shell.controller.ts, inspector-dock-width.store.ts, index.ts}` (+ specs)

## Exact next steps

1. Fix round (Claude `frontend-developer` subagent, working directory = worktree). Brief: style
   findings 1–3 and logic finding 1 (logic finding 2 optional), with the file:line references above.
   No `any`, no `console.*`, Angular signals/`input()`/`output()`/`inject()`.
2. Verify, one check at a time, with tailed output:
   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1`
   and confirm that the header says "Running target ... for 2 projects". Never run workspace-wide,
   build, serve, e2e or package. Use Jest `--maxWorkers=2`.
3. Team-leader Mode 2 with the fix report + both review paths. It commits in the foreground
   (`.commitlintrc.json`: subject ≤ 72, body lines ≤ 100). End the message with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
4. Codex re-review (`ptah_agent_list` first; codex had room), scoped to the fix commits. Overwrite
   `code-logic-review.md` / `code-style-review.md`.
5. Visual review in Electron after "Electron: free" (see above). Show the screenshots to the user.
6. Team-leader Mode 3, then Gate 3. Then push and open a PR in one background command:
   `git push -u origin feat/inspector-side-dock && gh pr create ...` (Summary + Test plan; end the
   body with "🤖 Generated with [Claude Code](https://claude.com/claude-code)"). Report the PR link.
   Do not merge to main.

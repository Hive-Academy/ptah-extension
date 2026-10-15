# Mode 3 (completion, verify only) - phase R9 Rail board - TASK_2026_629_c0b3

W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`, branch
`feat/task-629-canvas-board`, HEAD `af028f886` (merge of origin/main on `10a660318`), 112 commits ahead of
origin/main and 0 behind. `git status --short libs apps` is empty. No commit, push, test or code edit was made.
`task.md` status is not changed because the verdict is not COMPLETE.

## Verdict: INCOMPLETE

Batches, commits, reviews, scoped checks and the persistence write path pass. Two completion checks fail:

1. **Parity (check 1):** 10 keep/move rows have no passing test and no rendered proof: 8, 10 (Rail part), 37,
   79, 80, 82, 85, 91, 116 and 123. Row 116's only proof is an e2e spec whose selectors no longer match the Rail
   page. Six more rows (86, 94, 95, 96, 98 and 48 at store level) are only partly proven.
2. **UI evidence (check 3):** the display dock has no "before" image in either theme and no light "after"
   image. The split pane headers (row 113 change) have no "before" image in either theme.

The gaps are small, but under this mode's rules a missing proving test or missing rendered evidence blocks
completion. They are listed below with the fix route.

## Batches, commits and phase reviews

- `batches-rail-r9.md`: all 24 batches (R9a-R9x) and all 24 tasks are COMPLETE, each with a SHA. Every SHA is
  an ancestor of HEAD (`git merge-base --is-ancestor`, 24/24). The phase-fix commit `201175e0e` and the
  session-12 commits `e838659a6`, `73556b428`, `41dfa6056` and `10a660318` are also in HEAD.
- Doc nit (not blocking): the summary line in `batches-rail-r9.md:3` still reads "Complete: 12/24", but every
  batch header says COMPLETE.
- Phase reviews and their fix rounds:
  - `code-logic-review-R9-phase.md` APPROVE-WITH-FIXES 6/10. Fix A re-review APPROVE 8.5/10.
  - `codex-review-R9-phase.md` REVISE 6/10. Its only Serious is logic F1, which Fix A fixed.
  - `code-style-review-R9-phase.md` APPROVE-WITH-FIXES 7/10. F1-F5 go to the named later task.
  - Fix B: correction `codex-review-R9-phase-fixB-correction.md` APPROVE 8/10.
- Session-12 user-test changes:
  - C-card: `codex-review-rail-actions-inside.md` scored 8.
  - C-dedupe: `code-logic-review-agents-dedupe.md`. Fix D APPROVE 7/10. Fix D2 REVISE 5/10, then Fix D3 APPROVE
    8/10. The cap is closed.
  - C-headers: `codex-review-split-headers.md` REVISE 6/10, then Fix H `codex-review-split-headers-fix.md`
    APPROVE 9/10.
  - Fix C2: `codex-review-fix-c2.md` REVISE 6/10, accepted for anubis and anubis-light by decision 124. The
    other themes go to the named later task. The cap is closed.
- Scoped checks after the last main merge (orchestrator results):

  | Project | Suites | Tests |
  |---|---|---|
  | canvas | 23 | 346 |
  | chat-ui | 72 | 1425 |
  | chat | 205 | 3776 (2 skipped) |
  | chat-state | 25 | 568 |
  | tribunal-panel | 17 | 336 (Mode 2) |
  | ratchet spec | | 11/11 |

  Typecheck has 0 errors (canvas, chat-ui, chat, tribunal-panel). Lint has 0 errors, with 31 warnings in canvas,
  7 in chat-ui, 40 in chat and 0 in tribunal-panel.

## Check 1 - Parity (rows 1-124)

Sources:
- `parity-inventory-layout.md` holds rows 1-116.
- Rows 117-124 are in `implementation-plan-rail-r9-split.md` "New parity rows to add to inventory". Doc gap:
  they were never copied into the inventory file.
- Approved removals: decisions 73 and 80 (the Grid removal list in `implementation-plan-rail-r9.md` "Proposed
  Removals"), 83 (Details is an overlay in split), 86 (split is not persisted) and 112 (the dock Agents tab).

Every cited spec line was read on disk. Paths are relative to `W\libs\frontend` unless they start with `apps/`.

### Approved removals (the kept parts are verified)

- **Rows 2, 3, 5, 6, 7, 9 and 23:** Grid presets, lock, spans, row breaks, layout focus, height stepper and
  detail lock. Decisions 73 and 80 (the 1-44 equivalents of rows 46-51).
- **Row 1 (layout menu):** removed with its contents, rows 2-3 and 46 (decision 80 list). The dock slot stays:
  `canvas/.../orchestra-canvas.component.spec.ts:861`.
- **Rows 45-47 and 49-51, 53-55, 62:** decisions 73 and 80. The kept parts:
  - `orchestra-canvas.rail.spec.ts:288` "stored grid board renders Rail"
  - `canvas-rail.component.spec.ts:70` density
  - `canvas-rail-board.component.spec.ts:667` one live view
  - `orchestra-canvas.rail.spec.ts:315` popover
- **Row 52 / 114:** the compact-height API. Old records are tolerated: `chat-state/.../tab-restore-sanitize.spec.ts:224`.
- **Rows 56 and 57:** the geometry and the Grid host are removed. The moved parts are proven in the moved-rows
  table below.
- **Row 58:** decisions 73 and 112. Ownership is still tested: `chat/.../compact-lane-rows.spec.ts:112`.
- **Row 59:** decisions 73 and 112.
- **Row 60:** the mechanism is removed. The leak guarantee:
  - `canvas-rail-board.component.spec.ts:634` and `:572`
  - Electron `s-heap`: 0 detached nodes (`recheck-s12-report.md` rows 1 and 1b; `recheck-s12-fix-report.md` 5b)
- **Row 61:** the geometry is removed. Kept: the observer, TileLayout, migration, order and cap:
  - `canvas-layout.service.spec.ts:61`, `:125`
  - `canvas-layout-persistence.service.spec.ts:72`
  - `canvas.store.spec.ts:405`
  - `orchestra-canvas.rail.spec.ts:436`
- **Row 74:** the dock Agents tab is removed (decision 112). The owner rule stays:
  `chat/.../agent-monitor-panel.scope.spec.ts:157`, `:189`.
- **Row 113:** decision 73. Kept: `canvas-rail-board.component.spec.ts:684`, `orchestra-canvas.rail.spec.ts:326`.
- **The split "Proposed Removals":** decisions 83 and 86. Details overlay: `canvas-rail-board.component.spec.ts:936`.
  Split state is not persisted: there is no split field in the store or the persistence schema (grep).

### Keep/move rows proven by a test (spec:line)

| Rows | Proof |
|---|---|
| 4, 48 | `canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:984`; `canvas-rail-card.component.spec.ts:526`; `canvas-rail.component.spec.ts:111` |
| 11, 43 | `canvas-rail-card.component.spec.ts:216,245,286`; `canvas-rail.component.spec.ts:85` (Space key not tested, Enter is) |
| 12, 13, 14, 16 | `canvas-rail-board.component.spec.ts:380,398,634,667` (split: 2 live views, `:1361`) |
| 15 | `canvas-rail-board.component.spec.ts:761,860` |
| 17, 18 | `canvas-rail-board.component.spec.ts:371,1118`; `orchestra-canvas.rail.spec.ts:304`; `canvas.store.spec.ts:347,405`; `canvas-detail-transcript.component.spec.ts:314,365` |
| 19, 63, 64 | `canvas-layout-persistence.service.spec.ts:36,50,88,103,121,135,177,189`; `canvas.store.spec.ts:317,329` |
| 20 | `orchestra-canvas.component.spec.ts:473,617,653`; `orchestra-canvas.rail.spec.ts:340` |
| 21, 56 | `canvas-detail.service.spec.ts:46,72`; `canvas-focus-area.component.spec.ts:355,366`; `canvas-rail-board.component.spec.ts:584` |
| 22 | `canvas-rail-board.component.spec.ts:527,540,936` |
| 24 | `canvas-rail-keyboard.spec.ts:29,39`; `orchestra-canvas.rail.spec.ts:463` |
| 25, 26 | `canvas-lane-tabs.component.spec.ts:27,133,185`; `canvas-rail-card.component.spec.ts:234,267`; `canvas-lane-view.component.spec.ts:114` |
| 27, 76 | `canvas-detail-transcript.component.spec.ts:226,277`; `canvas-focus-area.component.spec.ts:200`; `canvas-session-details.component.spec.ts:99,127` |
| 28 | `canvas-needs-you-queue.component.spec.ts:80,113,176`; `chat-ui/.../compact-rail-card.component.spec.ts:303` |
| 29, 30, 31, 67 | `orchestra-canvas.component.spec.ts:299,455,568,805`; `orchestra-canvas.rail.spec.ts:326,340,365,381,436,499`; `canvas.store.spec.ts:170`; `chat/.../chat-input.component.spec.ts:257` |
| 32 | `chat/.../chat-view.component.spec.ts:1340,2487` (Rail mounts the same ChatView) |
| 33, 57 | `canvas-rail-board.component.spec.ts:228,1086`; `canvas.store.spec.ts:428,441`; `canvas-focus-area.component.spec.ts:184`; `canvas-rail-card.component.spec.ts:386` |
| 34 | `canvas-focus-header.component.spec.ts:21,34,74` (partial; see row 8) |
| 35, 121 | `chat-input.component.spec.ts:310,325,339,420`; `canvas-rail-board.component.spec.ts:1445` |
| 36 | `canvas-rail-board.component.spec.ts:514,876`; `canvas-rail.component.spec.ts:132`; `orchestra-canvas.component.spec.ts:906` |
| 38, 101 | `canvas-detail-transcript.component.spec.ts:428`; `canvas-session-overrides.spec.ts:8` |
| 39 | `canvas-detail-transcript.component.spec.ts:484`; `canvas-lane-view.component.spec.ts:114`; Electron `s-heap` |
| 40 | `canvas-focus-area.component.spec.ts:326` |
| 41 | `canvas-render-metrics.service.spec.ts:5,26`; `canvas-rail-board.component.spec.ts:495` |
| 42 | `orchestra-canvas.component.spec.ts:843,956,969`; `canvas-rail.component.spec.ts:79`; `canvas-rail-board.component.spec.ts:684` |
| 44 | `orchestra-canvas.component.spec.ts:371,412,426`; `canvas-detail.service.spec.ts:78` |
| 65 | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:46,219` (updated, not run) |
| 66, 115 | `tribunal-panel/.../tribunal-page.component.spec.ts:251,295`; `apps/ptah-electron/src/config/packaged-deps.spec.ts:166` |
| 68-73, 75, 77, 78 | `chat/.../display-dock.component.spec.ts:140,149,162,254`; `chat-view.dock.spec.ts:457,466,509,543,618,676,727,807`; `chat-ui/.../turn-summary.component.spec.ts:159,209,345,553,651`; `chat-transcript.display.spec.ts:459,805`; `ptah-ui-display-chip.component.spec.ts:219,365` |
| 81, 97 | `canvas-lane-view.component.spec.ts:492` |
| 83 | `execution-node.ptah-ui.spec.ts:591`; `canvas-lane-view.component.spec.ts:221,300` |
| 84 | `subagent-tile.component.spec.ts:96,110`; `canvas-lane-view.component.spec.ts:446`; `single-chat-subagent-view.component.spec.ts:161` |
| 87 | `inline-agent-bubble.component.spec.ts:139`; `subagent-tile.component.spec.ts:78` |
| 88, 89, 90, 104 | `canvas-lane-view.component.spec.ts:221,446,492`; `inline-agent-bubble.component.spec.ts:268,374,403` |
| 92, 103 | `canvas-lane-view.component.spec.ts:251`; `single-chat-subagent-view.component.spec.ts:139,178,214` |
| 93 | `canvas-lane-view.component.spec.ts:221,492`; `tool-call-item.component.spec.ts:279` |
| 99 | `execution-node.ptah-ui.spec.ts:605` |
| 100 | `canvas-lane-view.component.spec.ts:313`; `canvas-detail-transcript.component.spec.ts:365` |
| 102, 122 | `transcript-retention.service.spec.ts:253,268`; `rail-transcript-retention-coordinator.service.spec.ts:110,122`; `canvas-rail-board.component.spec.ts:743` |
| 105 | `subagent-tile.component.spec.ts:34` |
| 106-111 | `turn-summary.component.spec.ts:159,200,209,243,276,345,449,553,594` |
| 112, 120 (protected, decision 77) | `canvas-detail-transcript.component.spec.ts:65` (Rail host); `chat-view.dock.spec.ts:807` (single chat view); `chat-view.dock.spec.ts:745`; `canvas-rail-board.component.spec.ts:1445`; Electron re-check: dock shows Displays only |
| 117 | `canvas-rail-board.component.spec.ts:807,876`; `canvas-detail-transcript.component.spec.ts:402` |
| 118 | `canvas-rail-board.component.spec.ts:772` (click/Enter/Space), `:847` |
| 119 | `canvas-focus-area.component.spec.ts:264,355` |
| 124 | `canvas-rail-board.component.spec.ts:984`; `canvas-rail-geometry.spec.ts:17` |

### Rows without a proving test (BLOCKING)

| Row | Capability | What exists | Missing case |
|---|---|---|---|
| 8 | Compact/Full toggle on the focused session (AC 1.6) | Wired at `canvas/.../canvas-focus-area.component.ts:50` (`tabs.toggleTabViewMode(id)`). The header spec checks only the label and aria (`canvas-focus-header.component.spec.ts:27,142,227`) | A click on `[data-compact]` reaches `toggleTabViewMode(focusedId)` |
| 10 | Automatic card never writes `TabState.viewMode` (AC 1.5), Rail part | `SESSION_FORCED_CARD` is provided by the Rail card (`canvas-rail-card.component.ts:50`), but no canvas spec covers it. The chat-side proof is `compact-session-card.component.spec.ts:567` and `chat-view.component.spec.ts:2369` | The Rail card provides the forced card, the focus slot does not, and no `viewMode` write happens |
| 37 | Rail cards pause decorative animations | Holds by construction: `compact-rail-card` does not use `compact-session-activity` | A no-animation assertion in the rail card spec |
| 79 | Agent summary XML in the full lane | No spec mounts `ptah-agent-summary` | Full-lane case |
| 80 | Thinking blocks in the full lane | No spec mounts `ptah-thinking-block`. `execution-node.ptah-ui.spec.ts:387` is a negative check only | Full-lane case |
| 82 | SDK workflow/task/monitor/scheduleWakeup cards in the full lane | Component-level partials (`execution-node.send-message.spec.ts:116`, `workflow-card.component.spec.ts:32`, `task-card.component.spec.ts:46`) | Full-lane case |
| 85 | Tool errors in the full lane | Component level only (`tool-call-item.component.spec.ts:58`) | Full-lane case |
| 91 | RPC command error line (`subagent-command-error`) | Store only (`chat-streaming/.../agent-monitor.store.spec.ts:1155`) | UI case in `inline-agent-bubble` |
| 116 | Task-337 agent card refresh (e2e) | `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:57-58` is stale (see below) | Fix the selectors |
| 123 | Session order survives reload | Adjacent moves and the generic v3 round-trip are tested. `CanvasStore.reorderTiles` (`canvas.store.ts:364`) has no unit test and is mocked everywhere; the e2e does not reload | Store-level reorder, then persist, then hydrate |

Details for row 116, verified:
- `FOCUSED_SESSION = '... section[aria-label="Focused session"]'` is an exact match, but the board now sets
  `Focused session: <title>` (`canvas-rail-board.component.ts:517-520`).
- `AGENT_CARD = 'ptah-inline-agent-bubble'`, but the Rail transcript renders `ptah-subagent-tile` (tile mode).

Partly proven, recorded rather than blocking (they ride with the same test batch if cheap):
- 86: no tile or lane case for the `interrupted` status.
- 94: follow and pin are not asserted, only the listener.
- 95: the full-lane stats footer is not rendered in a test.
- 96: the full-lane tool count is proven only by the stale row-116 e2e.
- 98: the full-lane "Starting" and "No execution data" placeholders.
- 34: Send to messaging is not exercised.

## Check 2 - Persistence write path: PASS

| Write | Writer | Key / scope | Value format | Reader | Result |
|---|---|---|---|---|---|
| Rail order (Move up/down, Alt+Shift) | `CanvasStore.reorderTiles` (`canvas/src/lib/canvas.store.ts:364`), then `updateActiveTiles`, then `schedulePersist` (`:604-611`), then `CanvasLayoutPersistenceService.schedule` (250 ms debounce, flush on pagehide/destroy), then `write` (`canvas-layout-persistence.service.ts:310-333`) | `localStorage` `ptah.canvas-layout.ws.{encodedPath}.{panelId\|primary}` (`:178-182`), per workspace and panel | `{version:3, tiles:[{tabId, order, width, rowBreakBefore}], board:{mode:'rail', railCollapsed, railDensity, railScrollTop}}` | `load()` (`:186-248`), strict `v3Schema`, then `normalize(tiles)` ordered by `order`, then store hydrate (`canvas.store.ts:487-513`) | Intended. The writer's `board` keys equal `CanvasBoardState` (`canvas-board-mode.ts:4-9`), so the strict schema accepts its own output |
| Rail card state (collapse, density, scroll) | `setRailDensity` / `setRailScrollTop` / `updateBoard` (`canvas.store.ts:255-268`, no-op on equal values), same path as above | same | `board.*` with `.catch` defaults per field | same | Intended |
| Stored Grid board | none (read only) | same | `mode:'grid'` is transformed to `'rail'` on read; `write` always stores `'rail'` | `boardSchema` | Intended (decision 73). Tested at `canvas-layout-persistence.service.spec.ts:50` |
| Version boundary | `write` emits v3; a v2 record loads with Rail defaults and is rewritten as v3 on the first change (`canvas.store.spec.ts:317`); v1 is migrated | same | v3 | An older build (main, `LATEST_VERSION 2`) reads v3 as newer: it renders defaults read-only and keeps the bytes (constraint 10); the same rule holds here for `version > 3` or a non-integer version (`:103`) | Intended, forward-safe. A downgrade shows default layout without data loss |
| Split focus | none | n/a | n/a | n/a | Not persisted (decision 86). Grep finds no split field in the store or persistence |
| Focus | none in the canvas record | n/a | n/a | Hydration takes focus from `TabManager.activeTabId()` (`canvas.store.ts:491-494`) | Unchanged |
| Tab view mode | `chat-state/src/lib/tab-persistence.ts`; `compactHeightUnits` dropped (R9s) | existing tab storage, unchanged key | `viewMode` only; `compact-tall` maps to `compact` (`:161-174`); a stray `compactHeightUnits` is deleted on restore (`:234-267`) | restore sanitize; `tab-restore-sanitize.spec.ts:209,216,224` | Intended; old payloads load |
| Dock width / pin, retention | in-memory `DisplayDockState` / retention coordinator | none | n/a | n/a | Not persisted (no storage call in those services) |

Recorded rather than blocking: after one failed write `writeFailed` stays true until the next successful write.
There is no repeat-failure counter (R9w M1, below). This is the only storage writer in `canvas/src/lib`
(grep `localStorage`).

## Check 3 - UI evidence (dark + light, before/after): FAIL (gaps)

S = `W\.ptah\tmp\final-run\shots\`. Every listed file exists.

| Surface | Before | After | Gap |
|---|---|---|---|
| Rail board | `S\before-r9-rail-anubis.png`, `S\before-r9-rail-anubis-light.png` (also `before-r9-grid-*`) | `S\after-s12fix-rail-anubis.png`, `S\after-s12fix-rail-anubis-light.png` | none |
| Rail card (actions inside, focused highlight) | `S\before-r9-rail-anubis.png`, `S\before-r9-rail-anubis-light.png` (no actions in the card), `S\after-s12-rail-focused-anubis*.png` (pre-C2) | `S\after-s12-rail-actions-anubis.png`, `S\after-s12-rail-actions-anubis-light.png`, `S\after-s12fix-focused-card-anubis.png`, `S\after-s12fix-focused-card-anubis-light.png` | none (the R9v gutter state the user complained about was never captured; the pre-R9 base serves as before) |
| Split pane headers (row 113) | **none in either theme** (recheck-s12 "Before / after pairs": "none") | `S\after-s12fix-split-swapped-anubis.png`, `S\after-s12fix-split-anubis-light.png`, `S\after-s12fix-split-header-active-anubis-light.png`, `S\after-s12fix-split-header-inactive-anubis-light.png`, `S\after-s12fix-split-swapped-anubis-light.png`, `S\after-s12-split-anubis.png` | **Missing before (dark + light).** Decision 113 requires before/after dark + light. Capture from `201175e0e` (before `73556b428`) |
| Display dock (Agents tab removed, row 112) | **none in either theme** | `S\after-s12fix-display-dock-anubis.png`, `S\after-s12-display-dock-anubis.png` (dark only) | **Missing before (dark + light, base commit with the Agents tab, e.g. `201175e0e` or origin/main single chat view) and after light** |

Contrast evidence for the changed colours, measured in the running app (`recheck-s12-fix-report.md`):
- Focused frame: 3.59 / 9.53.
- Pills: at least 4.99.
- Inactive header: 6.04.
- Notice: 13.89 / 14.21.
- Divider: 6.05 / 6.04.
- Smoke: 0 shifts.

Not measured: themes other than anubis and anubis-light (decision 124, named later task), and F-D switch long
tasks (decision 121, named later task).

## Check 4 - Recorded, not fixed (for the PR body)

See the PR body draft below. Nothing on that list breaks a lane config or loses data, so it sits outside the
fix-round rule.

## Check 5 - PR body draft

Title (61 chars): `feat(canvas): Rail board with split focus replaces Grid board`

```markdown
## Summary

Orchestra Canvas mission board (TASK_2026_629_c0b3), phase R9: the Rail board replaces the Grid board.

- Grid mode is removed (user decision 73/80): no board toggle, Gridstack board, presets, lock, span resize, row
  breaks, layout focus, height stepper or Grid detail panel. A stored `mode: 'grid'` record opens as Rail with no
  data loss. Gridstack stays in package.json (Tribunal uses it).
- Rail board: Rail cards plus one focus area with lane tabs (orchestrator, sub-agents, CLI lanes, background).
  The focused session keeps the protected display dock (`ptah-ui display [id]` updates in place).
- Split focus (user decision 80): two live sessions side by side. They stack below 1440 px. Each pane has its own
  lanes, dock, draft and Details overlay. Swap; 1/2 pane markers; active-pane header accent; divider. Split state
  is not persisted (decision 86).
- Rail reorder: Move up/down in the card's Session actions menu (inside the card) and Alt+Shift+Arrow. The order
  is persisted in the v3 canvas record.
- Sub-agent tile in the execution tree opens the full live lane (Rail) or the full view (single chat).
- The display dock shows Displays only. The Agents tab, its badge, running count and embedded monitor are gone
  in every Electron host (decision 112). The sub-agent click opens the execution in the main view. In Electron
  the "Workflow launched" chip is static.
- The panel Turn summary uses the inline mini-card style.
- Retention: at most 1 live ChatView (2 in split) and 4 frozen transcripts, shared by a board-scoped coordinator.
- Contrast for anubis and anubis-light: focused Rail card frame, state pills, quiet inactive split header, and
  a visible "This agent is not available yet." notice.
- Persistence: canvas record v3 (`ptah.canvas-layout.ws.{path}.{panel}`). v1 and v2 migrate. A newer version
  stays read-only. `TabState.compactHeightUnits` is dropped, and old tab payloads still load.

## Test plan

- [x] canvas 23 suites / 346 tests; chat-ui 72 / 1425; chat 205 / 3776 (2 skipped); chat-state 25 / 568;
      tribunal-panel 17 / 336; webview alpha-text ratchet 11/11
- [x] typecheck canvas, chat-ui, chat, tribunal-panel: 0 errors; lint 0 errors (warnings: canvas 31, chat-ui 7,
      chat 40)
- [x] Automated Electron re-check (anubis + anubis-light, 1600x967 and 1920x983): s-heap 0 detached
      lane-view/detail-transcript/chat-msg-slot, no Grid DOM, 1 live view (2 in split), 0 Rail shifts; contrast
      measured in the app (focused frame 3.59 dark / 9.53 light, pills >= 4.99, inactive header 6.04, divider
      6.05/6.04, notice 13.89/14.21); markers follow Swap; dock shows Displays only
- [x] Before/after screenshots dark + light (board, card, split headers, dock), attached
- [ ] Electron e2e (`canvas.spec.ts`, `task-337-agent-card-refresh.spec.ts`) not run in this branch

## Recorded, not fixed

User-accepted gaps
- Electron single chat view has no surface for CLI-agent permission requests now that the dock Agents tab is
  gone (row 116). Accepted until the agent-tile follow-up.
- Rail state colours and the focus frame in the 32 other DaisyUI themes: frame < 3:1 in 13/32, pill text < 4.5:1
  in 23/32. These are not regressions (row 124). The split-header state chip and `canvas-rail.component.ts:51-63`
  have the same issue (row 123).
- Rail switch: 8/10 swaps still have a long task > 50 ms (baseline 10/10; script median 107 -> 35 ms) (row 121).

Session 12 (C-card, C-dedupe, C-headers and their fixes)
- Fix D (row 119): M2 is the `CanvasDetailService.open` session-ownership check. All mocks share one session,
  so the branches are untested. M1 was closed by Fix D2/D3.
- Fix D Minors:
  - m1: "Its agents appear as lanes of this session." is true only in the Rail.
  - m2: `canvas-rail-card.component.ts:273` and `canvas-needs-you-queue.component.ts:238` ignore the `open`
    return value, so the click is a silent no-op on a rare race.
  - m3: an order-dependent `[role="status"]` query in `canvas-detail-transcript.component.spec.ts:126`.
  - m4: the wording "not available yet" is wrong for restored history.
- Fix D3 Minors (row 125):
  - dev-mode NG0956 warning on every repeated rejection;
  - the notice's layout and stacking are not pinned by a spec;
  - spec timers depend on incidental Angular timers;
  - post-destroy re-arm sits in one large `it`.
  - The notice also covers the context chip strip for 4 s (pointer-events none, no shift).
- C-headers review finding 3: the specs check the `pane-active` class, not the rendered bar or contrast. The
  in-app contrast re-check covers it.
- Lint: +3 warnings in canvas specs (C-headers) and +2 dead imports in chat specs (C-dedupe).

R9 phase reviews
- Logic F4: `close()` acts after `await removeTile` without re-checking the active workspace.
- Logic F5: the focus-repair effect can call `switchTab` with a null store focus above the hydrate bound.
- Logic F6: `focus-area.stop()` relies on `focusin` running before `click`.
- Logic F7: `assertDistinct` throws after the state was mutated (dev).
- Logic F8: stale Grid references in `app-shell.component.ts:118`, `lazy-view-components.token.ts:38` and the
  `sessions.shot.ts:68` locator.
- Style F6-F12:
  - `distinctRetainedCount` has no consumer;
  - ignored output payloads;
  - `chat-transcript.component.ts` is 1231 lines;
  - details in `subagent-tile`;
  - glyph controls instead of lucide;
  - the retention service and coordinator are coupled;
  - canvas token names live in the `chat` lib.
- Fix A Minors:
  - N1: a silent guard;
  - N2: a transient third-tab window (cosmetic);
  - N3: coverage gaps (stubbed Rail chain; no lane-action or stop case).
- Fix B notes: the fenced display path from parser to dock is not exercised end to end in the conductor; the
  conductor spec reads `__annotations__`.

R9 batches
- R9v:
  - `native-dropdown` emits `opened` after a cancelled position (pre-existing);
  - the collapsed Rail scrollbar is hidden;
  - the unpositioned popover fallback can clip at a viewport edge;
  - NG0953 dev warning;
  - the `+N more` pixel fit is checked only in the visual check.
- R9w:
  - Minors 1 and 3-6;
  - NEW-5 and NEW-7;
  - M1: a repeated write failure needs a persistence-service counter;
  - M4: no real A->B subtree case;
  - correction findings C4 and C5.
- R9x: +12 canvas lint warnings, including `max-lines` on `canvas-rail-board.component.ts` (cleanup task).
- R9u:
  - the unregistered host without SESSION_CONTEXT;
  - a soft cap above two hosts;
  - no dev assert for the same tab in both panes;
  - N3: `aria-valuemax` is off when the host is < 400 px;
  - N4: stored vs visible dock width after End;
  - `releaseHost` rewrites the registry for an unregistered host;
  - the N1 test uses a stub pane;
  - 8 pre-existing NG0101 errors in `chat-view.keepalive.spec.ts`.
- R9f:
  - M3: no notice for a stale tile key (partly addressed by the session-12 notice);
  - M4: the lane omits `[isStreaming]` and `[ptahUi]`;
  - M6: a workspace switch resets the ChatView dock state;
  - m1-m4;
  - N4: any unhandled Escape inside the lane closes it;
  - correction residuals: the reverse `bg:`->`sub:` migration, a stale opener after a mixed open path, a late
    record pulling focus to Back, and `sub:`->`bg:` remounting the lane;
  - the named Rail display case feeds the dock through `PTAH_UI_DISPLAY_DOCK_SYNC`.
- R9l:
  - stale `canvas-tile` locators in 6 e2e and perf support files;
  - dead `detailTabId`/`laneKey`/`selectLane`/`close` in `canvas-detail.service.ts`;
  - Minors 5-6;
  - dropped e2e guarantees (workspace DOM retention, Gridstack counters);
  - the hunk-revert overlap probe is unproven until e2e runs.
- R9t: Minors 3-5.
- R9s: Minors:
  - the save-path assertion checks the projection;
  - no defensive omit;
  - an unknown `viewMode` passes through.
- R9r: the viewMode reload case passes without a real restore.
- R9m:
  - mcp-bench fixtures name deleted files;
  - the Escape-from-lane-tab case has no exact Rail twin.
- R9k:
  - vacuous selector-absence guards;
  - the observer gates on width only;
  - re-observe and disconnect are not pinned.
- R9h:
  - M3: non-retaining tiles are not tree-cache owners (CPU only);
  - m1: SESSION_CONTEXT strictness reaches the conductor and the detail transcript;
  - m2: `dispose` of a never-retained id;
  - m3: per-instance panel state survives a context switch.
- R9c/b/o/e/n:
  - keyboard activation of `.rc-select` is not tested directly;
  - duplicated "board is full" text;
  - two non-null assertions in `subagent-tile.component.ts:80`;
  - a shared disclosure key for identical no-file turns;
  - a duplicated owner rule;
  - R9n Minors;
  - broken showcase locators;
  - 10 of 13 render metrics have no production writer.

Earlier phases (handoff-6 §6)
- M5: small state-ink text below 4.5:1. Now fixed for anubis and anubis-light; the rest goes to the themes task.
- M2: scroll restore happens once per instance.
- M3: hold latch on a collapsed caret.
- M4: overflow-menu Escape works only inside the menu.
- M7: one transcript and draft restore are proven on stubs plus the Electron s-heap.
- M8: the lane strip reveal re-fires.
- m1-m7 and style Moderates 2-5.
- Escape on the only collapsed button is swallowed (`canvas-rail-keyboard.ts:31-36`).
- `focusRailSelectButton` uses `aria-hidden` as its visibility signal.
- The `+N more` hit area is 16 px.

## Follow-up tasks

- Agent tiles with CLI provider icons in the main view. They show permission requests and user-question
  notifications and close the single-chat permission gap. The lane stats header uses the main MODEL / CONTEXT /
  TOKENS / COST / TIME strip (rows 112, 114, 116). Designer, prototype and Gate 1.7 come first.
- R9 cleanup follow-up (row 108):
  - about 650 lines of dead Grid projection and drag code (`canvas-layout-intent.ts`, store `commitDragIntent`
    and `toggleLayoutFocus`);
  - board `max-lines`;
  - `RAIL_MIN_CONTENT_WIDTH` location;
  - the cap of 4 written twice;
  - repeated 360/400/1440 literals;
  - the hand-rolled header menu.
- Rail state colours and focus frame across all shipped themes (row 124, with the row 123 chip and rail items).
- Rail switch long tasks (row 121).
- TASK_2026_653_2931: sidebar strip, Details resizer, cursor audit.
```

(The orchestrator appends the "Generated with" line.)

## What closes this gap

One test-only batch (no phase review: tests only) plus one visual capture. After that, Mode 3 runs again.

1. **Batch R9-parity-tests:** sequential, one writer, at most 6 spec files across 2 libs.
   - canvas, `canvas-focus-area.component.spec.ts`:
     - row 8: a Compact/Full click calls `toggleTabViewMode(focusedId)`;
     - row 10: the focus slot provides no forced card and the board never writes `viewMode`.
   - canvas, `canvas-rail-card.component.spec.ts`:
     - row 10: the Rail card provides `SESSION_FORCED_CARD`;
     - row 37: no animate classes.
   - canvas, `canvas.store.spec.ts`, row 123: `reorderTiles` persists through a v3 write and hydrates in the
     new order.
   - chat, `canvas-lane-view` (canvas) or `inline-agent-bubble.component.spec.ts`:
     - rows 79, 80, 82 and 85: full-lane cases for agent summary, thinking, an SDK card and a tool error;
     - row 91: the `subagent-command-error` line.
   - e2e, `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:57-58`, row 116:
     - a prefix match `[aria-label^="Focused session"]`;
     - open the lane from `ptah-subagent-tile`, or assert on the tile;
     - not run.

   Verify with `npx nx test canvas --parallel=1` and `npx nx test chat --parallel=1`, one at a time through the
   lock. No production code changes. If a case exposes a real defect, return it as a finding.
2. **visual-reviewer:**
   - the display dock before (dark + light, from the base commit with the Agents tab) and after light;
   - the split pane headers before (dark + light, from `201175e0e`).

   Alternatively, the user can explicitly waive the "before" images that are not captured. Only the user can
   approve that.
3. Optional doc fixes (orchestrator, docs commit):
   - copy rows 117-124 into `parity-inventory-layout.md`;
   - update the summary line in `batches-rail-r9.md:3`.

### Next action: run the R9-parity-tests batch and the visual capture, then run Mode 3 again

The orchestrator does three things:
- runs the test-only batch above with a frontend-developer sub-agent (sequential; canvas then chat tests, scoped,
  through the lock);
- spawns visual-reviewer for the 6 missing screenshots (or asks the user to waive the before images);
- re-invokes team-leader Mode 3 with the batch report and screenshot paths.

Push and PR stay on hold until Mode 3 returns COMPLETE. The PR body above is ready to reuse after its parity
line is updated.

# TASK_2026_702 — Elevate the Chat start screen

## Request (user, 2026-10-19, with a screenshot of the empty Chat board in Electron)

"now i would like you to focus on elevating this initial screen basically i can see like 3
different new session button and the 2 card section in the center is a bit weird and doesn't have
the same styling, what you think we can replace them with, or maybe enhance them in some sense,
also i would really like to include this into the initial page https://ngxui.com/docs/lightfall"

## Orchestrator proposal the user accepted ("Both in parallel")

- **One primary action.** One large "New session" action in the center of the empty board. Hide
  the top-bar "+ New Session" while the board is empty. Keep the sidebar footer "New session"
  (always available) but make it secondary.
- **Lightfall hero.** ngxui Lightfall = an Angular component that renders a volumetric light-beam
  effect with WebGL and custom GLSL shaders (https://ngxui.com/docs/lightfall). Recommended: a
  local Angular component that ports the shader (no new npm dependency), colours from the gold
  theme tokens, paused when hidden, static gradient under `prefers-reduced-motion`, a fallback
  when WebGL is unavailable. **Licence must be checked before any code** (user-reserved if it
  needs attribution or is not permissive).
- **One "Get ready" checklist card** replaces the "Skills Not Configured" warning and the
  "Intelligent Project Setup" card: one `surface-3` card, rows Skills (Open Library), Agents
  (Configure), Project scan (Run setup), each with its own state and action, a progress count
  ("1 of 3 ready"); hidden when all are ready.
- **Recent sessions.** When previous sessions exist, show the last 3 as small cards under the
  action.

## Facts (orchestrator investigation 2026-10-19, verify)

- Page: `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` (dock at :86).
- Three "New session" buttons, all open the same name popover (`openNewSessionPopover()` :584 →
  `handleCreateSession()` :600 → `canvasStore.addTile()`):
  1. Top bar `+ New Session`: orchestra-canvas.component.ts:172-193, shows while
     `canvasStore.canAddTile()`; disabled by the running cap.
  2. Sidebar footer: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:234-246`
     (`onNewSession()` :342), "Previous sessions" :247-261, "No sessions yet" :189-194.
  3. Board empty state: `canvas-rail/canvas-rail-board.component.ts:114-155`
     (`emptyBoardNewSession()` :890, guard `newSessionBlockReason` :369).
- Both centre cards: `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts`
  (warning :36-63 when no plugins enabled; setup card :66-110 with `glass-panel glass-panel-divine`
  from `apps/ptah-extension-webview/src/styles.css:482/:492`, emoji chips,
  `<ptah-setup-status-widget>` from chat-ui). Placed at canvas-rail-board.component.ts:153.
  The same card is also used by `chat-empty-state.component.ts` (single-chat view,
  `chat-view.component.html:120`) — decide whether that screen changes too.
- App card style: `surface-3` (styles.css:385-403).
- "Opening the database" = back-office ticker (orchestra-canvas.component.ts:101-109). "All clear"
  = `canvas-needs-you-queue.component.ts` (belongs to TASK_2026_593, do not redesign here).
- ngxui / lightfall is not used anywhere in the repository.

## Rules

- Full FEATURE flow: PM (task-description + parity-inventory) → cross-side review → designer
  (design-spec + prototype + screenshots dark/light) → cross-side review → **Gate 1.7 by the
  user** → architect → codex lanes → Anthropic code-logic review → Electron visual check.
- Approval mode: lane-review for Gates 1 and 2, **user** for Gate 1.7.
- Lanes: codex first (confirmed room). grok AT LIMIT until 2026-10-20 17:40 UTC.
- Memory-safe checks only (CLAUDE.md). `no-alpha-base-content.spec.ts` for every template
  change; never `text-base-content/NN`. Degradation audit must not rise.
- Electron visual checks: announce to peers first; use a free port and private APPDATA.

Worktree: `.claude-worktrees/chat-start-screen`, branch `feat/chat-start-screen` (from origin/main
eed1fac30). Orchestrator session: `ptah-ptah-extension-task-612-follow-up-s-e16b410000xs42qjcizfr0i`.

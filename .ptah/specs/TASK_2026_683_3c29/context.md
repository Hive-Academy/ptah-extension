# TASK_2026_683_3c29 — smooth navigation and session-switch motion

## User request (2026-10-16, verbatim intent)
"Animations, specially when navigating between pages and sessions that have live chat — critical and very
important to have right. Currently routing and session switching feel very subtle and hurt the eye. We need
small smooth animations, in native Angular, and support staggering intuitively." User chose: new task, start
now; analysis and measurement first, plan approved by the user before code.

## Prior art (do not duplicate)
- TASK_2026_629_c0b3 decisions row 74 (user, 2026-10-13): smooth, light session switching; measure 10 focus
  swaps first (render metrics + CDP trace); candidates: one reused ChatView, frozen-snapshot transcript LRU,
  `content-visibility` / deferred markdown, ~150-200 ms opacity/transform cross-fade respecting
  `prefers-reduced-motion`. Acceptance: no long task > 50 ms per switch, no rail shift, F5 passes, heap 0 detached.
- TASK_2026_677_efcd CV-2.1: chat-view session-switch stagger (`.is-entering .st-f`, `ptahStaggerUp` 260 ms,
  reduced-motion block) — `libs/frontend/chat/src/lib/components/templates/chat-view.component.css:200-240`,
  keyed on `resolvedTabId`.
- Native `animate.enter` / `animate.leave` already used: transcript (`chat-transcript.component.html:157-177`,
  css :85), banners (`chat-view.component.html:132`), execution nodes (gated by `isFinalizing()`).
- Router: `apps/ptah-extension-webview/src/app/app.config.ts:179` `provideRouter(appRoutes,
  withComponentInputBinding(), withDisabledInitialNavigation())` — no `withViewTransitions()`; shells:
  `electron-shell.component.ts` (Electron), `app-shell.component.html` (VS Code webview).
- TASK_2026_468_a0e4 context:32 — jsdom does not expose the transient `animate.enter` class; try Angular
  animation test helpers first.

## Direction proposed to the user (to be confirmed by the plan)
1. Pages: router `withViewTransitions()` (View Transitions API; Chromium in Electron and VS Code webviews),
   ~150-200 ms fade/slide via `::view-transition-*`, nav chrome excluded (stable `view-transition-name`).
2. Session switch: transcript pane cross-fade + first visible items staggered with `animate.enter` and a CSS
   delay index (`[style.--i]`, cap ~6); late / streaming items never re-animate on resync.
3. `prefers-reduced-motion` disables motion; measured before/after; no long task > 50 ms per switch.

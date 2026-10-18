# Code Logic Review O22 (pane motion) - TASK_2026_683

Review family: Claude reviewer, codex implementer.

Score: 8/10. Verdict: APPROVED (no blocking or serious findings; 3 minor).

## Scope examined
Uncommitted diff vs 312b54f36: chat-transcript.component.{css,html,ts}, webview styles.css, both session-enter specs, nav-session-motion.perf.spec.ts, plus chat-view.component.ts:1193-1215 (entering edge) and its html binding (:104-106). Orchestrator ran test/typecheck/lint for chat (PASS); I ran nothing further.

## Focus answers

1. Restart cases. Class binding is `entering() && workActive()` (transcript html:3). `entering` is true only for `tabId === enteringTabId()`, which ChatView sets only on a resolvedTabId edge (chat-view.component.ts:1198-1205); view-mode and first-session-id changes do not touch it. A streamed message changes neither input, so the class stays and the CSS animation is not restarted; the same scroller element is kept (no @if around it; spec "keeps the same pane entrance" asserts element identity and class). The class is removed at 400ms, after the 260ms animation ends, so removal is invisible. A -> B -> A within 400ms replays A, which is a real switch and intended; B's class is removed (its animation is cancelled, but B is hidden by then). Late-add case: if workActive turns true mid-window without a tab edge (e.g. SURFACE_ACTIVE flips), the animation would start mid-window; unlikely and harmless.
2. Animated element is the scroller (.chat-scroll-container, html:2). Transform on it is transient (backwards fill only, no persistent transform after 260ms, so no lasting containing block). scrollTop, sticky and scroll anchoring are unaffected by an ancestor-of-content transform on the scroller itself (they move together). No position:fixed/sticky found in the transcript templates/CSS (grep). Opacity<1 creates a stacking context only during the animation. B4 first-frame restore is untouched (restoreScrollOnActivation calls kept). Residual: getBoundingClientRect-based measurements taken in the first 260ms see up to 12px offset, but root and content shift together so relative geometry is unchanged.
3. Reduced motion: `@media (prefers-reduced-motion: reduce) { .ptah-pane-switch-enter { animation: none !important } }` (css:9-13) is correct, and a spec asserts it via regex on the CSS. `--ptah-motion-switch: 260ms` defined in apps/ptah-extension-webview/src/styles.css:45 on the same :root block as the other motion tokens; that stylesheet is the one app bundle shared by the VS Code webview and Electron, so both hosts get it. Keyframes are component-scoped; the perf probe handles the `_ptahPaneSwitchEnter` mangled name.
4. Perf spec: probe matcher updated consistently (name, selector, visibleInScroller now accepts el === scroller). Reduced-motion gate keeps its intent (zero CSSAnimation of the new name on chat-scroll-container). Entrance gate: `every visibleAtStart` and `firstVisibleDelayMs === 0` kept; the `firstVisibleIndex === 0` check is replaced by `animated.length === 1`. That is an equivalent-or-stronger gate for the new design (exactly one pane animation) but note `entranceIndex`/`firstVisibleIndex` are now always null in the report, and the `S2 entrance exists` check still guards against zero animations. Not weakened.
5. Leftover references: no `data-enter-i`, `ptahTurnEnter`, `TranscriptSessionEntrance` in source; only two negative assertions in chat-transcript.session-enter.spec.ts:89,102 (intended). Stale regex alternative `transcript-session-entrance` in perf spec:373 (harmless).

## Findings

Minor
- M1 apps/ptah-electron-e2e/.../nav-session-motion.perf.spec.ts:373: regex still lists removed `transcript-session-entrance` / `transcript-entrance`; harmless, cosmetic.
- M2 libs/frontend/chat/.../chat-view.component.css:199-210: `.is-entering .st-r` rule has no users anywhere (grep), so it is dead code; the `is-entering` host class itself is kept as requested.
- M3 chat-transcript.session-enter.spec.ts does not test the "late workActive flips true mid-window" case, nor does any spec assert the 260ms/12px values (only the reduced-motion CSS regex); a CSS regression to timing/distance would pass. Optional: assert `--ptah-motion-switch` and translateY(12px) in the CSS text.

Other note: the first tab id after mount (null -> X) is a tab edge and so arms the window at app start (pre-existing ChatView behaviour, chat-view.component.ts:1198); the pane will fade-in once on initial load. Confirm this is wanted; the user's "first session id never replays" is satisfied for same-tab session-id changes only.

## Verdict
APPROVED, 8/10, confidence MEDIUM-HIGH (no e2e run; fixed-position and timing behaviour inferred from code and grep).

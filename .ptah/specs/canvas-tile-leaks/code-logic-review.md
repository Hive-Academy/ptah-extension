# Code Logic Review — canvas-tile-leaks

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7.5/10 |
| Assessment | APPROVED (non-blocking notes) |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 4 |
| Failure modes found | 4 |

Scope: all non-spec diffs read in full, plus tab-manager close emitters, SURFACE_ACTIVE consumers, BatchedUpdateService, app-shell surface directive, and the new specs (canvas-tile, stream-router, tree-builder).

## Five logic questions

1. Silent failure: no new swallowed errors. Cache clears are idempotent deletes. A premature clear only costs a rebuild; it cannot lose store data.
2. User action: navigating to settings and back, or toggling grid/single, pauses tile rendering. On return, ExecutionNode (execution-node.component.ts:386-411) and SurfaceMarkdownPipe re-render the latest content; the new tile spec asserts this ("catches up").
3. Wrong-answer input: two tabs on one session. Handled by `sessionShownByOtherTab` (stream-router.service.ts:984-988).
4. Dependency failure: `handleTabClosed` keeps its try/catch. The new agent-id effect has no failure path.
5. Missing: pop-out `forceClose` and the history-replay race (see failure modes).

## Verification of focus items

- BatchedUpdateService is a root service and injects the root SURFACE_ACTIVE (batched-update.service.ts:42). The tile provider only exists in the child EnvironmentInjector (canvas-tile.component.ts:595-598), so ingest and flush behaviour are unchanged. Stores are not gated.
- Previously, tile content inherited the root value, which is "chat route addressed" and ignores layout mode (app.config.ts:139, surface-active.directive.ts:26-30). Now it is canvas-element-active AND `visible()`. Not a regression: the tile is under `ptahSurfaceActive="canvas"` (app-shell.component.html:730), and the injection happens in the tile's own element chain.
- ChatTranscript `workActive = active() && surfaceActive()` (chat-transcript.component.ts:198-200) already honoured `visible` via `active`. The new input only adds the canvas-inactive case, and pin/scroll catch-up is keyed on the false-to-true transition (:603-614).
- Close effect: `untracked` wraps only `handleTabClosed`; `closedTab()` is still tracked, so it fires once per emission. The "does not re-run" spec covers the later-tab-change case (stream-router.service.spec.ts, new test).
- A1 effect: `storeAgentIds` uses `equal: sameMembers` (agent-monitor-tree-builder.service.ts:42-46, 111-114), so output deltas that replace the list with the same ids do not re-run it. No loop: the effect only mutates plain Maps. An agent evicted and re-added within one flush never appears to leave. A later re-add rebuilds from an empty cache. Correct.
- Running agents are never evicted (`status !== 'running'` filter, agent-monitor.store.ts:1238). The eviction only runs on exit. `AgentStatus` has no 'interrupted' value, so the old doc comment was stale and the change is sound. Session close does clear running agents of that session by design (pre-existing); the new `_subagents` prune extends that to their records.
- `clearForClosedTab` is close/reset only. `reset` keeps the tab but the tile re-derives from empty state, so clearing `tile-` is safe.

## Failure modes (all non-blocking)

### Lost close events
- Trigger: two tabs closed in the same tick. `_closedTab` is a single signal, so the effect sees only the last one.
- Evidence: stream-router.service.ts:79-85 (pre-existing); this change increases the cost because more caches are now released only through this path.
- Recommendation: queue events, or have the close path call a sync hook.

### Pop-out leak
- Trigger: `forceClose`. `handleTabClosed` does not release the tab-/tile-/history-page memos.
- Evidence: stream-router.service.ts:961-965 only handles close/reset; tab-manager.service.ts:1064.
- Recommendation: release the tab-keyed memos for forceClose too (they are tab-local; the session-keyed ones may stay).

### History replay racing close
- Trigger: an in-flight older-page replay finishes after close and re-inserts `history-page-${tabId}` (session-history-replayer.service.ts:255). Small, permanent leak.
- Recommendation: guard the replayer on tab existence.

### Missing timestamp on eviction
- Trigger: evicting terminal agents sorts by `completedAt ?? 0` (agent-monitor.store.ts:1244). `onAgentExited` always sets it, so this is safe today. A timeout/stopped agent arriving through another path without `completedAt` would be evicted first.

## Moderate and minor
- `forceClearSessionAgents` deletes from `_subagentRequestUsage` / `_pendingBackgroundIdentity` inside the `_subagents.update` callback (agent-monitor.store.ts:1565-1572). This is a side effect in an updater and the first delete is redundant with the later loop. Harmless, but impure.
- The new tile spec swaps in a SurfaceProbe for ChatViewComponent. It does exercise the real provider, the real `childInjector` and the real pipe, so it is a genuine behavioural test. There is no test that the session-sharing skip also covers `reset`.
- The tree-builder spec uses the real AgentMonitorStore (good). The first describe uses a stub store with a never-changing map, so it only proves wiring.

## Verdict
- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (specs not executed by me)
- Top risk: single-slot `closedTab` signal drops back-to-back closes, leaving caches that this change is meant to free.
- Robust additions: queue close events; release tab memos on forceClose; guard replayer post-close.


## Round 2 — lane changes

Scope: lane A (onTabClosed + consumers + replayer guard), lane B (chat-input field-sizing, rAF pin measurement, effort-selector), lane C (markdown wrapper, tile `contain: style`, agent-card-output keys + content-visibility). Whole changed files and call paths read; no test/build evidence exists (lane reports state test and lint runs never returned counts; diagnostics unavailable). Static review only.

Verdict: **REVISE** (no data-loss blocker; one security-adjacent item should be fixed or justified first). Score 6/10.

### Lane A — onTabClosed

OK: each consumer subscribes once and tears down (StreamRouter and ender via DestroyRef; canvas via ngOnDestroy). Tab is removed from `_tabs` before emit in close/forceClose, so consumers see post-removal state. Set iteration tolerates unsubscribe during dispatch. Ordering vs legacy signal: `_closedTab.set` precedes listeners. The replayer guard (`session-history-replayer.service.ts:279`) sits after the last await and before build; `finally` clears the cache. Correct.

Serious
1. `tab-manager.service.ts:~287` `emitTabClosed` has no per-listener isolation. A throwing listener (canvas `removeTileFromAnyWorkspace`, `orchestra-canvas.component.ts:469`, has no try/catch) aborts remaining listeners AND the rest of `closeTab`/`forceCloseTab`: active-tab switch (`_activeTabId` left pointing at a removed tab) and `saveTabState()` are skipped. The old effect path isolated these. Wrap each call in try/catch (warn) or emit after the active-tab switch and save.
2. Re-entrancy is untested and unordered: a listener that closes another tab runs a nested full close (including nested emit and active-tab switch) before the outer close finishes its own `_activeTabId` switch, which uses a stale `tabIndex`. No spec covers it.

Moderate
3. `transcript-retention.service.ts:83` still consumes the legacy coalescing `closedTab()` effect. Two closes in one tick drop the first `dispose()` (retained id and tree memo leak until the `disposeUnresolvable` backstop). Migrate to `onTabClosed` or document.
4. `stream-router.service.ts:~965` forceClose with a shared session skips `clearForClosedTab(tabId)` and `clearPendingUpdates(tabId)`. Both are keyed by the closed tab id (`execution-tree-builder.service.ts:793`, batched-update `:303`), so the guard is unneeded there and leaks the closed tab's `tab-`/`tile-`/`history-page-` caches in exactly the pop-out-with-open-tile case. Only the session-keyed teardown needs the guard.
5. `closed-tab-session-ender.service.ts` comment claims independence from consumer order; it is not. `isStillDisplayed` relies on StreamRouter having already unbound the closed tab. If the ender subscribes first, the surface count is still >0 and `chat:abort` is silently skipped. Root StreamRouter normally subscribes first (ender is shell-provided), so it works by accident; fix by excluding the closed tab id in the check.
6. No TabManager spec for `onTabClosed` itself (unsubscribe, reset event, throw, re-entrancy).

### Lane B

OK: chat-input send/reset, restore and insertion now rely on the `[value]` binding plus `field-sizing`; no remaining `style.height` writers in this component. Paste/history recall go through `_currentMessage`/`[value]`, which sizes automatically. Pin ordering: scroll events fire before rAF in the same frame, and the ResizeObserver runs after rAF, so a user scroll-up is applied before the next observer-driven snap. rAF is cancelled on destroy in both places.

Moderate
7. `field-sizing: content` needs Chromium 123+. VS Code builds on Electron <=29 (Chrome 122) lose auto-grow entirely: fixed 2-row box with an inner scrollbar, with no fallback. Gate or document the minimum.
8. `agent-monitor-panel.component.ts:1146` `applyAgentSelection` sets `pinnedToBottom = true`, but a rAF queued by a scroll just before the switch then measures the old geometry and can set it false. Narrow (under one frame); cancel the pending frame when selecting.

Minor: effort-selector `transition-colors` fine.

### Lane C

Serious
9. `provide-markdown-rendering.ts:223` re-parses already-sanitized HTML into a `<template>` and re-serializes it. This breaks the stated invariant that the wrapper step sits outside content control. A parse/serialize round trip in template insertion mode (which differs from body for table/select-family tags) is the classic mutation-XSS surface, and `pre.style.*` CSSOM writes re-serialize the sanitizer-vetted `style` attribute. No concrete exploit shown, and `contain: layout paint` stays, but this is unreviewed security surface. Do the pre/table wrapping inside the DOMPurify pass (hook or `RETURN_DOM`) or via CSS, and add hostile-input specs (nested tables, stray `td`, `noscript`). Nested tables also get double scrollers.
10. `agent-card-output.component.ts:~352` `keyedSegments` hashes every segment's full content on each `segments()` change, which is every stream chunk: O(total output) string joins per tick, replacing a free `track $index`. That is a perf regression in a perf PR for long outputs. Hash only non-tail segments with memoization (WeakMap on segment object), or key by index plus type.

Moderate
11. Key semantics: no NG0955 risk (the `#occurrence` suffix and the single `tail:` key are unique; a FNV collision only affects DOM reuse, since bindings still update). But when a segment is appended, the old tail changes from `tail:text` to a content key, so its node is destroyed and re-created while the new tail inherits the old node. That is one extra markdown render per appended segment, so reuse is weaker than the report claims. Front-trim shifts occurrence numbers, and equal content makes that benign.
12. `agent-card-output.component.ts:84` `first:mt-0` on headings: each heading is now the first child of its own wrapper div, so every heading loses its top margin (visual regression). Move the margin to the wrapper or use an index check.
13. `content-visibility: auto` applies paint containment permanently: it clips child overflow (tooltips, focus rings, shadows). The scroll effect (`:~381`) sets `scrollTop = scrollHeight` once in a rAF. With 80px estimates for never-rendered segments, the true height appears after the snap and nothing re-snaps, so the view can land short of the bottom on a long initial load. Needs browser verification.
14. `contain: style` on `.tile-content` (`canvas-tile.component.ts`) only scopes counters/quotes; it does not bound style recalculation. It is harmless but gives no benefit, so the justification comment overclaims.

### Specs

Lane C's revised spec uses fresh objects, a front-trim and duplicates (models reparse). Mock TabManagers were patched with `onTabClosed`. Gaps: no markdown hostile-input spec for the new re-parse path, no emit-throw or re-entrancy spec, no scroll-pin rAF-vs-selection spec. None of the lane test runs has a recorded pass count, so green is unproven.

### Blocking vs non-blocking
Blocking: none strictly. Fix before merge: #1 and #9 (one-line try/catch; sanitizer ordering). Non-blocking: #2-8, #10-14.


## Round 3 — final verification

Verdict: **REVISE (one small CSS fix), otherwise all Round 2 items resolved.** Score 8/10. Static review of `git diff origin/main` plus the orchestrator's Jest counts; I ran no tests.

| # | Item | Status |
|---|------|--------|
| 1 | `emitTabClosed` isolation (`tab-manager.service.ts` ~L285) | RESOLVED. Per-listener try/catch + warn, snapshot via `Array.from`. close/forceClose now remove the tab BEFORE emitting, so the active-tab switch and `saveTabState` always run. `reset` emits after the state update and saves after. |
| 2 | Re-entrancy | RESOLVED for the listener list (snapshot). A nested close inside a listener still runs before the outer active-tab switch, which reads live `_tabs()`; stale `tabIndex` only picks a different neighbour. Cosmetic. Spec added. |
| 3 | transcript-retention | RESOLVED (`onTabClosed` + DestroyRef, `reset` skipped). |
| 4 | stream-router pop-out | RESOLVED. `clearForClosedTab` (clears `tab-`, `tile-`, `history-page-`) and `clearPendingUpdates` are keyed by tab id and run for close/reset/forceClose; only agents / background / session memo are guarded by `sessionShownByOtherTab`. |
| 5 | ender order independence | RESOLVED. The closed tab id is excluded via `findTabsBySessionId`. |
| 6 | markdown | PARTIAL. No re-parse; the wrapper is `contain: layout paint` only. See D1. |
| 7 | agent-card-output | RESOLVED. The wrapper and content-visibility are gone; the template differs from main only in `@for`/`@let`. The key is cheap (type, length, 48-char prefix, toolCallId) + occurrence, with a single `tail:type` key. A stray blank line was added in `styles` (cosmetic). |
| 8 | canvas-tile | RESOLVED. `contain: style` is gone; SURFACE_ACTIVE intact (`canvas-tile.component.ts` L476-495, 598). |
| 9 | Backticks in templates | CLEAN. I grepped the added lines; every backtick is in TS code or spec strings. No stray backticks in inline templates in the diff. |

### New defect D1 (Moderate, visual regression): the confirmed concern is real
`apps/ptah-extension-webview/src/styles.css:956-961`. `overflow-x` does nothing on `display: table`. In addition, `.prose table { overflow: hidden; width: 100% }` (L1087, same specificity, later in the file) overrides the new rule for prose tables. A table that cannot wrap, wider than the pane, is now clipped by the wrapper's paint containment and cannot be scrolled. The old wrapper scrolled it. `pre` is fine (block, own `overflow-x`, and `.prose pre` already sets it).

Least-visual-change fix: put the scroller on the root, which is a single element and restores the old behaviour without the isolation/z-index cost: `.ptah-markdown-root { overflow-x: auto; }`. Do not change table display. Drop the table selector from the new rule.
The GitHub-style `display:block; width:max-content; ...` alternative is worse here. It overrides `.prose table`'s `width:100%` and `border-radius`/`overflow:hidden` header styling, and narrow tables stop stretching, which changes every table.
Adding `overflow-x: auto` to the inline wrapper style is equivalent, but the CSS rule is acceptable since the stylesheet is already required.

### styles.css delivery
Both hosts consume the same `ptah-extension-webview` build, whose `project.json:29` lists `styles.css`. VS Code copies it via `copy-webview.js` (`ptah-extension-vscode/project.json:90-99`). Electron depends on `ptah-extension-webview:build` (`ptah-electron/project.json:278,320`). Shipped to both: CONFIRMED. The markdown library's own inline `contain` still holds in any app that lacks the stylesheet, but the wide-content scroll now exists only in this stylesheet.

### Recommendation
Apply D1 (one CSS line) and APPROVE. Non-blocking residue from Round 2: #7 (field-sizing needs Chromium 123+), #8, #11, #13.

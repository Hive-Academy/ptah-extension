# H1 host review — TASK_2026_524_1125

Verdict: REVISE (3 real defects, 3 minor). Read-only; no tests, lint or typecheck run (prettier --check only).

## Defects

1. angular-webview.provider.ts:135-151 and 188-236 — `deserializeWebviewPanel` has no error handling, and `adoptPanel` registers state before the step that can throw.
   - Order: `_panels.set` (189), `registerWebviewView` (190), queue (195) and message listener (197) all run before `generateAngularWebviewContent` (216), and `panel.onDidDispose` (226) is attached last.
   - Failing scenario: `generateAngularWebviewContent` throws (missing `webview/browser` build, bad `buildWorkspaceInfo`). VS Code gets a rejected revive and shows a blank panel with no HTML.
   - The panel ID stays in `_panels`, `WebviewManager`, `_panelEventQueues` and the listener disposables forever, because dispose cleanup was never attached. `panelCount` then lies.
   - The spec says errors must not be swallowed and must leave a usable panel. Nothing here logs through Logger, sets fallback HTML, or rolls back.
   - Fix: attach `onDidDispose` first, or wrap in try/catch that logs, cleans up and sets minimal HTML. Add a spec for a throwing generator.

2. angular-webview.provider.spec.ts:131-150 — the "collision" case is not tested.
   - The only repeat of `savedId` is index 2 (`state('/chat/a', savedId, 2)`), which is already rejected by the version check (parse fails) before the collision check runs.
   - Index 0 is the only valid state with `savedId`, and nothing else holds it.
   - Deleting `!this._panels.has(restoredId)` at provider.ts:144 leaves every spec green. The report's "collision ... allocate distinct IDs" claim (h1-report.md:24) is unproven.
   - Fix: restore two valid states with the same `savedId` and assert the second ID differs.

3. angular-webview.provider.ts:211 — `broadcastWorkspaceChanged()` was added to the shared panel `onReady`, which also changes `createPanel` behaviour.
   - Before this diff, fresh panels did not broadcast on ready.
   - Now every panel-ready posts `workspaceChanged` to the sidebar and ALL open panels. N restored panels produce N broadcasts to each of N panels at startup.
   - The report says "identical wiring to createPanel", but it altered createPanel. The plan's "broadcast" bullet is ambiguous, so confirm intent. If it is intended, add a spec asserting that a fresh panel's ready broadcasts too. The spec at lines 116-119 only checks the restored panel.

## Minor

4. angular-webview.provider.ts:235 has a stray blank line before `}` and fails `prettier --check`. The new specs also have lines over 80 columns, e.g. spec:31, 36, 57. Expect a format-gate failure.
5. angular-webview.provider.spec.ts:108 compares `webview.options` for created vs restored panels, but the mock `createWebviewPanel` ignores its options argument. The assertion only proves `adoptPanel` writes the same options, which is true by construction. Restored panels cannot get `retainContextWhenHidden` through `adoptPanel` (readonly). The report notes this, but the plan wanted identical behaviour, so keep it flagged for the manual smoke test.
6. ptah-extension.spec.ts:11-37 asserts registration during `initialize()` and disposal. It cannot show ordering against awaits. In `post-init.ts:33`, `initialize()` runs only after `bootstrapVscode` and `wireRuntimeVscode` have been awaited in `main.ts:59-62`. That is inherent to activation and VS Code awaits `activate()` before reviving, so it is acceptable. Do not claim more than "inside activate".

## Checked and OK

- Reuse rule (provider.ts:139-146): parse success, regex, and `!_panels.has`, otherwise `allocatePanelId`. `allocatePanelId` also loops on collision. Matches the plan.
- No route-derived `initialView` (provider.ts:223 only forwards an explicit option). State is only read, never written (spec:82).
- `onWebviewPanel:ptah-angular-spa` is in package.json:38. The serializer is registered in `registerWebviews` (ptah-extension.ts:131-136) and its disposable is pushed to `this.disposables`, disposed at 224. No serializer for `ptah.setupWizard`.
- No double registration: `createPanel` and `deserializeWebviewPanel` each call `adoptPanel` once. Logger is used, no console.
- Panel dispose cleanup is the same for both paths. The `WebviewManager` entry is removed by its own panel-dispose handling (webview-manager.ts:171). I did not trace that further.
- `reloadWebview` (provider.ts:~363) uses `_panels` so it covers restored panels.

## Notes

- A restored panel with an invalid or absent ID gets a new UUID, so TabManager keys change and its chat tab is lost. This is accepted by the plan.
- Defect 1 is the only blocker for a "robust" revive. Defects 2 and 3 are test and claim accuracy.

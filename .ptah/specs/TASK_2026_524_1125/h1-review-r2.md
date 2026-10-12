# H1 host review, round 2 (TASK_2026_524_1125)

Verdict: APPROVE. No blocking or serious defects found. Read-only; no tests, lint or typecheck run. `prettier --check` passes on the provider, both specs and `ptah-extension.ts`.

## Round-1 defects

1. Failure safety, rollback, logging: Resolved.
   - `angular-webview.provider.ts:204-257`: `adoptPanel` attaches `onDidDispose(cleanup)` first and generates the HTML before touching any map. State is set only after the HTML succeeds, and the `catch` runs `cleanup()` and rethrows.
   - `provider.ts:140-163`: `deserializeWebviewPanel` wraps the whole body, logs through `logger.error('Failed to restore editor panel', Error)` and calls `panel.dispose()`.
   - `provider.ts:129-137`: `createPanel` disposes the panel and rethrows. Its commands already catch and log (`ptah-extension.ts:145-166`).
   - Specs `provider.spec.ts:231-272` cover a throwing HTML generator and a throwing listener setup. Both assert the log call, panel dispose, `panelCount` 0, queue disposed once, and the manager entry removed.
2. Real collision spec: Resolved. `provider.spec.ts:208-209` restores two fully valid states with the same `savedId`, and line 222 requires the second ID to differ. Removing `!this._panels.has` at `provider.ts:150` would fail it.
3. `createPanel` ready behaviour: Resolved. `provider.ts:241-248` only marks ready and flushes, with no broadcast added. The spec at line 191 asserts `postMessage` is not called on ready.
4. Minors: Resolved.
   - Formatting: prettier passes and the stray blank line is gone.
   - Options: `provider.spec.ts:58-85,161-175` captures the options actually passed to `createWebviewPanel`, so the earlier vacuous comparison is fixed. The retain flag is asserted only on the creation call (line 164).

## Checks requested

- Double dispose: no.
  - `cleanup` is guarded by the `disposed` flag (`provider.ts:211-212`). The rollback's `cleanup()` and the later `panel.dispose()` firing `onDidDispose` run it once.
  - The spec's panel mock fires every `onDidDispose` callback on dispose (`provider.spec.ts:21-23`), and the queue dispose count is asserted to be exactly 1.
- Leak: no.
  - `_panels.delete` is guarded by `get(panelId) === panel` (line 214). `_panelEventQueues.delete(panelId)` is unguarded, but the ID is unique, since it is either freshly allocated or checked as not live, so no other panel's entry can be removed.
  - The manager entry is removed by the manager's own `onDidDispose` hook (`webview-manager.ts:171`), which `panel.dispose()` triggers. The spec models this with `liveManagerIds`.
- Blank panel on failure: the revived panel is disposed, not left blank. The user loses the tab but sees no empty shell, and the failure is logged. See note N1.
- Ready flush on restored panels: preserved. `onReady` at `provider.ts:241-248` calls `markReady()` and `flush()` through the per-panel queue. `provider.spec.ts:188-190` asserts one flush for the restored panel.

## New defects

None blocking.

## Notes (optional, non-blocking)

- N1 (Moderate, design choice): `provider.ts:158-162` closes a panel that fails to restore instead of showing fallback HTML. This is safe, but the user silently loses that editor tab after a restart. They do see VS Code's panel disappear. If fallback is wanted, set a minimal error HTML (itself wrapped) rather than disposing.
- N2 (Minor): a revived panel already disposed before `deserialize` runs would make `panel.onDidDispose` at `provider.ts:224` throw outside the inner `try`. It is caught by the outer `try`, which then calls `panel.dispose()` on an already-disposed panel. This is harmless in VS Code and extremely unlikely.
- N3: `ptah-extension.spec.ts` proves registration and disposal only. Ordering against activation awaits is inherent to the activation flow.

# TASK_2026_329 — Clamp diag:cpu-profile duration; spec the with-engine guard

Source: regression review of TASK_2026_323 (Phase 1 diagnostics) and the uncommitted
`with-engine.ts` change.

## Findings to fix

1. **`diag:cpu-profile` accepts an unbounded `durationMs`.**
   `apps/ptah-electron/src/ipc/ipc-bridge.ts:561-570` forwards the renderer value to
   `CpuProfileCapture.captureFor` (`libs/backend/vscode-core/src/diagnostics/cpu-profile-capture.ts:102-113,153-182`).
   Required: clamp in the IPC handler to `Math.min(Math.max(durationMs, 1000), 60_000)`
   and treat a non-number as the default. Add the clamp constant next to the handler.
   Spec: `apps/ptah-electron/src/ipc/ipc-bridge.*.spec.ts` — a value of `10_000_000`
   reaches `captureFor` as `60_000`; `'abc'` reaches it as the default.

2. **`with-engine.ts` guard move has no spec.**
   `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:464-481` (uncommitted;
   keep the change as is). `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts`
   `FakeContainer` (lines 57-76) always provides `isRegistered`.
   Required: add a test that builds a container WITHOUT `isRegistered`, makes SDK
   `initialize()` return false, and asserts `withEngine` rejects with
   `SdkInitFailedError` (ptahCode `sdk_init_failed`), not a `TypeError`.

## Constraints

- Two files of production code at most. Do not refactor anything else.
- `catch (error: unknown)`.

## Verify

```bash
npx nx run-many -t test -p ptah-electron @ptah-extension/cli-engine
npx nx run-many -t typecheck -p ptah-electron @ptah-extension/cli-engine
```

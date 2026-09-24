# Backend implementation - TASK_2026_538, Batch 8

Tasks 8.1-8.4 implemented. Typecheck and tests passed on the single requested combined run. A lint failure introduced by inline type imports in the appended spec was corrected; the project-only lint recheck passed with 0 errors and 44 warnings. No git command was run.

## Task 8.1 - Harden and widen delivery

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.ts`
  - Lines 73-76 export `DashboardPushType` for the v1 and v2 message constants.
  - Lines 84-88 tie the generic host message type to `MessagePayloadMap[T]`; lines 120-127 give the broadcast factory the same generic contract. The existing v1 `DashboardBroadcast` callback and namespace remain unchanged.
  - Lines 129-150 catch host lookup and enumeration errors and return `failed`, with zero sends and the error text. Lookup is also guarded to satisfy the push helper's non-throwing contract.
  - Lines 155-164 defer each send through `Promise.resolve().then(...).then(ok => ok === true, () => false)`. Throws and rejections count as failed delivery while every enumerated surface is attempted. Existing status shapes, counts, failure text and v1 namespace text are preserved.
- MODIFIED (append only) `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.spec.ts`
  - The new describe block starts at line 568. Seven cases cover synchronous throws and rejected sends without unhandled rejections; partial delivery with all surfaces attempted; Error and string enumeration failures; two back-to-back revision pushes in call order; and the v2 payload reaching the host.
  - The original 19,180 bytes remain byte-for-byte identical. SHA-256 before editing and of the final original prefix: `49680BBC75349D608EE2BBC44D7534F859CF170A65F2F79CC6E73B83C1997492`.

## Task 8.2 - Lib-local DI tokens

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\di\tokens.ts`
  - Exports the documented const object with `SURFACE_STATE_SERVICE: Symbol.for('SurfaceStateService')` and `SURFACE_PUSH_HOST: Symbol.for('SurfacePushHost')`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\di\index.ts`
  - Line 5 explicitly exports the token object. Registration remains owned by Batch 10; `register.ts` was not edited.

## Task 8.3 - Surface push helper

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-push.ts`
  - Lines 9-11 export `SurfacePushHostProvider`; lines 17-26 export `pushSurfaceChange(provider, logger, payload)` returning `Promise<DashboardDeliveryOutcome>`.
  - Every invocation resolves the host through `() => provider.getHost()` and sends `MESSAGE_TYPES.SURFACE_UPDATED` through the hardened broadcast. It takes an already committed, typed payload and has no state mutation or rollback dependency.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-push.spec.ts`
  - Five tests cover no host, one delivered host with unchanged payload, late registration and host replacement across three pushes, a throwing send with unchanged committed payload, and a throwing provider.
  - No `surface/index.ts` was created.

## Task 8.4 - Public barrel

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\index.ts`
  - Lines 86-93 export `createDashboardBroadcast`, type `DashboardSurfaceHost`, type `DashboardPushType`, `VSCODE_LM_TOOLS_TOKENS`, and type `SurfacePushHostProvider`.
  - `wc -l` equivalent (counting newline characters with PowerShell): **93 lines**, below the 150-line limit.

## Risks and conventions

- **R4:** The push helper is implemented after, and calls, the widened and hardened broadcast. Tests cover thrown/rejected sends and mixed results without losing successful delivery counts.
- **R7:** The public barrel now exposes the delivery function and host/push types needed by later adapter-through-broadcast specs. Adapter integration specs remain Batch 14's responsibility.
- **R11:** The new test at dashboard spec line 666 invokes revision 2 and revision 3 pushes without awaiting either. It asserts that no sends happen synchronously and that both sidebar/panel sends for revision 2 precede the corresponding revision 3 sends.
- **R8 import rule:** `MessagePayloadMap` and `SurfaceUpdatedPayload` come from the shared public alias; existing v1 values remain on `@ptah-extension/shared/mcp-apps-contracts`. This batch needs no v2 runtime values and adds no deep shared import.
- No `any`, suppression, dependency, registration, frontend change, or compatibility shim was added. No task state or batch document was edited.

## Stack observed

- Root `package.json` and `package-lock.json`: Node 24.x, TypeScript 6.0.3, tsyringe ^4.10.0, Zod 4.6.5, Jest ^30.0.2. This is a host backend library, not a Nest HTTP feature; no new framework API is used.
- `libs/backend/vscode-lm-tools/package.json` and `project.json`: existing shared/platform-core/vscode-core dependencies; extension/feature tags; explicit typecheck, Jest test and ESLint targets.
- `libs/backend/vscode-lm-tools/tsconfig.json`: strict TypeScript. `jest.config.ts`: Node test environment with ts-jest.
- Wiring follows `src/lib/di/register.ts:83-103`'s lazy-provider precedent and `diagnostics-cache-invalidator.service.ts:67`'s symbol token precedent. `CONVENTIONS.md` sections 3-4 require named exports, barrels of at most 150 lines and registry-backed DI tokens.
- Validation stays in the existing dashboard boundary (`validateDashboardSpec` in `dashboard-namespace.builder.ts`). The new helper accepts a committed `SurfaceUpdatedPayload`; it does not introduce an untrusted-input boundary. The host contract is structural and preserves the existing logger shape. No secrets/configuration are involved.
- Imports follow the shared/extension and feature boundaries declared in root `eslint.config.mjs` and inherited by this library's ESLint configuration.

## Verification

1. Ran the requested combined target command exactly once, scoped to this project:

   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`

   Output was sanitized for U+2028/U+2029, retained in a temporary log, and filtered to summary lines. Nx reported typecheck and test successful. Lint failed with 22 errors because Nx interpreted two appended inline `import('@ptah-extension/shared').SurfaceUpdatedPayload` type annotations as lazy-loading edges. This was caused by this batch, not attributed to unrelated suites. No test suite failed. Nx suppressed successful task detail, so suite/test counts are not claimed.

2. Replaced only those new annotations with inferred `as const` payloads. The original spec prefix remained unchanged. Rechecked only the failed target:

   `npx nx run @ptah-extension/vscode-lm-tools:lint`

   Result: exit 0, `Successfully ran target lint`, **0 errors, 44 warnings**. The full suite was not rerun. The final correction changes test typing only; no production code or assertions changed after the successful typecheck/test run.

3. `ptah_get_diagnostics` scoped to all seven changed source/spec files initially reported TypeScript compiler errors 0, warnings 0. Two subsequent requests after the test annotation correction reported that compilation was still running after 45 seconds, without cancellation. Final follow-up diagnostics were therefore unavailable; this is not claimed as a second clean diagnostic pass.

4. Checked the original spec prefix hash, public barrel newline count, and absence of `surface/index.ts`.

Temporary combined-run log: `C:\Users\abdal\AppData\Local\Temp\task-538-batch-8-verification.log`.

## Deviations and remaining work

- No implementation scope deviation. Host lookup failures are converted to delivery outcomes alongside enumeration failures so the helper's lazy provider cannot reject a push.
- Verification deviation: the combined target was run once as requested; one additional project-only lint run was necessary to verify the correction described above.
- Out-of-scope observations: the lint target still reports 44 warnings. No unrelated file was changed. Cross-review and commit remain the invoking workflow's responsibility.
- CREATED report: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-8-report.md`.

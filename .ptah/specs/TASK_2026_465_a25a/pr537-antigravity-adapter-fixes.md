# PR #537 Antigravity Adapter Fixes

## Finding 1 — Handle `child.stdin` errors before first write

- Finding: `child.on('error')` did not cover errors emitted by the stdin stream, and no stdin error listener existed before the initial stream-json write.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:664`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:282`.
- Change and rationale: Registered a dedicated stdin `error` listener before `writeTurn(taskPrompt)`. It marks stdin closed, resolves the active turn with exit code 1, and emits through the same raw-output and error-segment path used for child-process errors. This prevents an `EPIPE` or write-after-end event from becoming an unhandled host error or leaving the turn pending.
- Status: fixed.

## Finding 2 — Settle malformed terminal `result` events

- Finding: A malformed event with `event: "result"` emitted a validation error but did not settle the active turn.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:923`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:949`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:599`.
- Change and rationale: Made `parseKnownEvent()` return whether validation succeeded. The terminal-result branch now settles with exit code 1 when `AgyResultEventSchema` rejects the event, which also schedules stdin closure through the existing settled-turn path. Valid results keep their prior success/error mapping.
- Status: fixed.

## Finding 3 — Cache stream-input support by binary path

- Finding: The singleton adapter reused one cached boolean even when later runs supplied a different `binaryPath`.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:267`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:322`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:377`.
- Change and rationale: Replaced the unkeyed cache lookup with a `Map<string, boolean>` keyed by the resolved/run binary string. The latest result still updates `capabilities()`, while a different binary is probed independently.
- Status: fixed.

## Finding 4 — Report only present usage token fields

- Finding: Missing `input_tokens` and `output_tokens` were formatted as zero, including events that supplied only `total_tokens`.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:236`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:1016`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:746`.
- Change and rationale: Added focused usage formatting that includes only present input/output values and falls back to the total when neither detailed field exists. An empty usage object emits no fabricated summary.
- Status: fixed.

## Finding 5 — Reduce cognitive complexity

- Finding: `runSdk()` contained all conditional argv construction in addition to process lifecycle orchestration, taking its cognitive complexity above the allowed threshold.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:197`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:608`.
- Change and rationale: Extracted the coherent argument-building concern into `buildAntigravityArgs()`. `runSdk()` now delegates argv policy while retaining process, turn, and MCP lifecycle ownership; no public class name, DI token, or method signature changed.
- Status: fixed.

## Finding 6 — Remove redundant jump

- Finding: The non-success branch in `handleResult()` ended with a redundant `return` immediately before the function ended.
- Changed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:1034`.
- Change and rationale: Removed the redundant jump without changing result emission behavior.
- Status: fixed.

## Verification

- `npx nx test @ptah-extension/cli-agent-runtime --skip-nx-cache --runInBand --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts`: passed; 62 suites, 949 tests passed, 1 skipped.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --skip-nx-cache`: passed.
- `npx nx lint @ptah-extension/cli-agent-runtime --skip-nx-cache`: passed with 0 errors and 39 warnings.

## Tests Added

- A stdin `error` event resolves the active turn with exit code 1, disables continuation, and emits an adapter error segment.
- A malformed terminal `result` resolves the turn with exit code 1 and closes stdin without waiting for process close.
- A usage event containing only `total_tokens` reports the total and does not invent zero input/output counts.
- Stream-json capability results are cached independently for distinct binary paths.

# Batch 9a final revision report

Implemented R1-R5 from the Fixes re-review. Focused Jest: 58 tests passed in 2 suites. Scoped compiler diagnostics: 0 errors and 0 warnings. Nx project typecheck and lint succeeded (lint: 0 errors, 5 warnings). Production parity remains disabled.

## Changes and regression evidence

Source and spec paths below are relative to `libs/backend/gateway-chat-bridge/src/lib/`.

| Item | Change with source location | Spec evidence |
| --- | --- | --- |
| R1: runtime ownership | `codex-gateway-adapter.ts:24`, `:93`, `:98`: retain the privately created runtime and child scope; cache the close promise so concurrent/repeated close calls close context, runtime and scope once. Nested finally blocks attempt runtime/scope release even if earlier cleanup fails. `:159` abandoned turns use this same complete cleanup. The adapter never accepts a borrowed runtime. | `codex-gateway-adapter.spec.ts:231` concurrent and repeated close share one promise, release all owned resources, and leave the parent alive. `:248` context/runtime close failures still dispose the child and are not retried. `:171` closing one adapter does not close the other runtime. |
| R2: gate-first isolated registration | `codex-gateway-adapter.ts:40`: validate the sink and check the production gate before creating or registering a child scope. `:55` each open receives a distinct child; registration and the public gated resolver run there with the exact sink. `:69` failed admission/opening closes any obtained runtime and disposes the child. Parent registrations are untouched. Existing parent runtimes remain refused by the core guard rather than borrowed. | `codex-gateway-adapter.spec.ts:151` repeated closed-gate attempts create/register nothing and retain the same gate-denied result. `:171` two opens using real registration under one parent succeed with separate scopes. `:205` registration/resolution/open failures dispose the child and permit a subsequent open. Existing real-resolver, foreign-context and pre-registered-runtime refusal tests remain. |
| R3: errors do not pollute assistant text | `codex-gateway-adapter.ts:252`: non-terminal error events yield nothing; processing continues until terminal. No diagnostic string or raw error payload enters the assistant answer. | `codex-gateway-adapter.spec.ts:536` error followed by recovered text and terminal emits only recovered text plus completion, without closing context. |
| R4: full requested correlation | `codex-gateway-approval-sink.ts:14`, `:83`: the strict Zod reply contract includes contextId, threadId, turnId and requestId and compares all four without coercion. | `codex-gateway-approval-sink.spec.ts:236`: three cases independently mismatch context, thread or turn while keeping the same requestId; each declines and dismisses. Existing valid-decision fixtures now carry the full correlation; malformed, edit, wrong-id and late-reply tests still pass. |
| R5: remove redundant sink check | `codex-gateway-adapter.ts:110`: assertReady checks closed state and parity only. The sink is validated once at open and bound into registration; it is no longer retained as a redundant field. | Existing missing-sink-before-registration test retained; gate and close lifecycle specs verify admission still fails closed. |

## Verification

All commands ran in `D:\projects\ptah-extension\.claude-worktrees\codex-sdk-main-chat`. PowerShell filters replace the requested tail/grep equivalents.

1. `npx prettier --write libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts` ? succeeded for all four files.
2. `ptah_get_diagnostics` scoped to those four absolute file paths ? TypeScript compiler, clean coverage, 0 errors and 0 warnings.
3. `npx jest -c libs/backend/gateway-chat-bridge/jest.config.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20` ? 2 suites passed, 58 tests passed, 4.185 seconds. Node printed the existing Jest-config ES module warning; tests passed.
4. `npx nx run-many -t typecheck lint -p @ptah-extension/gateway-chat-bridge --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10` ? Successfully ran targets typecheck, lint for project @ptah-extension/gateway-chat-bridge; 0 errors, 5 warnings.
5. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'gateway-chat-bridge|TOTAL'` ? gateway `4 ok (baseline 4)`; TOTAL `276 unsuppressed site(s)`; no gateway FAIL. All four gateway sites remain in the pre-existing gateway-chat-bridge.ts.

No new dependency or cross-library runtime import was added in this round. No package manifests, core runtime/tools, lane files or existing Claude gateway code were edited. No builds, installs, workspace-wide checks or git operations were performed.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Each adapter owns its runtime and child scope, and close releases both. | Expose a runtime for external ownership; retain ownership in the adapter. | R1 explicitly requests owned shutdown. Core `codex-runtime.ts:123` closes its contexts and disposes the rule store; the adapter itself is the factory owner. | Yes; internal, unwired adapter contract. |
| Check parity before creating a child, then retain the public gated resolver as the final admission boundary. | Gate after registration; precheck plus gated resolution. | R2 and public registration/resolver contracts. This prevents production gate denial from mutating any scope and isolates successful sibling registrations. | Yes; no core API changed. |
| Dispose failed child scopes rather than mutate or reset the caller's registrations. | Register directly in parent; isolate and dispose per attempt. | Core registration rejects existing runtime registrations. Real-registration regression tests prove separate sibling scopes work without parent mutation. | Yes. |
| Emit nothing for non-terminal diagnostics. | Add/use a distinct notice event; emit nothing. | R3 explicitly permits omission; terminal handling already determines final failure. No new gateway event or transport contract is required. | Yes; a future reviewed notice surface can expose diagnostics. |
| Require exact context/thread/turn/request correlation in replies. | requestId alone; requested composite identity. | R4 identifies repeated JSON-RPC ids across conversations. Existing strict Zod boundary validates the expanded typed contract. | Yes; presentation adapters must supply all four fields. |

## Integration handoff

- `CodexGatewayAdapter.open` still accepts the caller's container, but now owns a child scope, runtime and context. Call `adapter.close()` for shutdown; do not separately resolve/close its runtime through the parent. A parent containing an unrelated runtime is still rejected by core registration, never used as a borrowed runtime.
- Presentation replies must now be `{ contextId, threadId, turnId, requestId, decision }`, copied from the exact prompt. The four allowed decisions, abort cancellation, edit-decline marker, userInput denial and all-path dismissal are unchanged.
- Runtime cleanup is attempted on failed open and abandoned turn paths; repeated close returns the original completion or rejection without double disposal.
- Gate remains disabled; tests mock admission only for projection/lifecycle cases and separately exercise the real closed gate. No live gateway/process validation was claimed.

## Files written

- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts`
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-9a-fix2-report.md`

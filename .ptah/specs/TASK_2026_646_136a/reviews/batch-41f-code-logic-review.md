# Batch 41f code logic review

**Verdict: NEEDS_REVISION — 7/10.** The two previously reported key mismatch sequences are resolved, but one Moderate user-visible failure remains in the revised post-write path.

**Review family:** reviewer codex/OpenAI; implementers Anthropic subagents and Anthropic orchestrator.

| Previous NEW defect | Status | File:line evidence |
| --- | --- | --- |
| 1. A post-write `setSelection` rejection rolls the key back under the newly stored selection | **CLOSED** | `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:163-175,660-673,701-706` stores the selection before clearing the unsupported mark; mark storage errors are caught, leaving a throwing logger as the relevant rejection path. `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:869-878,900-919` reads the stored selection after rejection and keeps the new key when it matches. The 41f handler spec at `agent-rpc.handlers.decision-model.spec.ts:637-668` covers this result. |
| 2. Concurrent saves let an older rollback replace a newer successful key | **NOT-REPRODUCIBLE** | `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:337,593-607` sends every `agent:setConfig` request through one promise queue before `applySetConfig`; the queue predates 41f (present in `08e51a353`). The new spec at `agent-rpc.handlers.decision-model.spec.ts:697-758` pins the ordering and final key. |

## NEW defects

1. **Moderate — a committed selection and key are reported as an unchanged, failed save.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:869-877,815-828`; `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:56-57,637-648`. Start with a marked Ollama selection and save Jev with a new key. `setSelection` stores Jev, then `clearMark` rejects because its logger throws. The 41f readback correctly keeps the new key, but rethrows the error; `agent:setConfig` returns `success: false`, and the settings row displays “Could not save the decision model. The saved choice is unchanged.” Both the choice and key have changed. The same false failed-save result can occur when the requested selection was already stored and its configuration write rejects before writing: readback equality cannot prove this invocation stored it. The 41f spec asserts the failure result, but does not cover the row's claim. The user can reasonably retry or act on the stated unchanged state while the new credential is active.

## Verification

Read-only inspection of `cda1eb30e`, the prior review, the queue's earlier commit, and affected implementation and specs. I did not rerun the orchestrator's reported 3,738 handler tests, typecheck, lint, or 296-item degradation audit, as instructed.

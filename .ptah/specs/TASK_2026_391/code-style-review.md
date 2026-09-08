# Code Style Review — `TASK_2026_391`

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 1        |
| Files reviewed  | 5        |

The final remediation resolves every material structure and consistency finding. Resume context is a dedicated `contextSnapshot` selected by global main-session recency rather than aggregate cost (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:764`), and its formula matches the live producer (`session-history-reader.service.ts:785`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:290`). Both resume consumers share one application policy (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:648`, `:904`), and the restored-tab edge now converts through `TabId.from()` before entering a method typed with branded `TabId` (`session-loader.service.ts:168`, `:870`).

Verification performed for this re-review: `git diff --check` passed; uncached chat typecheck and lint both printed Nx success. Lint reported 17 existing warnings and zero errors; the only warning in the touched service remains the pre-existing empty `createNewSession` method at line 945. The command wrapper reached its 120-second timeout after both Nx targets had printed success. The preceding uncached run also passed typecheck and lint for all three directly changed projects (`agent-sdk`, `shared`, and `chat`). The preferred `ptah_get_diagnostics` tool was unavailable in this reviewer tool surface.

## Five style questions

### 1. What breaks in six months?

The context contract now has a stable producer-independent meaning. `contextSnapshot` keeps context model identity separate from aggregate `stats.model` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:850`, `:881`), and both frontend resume paths call the same helper (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:648`, `:904`). A later formula or rendering change therefore has one backend snapshot producer and one frontend application seam to update.

The remaining maintenance risk is type declaration drift: the backend repeats the history-stat and context-snapshot shapes in several annotations (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:140`, `:661`, `:699`).

### 2. What would a new team member misread?

The revised naming is direct: `stats.model` is the aggregate primary model, while `contextSnapshot.model` owns the latest main-session context (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:266`, `:267`). The earlier false `hasCompacted` sentinel is gone.

The branded restored-tab flow is also truthful now. A raw value from the currently string-typed active-tab signal is validated at the edge with `TabId.from()` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:159`, `:170`), and the downstream private method accepts only `TabId` (`session-loader.service.ts:870`).

### 3. What does this cost to maintain?

The new `applyResumeStats` helper lowers maintenance cost by centralizing lifetime stats, model-list enrichment, honest unknown state, and context percentage (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:719`). The full-switch and restored-tab paths cannot independently drift without bypassing that named seam.

The backend still repeats the result shape in the public method return, private aggregator return, and local snapshot annotation (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:140`, `:661`, `:699`), alongside the shared RPC declaration (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:257`). This is minor because all declarations currently agree and compilation checks the RPC return structurally.

### 4. Where is this inconsistent with the rest of the repository?

No material inconsistency remains. The history formula now matches the sibling live implementation—input plus cache-read plus cache-creation (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:788`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:290`). Agent usage contributes to lifetime aggregates but cannot overwrite main-session context because snapshot assignment occurs only in the main-message loop (`session-history-reader.service.ts:764`, `:801`).

The restored-tab path follows the branded-ID convention through `TabId.from()` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:170`), matching the repository's smart-constructor pattern (`libs/shared/src/lib/types/branded.types.ts:204`). Angular injection and frontend/backend boundaries remain unchanged (`session-loader.service.ts:61`; `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:232`).

### 5. What would you have done differently?

I would name `HistoricalContextSnapshot` and `SessionHistoryStats` once inside `agent-sdk` and reuse them in the reader's public and private signatures. That is better than repeating anonymous structures because future additions need one backend-domain edit, while the typed `ChatSessionService.resumeSession(): Promise<ChatResumeResult>` can remain the structural RPC boundary check (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:752`). This is an incremental cleanup, not a reason to hold the batch.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:140`, `:661`, and `:699` repeat the history stats/context snapshot structures. Define named internal types once and reuse them; keep the shared RPC declaration separate unless the type is deliberately promoted to a cross-layer domain contract.

## File-by-file

### `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor. The dedicated snapshot preserves global main-session recency (`:764`, `:785`), uses the live formula (`:788`), and remains independent of agent aggregate ranking (`:801`, `:850`). Repeated anonymous type declarations are the only structural debt (`:140`, `:661`, `:699`).

### `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. The added cases distinguish aggregate-cost ordering from latest context ownership, prove agent usage cannot overwrite root context, and pin the live formula after compaction (`:332`, `:401`, `:486`). These are distinct contract cases rather than duplicated assertions.

### `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `contextSnapshot` is additive, optional, and keeps model identity coupled to its token count (`:267`). It does not overload cumulative model-usage entries or add a new RPC namespace.

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `applyResumeStats` centralizes both resume consumers on the dedicated snapshot (`:719`, `:737`); the restored-tab input is converted with `TabId.from()` and stays branded through the private method (`:170`, `:872`). The ownership recheck prevents a late response from applying to a rebound tab (`:898`).

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Restored-tab fixtures now use validated `TabId` values (`:240`), and coverage pins stale-stat replacement, null-stat clearing, and late-response suppression (`:239`, `:299`, `:316`). The targeted reload case separately proves context identity does not follow aggregate model identity (`:1136`).

## Pattern compliance

| Repository rule or nearby convention                                 | Status         | Evidence                                                                                                                                   |
| -------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend/frontend communicate through `libs/shared`                   | PASS           | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:232`                                                                                      |
| Backend `agent-sdk` remains platform-independent                     | PASS           | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:22`                                                                      |
| Angular services use `inject()`                                      | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:61`                                                              |
| One resume-stat policy for both consumers                            | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:648`, `:904`                                                     |
| Lifetime totals remain separate from CTX                             | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:724`, `:737`                                                     |
| Context snapshot owns model identity independently of aggregate rank | PASS           | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:785`, `:850`                                                             |
| Resume and live context formulas agree                               | PASS           | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:788`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:290` |
| Agent usage cannot overwrite main-session context                    | PASS           | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:764`, `:801`                                                             |
| Branded `TabId`, never raw `string`/assertion                        | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:170`, `:872`                                                     |
| Revalidate restored-tab ownership after async resume                 | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:898`                                                             |
| Additive RPC field requires no new allowed prefix                    | NOT_APPLICABLE | Existing `chat:resume` extended at `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:257`                                                   |
| Preserve temporary compaction diagnostics                            | PASS           | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:575`                                                             |
| Strict compilation and lint for changed projects                     | PASS           | Reviewer runs: uncached Nx typecheck/lint succeeded                                                                                        |

## Maintenance debt

- Introduced: repeated anonymous context snapshot declarations in the backend reader.
- Retired: incompatible live/resume formulas; false `hasCompacted` sentinel; per-consumer resume-stat duplication; aggregate-cost/agent contamination of context identity; restored-tab omission of returned stats; raw-string-to-`TabId` assertion; stale restored-tab response application.
- Net: substantially reduced. Remaining debt is local type-declaration duplication with no boundary or correctness impact.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: No merge-blocking style concern remains; consolidating the repeated backend stats/context types would reduce future edit surface.
- What a 10/10 version would do differently: name the repeated backend stats/context structures once while retaining the dedicated snapshot, shared frontend application helper, branded restored-tab edge, ownership recheck, and multi-model/agent/restore tests.

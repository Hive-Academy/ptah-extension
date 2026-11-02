# Native Codex usage live fix 2

## Findings and changes

1. **S1, model switches:** `codex-context.ts:538-541` stages the validated `turn/start` model before notifications can arrive and binds it to the returned turn ID. `codex-event-translator.ts:162-187,206-211,341-347` retains a model per turn, uses a native notification model when supplied, and keeps late usage for an older turn on its original model. `codex-context.ts:257` still seeds the root from the validated `thread/start` or `thread/resume` response. Child threads have independent model entries. The turn stream continues to price the model on accepted native evidence (`codex-chat-turn-stream.ts:209-230`). The pinned `turn/start` response does not carry a model; the validated request and usage notifications are the available sources.
2. **S2, billing changes:** `codex-session-usage-owner.ts:34-47,196-255` persists each priced turn's basis in bounded contiguous accounting segments and derives the session basis from all segments. `codex-chat-adapter.ts:327` no longer overwrites the basis of past usage when a session resumes. `codex-chat-turn-stream.ts:232` reads the stored lifetime basis. The shared `SessionCostBasis` contract has no mixed value and specifies `unknown` for a null total, so a mixed session displays `totalCost: null`, `costBasis: unknown`, and partial pricing coverage; its individual turn events retain their own costs and bases. `session-metadata-store.ts:200-209` applies the same rule to persisted sidebar totals. Pre-fix single-mode checkpoints are interpreted using their saved mode; absent mode remains unknown.
3. **S3, missing coverage:** `codex-chat-turn-lifecycle.spec.ts:231` sends model-less native notifications through translator, usage owner, and turn stream across a model and billing change on resume, checking both turn price and mixed checkpoint segments. `codex-runtime.spec.ts:384,413` drives real `turn/start` settings and `thread/resume` response seeding. `codex-event-translator.spec.ts:406,421` checks old-turn notifications after a switch and independent child models. `codex-session-usage-owner.spec.ts:62` restores a pre-fix checkpoint without model, context or billing data. `plan-limits-snapshot.service.spec.ts:108` covers an ambient-only unknown home owner and rejects an unrelated home's native session without provider-account or ledger rows.
4. **M1, unchanged counters:** `codex-session-usage-owner.ts:314-342` accepts new model and context evidence even with unchanged counters, while leaving the pricing revision unchanged for metadata-only updates. The owner spec checks persistence and context restoration.
5. **M2, hidden metadata failure:** `plan-limits-snapshot.service.ts:276` logs a sanitized warning when the native metadata lookup fails. Its spec verifies the warning and unresolved result.
6. **M3, account changes in one home:** Plan Limits still binds a native session to the home's *current* owner. If that home's login changes, the session follows the current account. The discovered-owner key gate continues to prevent another home's limits from being attached.
7. **M4, stale context window:** `codex-session-usage-owner.ts:331-333` drops the previous window when the model changes without a new window. `:374-383` uses the new model's capacity and caps displayed context tokens at that window. Owner specs cover both cases.

## Changed files

- `libs/backend/codex-runtime/src/index.ts`
- `libs/backend/codex-runtime/src/lib/codex-context.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` (retained fix 1)
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.spec.ts`
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts`
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts`
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts`

## Evidence and limits

Read-only source inspection covered the pinned response and notification schemas, the shared cost-basis contract, the pricing function, checkpoint restore, metadata persistence, and the Plan Limits owner gate. Pre-fix checkpoints have only one saved billing mode and cannot recover historical changes that were never recorded; those old portions remain subject to their saved mode. The Ptah symbol index had zero usable results and the dependency graph was still building, so source searches fell back to PowerShell; `rg.exe` was inaccessible. No npm, Nx, Jest, lint, typecheck, build, verify, or git write command was run, as requested. Specs are written but unexecuted. No UI was changed. Skill invocation was not exposed in this lane's tool list; no matching coding skill was loaded.

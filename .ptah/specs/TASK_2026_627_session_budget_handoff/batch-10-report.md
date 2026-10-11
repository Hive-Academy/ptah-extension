# Batch 10 report — Shared live-stage wire field (S1-part)

## Task 10.1: `liveBudgetStage` on the live payload and the parser — done

- `SessionStatsLivePayload` (backend contract) gains
  `readonly liveBudgetStage?: 'handoff' | 'limit' | null`, documented with the `budget` convention
  (D25): `undefined` = no change, `null` = clear, a value = set; meaningful only on a provisional
  snapshot.
- `SessionStatsLiveWire` gains the same optional field.
- `parseSessionStatsLivePayload`: a non-provisional snapshot returns `{ sessionId, sessionStats }`
  only (drops `context` and `liveBudgetStage`, as before for `context`). On a provisional snapshot,
  `parseLiveBudgetStage` keeps `'handoff'`, `'limit'` or `null`; any other value (including an
  explicit `undefined`) drops only the field, so the result has no `liveBudgetStage` key and the
  consumer sees "no change", never an accidental clear. `context` and `liveBudgetStage` are
  independent: a bad context does not drop a valid stage and vice versa. Envelope rejections
  (bad `provisional`, revision, sessionId, sessionStats) are unchanged; the stage cannot rescue a
  rejected envelope.
- Spec S14 added in `session-stats-live.spec.ts` (`describe('liveBudgetStage')`): keeps
  handoff/limit/null on provisional; keeps the stage when the context is dropped; no key when absent;
  drops only the field for undefined, `'warning'`, `'ok'`, `''`, `'LIMIT'`, number, boolean, object;
  drops handoff/limit/null on a non-provisional snapshot and keeps the payload; rejected envelope
  stays rejected.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\agent-adapter.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\messages\session-stats-live.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\messages\session-stats-live.spec.ts`

## Risks and assumptions

- A4 (shared parser is the only field filter): relied on as verified in batches.md;
  `sdk-callbacks.ts` and `chat-message-handler.service.ts` were not edited. The parser now carries the
  field through, so the aggregator (Batch 15) receives it unchanged.
- Additive only: nothing reads the field yet (Batches 11 and 15); the field is optional on both
  types, so no existing producer or consumer changes.

## Verification (from the worktree root)

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts --coverage=false --maxWorkers=2`
  → 1 suite passed, 48 tests passed.
- `npx nx typecheck @ptah-extension/shared --parallel=1 --skip-nx-cache` → success.
- `npx nx lint @ptah-extension/shared --parallel=1 --skip-nx-cache` → 0 errors, 5 warnings, all in
  files this batch did not touch; `eslint` on the three changed files reports nothing.
- Prettier: `session-stats-live.ts` is clean. `session-stats-live.spec.ts:87` and
  `agent-adapter.types.ts:277` show drift that also exists at HEAD, on lines this batch did not touch;
  left as is.

## Deviations

None.

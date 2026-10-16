# Batch 41h code logic review

**Verdict: APPROVED — 8/10.** The 41g Moderate defect is closed. No blocking, Serious, or Moderate defect was found in this correction. The score stays below 9 because the new selection-only tests do not exercise an unreadable read back; it remains above 7 because the branch uses the same guarded read and original-error propagation as the already tested combined path (`agent-rpc.handlers.ts:863-875,883-907,917-935`; `agent-rpc.handlers.decision-model.spec.ts:681-755`).

## Findings by severity

- **Critical:** None.
- **Serious:** None.
- **Moderate:** None.
- **Minor — selection-only unreadable read back lacks a direct regression test.** The two new specs cover `getSelection()` returning the requested selection and a different selection (`agent-rpc.handlers.decision-model.spec.ts:681-727`). The existing unreadable spec supplies both a key and a selection (`agent-rpc.handlers.decision-model.spec.ts:729-755`). If a future edit changed the selection-only branch to accept `'unreadable'` as success, these two new specs would still pass; the user would see a successful save although storage could not be checked. Current code correctly rethrows the original selection error for this case (`agent-rpc.handlers.ts:865-869,927-935`).
- **Minor — inaccurate diagnostic text in the reused reader.** On a selection-only save whose `getSelection()` throws, `storedSelectionState` logs that it is "restoring the previous key" (`agent-rpc.handlers.ts:927-934`), although the selection-only path has written no key (`agent-rpc.handlers.ts:861-875`). The RPC result remains the original failure; this affects only the operator log.

## Bounded path assessment

| Case | Evidence and result |
| --- | --- |
| Selection only; requested selection stored before rejection | The catch reads the stored selection and returns normally only for `'stored'` (`agent-rpc.handlers.ts:863-875,917-926`). `applySetConfig` then writes later requested fields and returns success (`agent-rpc.handlers.ts:690-702,813-814`). The new spec checks success, later write, no key access, and type-only warning (`agent-rpc.handlers.decision-model.spec.ts:681-704`). |
| Selection only; requested selection not stored | The catch rethrows the original error (`agent-rpc.handlers.ts:865-869`). The new spec checks the `SettingsPersistError` text and that later fields are skipped (`agent-rpc.handlers.decision-model.spec.ts:706-727`). The adjusted older spec now starts with a stored Jev choice and requests `unset`, preserving its original failed-store intent (`agent-rpc.handlers.decision-model.spec.ts:492-508`). |
| Selection only; read back unreadable or malformed | `getSelection()` throwing, or returning a value that makes comparison throw, becomes `'unreadable'`; the original `setSelection` error is rethrown (`agent-rpc.handlers.ts:865-869,920-935`). There is no direct selection-only test for this case. |
| Key plus selection | The branch beginning with `readJevApiKey()` and its success, rollback, and uncertainty behavior is unchanged by commit `f0dee00e1` (`agent-rpc.handlers.ts:881-909`). Existing stored and unreadable cases remain covered (`agent-rpc.handlers.decision-model.spec.ts:646-679,729-755`). |
| Overlapping saves | `setConfigQueue` still serializes whole `applySetConfig` calls (`agent-rpc.handlers.ts:593-607`). The new `storedSelectionState` call is synchronous, with no await between rejection and read back (`agent-rpc.handlers.ts:865-869,917-935`), so this change adds no queue interleaving. |

The new catch follows the adjacent combined-path `// degradation-audit: reported` convention (`agent-rpc.handlers.ts:865-873,886-893`): an unverified write rethrows the original error; a verified write logs only `errorTypeOf`, which reduces errors to their type (`agent-rpc.handlers.ts:313-315`). The outer handler converts thrown errors to fixed user-facing text (`agent-rpc.handlers.ts:815-828`).

## Five logic questions

1. **Silent failure:** For a stored selection, the new path reports success and emits a type-only warning; for an unreadable state it reports failure. A warning logger that itself throws could still make a committed selection look failed, but that behavior also exists in the unchanged combined branch (`agent-rpc.handlers.ts:865-875,886-893`).
2. **User action:** Saving a selection without a Jev key enters the corrected branch; later settings in the same request proceed after a verified late rejection (`agent-rpc.handlers.ts:690-702,861-875`).
3. **Wrong answer from input:** A different stored selection or a malformed read back cannot produce success; equality or comparison failure sends the original error outward (`agent-rpc.handlers.ts:292-310,865-869,920-935`).
4. **Dependency failure:** A rejected `setSelection` triggers read back; a rejected or malformed read back retains the original write failure, and other fields are skipped (`agent-rpc.handlers.ts:690-702,865-869,927-935`).
5. **Unspecified case:** The new tests leave the selection-only unreadable case implicit in the shared reader and existing combined-path test; this is the Minor test gap above (`agent-rpc.handlers.decision-model.spec.ts:681-755`).

## Verification

Reviewed commit `f0dee00e1`, the 41g finding, the 41h report, the changed handler paths, the spec harness and affected cases, and the underlying `setSelection` write order (`decision-model.config.ts:153-176,701-706`). The requested focused Jest run passed: **1 suite, 35/35 tests**. `ptah_get_diagnostics` reported TypeScript checking unavailable after its 45-second limit for both scoped files; the 41h report records rpc-handlers typecheck and lint passing. No source files or git state were changed.

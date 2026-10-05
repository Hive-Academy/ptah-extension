# Phase 1 fix report — TASK_2026_596

**Finding fixed**: 1 (Serious) — an unknown model scope could falsely confirm room.

## Approach

Whether the scope is complete is now recorded as its own field. `windowSetEstablished` still only means the owner read was complete. `applicableLimits` sets
`ApplicableLimits.modelScopeUnresolved = true` when the lane's scope normalises to
`undefined` (null, undefined, blank) **and** the owner has any model-scoped window
(declared `modelScope` or a `weekly_model:<scope>` key) or model-scoped owner evidence.
`unknownReasons` then pushes the new reason `{ kind: 'model-scope-unknown' }`, so
`classifyLaneState` can never return `confirmed-room` for that lane.

Model-scoped windows are still filtered out of `windows`/`ownerEvidence` for an
unknown scope. The exhausted `weekly_model:opus` window is therefore not shown as the
lane's own limit, and the lane is `unknown`, not `at-limit`. Unscoped exhaustion and
near-limit windows still classify first, because they apply to every model. A lane of unknown scope whose owner has only unscoped
windows still behaves as before (`modelScopeUnresolved: false`).

**New reason**: `model-scope-unknown` (added to `LaneStateReason` next to
`window-set-not-established` / `estimated-limit`).

`plan-limit-format.ts` does not map `LaneStateReason` kinds to text (no reference to
`LaneStateReason` or any reason kind), so no formatter change was needed. libs/shared
stays zod-free, and there is no `Date.now()` call.

## Files changed

- MODIFIED `libs/shared/src/lib/utils/plan-limits/lane-state.ts`
  - `:87-88` — `applicableWindows` doc notes the recorded omission.
  - `:115-121` — new `ApplicableLimits.modelScopeUnresolved` field with doc.
  - `:127-137` — new private `hasModelScopedLimits(owner)`.
  - `:149-150` — `applicableLimits` computes `modelScopeUnresolved`.
  - `:192` — `LaneStateReason` gains `{ kind: 'model-scope-unknown' }`.
  - `:274` — `unknownReasons` pushes `model-scope-unknown` when unresolved.
  - `:305-309` — `classifyLaneState` doc updated for the rule.
- MODIFIED `libs/shared/src/lib/utils/plan-limits/lane-state.spec.ts`
  - `:265-290` — test renamed and extended; one test added.
  - `:330-371` — four `classifyLaneState` tests added.

## Tests

Changed:
- `an unknown scope matches unscoped windows only and records the omission` (was
  `an unknown scope matches unscoped windows only`). It keeps the filtering assertions and
  adds checks that `modelScopeUnresolved` is `true` for `null` and blank scopes and `false` for `opus`.

Added:
- `scope completeness covers model-scoped evidence and weekly_model keys`
- `unknown scope + fresh ok unscoped windows + exhausted weekly_model:opus is unknown, never confirmed room`
  (the reviewer's case, over `null`, `''`, `'  '`. Reasons equal exactly
  `[{ kind: 'model-scope-unknown' }]`, and the windows are only `five_hour`, `weekly`.)
- `unknown scope + model-scoped owner evidence is unknown, never confirmed room`
- `unknown scope still reaches at-limit from an unscoped exhaustion`
- `unknown scope with only unscoped windows still confirms room` (the unscoped-only case is unchanged)

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=2`
→ `Successfully ran targets typecheck, test, lint for project @ptah-extension/shared`
(cache 0/3 hit, so all three targets ran fresh). Nx Cloud printed its usual
"organization disabled" notice, which has nothing to do with the targets.
`ptah_get_diagnostics` was not available in this session.

## Notes

- `batches.md` was not edited. Nothing was staged or committed.
- Phase 2 consumers that build lane rows from `applicableLimits` get the new field
  automatically. Any surface that renders `LaneStateReason` kinds will need text for
  `model-scope-unknown`, for example "Model not resolved yet; model-specific limits may apply".

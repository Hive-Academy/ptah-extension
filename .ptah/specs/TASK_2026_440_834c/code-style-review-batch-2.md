# Code Style Review — `TASK_2026_440_834c` (Batch 2)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                  |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                     |
| Serious issues  | 0                                     |
| Minor issues    | 1                                     |
| Files reviewed  | 2                                     |

Scope: `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` and
`libs/backend/platform-core/src/file-settings-keys.ts`, verified via `git diff` in the
worktree against `implementation-plan.md` Component 9 (DTO block, lines 664-702) and the
settings block (lines 569-578).

## Five style questions

### 1. What breaks in six months?

Nothing structural. `MemoryStorageHealthDto` nests `observations` and `retention` as inline
object literals rather than named interfaces (`rpc-curator-diagnostics.types.ts:122-131,
132-141`). If a future batch needs to reuse `retention`'s shape elsewhere (e.g. a
`memory:retention:status` RPC result), it will have to either duplicate the shape or hoist it
retroactively — a minor but real six-month cost. This matches the plan's literal shape
(`implementation-plan.md:679-699`) exactly, so it isn't a deviation, just a note for whoever
extends the DTO next.

### 2. What would a new team member misread?

The trailing inline comments on `dbBytes`, `reclaimableBytes`, and the nested fields
(`rpc-curator-diagnostics.types.ts:119-129,138`) are the only trailing-comment block in this
740+-line file — every other DTO in the file (`SkillTriggersDto`, `MemoryDbHealthDto`, etc.)
uses no per-field comment or a block comment above the interface. A reader skimming the file
could mistake this as this batch's own convention rather than a verbatim copy of the plan's
DTO block. It is copied field-for-field from `implementation-plan.md:679-689`, so it is
correct, just locally novel.

### 3. What does this cost to maintain?

Low. Both changes are purely additive: two new exported interfaces and four new settings
keys with their defaults, mirroring the existing `memory.triggers.*` block immediately above
them. No existing type, export, or settings key was touched.

### 4. Where is this inconsistent with the rest of the repository?

It isn't. The settings-key insertion sits directly inside the existing `memory.*` block in
both `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:334-337`) and
`FILE_BASED_SETTINGS_DEFAULTS` (`:591-594`), in the same order (`enabled`,
`processedDays`/`processedDays`-adjacent, `stuckDays`, `batchSize`) as the plan specifies
(`implementation-plan.md:514-515`), and follows the same "key list mirrors default list"
pattern already used for `memory.enabled` one line above. The new DTOs export the same way
(`export interface ... Dto`) as every sibling DTO in the file (`SkillTriggersDto`,
`MemoryDbHealthDto`), and reach `@ptah-extension/shared` through the existing wildcard
barrel entry (`libs/shared/src/index.ts:57`) with no new barrel line needed — correctly
verified in `batch-2-report.md`.

### 5. What would you have done differently, and why is that better rather than merely other?

I would add a one-line comment above the four new settings keys (mirroring the rationale
comments already given to `memory.enabled` immediately above, `file-settings-keys.ts:318-330`)
stating that these four are read by `memory-retention-config.ts` and must stay numerically
equal to its fallbacks (as the plan itself states at `implementation-plan.md:572`). That
invariant is currently enforced only by a test in a sibling batch
(`memory-retention.service.spec.ts`, per `implementation-plan.md:578`), not documented at the
point of definition, so a future editor changing one number without also editing the config
file would get no textual warning here — only a cross-file test failure elsewhere. This is a
suggestion, not a defect: the existing block already relies on tests for this kind of
cross-file mirroring (see `SKILL_LANE_SETTINGS_DEFAULTS` spread above it), so it is
consistent with, not worse than, the surrounding pattern.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

1. No local comment ties the four `memory.retention.*` defaults to their must-match source
   in `memory-retention-config.ts` (`file-settings-keys.ts:334-337, 591-594`). The invariant
   is real (`implementation-plan.md:572`) and enforced by a spec in a later batch, but nothing
   at the definition site says so, unlike `memory.enabled` immediately above it which does
   carry a rationale comment. Not a defect — a documentation nicety worth folding in
   whenever this file is next touched.

## File-by-file

### rpc-curator-diagnostics.types.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor. `MemoryRetentionRunDto` and
`MemoryStorageHealthDto` (`:103-116`, `:118-143`) match the plan's DTO block verbatim —
field names, `readonly`, the `'completed' | 'partial' | 'failed'` literal union, nullable
fields, and the optional `readErrors?: readonly string[]` mirroring the sibling
`MemoryDbHealthDto.countErrors?` pattern at `:154`. `MemoryDiagnosticsResult` (`:168-180`)
correctly was not touched — no `storage` field yet, as required for this batch. Exported
through the existing wildcard barrel (`libs/shared/src/index.ts:57`), confirmed by a direct
diff read, not just the report's claim.

### file-settings-keys.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor. Four keys added to `FILE_BASED_SETTINGS_KEYS`
(`:334-337`) and matching defaults added to `FILE_BASED_SETTINGS_DEFAULTS` (`:591-594`), both
inside the existing `memory.*` block, values `true / 7 / 14 / 500` exactly as specified
(`implementation-plan.md:514-515`). Ran `file-settings-keys.spec.ts` locally via
`nx run-many -t typecheck test lint -p @ptah-extension/shared @ptah-extension/platform-core`
(this session) — 576 platform-core tests passed, 0 lint errors, confirming no existing
enumeration-style assertion (e.g. the `skillSynthesis` gate-flag filter at
`file-settings-keys.spec.ts:587-598`) was broken by the addition.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| DTO fields readonly, matches plan exactly | PASS | `rpc-curator-diagnostics.types.ts:103-143` vs `implementation-plan.md:664-702` |
| `MemoryDiagnosticsResult` does not gain `storage` this batch | PASS | `rpc-curator-diagnostics.types.ts:168-180` unchanged |
| Export reachable via `@ptah-extension/shared` barrel | PASS | `libs/shared/src/index.ts:57` (`export *` of this file, pre-existing) |
| Settings keys registered in both `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` | PASS | `file-settings-keys.ts:334-337, 591-594` |
| Defaults true/7/14/500 | PASS | `file-settings-keys.ts:591-594` |
| Placed in the memory block, following `memory.enabled` naming/comment convention | PASS (comment convention only partially followed — see Minor #1) | `file-settings-keys.ts:330-337` |
| No existing spec broken by the new keys | PASS | local `nx run-many` run, 576 passed, 0 lint errors |
| Column-aligned trailing comments (plan-specified verbatim block) | NOTED, not scored | `rpc-curator-diagnostics.types.ts:119-129,138` — `nx format:write` will realign on commit per task instructions |

## Maintenance debt

- Introduced: two additive DTO interfaces and four additive settings keys/defaults, both
  purely additive with no behavioral surface yet (nothing reads or writes these keys/DTOs in
  this batch).
- Retired: nothing.
- Net: negligible increase, fully consistent with existing patterns in both files; the one
  minor documentation gap noted above is the only debt worth naming.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only note is a missing invariant comment tying the four
  new defaults to `memory-retention-config.ts`'s fallbacks, currently enforced only by a
  spec in a later batch.
- What a 10/10 version would do differently: add the one-line "must equal
  `memory-retention-config.ts` fallbacks" comment above the four new keys, matching the
  rationale-comment treatment already given to `memory.enabled` one line above.

# Code Style Review - TASK_2026_597_ab22, Batch 2

## Summary

| Metric         | Value                              |
| -------------- | ---------------------------------- |
| Overall score  | 8/10                               |
| Verdict        | APPROVED                           |
| Blocking       | 0                                  |
| Serious        | 0                                  |
| Minor          | 4                                  |
| Files reviewed | 4 (diffs plus surrounding context) |

Scope: `libs/backend/platform-core/src/file-settings-keys.ts`, `file-settings-keys.spec.ts`, `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `rpc-auth.types.ts`. Compared against `codexModel`, `codexReasoningEffort` and `codexAutoApprove` entries and against implementation-plan.md:396-421.

## Five style questions

1. Six months out: the literals 120000 / 2500 are duplicated in the defaults map (file-settings-keys.ts:469-470), in the JSDoc (rpc-agents.types.ts:121,123) and in the spec table (spec.ts:203-205). A default change touches three places. The spec duplication is deliberate (a literal pin) and acceptable. The JSDoc copy is the one that will drift.
2. A new reader could misread `0`. It means "Codex runtime default", but the key name does not say so. The comment at file-settings-keys.ts:467 and the JSDoc at rpc-agents.types.ts:121-124 cover it. `codexWebSearch` JSDoc ("`web_search` live/disabled") is clear.
3. Maintenance cost is low: three keys follow the existing 3-place registration (keys set, defaults map, SCOPED_SETTING_KEYS) with no new abstraction.
4. Consistency: the entries sit directly after `codexAutoApprove` in both maps (file-settings-keys.ts:165-167, 467-470). The SCOPED entries use the exact `{ appScopable: false, supportedTargets: ['global'] }` shape of `codexModel` (rpc-auth.types.ts:409-420). This matches the plan (implementation-plan.md:396-421).
5. Differently: I would add the three keys to `KNOWN_CONFIG_KEYS` if settings export is meant to carry per-CLI tuning (see Minor 1). Otherwise the shape is right.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

1. `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:69` (outside Batch 2, noted only). `KNOWN_CONFIG_KEYS` lists `codexModel`, `codexReasoningEffort` and `codexAutoApprove`, but not the three new keys. Settings export/import will silently omit them. Check whether this is intentional or covered by another batch. The plan does not mention it.
2. `rpc-agents.types.ts:120-125`. The new fields are optional (`?`) on `AgentOrchestrationConfig`. Sibling `codexModel`, `codexReasoningEffort` and `codexAutoApprove` are required. The newer-key convention (`piReasoningEffort?`, `antigravityModel?`) is optional, so this is defensible. It does mean the getConfig handler may legally omit them, and the UI must default them. Prefer required if the handler always populates them from the defaults map.
3. `spec.ts:226-229`. The second test casts `FILE_BASED_SETTINGS_DEFAULTS[key] as number` and repeats the key list that `codexBudgetDefaults` already holds. It could filter `Object.entries(codexBudgetDefaults)` by `typeof === 'number'` and avoid the cast. The first test already pins the exact values, so the "non-negative integer" test is largely redundant (120000 and 2500 are trivially non-negative integers).
4. `rpc-agents.types.ts:121,123` JSDoc restates the default numerics, which duplicates the source of truth in `FILE_BASED_SETTINGS_DEFAULTS`. `codexModel`'s JSDoc does not restate its default value. Low cost; drift risk only.

## File-by-file

### file-settings-keys.ts

Score 9/10 - 0 B, 0 S, 0 M. Keys registered at :165-167 and defaults at :467-470, adjacent to `codexAutoApprove`. Booleans and integers have explicit defaults, which fits the file's stated convention (:140-146). The comment states what 0 means.

### file-settings-keys.spec.ts

Score 8/10 - 0 B, 0 S, 1 M (Minor 3). Uses `it.each` over a literal table. Checks membership, routing and the default value. The block is named with the task id like neighbours (`TASK_2026_181` at :195+). Good rationale in the doc comment (:196-200).

### rpc-agents.types.ts

Score 8/10 - 0 B, 0 S, 2 M (Minors 2 and 4). Types are precise: `number` and `boolean`, and the JSDoc is consistent between the config shape (:120-125) and the set-params shape (:217-222). The "Rejected, never clamped" contract is stated on the setConfig params. Adding `'inherit'` to `CLI_REASONING_EFFORT_VALUES` (:166) and `PI_REASONING_EFFORT_VALUES` (:181), with a doc note that the spawn path must resolve it, matches the plan (:419-421). The `as const` arrays make the derived unions pick up `inherit` automatically.

### rpc-auth.types.ts

Score 9/10 - 0 B, 0 S, 0 M. Three entries at :417-428, shape-identical to `codexModel`.

## Pattern compliance

| Rule or convention                                                                       | Status                      | Evidence                                    |
| ---------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| New file-based key registered in both KEYS set and DEFAULTS map                          | PASS                        | file-settings-keys.ts:165-167, 467-470      |
| Every file-based key has a SCOPED_SETTING_KEYS entry (`appScopable:false`, `['global']`) | PASS                        | rpc-auth.types.ts:417-428                   |
| Defaults convention (explicit boolean/number, 0/'' sentinel documented)                  | PASS                        | file-settings-keys.ts:467                   |
| Config interface and setConfig params mirror each other                                  | PASS                        | rpc-agents.types.ts:120-125, 217-222        |
| Shared enum arrays stay `as const` with doc on sentinel                                  | PASS                        | rpc-agents.types.ts:158-185                 |
| Settings export whitelist includes per-CLI keys                                          | NOT VERIFIED / possible gap | settings-export.types.ts:69 (outside scope) |
| Spec naming and structure follow neighbours                                              | PASS                        | spec.ts:195-233                             |

## Maintenance debt

- Introduced: three keys across 3 registries, a literal default duplicated in the JSDoc, and 2 enum members.
- Retired: nothing.
- Net: small and proportionate. No new abstraction.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH (diffs read in full with sibling comparison; I did not run tests or typecheck)
- Key concern: confirm whether the settings-export whitelist should also carry the new keys (Minor 1).
- A 10/10 version would: make the config fields required if getConfig always populates them, drop the redundant integer test or derive it from the table, avoid restating numeric defaults in JSDoc, and add the keys to `KNOWN_CONFIG_KEYS` if export is intended to carry them.

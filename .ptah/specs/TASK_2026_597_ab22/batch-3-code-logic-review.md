# Code Logic Review — TASK_2026_597_ab22, Batch 3 (lane settings RPC)

## Summary

| Metric        | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Overall score | 8.5/10                                                       |
| Verdict       | APPROVED                                                     |
| Blocking      | 0                                                            |
| Serious       | 0                                                            |
| Moderate      | 1 (import path not validated; read-side covers display only) |
| Minor         | 2                                                            |

Scope: `git diff` of the four files only (settings-export.types.ts + spec, agent-rpc.handlers.ts, agent-rpc.handlers.set-config.spec.ts). Read the whole write/read path in agent-rpc.handlers.ts (`registerSetConfig` ~:323-475, `getAgentCfg`/`setAgentCfg` ~:1150-1195), the shared param types (`rpc-agents.types.ts:121-125,160-185,218-222`), and `file-settings-keys.ts:165-167,468-470`. I did not re-run the specs. I relied on the executor's reported 41/41 and 5/5 and read the spec bodies.

## Focus areas

### 1. Invalid values rejected before any write, never clamped, own message, not masked

- `invalidCodexBudget` (agent-rpc.handlers.ts:127-140) tests each token field with `isNonNegativeInteger` (:116-118: `typeof number && Number.isSafeInteger && >= 0`). That rejects negative, fractional, NaN, ±Infinity, string, boolean, null, and anything above `MAX_SAFE_INTEGER`. `undefined` (field absent) passes, which is correct for a partial update. `codexWebSearch` must be `typeof boolean` (:136-139).
- The call sits at :347-353, inside the existing validate-before-write block. It runs after the cursorApiKey and effort checks and before the first `setAgentCfg` (:~355). The early `return` leaves the `try` normally, so the generic catch (:463-475, fixed text "Could not save the orchestration settings.") is never reached.
- Each rejection carries the field name (`Unsupported ${field} value`). Values are written unchanged (:412-420), so there is no clamping. Unlike `maxConcurrentAgents`, no `Math.min/max` is applied.
- Spec evidence (set-config.spec.ts, new `it.each`, 11 cases): asserts the exact error, `not.toBe(generic message)`, `setConfiguration` not called, and `settings.size === 0` even with a valid `piModel` in the same request, so there is no partial write. The masking test makes every `setConfiguration` reject, and it still gets the specific message with `logger.error` uncalled. This proves the ordering.
- Gap (Minor): no spec case for a too-large integer (> 2^53-1), and none for `-0` or an Infinity on the webSearch field. The guard handles them, but they are untested. `-0` passes `>= 0` and is stored as 0 (JSON serialises it as 0), which is harmless.

### 2. getConfig always fills the three fields; invalid file values read as defaults; constants pinned

- `agent:getConfig` populates all three at :267-273 through `getCodexBudgetTokens` / `getCodexWebSearch` (:1166-1181). Both re-validate the stored value with the same predicate and return the default otherwise. `getAgentCfg`'s `?? defaultValue` covers null/undefined. Stored `0` and `false` are kept (the `??` does not treat them as missing, and the predicate accepts them). The round-trip spec proves that.
- `CODEX_BUDGET_DEFAULTS` (:111-117: 120000 / 2500 / true) equals `FILE_BASED_SETTINGS_DEFAULTS` (file-settings-keys.ts:468-470). The "empty store" spec compares against `FILE_BASED_SETTINGS_DEFAULTS[...]` and then against literals, so drift in either direction fails the spec. This is a duplicated constant, but it is pinned.
- The spec for hand-edited values (-5, 'lots', 'yes') returns the defaults.

### 3. `inherit` and the legacy migration list

- `inherit` is in `CLI_REASONING_EFFORT_VALUES` and `PI_REASONING_EFFORT_VALUES` (rpc-agents.types.ts:164-165, 180-181), which `invalidReasoningEffort` uses. The new spec's `it.each` persists `inherit` for codex, copilot and pi. OK.
- `KEYS_TO_MIGRATE` (:~1228-1239) is unchanged in the diff and has no new keys. OK, matches plan :796.

### 4. Write path and F17

- Writes use `setAgentCfg(field, value)`, which calls `workspace.setConfiguration('ptah', 'agentOrchestration.<key>', value)`. Reads use `workspace.getConfiguration('ptah', 'agentOrchestration.<key>', default)` (:1150-1160). This is the routed file-store form that the plan names in F17. The file-based key list (file-settings-keys.ts:165-167) routes these keys to the file store. The spec asserts the stored key `ptah.agentOrchestration.<field>`, so the key form matches what the Batch 4 readers must use (`getConfiguration('ptah','agentOrchestration.<key>')`). Nothing in this batch writes to the legacy `stateStorage`.
- `KNOWN_CONFIG_KEYS` has the three entries (settings-export.types.ts:78-80), with a no-duplicates test already in place and a new `arrayContaining` case.

### 5. Degradation-audit finding at :1144

- On HEAD the same site exists: `git show HEAD:...agent-rpc.handlers.ts` has `resolveDefaultPtahCliId` at :1066 with `try { ... } catch { return undefined; }`. The diff does not touch that function; its line moved from 1066 to ~1144 only because this batch inserted about 78 lines above it. Pre-existing, one site both before and after.
- The audit is a per-directory ratchet (`tools/degradation-audit/check-degradation.ts:58-60,811-830`, baseline.json keyed by directory). A move of a line number within a directory does not change the count, and the batch adds no `catch`. The new validator and readers have no catch, so the count for `libs/backend/rpc-handlers` is unchanged.
- It does NOT block the pre-commit hook. `.husky/pre-commit` runs lint-staged (format + `nx affected -t lint`) and `nx run ptah-electron:validate-deps`. `.lintstagedrc.mjs` does not run the degradation audit. The audit runs only in CI (`.github/workflows/ci.yml:143-146`) and passes there on a flat count. Nothing to suppress or fix.

## Five logic questions (brief)

1. Silent failure: none found. Invalid input returns an explicit error. Invalid stored data reads as the default silently, which is the intended and specified behaviour (plan :794-795). The UI cannot tell the stored value was bad, which is acceptable.
2. Unexpected user action: sending `codexWebSearch: false` together with an invalid token field writes nothing (all-or-nothing, spec-proven). OK.
3. Wrong answer rather than error: a very large but safe integer (e.g. 9e15) is accepted and passed on as a token budget. The plan only specifies integer >= 0, so this is within the spec. Batch 4's reader should decide whether to cap it. See Minor 2.
4. Dependency failure: `setConfiguration` rejection mid-sequence still hits the generic catch, which can leave earlier fields written. This is pre-existing behaviour for every field and is not worsened here.
5. Missing: the settings import path does not validate per key (executor noted it). A hand-edited import or file can hold -5 or "lots". `agent:getConfig` masks that, but whatever Batch 4's lane reader does must apply the same predicate, or the UI will show 120000 while the lane receives -5.

## Moderate

- M1: Import/hand-edit path is unvalidated. The display is protected in getConfig, but protection of the actual consumer depends on Batch 4. Verify in the Batch 4 review that the lane reader uses an equivalent `isNonNegativeInteger` + default fallback. Not a defect of this batch.

## Minor

- m1: `CODEX_BUDGET_DEFAULTS` duplicates platform-core defaults. It is spec-pinned, so acceptable. Importing from platform-core would remove the duplicate, but the handlers already follow the repository's mirror practice (`skill-promotion.service.ts:57`).
- m2: No test for the upper bound (`Number.MAX_SAFE_INTEGER + 1`) or `-0`. The guard handles them; add one `it.each` row for completeness.

## Requirements fulfilment

| Requirement                                               | Status   | Gap                                        |
| --------------------------------------------------------- | -------- | ------------------------------------------ |
| R2.3 `inherit` saved for all three effort fields          | COMPLETE | none                                       |
| R4.4 backend: get/set, validated, defaults filled         | COMPLETE | steer/stop/repeat deferred to S4 by design |
| Plan comp 6: validate before write, own message, no clamp | COMPLETE | none                                       |
| Legacy migration list unchanged                           | COMPLETE | none                                       |
| F17 routed key form                                       | COMPLETE | Batch 4 readers must match                 |
| KNOWN_CONFIG_KEYS                                         | COMPLETE | none                                       |

## Verdict

APPROVED, 8.5/10. Validation sits at the correct point in the pipeline, with strict guards and field-specific messages. The tests prove the no-write and no-masking invariants, and the audit hit is pre-existing, count-neutral and not part of the pre-commit hook. Score is below 9 only for the small untested upper-bound case and the consumer-side dependency on Batch 4 for hand-edited values.

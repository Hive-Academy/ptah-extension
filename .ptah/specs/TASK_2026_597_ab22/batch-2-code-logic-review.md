# Code Logic Review — TASK_2026_597_ab22, Batch 2

## Summary

| Metric              | Value                                 |
| ------------------- | ------------------------------------- |
| Overall score       | 8/10                                  |
| Assessment          | APPROVED                              |
| Blocking issues     | 0                                     |
| Serious issues      | 0 (1 known, tracked, branch-only gap) |
| Moderate issues     | 2                                     |
| Failure modes found | 2                                     |

Scope: the 4 files in the Batch 2 diff, read via `git diff`, plus every consumer of the effort arrays and the new keys (grep over `libs/`).

## Verification against the brief

1. **Defaults match the plan.** `file-settings-keys.ts:468-470` sets 120000, 2500 and true, matching `implementation-plan.md:409-411`. The keys are in `FILE_BASED_SETTINGS_KEYS` at `:165-167`, next to `codexAutoApprove`. The spec pins each key's membership and default value at `file-settings-keys.spec.ts:195-233`. It also uses `hasOwnProperty`, so a missing default cannot pass through an undefined comparison.
2. **`inherit` through the effort lists.** `inherit` is added at `rpc-agents.types.ts:166` (CLI) and `:181` (Pi). The only backend consumer of both arrays is `invalidReasoningEffort` (`agent-rpc.handlers.ts:83-85`). That allowlist now accepts `inherit` and persists it, as the plan says.
   - Codex and Copilot: `resolveReasoningEffort` runs the value through `mapEffortToCli` (`agent-spawn-environment.service.ts:85-98`). `inherit` falls to `default` and returns `undefined`, so no effort is passed. This is safe, but it is a silent no-op until Task 6.1 and 6.3 resolve it to the chat effort.
   - Antigravity: `mapEffortToAgy` is unaffected. It does not read these lists.
   - Pi: `:122-130` returns the configured value raw, so `inherit` would reach `pi --thinking`. This is the known gap. It is recorded in `batches.md:84` (risk row, MEDIUM, "branch-only window, not shipped; PR must not merge before Batch 6 is COMPLETE") and in `batches.md:188` (follow-up 1, owned by Task 6.3), and Task 6.3 is at `batches.md:374`. There is no other Pi consumer: the grep shows `service.ts:126` is the only reader of `piReasoningEffort`. Nothing else breaks.
   - UI: the popover builds its options from the arrays (`cli-model-effort-popover.component.ts:25-27`), so `inherit` appears as a raw label until Batch 21. This is recorded at `batches.md:188` (follow-up 2) and `:1057`.
3. **Optional fields cannot cause a silent wrong value.** `codexAutoCompactTokens`, `codexToolOutputTokenLimit` and `codexWebSearch` are optional on `AgentOrchestrationConfig` (`rpc-agents.types.ts:121-125`) and `AgentSetConfigParams` (`:218-222`). Nothing reads them yet: the grep finds no reader outside the types, the key sets and the spec. The handler does not populate them, so a frontend reading `config.codexWebSearch` gets `undefined` until Batch 3. Batch 3 notes that the handler must always populate them (`batches.md:222`). The risk is a reader treating `undefined` as `false` or `0`. For `codexWebSearch`, `undefined` as false would disable search, and `0` means "runtime default" rather than "off". The JSDoc states those semantics (`:120-125`).
4. **Scoped keys match `codexModel`.** `rpc-auth.types.ts:417-428` uses `appScopable:false, supportedTargets:['global']`, the same shape as the neighbouring codex entries and `codexModel`.

## Five logic questions

1. **Silent failure.** Codex or Copilot set to `inherit` yields no effort, with no error and no log, until Task 6.1 lands (`service.ts:85-98`). Pi `inherit` is passed raw and the pi CLI will most likely reject it (`service.ts:122-130`). It is not silent, but it is a visible spawn failure, in a branch-only window.
2. **Unexpected user action.** A user can pick "inherit" in the popover (`cli-model-effort-popover.component.ts:25-27`) and see a raw label on a branch build. This is tracked as follow-up 2.
3. **Wrong-answer input.** The new numeric keys have no value validation in Batch 2. The "integer >= 0, rejected never clamped" rule appears only in a comment (`rpc-agents.types.ts:218-222`). Batch 3's handler must enforce it. A hand-edited settings file with `-5` or `"abc"` is not checked at the settings layer.
4. **Dependency failure.** Not applicable to a types and keys batch. If a host passes a different file-based key set, the keys would be unrouted. The plan lists this as AS14, and the spec guards the constants only.
5. **Missing, not in requirements.** `KNOWN_CONFIG_KEYS` in `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:72` does not list the three new keys, so they would not be in settings export or import. This is tracked as follow-up 3 and Task 3.1. Also missing is a test that every `FILE_BASED_SETTINGS_KEYS` entry has a `SCOPED_SETTING_KEYS` entry. Nothing mechanical guards the pairing, so a future key could be added to one and not the other.

## Failure modes

### Pi raw-pass of `inherit` (known, tracked)

- Trigger: `piReasoningEffort='inherit'` is saved, then a Pi lane is spawned.
- Symptom: `pi --thinking inherit` fails or is ignored.
- Evidence: `agent-spawn-environment.service.ts:122-130`, together with `rpc-agents.types.ts:181`.
- Current handling: none in code. It is recorded at `batches.md:84` and `:188` and owned by Task 6.3.
- Recommendation: keep the "no merge before Batch 6" gate. Task 6.3's spec should pin that Pi never receives `inherit`.

### Codex or Copilot `inherit` silently yields no effort

- Trigger: `codexReasoningEffort='inherit'` before Task 6.1.
- Symptom: the lane runs at the CLI default and the user's choice has no effect.
- Evidence: `service.ts:85-98` (default branch returns undefined).
- Current handling: safe fallback. Resolved by Task 6.1 and 6.3.
- Recommendation: none beyond the planned work.

## Moderate and minor issues

- Moderate: nothing in Batch 2 enforces the 0-or-greater integer constraint, which lives only in comments (`file-settings-keys.ts:467`, `rpc-agents.types.ts:218-222`). Batch 3 must validate and reject. The default-integer spec at `file-settings-keys.spec.ts:222-232` only checks the defaults.
- Moderate: optional types invite an `undefined` read. The handler in Batch 3 should fill the defaults on `agent:getConfig` (see `batches.md:222`), and readers should use `getConfiguration('ptah', key, default)` as the plan says at `implementation-plan.md:420`.
- Minor: the JSDoc for `CLI_REASONING_EFFORT_VALUES` (`rpc-agents.types.ts:158-162`) says `inherit` means "use the chat session's effort". Codex and Copilot already do that implicitly when the value is `''` (the UI effort wins, `service.ts:140-143`), so the distinction between `''` and `inherit` lives only in Task 6.1. Consider noting that in the comment.

## Data flow

1. UI writes via `agent:setConfig`. `invalidReasoningEffort` accepts `inherit` (OK, `agent-rpc.handlers.ts:289`). The new numeric and boolean params are not yet handled (Batch 3).
2. `setAgentCfg` persists. The file-based routing now includes the 3 new keys (OK, `file-settings-keys.ts:165-167`).
3. Reads fall back to the defaults at `:468-470` (OK).
4. The spawn path reads effort. Codex and Copilot drop `inherit`. Pi passes it raw (the known gap).

## Requirements fulfilment

| Requirement                                                    | Status   | Gap                                    |
| -------------------------------------------------------------- | -------- | -------------------------------------- |
| Three keys, defaults 120000, 2500, true                        | COMPLETE | none                                   |
| Keys file-based, routed                                        | COMPLETE | `KNOWN_CONFIG_KEYS` pending (Task 3.1) |
| `inherit` in both effort arrays                                | COMPLETE | Pi and UI handling pending (6.3, 21.3) |
| Scoped-key entries                                             | COMPLETE | none                                   |
| Types on `AgentOrchestrationConfig` and `AgentSetConfigParams` | COMPLETE | optional, so the handler must populate |

Implicit requirements not addressed: value validation (Batch 3), a key-set pairing test.

## Edge cases

| Case                                  | Handled | How                        | Concern          |
| ------------------------------------- | ------- | -------------------------- | ---------------- |
| Key unrouted, so the write is dropped | YES     | spec asserts membership    | none             |
| Missing default                       | YES     | `hasOwnProperty` assertion | none             |
| Negative or non-integer value         | NO      | Batch 3                    | enforce reject   |
| `inherit` for Codex or Copilot        | PARTIAL | falls back to no effort    | silent until 6.1 |
| `inherit` for Pi                      | NO      | raw pass                   | tracked in 6.3   |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Pi `inherit` reaching `--thinking` raw before Task 6.3, which is tracked and gated to the branch only.
- A robust implementation would add: validation for the numeric keys at the handler, a key-set pairing test between `FILE_BASED_SETTINGS_KEYS` and `SCOPED_SETTING_KEYS`, and a Pi-never-receives-`inherit` spec in Task 6.3.

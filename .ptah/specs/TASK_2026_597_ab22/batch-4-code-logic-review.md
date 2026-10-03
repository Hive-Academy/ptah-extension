# Code Logic Review — TASK_2026_597 Batch 4 (Codex adapter on the SDK path)

Paths are relative to `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.

## Summary

| Metric        | Value                                   |
| ------------- | --------------------------------------- |
| Overall score | 7/10                                    |
| Assessment    | NEEDS_REVISION (one Serious, small fix) |
| Blocking      | 0                                       |
| Serious       | 1                                       |
| Moderate      | 4                                       |
| Minor         | 2                                       |

Scope read in full: `codex-cli.adapter.ts` (`runSdk`, 455-770), `codex/codex-lane-budgets.ts`, `codex-exec-args.ts`, `codex-config-rejection.ts`, `codex-model-rejection.ts`, `codex-native-binary.ts` (version part), and the `cli-adapter.utils.ts` diff. Specs were not re-run. The builder is Batch 1 and was only grepped for entry keys.

## Five logic questions

1. **Silent failure.** The F10 model matcher replaces the real Codex error text with a settings hint and does not log the original (Serious 1). The retry drops `model_reasoning_effort`, and the notice names only budget keys (Moderate 1).
2. **Unexpected user action.** A broken user `~/.codex/config.toml` produces "Error loading config.toml". That matches the rejection pattern, so the lane drops its own budget and prefix keys for the whole run, including `continue()` turns, to no benefit (Moderate 2).
3. **Input giving a wrong answer.** Budgets are validated correctly. `-0` is normalised, and a float, string, negative, `Infinity`, `NaN` or above-`MAX_SAFE_INTEGER` value falls back to the default with a warning (`codex-lane-budgets.ts:58-85`). I found no wrong-answer path. An absent `laneBudgets` gives 120000 / 2500 / true silently, as specified.
4. **Dependency failure.**
   - Config rejection: the retry is bounded to one extra attempt. `configRejected` is set before the retry, so a second rejection is a normal error (`adapter:698-733`). No infinite loop.
   - Model rejection: never retried, which is correct.
   - Binary version: a missing or unparsable `package.json` falls back to one cached probe.
   - Argv guard: an over-long argv throws from `runSdk` on a spawn. On a `continue()` turn it is caught inside `runAttempt` and reported as an error segment (`adapter:668-720`).
5. **Missing from the requirements.** The retry does not distinguish "the user's own Codex config is broken" from "our overrides are bad". The model-rejection text is not constrained to a terminal event.

## Failure modes

### Model matcher swallows the real error

- Trigger: any `turn.failed` or `error` event whose text has "model" within 120 characters of "not available", "not supported", "unsupported" or "does not exist". Examples: "model is not available right now" (capacity), or a `reconnecting` notice.
- Symptom: the user sees "Codex rejected `gpt-6-sol`, Ptah's lane default. Set `agentOrchestration.codexModel`…". The real cause is hidden.
- Evidence: `adapter:617-625` (`modelRejection`) and `adapter:655-664`, which skips `handleStreamEvent` and discards `event.error.message`. The pattern is at `codex-model-rejection.ts:13-14`.
- Current handling: the original text is neither logged nor appended.
- Recommendation: log the original text at WARN (redacted, truncated) and append a short excerpt to the message. Narrow the pattern, for example require `model_not_found` or an "unsupported ... model" shape, or scope it to `turn.failed`.

### Retry drops reasoning effort

- Trigger: any config rejection while `reasoningEffort` is set.
- Symptom: the lane runs at Codex's default effort. The notice says only "lane budget key".
- Evidence: `ESSENTIAL_ENTRY_PREFIXES` at `codex-config-rejection.ts:60-65` omits `model_reasoning_effort=`. The builder emits it at `codex-lane-config.builder.ts:133`.
- Recommendation: keep it in the essential set (it is a plain enum) or name it in the notice.

### Sticky essential-only mode after a user-config failure

- Trigger: the user's own `config.toml` is invalid, so stderr is "Error loading config.toml…".
- Symptom: after the retry also fails, the error is shown, and every later `continue()` turn on the handle runs without budgets or prefix keys (`adapter:515-518`). The notice misattributes the cause.
- Evidence: `codex-config-rejection.ts:34-35` and `adapter:698-703`.
- Recommendation: reset `configRejected` if the retry fails, since the retry proved the cause is not ours. Or accept this as documented.

## Blocking issues

None.

## Serious issues

### S1. F10 matcher is broad, replaces the error, and logs nothing

See "Model matcher swallows the real error" above.

- File: `codex-model-rejection.ts:13-14`; `adapter:617-625`, `adapter:655-664`.
- Impact: misdiagnosis on a likely path, because capacity and "not available" errors are common. The user is told to change a setting that is fine, and the true error is unrecoverable from the log.
- Fix: as above.

## Moderate issues

1. Reasoning effort is silently lost on retry (`codex-config-rejection.ts:60-65`). **Can break a lane config**: the lane's reasoning-effort setting is not honoured for the rest of the run.
2. The sticky retry state persists even when the failure was the user's own config, and the notice is misleading (`adapter:501`, `adapter:698-703`). **Can break a lane config**: budgets and prefix keys stay dropped on every later turn, which costs tokens but does not lose data.
3. The `mcp_servers={...}` user-server entry is dropped on retry (intended), so the user's MCP servers then start. Nothing reaches the log or notice saying "user servers re-enabled" (`adapter:99`, `codex-config-rejection.ts:60-65`). **Can break a lane config**: servers the lane meant to disable run and add tools and tokens. No data loss.
4. The rejection matcher includes the bare alternates `invalid configuration` and `-c/--config` (`codex-config-rejection.ts:34-35`). They are gated on "no event received" and on the SDK exit prefix, so the worst case is one harmless retry. **Cannot lose data.**

## Minor

- `logLaneWarnings` stops deduping after 256 entries and then warns on every spawn (`adapter:758-768`). Unlikely in practice.
- The notice is also emitted into the output stream (`adapter:708`) as well as the info segment, so a UI that renders both shows it twice.

## Verified correct

- **Override precedence.** Thread options are limited to the four keys (`adapter:495-500`), and each turn builds a fresh `Codex` with `configOverrides`. `codexExecArgs` mirrors the SDK argv order, so the guard measures the real command, including `--model` and `--cd`. Guard calls: `adapter:529-538` and `adapter:553`.
- **Retry bound.** `runTurn` makes at most two attempts. `receivedEvent` blocks a retry after any model event. Abort is re-checked before the retry (`adapter:730`).
- **Resume.** A `resumeSessionId` spawn and `continue()` use the `resume` variant. H4 flags come from `fullPromptPreambles(options)` and are consistent with what the first prompt carried. The resume-spawn case passes nothing, so both blocks are kept.
- **Startup watchdog.** The timer is cleared in `finally` (`adapter:600-612`).
- **Resource cleanup.** The SDK `finally` still kills the child on a `turn.completed` return.

## Data flow

settings → `resolveCodexLaneBudgets` (OK, validated, one warning per key per adapter) → `buildCodexLaneConfig` (OK) → guard over the whole argv (OK) → `new Codex({configOverrides})` → events → `modelRejection` (gap S1) → retry on rejection (gaps M1, M2).

## Requirements fulfilment

| Requirement                                                                  | Status   | Gap                                        |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| Thread options limited to four keys, dead flag removed                       | COMPLETE | none                                       |
| Per-turn `Codex` with resume variant                                         | COMPLETE | none                                       |
| One retry with essential keys, user-server entry dropped                     | COMPLETE | reasoning effort also dropped (M1)         |
| WARN with redacted excerpt of at most 200 chars, info segment, state exposed | COMPLETE | none                                       |
| F10 message, no model retry                                                  | PARTIAL  | matcher too broad, original text lost (S1) |
| Budget validation with default fallback and one warning per key              | COMPLETE | none                                       |
| Whole-argv guard (H6)                                                        | COMPLETE | none                                       |
| H4 per-block flags                                                           | COMPLETE | none                                       |
| Reader and builder warnings go to the logger, not the stream                 | COMPLETE | none                                       |

Implicit requirements not addressed: none beyond the above.

## Edge cases

| Case                                   | Handled | How                   | Concern           |
| -------------------------------------- | ------- | --------------------- | ----------------- |
| Second rejection                       | YES     | normal error          | none              |
| Abort during retry                     | YES     | `adapter:730`         | none              |
| `-0`, float, string or negative budget | YES     | default plus warning  | none              |
| Missing `package.json`                 | YES     | probe, cached         | none              |
| Argv too long on a `continue()` turn   | YES     | caught, error segment | none              |
| User config broken                     | PARTIAL | one retry, then error | sticky state (M2) |

## Verdict

- Recommendation: REVISE (small, targeted)
- Confidence: MEDIUM-HIGH. I did not run the specs.
- Top risk: the F10 matcher can replace an unrelated Codex error with a misleading settings instruction and leaves no trace of the original.
- What a robust implementation would add: log the original model-rejection text; narrow the pattern; keep reasoning effort in the retry's essential set; reset the sticky state when the retry also fails.

## Re-review (fix round 1)

Scope: the fixes only (S1, M1, M2, M3). Read `codex/codex-model-rejection.ts`, `codex/codex-config-rejection.ts` and `codex-cli.adapter.ts` (lanes 510-540, 635-790). No suites re-run.

| Finding                                   | Status | Evidence                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1 matcher too broad / original text lost | FIXED  | Pattern drops bare "unsupported", "not supported" and "not available" (`codex-model-rejection.ts:18`). Only terminal `turn.failed` is matched (`adapter:641`), so reconnect/capacity `error` events take the normal path. The message ends with `Codex said: "<excerpt>"`, redacted and capped at 200 chars, and a WARN logs `codexError`. |
| M1 effort dropped on retry                | FIXED  | `model_reasoning_effort=` is in `ESSENTIAL_ENTRY_PREFIXES` (`codex-config-rejection.ts:63`).                                                                                                                                                                                                                                               |
| M2 sticky essential mode loses budgets    | FIXED  | When the essential attempt is rejected too, `essentialAfter` is cleared and the failure goes through the normal error path with the real text (`adapter:730-738`). `onLaneConfigRejected` fires once. The cost is two cheap failed spawns per turn on a permanently broken user config, which is accepted and documented.                  |
| M3 user MCP servers re-enabled silently   | FIXED  | The `mcp_servers={...}` disable entry is kept on the retry. It is dropped only when stderr names a non-ptah `mcp_servers.<name>` key (`codexRejectionNamesUserServer`). In that case the WARN, the info segment and the stream notice all say user servers are enabled (`adapter:742-760`).                                                |

No new Blocking or Serious defect found.

### New Moderate (non-blocking)

- `codex-model-rejection.ts:18`: the verdict gap `[^\n.]{0,80}?` cannot cross a `.`, so dotted model names miss. Checked: "The model `gpt-5.1-codex` does not exist or you do not have access to it." does not match, and neither does "The model `gpt-5.1` does not exist". The "'gpt-5.1-codex' model is not supported" form does match. Impact is limited because a miss falls to the normal `turn.failed` path, so the original Codex text is still shown. Only the "set `agentOrchestration.codexModel`" advice is lost, and only for the "model `x` does not exist" wording. Fix: allow dots inside a backtick or quoted token (e.g. `(?:`[^`]*`|'[^']*'|[^\n.]){0,80}?`) and add a spec case with `gpt-5.1`. The current spec uses `gpt-6-sol`, which has no dot.

### Verdict

APPROVED. 0 Blocking, 0 Serious, 1 new Moderate (dotted model names missed by the matcher).

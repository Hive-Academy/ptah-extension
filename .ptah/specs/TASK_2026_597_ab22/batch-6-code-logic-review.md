# Code Logic Review — Batch 6 (TASK_2026_597_ab22)

Scope: lane-spawn-policy.ts (read in full), agent-spawn-environment.service.ts and agent-process-manager.service.ts (diff plus surrounding code), cli-adapter.utils.ts, the shared type change, and all callers of resolveModel, resolveReasoningEffort and SpawnAgentRequest.systemPrompt. No tests re-run; I relied on the developer's reported pass counts.

## Verdict: APPROVED, 0 Blocking, 0 Serious, 2 Moderate, 3 Minor. Score 8/10.

## Checked and found correct

- **Precedence (R2.3).** `resolveLaneEffort` (lane-spawn-policy.ts:103-143) implements steps 1-6 in order. An unaccepted setting counts as empty, so steps 4 and 5 still apply. `inherit` takes step 3 and does not re-offer the same chat value at step 5 (:137).
- **`inherit` never reaches a CLI raw.**
  - Pi: `mapEffortToPi` (:195-200) rejects `''` and `inherit` and allowlists against `PI_REASONING_EFFORT_VALUES`. Pi now goes through the policy, so `pi --thinking inherit` is closed.
  - Codex and Copilot: `mapEffortToCli` has no `inherit` case, so it returns undefined.
  - Antigravity: `mapEffortToAgy` also returns undefined for it.
  - The adapters re-allowlist as a second guard (codex-cli.adapter.ts:487-493, antigravity :273).
- **Model default.** `resolveLaneModel` (:34-45) applies the request, then the setting, then `gpt-6-sol` for Codex only, then the CLI default. `resolveModel` skips the settings read when a request model exists, which is correct. `modelSource` reaches the Codex adapter (agent-process-manager.service.ts:376; used at codex-cli.adapter.ts:645).
- **Lane budgets.** `resolveLaneBudgets()` is called for Codex only (manager :307-308) and passed as `laneBudgets` (:389). The adapter validates them via `resolveCodexLaneBudgets` (codex-cli.adapter.ts:483). A null read falls back to the defaults.
- **Config-rejection callback.** `onLaneConfigRejected` is subscribed after `runSdk` returns. The adapter's emitter is buffered (`createBufferedEmitter`, codex-cli.adapter.ts:598), so a rejection that fires before subscription is not lost. The `?.` call is safe for adapters without the hook.
- **Log line leaks nothing.** Fields are agentId, cli, model, modelSource, effort, step, ignored effort strings, codexVersion and prefixKeys. No env, args, tokens, prompt or path appears (manager :346-367).
- **`systemPrompt` removal.** No remaining producer of `SpawnAgentRequest.systemPrompt` exists in source.
  - Grep results for `systemPrompt` in libs/apps are the Claude chat and ptah-cli paths (a different type, untouched), plus prompt-harness and test fixtures.
  - agent-namespace.builder.ts:284-312 no longer fetches it (Batch 5).
  - The only caller path left is a caller-supplied field via `ptah.agent.spawn` (see Moderate 1).
- **Buffer-over-limit and prompt cap.** `buildTaskPrompt` now uses `projectGuidance` only, so the guidance cap cannot be bypassed.

## Moderate

1. **A caller-supplied `systemPrompt` is now silently dropped.** agent-namespace.builder.ts:304-312 spreads `...requestFields`, so a JS or `execute_code` caller doing `ptah.agent.spawn({systemPrompt})` still passes the field to `spawn`. Before this batch it reached `buildTaskPrompt` and was prepended. Now the manager ignores it and nothing warns. TypeScript callers get a compile error, but `execute_code` callers are untyped.
   - Breaks a lane config or loses data? No crash, and the field is documented as "NOT set by callers". Such a caller does lose its custom prompt without any signal.
   - Fix: destructure and drop `systemPrompt` (like `roleDefinition`) with a one-line warn, or accept it as intended and note it in the tool description.
2. **Pi lanes now follow the chat effort when the Pi setting is empty (step 5).** Before, Pi ignored the chat effort entirely (removed comment: "no in-chat driver"). Reviewer and tester Pi lanes now get `medium`, and every other Pi lane gets the chat effort including `max`/`xhigh`.
   - Breaks a lane config or loses data? No. Cost can rise for existing Pi users who never set an effort. The executor recorded it, and batches.md lists "pi and antigravity follow R2.3" as intended. Confirm in the release notes.

## Minor

1. manager :362-364 hard-codes `prefixKeys: 'applied'` and logs it before `runSdk`. If `runSdk` throws, or the Codex version check only warns, the line still says "applied". The rejection re-emit corrects the rejected case only. Treat the field as intent, not outcome.
2. manager :355-358 echoes the raw, unbounded spawn `effort` string into `ignoredEfforts`. A hostile or garbage value gives a long log line, and a non-string (execute_code) gives `[object Object]`. Truncate it or `String(...).slice(0, 32)`. No secret exposure.
3. lane-spawn-policy.ts:78-81 `isReviewerOrTester` is case-sensitive and exact. A role named `Code-Reviewer` or `reviewer` misses the step-4 default and falls through to the chat effort. This matches R2.4 as written.

## Five questions

1. **Silent failure:** an ignored effort is logged but the spawn succeeds (intended). The dropped caller `systemPrompt` is Moderate 1.
2. **Unexpected user action:** setting Pi to `inherit` with no chat effort gives the CLI default (OK). A Codex setting of `off` is ignored and falls to the chat effort, not an error.
3. **Wrong answer from input:** Codex or Copilot setting concrete `high` now beats the chat selector (a deliberate reversal, with the routing spec rewritten).
4. **Dependency failure:** unset or null settings fall back to defaults. `detection.version` undefined logs as `unknown`.
5. **Missing:** no validation of `request.effort` type at the namespace boundary, which Batch 7 may cover.

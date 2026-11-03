# Code Logic Review - CI fix round r1 (TASK_2026_862_bf84)

Implementer family: codex
Review family: Claude subagent (lanes at limit)
Verdict: APPROVED

Scope: uncommitted diff on top of HEAD (`git diff HEAD`) for the 16 specs and the product files select-codex-executable.ts, codex-context.ts, codex-chat-turn-stream.ts, codex-history-projector.ts, pricing.utils.ts, cost-badge.component.ts and the protocol schema files. No tests or builds were run (read-only review).

## Findings

1. **Minor** - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:205`
   The new rule "item/completed that translates to nothing and is not `sleep` is an `unsupportedItem` skip" is broader than the translator. A `userMessage` item without a `content` array falls through to `emit` (line 273) and the translator returns `[]` for it (`codex-event-translator.ts:537`), so it is reported as skipped. Future item types also reach this rule, which is the intent (the existing spec at history-projector.spec.ts:467 covers it and was not touched). Impact is limited to a skippedItems entry and a skippedCount, never to lost content. Suggested fix: also exempt `userMessage` (and any other known item the translator intentionally maps to `[]`).

2. **Minor** - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:203-208`
   MCP secrets are cleared in `finally` after `retryFirstTurn`, after the first receipt (line 208), and in `drainInterruptedTurn`'s finally (line 704). They stay available for exactly the one bundled retry, as required. Gap: if the first `startTurn` throws something that is not a retry candidate, `session.secrets` stays in memory until the session is dropped or drained. This is a bounded exposure, not a functional defect. Suggested fix: clear in the outer error path as well.

3. **Minor** - `libs/backend/codex-runtime/src/lib/select-codex-executable.ts:152-245`
   Version cache keyed by path, validated by `mtimeMs` and `size`, one entry per path (bounded by the number of candidate paths), and only successful parses are stored (a failed parse deletes the entry). An in-place upgrade changes mtime, so no stale version. `stat` runs before the cache lookup, so a deleted binary still fails as before. Residual: an upgrade that preserves both size and mtime is theoretically stale; negligible. The `parsedVersion` field is stored and never read (dead data), and `promisify(execFile)` is rebuilt per call (cheap; deliberately lazy so jest mocks of `execFile` apply). Suggested cleanup only.

4. **Minor** - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` (new "does not label a terminal without model or usage evidence" test)
   Asserts `expect.not.objectContaining({ costUnavailableReason: 'rate-missing' })` only. It does not pin the positive value (`usage-incomplete` or `billing-unknown`). pricing.utils.spec.ts does pin `usage-incomplete` for the empty-model and zero-usage cases, so coverage exists at the unit level.

5. **Minor** - `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`
   An expectation changed from path `['data',0,'item','agentsStates','[redacted]','status']` / `invalid_value` to `['data',0,'item']` / `custom`. This reflects the tolerant item parsing (diagnostic is coarser), and the frame is still rejected. Acceptable, but diagnostic precision for operators dropped.

## Checks performed

1. Test changes: no `.skip`, `xit`, `xdescribe` added. The only `expect.anything()` is the second argument of `lifecycle.opened` in the replaced closed-gate test, which now asserts `open` was called once and the session resolves. The replaced "closed gate refuses" test matches the removal of the gate on this branch (a deliberate behavior change, not a hidden defect). Static-model-list tests were rewritten to assert the live-catalogue behavior (`resolveStoredModel` returns `'default'`, saved model not offered), consistent with the stated removal of static lists. Version bumps 0.162.0 to 0.165.0 follow the new minimum. Model-list request counts moved 2 to 3 and 100 to 101 consistently with one extra catalogue request; the "no model/list after close" check now compares against the pre-close count, which still proves no further request. New tests were added (secret clearing, unsupported-method refusal for -32601 and -1, no-rate-label, empty-model pricing). No assertion was found that hides a real product defect.
2. Product changes:
   - codex-context.ts:197, 709, 772-777: `CodexUnsupportedMethodError` is treated as refused (follow-up rejected event, warning cause `refused`). Any other error still goes to `onFailure()` / cause `failed`; the tests keep the `different-turn` case as `failed`. Correct.
   - pricing.utils.ts: empty model id returns `usage-incomplete` before lookup; unknown model with invalid or all-zero unobserved usage returns `usage-incomplete`; unknown model with real usage returns `rate-missing`; the valid-usage-but-model-id-mismatch path still returns `rate-missing`. Matches the requirement. Billing `unknown` still takes precedence.
   - cost-badge.component.ts: tooltip wording changed only; the spec asserts the exact new text.
   - Protocol schema edits add `.catch(undefined)` drops with `degradation-audit` markers; no swallowed error without a marker.
3. Hygiene: no `console.*`, no new `any`, no `as unknown as`, no non-null `!` in the added lines of `libs/`. `catch {}` blocks carry audit comments.

## Conclusion

No Blocking or Serious defects. Five Minor items listed above can be handled opportunistically.

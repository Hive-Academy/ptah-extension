# Code Logic Review - TASK_2026_714_c8a2 / Batch 10d.P-C1, revise round 1

Review family: claude (in-process subagent)
Implementer family: codex (coordinator two-line correction: claude)

Scope: read the adapter `openContext` section (`codex-app-server-lane.adapter.ts:296-332`), the full git diff of `codex-app-server-lane.adapter.spec.ts`, the C1 report "Revise round 1", and the proof rows, header, Decision 2 and Decision 4 that changed. I also grepped the spec `it(` lines to verify the proof's line references. Nothing was executed. I rely on the coordinator's statement that typecheck, lint and the cli-agent-runtime test target succeeded on Windows after these edits. I did not re-read the rest of the proof.

## N1-N4 status

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| N1 full binding with no callback proceeds silently | Fixed | `codex-app-server-lane.adapter.ts:318-325`: the guard is now `!binding \|\| !bindingId \|\| !onAccountBinding`, evaluated inside `if (accountBinding !== undefined \|\| accountBindingId !== undefined)`. A callback call can no longer be skipped for a bound run. Default account (both fields absent) still skips. The `?.` is gone, so the call needs no optional chaining. This now matches `claude-cli.adapter.ts:327-334`: any binding field without the means to honor it refuses. |
| N2 proof gap and stale header | Fixed | Proof row 58 "Account binding / default-account start" (proof line 58) records A:289-338 as an initial FAIL, the C1 fix at `N/codex-app-server-lane.adapter.ts:318-325`, the spec lines `246-255, 257-273, 294-322`, and "named-account manager path PENDING-LIVE". The header (line 3), the live-run text (line 80), Decision 2 (line 94) and Decision 4 (line 96) record the coordinator's Windows run and pending Linux CI. |
| N3 identity persisted before the binding check | Documented, no code change | Persist at `:317` still precedes the binding check at `:318`. The existing spec pins the `open, persist, binding` order (`...adapter.spec.ts:257-273`). Accepted as low impact in my last review. |
| N4 partial refusal without callback untested | Fixed | `...adapter.spec.ts:306-314` covers both partial variants with no callback. `:316-322` covers a full binding with no callback (the N1 case). Both assert the rejection message, zero prompt inputs and `close` called once. |

## Required checks

1. Specs can fail on their target bug. The full-binding-no-callback case (`:316-322`) would fail against the previous `?.` code, which resolved and started the prompt (`inputs` would have length 1 and the promise would not reject). The partial-no-callback case (`:306-314`) would fail against the original callback-gated guard, which skipped the check when the callback was absent. The with-callback partial case (`:294-304`) and the default-account case (`:246-255`) are unchanged and still guard the C1 over-skip and the original defect.
2. Context closes once on each refusal. All refusals throw inside `openContext`, which is invoked from the try block at `:350-365`. A non-config error goes to `await close()` and rethrows (`:361-364`). `closeContext` memoizes the close per context in a WeakMap (`:236`, `:266-272`), and the abort listener at `:292` uses the same memoized path. All four new and changed refusal tests assert `close` toHaveBeenCalledTimes(1) and empty `inputs`, with a fresh harness per iteration in the loop cases.
3. Proof row and references. The new row is at proof line 58. `it(` lines are at spec 246, 257, 294, 306, 316 and the next case begins at 324, so `246-255`, `257-273` and `294-322` are exact. A:289-338 still matches (checked last round). The legacy citation `codex-cli.adapter.ts:909-927` shows a handle returned without a binding callback, consistent with the row's claim. The shifted references at proof lines 17, 31 and 59 were not re-read in full.

## New defects

### N5 (minor) Header still lists the revise-round cases as unexecuted

Proof line 3 and Decision 4 (line 96) say the "new revise-round adapter cases" and Linux CI remain pending. The coordinator has run the whole target after these edits (typecheck and lint 2 of 2, test 1 of 1). The claim is conservative, not wrong, but it will read as stale. Fix: when the coordinator records this run, drop "revise-round adapter cases" and keep "Linux CI".

### N6 (minor) The signature of a refused binding is a generic Error

`:319-320` throws a plain `Error('Codex lane account binding is incomplete')` for the partial case and the missing-callback case, so a caller cannot tell the two apart and the missing-callback case reads as a data problem. The text contains no path, secret or setting value, so nothing leaks. Optional: a typed error with a code, as in `file-settings-errors.ts`. No behavior change needed for activation.

No blocking or moderate defect. Manager callers: `agent-process-manager.service.ts:875` always supplies the callback, so the stricter guard cannot break the manager path. The only other `accountBinding` producers in this lib are in the manager (`:2170-2177`), where the callback is also passed. No `any`, `as unknown as`, `@ts-ignore` or `eslint-disable` were added in the diff (the earlier grep stands, and the new spec lines use typed `ProviderAccountBinding` and `jest.fn`). Paths and portability are unchanged from last round. MCP handling was not touched.

## Score

9/10. Verdict: APPROVED. The production fix now matches the Claude adapter's rule on all three input shapes (neither, partial, full-without-callback), every refusal closes the context once, the new specs fail on the bugs they target, and the proof records the finding with correct references. The remaining 1 point is the two minor items (N5, N6) plus the fact that a named-account run through the real manager into the native adapter is still only PENDING-LIVE, which the proof states.

## Decisions

1. Approve C1 as revised. Evidence: adapter `:318-325`, spec `:246-322`. Reversible.
2. Leave N3 as documented. It does not alter a user-visible outcome.
3. N5 and N6 are optional follow-ups and do not hold the gate. The proof stays unsigned pending Linux CI and live observation, as it already says.

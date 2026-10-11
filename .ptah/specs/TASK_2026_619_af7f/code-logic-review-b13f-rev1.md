# Code Logic Review - TASK_2026_619 Batch 13f revision 1

Verdict: APPROVED. Score 8/10. Blocking 0, Serious 0, Moderate 1, Minor 3.

Scope: read in full `rg-runner.ts`, `gate.ts` (outcome union, `decidingOf`, `decidingBaselineError`, `claimResult`), `baseline.ts` `recordedResult`, `suite-runner.ts` `listFailures` and `assembleSuite`, `call-recorder.ts` classifier, and `main.ts:253-270`. I did not read the spec bodies line by line. The diff file is UTF-16 and was truncated by the reader, so I reviewed the worktree sources directly. Jest results were not checked, per instructions.

## Prior findings

| Prior finding | Status | Evidence |
| --- | --- | --- |
| SERIOUS-1: recorded-failure gate ignored a broken deciding baseline | FIXED | `decidingBaselineError` is exported from `gate.ts:366` and shared. `recordedResult` calls it first (`baseline.ts:163-168`), before the `new` early return, and returns the failing `over-baseline-error-rate` outcome. That outcome is already in `FAILING_OUTCOMES` (`gate.ts:356`) and in the `SuiteOutcome` union (`gate.ts:341`), so reasons and rendering are unchanged. |
| MODERATE-2: preflight lost its cause | FIXED | `assertRgRuns` (`rg-runner.ts:65-78`) puts the spawn, exit or timeout detail in the message and keeps `{ cause }`. It still names RG_PATH. |
| Lifecycle-only runs need rg | JUSTIFIED, NOT FIXED | `runBench` builds the runner at `main.ts:264`, before `filter` is read (`:269`). The preflight does run before any host starts. Making it conditional means restructuring `NativeContext` construction, which is out of scope for 13f. A one-line note in `decisions-s6.md` would be enough. |
| Quoted RG_PATH | FIXED | `rg-runner.ts:41-46` strips one surrounding quote pair after trimming. See MINOR-1. |
| Native errors not deduplicated | FIXED | `suite-runner.ts:490,518-520` dedupes by `native.id` plus the error text, so one entry per distinct error per baseline, inside the existing budget. |
| Non-deciding native error must not fail the suite | PINNED | `assembleSuite` (`suite-runner.ts:594-603`) only reads the decider's error rate. Spec added. |
| Dead `UNKNOWN_REASON` | FIXED | Removed. `hasUnknownReason` is the only path (`call-recorder.ts:154`). |
| main.ts max-lines warning | FIXED | Single `createCheckedRgRunner` call at `main.ts:264`. |
| Native error text hidden behind 25 tool failures | NOT FIXED, ACCEPTED | Tool entries still take the budget first (`suite-runner.ts:491-511`). The `(verdict)` entry still names the baseline rate, so the verdict is not lost. |

## Regression check

- **Gate outcome union and rendering.** No new outcome was introduced. The same outcome string is produced by two paths and covered by the existing failing set. The note text is identical in both paths.
- **Recorded mode without a deciding baseline.** `decidingOf` returns null for `na` suites and for arm suites (`gate.ts:145`), and `decidingBaselineError` returns null for them. A null `error_rate` also returns null. So `na` and not-compared suites keep their old recorded behaviour. Healthy and null rates fall through to the delta comparison. I found no regression here.
- **A new suite with a broken baseline is now rejected rather than reported `new`.** This is stricter but consistent with the batch text.
- **Recorded mode now fails even when the recorded baseline had the same fault.** The run is rejected until the baseline is fixed, which is correct. It does mean a broken baseline can never be re-recorded as a pass.
- **Dedupe.** The key uses a NUL separator between native id and message, so there are no cross-baseline collisions. The first occurrence's question id is shown, which is fine. The second loop is bounded by `MAX_LISTED_FAILURES`.
- **`createCheckedRgRunner` error path.** Rejections from `resolveRg` (throws synchronously inside the async function, so it becomes a rejection) and from `assertRgRuns` propagate out of `runBench` before `mkdtemp` or any host start. No resource is leaked. `main` turns the rejection into exit 1. The preflight timer is cleared in `settle` on every branch. `runRgVersion` has no `data` listeners (`stdio: 'ignore'`), so the child cannot block on a full pipe.
- **Classifier.** The behaviour matches the 13f.1 rules. Explicit `?` other than `unrecognised?` is unknown. A full array of 3 is unknown only when its last reason is unlisted or ranks before `resolution?`. Shorter arrays imply nothing. A cut array stays unknown through the start-count versus array-count comparison (`call-recorder.ts:171`). Non-string and unparsable entries are unknown.

## New findings

### MODERATE-1: the recorded-mode gate is stricter than a re-record can recover from
- File: `gate/baseline.ts:163-168`.
- Scenario: a committed baseline was recorded with a deciding native error rate over 1%. The gate then fails every run on that suite with `over-baseline-error-rate`, while the recorded scorecard itself still carries the broken numbers.
- Impact: this is the intended outcome, and the fix is to repair the native. The note text does not tell the operator that a re-record cannot be taken with a broken native. It is a documentation gap, not a logic defect.
- Fix: add a sentence to `decisions-s6.md` or to the note text, for example "fix the native baseline before re-recording".

### MINOR-1: RG_PATH of a single `"` becomes an empty string
- File: `rg-runner.ts:43-45`.
- Scenario: RG_PATH is set to just `"`. `startsWith` and `endsWith` both match, `slice(1, -1)` returns `''`, and the preflight then fails at `spawn('')` with a message naming an empty path.
- Impact: still fails loudly with RG_PATH named, so low.
- Fix: require `value.length >= 2` in the strip condition.

### MINOR-2: `where rg` on win32 with no `.exe` candidate
- File: `rg-runner.ts:54-56`.
- Scenario: only a `.cmd`, `.bat` or extensionless shim is found. The code throws "Unable to find ripgrep", which is the right failure for a shell-free spawn. The message does not say the candidates were ignored for lacking `.exe`.
- Fix: optional, mention the ignored non-`.exe` candidates in the error.

### MINOR-3: `nativeMetrics(decider, records)` is computed twice in `assembleSuite`
- File: `suite-runner.ts:595,608`.
- Impact: duplicate work only, no behavioural effect.
- Fix: hoist it to one local.

## Five logic questions

1. **Silent failure.** The b13e scenario is now loud in the suite verdict and in the gate in both claim and recorded modes. The remaining quiet spot is a baseline error behind 25 or more tool failures, where the error text is not listed but the verdict entry still names the rate.
2. **Unexpected user action.** `--suite lifecycle` still needs rg because of the `runBench` structure (justified above).
3. **Wrong answer rather than error.** I found no input where the classifier says known and the product meant unknown. The smoke-sample flakiness of the 1% policy is by spec.
4. **Dependency failure.** rg missing, broken or hung fails before any host start, with the cause kept.
5. **Missing.** Nothing beyond the notes above.

## Verdict

APPROVED, 8/10, confidence MEDIUM-HIGH (Jest results unchecked here). The two substantive prior findings are closed with specs, and the revision introduced no behavioural regression. The score is not 9 because the lifecycle-only preflight and the budget-hidden native error text remain as accepted trade-offs, and the one-quote edge case in RG_PATH handling is still open.

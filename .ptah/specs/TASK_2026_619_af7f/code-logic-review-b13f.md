# Code Logic Review - TASK_2026_619 Batch 13f

Verdict: REVISE. Score 7/10. Blocking 0, Serious 1, Moderate 4, Minor 4.

Scope: read in the 619 worktree (`tools/mcp-bench/src`): `transport/call-recorder.ts` and its spec, `suites/suite-runner.ts`, `gate/gate.ts`, `gate/baseline.ts`, `scorecard/retrieval-suite-kind.ts`, `baselines/rg-runner.ts`, `main.ts`. Also `platform-core/.../language-coverage.interface.ts`, `mcp-response-formatter.ts` (compact coverage), and the grep of every `withCoverageVerdict` emitter. Read/Grep only; nothing was run. Line numbers for `suite-runner.ts` and `gate.ts` come from Grep, because the Read output elided lines.

Reasons for 7 and not 8: the classifier and the rg preflight are sound. The deciding-baseline error rule is only wired into claim mode, and the gate's default mode (`recorded-failure`) does not apply it.

## Five logic questions

1. Silent failure.
   - The b13e scenario (every native rg spawn failing) is now loud in the suite verdict (`suite-runner.ts:591-598`) and in claim-mode gate (`gate.ts:429-444`).
   - It is still silent in the gate's default mode. See SERIOUS-1.
   - The preflight swallows the underlying cause (`rg-runner.ts:66`, bare `catch {}`). See MODERATE-2.
2. Unexpected user action.
   - `--suite lifecycle` or `--compare` runs now need rg, because `assertRgRuns` runs unconditionally at `main.ts:268-269`.
   - RG_PATH set with surrounding quotes (`"C:\Program Files\rg.exe"`) is passed to spawn verbatim and fails. The message does name RG_PATH.
3. Wrong answer rather than error.
   - A native erroring on more than 1% of the questions now fails the suite. On a smoke sample of 100 or fewer questions, one rg timeout fails the suite. That is policy per spec, but flaky.
   - The classifier is conservative toward unknown, never toward known. I found no input where it says known and the product meant unknown (analysis below).
4. Dependency failure.
   - rg missing or broken: preflight throws, `runBench` rejects, `main` prints `[bench] the run broke: <stack>` and exits 1. No unhandled rejection, and it happens before any host or `withPinnedCorpus`.
   - `where` failing: `lookupOnPath` returns `undefined` and the "Unable to find ripgrep" error is thrown.
   - Timeout and kill: the 5 s timer calls `child.kill()` and rejects once. The `settled` guard handles the later `close` event, and `clearTimeout` runs in `settle`. No leak.
5. Missing.
   - Recorded-failure mode (SERIOUS-1).
   - No cause text in the preflight error.
   - No dedupe of identical native error entries.
   - No test that a non-deciding native error does not fail the suite.

## Classifier analysis (13f.1)

- The product emits `reasons` only via `withCoverageVerdict`, which caps the list at `MAX_REPORTED_REASONS=3` (`language-coverage.interface.ts:357`).
  - `compactCoverage` calls it too (`:501`).
  - `normalizedCoverage` (`mcp-response-formatter.ts:918`) calls it too.
  - All 14 emitters I grepped go through it. No path emits more than 3.
  - Arrays longer than 3 would still be handled: the last-element rule applies, and the whole array is visible.
- The rule is correct against the ordering at `language-coverage.interface.ts:215-236`.
  - At cap, if the last reason is index >= 10 (`unchecked` and later, all non-`?`), every `?` code ranks earlier and would have been listed. So the array is known.
  - A last reason of `resolution?` (index 9) or any other explicit `?` is caught earlier by the explicit-`?` rule.
  - A last reason ranked before `resolution?` (including `unrecognised?`) could hide `omitted?` or `resolution?`, so it is unknown. This matches the spec.
  - The product's mid-census shape `["updating","unrecognised?","unchecked"]` is known (index 10).
- Multiple arrays: `.some()` means any unknown array wins. A cut or malformed array (count of starts differs from count of arrays) stays unknown, even after a clean complete array.
- Non-string reasons: `REASONS_ARRAY` fails to match, the counts differ, and the result is unknown. A string that is not valid JSON cannot reach the `JSON.parse` catch. The `?? null` fallback is only defensive.
- `\u003f`-escaped `?` is decoded by `JSON.parse` and handled.
- `"reasons"` inside an escaped string value (`\"reasons\"`) does not match `REASONS_START`.
- Dead code: `UNKNOWN_REASON` (`call-recorder.ts:123`, used at `:168`) can never match when `starts.length === 0`, because its pattern requires the same `"reasons"...[` prefix. Harmless.

## Failure modes

### Gate default mode ignores a broken deciding baseline
- Trigger: bench run with native rg broken, gate run against a committed baseline with the default mode (`baseline.modes.suites[key] ?? 'recorded-failure'`, `baseline.ts:320`).
- Symptom: the native scores 0, so the tool's delta is hugely positive. `recordedResult` returns `improved` (`baseline.ts:205-211`), which is not in `FAILING_OUTCOMES`. The gate passes.
- Evidence: the baseline-error-rate check exists only in `claimResult` (`gate.ts:429-444`). `recordedResult` (`baseline.ts:150-218`) never reads `error_rate` or the verdict when both deltas are numeric.
- Recommendation: see SERIOUS-1.

### Preflight loses its cause
- Trigger: ENOENT, EACCES, a Windows app-execution-alias stub, timeout, or non-zero exit.
- Symptom: the same generic message for all of them, with no hint which one it was.
- Evidence: `rg-runner.ts:66-70`, `rg-runner.ts:193-222`.

### Native errors hidden behind tool failures
- Trigger: 25 or more tool failures.
- Symptom: native error entries are never listed. Tool entries come first and share the cap of 25 (`suite-runner.ts:449-483`). The `(verdict)` entry still names the baseline rate, since `extraFailures` precede and are uncapped.
- Not a loss of the verdict, only of the error text.

## Blocking issues

None.

## Serious issues

### SERIOUS-1: CI gate in recorded-failure mode does not reject a broken deciding baseline
- File: `tools/mcp-bench/src/gate/baseline.ts:150-218`, with `gate/gate.ts:429-444` for comparison.
- Scenario: see the failure mode above. The default mode for every suite not explicitly set to `claim` is `recorded-failure`.
- Impact: the b13e regression (native baseline broken, scorecard hides it) is rejected only for suites an operator has switched to claim mode. In the default mode it shows up as "improved, baseline out of date". The spec says "the CI gate rejects".
- Fix: in `recordedResult`, before the delta comparison and after the `recorded === undefined` early return, compute the current deciding baseline error rate. Extract it into a shared `decidingBaselineErrorRate(suite, deciding)` helper in `gate.ts` and use it from both `claimResult` and `recordedResult`. Return `result('over-baseline-error-rate', ...)` when it exceeds `MAX_ERROR_RATE_CLAIM`. Also run it for the `recorded === undefined` ('new') case if a new suite should not be recordable with a broken baseline. Add a spec in `baseline.spec.ts`. If recorded mode is deliberately exempt, state that in `decisions-s6.md` and have the lane say so, because the batch text reads as universal.

## Moderate and minor issues

Moderate:
- MODERATE-1: unrelated `rg`-using runs. `assertRgRuns` runs for every `bench` invocation (`main.ts:268-269`), including `--suite lifecycle` or polyglot-only runs. Fix: skip it when `filter` is non-null and selects no native-rg suite, or accept the extra requirement and say so in USAGE.
- MODERATE-2: `rg-runner.ts:66` discards the cause. Fix: `catch (error) { throw new Error(\`Unable to run ripgrep at ${executable}: ${error instanceof Error ? error.message : String(error)}; set RG_PATH to a working executable.\`, { cause: error }); }`. The `rejects.toThrow('RG_PATH')` and executable-name specs still pass.
- MODERATE-3: native error entries are not deduplicated. A broken rg fills the 25-entry budget with identical text (`suite-runner.ts:469-483`). Fix: list distinct `(native.id, error)` pairs once with a count, for example "native X error (N questions): ...".
- MODERATE-4: no spec that a non-deciding or unscored native with errors does not fail the suite. Nor that an `na` suite or a suite with no deciding native (memory) is unaffected. The code is correct (`suite-runner.ts:590-598` only checks `decider`; `gate.ts:418-420` returns before the check when `decidingBaseline` is null), but nothing pins it.

Minor:
- MINOR-1: RG_PATH with surrounding quotes (`rg-runner.ts:41`). Strip one matching pair of `"` or `'` after `trim()`. Specs name the resolved path in the error, so they would not break.
- MINOR-2: the spec title at `call-recorder.spec.ts:87` says "budget-cut body", but the input is complete JSON. Add a case where a clean first array is followed by a cut second array (`...{"reasons":["upd`) to pin the starts-versus-arrays count rule.
- MINOR-3: `retrieval-suite-kind.ts:61-64` repeats the tool's `error_rate` on every baseline row. It reads fine but implies the tool's error rate is per baseline. Consider a row labelled with the baseline id.
- MINOR-4: `UNKNOWN_REASON` in `call-recorder.ts` is dead (see classifier analysis). Remove it.

## main.ts max-lines warning (703 > 700)

Smallest fix, net -4 lines: add to `rg-runner.ts`

```ts
export async function createCheckedRgRunner(): Promise<RgRunner> {
  const executable = resolveRg();
  await assertRgRuns(executable);
  return createRgRunner(executable);
}
```

In `main.ts`, replace the three lines at `:268-270` with `const rg = await createCheckedRgRunner();`, and collapse the three-name import (`assertRgRuns`, `createRgRunner`, `resolveRg`, lines ~40-42) to one name. A grep shows `createRgRunner` and `resolveRg` are used nowhere else in `main.ts`. That gives about 699 lines. Do not disable the rule.

## Data flow

1. `main.ts:268` `resolveRg`: RG_PATH wins; otherwise `where`/`which` output is split on CRLF, trimmed and filtered. On win32 the first `.exe` line is taken, otherwise the first line. OK.
2. `main.ts:269` `assertRgRuns`: shell-free `rg --version`, 5 s timeout, one-shot `settled` guard. OK, but the cause is lost (MODERATE-2).
3. Hosts start. Natives run per question and record `result.error`.
4. `nativeMetrics` computes `error_rate`. `assembleSuite` adds a failure reason when the deciding baseline's rate is over 1%. `listFailures` adds `native <id> error: ...` entries after the tool entries. OK, minus MODERATE-3.
5. Scorecard Markdown shows the baseline `error_rate` (`retrieval-suite-kind.ts:57-64`). Formatting is null-safe (`formatMetric` returns `na`).
6. Gate, claim mode: `claimResult` re-reads the deciding baseline's `error_rate`, null-safe via `?.` and `?? null`. A missing or old scorecard passes this check. OK.
7. Gate, recorded mode: not checked. See SERIOUS-1.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 13f.1 classifier | COMPLETE | Minor test additions only |
| 13f.2 native error text in failures | COMPLETE | Not deduplicated; hidden behind 25 tool failures |
| 13f.2 Markdown baseline error_rate | COMPLETE | |
| 13f.2 suite verdict fails on deciding baseline error | COMPLETE | |
| 13f.2 CI gate rejects | PARTIAL | Claim mode only; recorded mode misses it |
| 13f.3 win32 `.exe` pick, RG_PATH priority | COMPLETE | Quoted RG_PATH not handled |
| 13f.3 preflight once at startup, clear error naming RG_PATH | COMPLETE | Cause lost; runs for runs that need no rg |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Multiple reasons arrays in one result | YES | `.some()` | none |
| `unrecognised?` as last capped entry | YES | unknown (index < resolution?) | none |
| Non-JSON or non-string reason | YES | array mismatch gives unknown | none |
| Cut body | YES | starts versus arrays count | cut after a clean array is only partly pinned by a test |
| More than 3 reasons from the product | N/A | not emitted anywhere | none |
| Native error only on non-deciding baseline | YES | not a failure | no spec |
| Suite with no native (memory) | YES | skipped | no spec |
| `na` suite | YES | early return | no spec |
| Missing baseline `error_rate` (null) | YES | `?? null` | none |
| `where` CRLF | YES | `/\r?\n/` + trim | none |
| `where` returns only `.cmd` or extensionless | YES | throws the not-found error | message does not say a shim was skipped |
| Non-win32 | YES | first non-empty line | none |
| Timeout, kill, spawn `error` versus `close` | YES | `settled` guard | none |

## Test quality

- `call-recorder.spec.ts`: good. It pins capped, uncapped, explicit `?`, non-string, unlisted code, pretty-printed and escaped strings, and the cut body. Minor gaps in MINOR-2.
- Suite and gate specs pin only the positive case: a deciding baseline at rate 1 fails the suite, and 0.02 fails claim-mode gate. They do not pin the negative cases (MODERATE-4) or recorded mode (SERIOUS-1).
- The `rg-runner` specs pin the resolution rules and the error text. They inject `run`, so the real `runRgVersion` (timeout, kill, `error` versus `close`) is untested. This is acceptable given the guard logic, but a spec spawning `process.execPath -e "process.exit(3)"` and one with a nonexistent path would cheaply cover it.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on 13f.1 and 13f.3, MEDIUM-HIGH on 13f.2. The recorded-mode gap depends on whether the spec intended "CI gate" to include recorded-failure mode. The batch text reads as universal.
- Top risk: the gate's default mode would still pass a run whose native baselines are all broken, the exact b13e failure.
- A robust implementation would add:
  - a shared `decidingBaselineErrorRate` helper used by claim and recorded modes;
  - the preflight cause in the error;
  - deduplicated native errors;
  - negative-path specs;
  - the `createCheckedRgRunner` refactor to clear the max-lines warning.

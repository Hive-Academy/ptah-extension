# Code Logic Review — TASK_2026_408

## Summary

Batch 9 — bounded orchestrator correction for N4 only.

Verdict: REJECTED

Score: 7/10

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The timeout correction addresses N4, but introduces an executable-resolution regression. The score reflects working error propagation and bounded termination with one environment-dependent defect, rather than the earlier ordinary cleanup failures. Batch 11 and ownership documentation were not reopened.

Locations use `S` for `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts` and `R` for `libs/backend/platform-core/src/utils/process-tree-reaper.ts`.

## N4 resolution

| Finding | Resolved | Evidence |
| --- | --- | --- |
| N4 — Windows kill subprocess outlives the caller's race | YES | `S:579–584` supplies `execFile` with the actual four-second timeout and resolves from its callback. A timeout error remains an error (`S:583`), is collected by `killChildTree` (`S:619`, `S:637–645`), and is included in the scenario timeout diagnostic (`S:683–693`). POSIX race expiry explicitly returns an Error (`S:588–596`). Finally now uses the same bounded helper (`S:920`). |

The Windows callback returns errors as values, so normal timeout/ENOENT/nonzero-exit cleanup outcomes do not throw from finally and replace the original test failure (`S:578–585`, `S:917–927`). The POSIX helper's current implementation absorbs signaling errors; its bounded wrapper likewise returns its expiry as a value (`S:594–596`).

## NEW findings / failure modes

### N5 — Moderate: Windows cleanup bypasses the existing trusted executable resolution

- File: `S:580`; supporting contract: `R:13–25`, `R:58`.
- Trigger: the Windows executable search resolves a different `taskkill` executable before the system utility.
- Symptom: the test launches that executable with the forced tree-kill arguments. It can fail to terminate the intended wrapper/CLI tree, or execute unrelated code under the test runner's account.
- Current handling: the new helper supplies bare `'taskkill'`. Previously, this path used the reaper, which selects `%SystemRoot%\System32\taskkill.exe` (or `%windir%`) specifically to avoid executable interposition. The new helper does not use either environment value, even when present. Both normal cleanup and finally use it (`S:619`, `S:920`). Survivor verification can report unsuccessful termination, but cannot undo launching the wrong executable.
- Impact: loss of an existing command-resolution safeguard in a test-only path. This is Moderate because it requires an unusual host search environment; no compromised executable was observed or launched during review.
- Recommendation: preserve the reaper's absolute System32 resolution when calling the bounded `execFile`, including its existing environment fallback semantics. Check the selected path as well as timeout/error behavior in a focused helper test.

## Five logic questions

1. **How does this fail silently?** No new silent timeout success was found: callback errors are retained (`S:583`, `S:637–645`). However, executable selection is unchecked (`S:580`); a successful exit alone does not prove the intended system utility ran.
2. **What user action produces unexpected behaviour?** Running the suite in an environment with a shadowing executable can invoke it during timeout or finally cleanup (`S:580`, `S:619`, `S:920`; N5).
3. **What input data produces a wrong answer?** Host executable-search configuration changes which program receives the PID and `/T /F` arguments (`S:580–582`). Scenario payload processing was outside this bounded correction.
4. **What happens when a dependency fails?** Windows timeout/spawn/exit errors become values that cleanup reports; POSIX expiry becomes an explicit Error (`S:583`, `S:594–596`, `S:637–645`). Finally preserves the original failure for these outcomes (`S:920`).
5. **What is missing that the requirements never mentioned?** A replacement subprocess launcher must preserve executable identity as well as timeout semantics; the existing reaper documents this contract (`R:13–25`).

## Blocking issues

None established.

## Serious issues

None established in this bounded correction.

## Moderate and minor issues

N5 above. No other new finding is asserted.

## Data flow

1. **GAP:** select Windows command by bare name (`S:580`; N5).
2. **OK:** enforce timeout on the actual subprocess and collect its callback error (`S:582–583`).
3. **OK:** on POSIX, signal through the existing helper and distinguish wait expiry (`S:588–596`).
4. **OK:** propagate returned errors into cleanup rejection and the original timeout report (`S:619`, `S:637–645`, `S:688–693`).
5. **OK:** finally awaits bounded cleanup without throwing its returned error over the primary failure (`S:917–927`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Terminate timed-out Windows kill subprocess | COMPLETE | `S:582` |
| Never report kill timeout as success | COMPLETE | `S:583`, `S:594–596`, `S:637–645` |
| Preserve original failure through finally | COMPLETE for current dependency contract | `S:920`, `S:578–596` |
| Preserve existing executable-resolution safeguard | MISSING | N5 |

Implicit requirement not addressed: preserving the previous Windows command-selection behavior.

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Windows timeout callback | YES | Error retained at `S:583` |
| Windows spawn error | YES | Same callback/error path, `S:583` |
| POSIX kill wait expires | YES | Explicit Error at `S:596` |
| Cleanup error during finally | YES | Returned value does not replace original failure, `S:920` |
| Earlier executable shadows taskkill | NO | Bare command at `S:580`; N5 |

## Verification and limits

- Retained the preceding full-file review and read the bounded correction, both call sites, adjacent cleanup/error propagation, and the supporting reaper contract. No source edits were made.
- In-memory probes executed the actual extracted/transpiled `boundedTreeKill`. Windows success returned undefined; injected Windows timeout and ENOENT errors were retained; a non-settling POSIX operation returned an explicit timeout Error. With `SystemRoot` provided, the captured Windows command remained bare `taskkill`, confirming N5. These probes created no files or subprocesses and did not simulate real executable interposition.
- Did not rerun the integration spec, as instructed. The orchestrator reports 9/9 tests in 88 seconds and clean ESLint/Prettier results; those results were not independently repeated for this correction.
- Scoped Ptah diagnostics were unavailable because this worktree is outside the diagnostics tool's configured workspace root.

## Verdict

- Recommendation: REJECT Batch 9 pending N5.
- Confidence: HIGH in the source-level command-resolution regression.
- Top risk: the timeout-safe launcher selects a different executable from the previously reviewed reaper.
- Robust implementation addition: preserve absolute system-utility resolution and assert the selected command alongside timeout behavior.

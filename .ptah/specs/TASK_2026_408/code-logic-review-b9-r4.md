# Code Logic Review — TASK_2026_408

## Summary

Batch 9 — authorized bounded correction for N5.

Verdict: APPROVED

Score: 8/10

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 new |

Locations below use `S` for `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`. This review retains the preceding full-file review and examines the authorized helper correction and its error propagation. Batch 11 and ownership documentation remain outside scope.

## N5 resolution

| Finding | Resolved | Evidence |
| --- | --- | --- |
| N5 — bare taskkill bypasses system executable resolution | YES | `systemTaskkill` selects SystemRoot, then windir, and constructs the System32 executable path (`S:577–581`). The Windows branch passes that path directly to execFile (`S:587–598`). Missing roots return an Error without spawning or falling back to executable search (`S:588–591`). |

The N4 correction remains intact: the timeout belongs to execFile itself (`S:597`), callback errors remain values (`S:598`), and POSIX expiry remains an explicit Error (`S:603–611`). Cleanup includes returned errors in its rejection (`S:634`, `S:652–660`); scenario timeout reporting preserves that diagnostic (`S:698–707`). Finally awaits the value-returning helper (`S:935`), so these expected error outcomes do not replace the original test failure.

## NEW findings / failure modes

None established in the bounded correction. Executable selection, missing-environment behavior, retained timeout options, and returned error identity were checked using the actual extracted helpers. This does not assert that arbitrary corruption of the operating system's root environment variables is supported.

## Five logic questions

1. **How does this fail silently?** Missing root configuration and execFile errors remain explicit Error values (`S:589`, `S:598`) and become cleanup rejection (`S:652–660`). No new silent-success path was found.
2. **What user action produces unexpected behaviour?** Running under an environment without either root variable now intentionally fails cleanup rather than searching for another executable (`S:588–591`). The failure remains visible to the caller (`S:707`).
3. **What input data produces a wrong answer?** No new case was established for supported Windows root values. SystemRoot precedence and windir fallback are explicit (`S:578–580`); the PID arguments remain separately supplied (`S:596`).
4. **What happens when a dependency fails?** Windows callback errors propagate through the existing cleanup rejection; POSIX timeout returns an Error (`S:598`, `S:611`, `S:652–660`). The missing-root branch follows that same contract.
5. **What is missing that the requirements never mentioned?** No additional requirement gap was established. As in the existing reaper, system root values are trusted host configuration (`S:578–580`); this correction removes dependence on executable-search ordering.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None new.

## Data flow

1. **OK:** derive the system utility path from host root configuration (`S:577–581`).
2. **OK:** return an explicit configuration error without spawning if unavailable (`S:587–591`).
3. **OK:** invoke the selected executable with separate arguments, actual subprocess timeout, and hidden window (`S:594–598`).
4. **OK:** report errors through target-tree verification and the scenario timeout (`S:634`, `S:652–660`, `S:698–707`).
5. **OK:** use the same bounded operation during finally without throwing expected cleanup errors over the primary failure (`S:935`).

## Requirements fulfilment

| Requirement | Status | Evidence |
| --- | --- | --- |
| Remove bare taskkill lookup | COMPLETE | `S:580`, `S:595` |
| Missing roots fail loudly | COMPLETE | `S:588–591`, `S:652–660` |
| Preserve actual subprocess timeout and argument contract | COMPLETE | `S:596–598` |
| Preserve POSIX behavior | COMPLETE within bounded review | `S:602–611` |
| Preserve original failure during finally | COMPLETE for current dependency contract | `S:935`, `S:589`, `S:598` |

Implicit requirements not addressed: none identified within this correction.

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Both Windows root variables present | YES | SystemRoot takes precedence, `S:578` |
| Only windir present | YES | Nullish fallback, `S:578` |
| Neither variable present | YES | Error returned, no spawn, `S:588–591` |
| Windows command times out | YES | Timeout option and callback error propagation, `S:597–598` |
| POSIX termination wait expires | YES | Explicit error, `S:611` |

## Verification and limits

- Read the helper correction and adjacent cleanup propagation, retaining the preceding full-file review context.
- Executed in-memory probes against the actual extracted/transpiled `systemTaskkill` and `boundedTreeKill`: **4/4 passed** — SystemRoot precedence, windir fallback, missing roots with zero spawn calls, and timeout-error identity propagation. Probes also asserted exact PID arguments, four-second timeout, and windowsHide. No files or child processes were created by these probes.
- Did not rerun integration, per instruction. The orchestrator reports 9/9 integration tests in 130 seconds and clean ESLint/Prettier; those checks were not independently repeated after this correction.
- Scoped diagnostics were previously unavailable for this worktree outside the configured diagnostics workspace; they were not redundantly requested. No new compiler result is claimed.
- Only this deliverable was written. No git operations or network calls were made.

## Verdict

- Recommendation: APPROVE Batch 9 with N5 resolved.
- Confidence: HIGH for the bounded correction and source-level propagation.
- Top residual uncertainty: this review used injected subprocess callbacks rather than a fresh real Windows timeout execution.
- Score rationale: 8/10 reflects sound, verified correction logic with the integration result supplied by the orchestrator; the evidence does not warrant the exemplary 9–10 band.
- What a robust implementation would add: retain focused automated helper assertions for executable selection and missing-root behavior. This is a follow-up verification opportunity, not an unresolved finding.

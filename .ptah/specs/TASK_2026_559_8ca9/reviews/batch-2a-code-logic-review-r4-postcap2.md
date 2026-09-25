# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 new |

Verdict: **APPROVED** for the second bounded correction to Batch 2a. Both post-cap defects are fixed at their root. The implementation earns the sound 7–8 band through structural fixes, preserved fence state, 42 passing detector tests and direct adverse-input probes. It does not earn 9–10: timing verification is machine-dependent and the limited corpus cannot establish universal classification accuracy or a formal runtime bound.

Scope: read content-detector.ts and content-detector.spec.ts in full, the previous post-cap review in full, and batches.md:230–239. Source references below use paths relative to libs/backend/tool-output-reducers/src/lib. No source or git operations were performed. Review is confined to the authorized files/documents; downstream cut/spool behavior is the recorded contract, not independently inspected implementation. No file-content reader or Write tool was exposed; native filesystem reads/writes were used.

## Status of each post-cap defect

| Previous defect | Status | Evidence |
| --- | --- | --- |
| Bare level word incorrectly supplies prefix evidence | FIXED | content-detector.ts:62 requires brackets, punctuation, a separator or end of line. ERROR/FATAL prose no longer contributes to the 50% ratio at :218–222. Negative specs :174–178 and positive specs :181–186 pass. |
| Quadratic fence regex | FIXED | content-detector.ts:27 removes the overlapping suffix matcher and failing end anchor. :172 slices the suffix once; :175–184 preserves delimiter identity, minimum closing length, blank closing suffix and the backtick info-string restriction. The exact 65,530-character input returned markdown in 0.198 ms locally; the tilde counterpart took 0.142 ms. |

The fence fix removes the source of repeated suffix rescanning, rather than increasing a timeout or shortening the sniff window. Existing nested/mixed-fence tests at content-detector.spec.ts:167–171 pass.

## Five logic questions

### 1. How does this fail silently?

No new silent failure was established. The reported prose misclassification now returns text (content-detector.ts:62, :222). Plain INFO/WARN lines can also return text; this is an intentional conservative result under batches.md:235–237, not an error concealed as success. The detector only returns a kind (:67–95); this review makes no new claim about downstream retention.

### 2. What user action produces unexpected behaviour?

Submitting `INFO  Server started on port 3000\nWARN Deprecated API used` now returns text. Each example paired separately with `Finished normally` also returns text. That lost recall is acceptable: whitespace plus a bare word cannot reliably distinguish logs from prose (content-detector.ts:62). A caller with reliable knowledge can still supply a log hint (:71–72). Timestamped log4j, Python `INFO:root:msg`, and representative Nx/Jest failure output returned log (:48, :62, :210–222).

### 3. What input data produces a wrong answer?

No new wrong answer was demonstrated in the correction's corpus. The two ERROR/FATAL prose cases return text; bracketed, colon-delimited and whitespace-separated bracket/dash level forms remain log (content-detector.spec.ts:174–186). The long fence plus U+2028 returns markdown promptly (:189–194). This is heuristic detection, not validation of every language or log format.

### 4. What happens when a dependency fails?

There is no runtime dependency, asynchronous operation or resource lifecycle in this file; its import is type-only (content-detector.ts:14). Invalid bracketed JSON still catches parse failure and continues detection (:107–121). Regex execution is synchronous, so pathological runtime would block the caller; adverse probes did not establish such a failure in this version (:18–62).

### 5. What is missing that the requirements never mentioned?

The new test measures elapsed wall time, not computational complexity (content-detector.spec.ts:192–194). CI descheduling/GC can exceed 250 ms even when computation is linear. This is a non-blocking test robustness concern, not a demonstrated failure. The sniff window can end mid-line (:81), and splitting uses only CRLF/LF (:85); the correction handles the reported embedded Unicode separator without requiring it to become a separate line (:27, :172).

## Failure modes / numbered new defects

None substantiated in this bounded correction. No numbered defect is invented for permitted lost recall or a hypothetical CI pause. Scope and verification are recorded here to make the clean result auditable; classification coverage and timing observations are finite.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

None established. Test robustness suggestions below are non-blocking notes.

## Data flow

1. Hint → immediate kind: OK, unchanged (content-detector.ts:71–72).
2. BOM/trim → empty fallback → full object/array JSON check: OK, unchanged (:74–79, :98–121).
3. 64 KiB sample → HTML → CRLF/LF split: OK, unchanged (:81–85, :124–133).
4. Fence prefix → sliced suffix → delimiter/length state → source exclusion: OK; reported quadratic overlap removed, previous closing/opening restrictions retained (:27, :145, :167–192).
5. Markdown → code → log → text: OK; order unchanged (:86–95). Log error markers and repetition remain unchanged (:39–55, :210–217); only level-prefix evidence is narrowed (:62, :218–222).
6. Return kind: OK; no I/O, spooling, reduction or shared fence state occurs here (:67–95, :169).

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Fix post-cap bare-level prose defect | COMPLETE | detector :62; spec :174–186; direct probes |
| Fix fence backtracking at the root | COMPLETE | detector :27, :172; spec :189–194; direct probe |
| Acceptable plain-level lost recall | COMPLETE | text observed; precision rule at batches.md:235–237 permits this |
| Preserve log4j/Python/Nx/Jest structural logs | COMPLETE for tested representatives | detector :48, :62; direct probes; all 42 specs pass |
| Examine every regex on bounded adverse input | COMPLETE for tested corpus | detector :18–62, :85; measurements below |
| Assess timing-test CI risk | COMPLETE | spec :192–194; non-blocking note below |
| No unrelated logic change | COMPLETE within supplied baseline description | described edits map to :27, :62, :172–184 and spec :174–194; no other change is evidenced by the prior review |

No previous full source snapshot was supplied and this new library is uncommitted. Therefore “no other logic changed” is a comparison against the supplied old expressions, scanner description and prior review evidence, not a byte-for-byte historical diff assertion. Implicit requirement: performance tests should tolerate ordinary CI variation while detecting multi-second regressions.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/BOM/invalid JSON | YES | spec :63–92; detector :74–79, :98–121 | None newly found |
| ERROR/FATAL prose | YES | spec :174–178 → text | Fixed prefix bypass |
| Bare INFO/WARN logs | YES under precision rule | detector :62 → text | Deliberate loss of recall |
| Brackets, colon, bracket/dash separator | YES | spec :181–186 → log | None newly found |
| Timestamped log4j / Python logger | YES | direct probes → log; detector :62 | Multi-line examples tested |
| Nx/Jest failure output | YES | direct probes → log; detector :48 | No blanket claim for all success-only runner output |
| Longer/mixed fences | YES | spec :167–171; detector :175–184 | Prior state correction preserved |
| 65,520 backticks + U+2028 + x | YES | spec :189–194; direct probe | No repeated suffix rescanning |
| Single-line log input | YES as existing text fallback | detector :204–205 | Minimum two nonblank lines is unchanged |
| Concurrent/repeated calls | YES within this module | fence state local at :169; spec :197–200 | No new async/shared state |

## Non-blocking notes and verification

- Ran the authorized detector Jest suite once: **42/42 passed**, one suite, 1.106 seconds. PowerShell surfaced stderr as NativeCommandError with wrapper exit code 1; the explicit Jest summary was passing. No rerun.
- Scoped ptah_get_diagnostics on both files returned **0 errors, 0 warnings**. The orchestrator's uncached project test/lint/typecheck success is supplied evidence, not rerun here.
- Read-only in-memory transpilation exposed the actual regex constants for testing. Each constant, including all seven LOG_ERROR_MARKERS, ran against 20 near-64 KiB single-line inputs: backtick/tilde runs with Unicode separators, spaces, level-word runs, ERROR/in prefixes, at-prefix whitespace/tokens, malformed stack locations with digit/colon runs, repeated opening parentheses, long tag names/attributes and repeated Error/dot tokens. Maximum observed per expression was 0.744 ms; the fence maximum was 0.115 ms, log-prefix maximum 0.252 ms, and stack-marker maximum 0.411 ms. These are observations, not a proof for every possible string.
- The remaining splitter regex (:85) was checked separately on 65,536-character carriage-return and whitespace inputs: 0.443 ms and 0.033 ms. Its optional CR and required LF do not have competing unbounded repetitions. Static inspection of :18–62 found no remaining counterpart to the removed fence run/suffix overlap.
- The 250 ms test (:189–194) has roughly three orders of magnitude of local margin for the exact corrected input. It is useful as a coarse regression alarm, but does not prove linear complexity and cannot rule out CI scheduling flakes. If flakes occur, use a controlled performance test with warmup and repeated observations or a larger coarse stall bound; retain an explicit expected-kind assertion alongside the performance check. A single measurement alone does not justify declaring the test already flaky.
- The requested plain-level recall tradeoff is accepted explicitly, not justified merely by verbatim downstream copying: ambiguous content must use text under batches.md:235–237. Timestamp branches and other structural log evidence remain intact (detector :39–62).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for closure of both reported defects; MEDIUM for exhaustive regex/classification behavior and CI timing portability.
- Top risk: a heavily delayed CI process can fail the single wall-clock timing assertion despite a fast implementation.
- What a robust implementation would add: an explicit kind assertion for the crafted fence fixture and controlled performance sampling if CI measurements prove unstable; no source correction is required by the evidence in this review.

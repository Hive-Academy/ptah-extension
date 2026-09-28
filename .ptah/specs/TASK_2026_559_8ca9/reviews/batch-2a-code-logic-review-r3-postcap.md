# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Review | Post-cap bounded correction |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

**Verdict: REVISE.** Both exact round-2 failures are fixed and their regression tests discriminate the old logic. One acknowledged classification gap remains, and the new fence regex introduces a measured quadratic slowdown. These concrete gaps keep the score below the sound 7–8 band; normal fixtures and all 36 detector tests pass, so a 3–4 score is not warranted.

Scope: read both changed files in full, content-detector.ts and content-detector.spec.ts, and the relevant current batches.md selection/ruling blocks at :230-239 and :290-306. Prior conclusions about unchanged Batch 2a contracts/configuration remain unchanged. Only this review was written; no source, task state or git state was modified. All abbreviated source paths below are relative to libs/backend/tool-output-reducers/src/lib.

## Status of round-2 defects

| Round-2 defect | Status | Evidence |
| --- | --- | --- |
| D1: FAILED-start prose becomes log | FIXED for the reported route and examples | content-detector.ts:45 now requires punctuation, end of line or path-like structure. The two negative fixtures at spec :150-154 return text; the five positive fixtures at :157-164 remain log. The separate prefix-ratio route still admits ERROR prose; ruling below. |
| D2: boolean fence toggle leaks nested examples | FIXED | content-detector.ts:161-177 tracks delimiter character and length, requires a whitespace-only closing suffix, and rejects backticks in a backtick opener's info string. Both nested fixtures at spec :167-171 remain Markdown. This fixes the state model, not just the specific examples. |

Failing-first independently checked without touching source: reconstructed the exact round-2 marker and boolean fence scanner in memory, then executed the current detector spec assertions against that version. Exactly 4 of 36 failed: the two uppercase-prose fixtures and the two nested-fence fixtures. All 36 passed against current source in the same harness. A separate authorized Jest run also passed all 36 tests.

Round-1 D3 remains closed by the explicit scalar-to-text decision (batches.md:301-304; content-detector.ts:94-105). No scalar-contract concern is reopened.

## Five logic questions

### 1. How does this fail silently?

The unchanged prefix ratio returns log for ordinary prose starting with ERROR (content-detector.ts:54,209-213). It bypasses the precision improvement at :45 without exposing uncertainty. The detector itself does not remove text; the later pipeline may choose an inappropriate reducer.

### 2. What user action produces unexpected behaviour?

Reading unhinted explanatory prose containing a leading uppercase ERROR can select log. Reading a malformed/adversarial fence-like line can synchronously stall detection for seconds even though the sniff window is only 64 KiB (:24,73,163). Exact inputs appear in defects 1–2.

### 3. What input data produces a wrong answer?

`ERROR budgets are discussed below.\nThe next section explains the policy.` returns log instead of the contract's conservative text fallback (:54,213). Standard nested Markdown, bash fences, list-indented fences and a fence unclosed at the window boundary returned Markdown in direct probes (:137,161-183).

### 4. What happens when a dependency fails?

This correction introduces no runtime dependency, asynchronous work or owned resource; the only import is a type (:14). JSON parse errors still fall through (:107-112). The fence performance failure does not throw and has no timeout/cancellation path: regex execution blocks the current thread at :163.

### 5. What is missing that the requirements never mentioned?

The new fence scanner assumes that line content cannot contain Unicode line separators, but the detector only splits on CRLF/LF (:77), whereas dot in the fence regex excludes U+2028/U+2029 (:24). Their interaction causes defect 2. The recorded ambiguity rule and retained broad prefix rule also need a consistent policy; preserving output lines verbatim alone does not settle classification correctness (batches.md:235-239).

## Failure modes / numbered defects

### 1. LOG_LINE_PREFIX still treats an uppercase prose word as a log level — moderate

- File: content-detector.ts:54; acceptance path at :209-213.
- Failing input: `ERROR budgets are discussed below.\nThe next section explains the policy.` without a hint.
- Actual result: log, reproduced directly against current source.
- Expected behavior: text under batches.md:235-237: ambiguous input must not receive a structure-specific kind.
- Current handling: the new marker at :45 correctly rejects this sentence, but the old prefix regex counts its first word. One of two nonblank lines meets the 0.5 threshold, so the fallback still returns log.
- Impact: over-budget prose may be routed through log-specific line selection rather than plain cut/spool. There is no demonstrated permanent data loss in this batch; raw spooling mitigates it. The future reducer's verbatim guarantee only constrains retained lines, and batches.md:237 expressly permits omission. It does not guarantee that the same prose survives as on the text path.
- Ruling on the known note: **still a defect, not an acceptable correctness guarantee from reducer safety**. The decision at batches.md:296-297 to leave the prefix ratio unchanged explains why it remains, but does not satisfy the separate precision rule at :235-237. The correction need not change the ratio; the prefix evidence can be made structural.
- Fix: retain timestamp/bracketed or otherwise delimited level shapes, and require corroboration for a bare uppercase word followed by prose. Share compatible structural evidence between the marker and prefix branches; add the exact negative fixture and positive level-prefix fixtures. Alternatively an explicit product acceptance of this false positive must narrow the stated detector contract; it cannot be inferred merely from verbatim copying.

### 2. New fence regex has quadratic backtracking on a bounded line — moderate

- File: content-detector.ts:24; executed at :163 on lines split at :77.
- Failing input: `'# Guide\n' + String.fromCharCode(96).repeat(65520) + '\u2028x'` (65,530 UTF-16 units; within SNIFF_WINDOW).
- Actual result: eventually Markdown, but full detectContentKind took approximately **3,446 ms** in a direct local run.
- Expected behavior: cheap bounded sniffing, including malformed fence input; invalid/unrecognized lines should fall through without a seconds-long synchronous stall.
- Current handling: the backtick run and subsequent `(.*)` both consume backticks. At the Unicode line separator, dot cannot consume the remaining text and `$` cannot finish before the following x. The engine repeatedly gives characters back from the first greedy run and rescans the suffix. The splitter leaves U+2028 within one line.
- Evidence of growth: isolated regex probes on the same shape took approximately 13.57 ms at 4,096 backticks, 52.29 ms at 8,192, and 217.70 ms at 16,384. The approximately fourfold growth on doubling is quadratic. This is polynomial backtracking, not a claim of exponential behavior.
- Impact: a malformed/adversarial tool result blocks the synchronous detector on the host thread despite the 64 KiB cap. Severity is moderate because the demonstrated input is unusual; no remote exploit path or typical-input stall was established.
- Fix: parse the leading whitespace and delimiter run with a small linear scanner, then take the suffix directly; or otherwise eliminate the overlapping failure/backtracking path. Preserve delimiter/length tracking and info-string checks. Add a regression containing a Unicode line separator after a long fence run, with verification in a controlled performance context.

## Blocking issues

None found in the bounded scope.

## Serious issues

None found in the bounded scope. The performance defect is demonstrated on an unusual adversarial input and is not represented as a probable normal-path failure.

## Moderate and minor issues

Two moderate defects above; no additional numbered findings.

## Data flow

1. Hint → direct kind: unchanged, OK (content-detector.ts:63-64).
2. BOM/whitespace normalization → empty text → object/array JSON parse: unchanged, OK (:66-71,90-112).
3. Slice 64 KiB → HTML → split CRLF/LF: unchanged (:73-77); Unicode separators stay inside lines.
4. Markdown source-exclusion scanner: delimiter-state correction is OK (:161-177); regex parsing has defect 2 (:24).
5. Markdown headings → code → log → text: order remains deterministic (:78-87). New verdict marker improves precision (:45); broad prefix acceptance still has defect 1 (:54,209-213).
6. Return a kind only: no reducer/spool execution occurs in these files (:59-87), so downstream safety remains a later integration obligation.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Exact FAILED/FAIL prose regressions fixed | COMPLETE | spec :150-154; independent current/old comparison |
| Preserve five verdict log shapes | COMPLETE | spec :157-164; Jest pass |
| Nested and mixed-character fences remain open correctly | COMPLETE | detector :161-177; spec :167-171 |
| Precision over recall for all log evidence | PARTIAL | Broad prefix route remains; defect 1 |
| Cheap bounded detection on malformed lines | PARTIAL | New fence regex stall; defect 2 |
| Preserve representative Jest/Nx/tsc/pytest/webpack logs | COMPLETE | Direct fixtures returned log; detector :38-51 |
| Bash, list-indented, window-unclosed fences | COMPLETE for tested fixtures | Direct probes returned Markdown; detector :161-183 |
| JSON scalars stay text | COMPLETE, unchanged | detector :94-105; accepted contract |

Implicit requirements not addressed: regex/splitter agreement on Unicode line separators, and consistent positive-evidence rules across both log branches.

## Edge cases

| Case | Handled | Evidence | Concern |
| --- | --- | --- | --- |
| FAILED/FAIL followed by prose | YES | spec :150-154 | Exact reported route fixed |
| ERROR followed by prose | NO | detector :54,213 | Defect 1 |
| Jest path and Nx wrapper with FAIL path | YES | direct probes; :45 | Representative failure logs only |
| TypeScript diagnostic | YES | direct probe; :49 | None reproduced |
| pytest node id / webpack ERROR in | YES | spec :159-160; direct probes | None reproduced |
| Windows stack location | YES | direct probe; :38 | None reproduced |
| Ordinary bash fence with comment headings | YES | direct probe; :161-177 | None reproduced |
| List-indented code fence | YES | direct probe with four-space indentation; :24,163 | Full Markdown list parsing is not claimed |
| Unclosed code fence at 64 KiB cutoff | YES | direct probe; :164-173 | Remains open; code does not escape |
| Four-backtick / tilde around triple-backtick block | YES | spec :167-171 | Correct character and length state |
| New verdict marker on 64 KiB adversarial lines | YES | direct regex probes; :45 | No pathological timing found in tested shapes |
| Long backtick run plus U+2028 and trailing x | NO | detector :24,163 | Defect 2 |

## Non-blocking notes and verification

- New marker performance: five 65,536-character candidates (whitespace, repeated ordinary token characters, long ERROR-in tokens, and repeated dot/letter suffixes) took approximately 0.08–0.20 ms each. No backtracking defect was established in the new log-marker regex itself (:45). The separately discovered problem is the new fence regex (:24).
- Authorized Jest invocation ran once: **1 suite passed, 36 tests passed**, approximately 1.231 seconds. PowerShell surfaced Jest's stderr summary as a NativeCommandError and the wrapper exit code was 1; the explicit Jest result was passing. No failed suite was rerun.
- Scoped ptah_get_diagnostics on the two changed files reported zero errors and zero warnings.
- The current/round-2 comparison used transpiled source and reconstructed old bodies entirely in memory. It independently reproduced the orchestrator's four failing assertions without changing the working tree.
- The orchestrator reports uncached test/lint/typecheck success. This review independently ran only the authorized detector suite plus scoped diagnostics and read-only probes; it did not rerun Nx or validate downstream reducers.
- No new imports, suppression, I/O, mutable shared state or registration requirement was added (detector :14,159-183). The fence state is local to each call. No separate structure defect was found.
- Prior acceptance of the token-measure deviations and scalar rule remains in force. No changes to unrelated implementation or requirements were requested or made by this review.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for both reproduced failures and closure of the two exact round-2 examples; MEDIUM for downstream effect before integration.
- Top risk: a bounded malformed fence input can stall the host synchronously, while ambiguous ERROR prose still selects a structure-specific reducer.
- What a robust implementation would add: linear fence-line parsing and a consistent structural log-prefix predicate, each with the failing input above covered by a regression.

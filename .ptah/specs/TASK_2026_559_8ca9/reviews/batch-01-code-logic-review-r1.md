# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 1 |
| Serious issues | 2 |
| Moderate issues | 0 |
| Failure modes found | 3 |

Scope: Batch 1 task 1.3, the four named formatter/dispatcher files. Tasks 1.1 and 1.2 were not re-audited. Paths below are relative to the working tree; `formatter` means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`, and `dispatcher` means the adjacent `protocol-dispatcher.ts`. Spec references use the corresponding adjacent `.spec.ts` files.

The canonical-path happy path and arithmetic work, but requested-file identity is not reliable and coverage failures can lose their explanation. This merits 5 rather than 7: the defects affect the principal preservation guarantee. It is above the 3–4 band because the dispatcher wiring, count partition, normal capped output, and requested-overflow behavior are implemented and exercised.

Inputs read: `context.md`, Batch 1 of `batches.md`, the changed logic and tests, surrounding formatter/dispatcher code, and direct imports `types.ts` and `tool-description.builder.ts`. No `task-description.md`, `implementation-plan.md`, or existing style review was present in the task-folder listing; batches.md:10 explicitly calls this plan-free. No applicable AGENTS.md was found along the checked workspace/source ancestor chain. No git operations or shipping-code edits were performed. No direct Ptah file-read tool or native `Write` tool was listed; native reads and apply_patch were used.

## Five logic questions

### 1. How does this fail silently?

An absolute requested path containing `..` does not match the provider's normalized path. The formatter then prints “No diagnostics in the requested files” and may omit the actual requested diagnostic (formatter:449, formatter:484, formatter:382). See defect 1.

### 2. What user action produces unexpected behaviour?

Requesting `src/a.ts` also selects `packages/other/src/a.ts` under the same root because both satisfy the suffix predicate (formatter:485). The second file receives requested-file preservation and inflates the requested count. See defect 2.

### 3. What input data produces a wrong answer?

Canonical diagnostic paths paired with equivalent noncanonical requested paths yield the wrong partition; duplicate relative suffixes yield the opposite wrong partition. The totals still count all entries at formatter:349, but the requested/sibling attribution at formatter:406 is wrong. Number `2` and string `"10"` sort numerically as intended through formatter:338 and formatter:427; a direct probe confirmed that ordering.

### 4. What happens when a dependency fails?

An unavailable payload preserves source/reason at formatter:262. A rejected diagnostics promise reaches the tool error envelope with `isError: true` at dispatcher:1886 and dispatcher:1907. An in-band project coverage failure can instead be reduced to a filename/count once requested entries fill the cap (formatter:361); see defect 3. Malformed `diagnostics` becomes an empty list and a success-looking clean result at formatter:271; this existing defensive behavior is a residual boundary risk, not attributed to this batch without a baseline diff. The formatter adds no timeout or cancellation mechanism.

### 5. What is missing that the requirements never mentioned?

The formatter needs the provider's canonical request scope or its workspace root; string suffixes cannot establish file identity (formatter:462). Coverage failures need a representation that survives a full requested-file allocation (formatter:319, formatter:361). The cap is an entry limit, not a universal character bound: 50 messages of 500 characters already exceed 8,000 characters (formatter:225, formatter:232). Batch 1 only requires the typical-message fixture; larger output belongs to the planned spool/budget integration, without dropping requested entries.

## Failure modes

### 1. Equivalent absolute paths can hide the requested diagnostic

- Severity: **Blocking**.
- Trigger / failing input: `requestedFiles = ['D:/repo/src/../src/z.ts']`; diagnostics contain 60 errors in `D:/repo/src/a.ts` and one error in `D:/repo/src/z.ts`, message `TARGET`.
- Symptom: the actual formatter returned `Shown 50 of 61 (0 in requested files, 11 in sibling files omitted)`, printed “No diagnostics in the requested files”, and omitted `TARGET`.
- Evidence: formatter:449 only replaces slashes and folds case; formatter:484 compares the unnormalized absolute key exactly; formatter:362 then caps the misclassified entry.
- Current handling: the omitted filename is counted, but the requested file is falsely declared clean and its error detail disappears.
- Expected behavior / recommendation: normalize dot segments and separators using the same path identity semantics as the provider before matching. The target must appear in the requested section and summary as one requested diagnostic, irrespective of siblings. Add absolute and relative dot-segment regression cases with more than 50 earlier-sorting sibling errors.

### 2. Relative suffix matching treats unrelated files as requested

- Severity: **Serious / major**.
- Trigger / failing input: workspace `D:/repo`, `requestedFiles = ['src/a.ts']`; one diagnostic in `D:/repo/src/a.ts` and one in `D:/repo/packages/other/src/a.ts`.
- Symptom: the actual formatter reports `Shown 2 of 2 (2 in requested files, 0 in sibling files omitted)` rather than one requested entry. Many matching suffixes bypass the sibling cap altogether.
- Evidence: formatter:477 and formatter:485; dispatcher:709 supplies the raw request without a root or canonical scope.
- Current handling: segment boundaries prevent `dispatcher.ts` matching `protocol-dispatcher.ts`, but do not disambiguate identical suffixes.
- Expected behavior / recommendation: resolve the relative request against the same workspace root used by the diagnostics provider, then compare canonical identities. Preserve only the actual requested file beyond the cap. Do not use process.cwd as a substitute for caller workspace context. Add a duplicate-suffix test, including enough sibling entries to demonstrate bounded output. The schema currently documents absolute paths (`tool-description.builder.ts:380`), but this implementation and formatter.spec.ts:268 explicitly support relative paths, so that branch must classify them correctly.

### 3. Coverage-failure explanations disappear at the requested-file cap

- Severity: **Serious / major**.
- Trigger / failing input: 50 requested diagnostics in `D:/repo/src/a.ts` plus a diagnostic on `D:/repo/tsconfig.lib.json` with message `NOT CHECKED` explaining a failed project check.
- Symptom: the actual formatter returns `Shown 50 of 51 (50 in requested files, 1 in sibling files omitted)`. It names the tsconfig with count 1 but omits `NOT CHECKED`; the caller cannot distinguish a compiler coverage gap from an ordinary omitted diagnostic.
- Evidence: formatter:361 assigns zero sibling slots; formatter:362 caps every nonrequested diagnostic, including config entries. formatter:423 prioritization cannot override zero capacity, despite formatter:319 documenting that coverage gaps must never be hidden.
- Current handling: priority protects config entries only when there are enough remaining sibling slots. More config failures than remaining slots have the same problem.
- Expected behavior / recommendation: expose coverage failures independently of ordinary sibling detail allocation, retaining the fact that checking was incomplete and the reason. Preserve every requested diagnostic and keep shown/omitted arithmetic consistent with whichever representation is chosen. Add tests at 50 and more than 50 requested entries and for multiple config failures. Prefer explicit coverage metadata when available; the basename heuristic at formatter:344 also promotes ordinary tsconfig diagnostics and cannot itself identify coverage failure.

## Blocking issues

### Defect 1 — false clean statement for a requested file

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:449`.
- Scenario: equivalent absolute path spelling includes dot segments.
- Impact: caller is told the requested file has no diagnostics while its diagnostic is omitted.
- Fix: canonicalize scope and diagnostic identities before partitioning; retain the regression described above.

## Serious issues

### Defect 2 — wrong requested-file membership

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:485`.
- Scenario: relative request shares its suffix with another file.
- Impact: incorrect requested totals, ordering, and unbounded preservation of siblings.
- Fix: resolve using the provider's workspace root/canonical scope.

### Defect 3 — hidden incomplete-check explanation

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:361`.
- Scenario: requested diagnostics exhaust the cap while a project check fails.
- Impact: caller loses the reason why the diagnostic set is incomplete.
- Fix: render coverage failure status outside the ordinary sibling-detail cap.

## Moderate and minor issues

No additional moderate defects established. Non-blocking test gaps: formatter.spec.ts:268 does not exercise case folding, non-string entries, dot segments, or duplicate relative suffixes; formatter.spec.ts:309 tests coverage priority only with zero requested entries; formatter.spec.ts:353 checks only the existence of a truncation marker, not its exact count or boundary. Add tests for `Other`, 20/21 omitted files, mixed numeric/string line ordering, and message lengths 499/500/501. The scoped empty early return at formatter:272 omits the summary entirely; make that exception explicit or test a `Shown 0 of 0` trailer if a trailer is required for every scoped result.

## Data flow

1. **OK:** dispatcher:693 extracts scope; dispatcher:699 / :701 / :703 pass it to all three provider methods.
2. **OK:** dispatcher:709 forwards scope into the formatter and dispatcher:2021 wraps its output without dropping content.
3. **OK with existing boundary uncertainty:** formatter:254 distinguishes unavailable from populated/empty payloads; malformed arrays are not validated as diagnostics.
4. **GAP:** formatter:333 classifies requested identities using the matcher from defects 1–2.
5. **OK:** formatter:349 counts all three severity classes before any selection.
6. **OK for priority, GAP for preservation:** formatter:356 sorts requested/config/severity/file/numeric-line; formatter:361 preserves all classified-requested entries but can hide coverage failures.
7. **OK:** formatter:499 groups full paths once per file; formatter:538 flattens/truncates individual messages with a suffix describing omitted flattened characters.
8. **OK conditional on correct identity:** formatter:553 counts omitted diagnostics per file, names the largest 20, and sums the rest; formatter:403 derives exact shown/omitted totals from the partition.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Preserve all requested diagnostics, including over 50 | PARTIAL | Correct for recognized identities; defect 1 loses actual requested entries |
| Exact error/warning/other totals | COMPLETE | Counts precede cap, formatter:349 |
| Exact shown/requested/sibling summaries | PARTIAL | Arithmetic correct, identity attribution wrong in defects 1–2; empty scoped result has no trailer |
| Omitted sibling names/counts, 20-file overflow | COMPLETE | formatter:553; direct 80-file probe produced `and 10 more files (10)` |
| 200 diagnostics / 3 files / 1 requested within 8,000 chars at typical length | COMPLETE | formatter.spec.ts:204 fixture independently reproduced at 7,795 characters |
| Safe config coverage-failure priority | PARTIAL | Sort implemented; preservation fails under cap pressure |
| Windows folding, backslashes, ignored non-string scope entries | COMPLETE | formatter:449 and :472; direct Windows probes passed |
| Relative requested-file identity | PARTIAL | Segment boundary works, root identity does not |
| Numeric/string line ordering and 500-character message content limit | COMPLETE | formatter:338 and :538; probes confirmed 2 before `"10"` and 2,000 characters -> `… (+1500 chars)` |
| Specs prove all requested edge cases | PARTIAL | Important missing cases listed above |

Implicit requirements not addressed: canonical scope identity and unmistakable incomplete-check status under cap pressure.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty result | YES | formatter:272 / :285 | Scoped trailer absent |
| More than 50 recognized requested entries | YES | formatter:357 / :361; spec:246 | Output may exceed 8k by design |
| Equivalent dot-segment path | NO | No dot normalization | Defect 1 |
| Duplicate relative suffix | NO | Suffix predicate selects both | Defect 2 |
| Config failure with remaining slots | YES | formatter:423 | Existing spec:309 |
| Config failure without slots | NO | All nonrequested entries capped | Defect 3 |
| Windows casing / backslashes | YES | formatter:449 | Probed on Windows; no cross-platform test matrix run |
| Non-string scope entries | YES | formatter:472 | Formatter ignores them; upstream argument validation was not audited |
| More than 20 omitted files | YES | formatter:563 | Rest file count and diagnostic sum retained |
| Repeated/concurrent calls | YES | formatter:333 / :499 allocate local state | No new resources, timers, or shared mutable cache |
| Provider rejects / unavailable | YES | dispatcher:1886 / formatter:262 | In-band partial failure differs: defect 3 |

## Non-blocking notes and verification

- Structure: the new pure helper chain stays inside the existing formatting module and dispatcher:709 keeps presentation separate from provider invocation. No new cross-library runtime dependency is needed for this change. `RankedDiagnostic` at formatter:313 makes ranking fields explicit; helpers are invoked, not stubs. The reviewed changed region contains no `as any`, TODO, or new catch binding. `blocks: any[]` at formatter:365 follows this file's existing json2md pattern at formatter:86; stronger typing is optional follow-up, not a shipping defect.
- `ptah_get_diagnostics` on both production paths returned TypeScript-compiler errors 0 / warnings 0.
- Ran the requested Nx test command once. Nx reported **65 suites, 1,403 tests passed** in the selected project. Its filename filter did not narrow execution; no workspace-wide target was requested and the command was not rerun. Output also warned that a worker failed to exit gracefully and was force-exited; that warning was not isolated to this change. Nx Cloud separately reported the organization disabled for plan usage.
- Direct Node probes loaded the actual formatter by transpiling it in memory, without writing source/tests. They reproduced all three defects and confirmed Windows folding, ignored non-string scope entries, numeric sorting, exact truncation suffix, omitted-file overflow, Other totals, and the 7,795-character fixture. The initial probe invocation failed because the PowerShell pipe replaced a Unicode regex character; the corrected ASCII-escaped invocation produced the reported results.
- Test success does not prove the uncovered identity and coverage cases. No new permanent tests were written during review.
- Delivery constraint: the reviewer role mandates this canonical `code-logic-review.md` path and forbids other review filenames. Consequently the requested `reviews/batch-01-code-logic-review.md` copy was not written; the caller must use this canonical artifact.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the three reproduced formatter defects; provider implementation beyond the allowed direct-import scope was not re-audited.
- Top risk: equivalent requested paths can be declared clean while their diagnostics are omitted.
- What a robust implementation would add: canonical provider-aligned scope identities, preserved coverage-failure explanations regardless of sibling slots, and regression assertions for the counterexamples and exact boundary cases above.

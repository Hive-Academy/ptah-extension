# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 9/10 |
| Assessment | APPROVED |
| Requested verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Batch 37b1b implements truthful, fail-closed diagnostic formatting and forwarding for the opt-in `go vet` checker across `vscode-lm-tools` and pins absolute `.exe` execution in `agent-sdk`. In Part 1, both fixes from the Batch 37b1a review (Moderate 1: aligning the 50-file syntax cap with `go vet` scope and dropping findings for omitted files; Failure Mode 2: routing non-ESRCH POSIX kill errors to `onError`) are committed in `d9baaf969` and verified with regression tests. In Part 2, Batch 37b1b (`668dd181d`) ensures that `goVet` status and reason, `unmappedFindings`, and `diagnosticsTruncated` are forwarded through `core-namespace.builders.ts` on both available and unavailable arms, and rendered through `mcp-response-formatter.ts` with strict O2 §5.4 compliance. A bare "No issues found" verdict cannot be produced when `go vet` did not run, is stale, lacks consent, timed out, was truncated, or reported unmapped findings.

Score justification: Placed in the 9–10 exemplary band because the formatting implementation rigorously fails closed against malformed or out-of-vocabulary inputs, preserves critical coverage and vet limit notices at the top of the output ahead of budget truncation, maintains the 1,000-character compact coverage bound, and includes comprehensive regression tests (68 new formatter test cases, namespace forwarding tests on both arms, and process spawner proof).

## Verification evidence

- Executed Nx run across changed projects: `node_modules\.bin\nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache`. All 6 tasks passed with exit code 0 (agent-sdk: lint, test, typecheck; vscode-lm-tools: lint, test, typecheck).
- Inspected the complete diff of `d9baaf969` (fixes for 37b1a review) and `668dd181d` (Batch 37b1b):
  - `libs/backend/platform-core/src/utils/process-tree-reaper.ts`
  - `libs/backend/platform-core/src/utils/process-tree-reaper.spec.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts`
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts`
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`
- Verified O2 §5.4 exact text matching against `o2-go-vet-consent-surface.md:295-307`.
- Verified budget truncation behavior with `applyToolResultBudget` on 400-finding outputs: `**Coverage:**` and `**Go vet:**` lines precede all diagnostic lists and survive tail truncation.

---

## Part 1 — Verification of Batch 37b1a fixes (commit d9baaf969)

| Finding / Fix | Status | Evidence & Verification |
| --- | --- | --- |
| **Moderate 1: Syntax cap and vet scope agreement:** `go vet` receives only the 50 cap-admitted Go files; findings in capped-out files are dropped so they stay omitted. | **VERIFIED** | In `language-aware-diagnostics-provider.ts:684-693`, `this.runGoVet` is now passed `checked.filter(e => e.language === 'go').map(e => e.file)` (the first 50 files admitted by `SYNTAX_FILE_CAP`), rather than the uncapped `syntaxFiles` list. Furthermore, in `mergeByFile` (`:446-463`), `isOmitted: (file: string) => boolean` filters out any vet findings for files present in `omittedIds` (`omitted.map(e => this.identity(e.file))`). In `language-aware-diagnostics-provider.spec.ts:1515-1558`, regression test `"60 Go files: go vet receives exactly the 50 admitted files; the 10 omitted carry no findings and are omittedByCap"` asserts that `check` is called with exactly 50 files, `checkedFiles` contains 50 files, findings in files 51–60 are dropped, and files 51–60 remain listed in `notChecked` with reason `OMITTED_TEXT` and counted in `coverage.omittedByCap: 10`. |
| **Honesty evaluation of dropping capped-out vet findings:** Are capped-out files honestly disclosed? | **HONEST & VERIFIED** | Yes. A clean vet run of a package directory can report findings in any file in that directory. If findings were reported for file 51 while the provider reported file 51 as "Not checked (covered at most 50 files per call)", the report would be contradictory. Dropping vet findings for files past the 50-file cap ensures that files 51–60 are not credited as checked, carry no results, and are honestly disclosed in `notChecked` and `coverage.omittedByCap`. |
| **Failure Mode 2: POSIX reaper error reporting:** Non-ESRCH kill failures reach `onError`. | **VERIFIED** | In `process-tree-reaper.ts:86-90`, `killGroup` catches errors from `process.kill(pid, nextSignal)`: `if (!isEsrch(error)) onError?.(error)`. ESRCH indicates the process has already exited (expected success), while any other error (such as `EPERM`) leaves the process alive and is reported to `onError`. In `process-tree-reaper.spec.ts:167-195`, two regression tests verify that `EPERM` is forwarded to `onError` and `ESRCH` is ignored. |

---

## Part 2 — Review of Batch 37b1b (commit 668dd181d)

### Five logic questions

#### 1. How does this fail silently?
Nowhere identified. Every non-success outcome, failure, or out-of-vocabulary field in `mcp-response-formatter.ts` qualifies the answer:
- If `goVet` is absent on a Go check, `coverage.checks` is `'syntax-only'`, which prevents `bare` clean answers (`emptyVerdictLine` prints `Errors: 0 | Warnings: 0 in what was checked — not a clean answer (see Coverage)`).
- If `goVet` is malformed (invalid status, negative or non-integer `checkedFiles`, non-string reason), `goVetView` returns `'malformed'`, which adds qualifier `go vet report not recognised (Go files not claimed as vetted)` and sets `goVetLine` to `report not recognised; Go files are not claimed as vetted.` (`:1239-1240, :1283-1285`).
- If `unmappedFindings` is non-integer or unreadable, `checkerLimits` sets `unmapped: 'unknown'`, adding `an unreported number of ... findings could not be placed in the workspace (not listed)` (`:1173-1180, :1254-1257`).
- If `diagnosticsTruncated` is non-false, `checkerLimits` sets `truncated: true`, adding `diagnostics truncated: the ... listed only its first findings, more exist` (`:1184-1186, :1263-1267`).

#### 2. What user action produces unexpected behaviour?
No user action produces unexpected or deceptive behavior:
- If a user runs diagnostics with `go vet` consent off, the formatter renders the exact O2 §5.4 instruction: `Go files were syntax-checked only; go vet is off for this workspace. Enable it in Settings → Tools (desktop app) or run ptah config go-vet on in this workspace.`
- If consent is stale, the user sees: `...consent for this workspace is out of date (<reason>). Re-enable it in...` with reasons mapped to clear human words (`the Go toolchain changed`, `the workspace folder moved`, `the workspace folder was replaced`).
- If a tool result budget cut occurs because thousands of diagnostics are returned, `applyToolResultBudget` cuts diagnostics from the tail; the header `**Coverage:**` and `**Go vet:**` lines remain at the top.

#### 3. What input data produces a wrong answer?
None found.
- Out-of-vocabulary reason codes (e.g. unknown strings) are sanitized via `clip(reason, 40)` and rendered as `reason "..." not recognised`, rather than silently dropped or crashing.
- An empty diagnostics array accompanied by `unmappedFindings > 0` or a non-checked `goVet` status is qualified and never produces "No issues found".

#### 4. What happens when a dependency fails?
- If `diagnosticsProvider.getDiagnostics` returns `unavailable`, `buildDiagnosticsNamespace` in `core-namespace.builders.ts:250-259` forwards `coverage`, `notChecked`, and `checker` (`goVet`, `unmappedFindings`, `diagnosticsTruncated`). In `mcp-response-formatter.ts:541-548`, the `coverageBlock` and `goVetBlocks` are rendered above the `Reason:` block so that even an unbounded compiler failure cut by budget cannot suppress the coverage and vet status.
- If formatting throws an unexpected error, `formatDiagnostics` wraps execution in `try ... catch { return fallbackJson(payload); }` (`:603-605`), preventing agent tool failure.

#### 5. What is missing that the requirements never mentioned?
- Filtering in `getErrors()`: As observed in the executor report, `getErrors()` filters diagnostics to severity `error`. Since `go vet` produces `warning` severity findings, they do not appear in `getErrors()`. However, the formatter still renders the `**Coverage:**` and `**Go vet:**` lines, and the verdict is qualified (never a bare "No issues found"), so this does not mislead the user.

---

## Failure modes

No unhandled failure modes identified. All examined failure paths fail closed and qualify the verdict.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Moderate and minor issues

### 1. Minor / Observation — `packageDirForId` `_test` mapping in `go-vet-output.ts:186`
- **File:** `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-output.ts:186`
- **Context:** Carried from 37b1a review observation. If a physical directory in a Go module is literally named `foo_test` rather than being a Go external test package for directory `foo`, unmapped finding attribution associates with `foo`. This is standard for Go idioms but represents a theoretical edge case.
- **Disposition:** Carry to future clean-up; non-blocking.

---

## Data flow

1. `diagnosticsProvider.getDiagnostics(...)` returns `DiagnosticsResult` containing optional `goVet`, `unmappedFindings`, and `diagnosticsTruncated`: **OK** (`core-namespace.builders.ts:228-235`).
2. `buildDiagnosticsNamespace` extracts `checker` fields and attaches them to `DiagnosticsPayload` on both `available` and `unavailable` arms: **OK** (`:239-289`).
3. `formatDiagnostics(payload)` extracts `checkerLimits(p)`: validates `status`, `reason`, `staleReason`, integer `checkedFiles`, positive integer `unmappedFindings`, and boolean `diagnosticsTruncated`: **OK** (`mcp-response-formatter.ts:533, :1168-1212`).
4. `diagnosticsVerdict` integrates `checkerQualifiers(limits)`: non-checked status, unmapped findings, and truncation each add qualifiers and force `verdict.bare = false`: **OK** (`:833-875, :1236-1269`).
5. `formatDiagnostics` positions `coverageBlock(verdict)` and `goVetBlocks(limits)` immediately under headers and above all diagnostic lists and unavailable reasons: **OK** (`:541-583, :699-710`).
6. `applyToolResultBudget` cuts long outputs from the tail; header, coverage block, and Go vet lines are preserved: **OK** (`mcp-response-formatter.spec.ts:1483-1540`).

---

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| No bare "No issues found" when `go vet` did not run, is stale, lacks consent, timed out, was truncated, or has unmapped findings | COMPLETE | Verified across all statuses and fields; `verdict.bare` requires `qualifiers.length === 0 && typeCheckOnly`. |
| Placement above every list and above unavailable reason | COMPLETE | Rendered directly under the total counts header on available, empty, and unavailable arms. |
| Output survives result budget cut in every arm | COMPLETE | Positioned at output head; tail truncation preserves coverage and vet lines. Tested up to 400 findings. |
| Exact O2 §5.4 user-facing texts | COMPLETE | Fixed strings for `no-consent` and `consent-stale` match O2 §5.4 character for character. |
| Forwarding through `types.ts` and `core-namespace.builders.ts` | COMPLETE | Fields defined in `DiagnosticsPayload` and forwarded on both arms. |
| Process spawner proof for absolute `go.exe` without `cmd.exe` | COMPLETE | Tested on win32 in `off-thread-process-spawner.spec.ts:565-633`. |
| Compact coverage block unchanged (≤ 1,000 chars) | COMPLETE | Verified; compact block excludes `goVet` and stays within Decision 21 bound. |

---

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Unmapped findings with 0 reported diagnostics | YES | `limits.unmapped > 0` qualifies verdict; outputs "N checker findings could not be placed" | None. |
| Malformed `goVet` object (e.g. negative `checkedFiles` or invalid status) | YES | Handled by `goVetView`, returns `'malformed'`, qualifies answer and warns in text | None. |
| Non-integer `unmappedFindings` | YES | Handled as `'unknown'`, qualifies answer as "an unreported number of findings" | None. |
| Output exceeds tool budget (e.g. 2,000 diagnostics) | YES | Truncated from tail; `Coverage` and `Go vet` lines at top remain intact | None. |
| Unrecognized reason code | YES | Clipped to 40 chars and rendered as `reason "..." not recognised`; verdict qualified | None. |
| VS Code diagnostics provider (no `goVet` field) | YES | `goVetBlocks` returns `[]`; no `Go vet:` line rendered (matches O2 §5.3) | None. |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None for this batch. Formatting and spawner adapter contracts are sound and fully verified.
- What a robust implementation would add:
  1. Continue to keep the minor `max-lines` refactoring on `LanguageAwareDiagnosticsProvider` on the backlog for the next appropriate cleanup batch.

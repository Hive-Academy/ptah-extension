# Code Logic Review — `TASK_2026_559_8ca9` Batch 12 (r1, cross-side)

Reviewer: Claude code-logic-reviewer (Lane B cross-side review of Codex CLI author)

## Summary

| Metric              | Value                                  |
| -------------------- | --------------------------------------- |
| Overall score        | 6/10                                    |
| Assessment            | NEEDS_REVISION                          |
| Blocking issues       | 1                                        |
| Serious issues        | 0                                        |
| Moderate issues       | 1                                        |
| Failure modes found   | 2                                        |

The windowing/counting logic inside the changed files (`agent-process-manager.service.ts`, `agent-process.types.ts`) is correct and well tested — I traced every branch (default tail, offset+tail, offset-only, zero/negative/fractional/non-finite tail and offset, trailing-newline and partial-line counting, short-buffer, at/beyond-end offset) by hand against the implementation and it holds up. The one Blocking defect is not in the reasoning of the windowing code itself, it is the widened `AgentOutput` contract breaking a sibling project's test suite that was not in scope for this batch but is verified broken today by the diff as it stands.

## Five logic questions

### 1. How does this fail silently?

- `agent-process-manager.service.ts:900-951`: none found in the windowing arithmetic itself — every early-return path (`lineCount === 0`) returns consistent `totalLines`/`omittedLines`, and I could not construct an input where `lineCount` disagrees with re-deriving line count from the returned text (verified by hand for tail-path and offset-path, trailing-newline true/false, in both branches).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:363-371` and `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1196-1204`: this is the closest thing to a silent failure produced by this batch. `readOutput`'s default now silently narrows a 1,000-line buffer to 200 lines, but neither the dispatcher's structured `toolSuccess` metadata nor `formatAgentRead`'s Markdown expose `totalLines`/`omittedLines`. A caller of `ptah_agent_read` today sees `**Lines:** 200 | **Truncated:** No` with no indication that 800 lines were cut. This is explicitly Batch 13 Task 13.1 scope per `batches.md` ("the formatter prints `Showing lines A-B of N (M omitted...)`"), so it is not a Batch 12 code defect, but it is a real interim silent-narrowing window between the Batch 12 merge and the Batch 13 merge (Decision 17 sequences Batch 13 strictly after Batch 12 merges). Recorded as a failure mode below, not as a blocking defect, per the batch boundary.

### 2. What user action produces unexpected behaviour?

- Any `ptah_agent_read` / `ptah.agent.read` call with no `tail` against an agent with more than 200 lines of combined stdout/stderr now returns less text than before this batch, with no signal to the caller that anything was cut (see above). Before this batch the default was "everything"; the new default is "last 200 lines," which is the intended fix, but the caller-visible indication of the cut lags by one batch.
- No caller passes `offset` yet (`agent-namespace.builder.ts:324`, `agent-tool.dispatcher.ts`, `protocol-dispatcher.ts:1072` all pass only `tail`), so the offset path added here is exercised only by the new unit tests, not by any real caller — expected, since offset plumbing is explicitly Batch 13 scope.

### 3. What input data produces a wrong answer?

- None found in the reviewed files for `readOutput` itself. I specifically tried to break: fractional tail/offset (floored correctly), negative tail/offset (clamped to 0 correctly, confirmed the old `tail && tail > 0` bypass — which let `tail=0` fall through to an unbounded read — is gone), `NaN`/`Infinity` (both routed through `Number.isFinite` to 0), offset exactly at buffer end and past it (both correctly empty), a buffer with only an unterminated final line, a buffer with embedded blank lines, and stdout/stderr independently sized buffers. All produced the values the executor's report claims and that `batches.md`'s specs require (1000→200/800 omitted; offset 0+100→first 100; short buffer→all/0 omitted).
- One correctness caveat worth naming, not a defect: `totalLines` counts only what survives buffer-capacity eviction (`agent-process-manager.service.ts:915-916` operates on the already-adapter-parsed, already-capacity-trimmed `stdout`/`stderr` local variables), not lines ever emitted by the process. This is the documented, accepted design (`truncated` stays the buffer-capacity flag; `totalLines` is scoped to the retained buffer) and matches Decision 2/the Batch 12 quality requirements, but a caller reading `totalLines` as "how much output did the agent produce" would be wrong when `truncated` is also `true`. No caller does this yet.

### 4. What happens when a dependency fails?

- N/A for this batch — `readOutput` has no I/O or external dependency; it operates on strings already held in memory (`tracked.stdout`/`tracked.stderr`) and an already-injected adapter (`adapter.parseOutput`). No new dependency was introduced.

### 5. What is missing that the requirements never mentioned?

- The two `AgentOutput` fixtures at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts:1272-1285` are not updated for the new required fields, and this is not merely a hypothetical: I ran the exact command specified for this review and it fails today (see Verification). The executor's report (`batch-12-executor-report.md:153`) flags this by name and explicitly declines to fix it as "the caller batch's" responsibility. I disagree with leaving it unfixed at merge time: `totalLines`/`omittedLines` are `readonly` **required** fields on `AgentOutput` (`agent-process.types.ts:216-219`), so any code across the repo that builds an `AgentOutput` literal — test fixture or production — now fails to typecheck without them. This is a direct, mechanical consequence of Batch 12's own type change, not new work assigned to Batch 13 (Batch 13 owns *wiring the fields into the formatter's output*, not *making the existing spec file compile*).

## Failure modes

### Cross-project compile break in vscode-lm-tools tests

- Trigger: merging Batch 12's `AgentOutput` type change (`libs/shared/src/lib/types/agent-process.types.ts:216-219`, `totalLines`/`omittedLines` both `readonly` required) onto a tree that still has the two `AgentOutput` literal fixtures in `mcp-response-formatter.spec.ts:1272-1285` without those fields.
- Symptom: `@ptah-extension/vscode-lm-tools:test` fails to compile the entire spec file (`TS2739`), not just the two fixture assertions — 0 of that file's tests run. `typecheck` for the same project passes because it only checks the `src` production surface, not the spec files, which is exactly why the executor's report caveats this ("do not infer that the vscode-lm-tools test suite passes from its production typecheck").
- Evidence: reproduced live in this review —
  ```
  libs/backend/vscode-lm-tools/.../mcp-response-formatter.spec.ts:1272:11 - error TS2739:
    Type '{ agentId: AgentId; stdout: string; stderr: string; lineCount: number; truncated: false; }'
    is missing the following properties from type 'AgentOutput': totalLines, omittedLines
  libs/backend/vscode-lm-tools/.../mcp-response-formatter.spec.ts:1279:11 - error TS2739: [same]
  Test Suites: 1 failed, 68 passed, 69 total
  ```
- Current handling: none — the executor's report records the break and stops, deliberately not touching a file outside Batch 12's assigned scope.
- Recommendation: fix the two fixtures in place (add `totalLines`/`omittedLines` numeric values consistent with each fixture's `stdout`/`stderr`/`lineCount`), rather than making the new fields optional on `AgentOutput`. Optional fields would let Batch 13's formatter (`formatAgentRead`) silently omit the "Showing lines A-B of N" line whenever a caller forgets to populate them, which is exactly the silent-narrowing failure mode this task exists to close. A two-line fixture edit in a file this batch already touches transitively (via the type it owns) is the option that keeps Batch 12 itself green without colliding with whatever Lane A does to `mcp-response-formatter.ts`'s production code in Batch 13 — the spec fixtures are data, not the formatter logic Batch 13 is rewriting.

### Interim silent narrowing between Batch 12 and Batch 13 merges

- Trigger: any `ptah_agent_read`/`agent.read` call with the default (no `tail`) against buffered output over 200 lines, made after Batch 12 merges to `fix/task-559-mcp-tool-contract` but before Batch 13 merges.
- Symptom: caller receives the last 200 lines with `**Lines:** 200 | **Truncated:** No` and no hint that 800+ lines were cut (`mcp-response-formatter.ts:1196-1204`, `agent-tool.dispatcher.ts:367-371`, `protocol-dispatcher.ts:1072` — none of the three surfaces reads `totalLines`/`omittedLines` yet).
- Evidence: `agent-tool.dispatcher.ts:367-371` passes only `agentId`, `lineCount`, `truncated` into the structured metadata; `formatAgentRead` at `mcp-response-formatter.ts:1201-1203` renders only `lineCount` and `truncated`.
- Current handling: none in this batch — correctly scoped to Batch 13 Task 13.1 per `batches.md`, and the risk was explicitly named as a validation note for Batch 12 ("re-check agent-tool.dispatcher... and report whether it is affected" — yes, it is affected, in exactly the way this row describes).
- Recommendation: no change to Batch 12; ensure Batch 13 lands promptly given Decision 17's sequencing (13 depends on 12 merging first), since every `ptah_agent_read` default call in between silently narrows without saying so.

## Blocking issues

### `AgentOutput` fixtures make `@ptah-extension/vscode-lm-tools:test` fail to compile

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts:1272,1279`
- Scenario: this diff is merged as-is; anyone runs `nx run @ptah-extension/vscode-lm-tools:test` (or CI does).
- Impact: the entire `mcp-response-formatter.spec.ts` suite (68 other passing test suites in the project are unaffected, but this one file's ~dozens of `formatAgentRead`/related cases) fails to run at all, not just the two literals — a real CI break attributable to this batch's own required-field type change.
- Fix: add `totalLines` and `omittedLines` numeric values to both fixtures at `:1272-1278` and `:1279-1285`, consistent with each fixture's `lineCount` (e.g. `withOutput` could use `totalLines: 3, omittedLines: 0`; `withoutOutput` `totalLines: 0, omittedLines: 0`).

## Serious issues

None found in the files under review.

## Moderate and minor issues

- Moderate: `agent-tool.dispatcher.ts:367-371` / `mcp-response-formatter.ts:1196-1204` do not yet surface `totalLines`/`omittedLines` (tracked as Batch 13 Task 13.1; see failure mode above — flagged here only so it is not lost between reviews).
- Minor: `agent-process.types.ts` diff also reflows three unrelated union type declarations onto single lines (`AgentStatus`, `AgentMessagingMode`, `LaneCompletionVerdict`) as a side effect of Prettier after adding the two new `AgentOutput` fields. Purely cosmetic and outside code-logic scope (noted so code-style-reviewer doesn't need to rediscover it).

## Data flow

1. `readOutput(agentId, tail?, offset?)` looks up the tracked agent; throws on unknown id (`agent-process-manager.service.ts:891-894`) — OK, unchanged.
2. Raw `tracked.stdout`/`tracked.stderr` are read, then passed through `adapter.parseOutput` if present (`:895-899`) — OK, unchanged ordering (parse before window/count, as the executor's report claims).
3. `limit`/`start` are normalized via floor+clamp-to-zero over `Number.isFinite` (`:913-916`) — OK, verified against all listed edge values.
4. `windowStream` computes `totalLines` from the parsed text via `countNewlines` plus a partial-line correction, then computes `lineCount` as `min(limit, max(0, totalLines - start))` — OK, verified consistent with re-deriving line count from the returned windowed text in every branch I traced.
5. Tail branch reuses `tailLines`, compensating for its trailing-empty-split-element behavior; offset branch slices `text.split('\n')` directly and reattaches a trailing delimiter only when the window doesn't reach a natural non-terminated end — OK, verified round-trips to the exact original substring in every case traced.
6. `lineCount`/`totalLines`/`omittedLines` are summed across stdout+stderr; `truncated` is passed through unchanged from `tracked.truncated` — OK, matches the "truncated keeps its buffer-capacity meaning" requirement.
7. Result flows to `agent-namespace.builder.ts:324` → `agent-tool.dispatcher.ts` / `protocol-dispatcher.ts:1072` → `formatAgentRead` — gap: the new counters are computed correctly but not yet displayed (Batch 13 scope, see failure modes).
8. Result flows to `mcp-response-formatter.spec.ts:1272-1285` fixtures — broken: those fixtures don't satisfy the new `AgentOutput` shape, so this arm of the flow doesn't even compile today (Blocking issue above).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `readOutput(agentId, tail?, offset?)` | COMPLETE | — |
| Default = last 200 lines per stream, `DEFAULT_AGENT_READ_TAIL_LINES` | COMPLETE | — |
| `offset` + `tail` forward window | COMPLETE | — |
| `AgentOutput` gains `totalLines`/`omittedLines` | COMPLETE in the type/service; BREAKS a downstream fixture | vscode-lm-tools spec fixtures not updated (Blocking issue) |
| `lineCount` = lines returned | COMPLETE | — |
| `truncated` keeps buffer-capacity meaning | COMPLETE | — |
| Default never hides the end | COMPLETE | — |
| Every caller checked (agent-tool.dispatcher and others) | COMPLETE (audit) | Display of new counters deferred to Batch 13, as planned |
| Specs: 1000→200/800 omitted; offset 0+100→first 100; short buffer→all/0 omitted | COMPLETE | Verified by hand and via executor's red-run evidence |

Implicit requirements not addressed: none beyond the fixture break above — the batch's own file scope (`agent-process.types.ts`, `agent-process-manager.service.ts`, its own spec) is internally consistent and complete.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Tail 0 | YES | Clamped to empty (old code let `tail=0` bypass windowing entirely and return the full buffer — this is an intentional, documented behavior change) | None — no current caller can pass `tail=0` (schema requires positive integer per executor's report) |
| Negative / NaN / Infinity tail or offset | YES | `Number.isFinite` + `Math.max(0, Math.floor(...))` | None |
| Fractional tail/offset | YES | Floored | None |
| Offset at/beyond stream end | YES | Empty result, `omittedLines = totalLines` | None |
| stdout/stderr independent windows | YES | `windowStream` called separately per stream | None |
| Trailing newline / unterminated final line | YES | `trailingNewline` flag adjusts both `totalLines` and the `tailLines` budget | None |
| `totalLines` vs. buffer-capacity truncation | YES (by design) | `totalLines` scoped to retained buffer, `truncated` stays separate | Caller cannot currently distinguish "windowed away" from "evicted by capacity" loss from the counters alone — acceptable per this batch's explicit contract |
| Caller-visible omission indicator | NO (by plan) | — | Deferred to Batch 13 Task 13.1; real interim gap during the merge window between 12 and 13 |

## Verification performed

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/cli-agent-runtime @ptah-extension/shared --skip-nx-cache` — exit 0, all 6 tasks passed.
- `node_modules/.bin/nx run-many "-t=typecheck,test" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` — **typecheck passed, test FAILED**: `mcp-response-formatter.spec.ts` suite failed to compile (`TS2739` at `:1272` and `:1279`); 68 other suites / 1712 other tests in the project passed. This reproduces and confirms the executor's flagged risk.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — exit 0, `TOTAL 300 unsuppressed site(s)` (baseline unchanged).
- `mcp__ptah__ptah_get_diagnostics` scoped to the two changed source files — 0 errors, 0 warnings.
- Manual hand-trace of `windowStream` (tail path and offset path) against: default 1000-line buffer, independent stdout/stderr sizes, offset 0 + tail 100, offset-only, offset at/past end, tail 0/negative/fractional/NaN/Infinity (with and without offset), unterminated final line, embedded blank lines, short buffers. All matched the executor's claimed outputs and the acceptance-criteria specs in `batches.md`.
- Did not re-run the "red before green" regression independently (would require modifying the worktree, which is read-only for this review); relied on the executor's report's own captured red-run output (`batch-12-executor-report.md:41-47`) plus my own hand-trace confirming the old two-argument implementation could not have produced `totalLines`/`omittedLines` or a 200-line default at all.
- Did not run `ptah-cli`/`ptah-electron`/`degradation-audit` beyond the one command specified; did not re-run Electron `validate-deps` (not requested for this review's verification tail list).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: merging this diff as-is breaks `@ptah-extension/vscode-lm-tools:test` in CI today, via a required-field type change this batch itself introduces, in a file the executor's report explicitly identified and chose not to fix.
- What a robust implementation would add: (1) update the two `mcp-response-formatter.spec.ts` fixtures so this batch is self-contained and green in isolation; (2) nothing else — the windowing/counting logic itself is correct, thoroughly covered by the new spec block, and matches every acceptance-criteria case in `batches.md`.

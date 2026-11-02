# Batch 7 report - TASK_2026_857_f660

Executor: backend-developer subagent. Worktree `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`. No git was run.

## Tasks

### Task 7.1: kind resolution explicit, then mapped, then classified (async after insert), then unclassified. COMPLETE

- `task-kind-mapping.ts` owns `taskKindForRole(role)`. It does a case-insensitive exact match (trimmed) over the phase and task kinds and the agent slugs in plan Component 6. Anything else returns null, including `general-purpose`, `Explore`, `unknown` and `''`. It has no fuzzy matching and no fallback kind.
- The recorder's `resolveTaskKind(explicit, role)` sets `taskKind` and `taskKindSource` on every lane and subagent row. The order is explicit, then mapped, then null with `unclassified`. `LaneCompletionOutcomeInput` still omits `taskKindSource`.
- `recordLaneCompletion(input, transient = {})` takes the transient `{ brief?: string }`. A brief is stashed only when all of these hold: the row is `unclassified`, a `LaneTaskKindClassifier` is injected (the new optional 5th constructor argument), and the brief is not blank. The brief is cut to 4000 chars and kept in a map bounded to 200 entries, with the oldest dropped. The completion path makes no classifier request.
- `onLaneRecordInserted(row)` runs after insert. It first runs the existing failure classification, then for an unclassified row calls `classifyTaskKind`. That method takes the brief out of the map before the call, so each run gets at most one request. Then it runs `void classify().then(setClassifiedTaskKind).catch(warn {runId, code})`, which follows the failure-classifier pattern. A null result or a rejection leaves the row unclassified. An explicit or mapped row drops its brief.
- Evidence (specs in `lane-outcome-recorder.service.spec.ts`):
  - explicit and mapped rows make zero classifier calls;
  - with no classifier (model unset), with no brief, or with a blank brief, there are zero calls;
  - an unclassified row is inserted before the classifier settles. It is then classified once with a 4000-char brief and becomes `classified`, and the stored row holds no brief text;
  - a duplicate completion makes no second call;
  - a null kind causes no `setClassifiedTaskKind`;
  - a rejection logs `{runId, code}` only;
  - with 201 briefs, the oldest is evicted (200 calls, `lane:b0` absent);
  - a type-level check confirms that `'taskKindSource'` is not a key of the input;
  - there is a table of mapping cases.

### Task 7.2: subagent producers, one row per `subagent:<agentId>`. COMPLETE

- Both producers build on the exported `reportedSubagentStopRow(agentId, nowMs)`. That row is unclassified, `unverified`, `telemetryJoin 'unavailable'`, with all join fields null. Each producer then fills in its facts and role, and resolves the kind through the mapping.
- `recordSubagentStop(payload)` handles the nullable B5 payload. `recordSubagentEnded(event)` (new) sets `parentSessionId = event.sessionId`, `workspaceRoot = event.cwd` and `subagentSessionId = null`. When the kind is unresolved, it stashes `lastAssistantMessage` (first 4000 chars) as the brief.
- Dedupe: the recorder remembers the run IDs it has enqueued (a bounded map of 200). The first producer enqueues `subagent-stop`. A later producer for the same run enqueues nothing. Instead it calls `enrichSubagentRun`, which does the following after `pipeline.flush()`:
  1. `store.fillMissingSubagentJoin`, which fills null fields only.
  2. If the stored row is still `unclassified`, a classification using the brief the later producer supplied.
  3. A brief for a row that cannot be read yet stays stashed for the insert callback.

  If the run was evicted from the memory map, the duplicate is enqueued again, and `insertStopWithHeldReports` returns `inserted: false`. The result is still one row.

- Evidence (specs):
  - stop-first writes one row (`insertStopWithHeldReports` called once) and the stop's joins win;
  - ended-first writes one row, and the later stop fills `subagentSessionId`;
  - a stop with all metadata null still yields a row;
  - the ended-row shape matches the plan;
  - an unmapped subagent is classified once from the later producer's message, truncated to 4000;
  - a mapped subagent with a message is not classified;
  - the external-caller row shape matches the plan.

### Task 7.3: review capture through a strict verdict-line parser and an explicit reviewed-run reference. COMPLETE

- `review-verdict.parser.ts`, `parseReviewDeliverable(text, reviewerRunId)`:
  - The grammar is in the file's doc comment. A `Reviewed-Run:` line takes the plan's character class and 1-200 chars, with an optional backtick, bullet or bold, and nothing may follow it. `Verdict:` lines (bullet, heading or bold allowed) take `APPROVED|REVISE|REJECTED` with `\b`. Matching is case-insensitive and CRLF-safe.
  - Returns `{ reviewedRunId, verdict }` or one of the refusals `no-target | no-verdict | ambiguous | self-review | too-large`.
  - More than one distinct reviewed run, or conflicting verdicts, is `ambiguous`.
  - Text over `REVIEW_DELIVERABLE_MAX_CHARS = 3 * 64 KiB` is refused before it is scanned.
- `LaneOutcomeRecorder.captureReview({ reviewerRunId, text })`:
  - On a refusal it logs `warn('Review capture refused', { reviewerRunId, refusal })` and changes no row.
  - On success it calls `attachReview(target, verdict, { reportId: deterministicReviewReportId(reviewed, reviewer) })`. `attachReview` gains an optional `reportId` and keeps its random UUID by default.
  - When the submission is not ok, it logs `Review capture not applied` with IDs and the pipeline error constant.
- `recordSubagentEnded` captures from `lastAssistantMessage` when the mapped kind is `review`. The capture is fire-and-forget, and its `.catch` warns `{reviewerRunId, code}`.
- Evidence:
  - `review-verdict.parser.spec.ts` covers case variants, bullets, bold forms, the heading form, backticks, CRLF, agreeing repeats, every refusal, a rejected over-long ID, free-form praise refused, and the size bound.
  - The recorder specs show:
    - a review subagent's `REVISE` increments `reviseRounds` once, and a replay is still 1, with receipt `review:lane:target|subagent:reviewer-1`;
    - an `APPROVED` lane capture sets `finalReview`;
    - each refusal leaves the target row deep-equal to before and logs no text;
    - a non-review subagent's message is never parsed.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\task-kind-mapping.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\review-verdict.parser.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\review-verdict.parser.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.spec.ts`

All five files are UTF-8 without a BOM (first bytes checked) and contain no `â€` mojibake.

## Risks and edge cases

- R1 (foreign red checks): the only red check is the degradation audit in lane-routing (B6, see below). It is reported here and was not touched.
- R7 (the recorder rewrite stays minimal for others): the constructor is additive (an optional 5th argument), and `recordLaneCompletion` and `attachReview` gain optional parameters only. `register.ts`, `start.ts` and cli-agent-runtime compile unchanged, and lane-outcomes typecheck passes.
- R11 (unwired in Phase A): the specs use the real `OutcomeWritePipeline` and `InMemoryLaneOutcomeStore`.
- R12: the new `.catch` handlers all log. The plan's marker sits on the task-kind `.catch` and did not orphan: the audit lists no orphan in lane-outcomes, and lane-outcomes is not in the FAIL list.
- An unclassified run with no decision model makes zero calls and the row stays `unclassified` (spec).
- A subagent stop without a transcript or parent still writes a row (spec).
- The same subagent stop from two producers writes one row, in either order (spec).
- A review with no target or no verdict changes no row and logs a diagnostic with a code only (spec).
- Privacy: rows, logs and receipts carry IDs, codes and verdict enums only. Briefs and messages live only in the bounded in-memory map until they are taken or evicted.

## Verification

- `npm run verify -- -p @ptah-extension/lane-outcomes 2>&1 | tail -40` gave lint, test and typecheck as 3/3 succeeded, `lock released after 50.5s, exit code 0`. The run before the last fix had 223 tests with 1 failure (an artefact of the drain batch size in the brief-bound spec); after the fix all of them pass.
- `npm run verify -- -t lint -p degradation-audit` FAILED, but not in this batch's files:
  ```
  libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts:59 [catch-return-sentinel] catch swallows error and returns a literal
  libs/backend/lane-routing: 1 FAIL (baseline 0)
  ```
  That file is B6 (committed d3ed06092), and it is outside B7's file list. lane-outcomes does not appear in the FAIL list.

## Decisions

| #   | Decision                                                                                                                                                                                       | Options                                                                              | Evidence                                                                                                                                              | Reversible |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Keep the method name `onLaneRecordInserted` but make it general, so it handles every row kind. The plan's rename to `onRecordInserted` is deferred to B8/B9.                                   | rename now and break `di/register.ts:69` (B9-owned, outside the list); keep the name | `register.ts:66-69` and the pipeline constructor parameter `outcome-write-pipeline.ts:170` (B8) both use the old name                                 | yes        |
| 2   | `parseReviewDeliverable(text, reviewerRunId)` takes the reviewer as its second argument                                                                                                        | the plan's one-argument signature, with the self-check done in the recorder          | the `self-review` refusal is defined by the parser's result union in the plan                                                                         | yes        |
| 3   | Add the refusal `too-large` (text over 3 × 64 KiB)                                                                                                                                             | trust the caller's bound only                                                        | batches.md Task 7.3 "≤ 64 KiB per file, ≤ 3 files"; plan :579                                                                                         | yes        |
| 4   | Implement `reportedSubagentStopRow` in B7 and reuse it as the base for both producer rows                                                                                                      | leave it to B11                                                                      | plan Component 6 lists it under the recorder; this removes one row-literal duplicate                                                                  | yes        |
| 5   | The second producer enriches after `pipeline.flush()` with `fillMissingSubagentJoin`. When the later producer brings the brief, it also classifies, and take-on-use keeps that to one request. | change the pipeline (B8)                                                             | the pipeline's subagent-stop path ignores `inserted: false` (`outcome-write-pipeline.ts:608-619`); the store already offers null-only enrichment (B3) | yes        |

## Out-of-scope observations

1. The degradation audit fails at `libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts:59` (B6). It needs a `// degradation-audit: reported - ...` marker or a logged catch. Not touched.
2. B8: `OutcomeWritePipeline.apply` does not call the insert callback for `subagent-stop` rows (`:608-619`). Until it does, a subagent whose first producer brings the brief is classified only when the callback fires. The spec calls `onLaneRecordInserted` directly to cover this seam. The B8 single-insert-path task should fire the callback when `result.inserted` is true, and B8/B9 can rename the callback in `outcome-write-pipeline.ts` and `di/register.ts` together.
3. B9: the barrel (`src/index.ts`) should export `taskKindForRole`, `reportedSubagentStopRow`, `parseReviewDeliverable` and `LaneCompletionTransient`. B9 should also pass `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` as the recorder's 5th constructor argument in `di/register.ts`, and subscribe `recordSubagentEnded` to `SdkAdapterEvents.subagentEnded`.
4. A brief stashed for a duplicate lane completion, where the row already exists and no insert callback runs, sits in memory until eviction. The map is bounded at 200, so this is acceptable. A later batch could drop it on a duplicate insert.

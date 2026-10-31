# Phase A fix round 2 - TASK_2026_857_f660

Scope: decisions.md row 26. Findings 2, 4 and 3 of code-logic-review-phase-a-round2.md are fixed.
Finding 1 is deferred by row 26, so `report-effect.ts` is unchanged. The notifier `detail` log is
also unchanged.

## Finding 2 - an early bare-agent-id review joins the later row

- `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:27-41`: new
  `heldReportJoinsRow(report, row)`. A held report joins a row when it is held under the row's
  run id, or when it is a `review` held under the row's bare `agentId`.
- `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts:199-205`:
  `insertStopWithHeldReports` selects
  `run_id = ? OR (run_id = <row.agentId> AND kind = 'review')` and retargets each joined report
  to the inserted run id. The receipt and the effect therefore land on that row. The held row is
  deleted on its first join, so it reaches at most one row, and a second run of the same agent
  finds nothing.
- `libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.ts:52-57`: the same
  predicate and retarget. The key-value store inherits it through `super`.
- `libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts`:
  - `advanceIndex` (~:578-583): a row insert drops the journal `heldRuns` entry for its run id
    and for its bare agent id. The journal index then agrees with the store join.
  - `applyReport` (~:679-697): a review whose target is `missing` is looked up once with
    `store.findLatestByAgent(report.runId)`. If a row is found, the review is applied to that run.
    This closes the race in which the caller resolved the bare id before the row landed. Inserts
    run only in the serialized drain, so no later insert would take that hold.
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:359-362`: comment only.
  The host capture already holds an unknown bare id unchanged, and that now joins.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:121-125`:
  an agent-target review of an unseen agent is held under the bare agent id instead of
  `subagent:<id>`. Deliverables keep `subagent:<id>`, because the pipeline holds deliverables only
  for subagent runs. The `externalSubagentAgentId` path is unchanged.
- Self-review refusal, receipts and dedupe are unchanged. The report id of a bare-id hold stays
  `review:<agentId>|<reviewer>`.

## Finding 4 - every review has an attributable reviewer

- `outcome-report.tool.ts:141-157`: the reviewer is `getCallerAgentId()`, then
  `args.reviewerRunId`, then `session:<getCallerSessionId()>`. With none of them, the tool returns
  `{ recorded: false, reason: 'reviewer identity required' }` before any write.
- `isSelfReview` runs for every review. `reviewerIdentity('session:<id>')` stays as written, so a
  session reviewer is never confused with an agent.
- A review always gets `deterministicReviewReportId`. `randomUUID()` is used only for deliverables
  (`:206-210`).

## Finding 3 - no raw SDK error text in logs

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:703-708`:
  the log is now `logger.error('[PtahCliStreamLoop] spawnAgent query error', { errorClass })`.
  `errorClass` is `error.constructor.name`, or `typeof error` for a non-Error value. The
  sanitized display segment is unchanged.
- Prettier also reflowed three lines in this file that were not formatted before (:301, :495, :823).
  There is no behavior change.

## Specs

- `libs/backend/lane-outcomes/src/lib/write/outcome-early-review.integration.spec.ts`. Each test
  runs on both the in-memory and the SQLite store.
  - :195 A bare-id `REVISE` is held first, then the lane row `implementer:<t1>` is inserted. The
    result is `reviseRounds: 1`, with a receipt and no holds. A second run `implementer:<t2>` has
    `reviseRounds: 0`.
  - :238 A bare-id `APPROVED` is held first, then the `subagent:helper` row is inserted. The result
    is `finalReview: approved`.
  - :262 A bare-id review is submitted after the lane row already exists (the race). It applies to
    that row and leaves no hold.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts`:
  - :444 An anonymous review is refused with `reviewer identity required` and never reaches
    `submit`.
  - :488 A review with only a session identity gets the id `review:...|session:ptah-session`. A
    second identical call reuses that id and `reviseRounds` stays 1.
  - :518 A tool review targeting an unseen agent is held under `implementer`. It joins the later
    lane row.
  - Existing review cases now pass `reviewerRunId`: the concurrent same-slug case, the held-before-stop
    case and the closed-store case. In the concurrent case each verdict has its own reviewer,
    because the same reviewer agent would now dedupe by design (row 25).

## Checks

- `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools`:
  the header reads "Running targets lint, test, typecheck for 3 projects". It ended with
  "Successfully ran targets lint, test, typecheck for 3 projects" and exit 0.
  - Tests passed: 260/260, 2816 passed with 1 skipped of 2817, and 3311/3311. The http-server port
    flake did not occur.
  - Lint had 0 errors. One warning is in a touched file: `outcome-write-pipeline.ts` max-lines,
    724 against 700. The file was already about 707 lines and over the limit before this round.
  - The first run failed on one TS2345 error: a closure narrowing in the in-memory store. I fixed
    it with a `const target`, and the re-run above passed.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`:
  4 tasks, 4 succeeded, exit 0.
- `npm run verify -- -t lint -p degradation-audit`: 1 task succeeded as an Nx cache hit, exit 0.
  No catch was added.
- `npx prettier --write`, then `npx prettier --check`, on all 9 touched files: all files pass.

## Files touched

- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-early-review.integration.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/phase-a-fix-round2-report.md (this report)

No new Nx edges were added. All imports are lib-internal or go through existing barrels.
`rpc-handlers`, `apps/`, `batches.md`, `task.md` and `report-effect.ts` are untouched.

## Left undone and notes

- Finding 1 (a per-turn review event id) is deferred by row 26.
- An ambiguous bare id is still refused only at resolve time (recorder and tool). When a lane row
  and a subagent row of the same agent both land after the hold, the first insert takes the
  review.
- The tool description still tells reviewers to supply `reviewerRunId`. I did not change it, so the
  description assertions stay stable.
- Process note: I ran two read-only git commands (`git status`/`git diff --stat` and
  `git stash list`) to inspect the diff. Nothing was staged, stashed or changed.

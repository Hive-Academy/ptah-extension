# Phase A fix round 1 - TASK_2026_857_f660

Status: done, verified. Scope per decisions.md row 25. A first executor did most of the
work and was stopped before verification. This round finished it, fixed a gap in F12, and
ran every check.

## Fix items

Paths are relative to the worktree `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`.

### F1 + style 1: review capture reader (absolute paths, `continue`, shared limits)

- New `libs/backend/cli-agent-runtime/src/lib/cli-agents/review-deliverable.reader.ts:50`
  `readReviewDeliverables(checks, roots, deps)`. It takes the completion signal's absolute
  deliverable paths. Containment is checked only on the realpath, against realpathed roots
  (`:72-80`, `isPathWithinRoots` from platform-core). The roots are the working directory and
  the task folder. A missing, empty, stale, oversize, outside-root or unreadable file is
  skipped with a code and the loop goes on (`continue`). Only the files that were read are joined.
- Limits come from lane-outcomes:
  `libs/backend/lane-outcomes/src/lib/review-verdict.parser.ts:41-45`
  (`REVIEW_DELIVERABLE_MAX_FILES`, `REVIEW_DELIVERABLE_MAX_FILE_CHARS`, and
  `REVIEW_DELIVERABLE_MAX_CHARS` derived from them). They are exported from
  `libs/backend/lane-outcomes/src/index.ts:57-61`. The literal `64 * 1024` and the
  `.slice(0, 3)` are gone from the notifier.
- `lane-completion-notifier.service.ts:728-755` `captureReview` now only delegates and logs
  skip codes. It never logs paths or text. The hand-written
  `isAbsolute || win32.isAbsolute || drive` chain is removed.
- The single review predicate is `LaneCompletionNotifier.capturesReview` (`:715`). It uses
  `resolveTaskKind` (moved to `libs/backend/lane-outcomes/src/lib/task-kind-mapping.ts:63`),
  which is the same rule the recorder uses.
- Pinned by: `review-deliverable.reader.spec.ts:40` (absolute path), `:51` (missing, empty and
  stale files skipped, reading continues), `:77` (outside root, next file still read), `:94`
  (F9 symlink escape), `:103` (oversize by stat size and by read length), `:128` (unreadable),
  `:140` (file count limit from lane-outcomes), `:160` (task folder root). Notifier:
  `lane-completion-notifier.service.spec.ts:1150` (real absolute file captured end to end).

### F2: freshness and verdict gate

- `capturesReview` (`lane-completion-notifier.service.ts:715`) skips capture when
  `signal.verdict` is `failed` or `no-deliverable`, or when there are no deliverables. The
  reader reads only `exists && bytes > 0 && writtenAfterSpawn !== false` entries
  (`review-deliverable.reader.ts:62-66`). A continuation that did not rewrite the file is
  stale and is not read.
- A continuation that rewrites the same review would get a new `${agentId}:${completedAt}`
  reviewer run id. `deterministicReviewReportId`
  (`libs/backend/lane-outcomes/src/lib/write/report-effect.ts:64`) now keys the review by the
  reviewer agent (`reviewerIdentity`, `:43`). Both endings therefore share one report id and
  one receipt, so the review is counted once.
- Pinned by: `lane-completion-notifier.service.spec.ts:1164` (failed run), `:1175` (stale
  file), `:1186` (`no-deliverable` verdict, added this round), `:1201` (non-review kind).
  `lane-outcome-recorder.service.spec.ts:786` covers a continuation that ends twice and counts
  one `revise`. `report-effect.spec.ts:108` covers the reviewer identity.

### F3: `Reviewed-Run` accepts a bare agent id

- `lane-outcome-recorder.service.ts:363` `resolveReviewedRun` tries
  `store.get(subagentRunId(id))` and `store.findLatestByAgent(id)`, the same way
  `outcome-report.tool.ts` does. Both present means `ambiguous`. A subagent row wins, then the
  lane row. An unknown id is kept as written, so the review is held. A store error keeps the
  id as written, logged with a `degradation-audit: reported` comment. `captureReview`
  (`:321-339`) attaches the review to the resolved run id. It refuses self-review on both the
  run id and the resolved agent id. The parser doc names the bare agent id form
  (`review-verdict.parser.ts`).
- Pinned by: `lane-outcome-recorder.service.spec.ts:723` (latest lane run), `:733` (subagent
  first), `:747` (unknown id held), `:757` (ambiguous), `:772` (bare id that resolves to the
  reviewer itself is refused).

### F4: classify once per run

- `lane-outcome-recorder.service.ts:138` `taskKindAttempted` is a bounded map, capped by
  `rememberBounded` (200). `classifyTaskKind` (`:499-518`) checks the map and marks the run
  before the request. `stashBrief` (`:456-475`) does not stash for a run that was already
  attempted.
- Pinned by: `lane-outcome-recorder.service.spec.ts:586` (a repeated `subagentEnded` after a
  null kind sends one classifier request).

### `authMatched` reset in `continueConversation`

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:2245`
  sets `tracked.authMatched = undefined;` next to `rateLimitMatched = undefined` (`:2242`).
- Pinned by: `agent-process-manager.service.spec.ts:2094` (an auth match from turn 1 is not
  reported for a stopped continuation).

### Style 3: barrel surface

- Removed `parseReviewDeliverable`, `LaneCompletionTransient` and `taskKindForRole` from
  `libs/backend/lane-outcomes/src/index.ts`. A grep of `libs/` and `apps/` outside
  `libs/backend/lane-outcomes/src/lib/` finds no consumer of the three, and the notifier now
  uses `resolveTaskKind`. Added `resolveTaskKind`, `isSelfReview`, the three limit constants
  and `StartLaneOutcomesOptions`, each of which has a consumer outside the lib.
- This also clears the known compile error, `lane-outcome-recorder.service.ts:24 TS2305
'resolveTaskKind'`: the recorder now imports `resolveTaskKind` from `./task-kind-mapping`,
  where it is defined and exported. All typechecks below pass.

### Style 5: one options interface

- `libs/backend/lane-outcomes/src/lib/di/start.ts:61` `export interface
StartLaneOutcomesOptions { readonly observeSubagentEnded?: boolean }` is used by both
  `startLaneOutcomes` and `startAndRegisterLaneOutcomes`. Nothing sets the flag yet
  (batches 21.1, Phase B), so the branch is unused until then.

### Style 2: formatting

- `npx prettier --write`, then `--check`, on all 19 touched `.ts` files, including
  `lane-routing/src/lib/di/register.ts`,
  `lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts` and
  `shared/src/lib/types/lane-outcome.types.ts`. Result: "All matched files use Prettier code
  style!"

### Spec hygiene

- `lane-completion-notifier.service.spec.ts` (review-capture harness): the new
  `as unknown as IFileSystemProvider` was replaced. The harness is now a typed
  `Pick<IFileSystemProvider, 'exists' | 'stat' | 'readFile'>`, passed with one narrowing cast.
  Older harnesses in that file still use the pattern; they predate this task and were left alone.

## F12 conclusion

Real, partly fixed by the first executor and completed in this round.

1. Self-review through the tool. The first executor added a refusal
   (`outcome-report.tool.ts:138-146`, `isSelfReview`). It only applied when the caller passed
   `reviewerRunId`, which the schema makes optional.
2. Double `revise` count. Host capture keys a review by
   `deterministicReviewReportId(reviewed, reviewerLaneRunId)`. Before this round the tool used
   the caller's `reviewerRunId` string, or a random UUID when it was absent. A lane reviewer
   that called `ptah_outcome_report` without `reviewerRunId` and was also host-captured got
   two report ids and two receipts, so `reviseRounds` was incremented twice. With the id
   reduced to the reviewer agent (`reviewerIdentity`), a tool call that names its agent id
   pairs with host capture. A call without the field did not.
3. Fix in this round: `outcome-report.tool.ts:141-146`. The reviewer is
   `getCallerAgentId() ?? args.reviewerRunId`. The caller agent id comes from the agent's MCP
   URL (`mcp-request-context.ts:92`) and outranks the claimed value. Every lane review call now
   has a reviewer identity, so it shares host capture's report id (`:205-207`). The
   self-review refusal also covers a lane that leaves the field out or names a different
   reviewer. Calls with no MCP agent context, such as the main session or external callers,
   behave as before.
4. Pinned by: `outcome-report.tool.spec.ts:490` (explicit self-review, no write), `:507`
   (explicit reviewer pairs with the host id), `:531` (added: a caller-agent review without
   `reviewerRunId` gets the host report id, a caller reviewing its own run is refused, and
   `reviseRounds` stays 1), and `report-effect.spec.ts:118` (host and tool ids pair).

Residual, not fixed here: a non-lane caller that sends no `reviewerRunId` still gets a random
report id. No host capture exists for such callers, so nothing is double-counted.

## Files touched

Every path touched by this fix round, including the first executor's edits:

- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/review-deliverable.reader.ts (new)
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/review-deliverable.reader.spec.ts (new)
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/di/start.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/review-verdict.parser.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/task-kind-mapping.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/report-effect.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/report-effect.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/di/register.ts (format only)
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/task-kind/decision-model-task-kind-classifier.ts (format only)
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/shared/src/lib/types/lane-outcome.types.ts (format only)
- D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/phase-a-fix-report.md (this report)

Not part of this round, even though they are uncommitted in the worktree:
`libs/backend/rpc-handlers/src/lib/chat/tokens.ts` and
`libs/backend/rpc-handlers/src/lib/chat/host-routing/` belong to another batch and were not
touched.

## Verification

- `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools,@ptah-extension/lane-routing`.
  lane-routing was added because two of its files were reformatted. Result:
  `12 tasks: 12 succeeded, 3 cached`, exit code 0 (lint, test and typecheck x4). The
  http-server port flake did not occur.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`:
  `4 tasks: 4 succeeded`, exit code 0.
- `npm run verify -- -t lint -p degradation-audit`: `1 task: 1 succeeded`, exit code 0.
- `npx prettier --check` on all 19 touched `.ts` files: "All matched files use Prettier code
  style!"

## Decisions

| Decision                                                                   | Options                                  | Evidence                                                                                                                                                         | Reversible |
| -------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The tool's reviewer identity is `getCallerAgentId() ?? args.reviewerRunId` | keep args only; caller first; args first | F12 is real only when `reviewerRunId` is absent or claimed; the MCP URL agent id is host-minted (`mcp-request-context.ts:92`) and is the id host capture keys on | yes        |
| The review report id is keyed by reviewer agent, not reviewer run          | per run (old); per agent                 | F2 scenario B and F12 double count. No release has shipped with the old id format; only this branch's held receipts are affected                                 | yes        |
| `taskKindForRole` was dropped from the barrel as well                      | keep; drop                               | No consumer outside lane-outcomes after the notifier moved to `resolveTaskKind`                                                                                  | yes        |
| lane-routing was added to the verify scope                                 | prompt list only; add it                 | Its files were reformatted, so its lint, test and typecheck had to run                                                                                           | n/a        |

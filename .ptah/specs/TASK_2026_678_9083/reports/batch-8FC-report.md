# Batch 8FC report

## Changes

- 8FC.1, style S2: removed `rosterIsLaunchableLocally`; shape checks remain in `proposalShapeIsValid`, and launchability uses the Tribunal rule (`libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts:64-80`).
- 8FC.1, style S3: Zod enums and round bound now use shared CLI, Tribunal role/move, and round-cap constants; one `AT_LIMIT_STATE` is used (`tribunal-roster-proposal.ts:1-31`).
- 8FC.1, logic S5: required `ProposalAvailability` and CLI-aware ranker/parser filter disabled, exhausted and missing lanes; `rosterIsAvailable` supports confirm-time checks (`tribunal-roster-proposal.ts:33-127`).
- 8FC.2, logic S1: `confirm` keeps open/answered entries retryable until launch succeeds, shares an in-flight promise, reports fixed failure messages, retains task and run IDs, and rolls back a failed send (`libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:16-255`).
- 8FC.2, logic S2: duplicate pending IDs decline the new question and retain the first (`tribunal-run-coordinator.ts:75-102`).
- 8FC.2, TL-2: role-less manifest lanes omit `role` (`tribunal-run-coordinator.ts:191-202`).
- 8FC.2, style Moderate 4: exported `ProposalReceiveContext` and `PendingProposal` replace the anonymous context and duplicated interface (`tribunal-run-coordinator.ts:49-66`).

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8FC-report.md`

## Specs changed

- `tribunal-roster-proposal.spec.ts:40-90`: checks identity/answer validation, disabled and exhausted lanes, real Relay self-review rule, flat-role and duplicate shape constraints, round cap, and preference ranking.
- `tribunal-run-coordinator.spec.ts:85-280`: checks fixed non-affirmative answer, one launch after registration, real records-service Council manifest over in-memory storage, retry after manifest failure, rollback and run-ID reuse after failed send, answer delivery fallback, duplicate pending ID, changed availability, single failure report per failure, shared concurrent confirm, page exit and timeout behavior.

## Degradation audit

- `tribunal-roster-proposal.ts:114`: malformed JSON returns `null`; valid `reported` marker states caller declines it.
- `tribunal-run-coordinator.ts:162`: discovery failure returns a fixed reported failure; valid `reported` marker.
- `tribunal-run-coordinator.ts:182`: task creation failure returns a fixed reported failure; valid `reported` marker.
- `tribunal-run-coordinator.ts:206`: manifest write failure returns a fixed reported failure; valid `reported` marker.
- `tribunal-run-coordinator.ts:224`: send failure proceeds to rollback and fixed report; valid `reported` marker.
- `tribunal-run-coordinator.ts:229`: rollback failure proceeds to fixed report; valid `reported` marker.

## Verification and limits

- `npx prettier --check` output: `All matched files use Prettier code style!`
- No Nx or Jest command was run, per lane instructions. The team leader owns the scoped test, typecheck, and lint run.
- No other source callers of `parseRosterProposal`, `rankAvailableLanes`, or `TribunalRunCoordinator` were found under `libs/frontend/command-center/src` outside these four files. No outside file was edited.

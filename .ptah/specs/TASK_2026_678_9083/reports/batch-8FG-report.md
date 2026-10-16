# Batch 8FG report

## Task 8FG.1 — re-review Serious, D26: page exit during confirm

- `tribunal-run-coordinator.ts:17,29,65` adds the terminal `cancelled` state, failure reason, and required user message.
- `tribunal-run-coordinator.ts:114-124` cancels every answered proposal on page exit, deletes it from pending, and consumes its ID. Open proposals still follow the existing decline path. An answered proposal sends no turn or Decline.
- `tribunal-run-coordinator.ts:168-198,249-261` checks cancellation after discovery and task creation, including rejection and null results, before a manifest write. The shared cancel path removes an earlier attempt's manifest once when a run ID exists, then reports a nonretryable cancellation.
- `tribunal-run-coordinator.ts:228-246` preserves a successful send as launched after page exit. A failed or thrown send rolls back its manifest and reports cancellation when page exit occurred. The existing retryable launch-send failure applies otherwise. `terminate` still consumes an ID already removed from pending.
- `tribunal-run-coordinator.spec.ts:279-394` adds deferred discovery success/rejection, deferred Relay task creation, retry then exit with run-ID rollback, deferred send false with rollback and consumed-ID follow-up, and deferred send true after exit. They assert no manifest write or launch before a cancelled discovery/task completes, one cancellation report for the first failed result, no Decline, and the appropriate launched or nonretryable outcome. Existing spec cases remain intact.

## Task 8FG.2 — re-review Moderate, D27: deterministic migration

- `command-center-records.ts:64-82` tracks whether the winning manifest came from its run-ID key. A run-keyed body wins regardless of enumeration order; between root-keyed bodies, greater `startedAt` wins and ties retain the first. Persisted shape and public methods are unchanged.
- `command-center-records.spec.ts:92-144` covers both insertion orders of run-keyed and root-keyed bodies, read and next-write persistence of only the run-keyed body, and a greater-timestamp winner among two root-keyed bodies.

## Catch sites and degradation audit

- Coordinator discovery catch (`:170`): existing reported marker; cancelled rejection uses the shared cancel path, otherwise reports retryable discovery failure.
- Coordinator task creation catch (`:192`): existing reported marker; cancelled rejection uses the shared cancel path, otherwise reports retryable task failure.
- Coordinator manifest write catch (`:218`): existing reported marker; reports retryable manifest-write failure.
- Coordinator launch send catch (`:236`): existing reported marker; falls through to rollback and reports the applicable failure.
- Coordinator failed-send rollback catch (`:241`): existing reported marker; reports the applicable failure after rollback attempt.
- Coordinator cancellation rollback catch (`:257`): new valid `degradation-audit: reported — ...` marker is the first catch-body line; reports nonretryable cancellation if removal throws.
- Records read/parse catch (`:48`): unchanged, returns an empty record for unavailable or corrupt storage.
- Records write catch (`:93`): unchanged 8F0.2 reported marker; returns false to its existing failure reporter.

## Changed files

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8FG-report.md`

## Verification and limits

Ran `npx prettier --write` and `npx prettier --check` on all four changed TypeScript files. Check output: `All matched files use Prettier code style!`

Per lane rules, I did not run Nx, Jest, lint, typecheck, or the degradation-audit command. The team leader owns the two-project scoped verification. No git commands or commits were run. D28 projection dedup, D29 logic Minors and style Minors, and A1 launch/timeout rules remained out of scope.

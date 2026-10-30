# Code Logic Review — `TASK_2026_854_52e8`

Scope read in full: migration 0063, `session-auto-link.service.ts`, `auto-link/task-link-rules.ts`, `auto-link/git-worktree-info.ts`, `session-auto-link.store.ts`, `session-todo-progress.service.ts`, `di/register.ts`/`start.ts` diffs, the link/unlink/rekey/apply parts of `session-organization.store.ts` and `.service.ts`, the agent-sdk `agentId` diffs, the shared task-id schema, `SessionOrganizationCache`, and the frontend diffs in the chat message handler, task prompt bridge and task-session-links service. I read the rpc-handlers diff only partly. I did not run `npm run verify`. Everything below is from reading code.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 6              |
| Failure modes found | 8              |

The design is sound. `planAutoLinks` is a pure full reconcile whose result does not depend on event order. It never writes a protected row or a suppressed task. Rows are written in one transaction, and the plan is computed inside that transaction. Suppression and the demote-then-write order are handled correctly. The two Serious items are lost-update paths that only log. Nothing found corrupts data.

## Five logic questions

### 1. How does this fail silently?

- `reconcileOnce` only handles the commit outcome `'unavailable'` (`session-auto-link.service.ts:~419-425`). `commitCapture` can also return `'failed'` (the write threw, for example SQLITE_BUSY or a disk-full error) and `'no-metadata'`. Both are logged by `commitCapture`, then ignored. An R3 candidate carried only in `request.r3` is lost: it was already removed from `queuedPrompts` in `handleResolved`, so nothing retries it. The user typed `/orchestrate TASK_X`, the link never appears, and no later event re-derives it. See F1.
- A failed `session:getOrganization` read overwrites a previously good cached summary with `null` (`session-organization-cache.store.ts` `read`: `entry.fetched.set(summary)` runs unconditionally). The chip or progress disappears until the next push. See F5.

### 2. What user action produces unexpected behaviour?

- The user clears a session's worktree in the editor and then resumes the session. `recordWorktree` runs on every `SessionIdResolved` and re-records it, because the guard is only `getOrganization(...).worktreePath` truthy (`session-auto-link.service.ts:~248-278`). R4 can then recreate the task link. The worktree has no suppression equivalent to links. See F4.
- The user unlinks an R3 task and later types `/orchestrate TASK_X` again. It is permanently suppressed (decision D3, as designed). Only an explicit link from the UI or the agent clears it. This matches the decisions but is surprising, and the user gets no feedback. Informational.
- The user edits the prefilled `/orchestrate TASK_X` prompt so it no longer starts the first non-blank line with `/orchestrate`. The board "start" no longer links, because the old `BoardTaskLinkCaptureService` was deleted (`task-prompt-bridge.service.ts`). This is the accepted R3 design, but it is a regression against the old webview-side link for `board-start`.

### 3. What input data produces a wrong answer?

- `readGitWorktreeInfo` treats any `.git` file containing `gitdir:` as a linked worktree. A submodule checkout also has such a file, so a session in a submodule records the submodule path as its "worktree" (`git-worktree-info.ts:~46-59`). Minor.
- A session whose cwd is a subfolder of a worktree finds no `.git` file, so nothing is recorded. This is a false negative and R4/R5 are silently skipped.
- The branch pattern `(?:_[0-9a-f]{4})?` can swallow the start of a word in `TASK_2026_854_face…`. This would produce a task id that has no folder, so `taskExists` rejects it and the damage is limited. Negligible.

### 4. What happens when a dependency fails?

- `fs.exists` throwing is logged and treated as "does not exist" (`taskExists`). The negative result is not cached, which is correct. A transient failure causes R4 rows to be deleted on this reconcile (the desired set lacks the task) and re-added later. That is a flap on a flaky filesystem. See F3.
- The store closing mid-way is handled by `deferRequest` plus `onStoreOpen`. Good. Failure modes other than `unavailable` are not handled (F1).
- `metadata.get` returning `null` in `handleResolved` returns silently without queuing (`:~238`). The adapter creates the metadata before it notifies (`sdk-agent-adapter.ts:~1600-1633`), so this is unlikely for new sessions. For a resumed session with deleted metadata the reconcile is dropped without a log.
- If the task index service is not composed, `taskIndex` is undefined and no folder-change trigger exists. R4 for a task folder that appears after the worktree exists is never retried until another event touches the session. This is documented as optional.

### 5. What is missing that the requirements never mentioned?

- No test or guard exists for a change cascade that is not bounded (F2).
- `dispose()` does not stop in-flight reconciles. An in-flight `reconcileOnce` can still write after `dispose` (it never checks `started`). Minor.
- Suppression rows for deleted tasks are never pruned. Slow growth only. Minor.

## Failure modes

### F1 Lost R3 candidate on non-`unavailable` commit failure

- Trigger: `/orchestrate TASK_X` accepted, then the store write throws (busy DB, disk full), or metadata disappears between `get` and `commitCapture`.
- Symptom: no link, no retry. One `[SessionOrganization] autoLink reconcile failed` line.
- Evidence: `session-auto-link.service.ts` `reconcileOnce` (`if (outcome === 'unavailable')` is the only branch); `handleResolved` deletes the queue entry before the commit; `session-organization.service.ts:~800-830` returns `'failed'`.
- Current handling: logged only.
- Recommendation: on `'failed'` or `'no-metadata'`, call `deferRequest` once (bounded retry count) or re-queue the R3 ids. At least log the dropped task id at the R3 level.

### F2 Cascade is not really "one level deep"

- Trigger: any link change on a session with children, forks or worktree peers.
- Symptom: `reconcile(id, {cascade:false})` of a dependent writes and emits a `capture` change. `onChange` then calls `reconcile(id, {cascade:true})` for that dependent, which cascades again (`onChange` at `:~203-211` ignores which reconcile caused the change). Propagation therefore walks the whole parent, fork and worktree graph until a fixpoint. The header comment (`:~14-17`) and decision RR1-6 promise one level.
- Impact: it terminates because the plan is idempotent and no rule feeds back (R5 only counts explicit and R3 primaries). Cost is O(connected component) per change, with `MAX_RELATED_SESSIONS` limiting each hop only.
- Fix: pass the origin through the change event, or mark changes emitted by the reconcile itself and skip the cascade for them, if one level is truly required. Otherwise change the documentation.

### F3 R4 rows flap on a transient existence-check failure

- Evidence: `taskExists` catch block swallows to `false`; `desiredLinks` then omits the task; `planAutoLinks` step 2 deletes the R4 row.
- Recommendation: treat a thrown check as "unknown" and keep the existing automatic row for that task.

### F4 Worktree is re-recorded after the user clears it

- Evidence: `recordWorktree` (`:~248-278`) checks only for a non-empty stored path.
- Symptom: a cleared worktree and its branch come back on the next resume, and R4/R5 links with them.
- Recommendation: record only on the first resolve for a session, or keep a marker that the worktree was cleared by the user.

### F5 Cache clobbers good data on a failed read

- Evidence: `session-organization-cache.store.ts` `read` sets `fetched` to the result of `fetch()`, which returns `null` for every failure.
- Recommendation: distinguish "unknown / not persisted" from "failed". On failure keep the previous value and leave the entry retryable. Today, state `'read'` also means a failed id is never retried until a push arrives.

### F6 Task-folder trigger misses worktree-local roots

- Evidence: `onIndexChange` looks up sessions with `workspace_root = normalizeWorkspaceRoot(event.workspaceRoot)` (`:~207-219`). `taskExists` looks in `[root, worktreePath, workingDirectory]`, but the trigger only fires for events from the indexed workspace.
- Symptom: a `task.md` created only inside the worktree's own `.ptah/specs` is picked up only on the next unrelated reconcile. I did not verify whether the task index watches worktree roots.
- Recommendation: confirm which roots the index watches; add a test for it.

### F7 `findSessionsNamingTask` can starve sessions

- Evidence: `session-auto-link.store.ts` `sessionsNamingTask` uses `ORDER BY session_id LIMIT 50`. A task named by more than 50 worktree sessions leaves the rest un-reconciled. The comment claims the index filters by prefix, but `instr(...)` is a scan inside the workspace's rows.
- Impact: low. The next change on those sessions reconciles them.

### F8 Reconcile loop drops merged requests when `reconcileOnce` throws

- Evidence: `reconcile` (`:~287-310`). The `for` loop exits on a throw, leaving requests merged in during the run in `this.requests` until the next call for that session.
- Recommendation: catch per iteration and continue, or log the leftover.

## Blocking issues

None found.

## Serious issues

### S1 Silent R3 loss (F1)

- File: `libs/backend/session-organization/src/lib/session-auto-link.service.ts` `reconcileOnce`.
- Scenario: any `commitCapture` result of `'failed'` or `'no-metadata'`.
- Impact: the user's explicit `/orchestrate` intent produces no link and no retry.
- Fix: defer or retry with a bound, as in F1.

### S2 Unbounded transitive cascade (F2)

- File: `session-auto-link.service.ts` `onChange`/`cascade`, against the "one level deep" contract in the file header and decision RR1-6.
- Scenario: a large fork or worktree family.
- Impact: write amplification and reconcile storms. Convergence relies on the idempotence of the plan alone.
- Fix: carry the origin of the change, or align the contract and add a hop bound.

## Moderate and minor issues

- F3 (existence-check flap), `session-auto-link.service.ts` `taskExists`.
- F4 (worktree re-record after a user clear), `:~248`.
- F5 (cache overwrites good data with null, and a failed id is not retried), `session-organization-cache.store.ts` `read`.
- F6 (worktree-local folder events), `:~207`.
- F8 (merged requests orphaned on throw), `:~287`.
- Moderate: `dispose()` does not guard in-flight work (`write` after dispose).
- Minor: F7; the submodule false positive (`git-worktree-info.ts:~46`); a subfolder cwd is not detected; LRU eviction in the cache (64 ids) silently stops updating a view that a component still holds.
- Minor: `handleResolved` returns silently when metadata is null (`:~238`).
- Minor: R3 rows are retained after the task folder is deleted (by design: the evidence is an event).

## Data flow

1. Hook payload carries `agent_id` (`agentIdField`, `callback-registry.base.ts`): OK. The hook handlers fan out `agentId` only when non-empty. Subagent prompts are skipped by `onPrompt`/`onExpansion` (`payload.agentId !== undefined`): OK.
2. `/orchestrate` parsed (`parseOrchestrateTaskId`): OK. Only the first non-blank line counts, with a 64 KiB scan bound. Expansion requires the first argument to be exactly a task id. Both validate against the shared grammar.
3. `offerOrchestrate`: queues when the store is closed or metadata is missing; the queue is bounded (64) with oldest-drop, and rekeyed through `previousSessionId`. The hook payload carries the real session id, so the usual replay key is `realSessionId`: OK. Existence check by `task.md`: OK, positive cache only.
4. `reconcile` is serialized per session and merged: OK, except F8.
5. `reconcileOnce`: desired set computed outside the transaction, `planAutoLinks` computed inside it with current rows and suppressions read in-transaction: OK. Non-`unavailable` failure outcomes ignored: GAP (F1).
6. `applyAutoLinkPlan` writes via `writeTaskLink` with `auto` and keeps `created_at` on conflict, which preserves the R3 order. The primary demote happens inside the write. Writes are deletes, then related, then primary: OK.
7. Explicit link: clears the suppression and nulls the rule columns (adopt and freeze): OK. Unlink: suppresses, even if no row existed: OK. Explicit sources are limited to `board-start`, `agent` and `user` at the service boundary: OK.
8. Rekey and delete: the rule columns travel with the row. The side tables are rekeyed and deleted in the same transaction (`rootsOf` union): OK.
9. Todo progress: main thread only, zod-validated, bounded to 500 todos and a 200-character label, no-op writes skipped: OK. The rpc and the tasks-ui service validate the optional shape tolerantly.
10. Frontend cache: loaded row wins; reads are lazy; change pushes re-read; no timers: OK except F5.

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                              |
| ------------------------------------------------------------ | -------- | ------------------------------------------------ |
| Migration 0063 (columns, suppressions, todo table, index)    | COMPLETE | None found; SQL is static and the runner owns the transaction |
| R3 `/orchestrate` link, subagent excluded, early-prompt queue | PARTIAL  | Failure outcomes lose the candidate (F1)         |
| R4/R5/R6/R7 derived links, one precedence table              | COMPLETE | Cascade depth differs from the contract (F2)     |
| Unlink suppression, explicit link lifts it                   | COMPLETE | Permanent for R3 by design                       |
| Worktree detection without a git process                     | PARTIAL  | Re-records after a clear (F4); subfolder and submodule edge cases |
| Todo progress capture and display                            | COMPLETE | None                                             |
| Frontend cache and views                                     | PARTIAL  | Failed read clobbers data (F5)                   |
| Legacy webview-side board link removed                       | COMPLETE | Behaviour now depends on the user sending the prefill |

Implicit requirements not addressed: retry or backoff after a write failure; pruning of orphan suppressions.

## Edge cases

| Case                                              | Handled | How                                           | Concern                      |
| ------------------------------------------------- | ------- | --------------------------------------------- | ---------------------------- |
| Prompt before the session has metadata            | YES     | Bounded queue, replay on resolve/open         | Oldest dropped when full (logged) |
| Store closed at start-up                          | YES     | Pending resolves + `onStoreOpen`              | Capped at 256 (logged)       |
| Two peers each hold a different primary           | YES     | R5 requires exactly one distinct task         | None                         |
| Explicit primary plus auto primary                | YES     | Auto becomes `related`                        | None                         |
| User unlink then auto rule fires again            | YES     | Suppression checked in the plan               | None                         |
| Repeat reconcile                                  | YES     | Plan returns no writes                        | None                         |
| Replayed prompt on repeat `SessionIdResolved`     | YES     | Merged by the plan                            | None                         |
| Legacy rows with a NULL rule                      | YES     | Treated as protected                          | Never cleaned automatically  |
| Write failure mid-reconcile                       | NO      | Logged                                        | F1                           |
| Existence check throws                            | PARTIAL | Treated as absent                             | F3                           |
| Cleared worktree on resume                        | NO      | Re-recorded                                   | F4                           |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (static reading only; the rpc-handlers and the tasks-ui and chat view components were read only through diffs, and no checks were run)
- Top risk: the user's explicit `/orchestrate` link can be silently dropped on any non-`unavailable` write failure (F1), while the cascade may amplify writes across large families (F2).
- What a robust implementation would add: a bounded retry or defer for failed commits; an origin flag on change events to enforce the one-level cascade; "unknown" instead of "absent" for failed existence checks; a one-time worktree record; a cache that keeps the last good value on a failed read; a test for a task folder created inside a worktree root.

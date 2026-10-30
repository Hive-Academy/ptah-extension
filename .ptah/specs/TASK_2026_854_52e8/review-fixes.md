# Review fixes — `TASK_2026_854_52e8`

Fixes for `code-logic-review.md` and `code-style-review.md`. All edits are uncommitted in this worktree.

## Logic review

| Finding | Status | What changed |
| --- | --- | --- |
| S1 / F1: a `failed` or `no-metadata` commit loses the R3 link | Fixed | `reconcileOnce` now handles both outcomes. A `failed` write runs again once right away (`MAX_COMMIT_RETRIES = 1`, carried as `attempt` on the merged request). After that, and for `no-metadata`, the R3 ids go back into the existing bounded prompt queue (`queue`, 64 entries, oldest dropped with a log line). The next `SessionIdResolved` or store open replays them. Each kept id is logged (`autoLink R3 <id> kept for <session>: <reason>`). A run that finds no metadata also keeps its R3 ids now. |
| S2 / F2: the cascade is transitive and unbounded | Fixed | A change this service's own reconcile writes is marked (`ownWrites`, set inside the synchronous write callback, consumed by `onChange`, cleared in `finally`). That change is not a trigger. The root's explicit `cascade()` is the only propagation, so it goes one level deep, as the header and RR1-6 state. Other listeners, such as the webview push, still get the change. Note: decisions.md D9 also says further depth happens through the dependents' own change events. Those events no longer cascade. A grandchild or a fork of a fork catches up on its own next trigger (resolve, its own change, or a task-folder event). |
| F3: R4 rows flap when the existence check throws | Fixed | `taskExists` is now `taskPresence`, which returns `present`, `absent` or `unknown` (`unknown` means a check threw). In R4, `unknown` keeps the task only when the session already holds an R4 row for it. In R3, `unknown` puts the candidate in the bounded queue instead of dropping it. |
| F4: the worktree is recorded again after a user clears it | Skipped (premise does not hold) | No RPC or UI path clears a session's worktree. `setOrganization` takes priority, status and pin only, and the organization editor only shows, opens or copies the worktree. The only writer that sets the worktree to empty is the agent-started or capture recorder. I tried a once-per-process marker and removed it again, because it added state for a trigger that does not exist. Revisit this if a "clear worktree" action is added. |
| F5: the cache overwrites good data with null and never retries a failed id | Fixed | `SessionOrganizationCache.fetch` returns `{ ok: false }` on an RPC or transport failure, and `{ ok: true, summary }` (summary may be null) for an answered read. A failed read keeps the previous value and sets the entry back to `idle`, so it can be read again. `onOrganizationChanged` now re-reads idle entries too. A failed read with a push pending while it ran is retried once. No timer was added. |
| F6: worktree-local task-folder events are missed | Skipped (needs new watcher scope) | `TaskIndexService` only watches the workspace roots it is started for (`ensureStarted(workspaceRoot)`), so no event exists for a `task.md` created only inside a worktree's own `.ptah/specs`. Fixing this means watching worktree roots, which is new watcher scope and not a small fix. The session's next resolve or change reconciles it. This is recorded as a follow-up. |
| F7: `findSessionsNamingTask` can starve sessions | Skipped (minor, as instructed) | LIMIT 50 is the RR1-6 bound. The next change on those sessions reconciles them. |
| F8: a throw in the reconcile loop strands merged requests | Fixed | Each iteration of the `reconcile` loop has its own try/catch with one log line (`autoLink reconcile failed for <id>: <msg>`), and the loop continues with the requests that were merged in. |
| `dispose()` does not guard in-flight work | Fixed | `started` is checked after every await in `offerOrchestrate`, `handleResolved`, `reconcileOnce` and `recordWorktree`, inside both commit write callbacks (they return `[]`, so no write and no change), in the loop condition of `reconcile`, and in `queue` and `addPendingResolve`. `dispose()` also clears `ownWrites`. |
| Minor: `handleResolved` returns silently on null metadata | Fixed | It logs `autoLink resolve skipped for <id>: no session metadata` through the injected `IOutputChannel`. That is the service's logger, and the whole lib logs through it (D15). |
| Minor: submodule false positive, subfolder cwd, cache LRU eviction, R3 rows kept after folder delete, orphan suppression pruning | Skipped | Minor and not trivial, or by design (see the review). |

## Style review

| Finding | Status | What changed |
| --- | --- | --- |
| The side-tables dependency is optional although it is always registered | Fixed | `SessionOrganizationStore` now injects `SESSION_ORGANIZATION_TOKENS.SIDE_TABLES` as required. All `?.`, `?? 0`, `?? []` and `?? null` fallbacks and the `if (!sideTables) return false` branch are gone. Store specs now pass a real `SessionAutoLinkStore` (`session-organization.store.spec.ts`, rpc-handlers `session-list.perf.spec.ts`). The other specs already passed one. `isOptional` remains only on `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE`. The `register.ts` comment is updated. |
| Store and service are past the file-size tripwire | Skipped (follow-up) | As instructed. Follow-up: move the side-table orchestration out of `session-organization.store.ts`, and split `SessionAutoLinkService` into a reconcile core plus thin trigger subscribers. |
| Other minor style items | Not addressed | Out of scope for this pass. |

## Specs added

- `session-auto-link.service.spec.ts`, `failures and bounds (review fixes)`:
  - a write that throws once is retried and the R3 link lands;
  - when every write throws, the R3 id is kept and linked on the next resolve;
  - a write made by a cascade does not cascade again (a fork of a fork is not reconciled);
  - an R4 link survives a throwing existence check and is dropped when the folder is really gone;
  - a throwing run does not strand a request merged while it ran;
  - a reconcile in flight at `dispose` writes nothing and emits no change;
  - a resolve with no metadata is logged.
- `session-organization-cache.store.spec.ts`:
  - a failed re-read keeps the last good value, and the next push retries it;
  - a failed first read is retried on the next push.

## Verification

`npm run verify -- -p @ptah-extension/session-organization,@ptah-extension/rpc-handlers,@ptah-extension/chat` ran lint, test and typecheck for 3 projects. All passed:

- session-organization: 11 suites, 343 tests passed, lint 0 errors.
- rpc-handlers: 188 suites, 5041 passed and 7 skipped, lint 0 errors.
- chat: 300 suites, 5311 passed and 2 skipped, lint 0 errors.

No shared or platform contract changed, so the host-app typecheck was not needed.

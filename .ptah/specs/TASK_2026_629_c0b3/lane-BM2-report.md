# BM2 report — Orchestra Canvas git metrics

## Summary

Implemented a root-scoped git statistics store and connected the compact session card to its todo and git inputs. Registered the store as a webview message handler. The store reads only on first track or a matching turn completion, and applies matching git status pushes without an RPC.

## Per-item status

| Item | Status and evidence |
|---|---|
| `sessionWorkingRoot` precedence | Complete — `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts:80`; exported at `libs/frontend/chat/src/index.ts:27`. |
| Ref-counted root tracking and reactive `stateFor` | Complete — store `:119` and `:153`. Normalized roots share an entry; per-tab counts allow the card and detail view to register the same tab independently. |
| Turn-end mapping and push handler | Complete — store `:157`; each turn resolves the currently tracked tab IDs through `TabManagerService`. A matching push replaces state and invalidates a read. Handler registered at `apps/ptah-extension-webview/src/app/app.config.ts:223` (reviewed by reading; app checks prohibited). |
| Debounce, freshness, FIFO queue, concurrency limit, timeout | Complete — store `:203`, `:227`, `:241`. One timer per root, 5 s non-forced freshness, two global reads, 15 s RPC timeout, and one rerun flag per in-flight root. No polling. |
| Git result mapping and failure behavior | Complete — store `:40` and `:241`. Directories are ignored; null/binary counts set partial; non-repo is none; unavailable and RPC failure become unknown, replacing prior counts. |
| Card todos and git | Complete — `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:97`, `:229`, `:253`, `:345`. Todos use the existing sampled stream and value equality; git tracking releases through effect cleanup. The existing activity input is named `gitStats`, so the card binds that source-verified name. |
| A2 stale completion guard | Complete — store `:253` and `:266` compare the captured entry object with the current map entry as well as its generation. The release/retrack test at `session-git-stats.store.spec.ts:300` settles the old read after a new entry exists and confirms its result is discarded. |

## Tests added against BM-design §4 BM2

| BM2 requirement | Evidence |
|---|---|
| Sum, ignore directories, null/binary partial | `session-git-stats.store.spec.ts:105` (null counts model the 1 MiB and 200-file caps). |
| Not-repo to none | `:146`. |
| Failure after success, unknown, push and turn-end recovery | `:153`. |
| Nine roots, two concurrent reads, queued duplicate coalescing | `:219`. |
| Push with no RPC and in-flight discard | `:239`. |
| Draft tab receives session ID later | `:262`. |
| Two tabs one root, release semantics | `:273`; duplicate same-tab view registrations `:289`. |
| Root precedence | `:84`. |
| Card bindings and destroy release | `compact-session-card.component.spec.ts:206`. |
| Three handled message types | `session-git-stats.store.spec.ts:76`. |
| A2 release/retrack race | `:300`. |

## Checks

- `npx prettier --write` on all six changed files: passed; re-run on the two subsequently edited store files passed.
- `npx nx test @ptah-extension/chat --testFile=session-git-stats.store.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 10 tests at that point; one more test was subsequently added and passed in the full target.
- `npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 34 tests.
- `npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 199 suites, 3,619 tests passed, 2 skipped.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed; one existing NG8107 warning in `peer-session-send-dialog.component.ts`.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed, 0 errors and 37 warnings.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Count registrations per tab ID | Set of IDs; count per ID | A card and detail view can track the same tab. One release must preserve the other registration; `store.spec.ts:289`. | Yes; map is private. |
| Bind `[gitStats]` | Design shorthand `[git]`; actual activity input `[gitStats]` | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:883`. | Yes, if activity API changes. |
| Use `console.warn` for read failures | Existing logging precedent; new logger dependency | `change-set.store.ts` uses `console.warn` for its git RPC failure; store `:259`. | Yes. |

## Open items

None for BM2. Webview app build/typecheck was intentionally excluded by the batch check policy. `ptah_agent_report` was unavailable in this tool environment, so the parent should read this report directly.

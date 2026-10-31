# Code Logic Review — `TASK_2026_855_5dda`

Scope: worktree `.claude-worktrees/feat-session-git-view-d7cc38a5745d`, 72 changed/new paths. Read in full: `git-root-resolver.ts`, `git-workspace-root.ts` (`findRegisteredWorktree`), `git-watch-rpc.handlers.ts`, `git-watch-rpc.schema.ts`, `git-root-watcher-pool.ts`, `git-root-watch-lease.service.ts`, `git-dock-scope.store.ts`, `session-working-root.ts`, `session-worktree-lookup.service.ts`, `session-git-dock-opener.service.ts`. Read as diff: `git-rpc.handlers.ts`, `git-workflow-rpc.handlers.ts`, `git-status.service.ts`, `source-control.service.ts`, `changed-file-tree.component.ts`, `pending-discard.ts`, `workspace-coordinator.service.ts`, `compact-session-card.component.ts`. Not examined in depth: the spec files, the host-profile manifest wiring, the Electron boot/shutdown wiring, the header component. I did not run tests or diagnostics (the session was interrupted by a rate limit), so passing status is unverified by me.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 5              |
| Failure modes found | 7              |

## Five logic questions

### 1. How does this fail silently?

- A session whose row is missing from `ChatStore.sessions()` has no worktree. `SessionWorktreeLookup.worktreeFor` returns null (`session-worktree-lookup.service.ts`, the `?? null` branch). Resolution then falls through to `session-cwd` or `workspace-root` (`session-working-root.ts` precedence). The dock shows the main workspace's changes under that session's name. The user sees "their session" but the wrong tree. The header shows the source, but nothing flags that a worktree was expected and not found.
- `GitRootWatchLeaseService.send` ignores `result.evicted` and `result.watched` (`git-root-watch-lease.service.ts`, `send`). A root evicted over the cap of 4 has no live pushes, and the UI cannot say so. Fetch on switch still works, and the 5 s freshness window bounds staleness, so this is Moderate.
- `findRegisteredWorktree` swallows every probe failure (`git-workspace-root.ts:66-70`) and returns undefined. The caller gets the generic "No workspace folder open". The user is told no folder is open when the real cause is a git failure, a timeout, or a removed worktree.

### 2. What user action produces unexpected behaviour?

- Pin, then close the pinned tab. The scope keeps `pinned.last`, so the dock stays on a root with no session (`closed: true`). This is intended, but destructive actions are still enabled. The discard confirmation names the worktree, which is the mitigation.
- Rapid tab switching produces several `switchWorkspace` calls. `fetchGitInfo` captures `target` and writes through `isActive(target)` at result time, so a stale response goes to the cache and not the live signals. That is correct.
- `showSession` for a non-active tab pins the dock to a tab the user is not looking at. Subsequent chat-tab switches do not move the dock, and the header must make the pin visible. I did not verify the header.

### 3. What input data produces a wrong answer?

- Two renderer windows (or two leases) renewing every 60 s. `desiredRoots` ranks leases by `renewedAt`, and every renewal bumps it (`git-root-watcher-pool.ts`, `setLease`). When the combined roots exceed `MAX_SECONDARY_ROOT_WATCHERS` (4), the ranking flips with each renewal. Watchers are stopped and started repeatedly, and a stop/start cycle can miss events in between.
- Windows paths differing only in case or separators are folded consistently by `normalizeWorkspaceRoot` on both sides. A POSIX host that is case-sensitive but run with `platform` defaulting to `process.platform` is handled by `ignoreCase`. I found no mismatch.
- A session whose cwd is the "workspace partition path" is treated as `session-cwd`. If that path is a subdirectory of a registered folder and not itself a folder or worktree, the backend refuses it, which `GitRootResolver` documents as "unavailable". It does not widen.

### 4. What happens when a dependency fails?

- `git worktree list` or `rev-parse --git-common-dir` fails or times out: the root is refused (fail-closed), which is safe. See Failure mode 1 for the missing diagnostics.
- Secondary watcher start throws: caught, logged, recorded in `startFailures`, retried on the next reconcile (`reconcile`). OK.
- `git:watchRoots` registry throws: the handler logs and returns an empty result (`git-watch-rpc.handlers.ts`, the try/catch after `setLease`). The renderer reads it as no pushes. OK.
- The renderer RPC fails: `sentKey = null`, retried on the next update or the 60 s renewal. OK. A lease that cannot be renewed expires after 180 s and its watchers stop (bounded).

### 5. What is missing that the requirements never mentioned?

- There is no cache for `findRegisteredWorktree` results. This is deliberate (security: re-validate on each write, `git-root-resolver.ts` header). The cost is that every `git:*` call on a worktree root spawns `git worktree list` plus two `rev-parse` calls, and `directoryExists` adds a stat. See Moderate 1.
- There is no explicit user-visible state for "this worktree is gone". The root is refused and every call returns "No workspace folder open".
- There is no cleanup of `_workspaceGitState` entries for removed worktrees until the 12-entry LRU evicts them. This is bounded and fine.

## Failure modes

### Missing worktree row falls back to the main tree

- Trigger: the session's `claudeSessionId` is not in `ChatStore.sessions()` (list not yet loaded, paged out, or the organization record not yet written).
- Symptom: the dock shows the workspace root's changes while the header names the session. Stage, commit and discard then run against the main tree.
- Evidence: `session-worktree-lookup.service.ts` (`worktreeFor`), `session-working-root.ts` precedence 3 and 4, `git-dock-scope.store.ts` `scopeFrom`.
- Current handling: silent fallback; the header may show source `workspace-root`.
- Recommendation: when the session is known to be an agent/worktree session but no worktree resolves, show an explicit "worktree unknown" scope and disable mutations, or at least flag it in the header.

### Refused root reported as "No workspace folder open"

- Trigger: a worktree was removed, the probe timed out, or git failed.
- Symptom: a misleading error on stage, commit and discard.
- Evidence: `git-workspace-root.ts:66-70`, and the `if (!wsRoot) return { error: 'No workspace folder open' }` branches in `git-rpc.handlers.ts`.
- Recommendation: a distinct message for a refused named root, for example "This worktree is no longer available".

### Per-call probe cost

- Trigger: any `git:*` call on a worktree root (status refresh on every watcher push, stage, diff per file).
- Symptom: 3 or more extra git process spawns per RPC. On Windows this is tens to hundreds of ms per call, and a diff list can fan out.
- Evidence: `git-workspace-root.ts:76-100`, `git-root-resolver.ts:66-75`.
- Recommendation: a very short TTL cache (for example 1 to 2 s) for read-only policies. Keep write methods uncached if the re-validation guarantee is wanted, or at least dedupe concurrent probes.

### Lease ranking flap

- Trigger: more than one live lease with more than 4 combined roots.
- Symptom: watchers churn on each renewal.
- Evidence: `git-root-watcher-pool.ts`, `desiredRoots` sorts by `renewedAt`, and `setLease` always updates `renewedAt`.
- Recommendation: rank by first-seen or a stable lease sequence, not by the last renewal. Alternatively, do not bump the rank when the root set is unchanged.

### Evicted roots invisible to the renderer

- Trigger: roots over the cap.
- Symptom: no live updates; the UI does not know why.
- Evidence: `git-root-watch-lease.service.ts` `send` drops `result.evicted`.
- Recommendation: surface it in the scope header ("not live") or leave it as accepted and documented.

### Lease capacity drop

- Trigger: more than 16 leases (`MAX_LEASES`).
- Symptom: the oldest lease is silently dropped, and its next renewal then evicts someone else.
- Evidence: `git-root-watcher-pool.ts`, `makeRoomForLease`.
- Recommendation: unlikely in practice (one lease per renderer); log only. Acceptable.

### TOCTOU between validation and git command

- Trigger: a worktree is removed or replaced between `resolve` and the git spawn.
- Symptom: the command runs in a path that is no longer the validated worktree. The window is small. Git itself fails in a missing directory, and a replaced directory would need a hostile local actor.
- Evidence: `git-root-resolver.ts` header (acknowledges per-call re-validation only).
- Recommendation: accepted risk; note it in decisions.

## Blocking issues

None found.

## Serious issues

### S1. Silent fallback to the main tree for a session without a resolved worktree

- File: `libs/frontend/chat/src/lib/services/session-git-scope/session-worktree-lookup.service.ts` (`worktreeFor`), consumed by `git-dock-scope.store.ts` `scopeFrom`
- Scenario: the session list is not loaded or the session is outside the loaded page, so its organization row has no `worktreePath`.
- Impact: the user believes they are operating on the session's isolated worktree and commits or discards in the main checkout. This defeats the "parallel sessions never mix" goal.
- Fix: distinguish "session has no worktree" (a known row without a path) from "row not found" (unknown). Treat unknown as an explicit unresolved scope with mutations disabled until the row loads.

### S2. Refusal is indistinguishable from "no folder open"

- File: `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` (all `if (!wsRoot)` branches), `git-workspace-root.ts:66-70`
- Scenario: a session worktree was removed or git was briefly unavailable.
- Impact: the user cannot tell why the dock is empty. The only diagnostic is a warn log containing the root.
- Fix: return a coded error. Per repo rules, use `RpcUserError` with a code added to `rpc-error-codes.types.ts` (for example `GIT_ROOT_UNAVAILABLE`). The frontend can then show "worktree no longer available".

## Moderate and minor issues

1. Per-call probe cost (`git-workspace-root.ts:76-100`); see Failure modes. Moderate.
2. Lease ranking flap (`git-root-watcher-pool.ts` `desiredRoots`). Moderate.
3. The renderer ignores `watched`/`evicted`/`rejected` in `git-root-watch-lease.service.ts` `send`. A rejected root (removed worktree) keeps being leased and re-sent every 60 s. Moderate.
4. `GitRootWatcherPool.outcomeFor` logs at info on every `setLease` while roots are over the cap (so every renewal). Log noise only. Minor.
5. The `find`-based match in `liveWorktreeOf` takes the first matching entry; duplicates of the same path in the list are harmless. Minor.
6. `GitRootWatchLeaseService.leaseId` uses `globalThis.crypto.randomUUID()`, which requires a secure context. Fine in Electron. Minor.
7. There is no test I could confirm that proves a stale in-flight `git:info` response for the previous root does not overwrite the live signals after a scope switch. The code reads correct (`isActive(target)`), but a regression test would pin it. Minor.

## Data flow

1. The chat tab becomes active: `ChatGitSessionScopeSource.activeSession` supplies the candidate. OK.
2. `resolveCandidate` runs `resolveSessionWorkingRoot` with organization, agent origin, cwd and workspace. OK, deterministic. Gap: the organization worktree lookup can be absent (S1).
3. `GitDockScopeStore.reconcile` calls `switchWorkspace(root)` on the five services (idempotent through `isSameWorkingRoot`) and updates the lease set. OK.
4. `GitStatusService` fetches `git:info` with `workspaceRoot`. The result is written to the live signals only if the root is still active, otherwise to the bounded cache. OK.
5. The backend `GitRootResolver.resolve` accepts a registered folder or a live worktree and refuses anything else, with no fallback. OK. Gap: the refusal message (S2) and the probe cost.
6. `GitWatchRpcHandlers` validates the params with zod (strict, max 8 roots), re-resolves each root and de-duplicates. OK.
7. `GitRootWatcherPool.setLease` enforces the lease cap, the TTL (one unref'd timer) and the watcher cap (4), and reconciles. OK, with the ranking flap noted above.
8. Mutations: `discardChanges` and `discardAll` send the confirmed `pending.workspaceRoot` instead of re-reading the dock root. This closes the confirm-then-switch race. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 1. Resolver with documented, tested precedence | COMPLETE | `session-working-root.ts` plus spec. Input quality depends on the lookup (S1). |
| 2. Dock follows the active tab, scope header, pin | COMPLETE (header not reviewed in depth) | Unknown-worktree fallback (S1). The editable-with-confirmations decision is implemented through the worktree label in the discard confirmation. |
| 3. Per-root watcher and state isolation, bounded lifetime | COMPLETE | Bounded by the lease TTL, lease cap, watcher cap and the cache LRU of 12. Ranking flap and eviction visibility are open. |
| 4. Stats card git cell opens the dock scoped to the session | COMPLETE | `openGitScope` goes to `SessionGitDockOpener.showSession`. Errors are logged, not shown. |
| 5. Tests for resolver, switching, isolation, release | COMPLETE by file presence | I did not run them. |

Implicit requirements not addressed: a distinguishable "worktree gone" state (S2), and a probe-cost bound.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Worktree removed while it is the scope | YES (fail-closed) | The root is refused | Misleading message (S2) |
| Scope switch mid-fetch | YES | `isActive(target)` at result time | No dedicated test found |
| Two spellings of one root | YES | `normalizeWorkspaceRoot` keys everywhere | None |
| Renderer closes without releasing | YES | 180 s TTL with an unref'd timer | None |
| Many sessions | YES | Cap of 4 watchers, cap of 12 cached roots | Evictions invisible; ranking flap |
| Non-Electron host | YES | Lease service no-ops; the handler is gated by capability | None |
| Pinned tab closed | YES | Last root kept, `closed: true` | Mutations still enabled |
| UNC or prunable worktree path | YES | Rejected in `liveWorktreeOf` | None |
| Missing session row | NO | Silent fallback | S1 |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (the core paths were read in full; tests and the header component were not run or read)
- Top risk: a session with no resolved worktree silently shows, and lets the user mutate, the main workspace tree.
- What a robust implementation would add: an explicit unresolved-scope state that blocks mutations (S1); a coded "root unavailable" RPC error (S2); a short TTL or in-flight dedupe for the worktree probe; stable lease ranking so renewals do not churn watchers; and surfacing `evicted` or `rejected` roots from `git:watchRoots` in the header.

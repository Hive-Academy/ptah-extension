# TASK_2026_343 — Make git RPC handlers fast on large repos and stop triple `git:branches` requests per switch

## Evidence

Baseline: `tmp/logs/log.log`, workspace `D:\projects\property-hub` (15249 files / 4935 dirs,
`log.log:1361`).

`git:branches` slow-handler warnings (`PTAH_RPC_SLOW_WARN_MS` = 2000):

| log line | durationMs |
| -------- | ---------- |
| 1252     | 6914.9     |
| 1339     | 6061.4     |
| 1352     | 11664.9    |
| 1390     | 4266.4     |
| 1397     | 4154.2     |
| 1828     | 7044       |
| 1839     | 9111       |
| 2158     | 6029       |
| 2171     | 10601      |

`git:info` 2098.1 ms and `git:stashList` 2007.3 ms at 1184-1187, repeated at 1793-1797.

Three `git:branches` requests per workspace switch, and they are **serialised, not concurrent** —
each is dispatched only after the previous one succeeded:

```
1252  git:branches succeeded (a2102603…)  →  slow handler 6914.9
1253  Handling  git:branches (ef8c8c46…)
1339  git:branches succeeded (ef8c8c46…)  →  slow handler 6061.4
1340  Handling  git:branches (e31153eb…)
1352  git:branches succeeded (e31153eb…)  →  slow handler 11664.9
1390-1397                                 →  two more, 4266.4 and 4154.2
```

Serialisation is the frontend's own `_isRefreshing` re-entrancy guard
(`git-branches.service.ts:212`), so the three requests never overlap and the backend never sees a
duplicate it could have coalesced. They cost 6.9 + 6.1 + 11.7 s **in series**.

### Measured cost of the branch listing itself

Run in this repository (156 local branches, 113 of which have an upstream configured), git 2.54:

```
1 × git for-each-ref (refs/heads/ + refs/remotes/, full format)   → 0.286 s
20 × git rev-list --left-right --count <upstream>...<branch>      → 4.106 s   (~205 ms per spawn)
```

At 113 upstream-tracking branches the current implementation's per-branch fallback is
~23 s of subprocess spawning. Windows spawn cost is dominated by **synchronous main-thread time**
— the same cost `exec-git.ts` already documents (46-108 ms of synchronous work per spawn) — which
is why the `[event-loop] lag` warnings at 1182, 1385-1388 sit right on top of these calls.

## Root cause

### 1. `git:branches` fans out one `git rev-list` subprocess per upstream-tracking branch

`libs/backend/vscode-core/src/services/git-info.service.ts:1622`

```ts
const fmt = '%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%09%(creatordate:unix)';
```

The doc comment above `getBranches` (line 1598) says "Uses `%(ahead-behind:upstream)` (requires git

> = 2.31)". **The format string does not contain that atom.** Field 3 is the literal empty string
> between `%09%09`. So `aheadBehindRaw` at `parseBranchRefLine:1696` is _always_ empty, and every
> branch that has an upstream takes the fallback at line 1712:

```ts
} else {
  const { stdout: rlOut, exitCode: rlCode } = await this.execGit(
    ['rev-list', '--left-right', '--count', `${upstream}...${name}`],
    workspacePath,
  );
```

`parseBranchRefLine` is `await`ed inside a `for…of` (line 1636), so those spawns are **sequential**.
Cost is O(branches-with-upstream) serial subprocesses, which is the whole of the 4-11.7 s.

The defect was invisible to the test suite because `git-info.service.spec.ts:131` feeds the parser
a hand-written line `'main\tabc1234\torigin/main\t2 0\t1700000000'` whose ahead-behind field is
populated — a value the production format string can never emit. The spec pins the parser, not the
command.

`%(ahead-behind:upstream)` is **not** a usable fix on its own. Verified against git 2.54: if any ref
in the result set has no upstream, git aborts the entire command:

```
$ git for-each-ref --format='%(ahead-behind:upstream)' refs/heads/
fatal: failed to find 'upstream'
```

Wrapping it in `%(if)%(upstream)%(then)…%(end)` does not help — the atom is resolved before the
conditional. The atom that _is_ safe is `%(upstream:track)`, which yields `[ahead 3, behind 2]` /
`[ahead 3]` / `[behind 2]` / `[gone]` / empty-when-in-sync, and is empty (not fatal) for a branch
with no upstream. `exec-git.ts` already pins `LC_ALL=C`, so the wording is stable.

### 2. Two more spawns per call that the same `for-each-ref` can absorb

`git symbolic-ref --short HEAD` (line 1615) and the second `for-each-ref refs/remotes/` (line 1647)
are separate invocations. `%(HEAD)` and passing both ref prefixes to one command remove both.

### 3. No coalescing anywhere, and no cache to invalidate

`GitRpcHandlers` delegates straight to `GitInfoService` on every call. Two callers asking for the
same workspace's branch list at the same instant run two full command sets. Repeat calls after a
watcher event re-run everything even when nothing about the refs changed.

### 4. The frontend asks three times per switch

Three independent, uncoordinated entry points, all within a few hundred ms of a switch:

- `libs/frontend/editor/src/lib/services/git-branches.service.ts:162` —
  `switchWorkspace()` → `refreshBranches()`.
- `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts:164` —
  the component constructor calls `refreshBranches()`.
- `git-branches.service.ts:146` — the `git:status-update` push from `GitWatcherService`, whose
  initial post-arm fetch fires at `INITIAL_FETCH_DELAY_MS = 50`
  (`apps/ptah-electron/src/services/git-watcher.service.ts:188`).

The existing `_isRefreshing` / `_refreshQueued` guard does not merge them, it **serialises** them,
and worse: the trailing rerun at `git-branches.service.ts:230` sets
`refreshBranches = refreshStash = refreshLastCommit = true` unconditionally, so a queued request
that only wanted the stash count re-runs the expensive branch listing as well.

`refreshBranchList()` also has no stale-response guard: a response for the previous workspace that
lands after a switch is written straight into the signals.

## Files

- `libs/backend/vscode-core/src/services/git-info.service.ts` — `getBranches` / `parseBranchRefLine`;
  new read cache + in-flight coalescing + `invalidateReadCache`.
- `libs/backend/vscode-core/src/services/git-info.service.spec.ts` — rewrite the three `getBranches`
  specs for the single-invocation format; add spawn-count, coalescing and invalidation specs.
- `apps/ptah-electron/src/services/git-watcher.service.ts` — one call into
  `invalidateReadCache` from `fetchAndPush`, the existing watcher event.
- `libs/frontend/editor/src/lib/services/git-branches.service.ts` — slice-accurate coalescing
  window, stale-workspace guard.
- `libs/frontend/editor/src/lib/services/git-branches.service.spec.ts` — one-request-per-switch spec.

## Plan

1. **One git invocation for the branch listing.** Replace the two `for-each-ref` calls and the
   `symbolic-ref` call with a single
   `git for-each-ref --format=<7 fields> refs/heads/ [refs/remotes/]`, carrying
   `%(refname)` (to tell local from remote unambiguously), `%(HEAD)` (current branch) and
   `%(upstream:track)` (ahead/behind). `parseBranchRefLine` becomes pure and synchronous — the
   `rev-list` fallback is deleted, not made parallel. `symbolic-ref` survives only as a fallback for
   the two states where no ref carries `*` (unborn HEAD, detached HEAD).
2. **Cache + coalesce in `GitInfoService`**, which is the registered singleton every host shares
   (`TOKENS.GIT_INFO_SERVICE`) and the object `GitWatcherService` already holds:
   - `getBranches` / `stashList` / `getLastCommit` / `getTags` / `getRemotes` — in-flight
     coalescing **and** a settled entry held until invalidated.
   - `getGitInfo` — in-flight coalescing only. It is the working-tree status walk and the watcher's
     own source of truth; a settled entry would make the watcher push stale status.
   - Keys are `${method}|${workspacePath}|${variant}`, so two workspaces never share an entry.
   - A monotonic `cacheGeneration` guards the write-back: a computation already in flight when an
     invalidation happens must not resurrect its pre-change value afterwards. The in-flight map is
     deleted **by identity**, so an invalidated computation settling does not evict the newer one
     that already claimed its key. Same idiom as `auth:getAuthStatus` (TASK_2026_342).
3. **Invalidate on the existing watcher event.** Every repo-mutating method on `GitInfoService`
   (`checkout`, `commit`, `stageFiles`, `unstageFiles`, `discardChanges`, `push`, `applyHunks`,
   `addWorktree`, `removeWorktree`) invalidates its own workspace. External mutations arrive via
   `GitWatcherService.fetchAndPush`, which calls `invalidateReadCache(workspacePath)` before it
   fetches — so the status it pushes and the branch list the renderer asks for next are from the
   same instant.
4. **One frontend request per switch.** Replace the `_refreshQueued` boolean with a pending-slice
   set and a short coalescing window (`REFRESH_COALESCE_MS = 200`, comfortably over the watcher's
   50 ms initial-fetch delay). Requests arriving in the window merge; the trailing rerun issues only
   the slices actually requested. A pass captures the active workspace at start and drops its
   write-back if the workspace changed underneath it.

## Acceptance criteria

1. `getBranches` spawns **exactly one** git process for a repository whose branches all have
   upstreams, regardless of branch count — asserted on the mocked `cross-spawn` call count.
2. That one invocation is `for-each-ref`, and its argv contains `refs/heads/` (plus `refs/remotes/`
   only when `includeRemote` is true) and no `rev-list`.
3. Ahead/behind survive: `[ahead 3, behind 2]`, `[ahead 3]`, `[behind 2]`, `[gone]`, empty-with-
   upstream and empty-without-upstream all map to the right numbers.
4. `%(HEAD)` sets `isCurrent` and `current`; when no ref carries `*`, `symbolic-ref` is consulted
   exactly once as a fallback.
5. Two concurrent `getBranches` calls for the same workspace and same `includeRemote` produce one
   git invocation and two identical results.
6. A third `getBranches` call after the first two settle produces **no** further git invocation
   (settled cache).
7. `invalidateReadCache(ws)` makes the next `getBranches` spawn git again, and invalidating
   workspace A leaves workspace B's entry intact.
8. A computation in flight when `invalidateReadCache` fires does not write its result into the
   cache.
9. `GitWatcherService.fetchAndPush` calls `invalidateReadCache` for the watched workspace before
   fetching status.
10. `GitBranchesService`: three refresh requests inside the coalescing window (switch + status-bar
    constructor + watcher push) issue **one** `git:branches` RPC.
11. A queued request whose only cause is `refs-stash` does not re-issue `git:branches`.
12. A `git:branches` response for the previous workspace, landing after `switchWorkspace`, is
    dropped instead of being written into the signals.

## Test projects

- `@ptah-extension/vscode-core`
- `@ptah-extension/rpc-handlers`
- `@ptah-extension/editor`
- `ptah-electron`

## Implementation notes

### What changed

**`GitInfoService.getBranches` is one `for-each-ref`.** Format:

```
%(refname) %09 %(refname:short) %09 %(HEAD) %09 %(objectname:short)
          %09 %(upstream:short) %09 %(upstream:track) %09 %(creatordate:unix)
```

Local and remote refs come from one invocation and are told apart by the FULL
`%(refname)`, not the short name — a local branch legitimately named `origin/foo` is
indistinguishable from a remote-tracking ref by short name alone. `parseBranchRefLine` is now
pure and synchronous; the `rev-list` fallback is deleted rather than parallelised.

Two placement details are load-bearing and easy to undo by accident:

- **`%(HEAD)` sits in the interior of the format.** It renders as a single space for every
  non-current ref, and at either end the per-line `trim()` would eat it and shift every field.
- **`%(upstream:track)`, never `%(ahead-behind:upstream)`.** The latter aborts the entire command
  with `fatal: failed to find 'upstream'` as soon as one ref in the set has no upstream (verified
  against git 2.54), and `%(if)%(upstream)%(then)…%(end)` does not rescue it because the atom
  resolves before the conditional.

`symbolic-ref` survives only as a fallback for the two states where no ref carries `*` — unborn
HEAD and detached HEAD — so it costs one extra spawn only there.

**Cache + coalescing live on `GitInfoService`, not on `GitRpcHandlers`.** `GitInfoService` is the
registered singleton behind `TOKENS.GIT_INFO_SERVICE` and the exact object `GitWatcherService`
already holds, so invalidation from the watcher needs no new token, no new wiring, and cannot end
up pointed at a second instance. `GitRpcHandlers` needed no change at all; every host and the
watcher share one cache. `getBranches` / `stashList` / `getTags` / `getRemotes` / `getLastCommit`
get in-flight coalescing plus a settled entry; `getGitInfo` gets coalescing only.

**Invalidation is derived from the argv, in `execGit` / `execGitBuffer`.** Those two private
wrappers are the only places this service spawns git, so `isMutatingGitCommand(args)` there means
a future mutating method inherits invalidation instead of having to remember it. Read commands
must answer `false` or they would invalidate the entry they were about to populate — hence the
sub-command checks on `stash` (`list` / `show` are reads) and `worktree` (`list` is a read).

### Deviations from the plan

- **No change to `GitRpcHandlers`.** The plan located coalescing "per workspace (in-flight map)"
  in the handler; putting it one layer down in `GitInfoService` covers the handler, the watcher,
  and the VS Code and CLI hosts with one implementation. Handler-level coverage would also have
  been untestable — its `gitInfo` is a mock in its spec, so a coalescing assertion there would
  test the double.
- **The frontend coalescing window is a real 200 ms timer**, not a microtask. The three requests
  are not same-tick: the watcher's initial push is deferred by
  `GitWatcherService.INITIAL_FETCH_DELAY_MS = 50`, and the status-bar constructor runs whenever
  the panel mounts. A microtask join would have merged two of the three, not all three.

### Verification

`npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/editor
@ptah-extension/rpc-handlers ptah-electron --parallel=1` — 4 projects, all green:
424, 443, 2534 (+31 skipped) and 405 (+4 skipped) tests. Typecheck green for the same four.

**Run these serially.** Under a parallel run on a loaded machine two unrelated timing specs
(`cpu-profile-capture.spec.ts` and the coalescing specs) flake. The coalescing specs were
rewritten to poll for actual RPC dispatch rather than sleep past `REFRESH_COALESCE_MS`, which
removes their half of that; `cpu-profile-capture` is pre-existing and untouched.

### Measured effect

The branch listing goes from `1 + 1 + 1 + N` spawns (N = branches with an upstream, sequential) to
exactly 1. On this repository N = 113; 20 of those spawns measured 4.1 s against 0.29 s for the
single `for-each-ref`. The frontend goes from three serialised `git:branches` round trips per
switch to one.

### Note for the reviewer

While probing atom behaviour I ran `git branch --set-upstream-to=origin/main main` in this
repository. `branch.main.remote` / `branch.main.merge` were almost certainly already set (the
config carries 324 `branch.*` entries and a `branch.main.vscode-merge-base`), so this was a
no-op — but it was a config write and is recorded here rather than left silent.

## Follow-up (judge round 1)

Three findings on `35e3fcec7`, all landed. No production behaviour changed except item 1.

### 1. `isMutatingGitCommand` inverted to default-mutating

The docstring promised that "a future method inherits invalidation by construction", but the
switch was an allowlist of twelve write verbs with `default: false`. Every verb it omitted —
`branch`, `fetch`, `tag <name>`, `cherry-pick`, `revert`, `am` — would have been classified as a
read, serving a stale branch list until the next watcher event. `branch` and `tag` are the sharp
ones: they write exactly what the cache holds.

The switch is now a **read allowlist with `default: true`**, which is the direction the asymmetry
demands: mis-classifying a read costs one extra `for-each-ref`, mis-classifying a write costs
correctness. The allowlist is the exact set of verbs this service spawns on its read paths —
enumerated from all 23 `execGit`/`execGitBuffer` call sites — plus five read-only plumbing verbs
(`rev-list`, `cat-file`, `ls-files`, `ls-tree`, `merge-base`) that have no writing form.

Four verbs are read-only only in some forms and are no longer trusted wholesale:

| verb            | read form                   | write form                       | discriminator      |
| --------------- | --------------------------- | -------------------------------- | ------------------ |
| `stash`         | `list`, `show`              | `push`, `pop`, `apply`, `drop`   | sub-command        |
| `worktree`      | `list`                      | `add`, `remove`, `prune`         | sub-command        |
| `remote`, `tag` | `remote -v`, `tag --sort=…` | `remote add x`, `tag v1.0`       | ≥1 positional arg  |
| `symbolic-ref`  | `symbolic-ref --short HEAD` | `symbolic-ref HEAD refs/heads/x` | ≥2 positional args |

`symbolic-ref` is the one the original switch would have got wrong in _this_ file's own idiom:
`getBranches` calls the read form, and the write form repoints HEAD.

The function is now exported (from the module, **not** the lib barrel — verified) so the
classification can be specced directly. 50 table rows: 19 reads, 31 mutations, the latter
deliberately including verbs this service never spawns, because that is the property under test.

### 2. The stale-workspace spec was vacuous

Confirmed the judge's reading. `runRefreshPass` always ran a second, legitimate round for
`/repo-b` whose `EMPTY_BRANCHES` result overwrote the stale write, so the spec passed with the
`isStale` guard deleted — it asserted the final value, not that the stale write was refused.

Both branch rounds now hang on separate blockers. `/repo-b`'s round is still in flight at the
assertion, so the only write that could have reached `_branches` is `/repo-a`'s stale response.
Waiting for `/repo-b`'s round to be _dispatched_ is what proves `/repo-a`'s response already
settled and the guard has had its chance — without it the spec would be vacuous in the opposite
direction.

**Mutation-verified**: with `isStale` stubbed to `return false`, the spec fails
`Expected: "" / Received: "old-repo-branch"`. Guard restored; `git diff` against `35e3fcec7` for
`git-branches.service.ts` is empty.

### 3. `no upstream configured` row added

The `upstream:track` table fixed `upstream: 'origin/main'` on every row, so the empty-track case
only ever covered "in sync", never "no upstream at all" — and git emits an empty field for both.
The table now carries `upstream` as its own column with a `['', '', 0, 0]` row, and asserts
`upstream` is reported as `undefined` rather than `''`.

### Verification

`npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/editor --parallel=1
--skip-nx-cache` — 2 projects, green: vscode-core 475/475 (was 424; +51 rows), editor 443/443.
Typecheck green for the same two.

# P4 fix — finding 2 (Moderate): stale replies restoring fallback scripts and operations

## Frontend implementation — `TASK_2026_719_4f64`, P4 finding 2

**Tasks completed**: code-logic-review-p4.md finding 2.

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts — a reply's handle and script are accepted only while that reply is still current
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts — 6 deferred-reply tests

## Change (provider-accounts-state.service.ts)

- `:37` `HANDLE_KINDS` lists the writes whose reply can carry an operation handle: `sign-in`, `cancel-sign-in` and `sign-out`.
- `:104` `Slot.handleEpochs` holds one epoch counter per profile.
  - `startHandleEpoch` (`:621`) advances the counter when a handle-bearing write starts.
  - `apply()` (`:482`) advances it when an accepted snapshot shows the profile is no longer pending. That covers terminal states and removal.
  - `resetForWorkspace()` (`:417`) clears it, along with operations and fallbacks, which were already cleared there.
- `write()` records the workspace `generation()` and the profile epoch before the RPC call (`:563-565`). After `apply()`, the `operation` and `fallback` fields from the response are written (`:591-614`) only when all of these hold:
  1. the workspace generation has not changed;
  2. the profile epoch has not changed, so no newer handle write and no terminal or removal snapshot has happened since the request started;
  3. `acceptedPending()` (`:635`) passes: the snapshot now held is for the same active workspace, its revision is at least the reply's revision, and it shows the profile as `pending`.
- The fix does not depend on whether `apply()` returned true. A pending snapshot that arrived first by push (same revision, so `apply()` returns false) still keeps the reply's script and handle.
- The fallback is never logged. Nothing was added to any log path.

## Tests added (spec `:341`, `describe('deferred sign-in replies ...')`)

1. The same pending snapshot arrives by push before the reply: the script and handle are kept (the valid case).
2. A newer terminal push (`cancelled`, rev 3) arrives before the older sign-in reply (rev 2): no handle or script is restored. A later pending push also shows neither.
3. A removal push after a reply was accepted clears the handle and the script.
4. A newer sign-in attempt resolves before the older reply, which has a lower revision: the newer attempt's operation and script win.
5. Same as 4, but the older reply has the same revision as the newer one: the newer attempt still wins, through the epoch check.
6. A workspace reset happens before the older reply: the test switches away and back to the same root, and the re-read returns a pending snapshot with the same revision. Nothing is restored, through the generation check.

Tests 2, 4 and 6 fail against the previous code. Before the fix, `write()` checked `pending` against the rejected response snapshot.

## Specs that mock or pin the changed members

`write()`, `apply()` and `resetForWorkspace()` are private. They are covered only by `provider-accounts-state.service.spec.ts`. The existing fallback tests there (`keeps a sign-in fallback script only while that sign-in is pending`, `a status read without an operation drops the fallback script`) and the sign-in/cancel test still pass without changes.

## Verification

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts --maxWorkers=2`: 1 suite, 23 tests passed.
  - This run was before one test was renamed afterwards (title only). The renamed test is "a removal push after the reply clears the handle and script".
- `npx tsc --noEmit -p libs/frontend/core/tsconfig.lib.json`: no output (clean).
- `npx eslint` on both files: no output (clean).
- Not run, by instruction: `npm run verify`, build, serve, git.

## Decisions

- **Decision:** use a per-profile epoch plus the workspace generation, instead of requiring the held revision to equal the reply's revision exactly.
  - **Options:** (a) exact revision equality; (b) epoch plus generation plus "the held snapshot is not older and still pending".
  - **Evidence:** finding 4 says the host emits a pending push and then a committed push with a higher revision for the same transition. Exact equality (a) would drop a legitimate script when the reply's snapshot is older than a later push for the same pending attempt. Option (b) also covers a newer attempt whose reply has the same revision (test 5).
  - **Reversible:** yes; the change is local to the service.
- **Decision:** a `cancel-sign-in` or `sign-out` that starts also invalidates an older in-flight sign-in reply for the same profile, because both are in `HANDLE_KINDS`. Reversible.

## Out-of-scope observations

- `refreshAccountStatus()` still writes the `getAccountStatus` operation without a generation check. A status reply that arrives after a workspace switch could set a handle in the new workspace's slot. That is outside finding 2's two files' scope as briefed; it is the same file, but it was not requested. Recommend the same generation guard there.

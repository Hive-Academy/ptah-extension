# Batch 1 Implementation Report — TASK_2026_315 (A1)

**Executor**: `backend-developer`
**Scope**: Tasks 1.1, 1.2, 1.3 only. No file outside Batch 1's "Files touched" list
was opened for writing. `apps/ptah-electron/src/activation/wire-runtime.ts` was
read as context only (`:330-393`) and **not modified** — Batch 4 owns it.
**Status**: complete. No clarifications needed; the decision was answerable from
the code.

---

## Task 1.1 — The decision

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
(guard added in `handleWorkspaceChanged`, immediately after the `initialized` check)

### Chosen: FREEZE — skip the reconfigure, leave `lastConfiguredAuth` in place

```ts
if (this.workspaceProvider.getWorkspaceFolders().length === 0) {
  this.logger.debug('[SdkAgentAdapter] Workspace change with no folders open — keeping the current auth configuration');
  return;
}
```

The reasoning, in full, is recorded in a decision comment at the guard (≈45
lines). Summary:

The load-bearing observation is what `lastConfiguredAuth` actually means. It is
**not** "the provider of the open workspace" — it is **"the provider the auth env
is currently configured for"**. Closing a folder changes nothing about the env,
so freezing the field is what keeps that invariant TRUE. Everything downstream
follows from that.

The defect is that `resolveActiveAuth()` reads the workspace scope
(`ActiveProviderResolver.resolveActiveAuth` → `WorkspaceScopeResolver.read`),
and with zero folders there is no scope to read, so it returns the **global
default** — a value nobody chose for that moment. Treating that fallback as a
user-intent provider change is the whole bug: it defeats the equality
early-return, burns an OAuth refresh, and binds a proxy under the global scope
that `disposeForScope(params.path)` can never reach.

### The three sub-questions, answered

**(a) What does the next `configureAuthentication` see after a folder is
re-added?** Exactly the right thing, because the frozen record is accurate. The
handler fires again with a real scope: same provider → the equality early-return
is correct (the env already holds those credentials, so a reconfigure would be
pure waste and a second OAuth refresh); different provider → a full reconfigure
runs, identical to any other switch. Nothing is deferred, nothing is lost. Both
halves are pinned by tests (`re-adding a folder with the same provider does not
reconfigure` / `... with a different provider reconfigures`).

**(b) Should `cliDetector` / `modelService` caches be cleared on the way to zero
folders?** **No, deliberately.** Those caches are keyed to the provider the env
still holds. On the way to zero folders that provider has not changed, so the
caches are still accurate; clearing them would discard valid data that would be
re-populated with identical content. The stale-cache failure mode they were
added for (TASK note at `:267-272` — `config:models-list` serving the previous
provider's models) cannot occur here, because the re-add path clears them itself
whenever the provider actually changes. Pinned negatively in the first test
(`clearCache` not called on the zero-folder path) and positively in the switch
test (`clearCache` called exactly once on a real switch).

**(c) Should this and `wire-runtime.ts:351` end up with the same rule?** The same
rule **in shape**, not the same expression, and that difference is intentional.
Both say "skip workspace-derived work when there is no workspace". The sibling
asks `getWorkspaceRoot()` because it needs a **path** to hand to
`bootHeavyServices(active)` / `propagateHarness(...)`. The adapter needs no path
— only "is there any scope at all" — so it asks `getWorkspaceFolders().length`.
On emptiness the two are equivalent (`getWorkspaceRoot()` is `folders[0]`), but
the count expresses the actual precondition and would not silently change
meaning if a host ever separated "active folder" from "folders open".

### Rejected: TEAR THE PREVIOUS AUTH DOWN (`clearAuthentication()` + `lastConfiguredAuth = null`)

This was the live alternative named in the plan. It was rejected for three
concrete costs and zero benefit:

1. **It makes `lastConfiguredAuth` lie in the other direction.** Null while
   `process.env` / `AuthEnv` still hold live credentials. Re-adding the _same_
   folder would then force a full reconfigure and the exact OAuth refresh this
   guard exists to prevent — merely deferred from removal-time to add-time. The
   third test pins that this does not happen.
2. **It manufactures the unhealthy state the adapter already has recovery code
   for.** Sessions started under the closed folder remain resumable
   (`resumeSession` gates on `initialized`, not on an open folder). A cleared
   auth env leaves them unauthenticated, which is precisely the
   `health.status === 'error'` condition the `onAuthFileChanged` handler at
   `:200-212` exists to climb out of — so a teardown risks arming a re-init that
   the watcher then re-enters.
3. **It would be a HALF teardown, and the half it cannot do is the leak.** The
   listening socket belongs to `ProviderProxyPool`, which lives outside
   `agent-sdk` and must stay there — the hexagonal rule forbids this lib
   reaching a host-owned pool, and it is not injected here. A teardown would
   clear credentials while leaving the socket exactly where it was. Proxy
   lifetime is owned by `workspace:removeFolder`. The correct fix is to never
   start one on this path, which is what the guard does.

### Acceptance criteria

- Removing the last folder starts no proxy and triggers no OAuth refresh — the
  reconfigure that caused both is not reached. Pinned by test 1.
- A genuine A → B switch with different providers still reconfigures. Pinned by
  test 2, which **passes with the guard reverted** (it is the anti-widening
  companion, not part of the fail-then-pass evidence).
- No Electron / `platform-*` adapter import added. The guard uses
  `IWorkspaceProvider.getWorkspaceFolders()`, an existing `platform-core` port
  method already injected into this class at `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.
  No new import statement of any kind was added to the file.
- Chosen and rejected options are both recorded in the code comment.

---

## Task 1.2 — Ordering in `workspace:removeFolder`

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts` (`:258-288`)

**Outcome: no ordering change. Task 1.1's guard fully closes the window, and
swapping the two lines would NOT have closed it.** The file was opened, the
question was worked, and the answer is recorded as a comment at
`disposeForScope` so the next reader does not re-litigate it. This is not a
silent skip.

Three findings behind that:

1. **Reordering does not close the window.** The plan's framing is that the
   proxy is started "between" `removeFolder(path)` (`:268`) and
   `disposeForScope(params.path)` (`:273`). It is more slippery than that:
   `handleWorkspaceChanged` calls `reconfigureAuthIfChanged().catch(...)`
   **without awaiting**, and the proxy is bound several awaits deep inside
   `configureAuthentication`. So the bind can land after _any_ point inside this
   handler — including after a dispose that had been moved first. A dispose
   cannot beat an unawaited chain by being reordered.
2. **The scope mismatch makes ordering irrelevant anyway.** The adapter
   registers its proxy under the **global** scope, not `params.path`.
   `disposeForScope(params.path)` cannot see it at any ordering. Only not
   starting it works — which is what the guard now guarantees for the
   zero-folder case.
3. **For a NON-last folder removal, disposing the new proxy would be the bug.**
   Removing one of several folders still reconfigures (correctly — the active
   root may have moved to a folder with a different provider), and any proxy
   started then belongs to the workspace that **remains open**. Tearing it down
   because it appeared during a `removeFolder` call would break the surviving
   workspace.

`disposeForScope` is untouched and still never throws (it swallows per-entry
errors). The only edit to this file is the explanatory comment; behaviour is
byte-for-byte unchanged, and all 87 `rpc-handlers` suites pass.

---

## Task 1.3 — Named test deliverable: fail-then-pass evidence

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`
(extended — no new spec file), new block
`describe('no-workspace guard on folder change (TASK_2026_315 A1)')`, 4 tests.

### Enabling change to the test harness

`createMockWorkspaceProvider` previously returned a frozen folder list and threw
its `onDidChangeWorkspaceFolders` listener away, so the constructor subscription
could never be driven. It now keeps a **mutable** list, captures listeners, and
exposes `__state.setFolders(next)`, which mutates the list **before** firing.
That ordering is the real contract and is load-bearing:
`ElectronWorkspaceProvider.removeFolder` (`platform-electron`, `:148-164`)
splices and only then calls `fireFoldersChange`, so a handler always observes the
POST-change list. A mock that fired first would let the guard read a stale count
of 1 and the specs would pass vacuously. This is documented on the mock.

### Observed fail-then-pass

The guard block was physically removed from `sdk-agent-adapter.ts`, the specs
run, then the guard restored and re-run.

**With the guard reverted — FAILED (3 of 4):**

```
Tests: 3 failed, 46 skipped, 1 passed, 50 total

● SdkAgentAdapter › no-workspace guard on folder change (TASK_2026_315 A1)
  › does not reconfigure auth when the last workspace folder is removed

    expect(jest.fn()).toHaveBeenCalledTimes(expected)
    Expected number of calls: 1
    Received number of calls: 2
      at src/lib/sdk-agent-adapter.spec.ts:701:53

● ... › re-adding a folder with the same provider does not reconfigure
    Expected number of calls: 1
    Received number of calls: 3
      at src/lib/sdk-agent-adapter.spec.ts:746:53

● ... › re-adding a folder with a different provider reconfigures
    Expected number of calls: 1
    Received number of calls: 2
      at src/lib/sdk-agent-adapter.spec.ts:758:53
```

The primary assertion is the first one: `configureAuthentication` called
**twice** instead of once — the second call being the reconfigure that burns the
OAuth refresh and binds the leaked proxy.

**With the guard restored — PASSED:**

```
Tests: 46 skipped, 4 passed, 50 total
```

The one test that passes in **both** states is
`still reconfigures on a switch from folder A to folder B with a different
provider`. That is by design: it is the companion positive test whose job is to
fail if the guard is ever widened into a regression, so it must pass on
un-guarded code.

---

## Commands run, and results

| #   | Command                                                                                                                                       | Result                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `npx nx test agent-sdk --testPathPattern=sdk-agent-adapter.spec`                                                                              | PASS — 74 suites, 1049 tests (the flag is not forwarded by this jest version; it ran the whole project) |
| 2   | `npx jest --config libs/backend/agent-sdk/jest.config.ts --testPathPatterns "sdk-agent-adapter.spec" -t "TASK_2026_315"` — **guard reverted** | **FAIL — 3 failed, 1 passed** (evidence above)                                                          |
| 3   | same command — **guard restored**                                                                                                             | PASS — 4 passed                                                                                         |
| 4   | `npx nx test agent-sdk --skip-nx-cache`                                                                                                       | PASS — 74 suites, 1049 tests                                                                            |
| 5   | `npx nx test rpc-handlers --skip-nx-cache`                                                                                                    | PASS — 87 suites, 2423 passed / 31 skipped (see flake note)                                             |
| 6   | `npx nx test rpc-handlers --skip-nx-cache` (repeat)                                                                                           | PASS — 87 suites, 2423 passed / 31 skipped                                                              |
| 7   | `npx nx run-many -t lint -p agent-sdk rpc-handlers --skip-nx-cache`                                                                           | PASS — **0 errors**, 19 warnings, all pre-existing                                                      |
| 8   | `npx nx run-many -t typecheck -p agent-sdk rpc-handlers --skip-nx-cache`                                                                      | PASS — clean                                                                                            |

**No git commits were created.** The team-leader commits after review.

### Flake note on command 5

The first `rpc-handlers` run — launched concurrently with the `agent-sdk` run —
reported a batch of "Test suite failed to run" entries. Two clean sequential
re-runs (5 and 6) both passed all 87 suites, and `rpc-allowlist.spec` passed in
isolation. The output carries Jest's
`A worker process has failed to exit gracefully and has been force exited`
message, which is present on the passing runs too. This is a pre-existing
worker-teardown leak in the project surfacing under parallel load, not a
regression from this batch. Flagging rather than fixing: it is outside Batch 1's
file list.

### Lint note

`sdk-agent-adapter.ts` carries a pre-existing `max-lines` **warning**. Verified
against `git stash`: **841 lines before this batch, 847 after** — the file was
already over the 700 soft ceiling, and the delta is the 6 counted lines of the
guard (the decision comment is not counted; the rule skips comments). Per
`CLAUDE.md` the ceiling is warn-level and line count alone is not the signal; a
bugfix batch is not the place to split a 10-concern adapter. Recorded, not acted
on.

---

## Files changed

| File                                                                                              | Change                                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`                  | Zero-folder guard in `handleWorkspaceChanged` + decision comment                                    |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts` | Comment only — records why the `removeFolder` / `disposeForScope` order stands. No behaviour change |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`             | Mutable + listener-capturing workspace-provider mock; new 4-test `TASK_2026_315 A1` block           |

---

## Post-review correction

Addresses **Moderate Issue 1** from `code-logic-review-batch-1.md`. Comment-only;
**no code changed**, no test changed, no behaviour changed.

### What was wrong

Both decision-record comments said the leaked proxy "registers under the GLOBAL
scope, so `disposeForScope` cannot reach it." That describes one registry with a
bucket the dispose fails to match by key. It is not what happens.

I verified the reviewer's trace against source before editing rather than taking
it on faith:

- `provider-proxy-pool.ts:114-115` — `entries` is keyed
  `${workspacePath}::${providerId}`. There is no "global" key.
- `provider-proxy-pool.ts:229` — the **only** `entries.set` in the file, inside
  `acquire()` (opens at `:145`). Single writer.
- `provider-proxy-pool.ts:419-421` — `disposeForScope` only prefix-filters
  `entries` by `${workspacePath}::`.
- `provider-proxy-pool.ts:10-14` (docblock) — workspaces without an explicit
  provider override "never reach the pool — they keep riding the process-global
  singleton proxies configured by the strategies."
- `oauth-proxy.strategy.ts:217-221` — `await this.codexProxy.start()` followed by
  the `Codex translation proxy started at ${proxyUrl}` log, i.e. the exact
  `[CodexProxy] Translation proxy started` line in `context.md`.

So the two are **disjoint registries**. The proxy that actually leaks is the
injected `OAuthProxyStrategy` singleton and was never a `ProviderProxyPool` entry
under any key. `disposeForScope` was not failing to match — it was never wired to
reach that object at all.

### Why it mattered enough to edit

The conclusion ("no ordering change and no `disposeForScope` change can close
this") is unaffected — it is in fact **stronger** under the correct mechanism.
But this is a decision task where the written reasoning is the deliverable, and
the old wording sends the next person debugging a proxy leak into
`ProviderProxyPool` to hunt for a global-scope entry that does not exist. The
plausible wrong fix — teaching `disposeForScope` about a "global" key — is now
named and warned against explicitly in the handler comment.

### Edits made

| File                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk-agent-adapter.ts` (defect paragraph, was `:256-259`) | "The proxy is registered under the GLOBAL scope…" → the binder is the process-global `OAuthProxyStrategy` singleton, a **different registry** from `ProviderProxyPool` that `disposeForScope` was never wired to reach under any key. 5 lines → 6                                                                                                                                                                                                 |
| `sdk-agent-adapter.ts` (REJECTED paragraph)               | Same inaccuracy, second instance, not cited in the review but part of the same error: "the leaked socket belongs to `ProviderProxyPool`, which this lib cannot reach" → the socket belongs to the `OAuthProxyStrategy` singleton behind the `IAuthEnvProvider` port, which exposes no teardown call and must not grow one for this lib. Also dropped the now-false "proxy lifetime is owned by the `workspace:removeFolder` handler". 5 lines → 5 |
| `workspace-rpc.handlers.ts` (was `:280-282`)              | Restructured to two numbered independent reasons; reason (2) now states the disjoint-registry mechanism, names `WorkspaceProviderProfileResolver.acquire()` as the pool map's sole writer, and adds the explicit warning that there is no "global" key to teach the dispose about. 13 lines → 18                                                                                                                                                  |

The decision itself was not re-argued — the reviewer accepted it. Net counted
(non-comment) lines in `sdk-agent-adapter.ts` are unchanged at 847.

### Re-verification

| Command                                                             | Result                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npx nx test agent-sdk --skip-nx-cache`                             | PASS — 74 suites, 1065 tests                                                                                    |
| `npx jest ... sdk-agent-adapter.spec -t "TASK_2026_315"`            | PASS — 4 of 4 A1 tests                                                                                          |
| `npx nx run-many -t lint -p agent-sdk rpc-handlers --skip-nx-cache` | rpc-handlers 0 errors / 19 warnings (unchanged). agent-sdk reports **1 error — not from this batch**, see below |
| `npx eslint` on the three Batch 1 files only                        | **0 errors**, 1 warning (the pre-existing `max-lines` on `sdk-agent-adapter.ts`, still 847)                     |

**Tree drift during the correction — team-leader please note.** The agent-sdk test
count rose from 1049 to 1065 and four more files appeared modified
(`sdk-query-options-builder.spec.ts`, `sdk-permission-handler.ts`,
`sdk-permission-handler.spec.ts`, plus edits to files already dirty) between my
Batch 1 run and this one. Concurrent work is landing in this lib. The new lint
error is `prefer-const` on `let realSessionId` at
`libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts:472` — a file this
batch never opened, which was clean when I ran lint during Batch 1. **I did not
fix it**: it is outside Batch 1's file list and editing another agent's in-flight
file would conflict. Whoever owns that change needs to clear it before the lib
lints clean.

### Noted, not actioned

The reviewer's **Failure Mode 1** — `reconfigureAuthIfChanged` is fire-and-forget
with no in-flight mutex (unlike `initialize()`'s `initInFlight`), so a rapid
remove-then-add can race two `configureAuthentication` calls and the last to
settle wins `lastConfiguredAuth`. Pre-existing, out of A1's scope, and the
coordinator is tracking it as a separate follow-up finding. Not touched here.

---

Note for the team-leader: the working tree also contains unrelated modifications
from other batches/tasks (`libs/frontend/tasks-ui/**` = Batch 3 running in
parallel, plus several `libs/backend/agent-sdk/src/lib/helpers/**` files and
`libs/frontend/chat*` files that predate this batch). None of them were touched
by this batch — stage the three files above only.

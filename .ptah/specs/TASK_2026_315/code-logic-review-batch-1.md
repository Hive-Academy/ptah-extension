# Code Logic Review - TASK_2026_315 Batch 1 (A1)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 1        |
| Failure Modes Found | 4        |

Scope: reviewed only `sdk-agent-adapter.ts`, `workspace-rpc.handlers.ts`,
`sdk-agent-adapter.spec.ts` — the three files this batch touched. Confirmed via
`git diff --stat` that no other file changed under these paths. Ignored
`libs/frontend/tasks-ui/**`, `libs/backend/agent-sdk/src/lib/helpers/**`,
`libs/frontend/chat*` and `tasks-rpc.handlers.spec.ts` (concurrent/pre-existing
work per the developer's note and current `git status`).

## The 5 Paranoid Questions

### 1. How does this fail silently?

The whole finding this batch fixes was itself a silent failure (a socket
leaked, nothing threw). The fix's own failure mode would be the same shape: if
the guard's predicate were ever wrong, the regression would again be silent —
no exception, just a resource leak or a stale-provider bug. Verified the
predicate is correct (see Q2 in the numbered checklist below), so this
particular silent-failure vector is closed. Residual: `reconfigureAuthIfChanged()`
is still fire-and-forget (`.catch()` only), unchanged by this batch. Two rapid
folder events (e.g. remove-then-add within one tick) can still race two
in-flight `configureAuthentication()` calls, and whichever resolves last wins
`lastConfiguredAuth` regardless of which is actually current. This is
pre-existing, not introduced here, and out of this batch's file list — flagging
as a residual risk, not a defect in this diff.

### 2. What user action causes unexpected behavior?

None identified that this diff introduces. Closing the last folder, re-opening
a folder (same or different provider), and a genuine A→B switch are all
covered by the four new tests and all resolve to the behavior the decision
record claims (see verification below).

### 3. What data makes this produce wrong results?

Checked whether any host's `IWorkspaceProvider.getWorkspaceFolders()` could
return a non-empty array while there is no usable scope (which would slip past
`length === 0` and reach `resolveActiveAuth()` with nothing to read). Confirmed
against all three host implementations:

- `platform-core` interface docs: "empty if no workspace open" for
  `getWorkspaceFolders()`, `undefined` for `getWorkspaceRoot()`.
- `ElectronWorkspaceProvider`, `CliWorkspaceProvider`: both derive
  `getWorkspaceRoot()` as `folders[0]` (or `activeFolder ?? folders[0]`) off the
  same backing array `getWorkspaceFolders()` returns — the two can never
  disagree on emptiness.
- `VscodeWorkspaceProvider`: both methods derive from the same
  `vscode.workspace.workspaceFolders` array.

No host can produce "folders.length > 0 but no usable root" today. The
`length === 0` predicate is a safe, host-consistent proxy for "no scope to
read."

### 4. What happens when dependencies fail?

`ActiveProviderResolver.resolveActiveAuth()` reads through
`WorkspaceScopeResolver.read()`, which asks `IActiveWorkspaceSource.getActivePath()`
(Electron: `lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot()`).
Traced this end to end: with zero folders both halves are `undefined`, so
`activeNormalizedPath()` returns `undefined`, `candidateKeys()` drops every
workspace/app-scoped candidate and falls straight to the bare `globalKey` —
i.e., exactly the "global default, not the workspace's provider" mechanism the
decision record describes. **Confirmed against source, not asserted.**

### 5. What's missing that the requirements didn't mention?

The plan (`tasks.md`) doesn't ask for a test on removing one of several folders
(2→1, not 2→0). The guard's predicate is a single `=== 0` check, so this path
is provably unaffected by inspection (it never reaches the new branch), and I
don't think it needs its own test — noting it so the team-leader doesn't read
its absence as an oversight.

## Verification of the three load-bearing claims

### Claim 1 — "`lastConfiguredAuth` means which provider the auth env is

configured for, not which workspace is open"

**Confirmed.** `doInitialize()` sets `lastConfiguredAuth` from
`resolveActiveAuth()` unconditionally before the first configure; from then on
`reconfigureAuthIfChanged()` only updates it after a _successful_
`configureAuthentication()` call (`sdk-agent-adapter.ts:332-337`). It never
records "which workspace" — there is no workspace identifier anywhere near it.
`AuthManager`/`AuthEnv`/`process.env` are also process-wide singletons, so
"the provider the shared auth env currently holds" is the only thing this field
can accurately describe. The freeze is the correct way to keep that invariant
true across a zero-folder transition, since nothing about the env changes when
a folder closes.

### Claim 2 — the guard predicate (`getWorkspaceFolders().length === 0`)

**Confirmed correct and consistently safe across hosts** — see Q3 above.

### Claim 3 — Task 1.2: reordering would not close the window, because (a) the

reconfigure chain is unawaited and (b) the proxy registers under "the global
scope" which `disposeForScope(path)` cannot reach

**(a) Confirmed.** `handleWorkspaceChanged()` calls
`this.reconfigureAuthIfChanged().catch(...)` with no `await`
(`sdk-agent-adapter.ts:301`), and the constructor subscribes this handler
synchronously to `onDidChangeWorkspaceFolders`
(`sdk-agent-adapter.ts:186-188`). `WorkspaceRpcHandlers.removeFolder` calls
`workspaceLifecycle.removeFolder(path)` (which fires the event synchronously)
and then, still in the same handler, `await
this.providerProxyPool.disposeForScope(params.path)`
(`workspace-rpc.handlers.ts:268-287`). Because the reconfigure chain is
detached, it can genuinely complete at any point relative to the RPC handler's
own execution, including after a hypothetically-reordered dispose call. Swapping
the two lines cannot fix a race against an unawaited chain. Verified.

**(b) True, but imprecisely argued — see Moderate finding below.** Traced the
actual proxy that starts: `reconfigureAuthIfChanged()` calls
`this.authManager.configureAuthentication(active.authMethod)`
(`AuthManager.configureAuthentication` → `OAuthProxyStrategy.configure()`),
which starts/reuses the injected **singleton** `codexProxy` /
`copilotProxy` instances (`oauth-proxy.strategy.ts:41-44`, `:116`, `:217`) — the
exact log line in `context.md` (`[CodexProxy] Translation proxy started...`)
comes from here. `disposeForScope(workspacePath)`
(`provider-proxy-pool.ts:419-434`) only ever touches
`ProviderProxyPool.entries`, a `Map` keyed `${workspacePath}::${providerId}`
that is populated **exclusively** by `WorkspaceProviderProfileResolver.acquire()`
— a completely different, opt-in per-workspace-override code path
(`workspace-provider-profile-resolver.ts:286-296`) that `SdkAgentAdapter` never
calls. **These are two disjoint proxy registries, not one registry with a
"global" bucket inside it.** `disposeForScope` was never wired to reach an
`OAuthProxyStrategy` proxy under _any_ scope name, "global" or otherwise — not
because the scope name doesn't match, but because the object was never a
`ProviderProxyPool` entry in the first place.

The end conclusion the code comment draws — "reordering does not help, and no
change to `disposeForScope` closes it" — is **correct**, and actually correct
for a _stronger_ reason than the comment states. But the comment's specific
mechanism ("it registers under the GLOBAL scope, which `disposeForScope` cannot
reach") reads as if `ProviderProxyPool` has a literal global-scope entry that
the dispose call merely fails to match by key. It doesn't: the pool's own
docblock says non-override workspaces "keep riding the process-global singleton
proxies configured by the strategies" and never touch the pool at all
(`provider-proxy-pool.ts:10-14`). A future reader chasing this comment into
`ProviderProxyPool` looking for a "global" scope key will not find one, and
could reasonably reach for the wrong fix (e.g. teaching `disposeForScope` about
a "global" key that doesn't exist and never should).

## Failure Mode Analysis

### Failure Mode 1: Race between an in-flight reconfigure and a fast second folder event (pre-existing, not introduced by this batch)

- **Trigger**: folder removed then re-added (or switched again) before the
  first `configureAuthentication()` promise settles.
- **Symptoms**: `lastConfiguredAuth` can end up reflecting whichever call
  happened to resolve last, not the actual current state; a subsequent
  `handleWorkspaceChanged` could then wrongly skip or wrongly run a reconfigure.
- **Impact**: Low-to-medium — same class of bug as A1 itself (silent-wrong
  state), but requires a narrow timing window this task didn't scope.
- **Current handling**: Unchanged by this batch; `.catch()` only, no
  in-flight de-duplication for this specific chain (contrast with
  `initialize()`'s `initInFlight` mutex).
- **Recommendation**: Out of scope for A1 — flag for a future finding if not
  already tracked; not a reason to block this batch.

### Failure Mode 2: Misleading decision-record comment sends a future reader to the wrong file

- **Trigger**: someone debugging a similar proxy-leak investigates
  `ProviderProxyPool` because the comment says the leaked proxy "registers
  under the GLOBAL scope."
- **Symptoms**: time lost searching `provider-proxy-pool.ts` for a scope
  concept that doesn't exist there.
- **Impact**: Low — documentation-only, does not change runtime behavior.
- **Current handling**: present in both comments (`sdk-agent-adapter.ts:256-259`
  and `workspace-rpc.handlers.ts:281`).
- **Recommendation**: see Moderate finding below.

### Failure Mode 3: Guard scope drifts if a host ever separates "active folder" from "any folder open"

- **Trigger**: a hypothetical future host where `getWorkspaceFolders().length`
  and "is there a usable scope" diverge.
- **Symptoms**: guard silently stops matching the actual precondition.
- **Impact**: Low today (see Q3 — no current host can do this), but the
  report's own §(c) already flags this as a live design tension between the
  adapter's count-based check and `wire-runtime.ts`'s root-based check.
- **Current handling**: acceptable — the report explicitly reasons about this
  and picks the count deliberately. Documented, not hidden.
- **Recommendation**: none needed; already handled correctly.

### Failure Mode 4: Test harness change silently vacuous

- **Trigger**: `createMockWorkspaceProvider`'s `__state.setFolders` fires
  listeners in the wrong order relative to the mutation.
- **Symptoms**: the 3-of-4 fail-before-fix tests would pass with the guard
  reverted, making them worthless as regression tests.
- **Impact**: would have been Critical had it been true.
- **Current handling**: verified NOT the case — `setFolders` mutates `folders`
  first, then calls each captured listener (`sdk-agent-adapter.spec.ts:275-282`),
  matching `ElectronWorkspaceProvider.removeFolder`'s and
  `CliWorkspaceProvider.removeFolder`'s splice-then-fire order (both confirmed
  by direct read). The report's own fail-then-pass command transcript is
  consistent with this.
- **Recommendation**: none — this is correct.

## Moderate Issues

### Issue 1: "Registers under the GLOBAL scope" mischaracterizes the mechanism in two required decision-record comments

- **Files**:
  `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts:256-259`
  and
  `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts:280-282`
- **Scenario**: any future reader tracing "why can't `disposeForScope` reach
  this proxy" who takes the comment literally and goes looking inside
  `ProviderProxyPool` for a "global" scope entry.
- **Impact**: documentation-only; does not affect current runtime correctness,
  the guard's placement, or the "no ordering change needed" conclusion — both
  of which I verified independently against source and found correct for a
  reason stronger than the one written down (the proxy is not a
  `ProviderProxyPool` entry under any key, "global" or otherwise; it's an
  entirely separate registry — the injected `OAuthProxyStrategy` singleton).
- **Evidence**: `provider-proxy-pool.ts:10-14` ("Workspaces WITHOUT an explicit
  provider override never reach the pool — they keep riding the process-global
  singleton proxies configured by the strategies"); `disposeForScope` only
  filters `this.entries` by a `${workspacePath}::` prefix
  (`provider-proxy-pool.ts:419-421`); the log's `[CodexProxy] Translation proxy
started` line traces to `OAuthProxyStrategy.configureCodexOAuth`
  (`oauth-proxy.strategy.ts:217-221`), never to `ProviderProxyPool.acquire`.
- **Fix**: tighten both comments to say the `OAuthProxyStrategy` proxy is a
  process-global singleton entirely outside `ProviderProxyPool`'s map — a
  different registry the dispose call was never wired to reach — rather than
  implying it is a `ProviderProxyPool` entry keyed "global." Comment-only
  change; does not require touching the guard or the dispose call.

This does not block approval: the two acceptance criteria it touches ("the
chosen option and the rejected one are recorded in a code comment" and Task
1.2's "say so explicitly... and justify why") are met in substance — the
justification's conclusion is correct and independently verified — but the
mechanism described is not quite the real one, and since this is a decision
task whose entire deliverable is the written reasoning, it is worth a follow-up
correction.

## Requirements Fulfillment

| Requirement                                                         | Status                                   | Concern                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Removing the last folder starts no proxy, triggers no OAuth refresh | COMPLETE                                 | Verified via test 1 and by tracing `reconfigureAuthIfChanged` is never reached                                                                                        |
| Genuine A→B switch still reconfigures                               | COMPLETE                                 | Verified via test 2 (also passes with guard reverted, confirming it's the correct anti-widening companion)                                                            |
| No Electron/`platform-*` import added to `agent-sdk`                | COMPLETE                                 | `git diff` shows zero new import lines in `sdk-agent-adapter.ts`                                                                                                      |
| Chosen + rejected options recorded in a code comment                | COMPLETE (with the wording caveat above) | See Moderate Issue 1                                                                                                                                                  |
| Task 1.2: no proxy created during `removeFolder` survives the call  | COMPLETE                                 | The guard prevents the proxy from ever starting on this path; `disposeForScope` behavior is unchanged and still correct for its own (disjoint) subsystem              |
| Task 1.2: `disposeForScope` still never throws                      | COMPLETE                                 | Diff is comment-only; confirmed via `git diff` (14 insertions, 0 deletions)                                                                                           |
| Task 1.3: fail-before/pass-after test                               | COMPLETE                                 | Report's transcript is consistent with the mock's verified mutate-then-fire ordering; reasoning above independently confirms the mechanism the test exercises is real |

## Edge Case Analysis

| Edge Case                                                 | Handled               | How                                                                                    | Concern                                             |
| --------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Zero folders, global default differs from last configured | YES                   | Guard returns before reconfigure                                                       | None                                                |
| Re-add same folder, same provider                         | YES                   | Frozen `lastConfiguredAuth` still matches → early-return in `reconfigureAuthIfChanged` | None                                                |
| Re-add folder, different provider                         | YES                   | Frozen record differs → reconfigures normally                                          | None                                                |
| Genuine A→B switch (never zero)                           | YES                   | Guard's `=== 0` never trips                                                            | None                                                |
| Removing one of several folders (2→1)                     | Not separately tested | Guard predicate is a single equality check, provably unaffected                        | Not a gap given the predicate's simplicity (see Q5) |
| Rapid remove-then-add before reconfigure settles          | NOT HANDLED           | Unawaited `.catch()` chain, unchanged by this batch                                    | Pre-existing, out of scope for A1                   |

## Integration Risk Assessment

| Integration                                                    | Failure Probability | Impact                                                                                             | Mitigation                                 |
| -------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `SdkAgentAdapter` ↔ `IWorkspaceProvider` (all 3 hosts)         | LOW                 | None currently — contract is consistent                                                            | Verified against all three implementations |
| `SdkAgentAdapter` ↔ `AuthManager`/`OAuthProxyStrategy`         | LOW                 | Unrelated to `ProviderProxyPool`; confirmed disjoint                                               | N/A                                        |
| `workspace:removeFolder` ↔ `ProviderProxyPool.disposeForScope` | LOW                 | Comment slightly mischaracterizes why it can't help here; behavior itself is unchanged and correct | Tighten the comment per Moderate Issue 1   |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: The one Moderate finding is a documentation-accuracy issue in the
required decision-record comments, not a functional defect — the guard,
its placement, its predicate, the "no ordering change" conclusion, and the
regression tests are all independently verified correct against source. Worth
a quick follow-up comment edit, not a blocking revision.

## What Robust Implementation Would Include

This batch already does the hard parts well: it traces the actual defect
mechanism instead of taking the "obvious" `if (!active) return`, documents and
tests both the chosen and rejected options, and the regression tests are
demonstrably non-vacuous (mock ordering verified against the real platform
implementation, not just asserted). Beyond what's in scope for A1, a fully
hardened version would also: (a) give `reconfigureAuthIfChanged` the same
in-flight de-duplication `initialize()` already has, so a rapid
remove/re-add pair can't race two configure calls against each other; (b)
correct the "global scope" wording per Moderate Issue 1 so the decision record
matches the real subsystem boundary for the next person who reads it.

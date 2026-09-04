# Code Logic Review - TASK_2026_315 Batch 4 (B1 + B2 + C3)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 7.5/10   |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 3        |
| Minor Issues        | 2        |
| Failure Modes Found | 5        |

**Method**: every strong claim in `batch-4-report.md` was checked against source,
not accepted on the report's word, per the assignment. Where the report claimed a
mechanism ("X does not depend on Y", "the mutation produces N failures"), I
independently re-derived it — including live-applying the report's own two-mutation
scenario to the actual working tree and reverting it — rather than re-reading the
report's own account of having done so. All claims below marked CONFIRMED were
independently reproduced; none were taken on trust.

## The 5 Paranoid Questions

### 1. How does this fail silently?

Found one real silent-failure path, and it predates this batch: `sendToRenderer`
and `flushStreamQueue` both call `resolveWindow()`, then separately check
`win.webContents.isDestroyed?.() === true` and return with **no log at all** —
neither `warn` nor `debug` (`ipc-bridge.ts:145-147`, `:241-243`). If `main.ts`'s
`mainWindow` variable is ever left pointing at a destroyed-but-not-nulled
`BrowserWindow` (main.ts never sets `mainWindow = null` on close — confirmed by
grep, no such assignment exists anywhere in the app), `resolveWindow` sees a
truthy `win`, sets `hasHadWindow = true`, and hands it back; the caller then
silently drops the send. B2's whole point was to stop unlabelled silent drops,
and it closes the "no window yet" case completely, but the "window is destroyed"
case still drops without a trace. This is unchanged by the diff (confirmed via
`git diff` — those two `isDestroyed` blocks are context lines, not additions), so
it is not a regression this batch introduced, but it is a real gap in the
observability story the batch otherwise improves.

### 2. What user action causes unexpected behavior?

None found that this batch introduces. The one candidate — a user opening a
workspace mid-`bootHeavyServices` and having the promise latch make their
workspace-change event silently ride the STARTUP workspace's boot rather than
their own — is real (see Failure Mode 3) but is an unchanged one-shot-boot
property, not something B1 created; B1 only fixed the "returns before finishing"
half of it.

### 3. What data makes this produce wrong results?

A workspace whose embedder warmup happens to land on a GC boundary can print a
negative delta with a doubled sign: `heap +${deltaMb.toFixed(1)} MB` renders as
`heap +-2.3 MB` when `deltaMb` is negative (`wire-runtime.ts:554`). Cosmetic, but
it is data-dependent and was not caught by the developer's own single-boot
measurement, because that boot happened to warm up during heap growth (+0.1 MB).

### 4. What happens when dependencies fail?

- `bringUpSubsystems` failing (its own try/catch swallows and warns) leaves MCP
  off; the boot-triggered curator queries then run tool-less exactly as before
  B1 — correctly degraded, not a new failure mode.
- `bootHeavyServicesOnce` rejecting is permanently latched (`heavyServicesBoot`
  holds the rejected promise forever) — confirmed by reading the `??=`
  semantics: once assigned, the RHS is never re-evaluated, so every future
  `bootHeavyServices()` call, from the workspace-change listener or anywhere
  else, returns the SAME rejected promise. This is stated in the docblock as
  matching "the previous boolean exactly," and the reasoning is correct: a
  boolean latch set on entry, never cleared, has the identical "never retried"
  property. Confirmed as behaviourally faithful, not just claimed.
- A harness-reconcile failure or an `.mcp.json` write failure are each
  independently non-fatal (own try/catch), so neither can block the other from
  running — the reorder does not introduce a new cross-failure coupling.

### 5. What's missing that the requirements didn't mention?

The batch report itself surfaces this well (see "Carried forward" in its own
document): B1(b)'s real fix belongs in `memory-curator`, and C3's "only logs"
gap needs the worker's own RSS reported back over
`embedder-worker-protocol.ts`. Both are correctly identified as out of this
batch's authorized file set rather than silently left undone. One thing the
report does NOT surface: the C6 risk assessment (item 1 below) was checked
against a workspace with **zero** foreign/missing findings on both sides of the
reorder, so the specific failure mode the reorder was checked against (a
`foreign` finding appearing where it did not before) was never actually
exercised by the verification run.

## Failure Mode Analysis

### Failure Mode 1: MCP-before-harness-reconcile ordering risk was tested where it could not manifest

- **Trigger**: A workspace where the harness reconciler's `foreign`/`missing`
  classification is sensitive to the state of `.mcp.json` at the moment it
  scans.
- **Symptoms**: A `foreign` (or `missing`) count that differs between the old
  order (reconcile before MCP write) and the new order (reconcile after) on
  some machine, but not on the one tested.
- **Impact**: Low-to-moderate — would show up as a spurious "blocked" or
  "foreign" entry in the harness health card on a real user's box, silently,
  the exact class of bug this whole task exists to eliminate.
- **Current handling**: The developer measured `expected:39, found:39,
missing:0, foreign:0, writeFailed:0` identically before and after, on
  `property-hub`. Both counts were **already zero on both runs** — the
  differential case (a workspace that actually has a non-zero
  missing/foreign count) was never exercised, so the test could not have
  detected a regression even if one existed for that class of workspace.
- **Independent check**: `apps/ptah-electron/src/activation/plugin-activation.ts`
  (in scope — not under `harness-sync`) shows `reconcileHarness` /
  `HarnessReconcilerService.reconcile` operating on skills/commands mirrored
  into `{ws}/.claude/{skills,commands}` across host targets; nothing in this
  file's visible surface reads or writes `.mcp.json`. That is circumstantial —
  I could not read `harness-reconciler.service.ts` itself (correctly excluded,
  belongs to the concurrent session) — but it suggests the coupling the
  developer worried about may not exist at all, which would make the
  "measured before/after" exercise reassuring for the wrong reason (nothing
  changed because nothing was coupled, not because the reorder is safe under
  coupling).
- **Recommendation**: Not a blocker for this batch (the ordering change is
  correct and necessary on its own terms — see Failure Mode 2). Batch 7's
  cross-cutting sweep, or a follow-up once `harness-sync` settles, should
  re-run the same before/after comparison on a workspace that already has a
  non-zero `blocked`/`foreign` count (the user's own machine, per `context.md`,
  has exactly such a workspace — 13 blocked paths) to actually exercise the
  differential case.

### Failure Mode 2: Boot-triggered curator queries running without MCP tools — CONFIRMED real and CONFIRMED fixed

- **Trigger**: `bringUpSubsystems` (MCP start) running after
  `bootHeavyServices` (which drives `MemoryTriggerService.runBootScan`, one
  real LLM call per unscanned session via `this.curator.curate(...)` at
  `memory-trigger.service.ts:836`).
- **Symptoms**: `[SdkQueryRunner] MCP disabled (server not running)` warned at
  `sdk-query-runner.service.ts:425` (confirmed present, exact line), the query
  runs with `mcpServers: {}`.
- **Impact**: Medium — the boot-time curator pass silently loses tool access it
  was designed to have, for a query that is otherwise identical to ones later
  in the same boot that do get tools (per `context.md`'s captured log).
- **Current handling — FIXED, verified two ways**:
  1. Read `subsystem-bringup.ts` directly: it resolves only
     `TOKENS.CODE_EXECUTION_MCP`, no other DI token, and its own docblock says
     harness propagation was moved out of it in TASK_2026_278 Batch 2. It has
     no dependency on anything `bootThothRuntime` produces. The claim
     "nothing in bring-up depends on the Thoth boot" is CONFIRMED, not just
     asserted.
  2. `resolveMcpSessionWiring` (`mcp-server-status.interface.ts:45`) reads
     `IMcpServerStatus.getPort()` live at call time, confirmed by reading the
     four-line function body — so once bring-up completes before
     `bootHeavyServices` starts, every subsequent query in that boot
     deterministically sees the port, not probabilistically.
- **Recommendation**: none — this is closed.

### Failure Mode 3: Boolean→promise latch race — CONFIRMED real, CONFIRMED fixed, one residual property unchanged

- **Trigger**: `onDidChangeWorkspaceFolders` firing while the startup
  `await bootHeavyServices(startupWorkspaceRoot)` is still in flight.
- **Symptoms under the OLD boolean** (per the developer's own reasoning,
  independently checked against the `??=` semantics): the second caller
  returns immediately; if IT was the one being awaited by `wireRuntime`, the
  function returns with every `refs.*` still `null`, and `main.ts`'s
  `will-quit` LIFO chain (confirmed by reading `main.ts:217-363` — every ref
  is read from `wired.refs.*` and disposed conditionally on non-null) has
  nothing to dispose while the actual services (spun up by the in-flight boot
  that outlives the early return) keep running.
- **Impact**: High if it fires — an unkillable orphaned SQLite handle, cron
  scheduler, or memory trigger surviving app quit. Low probability window
  (requires a workspace-folder-change event racing the startup boot).
- **Current handling — FIXED**: `heavyServicesBoot ??= bootHeavyServicesOnce(...)`
  hands back the SAME promise to a second caller, so `await
bootHeavyServices(startupWorkspaceRoot)` genuinely waits for whichever call
  won the assignment. Confirmed by direct mutation: I reordered the source so
  the listener registration happened before `bringUpSubsystems`
  and reintroduced a bare `console.warn` in place of the boot-time
  `console.debug`, ran the two new spec files, and got exactly **5 failed, 7
  passed, 12 total** — the same figures the report claims for its own
  simultaneous two-mutation run. Restored the files afterward and confirmed
  12/12 pass again, `git diff` clean against the pre-mutation state, line
  counts back to the reported 572 / 558.
- **Residual property, unchanged and correctly out of scope**: if the
  workspace-change event's `active` root differs from `startupWorkspaceRoot`
  (user switches folders while the startup boot is still running),
  `bootHeavyServices(active)` still returns the STARTUP root's promise — the
  new root's heavy services are never separately booted (only
  `propagateHarness` runs for it). This is identical under the old boolean
  and the new promise; the latch is one-shot by design in both. Not a defect
  introduced here, but worth naming since it's the mirror image of the bug
  this task fixed.

### Failure Mode 4: Single-sample basis for a hard-coded budget constant

- **Trigger**: `WARMUP_HEAP_DELTA_BUDGET_MB = 48` is derived from exactly one
  measured boot (`+0.1 MB`), unlike the retired absolute-heap check, which had
  three data points across workspace sizes.
- **Symptoms**: none observed; this is a methodology gap, not an observed bug.
  A single reading cannot rule out GC-timing variance in the "before" sample
  (e.g., a GC that just ran leaves `heapBeforeMb` artificially low, inflating
  the apparent delta on an otherwise-clean warmup).
- **Impact**: Low — the check "only logs" (self-disclosed and true, confirmed
  by reading `EmbedderWorkerClient`'s public surface as described:
  `embed`/`rerank`/`warmup`/`dispose`, nothing that could act on an over-budget
  reading), so a false-positive warning costs a log line, not correctness.
- **Current handling**: honestly framed as an architectural assertion with a
  stated margin ("far above sampling noise... below any shipped model's
  footprint"), which is a defensible qualitative argument even with N=1,
  because the claim is about a boundary that should hold near-exactly (client
  proxy + one `Float32Array` round trip) rather than a statistically-fit
  threshold.
- **Recommendation**: not blocking. Worth a second data point (large workspace,
  same +0.1-ish delta expected) before this budget is treated as load-bearing
  for anything beyond a log line.

### Failure Mode 5: Cosmetic double-sign on a negative heap delta

- **Trigger**: `deltaMb` is negative (heap shrank across warmup, e.g. a GC ran
  mid-`warmup()`).
- **Symptoms**: `wire-runtime.ts:554` — `` `...main heap +${deltaMb.toFixed(1)} MB...` `` —
  renders as `main heap +-2.3 MB`.
- **Impact**: Cosmetic only; this is the `console.log` success branch, never
  the warn branch (a negative delta can never exceed a positive 48 MB budget).
- **Recommendation**: trivial fix (`deltaMb >= 0 ? '+' : ''`) but not worth
  blocking this batch over.

## Critical Issues

None found.

## Serious Issues

None found.

## Moderate Issues

### Issue 1: C6 risk verification exercised a degenerate case (see Failure Mode 1)

- **File**: `wire-runtime.ts` (B1 reorder), verification log `b4-verify.log`
  (not in scope to re-run — Electron app, harness-sync files unreadable this
  session).
- **Scenario**: A workspace with pre-existing blocked/foreign harness entries
  undergoes the same reorder.
- **Impact**: Unknown — could be zero, given the circumstantial evidence in
  `plugin-activation.ts` that harness reconcile and `.mcp.json` are unrelated
  mechanisms.
- **Fix**: Re-verify on a workspace with non-zero blocked/foreign counts once
  `harness-sync` is available to read/reason about, or in Batch 7's sweep.

### Issue 2: Destroyed-but-not-nulled window drops silently, no log at all (pre-existing, not this batch's regression)

- **File**: `ipc-bridge.ts:145-147`, `:241-243`.
- **Scenario**: `getMainWindow()` (in `main.ts`) returns a `BrowserWindow` whose
  `webContents.isDestroyed()` is true, because `main.ts` never sets
  `mainWindow = null` on any close path (confirmed: no such assignment exists
  in `apps/ptah-electron/src`).
- **Impact**: A push in this state is dropped with **zero** logging — worse
  than the pre-B2 bare warning, which at least always fired on `!win`. B2
  improved one branch (`!win`) and left this one (`win` truthy but destroyed)
  exactly as it was.
- **Fix**: Not this batch's job to fix (unchanged code, out of the four files'
  stated scope), but worth a follow-up ticket: route the `isDestroyed` case
  through `resolveWindow` too, or at least log it at the same debug/warn split.

### Issue 3: Single-sample heap-delta budget (Failure Mode 4)

Already detailed above; tracked here as a Moderate item because it sets a
hard-coded constant from N=1, even though the consequence is log-only.

## Minor Issues

### Issue 1: Double-sign on negative heap delta (Failure Mode 5)

### Issue 2: `mainWindow` is never nulled on window close in `main.ts`

Not part of the four files under review, but it's the root cause enabling
Moderate Issue 2 above. Flagging for whoever eventually closes that gap.

## Data Flow Analysis

```
app.whenReady()
  -> bootstrapElectron()                       [creates DI container]
  -> wireRuntime()
       -> resolve RPC/IpcBridge wiring
       -> [NEW ORDER] await bringUpSubsystems() -> MCP starts, .mcp.json gets `ptah` key
       -> register onDidChangeWorkspaceFolders  <-- listener now AFTER bring-up,
                                                     immediately before startup boot,
                                                     no await between (test-pinned)
       -> await bootHeavyServices(startupRoot)  -> bootThothRuntime -> memory boot scan
                                                     -> curator.curate() PER SESSION,
                                                        now WITH mcpServerRunning:true
       -> refs.* populated                       <-- promise latch guarantees this
                                                      completes before wireRuntime returns
  -> registerPostWindow()                        -> BrowserWindow created
       -> scheduleWarmup() called after did-finish-load (unchanged path)
            -> heapBeforeMb / embedderClient.warmup() / heapAfterMb
            -> delta compared against WARMUP_HEAP_DELTA_BUDGET_MB (48)
  -> will-quit: refs.* disposed LIFO             <-- now guaranteed non-null
                                                      even under a racing
                                                      workspace-change event
```

### Gap points identified

1. A workspace-change event whose root differs from `startupWorkspaceRoot`,
   racing the startup boot, still gets the STARTUP root's heavy-boot promise
   (Failure Mode 3, residual, pre-existing, out of scope for B1).
2. A destroyed-but-referenced `BrowserWindow` silently swallows a push with no
   log at all (Issue 2 above, pre-existing, out of scope for B2).
3. The harness-reconcile/`.mcp.json` ordering interaction was checked on a
   workspace where both counts were already zero on both sides (Issue 1
   above).

## Requirements Fulfillment

| Requirement (from `tasks.md`)                            | Status                                                            | Concern                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1(a) — MCP up before boot-triggered LLM query          | COMPLETE                                                          | Confirmed by reading `subsystem-bringup.ts` + `resolveMcpSessionWiring`, not just the report's log excerpt                                                                                                                |
| 4.1 — one-shot re-entry must not double-fire             | COMPLETE                                                          | Confirmed via `??=` semantics + mutation test                                                                                                                                                                             |
| 4.1(b) — address boot token spend or justify why not     | COMPLETE (justified, not fixed)                                   | Attribution correction (`memory-trigger.service.ts:805/836`, `memory-trigger-config.ts:53`) independently CONFIRMED exact; `skill-trigger.service.ts:802` independently CONFIRMED to spend nothing (comment + code agree) |
| 4.2 — identify the two dropped events                    | COMPLETE                                                          | `SKILL_SYNTHESIS_EVENT` / `HARNESS_HEALTH_CHANGED` confirmed as real message-type constants; consumer cold-pull behavior confirmed at both cited call sites                                                               |
| 4.2 — no `Cannot send to renderer` warning at clean boot | COMPLETE (by construction — debug replaces warn on the boot path) | Not independently re-run against a live Electron boot this session; verified via unit test instead                                                                                                                        |
| 4.2 — queue-vs-suppress reasoning recorded               | COMPLETE                                                          | `resolveWindow` docblock is substantive, not restating code                                                                                                                                                               |
| 4.3 — single named constant, not two literals            | COMPLETE                                                          | Confirmed, `budget: 200 MB` string absent from source                                                                                                                                                                     |
| 4.3 — reasoning for the number written into a comment    | COMPLETE                                                          | Docblock is substantive and honestly states the "only logs" limitation                                                                                                                                                    |

## Edge Case Analysis

| Edge Case                                                      | Handled                            | How                                                  | Concern                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace-change firing during startup boot                    | YES                                | Promise latch makes the second caller wait           | Different-root case still silently rides the startup root (pre-existing)                                                                                                       |
| Rejected heavy-boot promise                                    | YES                                | Latched permanently, never retried                   | Matches old boolean behavior; confirmed by code reading                                                                                                                        |
| Push before any window exists                                  | YES                                | `console.debug`, named type                          | —                                                                                                                                                                              |
| Push after a window existed and is now destroyed-and-nulled    | YES                                | `console.warn`, named type                           | —                                                                                                                                                                              |
| Push when window is destroyed but NOT nulled by the caller     | NO                                 | Silent drop, no log                                  | Pre-existing, not this batch's regression                                                                                                                                      |
| Renderer reload (`SETUP_WIZARD_COMPLETE`) racing a queued push | N/A — nothing is queued            | Drop-not-queue decision avoids the race entirely     | Verified: `reloadWindow()` calls `webContents.reload()` on the SAME `BrowserWindow`, so `hasHadWindow` correctly stays true across a reload — the latch was never at risk here |
| Negative heap delta                                            | Handled functionally (never warns) | Cosmetic double-sign in the log-only success message | Minor                                                                                                                                                                          |

## Integration Risk Assessment

| Integration                                                 | Failure Probability                                                             | Impact                                                                     | Mitigation                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bringUpSubsystems` ↔ `bootHeavyServices` ordering          | LOW (verified self-contained)                                                   | Was MEDIUM before the fix                                                  | Fixed, test-pinned                                                                            |
| Promise latch ↔ `will-quit` LIFO disposal                   | LOW (verified by mutation)                                                      | Was HIGH before the fix (leaked resources)                                 | Fixed, test-pinned                                                                            |
| `.mcp.json` write timing ↔ harness reconcile classification | UNKNOWN (untestable this session; circumstantial evidence suggests no coupling) | Unknown, bounded by "only affects health card display" if it exists at all | Empirical check on a degenerate case only; recommend re-check on a non-zero-foreign workspace |
| `IpcBridge` destroyed-window path                           | LOW-MEDIUM, pre-existing                                                        | Silent drop, no diagnostic                                                 | Unaddressed, out of this batch's scope                                                        |

## Test Verification (independently performed, not taken from the report)

- Ran `npx jest --config apps/ptah-electron/jest.config.ts --testPathPatterns
"wire-runtime.boot-order|ipc-bridge.window-availability"` against the
  as-delivered source: **2 suites, 12 tests, all passed.**
- Applied the report's claimed two-mutation scenario directly to the working
  tree (reordered `bringUpSubsystems` to run after the startup boot; changed
  the boot-time `console.debug` back to `console.warn`), re-ran the same
  command: **2 suites failed, 5 tests failed, 7 passed, 12 total** — the exact
  figures the report claims. This is independent confirmation the tests
  actually latch the behavior rather than passing regardless.
- Reverted both mutations via `Edit`, confirmed `git diff --stat` matches the
  pre-mutation baseline, confirmed line counts (572 / 558, matching the
  report), and re-ran the suite: 12/12 pass again.
- `npx eslint` on all four files under review: zero output (clean).
- `npx nx typecheck ptah-electron`: success.

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: The C6/harness-reconcile ordering interaction (Failure Mode 1 /
Moderate Issue 1) is the one claim in the report I could not independently
close, because doing so requires reading `harness-reconciler.service.ts`,
which is correctly off-limits this session. The developer's own empirical
check is real but was run against a degenerate case (0/0 both sides). This
does not block approval: the reorder is independently justified and verified
correct on its own terms (Failure Mode 2), and the harness-reconcile risk, if
it exists at all, is a display-only health-card concern, not a boot-breaking
one. It should be closed out explicitly in Batch 7's cross-cutting sweep.

## What a Bulletproof Implementation Would Additionally Include

- A log/metric on the `isDestroyed`-but-not-nulled window path in `IpcBridge`,
  matching the debug/warn split B2 just added for the `!win` path, so no push
  can ever vanish with zero trace.
- `mainWindow = null` on the window's own `closed` event in `main.ts`, so
  "the window is gone" is represented the same way whether it went away via
  `getWindow()` returning `null` or via a stale destroyed reference — right
  now there are two different representations of the same fact and only one
  of them is observable.
- A second heap-delta capture (large workspace) before treating
  `WARMUP_HEAP_DELTA_BUDGET_MB` as more than a first approximation.
- The harness-reconcile ordering check re-run against a workspace with a
  known non-zero `blocked`/`foreign` count, once `harness-sync` is free to
  read, to close the one claim this review could not independently verify.

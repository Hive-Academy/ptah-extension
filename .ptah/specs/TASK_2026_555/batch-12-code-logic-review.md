# Code Logic Review — Batch 12 (TASK_2026_555)

**DISCLOSURE:** Same-side review. Author and reviewer are both in-process agents on this
task (antigravity quota exhausted at spawn time), not an independent CLI-lane reviewer.
Treat this review's independence accordingly.

## Summary

| Metric              | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| Overall score        | 8/10                                                          |
| Assessment            | APPROVED                                                     |
| Blocking issues       | 0                                                             |
| Serious issues        | 0                                                             |
| Moderate issues       | 2                                                             |
| Failure modes found   | 2 (both moderate, neither blocks the batch)                  |

Files reviewed in full (diff + surrounding context): `providers-settings.types.ts`,
`providers-settings-sections.ts`, `providers-settings-state.service.ts` (656 lines, whole
file read), `providers-settings-state.service.spec.ts` (new `describe` block read in full),
and the one-line fixture change in `providers-settings.component.spec.ts:60`. Traced
`testCliConnection`'s `reason` field to its backend source in
`libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts` and
`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts` (outside the batch's
file list, but load-bearing for check (3)).

`npx nx test @ptah-extension/core --skip-nx-cache` run in the foreground: 36 suites, 1019
tests, all passing. `ptah_get_diagnostics` scoped to the four changed files: no diagnostics
in the requested files (the 348 workspace errors reported are all in unrelated sibling
specs — `agent-card-truncation.spec.ts`, `tab-bar.component.spec.ts`, `chat-view.component.spec.ts`,
etc. — pre-existing and untouched by this batch).

## Five logic questions

### 1. How does this fail silently?

Not in the reviewed sections — every failure path in this batch either surfaces as a
section `error` (`refreshOrchestration`, `redetectClis`'s `cliDetection`) or is captured
explicitly (`testCliConnection`'s `reason`). One caveat: `redetectClis()`
(`providers-settings-state.service.ts:463-466`) decides whether to cascade into
`refreshOrchestration`/`refreshCliAgents`/`refreshCliModels` by reading the **shared**
`cliDetection()` signal, not the outcome of its own `agent:detectClis` call. Under two
concurrent `redetectClis()` invocations (double-click, or a second workspace-triggered
redetect while one is in flight), a call whose own detection attempt failed can still read
`status === 'ready'` if a differently-ordered concurrent call already wrote a success —
and will then still fire the cascade. This isn't data corruption (the generation guard
inside `readSection` still protects each individual store), but it means the "failed
detection rereads nothing" guarantee in the docstring (`:459-461`) is a property of the
*global signal*, not of the calling invocation — a caller cannot tell from its own
`redetectClis()` `await` alone whether the cascade it triggered corresponds to its own
detection or a concurrent one. See Failure modes below.

### 2. What user action produces unexpected behaviour?

Double-clicking "Redetect CLIs" before the first request resolves: both calls will read
`agent:detectClis`, and both may end up firing `refreshOrchestration` + `refreshCliAgents` +
`refreshCliModels` (up to 6 duplicate host RPC calls) depending on completion order, per the
race in Q1. No data corruption results — each downstream store's own generation guard still
discards genuinely stale writes — but the user sees redundant loading flicker and the host
does redundant work. This is a plausible action (the button has no visible disabled state
enforced by this batch) and not addressed by the plan or tests.

### 3. What input data produces a wrong answer?

None found in the reviewed diff for the five specific checks. `accountLabel`/`tokenStale`
projection (`:308-309`) is correctly gated per-connection-id and per-flag; `customEntry(id)`
projection (`:270-273`) strips every secret-bearing field (`authEnvVar`, `keyPrefix`,
`createdAt` are dropped by the `Pick` in `providers-settings.types.ts:120-123`) and only
keeps the fields listed in the plan.

### 4. What happens when a dependency fails?

- `agent:getConfig` failing during `refreshOrchestration()` now drops to `data: null`
  (`retainOnError=false`), confirmed by the spec at `:1444-1450`. Every other section
  keeps `retainOnError`'s default `true`, so no other section's stale-data-on-error
  behaviour changed — verified by grep: the only other call site of `readSection`/`this.read`
  with a third argument is this one.
- `agent:detectClis` failing during `redetectClis()` leaves `cliDetection` in `error` and,
  per the guard at `:465`, skips the cascade — confirmed by the spec at `:1466-1472` (asserts
  `call.mock.calls` contains only `agent:detectClis`).
- `ptahCli:testConnection` rejecting (RPC-level failure, not a business `success:false`)
  is swallowed by `readSection`'s `catch` (`providers-settings-sections.ts:97-101`, `void
  error`), and only the fixed `SECTION_LOAD_ERROR` string reaches state — confirmed by the
  spec's last case (`:1462-1465`, asserts `'raw transport text'` is absent from
  `JSON.stringify(service.cliTest())`).
- `provider:listCustomEntries` failing inside `refreshConnections()`: the `custom` promise
  (`:277-279`) rejects; both `Promise.all` branches (`customEntriesStore` read and
  `readConnections`) await the same rejected promise, so both `readSection` calls catch and
  retain-on-error (default `true`) — consistent behaviour across the two stores that now
  share one RPC call.

### 5. What is missing that the requirements never mentioned?

- No guard against overlapping `redetectClis()` invocations (Q1/Q2). The plan and batch
  notes don't mention idempotency/in-flight guarding for this action, and neither did the
  pattern it replaces (`AgentOrchestrationConfigComponent.redetectClis`), so this is
  arguably parity, not regression — but it is a gap the requirements never mentioned.
- The backend `error` text this batch trusts to be safe (`testCliConnection`'s `reason`)
  has one un-sanitized fallthrough: `ptah-cli-rpc.handlers.ts:277-289`'s outer catch
  returns raw `error.message` (not passed through `sanitizeErrorMessage`) if an exception
  escapes `PtahCliRegistry.testConnection` itself. In the current implementation that method
  wraps essentially its entire body in one try/catch that already sanitizes
  (`ptah-cli-registry.ts:549-561`), so this fallthrough looks unreachable today — but it's a
  latent gap in the guarantee item (3) of the review brief asks about, and it lives outside
  this batch's own file list so nothing in this batch would catch a future regression there.

## Failure modes

### Concurrent `redetectClis()` cascades on the wrong outcome

- Trigger: two `redetectClis()` calls overlap in flight (double-click, or a second
  workspace/keyboard trigger before the first's `agent:detectClis` resolves).
- Symptom: a call whose own detection failed can still trigger
  `refreshOrchestration`/`refreshCliAgents`/`refreshCliModels`, or a call whose own detection
  succeeded can be short-circuited, depending on completion order of the two RPC calls —
  because the branch at `:465` reads the shared `cliDetection()` signal rather than the
  awaited result of its own request.
- Evidence: `providers-settings-state.service.ts:463-466`.
- Current handling: none; each store's internal generation guard prevents stale *data*
  writes, but the cascade decision itself isn't generation-scoped to the calling invocation.
- Recommendation: capture the call's own outcome (e.g. have `redetectClis` read the result
  of its own `this.require('agent:detectClis', ...)` inside a local try/catch, or compare a
  locally-captured generation number against `store.generation` after the await) rather than
  branching on the shared signal's current status.

### Unsanitized fallthrough in `testConnection`'s outer RPC catch

- Trigger: an exception escapes `PtahCliRegistry.testConnection` itself (not one of its own
  internal, already-sanitized failure returns) — currently only reachable if a future change
  narrows that method's try block.
- Symptom: `ptahCli:testConnection` RPC result would carry `error: error.message` verbatim,
  which `testCliConnection` (`:250-256`) forwards into `cliTest().data.reason` unmodified,
  breaking the "reason cannot carry a key or path" guarantee this batch's tests assume.
- Evidence: `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts:277-289`
  (`error: errorMessage`, no `sanitizeErrorMessage` call), contrasted with
  `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:549-561` (which does
  sanitize).
- Current handling: defense-in-depth gap only; not exercised by any current code path.
- Recommendation: wrap the outer catch's `error` in the same `sanitizeErrorMessage` helper
  for symmetry, or note in the plan that the guarantee depends on `testConnection` never
  throwing past its own try block. Out of this batch's scope to fix (file not in the batch's
  list); flagging for the batch that owns backend RPC handlers, or for a follow-up.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: `redetectClis()` cascade-gating race — see Failure modes above
  (`providers-settings-state.service.ts:463-466`).
- Moderate: unsanitized fallthrough in the backend `testConnection` RPC handler's outer
  catch — see Failure modes above (out of batch scope, `ptah-cli-rpc.handlers.ts:277-289`).
- Minor/pre-existing, not introduced by this batch: `refreshConnections()`
  (`:276-292`) still calls the global, unscoped `setCustomProviderEntries(...)` registry
  mutation as a side effect of the shared `custom` promise, before either store's
  generation/scope guard runs. This was already true before the batch (the old code called
  `setCustomProviderEntries` unconditionally inside the `connectionsStore` read too); the
  refactor to share one RPC call between `customEntriesStore` and `connectionsStore` doesn't
  make it worse, and it doesn't affect what either *section* (which the review brief's item 5
  is about) shows for a given workspace. Noting only because a workspace switch during two
  overlapping `refreshConnections()` calls can still leave the global provider registry
  reflecting whichever host response lands last, independent of request order — a residual
  risk for the model picker / setup wizard that read that same registry, not for this
  batch's own sections.

## Data flow

1. `refreshOrchestration()` calls `agent:getConfig`, projects the widened
   `ProvidersOrchestration` shape, and publishes via `readSection(..., false)` — OK, verified
   fields match `ProvidersOrchestrationField` plus the six new keys
   (`providers-settings.types.ts:94-108`); a failure drops to `null` instead of stale data —
   OK.
2. `redetectClis()` awaits `agent:detectClis`, writes `detectionStore`, then gates the
   cascade on the shared signal — OK for the single-caller case, gap under concurrency (see
   Failure modes).
3. `testCliConnection(id)` calls `ptahCli:testConnection`, keeps `latencyMs` regardless of
   outcome and `reason` only on failure — OK, matches the plan's `{id, success, latencyMs?,
   reason?}` shape; RPC-level failures never reach `reason` at all (caught upstream) — OK.
4. `refreshConnections()` now shares one `provider:listCustomEntries` call between
   `customEntriesStore` (via `customEntry(id)`) and `connectionsStore` (for `custom: boolean`)
   — OK, confirmed one RPC call by the new spec; each store keeps its own
   generation/workspace-scope guard — OK. The underlying global registry write is a residual,
   pre-existing side effect (see Moderate/minor above), not scoped by either guard.
5. `ProvidersConnection.accountLabel`/`tokenStale` are computed per-entry from the single
   `auth:getAuthStatus` call already made in this flow, gated to the correct provider id and
   sign-in state — OK, confirmed by the spec's Copilot/Codex/Anthropic assertions.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| (1) `refreshOrchestration` retainOnError=false, other sections unaffected | COMPLETE | none found |
| (2) `redetectClis` order + short-circuit on detection failure | COMPLETE (single-caller); PARTIAL (concurrent) | cascade gate reads shared signal, not own outcome |
| (3) `testCliConnection` latency/reason, `reason` cannot carry a key/path | COMPLETE (in-batch); PARTIAL (upstream) | backend outer-catch fallthrough is unsanitized (out of batch scope) |
| (4) `accountLabel`/`tokenStale` gating | COMPLETE | none found |
| (5) `customEntry(id)` non-secret, single RPC call, own scope | COMPLETE | none found (global registry side effect is pre-existing, separate concern) |
| (6) facade under 700 counted lines | COMPLETE | 656 lines |
| (7) public members only added | COMPLETE | no removed/renamed public member found |
| (8) new specs test behaviour | COMPLETE | all six new `it`s assert on public signals/return values, not implementation details |

Implicit requirements not addressed: none beyond the two moderate findings above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `agent:getConfig` fails after a prior success | YES | `retainOnError=false` drops to `null`, error shown | none |
| `agent:detectClis` fails | YES | cascade skipped, error shown | none |
| Concurrent `redetectClis()` calls | PARTIAL | per-store generation guard prevents stale data | cascade gating itself races (Failure modes) |
| `ptahCli:testConnection` succeeds with no `latencyMs` | YES | `?? null` | none |
| `ptahCli:testConnection` RPC-level rejection | YES | swallowed by `readSection`'s catch, fixed text only | none |
| Workspace switch mid-`refreshConnections()` | YES (for the two sections) | independent generation/scope checks | global provider registry write is unscoped (pre-existing) |
| Copilot signed out after being signed in | YES | `auth.copilotAuthenticated === true` re-checked each refresh | none |
| Unknown `customEntry(id)` | YES | returns `null` | none |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (same-side review; independent CLI-lane confirmation would raise this)
- Top risk: overlapping `redetectClis()` invocations can trigger a refresh cascade keyed to
  the wrong invocation's outcome (duplicate work, not data corruption).
- What a robust implementation would add: (a) gate `redetectClis()`'s cascade on its own
  captured detection result rather than the shared signal, or disable the trigger while a
  detection is in flight; (b) sanitize the backend RPC handler's outer-catch `error` in
  `ptah-cli-rpc.handlers.ts` for defense-in-depth symmetry with the registry's own sanitized
  path.

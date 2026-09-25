# Code Logic Review — `TASK_2026_538_3ccf` Batch 8

Scope: Tasks 8.1-8.4 (vscode-lm-tools delivery primitive, tokens, push helper). Files reviewed in full:
`dashboard-namespace.builder.ts`, `dashboard-namespace.builder.spec.ts` (whole file, diff for the append),
`di/tokens.ts`, `di/index.ts`, `surface/surface-push.ts`, `surface/surface-push.spec.ts`, `index.ts`. Cross-checked
against `implementation-plan.md` Component 9 (lines 483-512) and Component 10 (lines 557, 568-575), and
`task-description.md` Req 8.6 (section 8, item 6) and Req 11 (section 11, items 1-4).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 3                                    |

## Five logic questions

### 1. How does this fail silently?

It mostly does not — this batch exists specifically to remove the previous silent-failure paths (unhandled
rejections, `void`-discarded delivery). One residual case: `createDashboardBroadcast`
(`dashboard-namespace.builder.ts:130-149`) calls `logger.debug(...)` (`:133-135`) **inside** the same `try` that the
hardening added to catch host-lookup and enumeration errors (`:140-149`). If the injected logger throws on that
call, the function does not fail silently exactly, but it fails under the *wrong label*: a legitimate `no-surface`
success (there was no host — a documented, deliberate success per the doc comment at `:50-53`) is reported to the
caller as `{ status: 'failed', delivered: 0, surfaces: 0, reason: <logger's error message> }`. `proposeSpec`
(`:282-299`) then tells the MCP caller "is valid but was NOT fully delivered to the UI: `<logger error text>`. 0
surface(s) did receive it, so the user may be looking at this dashboard already" — a self-contradicting message for
a push that was never attempted. No test exercises a throwing `logger.debug` (confirmed by grep: every spec passes
`jest.fn()`), so this path is unverified in either direction. See Failure mode 1.

### 2. What user action produces unexpected behaviour?

None found that's attributable to Batch 8 itself. The one candidate — two pushes issued back-to-back without an
intervening `await` — is exactly the case the batch adds a guarantee and a test for (R11), and it holds: see Data
flow and the reproduction under "R11 ordering" below.

### 3. What input data produces a wrong answer?

Nothing that Batch 8 validates (it delivers an already-committed, typed payload; there is no untrusted-input
boundary here — that boundary is `validateDashboardSpec` upstream, unchanged). The one latent gap: `payload` is
passed by reference to every surface's `sendMessage` call (`:160`) with no defensive freeze. If a caller reused and
mutated the same object between commit and send completion, different surfaces could receive different states of
it. Today's caller discipline (the spec's `Object.freeze` fixtures, `surface-push.spec.ts:28-31`) avoids this, but
nothing in the type system enforces it. Not a defect of this batch — it inherits the same shape the v1 code already
had — but worth naming since Batch 9/10 will be the first real caller with actual mutable committed state.

### 4. What happens when a dependency fails?

- `getHost()` throws (host resolution) → caught, `failed` with the error text, `delivered: 0`, `surfaces: 0`.
  Verified by `surface-push.spec.ts:89-102` and reasoned through the code. Correct per Req 8.6.
- `host.getActiveWebviews()` throws → caught, same shape. Verified by
  `dashboard-namespace.builder.spec.ts` (`it.each` at the enumeration-throws case, appended block). The `surfaces:
  0` here is defensible: the field's consistent meaning across every branch is "surfaces attempted," and zero were
  attempted. The `status: 'failed'` (not `'no-surface'`) already signals to the caller that something went wrong,
  and `reason` carries the real text. Acceptable — see Edge cases.
- `host.sendMessage(...)` throws or rejects → each send is wrapped in
  `Promise.resolve().then(() => host.sendMessage(...)).then(ok => ok === true, () => false)`
  (`:159-162`), so a throw and a rejection both resolve to `false` and never escape as an unhandled rejection.
  Verified by the appended `it.each(['throws', 'rejects'])` spec with an explicit `process.on('unhandledRejection')`
  listener, and by running the suite (see Verification).
- `logger.debug(...)` throws → misclassified as `failed` instead of `no-surface`. See question 1 and Failure mode 1.

### 5. What is missing that the requirements never mentioned?

- A test (or a code change) for a throwing `logger.debug` in the no-host path. Cheap to add: move the `logger.debug`
  call outside the `try`, or wrap it in its own `try { } catch { /* logging must never affect the outcome */ }`.
- No spec pins that the delivered payload is never mutated by the delivery primitive itself across a partial-failure
  branch (the `surface-push.spec.ts` case only checks the single-surface success path, `:22-40`). Low priority: the
  code takes no action that could mutate it (no spread producing a new object mid-loop), so this is a documentation
  gap rather than a live bug.
- `VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST` is defined (`di/tokens.ts:6`) but nothing registers or resolves it yet.
  This is explicitly deferred to Batch 10 per the plan (`implementation-plan.md:573-575`) and the batch's own
  scope note ("Registration remains owned by Batch 10... `register.ts` was not edited"), so it is not a gap of this
  batch — flagged only so the next reviewer confirms Batch 10 actually wires it.

## Failure modes

### 1. A throwing logger reclassifies a benign `no-surface` as `failed`

- Trigger: `getHost()` returns `undefined` (no webview host registered — the ordinary, documented success case) AND
  the injected `logger.debug` throws (for example, a disposed VS Code `OutputChannel` during extension shutdown).
- Symptom: the MCP caller of `ptah_dashboard_propose_spec` / a future `ptah_surface_update` receives
  `status: 'delivery-failed'` with a reason string built from the logger's own exception, plus the boilerplate "so
  the user may be looking at this dashboard already — re-send rather than assuming nothing arrived" — misleading,
  since nothing was ever sent.
- Evidence: `dashboard-namespace.builder.ts:130-149` (the `try` wraps the `logger.debug` call at `:133-135`, and the
  `catch` at `:140` has no way to distinguish "logging failed" from "host lookup/enumeration failed").
- Current handling: none — both failures are folded into the same `catch`.
- Recommendation: move `logger.debug` outside the `try`, or give it its own non-throwing guard, so a logging fault
  can never change the reported delivery status.

### 2. Enumeration failure loses the true attempted-surface count

- Trigger: `host.getActiveWebviews()` throws after the host was already resolved.
- Symptom: outcome is `{ status: 'failed', delivered: 0, surfaces: 0, reason: <error text> }` even though surfaces
  may well be attached; the numeric fields cannot distinguish "confirmed zero surfaces" from "unknown count."
- Evidence: `dashboard-namespace.builder.ts:139-148`.
- Current handling: the `reason` string carries the real error text, and `status: 'failed'` (not `'no-surface'`)
  already tells the caller this was not a clean zero-surface case.
- Recommendation: acceptable as shipped (see Edge cases); if a future consumer needs to tell the two zero-counts
  apart, add an `attempted: boolean` or fold the distinction into `reason` machine-parseably. Not required for this
  batch's contract.

### 3. Ordering is a property of same-tick, same-host calls only

- Trigger: two `pushSurfaceChange`/`createDashboardBroadcast` calls issued with an `await` (or any macrotask) between
  them, where the host changes in between.
- Symptom: none within this batch — the R11 guarantee is proven exactly for the case the plan asked for (two calls
  issued synchronously, back-to-back, against a stable host), and that is what any real caller inside one
  synchronous commit path will do. Listed here only so the next batch (9/10, which will call this from
  `SurfaceStateService`) does not assume the guarantee extends across an `await` boundary or a host swap mid-flight.
- Evidence: `dashboard-namespace.builder.spec.ts` appended case "delivers two back-to-back revision pushes... in
  call order" (verified below); `createDashboardBroadcast` itself is stateless per call, so nothing enforces
  ordering beyond the microtask-queue property this batch relies on.
- Current handling: correct for the scope this batch owns.
- Recommendation: none for Batch 8. Note for Batch 10's reviewer.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- MODERATE — `dashboard-namespace.builder.ts:133-136` (logger call inside the hardening `try`): see Failure mode 1.
- MINOR — `dashboard-namespace.builder.ts:143-148`: `surfaces: 0`/`delivered: 0` on enumeration failure conflates
  "confirmed empty" with "unknown"; judged acceptable (see Edge cases and Failure mode 2).
- MINOR — no test pins non-mutation of a shared payload object across partial-failure fan-out; low risk given the
  current implementation never mutates it.

## Data flow

1. Caller (future `SurfaceStateService`, Batch 10) calls `pushSurfaceChange(provider, logger, payload)`
   (`surface-push.ts:17-26`) — OK, payload is an already-committed, typed `SurfaceUpdatedPayload`.
2. `pushSurfaceChange` builds a fresh `createDashboardBroadcast(() => provider.getHost(), logger)` and invokes it
   with `(MESSAGE_TYPES.SURFACE_UPDATED, payload)` — OK, lazy resolution confirmed by
   `surface-push.spec.ts:42-67` (`getHost` called once per push, 3 calls for 3 pushes).
3. Inside the returned closure, `getHost()` is called inside `try` (`dashboard-namespace.builder.ts:131`) — OK, a
   throw here is caught (`surface-push.spec.ts:89-102`).
4. If no host, `logger.debug(...)` then `return { status: 'no-surface' }` (`:132-137`) — GAP: the debug call is
   inside the same `try`; see Failure mode 1.
5. If a host exists, `host.getActiveWebviews()` is called inside the same `try` (`:139`) — OK for a throw (caught,
   Failure mode 2 accepted), correct for the empty case (`:151-153`, `no-surface`).
6. Each surface is mapped to a deferred, individually-guarded send (`:157-163`) — OK: throws and rejections both
   resolve to `false`, verified with no unhandled rejection (see Verification).
7. `delivered` is tallied and compared to `surfaces.length` (`:164-168`) — OK: `delivered` status requires every
   surface to have accepted the payload; Req 8.6's truthfulness invariant holds structurally (a `false`/rejected
   result can never be counted).
8. Otherwise `failed` is returned with `delivered`, `surfaces` and a generic reason (`:170-175`) — OK, matches the
   plan's Component 9 text.
9. `pushSurfaceChange` returns the outcome verbatim — OK, no state touched, no rollback attempted (nothing to roll
   back at this layer).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 8.6 (delivered never reported for a failed/partial send; no unhandled rejection) | COMPLETE | None found; verified by test run |
| Req 11 (delivery works or reports `no-surface` honestly on every host) | COMPLETE for VS Code (own typecheck); Electron/CLI structural fit confirmed by this review (`tsc` proof below); the Req 11.4 type-level spec itself is correctly deferred to Batch 14 | None for this batch's scope |
| R4 (push helper calls the widened, hardened broadcast) | COMPLETE | None |
| R7 (barrel exports `createDashboardBroadcast`/`DashboardSurfaceHost` etc. for later adapter specs) | COMPLETE | None |
| R11 (two back-to-back pushes reach the host in call order) | COMPLETE | Guarantee is scoped to same-tick/same-host calls only (documented above, not a gap) |
| v1 behaviour and text unchanged | COMPLETE | Diff is append-only for the spec; production diff only widens types and adds a `try/catch` + deferral around the send, no v1-observable text change |
| Lib-local tokens via `Symbol.for`, no vscode-core `TOKENS` edit | COMPLETE | None |
| Barrel ≤150 lines, exact 5 exports | COMPLETE (93 lines; exactly `createDashboardBroadcast`, `DashboardSurfaceHost` type, `DashboardPushType` type, `VSCODE_LM_TOOLS_TOKENS`, `SurfacePushHostProvider` type) | None |

Implicit requirements not addressed: a logging fault must never change a delivery verdict (see Failure mode 1).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Send throws synchronously | YES | `Promise.resolve().then(() => host.sendMessage(...))` converts a sync throw into a rejected promise, caught by the next `.then`'s rejection handler | None |
| Send returns a rejected promise | YES | Same mechanism | None |
| Partial delivery (some surfaces ok, some not) | YES | `delivered < surfaces.length` → `failed` with counts; every surface is still attempted (test asserts `attempted` order across throw/reject/ok/refused) | None |
| Enumeration throws | YES | Outer `try/catch` → `failed`, `surfaces: 0` | Ambiguous zero vs. unknown count — accepted, see Failure mode 2 |
| No host registered | YES | `no-surface` | Vulnerable to a throwing logger — Failure mode 1 |
| Host exists, zero attached surfaces | YES | `no-surface` | None |
| Two back-to-back pushes, same host | YES | Microtask FIFO ordering; proven by test and reasoning (see below) | None within scope |
| `DashboardSurfaceHost.sendMessage` structurally satisfied by real hosts | YES | Confirmed for VS Code `WebviewManager` (project typecheck passes, it's imported at `ptah-api-builder.service.ts:846`); confirmed for Electron/CLI adapters by an out-of-repo `tsc --noEmit --strict` reproduction (see Verification) | None |
| Logger throws on the no-host path | NO | — | Failure mode 1 |

## R11 ordering — reproduction and reasoning

The appended spec (`dashboard-namespace.builder.spec.ts`, "delivers two back-to-back revision pushes...") calls
`broadcast(SURFACE_UPDATED, rev2)` then `broadcast(SURFACE_UPDATED, rev3)` synchronously (no `await` between them),
asserts `sendMessage` has not been called yet, then awaits both and asserts call order
`[sidebar/rev2, panel/rev2, sidebar/rev3, panel/rev3]`.

Traced against the implementation: each `broadcast(...)` call runs synchronously up to its `await Promise.all(...)`
(host resolution and `getActiveWebviews()` are synchronous), during which it schedules one `Promise.resolve().then(cb)`
microtask per surface, in surface-array order, via already-resolved promises. Because both `broadcast` calls happen
in the same synchronous stack frame before any microtask checkpoint, the first call's two `cb`s are enqueued before
the second call's two `cb`s — the microtask queue is strict FIFO, so `sendMessage` fires in exactly
`[sidebar/rev2, panel/rev2, sidebar/rev3, panel/rev3]` order. This is a structural property of the implementation
(one microtask hop per surface, scheduled synchronously in `Array.prototype.map` order), not an accident of timing,
and it holds for any number of back-to-back calls against a stable host — confirmed by running the suite (see
Verification).

## Verification

- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/surface
  libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts`:
  2 suites, 40/40 tests pass, including the unhandled-rejection guards and the ordering case.
- Structural-fit proof for Q1 (VS Code `WebviewManager`, Electron adapter, CLI adapter against the now-generic
  `DashboardSurfaceHost.sendMessage<T>`): built a throwaway file outside the repo
  (`/tmp/ts-check/check.ts`, not added to the repository) modeling the three real signatures —
  `WebviewManager.sendMessage<T extends StrictMessageType>(viewType: string, type: T, payload: any)` (note
  `StrictMessageType` itself ends in `| string`, i.e. is exactly `string` for assignability purposes — even wider
  than modeled), and the two non-generic `sendMessage(_viewType: string, type: string, payload: unknown):
  Promise<boolean>` adapters (Electron `webview-manager-adapter.ts:47-51`, CLI
  `cli-webview-manager-adapter.ts:25-32`) — against the target `DashboardSurfaceHost` interface. Ran the repo's own
  compiler, `D:\projects\ptah-extension\node_modules\.bin\tsc --noEmit --strict` (TypeScript 6.0.3, matching the
  workspace), against that file: exit 0, no errors. All three real hosts structurally satisfy the widened
  `DashboardSurfaceHost` for both `T` positions. Combined with the fact that `vscode-lm-tools` itself already
  typechecks with `createDashboardBroadcast` invoked against the real `WebviewManager`
  (`ptah-api-builder.service.ts:846`), Req 11.4's underlying claim holds for all three hosts; the type-level spec
  assertion itself is correctly left to Batch 14 per the plan.
- Confirmed via `git diff` that the v1 spec file's change is strictly additive (0 removed lines) and that
  `index.ts` / `di/index.ts` diffs are exactly the exports the task describes, nothing extra.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a throwing logger inside the no-host branch of `createDashboardBroadcast`
  (`dashboard-namespace.builder.ts:130-149`) turns a documented success (`no-surface`) into a misleading `failed`
  outcome with a self-contradicting message downstream in `proposeSpec`. Narrow (requires the logger itself to
  fault) and fails toward visibility rather than data loss, so it does not block, but it is a real, reproducible,
  untested gap introduced by this batch's own hardening.
- What a robust implementation would add: move `logger.debug` outside the `try` (or give it a no-throw guard) so
  logging can never change a delivery verdict; a spec for that case; and, if a future consumer needs it, a way to
  distinguish "confirmed zero surfaces" from "surface count unknown due to enumeration failure" in the outcome
  shape rather than only in the free-text `reason`.

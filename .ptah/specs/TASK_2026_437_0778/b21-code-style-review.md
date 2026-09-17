# Code Style Review — `TASK_2026_437_0778` Batch 21 (Phase 4, C18)

## Summary

| Metric          | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Overall score   | 7/10                                                              |
| Assessment      | APPROVED                                                          |
| Blocking issues | 0                                                                 |
| Serious issues  | 2                                                                 |
| Minor issues    | 2                                                                 |
| Files reviewed  | 2 (`message-router.service.ts`, `message-router.service.spec.ts`) |

Scope: `libs/frontend/core/src/lib/services/message-router.service.ts` and its spec, uncommitted
diff against `HEAD` (912261b6e), Batch 21 / Task 21.1 only. `libs/frontend/core/CLAUDE.md` and
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:64-81` read for
comparison, per instructions. No `nx`/test runs performed; `npx eslint` and `npx prettier --check`
run on both files.

## Five style questions

### 1. What breaks in six months?

The `MessageChannel`-based macrotask-yield technique now exists twice, independently commented,
with no shared name (`message-router.service.ts:74,92-93,120-127,136-145` vs.
`session-loader.service.ts:73-82`'s `yieldToMacrotask()`). The insight behind it — `setTimeout` is
clamped/throttled in a hidden Electron window and `requestAnimationFrame` never fires for one — is
recorded in two separate doc comments. A future engineer who improves one (e.g. discovers a better
fallback, or a Node-hidden-timer edge case) has no signal that a sibling copy needs the same fix.
`libs/frontend/chat` already imports `@ptah-extension/core` (`session-loader.service.ts:20`), so
the dependency direction to host a shared primitive in `core` already exists.

### 2. What would a new team member misread?

The RPC synchronous-flush branch (`message-router.service.ts:83-86`) reads like a special case
that only helps `rpc:response`, but its real job is a _global_ ordering guarantee: any push queued
ahead of an `rpc:response` in the same task is flushed with it, in order, before `rpc-call.util.ts`'s
own bubble-phase listener resolves that response (R-P8). A reader who only skims the `if` branch,
without the top-of-file doc block (lines 27-32) or the six order-of-arrival spec cases (lines
486-540), could "simplify" it into an `if (isRpcResponse) drain()` without noticing the capture-phase
dependency that makes the guarantee hold.

### 3. What does this cost to maintain?

A stateful queue/drain/schedule mechanism (five private fields: `queue`, `draining`,
`drainScheduled`, `destroyed`, `drainChannel`) is now inline in a service whose stated job (per
`libs/frontend/core/CLAUDE.md:32`) is "single `window.addEventListener`, builds
`Map<messageType, MessageHandler[]>`". That's a second concern grafted onto the dispatch map
builder. It stays under the file-size ceiling (252 lines) and every method is short, so this is a
real but modest cost — a named collaborator (e.g. `MacrotaskDrainScheduler`) would isolate it and
make it independently testable/reusable, but the facade rule doesn't strictly require the split at
this size.

### 4. Where is this inconsistent with the rest of the repository?

`libs/frontend/core/CLAUDE.md`'s "Key Files" entries for comparably subtle cross-cutting services
(`plugin-catalog.service.ts:38`, `workspace-scope.service.ts:39`, `boot-status.service.ts:40`,
`back-office-activity.service.ts:41`) each carry a multi-sentence paragraph naming the invariant and
the failure it prevents. `message-router.service.ts`'s entry (line 32) is one generic sentence and
was not updated for this batch — despite the burst-coalescing contract (one zone entry per burst,
`rpc:response` synchronous flush, `MessageChannel`-absent fallback) being exactly the kind of
subtle, easy-to-regress behavior this file customarily documents for its siblings.

### 5. What would you have done differently, and why is that better rather than merely other?

Extract the macrotask-yield primitive (a `schedule(cb): void` wrapper over `MessageChannel`, with
the "no `MessageChannel`" fallback baked in) into `libs/frontend/core`, and have both
`MessageRouterService` and `SessionLoaderService.yieldToMacrotask` call it. That is better than
"merely other" because it turns one hard-won insight (already independently rediscovered and
commented twice) into one tested unit instead of two, and it removes the drift risk named in
Question 1 without changing either file's externally observed behavior.

## Blocking issues

None.

## Serious issues

### `MessageChannel` macrotask-yield technique duplicated without a shared abstraction

- File: `libs/frontend/core/src/lib/services/message-router.service.ts:74,92-93,120-127,136-145`
  vs. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:64-82`
- Problem: both files independently construct a `MessageChannel`, wire `port1.onmessage`, and call
  `port2.postMessage(null)` to force a macrotask, each with its own doc comment explaining why
  `setTimeout`/`rAF` don't work in a hidden Electron window. The router's version is a persistent,
  reusable channel (`drainChannel`, closed in `teardown()`); the loader's is a fresh one-shot
  channel per call. The core technique — not just the shape — is the same, and it's now recorded
  in two places that can silently diverge.
- Tradeoff: leaving it duplicated costs nothing today, but the fallback rationale
  ("Every shipping host... has one; without it..." at `message-router.service.ts:70-73`) is
  load-bearing knowledge that a maintainer fixing one copy has no way to know needs fixing in the
  other.
- Recommendation: extract a small `scheduleMacrotask(cb: () => void): void` (or equivalent)
  utility into `libs/frontend/core`, since `chat` already depends on `core`
  (`session-loader.service.ts:20`). Not required to land this batch, but worth a follow-up item
  given this is the second occurrence, not premature abstraction from one.

### `libs/frontend/core/CLAUDE.md` does not document the burst-coalescing contract

- File: `libs/frontend/core/CLAUDE.md:32`
- Problem: the one-line description of `MessageRouterService` predates this batch and says nothing
  about the coalescing contract this PR adds: one zone entry per burst, the `rpc:response`
  synchronous-flush ordering guarantee (R-P8), or the `MessageChannel`-absent fallback. Every other
  service in the same "Key Files" list with a comparably subtle invariant
  (`workspace-scope.service.ts`, `boot-status.service.ts`, `back-office-activity.service.ts`) gets a
  multi-sentence description of exactly this kind of thing.
- Tradeoff: the invariant is fully documented in the source file's own top-of-file comment
  (`message-router.service.ts:13-32`), so nothing is silently lost today — but `CLAUDE.md` is the
  document a future editor reads _before_ opening the file, and it is the one place this repo's own
  convention says a subtle cross-cutting contract like R-P8 belongs.
- Recommendation: add 2-3 sentences to the `message-router.service.ts` bullet naming the
  coalescing contract and the ordering guarantee, mirroring the density of its siblings.

## Minor issues

- `libs/frontend/core/src/lib/services/message-router.service.ts:56,128-132,210-214`: `LISTENER_OPTIONS`
  (the capture-phase constant) has no comment at either use site; the rationale lives only in the
  20-line top-of-file block. A one-line pointer comment at the constant declaration
  (`// capture phase: see R-P8 above`) would save a reader the round trip.
- `libs/frontend/core/src/lib/services/message-router.service.ts:234`: pre-existing
  `@typescript-eslint/no-empty-function` warning on `return () => {};` (the `APP_INITIALIZER`
  no-op factory). Confirmed via `git diff HEAD` that this line predates the batch (only
  reformatted by Prettier, not introduced) — noted for completeness, not attributable to this
  change.

## File-by-file

### message-router.service.ts

Score 7/10 — 0 blocking, 1 serious (documentation gap; duplication finding shared with the spec),
1 minor. The queue/drain/schedule mechanism is correctly zone-agnostic (`ngZone.run` /
`runOutsideAngular` both no-op under the zoneless provider, verified by the spec's zoneless case at
`message-router.service.spec.ts:561-576`), correctly bounds a single drain to what was queued when
it started (`:151-172`), and correctly routes a throwing handler through the shell's registered
`ErrorHandler` (`:179-185`, confirmed live at `apps/ptah-extension-webview/src/app/app.config.ts:86,118`,
which the Electron renderer bundle shares via its `implicitDependencies` on
`ptah-extension-webview`). `eslint`/`prettier` are clean except the pre-existing warning above.

### message-router.service.spec.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor (test-file share of the duplication finding above; no
independent finding). The new ~300-line `describe` block (`:278-577`) is proportionate to this
repo's spec sizing — sibling specs in the same feature area run into the thousands of lines
(`session-loader.service.spec.ts` is 2,786 lines) — so it is not oversized by local convention. The
`boot()` helper's zone-entry-counting comment (`:299-304`) correctly distinguishes a genuine zone
_entry_ from the nested `run()` the real zone's CD scheduler performs internally, which is exactly
the distinction a reader needs to trust the "exactly one zone entry" assertions. The
`ControlledMessageChannel` test double (`:237-276`) is a reasonable, self-contained way to drive the
real scheduling code deterministically rather than mocking the service's internals.

## Pattern compliance

| Repository rule or nearby convention                                                     | Status                        | Evidence                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inject()` exclusively (root `CLAUDE.md`, `core/CLAUDE.md:62`)                           | PASS                          | `message-router.service.ts:60-62,95`                                                                                                                                             |
| `catch (error: unknown)` narrowing (root `CLAUDE.md`)                                    | PASS                          | `message-router.service.ts:182` (routed to `ErrorHandler`, not narrowed further — appropriate, it's forwarded not inspected)                                                     |
| Signal-first state, no `BehaviorSubject` (`core/CLAUDE.md:47-51`)                        | N/A                           | no reactive state introduced; queue/flags are plain fields, matching `session-loader.service.ts`'s `replayClaims`/`loadSessionsInFlight` precedent for "nothing renders from it" |
| Inline `inject(DestroyRef).onDestroy(...)` without a stored field, when unused afterward | PASS                          | `message-router.service.ts:95`; matches `task-command-palette.component.ts:322`, `markdown-file-links.ts:74`, `send-to-messaging.component.ts:202`                               |
| `NgZone` always injectable, zoneless-safe (`core/CLAUDE.md`, this batch's own claim)     | PASS                          | verified by `message-router.service.spec.ts:561-576` (zoneless case)                                                                                                             |
| File size soft ceiling 700 lines (root `CLAUDE.md`)                                      | PASS                          | 252 lines                                                                                                                                                                        |
| `CLAUDE.md` documents subtle cross-cutting invariants for services in this file          | FAIL                          | `core/CLAUDE.md:32` unchanged; see Serious issue above                                                                                                                           |
| ESLint / Prettier clean                                                                  | PASS (1 pre-existing warning) | `npx eslint` / `npx prettier --check` output above                                                                                                                               |

## Maintenance debt

- Introduced: a queue/drain/schedule state machine (5 fields, 6 private methods) inside a service
  whose stated job was purely dispatch-map construction; a second, uncommented instance of the
  `MessageChannel`-yield technique already present in `session-loader.service.ts`.
- Retired: the previous per-message, inline `window.addEventListener` closure with no burst
  handling — removed along with its risk of one zone entry (and one CD pass) per inbound message.
- Net: positive for runtime behavior (this is the whole point of C18/INV-11) and slightly negative
  for this file's single-responsibility shape; the duplication with `session-loader.service.ts` is
  a shared-code debt across two files, not specific to this one.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the coalescing contract this batch adds is real and correctly implemented, but it
  is currently discoverable only by reading the source file's own doc comment — `core/CLAUDE.md`
  doesn't carry it, and the `MessageChannel`-yield technique it depends on already has an unlinked
  twin in `session-loader.service.ts`.
- What a 10/10 version would do differently: extract the macrotask-yield primitive into a shared,
  named utility used by both call sites; add the coalescing contract (one zone entry per burst,
  `rpc:response` synchronous flush, `MessageChannel`-fallback) to `core/CLAUDE.md`'s
  `message-router.service.ts` entry at the same density as its documented siblings.

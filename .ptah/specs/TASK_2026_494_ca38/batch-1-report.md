# Batch 1 report — TASK_2026_494

Batch: **1 — SurfaceUpdateInbox (eager)** (`batches.md:121-154`)
Task: **1.1 — Generic routing-id inbox and its eager registration**
Status: COMPLETE. Verification command green (6/6 targets).

## What was done, per task

### Task 1.1 — `SurfaceUpdateInbox` + eager registration

Implemented plan D3 (`implementation-plan.md:174-214`) and Component 3
(`implementation-plan.md:359-385`) exactly as specified, following the
`WorkflowSessionClaimService` pattern (`workflow-session-claim.service.ts:4-29`)
and the `thoth-message-routing.spec.ts` precedent.

**Service** (`surface-update-inbox.service.ts`):

- `@Injectable({ providedIn: 'root' }) SurfaceUpdateInbox implements MessageHandler`
  with `readonly handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED] as const`.
- Public surface exactly per D3: `claim(routingId, listener)` (throws
  `Error` synchronously on an already-claimed id), `release(routingId)`
  (no-op when unclaimed), `isClaimed(routingId)`.
- Claim store is a plain `Map<string, SurfaceUpdateListener>` — no signal
  (nothing renders from it), no timers.
- `handleMessage` applies the three drop rules in order: payload not a
  non-null object → drop; `routingId` missing / not a string / empty → drop;
  routing id unclaimed → drop. A claimed id calls exactly its listener with
  the raw payload object, unchanged.
- The listener type is `SurfaceUpdateListener = (payload: unknown) => void` —
  the inbox validates only the routing key, so the payload stays `unknown`
  (typing it as `SurfaceUpdatedPayload` would claim a check nobody made;
  each lazy consumer runs its own structural guard).
- File header documents why the inbox lives in `chat-routing` (the
  539-driven generic shape from `handoff-494.md` (a) item 1), why it is
  zod-free, why unclaimed pushes are not buffered, and the error behaviour
  (listener throw propagates to `MessageRouterService.dispatchGuarded`;
  duplicate claim throws as a programming error).

**Unit spec** (`surface-update-inbox.service.spec.ts`): 13 tests pinning every
batch acceptance rule — `handledMessageTypes` is exactly
`[MESSAGE_TYPES.SURFACE_UPDATED]`; claim/release/isClaimed semantics; release
of an unclaimed id is a no-op; duplicate claim throws with the routing id in
the message; re-claim after release works; a claimed id calls exactly its
listener with the **same object** (`toBe` identity) and no other listener; a
non-`SurfaceUpdatedPayload` payload is delivered unmodified (proves the inbox
validates nothing but the key); drop rules each call no listener — non-object
payload (`undefined`/`null`/string/number/array), missing `routingId`,
non-string `routingId`, empty-string `routingId`, unclaimed id, released id.

**Barrel** (`chat-routing/src/index.ts`): exports `SurfaceUpdateInbox` and
`type SurfaceUpdateListener`; doc-comment outbound-deps line corrected (R12,
below).

**Registration** (`app.config.ts`): added
`{ provide: MESSAGE_HANDLERS, useExisting: SurfaceUpdateInbox, multi: true }`
directly beside the `ChatMessageHandler` registration (former `:170`), with a
comment recording why it is eager; imported `SurfaceUpdateInbox` from the
`@ptah-extension/chat-routing` barrel. `useExisting` resolves the root
instance, so the service a lazy consumer claims on IS the service the router
dispatches to.

**App-level spec** (`surface-message-routing.spec.ts`): three layers —

1. **Delivery** (precedent `thoth-message-routing.spec.ts`): real
   `MessageRouterService` + real `SurfaceUpdateInbox` through the same
   `useExisting` registration, genuine `window` `MessageEvent`s with the
   literal `'surface:updated'` wire string. Asserts claimed id → exactly its
   listener with the same payload object; unclaimed id → dropped; released id
   → dropped; payload without a string `routingId` → dropped. Also pins
   `MESSAGE_TYPES.SURFACE_UPDATED === 'surface:updated'` and
   `MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED === 'dashboard:spec-proposed'` as
   literal-string tripwires. (Synchronous assertions are valid because jsdom
   has no `MessageChannel`, so `scheduleMacrotask` drains synchronously —
   `macrotask-scheduler.ts:14-19,42-45`; noted in the file header.)
2. **Wiring pin** (discipline of `webview-routing.spec.ts`'s "app.config
   routing wiring"): reads `app.config.ts` source and asserts the
   `MESSAGE_HANDLERS` / `useExisting: SurfaceUpdateInbox` / `multi: true`
   registration and the barrel import, so the spec's reproduced registration
   cannot drift from the real composition root.
3. **Uniqueness / absence sweep** (discipline of
   `no-alpha-base-content.spec.ts`, comments stripped): since
   `MessageRouterService` dispatches exclusively by `handledMessageTypes`
   (`message-router.service.ts:238-244`), sweeping those declarations sweeps
   the reachable handler set. Over `libs/frontend/**` +
   `apps/ptah-extension-webview/src/**` (non-spec `.ts`): the ONLY file
   declaring `surface:updated` in `handledMessageTypes` is
   `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts`, and NO
   file declares `dashboard:spec-proposed` (Req 3.2/3.3 for the coding chat).
   Includes a >400-file floor so the sweep cannot pass vacuously, and a
   self-test that the matcher detects a real declaration while ignoring one
   hidden in a comment.

## Files created / modified (absolute paths)

- CREATE `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\chat-routing\src\lib\surface-update-inbox.service.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\chat-routing\src\lib\surface-update-inbox.service.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\chat-routing\src\index.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\apps\ptah-extension-webview\src\app\app.config.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\apps\ptah-extension-webview\src\app\surface-message-routing.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-1-report.md` (this file)

`batches.md` was NOT edited (per instructions).

## Risk handling

- **R8 (HIGH — zod or a new lib leaks into the initial bundle):** the inbox
  imports exactly three modules, per the batch quality requirement:
  `@angular/core` (`Injectable`), `@ptah-extension/core` via
  `import type { MessageHandler }` (type-only — erased at compile time, zero
  runtime dependency and zero bundle bytes), and `@ptah-extension/shared`
  (`MESSAGE_TYPES`). No zod, no `@ptah-extension/shared/mcp-apps-contracts*`
  import anywhere in the batch. The unit spec additionally pins that the
  listener receives the raw payload unmodified, documenting that validation
  stays in lazy code. The eager addition is the single ~90-line service —
  inside Component 3's "eager size under 1.5 kB" bar; the B19 lazy-load gate
  compares against `9afac1aa2` as planned.
- **R12 (LOW — `chat-routing/src/index.ts` doc comment understates outbound
  deps):** corrected in the same edit that adds the export. The old comment
  named only `@ptah-extension/chat-state` and `@ptah-extension/shared`; the
  corrected comment names all actual outbound deps —
  `@ptah-extension/chat-state` (data-access), `@ptah-extension/chat-streaming`
  (`stream-router.service.ts:40-51`) and `@ptah-extension/chat-types`
  (`streaming-surface-registry.service.ts:21`), `@ptah-extension/core` (the
  `MessageHandler` contract, noted as type-only) and
  `@ptah-extension/shared` (util) — and keeps the "no inbound deps from
  chat-state/chat-streaming" invariant sentence.

Boundary notes: `chat-routing` (`type:feature`) → `core` (`type:core`) is
permitted by the lattice (`eslint.config.mjs:364-381`, confirmed in the plan
validation spot-checks); nothing under `libs/frontend/core/src` imports
`chat-routing`, so no cycle. Lint passed, confirming the boundary holds.

## Verification

Command (batch-specified, scoped, never workspace-wide):

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-routing ptah-extension-webview
```

Result: **all 6 targets succeeded** (exit code 0, cache 0/6 — all tasks ran
fresh): `chat-routing:lint`, `chat-routing:typecheck`, `chat-routing:test`,
`ptah-extension-webview:lint`, `ptah-extension-webview:typecheck`,
`ptah-extension-webview:test`. The only stderr output was an unrelated
Nx Cloud 401 organization notice.

Targeted confirmation that both new spec files execute and pass:

- `npx nx test @ptah-extension/chat-routing --testPathPattern="surface-update-inbox"` →
  `PASS libs/frontend/chat-routing/src/lib/surface-update-inbox.service.spec.ts`
  (plus the lib's existing specs, all PASS).
- `npx nx test ptah-extension-webview --testPathPattern="surface-message-routing"` →
  `PASS apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts`
  (plus the app's other `*-routing` specs, all PASS — existing routing specs
  unaffected).

All Batch 1 spec pins hold: every drop rule calls no listener; a claimed id
calls exactly its listener with the same object; release drops; a duplicate
claim throws; at app level the inbox is the ONLY `surface:updated` handler and
NO handler exists for `dashboard:spec-proposed`.

## Not done / caveats

- Nothing. The batch is one task and it is complete. (B19 remains the bundle
  gate that proves R8 at build level; that is out of Batch 1 scope by design.)

# Context — TASK_2026_338

## Where this came from

The independent review of TASK_2026_332 on 2026-08-28. That task's implementer
worried that making `stop()` await the new operation queue could add up to two
seconds to application quit. The reviewer went to check what awaits `disposeAsync`
and found the answer: **nothing does.**

Full record: `.ptah/specs/TASK_2026_332/`.

That finding is more interesting than the worry that produced it. It also means
TASK_2026_332's Item B risk is currently inert, which is why that task shipped
without addressing it.

## Defect 1 — the service is never shut down

`CodeExecutionMCP.stop()`, `dispose()` and `disposeAsync()` are invoked only from
inside the class itself and from
`http-mcp-server.service.spec.ts` / `http-mcp-server.service.concurrency.spec.ts`.

Checked and found silent:

| Host     | Shutdown path                                                                             | Mentions CodeExecutionMCP                                            |
| -------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Electron | `apps/ptah-electron/src/activation/shutdown.ts:103-144` (`disposeBootRefs`)               | no                                                                   |
| VS Code  | `apps/ptah-extension-vscode/src/main.ts:117-189` (`deactivate`)                           | no                                                                   |
| VS Code  | `apps/ptah-extension-vscode/src/core/ptah-extension.ts:189-198` (`PtahExtension.dispose`) | no — iterates a `disposables` array the service is never pushed into |

Consequences, in rough order of how much they matter:

1. The `ptah` entry in `.mcp.json` survives shutdown, advertising a port nothing
   is listening on. Any tool that reads that file between shutdown and the next
   launch sees a dead server.
2. The HTTP listener is never closed deliberately. It goes away when the process
   does, which is fine for a clean exit and not fine for anything that expects an
   orderly teardown.
3. `unregisterFromMcpJson` — a code path with tests and a lock — never runs in
   production at all.

## Defect 2 — start/stop race on unlocked shared fields

`start()` assigns `this.server` and `this.port` directly after
`await startHttpServer(...)` resolves, outside the operation queue and outside
any lock.

Sequence: `stop()` is invoked while `start()` is still awaiting `startHttpServer`.
`stop()` reads `this.server === null`, so it no-ops the HTTP teardown, then runs
its trailing `this.server = null; this.port = null;`. `start()` then resolves and
overwrites both with a live server. The process now holds a running listener the
service believes is stopped.

This predates TASK_2026_332. That task's change — `stop()` now awaiting the
operation queue — widens the window before `stop()` reaches `stopHttpServer`, but
did not create the race.

## Why these are one task, not two

Both are dormant _because_ of defect 1. Nothing calls `stop()`, so nothing can
race it, and nothing observes the missing teardown.

Wire `dispose` into the hosts without fixing the race and you make the race live
on the same day. Fix them together.

There is a third dormant item in the same family, already fixed in TASK_2026_332
but worth knowing about when this work starts: `ensureRegisteredNow` gained a
`this.stopped` check so a registration queued behind `stop()`'s unregister cannot
write an entry for a server being torn down. That guard only earns its keep once
`stop()` is actually called.

## The work

1. Push `CodeExecutionMCP` into both hosts' shutdown paths. Match each host's
   existing convention rather than inventing one — VS Code has a `disposables`
   array, Electron has `disposeBootRefs`.
2. Make `start()` and `stop()` mutually exclusive over `this.server` / `this.port`.
   The service already has an operation queue from TASK_2026_332; the obvious move
   is to route both through it rather than add a second mechanism.
3. Decide the shutdown budget deliberately. `stop()` awaits the queue, and a
   queued `.mcp.json` mutation can wait up to the 2 s `withMcpConfigLock`
   deadline. On a quit path that is a real cost. Either accept it and say so, or
   give shutdown a shorter bound and accept that the `.mcp.json` entry may
   occasionally be left behind — but do not leave it unstated, because the next
   person to see a two-second quit will "fix" it by removing the await.

## Verification

- A test per host asserting `dispose` reaches `CodeExecutionMCP`. The existing
  host shutdown specs are the place — note `apps/ptah-electron` is off limits
  while TASK_2026_331 is in flight, so check that first.
- A test for the start/stop overlap: invoke `stop()` while `start()` is awaiting a
  deferred `startHttpServer`, and assert no live listener survives and the fields
  agree with reality.
- The `stopped`-check behaviour from TASK_2026_332 becomes reachable here; add a
  test that a registration queued behind a real `stop()` does not write.

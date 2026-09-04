# Context

## The defect this protects against

TASK_2026_306 defect E: the task-specs index warmed at activation against
`InMemoryTaskIndexStore` and never upgraded to SQLite once the database opened.
The `.ptah/specs/README.md` write landed, the Tasks board rendered, and the
index was simply stale — a soft failure with no error anywhere.

The fix was lib-side, which was the right call: subscribe to the connection's
`onDidOpen` and re-warm, covering every host at once rather than giving three
hosts three bespoke remedies. `start-index.ts:28` records that reasoning.

## The unenforced precondition

`libs/backend/task-specs/src/lib/di/start-index.ts`:

```ts
if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
  return;                                    // :153 — silent
}
…
return connection.onDidOpen(() => warm());   // :164
```

If the token is not registered **at the moment `startTaskSpecsIndex` runs**, the
function returns having subscribed to nothing. No warning. No retry. No record
that the upgrade path was skipped.

So the fix works only because of a call ordering that lives in three separate
host files and is written down in none of them as a requirement.

## The three hosts, all correct today

| Host      | Call site                                                               |
| --------- | ----------------------------------------------------------------------- |
| Electron  | `apps/ptah-electron/src/di/phase-2-libraries.ts:332`                    |
| VS Code   | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:95`             |
| CLI / TUI | `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:130` |

All three register the SQLite connection first. Nothing makes them.

## Why this is worth a task

The regression is silent in both directions:

- Reordering phase 2 produces no error, no warning, and no failing test.
- The resulting symptom is a _stale_ Tasks board, not a broken one — which
  survives manual QA and reaches users.

A fourth host is the obvious trigger. The project's architecture explicitly
anticipates one: _"Add a new runtime by adding a fourth adapter family."_ That
host's author has no way to discover this requirement short of reading
`start-index.ts:153`.

## The fix, in increasing order of strength

**1 — Break the silence (minimum).** Log at WARN when the token is absent at
subscribe time, naming the consequence: the index will not upgrade to SQLite.
The silence is the whole problem; a log line makes a misordered host diagnosable
in one boot.

**2 — Defer the subscription.** Arm when the token appears rather than giving up
if it has not yet. This removes the ordering requirement instead of documenting
it, which is the better shape — but check the container API supports it without
a polling loop.

**3 — Assert it.** A check in the shared registration path that fails loudly at
boot. Strongest, but a throw on the activation path needs care: TASK_2026_306
existed because the activation chain was too eager to block.

Prefer 2 if the container allows it, otherwise 1. A silent no-op is not
acceptable in any of the three.

## Also update the comment

`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:90-94` currently says:

> The ordering fix is entirely lib-side (startTaskSpecsIndex subscribes to the
> connection's onDidOpen), so this call site needs no change and none of the
> three hosts got a bespoke remedy.

That is true and it is also the sentence that hides the requirement. Once the
fix lands, it should state the ordering rule explicitly — or, if option 2 is
taken, state that the ordering no longer matters.

## Scope

- One of the three fixes above.
- A spec proving the misordered case is handled: register the connection
  **after** `startTaskSpecsIndex` and assert the index still upgrades (option 2)
  or that a WARN is emitted (option 1). Today that case passes silently, which
  is what makes it untested.
- The comment update in the VS Code host.

## Outcome (2026-08-26) — option 2, the deferred arm

**Option 1 (WARN) was rejected, and the reason is worth recording.** An absent
`SQLITE_CONNECTION` is ALSO the normal VS Code shape — that host runs on
`InMemoryTaskIndexStore` and registers no connection at all. A bare WARN would
therefore fire on every boot of a correctly-configured host, which is how a real
signal gets trained away. The warning could not tell a misordered host from a
correct one, because at that instant the two are indistinguishable.

**Option 2 turned out to be available.** tsyringe's `afterResolution(token, cb,
{ frequency: 'Once' })` stores an interceptor in a map keyed by the token
**whether or not that token is registered yet** — verified in
`node_modules/tsyringe/dist/cjs/dependency-container.js:250`, which does a bare
`interceptors.postResolution.set(token, …)` with no registry lookup, and fires
it from `executePostResolutionInterceptor` on the next `resolve`. So
`subscribeToPersistenceOpen` now ARMS on the late path instead of returning:

| Token registered when the helper runs? | Behaviour                                                       |
| -------------------------------------- | --------------------------------------------------------------- |
| yes                                    | resolve + `onDidOpen`, exactly as before                        |
| no                                     | arm `afterResolution`; subscribe the first time anyone resolves |

**Why arming on RESOLUTION is sufficient.** Whoever calls `openAndMigrate` must
resolve the connection first, and the interceptor runs before `resolve` returns
to that caller — so the subscription is always in place before the connection
can emit its first open. A host that registers a connection and never resolves
it gets nothing, but that host has no database either.

The ordering requirement is now **removed rather than documented**. A fourth
host, or a re-ordered phase 2, cannot revert defect E.

Disposal latches a flag the interceptor callback checks, because tsyringe
exposes no way to remove an interceptor.

### Verified

Five new cases in `start-index.spec.ts` under `registration order does not
matter (TASK_2026_314)`, all running the hosts in the WRONG order on purpose:
late registration still upgrades, a subscriber is live before the first open can
fire, a REOPEN still re-warms, a disposed helper never subscribes, and VS Code
stays silent. Three of the five go red when the deferred arm is removed
(measured). `lint`, `typecheck`, `test` green for `@ptah-extension/task-specs`
(16 suites, 445 passed).

The comment at `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:90` is
updated to say the ordering no longer matters, rather than to restate a rule
nothing enforces.

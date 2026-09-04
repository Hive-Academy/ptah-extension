# Batch A — the Electron quit reaps before it flushes

Defect 1 and LOW finding 1. Files: `apps/ptah-electron/src/activation/shutdown.ts`,
`src/main.ts`, `src/main.metadata-flush.spec.ts`, `src/main.quit-path.spec.ts`,
`CLAUDE.md`.

## The task's prescription was wrong on two points

**1. The 1000 ms backoff is not the mechanism.** `context.md` says the reference
is staged "inside a `retryWithBackoff` whose first delay is 1000 ms" and that the
process exits before that delay elapses. `retryWithBackoff`
(`libs/shared/src/lib/utils/retry.utils.ts:27-29`) calls `asyncFn()` immediately
on attempt 0 and only sleeps AFTER a failure. On the happy path there is no
1000 ms wait at all.

The defect is real for a plainer reason. `persistBulkThenReference` awaits
`saveAgentOutput` and then `addCliSession`, and the call site never awaits the
retry wrapper, so the staging completes some microtasks after `disposeAll()`
triggers the exit. A flush that already ran cannot carry it.

**2. "Invert the ordering assertion" would have made things worse.** The spec's
header carried a real argument the task did not answer: `will-quit` cannot
block, so a flush moved below the disposals gets no window and the
TASK_2026_324 guarantee is lost outright.

Both halves are right. The resolution is not to choose between them — it is that
Electron CAN buy a window, by deferring, which is exactly how the
messaging-gateway drain already works. So there are now TWO flushes.

## The change

| Piece                                                                              | Why                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requiresDeferredDisposal` also names `agentProcessManager`                        | Its `disposeAll()` now has a downstream dependent. The old comment called the reaper "deliberately fire-and-forget, whose settle nothing downstream depends on" — true until a flush was placed after it. |
| `disposeAfterPersistence` awaits the reap, bounded by `AGENT_REAP_BUDGET_MS` (2 s) | Gives the staging its microtasks. Also puts the agents before `cliRegistry`, which is LOW finding 1 — the proxy exists to serve a live agent.                                                             |
| `disposeBootRefs` ends with an awaited `flushSessionMetadataStores()`              | The one that carries what the teardown produced.                                                                                                                                                          |
| The early flush is unchanged                                                       | It still drains what was staged when the quit arrived, and it is all the undeferred path gets.                                                                                                            |
| `withBudget` extracted                                                             | The gateway stop and the agent reap are the same race. `stopMessagingGateway` is now a four-line caller.                                                                                                  |

`SQLite close` ordering is not a hazard here: `SessionMetadataStore` writes
through `IStateStorage`, not the SQLite connection.

## One regression I introduced, and the spec that caught it

The first version put the null check inside `reapAgents`. `await f()` suspends
even when `f` returns immediately, so `cliRegistry` and `diagnostics` moved into
a microtask — and on the undeferred path, which Electron does not wait for, a
microtask is never. `main.quit-path.spec.ts`'s "stays fully synchronous when
there is nothing to await" failed with exactly those two entries missing.

The guard now sits at the `await` site. Recorded in `CLAUDE.md` as a rule,
because the next person to add a bounded await will hit it.

## Verification

| Gate                             | Result                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `nx run ptah-electron:test`      | 409 passed, 4 skipped, 32 of 33 suites (1 suite skipped) — green |
| `nx run ptah-electron:typecheck` | clean                                                            |
| `nx run ptah-electron:lint`      | 0 errors, 6 warnings (all pre-existing)                          |

Tests added to `main.metadata-flush.spec.ts`:

- `defers the quit when there are agents to reap`
- `flushes AFTER the agents staged their references`
- `reaps the agents before their translation proxies (LOW finding 1)`
- `gives up on a wedged reap and still runs the final flush`

Tests updated, both because this change alters what they assert:

- `main.quit-path.spec.ts` — `names BOTH the gateway and the agent reaper as
reasons to defer` (was gateway-only), and the parity case now nulls the agent
  manager too.
- `main.metadata-flush.spec.ts` — the header's "do not move the flush below the
  disposals" reasoning, which was half right and is now stated in full.

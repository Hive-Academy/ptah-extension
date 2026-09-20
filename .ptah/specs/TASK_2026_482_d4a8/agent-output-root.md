## ITEM 1 — WHAT I VERIFIED

Angular 21.2.6 signals do propagate when written outside `NgZone`, but that does
not eliminate Angular rendering work in this Zone-based host. The installed
Angular `ChangeDetectionSchedulerImpl` schedules `ApplicationRef._tick()` for a
dirty signal consumer even when the notification originates outside the Angular
zone; in Zone mode it also promotes the dirty flags to a global traversal.

I therefore did not rely on an out-of-zone signal write. `StreamingQuotesComponent`
now schedules its timer outside `NgZone` and writes each hard-coded quote fragment
to its owned span with `textContent`. The regression spec advances the timer
without calling `detectChanges`, confirms the callback is outside Angular,
confirms the rendered text changes, and observes zero `ApplicationRef.afterTick`
events. Per character, the remaining work is one substring plus one escaped text
node update; Angular change detection does not run.

## ITEMS 2-4

- The delete-to-type transition clears the 30 ms interval, nulls its handle, and
  re-arms typing at 50 ms. A regression spec observes the 50 → 30 → 50 sequence.
- The type-to-pause transition now clears and nulls the interval immediately;
  the pause handle is also nulled when it fires, and destroy nulls both handles.
- Repository-wide searches reconfirmed that `StreamingTextRevealComponent` had
  no consumer beyond its own spec and the two barrels. The component, spec, both
  exports, and its stale chat-ui documentation entry were removed.
- Repository-wide searches reconfirmed that `BackgroundAgentStore.tick` had no
  consumer outside its own specs. The signal, interval, lifecycle teardown, and
  synchronization calls were removed. `AgentMonitorStore.tick` remains intact;
  it is consumed by `agent-card.component.ts`.

## CHANGED AND DELETED FILES

Modified:

- `libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.ts`
- `libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.spec.ts`
- `libs/frontend/chat-ui/src/index.ts`
- `libs/frontend/chat-ui/CLAUDE.md`
- `libs/frontend/chat/src/lib/components/index.ts`
- `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.rekey.spec.ts`
- `libs/frontend/chat-streaming/src/lib/background-agent.store.ts`
- `libs/frontend/chat-streaming/src/lib/background-agent.store.spec.ts`
- `.ptah/specs/TASK_2026_482_d4a8/task.md` (status line only)

Deleted:

- `libs/frontend/chat-ui/src/lib/atoms/streaming-text-reveal.component.ts`
- `libs/frontend/chat-ui/src/lib/atoms/streaming-text-reveal.component.spec.ts`

Created:

- `.ptah/specs/TASK_2026_482_d4a8/agent-output-root.md`

## TEST RESULT

Command:

`npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/chat-streaming`

Header: `NX Running target test for 3 projects:`

- `@ptah-extension/chat-streaming`: 24 suites passed; 503 tests passed, 1 skipped.
- `@ptah-extension/chat-ui`: 25 suites passed; 183 tests passed.
- `@ptah-extension/chat`: 82 suites passed; 1,310 tests passed, 2 skipped.
- Total: 131 suites passed; 1,996 tests passed, 3 skipped; 0 failed.

Additional verification:

`npx nx run-many -t typecheck lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/chat-streaming`

All six targets passed. Lint reported 25 pre-existing warnings in unrelated
files and zero errors.

## RESIDUAL RISK

The out-of-scope stranded `streamingState` lifecycle is unchanged, so stranded
bubbles can still keep quote timers mounted. Those timers now perform only a
small local DOM text update and no Angular application tick, but they still wake
at the intended 20/33 Hz while mounted. Eliminating those wakeups requires the
separate TASK_2026_382 B5 lifecycle fix.

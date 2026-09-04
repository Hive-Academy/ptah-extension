---
id: TASK_2026_334
status: done
type: BUGFIX
title: >-
  The Electron quit flushes session metadata before it reaps the agents, and the
  new stream batch buffer has no back-pressure
description: >-
  Two defects left open by TASK_2026_323 Phase 2, both behaviour changes the
  perf work introduced rather than defects it set out to fix. First,
  `apps/ptah-electron/src/activation/shutdown.ts:162` starts the
  session-metadata flush BEFORE `disposeBootRefs` reaps the agents at `:134`, so
  references produced by those exits are never flushed: `disposeAll()` ends a
  running ptah-cli agent, `agent-events.ts:438` stages its reference through
  `retryWithBackoff` with a 1000 ms first delay, and the process exits first. On
  relaunch the session shows no CLI agent and continuation is impossible. The VS
  Code host does the opposite order (`main.ts:150-167`) and commit `14f89ce99`
  states "reap the agents first", but the Electron spec
  `main.metadata-flush.spec.ts:91` pins the losing order, so the test protects
  the bug. Second, `stream-batch-buffer.ts:75,134-151` drains with no
  back-pressure — `inFlight` grows by one promise per 16 ms while the sink is
  slow and nothing caps it. Before `b401e65eb` the producer awaited each send, so
  the SDK stream was throttled by the transport; a chatty agent now runs ahead of
  the transport without a bound, which is an unbounded queue introduced by a task
  about unbounded work. Also carries four LOW findings in the same shutdown and
  agent-manager area.
relates_to:
  - TASK_2026_323
labels:
  - electron
  - rpc-handlers
  - cli-agent-runtime
  - shutdown
  - back-pressure
executor: backend-developer
estimate: M
---

# Electron quit order and the unbounded stream batch drain

Machine-owned metadata carrier. Prose lives in `./context.md`.

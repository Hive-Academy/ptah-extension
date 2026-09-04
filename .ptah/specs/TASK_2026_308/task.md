---
id: TASK_2026_308
status: done
type: BUGFIX
title: >-
  Three latent defects in agent-sdk session import and adapter lifecycle, each
  correct only by accident today
description: >-
  Three separate findings in `libs/backend/agent-sdk`, grouped because they sit
  in one lib and each is a small, well-understood fix. (1) In
  `session-importer.service.ts`, a whitespace-only file shorter than the 8 KB
  `METADATA_PREFIX_BYTES` prefix read reaches the filename fallback and produces
  exactly the phantom `Session <date>` entry the sidecar guard exists to
  prevent; the read sites at `:200` and `:512` already capture `bytesRead` and
  `:80` already consults it for the newline check, so the fix is to gate the
  fallback on `bytesRead >= METADATA_PREFIX_BYTES` rather than on content alone.
  (2) In `sdk-agent-adapter.ts:286`, `initialize` clears `this.initInFlight` in
  a `finally` and the guard at `:287` is correct only because promise reactions
  happen to run FIFO; an identity check (`if (this.initInFlight === p)`) before
  the clear removes the dependence on scheduling order entirely. (3) At `:497`,
  `reset` deliberately waits out an in-flight pass so that a reset can never be
  ANSWERED by the guard — the comment at `:499` states this as the contract —
  but two concurrent `reset()` calls both await the same settled promise, both
  call `dispose()` at `:505`, and the second's `initialize()` at `:506` is then
  answered by the guard holding the first reset's fresh pass, which is the exact
  outcome the contract forbids. None of the three is currently reachable in
  normal operation; all three are one-line-class fixes whose absence makes
  correctness depend on timing. Found during the TASK_2026_306 review as F3-1,
  F3-2 and F3-3 and deferred as out of scope.
---

# Three latent agent-sdk defects: F3-1, F3-2, F3-3

Machine-owned metadata carrier. Prose lives in `./context.md`.

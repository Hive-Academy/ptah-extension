---
id: TASK_2026_320
status: in_review
type: BUGFIX
title: >-
  Jest leaks a worker in rpc-handlers, which makes any concurrent multi-project
  test run unreliable
description: >-
  Running `rpc-handlers` tests concurrently with another Jest project produces a
  batch of "Test suite failed to run" entries; two clean sequential re-runs then
  pass all 87 suites, and `rpc-allowlist.spec` passes in isolation. The output
  carries Jest's `A worker process has failed to exit gracefully and has been
  force exited. This is likely caused by tests leaking due to improper
  teardown.` — and critically that warning is present on the PASSING runs too,
  so the leak exists either way and parallel load only makes it fatal. This is
  not cosmetic: it makes concurrent verification untrustworthy, which matters
  because that is exactly what a batched workflow relies on. It was hit
  repeatedly during TASK_2026_315 and forced sequential re-runs to distinguish a
  real failure from contention noise. Start with `--detectOpenHandles` on
  `rpc-handlers` to find the un-torn-down resource; the usual suspects in this
  repo are un-`unref`'d timers and SQLite handles left open by test doubles.
  While in the area, note the second half of the same class: a `typecheck` run
  over `web-pricing` / `web-account` also failed under concurrent load during
  TASK_2026_315 and passed cleanly in isolation. Recorded as F3 in that task's
  follow-ups.
---

# Jest worker leak in rpc-handlers breaks concurrent verification

Machine-owned metadata carrier. Prose lives in `./context.md`.

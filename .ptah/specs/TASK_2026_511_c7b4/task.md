---
status: done
type: feature
title: Memory retention health verdict and surfaced warning
description: >-
  Add a computed retention health verdict to MemoryStorageHealthDto so that a
  retention job which has never completed is reported as a fault instead of a
  null field. Persist an attempt counter, log one warning when the threshold is
  passed, and render the verdict as a banner in the existing storage health
  panel.
---

# TASK_2026_511 — Memory retention health verdict

Retention livelocked on a real install for months. `memory_retention_state`
held `last_completed_at: null` the whole time. The value was readable, and
nothing read it. The livelock itself is fixed by `bd2987777`. This task adds
the detection that would have found it.

Prose and evidence: `context.md`.

---
id: TASK_2026_272
status: backlog
type: feature
title: >-
  Rework "Send to messaging" into a predictable session hand-off flow
description: >-
  The canvas-tile "Send to messaging" affordance sends nothing: it calls
  gateway:attachSession, hands the live session to a binding and flips the tab
  read-only, with no confirm, no consequence text, no success feedback, no
  running-adapter check, a hardcoded 'default' conversation key, an unmounted
  (not disabled) button before the first turn, and no component spec. Rename it
  to a hand-off, show why it is unavailable, filter to running adapters,
  confirm inline, report success and error inline, pin or surface the
  conversation key, and add the spec.
---

# Send-to-messaging hand-off rework

Machine-owned metadata carrier. Prose lives in `./context.md`.

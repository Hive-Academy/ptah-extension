---
status: done
type: bugfix
title: Streaming quote typewriter drives full change detection at 20-33 Hz per bubble
description: >-
  StreamingQuotesComponent runs a zone-patched interval with no terminating
  branch. Each tick writes a signal, and because the renderer is Zone-based
  every write schedules a full ApplicationRef.tick across all open tiles.
updated: '2026-10-10T18:18:03.415Z'
---

Seven stranded streaming bubbles put the renderer at 94 percent of one core.
Fix the amplification, the period bug, and the dangling handle. Delete the two
dead timer sources found alongside it.

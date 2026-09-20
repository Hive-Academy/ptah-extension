---
status: backlog
type: refactoring
title: Move synchronous SQLite reads off the Electron main thread
description: >-
  better-sqlite3 runs on the calling thread, which in Electron owns every window.
  Memory and vector searches measured 300 to 1,672 ms per statement and produced
  54 event-loop lag warnings plus one 7,877 ms watchdog hang in a single day.
---

Design first. This is the "move it to a subprocess" question, and it must not
add another unreaped child-process family (see TASK_2026_479).

---
id: TASK_2026_331
status: done
type: REFACTORING
title: >-
  Move Electron boot-time work off the main process and open the window first
priority: critical
description: >-
  Cold start of the Electron app leaves the main process blocked for 60 to 90
  seconds before the window exists and busy for several minutes after. Every
  heavy boot item (SQLite quick_check on a 951 MB database, session import,
  transcript boot scans, SKILL.md migration, harness reconcile, file-index
  build, COUNT(*) probes) runs on the main event loop and is awaited before
  createMainWindow. Redesign the boot so the window opens first and heavy
  work runs in utilityProcess or worker_threads, with no feature removed.
executor: software-architect
estimate: L
labels:
  - performance
  - electron
  - boot
  - architecture
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

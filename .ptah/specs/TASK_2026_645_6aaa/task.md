---
id: TASK_2026_645_6aaa
status: backlog
type: RESEARCH
title: "Record M-final renderer and main-process memory on the canvas Rail board"
depends_on: []
created: "2026-10-12T23:49:43.200Z"
updated: "2026-10-30T03:38:08.921Z"
description: "PRs #715 and #730 are on main and no measurement was recorded. Record renderer traces and Electron main-process private bytes and handle count against the M0 baseline, checking a detached Rail pane instead of the removed Grid tile tree."
executor: orchestrator
estimate: S
labels:
  - performance
  - chat
  - canvas
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

After 628 (PR #715) and 629 merge, record the M-final renderer traces against the M0 baseline, write measurements.md with pass/fail, and record whether the Electron main process still grows (634 to 1,424 MB on 2026-10-11).

Full context, plan and discussion live in [./context.md](./context.md).

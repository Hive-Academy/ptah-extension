---
id: TASK_2026_603_b573
status: backlog
type: BUGFIX
title: Stop a failed settings write from landing later with the next save
depends_on: []
created: "2026-10-03T12:10:04.051Z"
updated: "2026-10-03T12:10:04.051Z"
description: "After a double failure on one key, PtahFileSettingsManager keeps the unpersisted value in memory and the next successful set() of any key writes it to disk; also quiet the benign ENOENT temp-sweep warning."
executor: backend-developer
estimate: S
labels:
  - settings
  - persistence
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

After a double failure on one key, PtahFileSettingsManager keeps the unpersisted value in memory and the next successful set() of any key writes it to disk; also quiet the benign ENOENT temp-sweep warning.

Full context, plan and discussion live in [./context.md](./context.md).

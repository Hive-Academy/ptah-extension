---
id: TASK_2026_660_c1ac
status: cancelled
type: REFACTORING
title: Remove the skill-synthesis pipeline after 14 quiet days
depends_on: []
created: '2026-10-14T01:25:24.363Z'
updated: '2026-10-14T01:38:43.327Z'
description: >-
  Skill synthesis was switched off on 2026-10-14 (skillSynthesis.enabled=false).
  After 14 days with no synthesis spend and only skipped drains, delete the
  components marked remove-proposed in TASK_2026_659_cec4/parity-inventory.md,
  with DB migrations for the skill tables; keep telemetry, harness sync and
  Library clones.
estimate: XL
labels:
  - skills
  - skill-synthesis
relates_to:
  - TASK_2026_659_cec4
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Skill synthesis was switched off on 2026-10-14 (skillSynthesis.enabled=false). After 14 days with no synthesis spend and only skipped drains, delete the components marked remove-proposed in TASK_2026_659_cec4/parity-inventory.md, with DB migrations for the skill tables; keep telemetry, harness sync and Library clones.

Full context, plan and discussion live in [./context.md](./context.md).

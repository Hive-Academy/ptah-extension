---
id: TASK_2026_662_3eea
status: backlog
type: REFACTORING
title: "Purge skill synthesis: delete the pipeline and archive its data"
depends_on:
  - TASK_2026_646_136a
created: "2026-10-14T01:38:43.122Z"
updated: "2026-10-14T01:38:43.122Z"
description: "After TASK_2026_646_136a moves the kept parts (invocation telemetry, session verdicts, Library editing, skill-load counting) to their new home, delete the skill-synthesis pipeline, its UI tabs, RPCs, settings and specs per TASK_2026_659_cec4/parity-inventory.md; export the skill tables to an archive, then drop them (data drop needs separate user approval)."
estimate: XL
labels:
  - skills
  - skill-synthesis
duplicates:
  - TASK_2026_660_c1ac
relates_to:
  - TASK_2026_659_cec4
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

After TASK_2026_646_136a moves the kept parts (invocation telemetry, session verdicts, Library editing, skill-load counting) to their new home, delete the skill-synthesis pipeline, its UI tabs, RPCs, settings and specs per TASK_2026_659_cec4/parity-inventory.md; export the skill tables to an archive, then drop them (data drop needs separate user approval).

Full context, plan and discussion live in [./context.md](./context.md).

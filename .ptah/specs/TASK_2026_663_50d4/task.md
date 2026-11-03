---
id: TASK_2026_663_50d4
status: backlog
type: BUGFIX
title: "Lane data quality: deliverable vs role-file conflicts, OpenCode MCP (--standalone), real adapter errors"
depends_on: []
created: "2026-10-14T01:38:43.225Z"
updated: "2026-10-14T01:38:43.225Z"
description: "Carried from TASK_2026_535 §D and §E: declared deliverables must win over a role's default file name (or reject at spawn); OpenCode lanes get no ptah_* tools because the adapter omits --standalone; adapters hide quota errors as \"Unknown error\". Plus: grok lane had no ptah_web_search (TASK_2026_646 decision #8)."
estimate: M
labels:
  - lanes
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Carried from TASK_2026_535 §D and §E: declared deliverables must win over a role's default file name (or reject at spawn); OpenCode lanes get no ptah_* tools because the adapter omits --standalone; adapters hide quota errors as "Unknown error". Plus: grok lane had no ptah_web_search (TASK_2026_646 decision #8).

Full context, plan and discussion live in [./context.md](./context.md).

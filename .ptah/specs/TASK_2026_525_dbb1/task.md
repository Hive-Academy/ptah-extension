---
id: TASK_2026_525_dbb1
status: done
type: BUGFIX
title: Fix empty opencode model list on background-service cold start
depends_on: []
created: '2026-09-22T08:41:22.684Z'
updated: '2026-09-23T14:41:51.399Z'
description: >-
  opencode models returns exit 0 with empty stdout when the opencode 2.x
  background service is down, so the settings model picker stays at Default;
  Re-detect cannot recover it.
executor: backend-developer
estimate: S
labels:
  - opencode
  - cli-agents
  - settings
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

opencode models returns exit 0 with empty stdout when the opencode 2.x background service is down, so the settings model picker stays at Default; Re-detect cannot recover it.

Full context, plan and discussion live in [./context.md](./context.md).

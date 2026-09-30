---
id: TASK_2026_579_f2e2
status: backlog
type: BUGFIX
title: 'Fall back to another curator provider when the configured one is rate-limited or unreachable'
depends_on: []
created: '2026-09-30T13:53:38.000Z'
updated: '2026-09-30T13:53:38.000Z'
description: 'The curator resolves one provider. When openai-codex was rate-limited on 2026-09-30, a manual Run now stalled for 202 s and every pass left 23.7K observations unprocessed. Add an ordered fallback list so curation continues on another provider'
labels:
  - memory-curator
relates_to:
  - TASK_2026_439_1310
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The curator resolves one provider. When openai-codex was rate-limited on 2026-09-30, a manual Run now stalled for 202 s and every pass left 23.7K observations unprocessed. Add an ordered fallback list so curation continues on another provider

Full context, plan and discussion live in [./context.md](./context.md).

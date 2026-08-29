---
id: TASK_2026_352
status: in_review
type: REFACTORING
title: >-
  Reduce boot-time internal LLM query cost: 170KB prompts, limit-1
  serialization, boot-scan spend
depends_on:
  - TASK_2026_341
created: '2026-08-28T18:55:38.507Z'
updated: '2026-08-28T18:58:24.897Z'
description: >-
  Skill-synthesis and memory-curator boot scans ran ten haiku queries; one
  prompt was 170655 chars (log.log:1017); two drains took 122s and 156s
  (log.log:1095,1453); ~$0.19 spent (log.log:1009,1371,1415,1444).
  InternalQueryService limit:1 serialises curator and synthesis so each waits on
  the other (log.log:938,955,1011,1070,1104). Cap prompt size (chunk or truncate
  transcripts), defer boot-scan LLM stages until the app is idle, and consider a
  per-lane concurrency slot. Depends on the query-launch blocking fix so extra
  concurrency does not multiply main-thread lag.
executor: backend-developer
estimate: M
labels:
  - performance
  - skill-synthesis
  - memory-curator
  - cost
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Skill-synthesis and memory-curator boot scans ran ten haiku queries; one prompt was 170655 chars (log.log:1017); two drains took 122s and 156s (log.log:1095,1453); ~$0.19 spent (log.log:1009,1371,1415,1444). InternalQueryService limit:1 serialises curator and synthesis so each waits on the other (log.log:938,955,1011,1070,1104). Cap prompt size (chunk or truncate transcripts), defer boot-scan LLM stages until the app is idle, and consider a per-lane concurrency slot. Depends on the query-launch blocking fix so extra concurrency does not multiply main-thread lag.

Full context, plan and discussion live in [./context.md](./context.md).

---
id: TASK_2026_367
status: in_review
type: BUGFIX
title: >-
  Fix the seven defect clusters surfaced by tmp/logs/log.log
depends_on: []
created: '2026-09-02T00:00:00.000Z'
updated: '2026-09-02T00:00:00.000Z'
description: >-
  A read of tmp/logs/log.log (2357 lines, 79 WARN, 15 ERROR) surfaced seven
  defect clusters across cli-agent-runtime, agent-sdk, rpc-handlers,
  memory-curator, harness-sync and the marketplace UI. This task fixes each
  with a proper root-cause change, not a log-level tweak. No CLI agents
  (codex, antigravity, ollama, claude cli) are used for the implementation.
estimate: L
labels:
  - bugfix
  - logs
  - cli-agent-runtime
  - agent-sdk
  - memory-curator
  - harness-sync
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Fix the seven defect clusters surfaced by `tmp/logs/log.log`.

Full context, plan and discussion live in [./context.md](./context.md).

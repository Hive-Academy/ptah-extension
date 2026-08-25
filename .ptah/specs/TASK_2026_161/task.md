---
id: TASK_2026_161
status: done
type: BUGFIX
title: 'CLI-agent adapters: process-tree kill plus opencode follow-ups'
depends_on: []
created: '2026-08-09T15:26:27.172Z'
updated: '2026-08-09T15:26:27.199Z'
status_inferred: true
description: >-
  Four follow-ups deferred from TASK_2026_160 (GitHub issue #430): per-process
  OPENCODE_CONFIG_CONTENT instead of a read-merge-write config race, a reachable
  Windows native-binary fallback, a shared killProcessTree for CLI process
  groups, and an extracted createBufferedEmitter. Shipped in 1f3694ba7,
  f41a638ee and db2a44dac.
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

CLI-agent adapters: process-tree kill plus opencode follow-ups

Full context, plan and discussion live in [./context.md](./context.md).

---
id: TASK_2026_550_9a28
status: backlog
type: DEVOPS
title: Speed up and stabilize the Electron e2e suite
depends_on:
  - TASK_2026_389
created: '2026-09-24T06:19:59.827Z'
updated: '2026-09-24T10:56:51.885Z'
description: >-
  Share one Electron app per Playwright worker instead of booting one per test,
  and fix the intermittent local start-up hang after IpcBridge IPC listeners
  initialized.
estimate: M
labels:
  - e2e
relates_to:
  - TASK_2026_540_0940
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Share one Electron app per Playwright worker instead of booting one per test, and fix the intermittent local start-up hang after IpcBridge IPC listeners initialized.

Full context, plan and discussion live in [./context.md](./context.md).

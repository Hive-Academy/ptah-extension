---
id: TASK_2026_464_021a
status: in_review
type: BUGFIX
title: >-
  tasks:reindex times out after 30 seconds on the Electron Tasks board
depends_on: []
created: '2026-09-17T00:00:00.000Z'
updated: '2026-09-17T00:00:00.000Z'
description: >-
  Clicking Reindex on the Tasks board in Electron fails with
  "RPC timeout: tasks:reindex". The call uses the default 30s RPC client
  timeout, the scanner reads task folders serially with a redundant exists()
  before every readFile(), reindex() can run a second full rebuild right after
  ensureStarted() already did one, and the store reloads the board twice.
executor: backend-developer
estimate: S
labels:
  - tasks
  - electron
  - performance
---

See `context.md`.

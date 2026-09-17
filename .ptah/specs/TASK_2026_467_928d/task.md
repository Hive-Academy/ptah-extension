---
id: TASK_2026_467_928d
status: backlog
type: BUGFIX
title: >-
  Completed ptah-cli agents lose their output because the Electron state worker rejects it
depends_on: []
created: '2026-09-17T00:00:00.000Z'
updated: '2026-09-17T00:00:00.000Z'
description: >-
  Every ptah-cli agent that exits on Electron logs "Failed to persist CLI session
  reference after retries" with ElectronStateWorkerProtocolError "Worker message
  contains a non-cloneable JSON value" from executeReplaceJsonSequence. Codex
  agents persist fine. The saved session keeps no output, so after the session is
  reopened the ptah-cli tab is restored as an empty, grey card.
executor: backend-developer
estimate: S
labels:
  - electron
  - cli-agents
  - persistence
relatesTo:
  - TASK_2026_466_b70b
---

See `context.md`.

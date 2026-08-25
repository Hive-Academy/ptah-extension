---
id: TASK_2026_314
status: backlog
type: BUGFIX
title: >-
  startTaskSpecsIndex silently no-ops its SQLite upgrade if the connection token
  is registered after it, and nothing enforces the ordering
description: >-
  TASK_2026_306 defect E fixed the task-specs index warming against the
  in-memory store and never upgrading to SQLite, by having
  `startTaskSpecsIndex` subscribe to the connection's `onDidOpen`
  (`libs/backend/task-specs/src/lib/di/start-index.ts:164`). The subscription is
  guarded by `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` at
  `:153`, and if the token is not registered YET the function returns without
  subscribing — no warning, no retry, no record. The fix is therefore correct
  only while every host registers the SQLite connection BEFORE calling
  `startTaskSpecsIndex`. All three do today: `apps/ptah-electron/src/di/phase-2-libraries.ts:332`,
  `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:95`, and
  `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:130`.
  Nothing enforces it. A fourth host, or a reordering of phase 2 in any existing
  one, silently reverts defect E — the index warms on
  `InMemoryTaskIndexStore`, never upgrades, and the symptom is a Tasks board
  that is merely stale rather than broken, which is exactly the kind of
  regression that survives a release. Make the dependency explicit rather than
  incidental: at minimum log at WARN when the token is absent at subscribe time
  (silence is the whole problem), and ideally make the ordering structural — a
  deferred subscription that arms when the token appears, or an assertion in the
  shared registration path. The comment at
  `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:90-94` documents the
  reasoning and should be updated to state the ordering requirement once it is
  enforced. Recorded as a follow-up by TASK_2026_306.
---

# The onDidOpen ordering that defect E's fix depends on is unenforced

Machine-owned metadata carrier. Prose lives in `./context.md`.

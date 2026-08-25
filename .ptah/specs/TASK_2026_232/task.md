---
id: TASK_2026_232
status: done
type: RESEARCH
title: >-
  The stale-content symptom TASK_2026_222 observed still has no cause after
  two tasks ruled out both caches
description: >-
  TASK_2026_222 observed fresh chunks in dist/apps/ptah-extension-webview/
  browser/ sitting beside stale, pre-edit chunks in dist/apps/ptah-electron/
  renderer/, with a manual `node apps/ptah-electron/scripts/copy-renderer.js`
  fixing it instantly and costing three debugging cycles. Two tasks have since
  investigated and each disproved its own hypothesis. TASK_2026_226 ruled out
  copy-renderer's cache -- the target had no `cache` field at all and
  isCacheableTask requires cache === true, so it was never cached.
  TASK_2026_229 ruled out ptah-extension-webview:build's cache by seeding a
  genuine pre-edit production cache entry, editing the marked file, and
  re-running twice without busting cache; Nx correctly invalidated both times,
  producing content-correct output in the wrong configuration. Both tasks
  landed real fixes and both recorded plainly that neither accounts for the
  observed symptom. The wrong-CONFIGURATION bug is fixed and proven; the
  wrong-CONTENT observation is unexplained.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

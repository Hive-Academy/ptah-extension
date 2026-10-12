---
id: TASK_CI_SPEEDUP
status: done
type: DEVOPS
title: >-
  Speed up CI: shared setup action, sharded affected tests and Electron E2E
depends_on: []
created: '2026-10-09T15:23:34.000Z'
updated: '2026-10-09T16:51:55.000Z'
description: >-
  Cut CI from about 27 min to about 4 min and Electron E2E from about 27 min to about 13 min wall time: a shared setup-ci composite action, four test shards over affected projects, four Electron E2E shards with the perf benchmark moved to a nightly job, and pinned installs. Landed with PR #683 (merge 1869e3a31).
labels:
  - ci
  - github-actions
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Cut CI from about 27 min to about 4 min and Electron E2E from about 27 min to about 13 min wall time: a shared setup-ci composite action, four test shards over affected projects, four Electron E2E shards with the perf benchmark moved to a nightly job, and pinned installs. Landed with PR #683 (merge 1869e3a31).

---
id: TASK_2026_573_e2bf
status: backlog
type: BUGFIX
title: 'Close quarantine test gaps on node:sqlite and pin restore'
depends_on: []
created: '2026-09-26T20:53:55.778Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The real-SQLite quarantine specs never ran on the node:sqlite fallback. Force the fallback in a CI
  job, and add a spec that unpin on a quarantined pinned row fails and pinned stays 1 after restore.
labels:
  - memory-curator
  - P3
parent: TASK_2026_638_7a8e
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

On the dev machine `better-sqlite3` loads under both Node and Electron, so the `node:sqlite`
fallback of the real-SQLite specs (migrations 0048/0049, store, lifecycle, search, round-trip) was
never exercised.

- Add a way to force the `node:sqlite` opener (for example an env flag read by the test opener),
  and run these specs with it in CI or in a dedicated job.
- Add the Batch 6 minor case: `unpin` on a quarantined pinned row returns failure, and `pinned`
  stays 1 after restore.

## Current state (2026-11-07)

- The opener picks `better-sqlite3` first and falls back to `node:sqlite` only when the native
  binary fails to load:
  `libs/backend/memory-curator/src/lib/retention/retention-sqlite.test-support.ts:50-71`. No
  switch forces the fallback, and no CI workflow under `.github/` mentions `node:sqlite`.
- `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts:197` accepts either opener.
  The spec has no unpin-then-restore case.

Full context, plan and discussion live in [./context.md](./context.md).

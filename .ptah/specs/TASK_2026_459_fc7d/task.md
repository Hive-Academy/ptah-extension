---
id: TASK_2026_459_fc7d
status: done
type: FEATURE
title: >-
  Show the Ptah title for peer sessions from any workspace registered in this
  host process
depends_on: []
created: '2026-09-16T04:00:00.000Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Peer rows from another workspace should show their Ptah title. On Electron the
  global SQLite session store likely already gives this; confirm it and close or rescope.
executor: backend-developer
estimate: M
labels:
  - peer-sessions
  - agent-messaging
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`PeerSessionDirectory.readPtahTitles` takes titles from `SessionMetadataStore.getAll()`
(`libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts:167-177`). The
remaining work is to confirm in Electron that a peer row whose session started under another
workspace shows its Ptah title. If it does, close the task. If not, find the host path that still
reads only the active workspace delegate and fix that path. The aggregate reader over
`IWorkspaceScopedStateStorage` that `context.md` proposes is probably no longer needed.

## Current state (2026-11-07)

- `bf152e823` (2026-10-10) moved session metadata to the global store. When the session record
  repository is bound, `getAll()` reads `records.listAll({ includeChildren: true })`, "every project
  of this host" (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1892-1897`).
- `listAll` filters by host only, not by workspace
  (`libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-record-repository.ts:114-123`).
- Electron binds the repository (`apps/ptah-electron/src/di/phase-1-infra.ts:167`).
- The fallback path that reads the active `WORKSPACE_STATE_STORAGE` delegate is used only when no
  repository is bound. That was the VS Code host, which is removed (PR #892).
- Not checked in a running app.

Full history in [./context.md](./context.md). Its line numbers are out of date.

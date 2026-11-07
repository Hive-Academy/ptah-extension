---
id: TASK_2026_572_07c4
status: backlog
type: FEATURE
title: Add a memory UI view to list and restore quarantined memories
depends_on: []
created: '2026-09-26T20:53:54.172Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The memory:listQuarantined and memory:restoreQuarantined RPCs have no user-facing surface. Add a
  quarantine list with restore actions to the Electron memory UI.
labels:
  - memory-curator
  - P2
parent: TASK_2026_637_e30b
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Quarantined memories can be listed and restored only through the `memory:listQuarantined` and
`memory:restoreQuarantined` RPCs. No screen calls them.

- Add a quarantine view with restore actions to the memory UI in
  `libs/frontend/memory-curator-ui` (Electron renderer).
- A restore requires an explicit authorized workspace, or an explicit `null` for rows with a NULL
  workspace.

## Current state (2026-11-07)

- The RPCs exist: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:175-176`,
  types in `libs/shared/src/lib/types/rpc/rpc-memory.types.ts:137,167`.
- The memory UI shows quarantine counts only:
  `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:194-248`.
  There is no list and no restore action.
- The CLI subcommand part is dropped: the headless CLI app (and `ptah interact rpc.call`) was
  removed in PR #892 (`1cee6fafe`).

Full context, plan and discussion live in [./context.md](./context.md).

# TASK_2026_459 — Cross-workspace `ptahTitle`

Found while implementing TASK_2026_449 / TASK_2026_452 (PR #517). Deferred
there on purpose: the task forbade a new platform port.

## The gap

`PeerSessionDirectory.readPtahTitles` calls `SessionMetadataStore.getAll()`
(`libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts`),
and `getAll` reads the ambient `WORKSPACE_STATE_STORAGE`
(`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:655-666`), which in a
multi-workspace host is the ACTIVE delegate only. So a peer row started by
another workspace window has no `ptahTitle` and the picker falls back to the
registry name.

The peer list itself is deliberately cross-workspace
(`peer-session-directory.service.ts:7-34`, policy `include-all-workspaces`),
so the row is shown — only its title is missing. Worktree sessions are the
common case.

## Evidence for the fix (codex lane, verified against the code)

- `IWorkspaceScopedStateStorage.getStorageForWorkspace` and
  `getAllWorkspacePaths`
  (`libs/backend/platform-core/src/interfaces/workspace-scoped-state-storage.interface.ts:30-51`)
  already expose every workspace REGISTERED IN THIS HOST. It is structural on
  the existing `WORKSPACE_STATE_STORAGE` token, so no new platform port is
  needed.
- Electron already demonstrates the aggregation pattern:
  `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts:41-82`
  — enumerate workspace paths, take each delegate, read `ptah.sessionMetadata`,
  validate, deduplicate by session id.

## Proposed scope

- A read-only aggregate metadata reader that probes
  `isWorkspaceScopedStateStorage`, reads every registered delegate, validates
  records and deduplicates by session id.
- `PeerSessionDirectory` uses it for the title join only.
- `SessionMetadataStore`'s ambient WRITE behaviour stays unchanged.

## Known limit (state it, do not try to solve it here)

A workspace known only to ANOTHER PROCESS or window is still invisible: the
port documents open-workspace registrations only, and VS Code and the CLI each
register one concrete current-workspace store
(`libs/backend/platform-vscode/src/registration.ts:66-70`,
`libs/backend/platform-cli/src/registration.ts:71-73`). Reading closed or
other-process stores would need global indexing or platform-specific storage
discovery — a separate decision.

## Acceptance

- A session started in workspace A shows its Ptah title in workspace B's peer
  picker, in one Electron process with both workspaces open.
- A metadata read failure for one workspace still lists every row, without
  titles, and logs one warn.
- No new `PLATFORM_TOKENS` entry, no write path change.

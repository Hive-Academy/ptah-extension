# TASK_2026_459 — Cross-workspace `ptahTitle`

Found while implementing TASK_2026_449 / TASK_2026_452 (PR #517). Deferred
there on purpose: the task forbade a new platform port.

## The gap

`PeerSessionDirectory.readPtahTitles` calls `SessionMetadataStore.getAll()`
(`libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts`),
and `getAll` reads the ambient `WORKSPACE_STATE_STORAGE`
(`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:655-666`), which in a
multi-workspace host is the ACTIVE delegate only. So a peer row whose session
was started under a different registered workspace has no `ptahTitle`, and the
picker falls back to the registry name.

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

## The boundary, stated exactly

The supported set is every workspace REGISTERED IN THIS HOST PROCESS through
`IWorkspaceScopedStateStorage` — nothing wider. In practice that is Electron,
which registers each open workspace on one storage; VS Code and the CLI each
register a single concrete current-workspace store
(`libs/backend/platform-vscode/src/registration.ts:66-70`,
`libs/backend/platform-cli/src/registration.ts:71-73`), so for those hosts the
aggregate equals today's answer.

Out of scope, and NOT a defect of this task:

- a workspace that is open in a DIFFERENT host process (a second Electron
  instance, another VS Code extension host, a CLI run);
- a workspace that was closed, so nothing registered it.

Reaching either would need global indexing or platform-specific storage
discovery, which is a separate decision.

## Acceptance

- A session started under workspace A shows its Ptah title in workspace B's
  peer picker, with both workspaces registered in ONE Electron process.
- A row whose workspace is not registered in this process still lists, with the
  registry name and no title.
- A metadata read failure for one workspace still lists every row, without
  titles, and logs one warn.
- No new `PLATFORM_TOKENS` entry, no write path change.

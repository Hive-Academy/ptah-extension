# Batch 8o-1: GAP B and GAP C

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\session-metadata-store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8o-1-report.md`

## GAP B: workspace path

`updateCodexExecution` now writes the caller's workspace path to the session detail row. It retains an existing detail path on update only when the stored path normalizes to the same Codex key and is not itself the key. Other stored paths are repaired from the caller path. `codexExecution.workspaceId` remains the normalized key; binding and foreign-workspace checks still use that key. The `metadataChanged.workspaceId` payload now follows the detail path.

Write path: `identity.workspaceId` (caller path) enters `createCodexChatMetadataPort`, which supplies `proposed.workspaceId` to `SessionMetadataStore.updateCodexExecution`. The store writes that path to `SessionMetadata.workspaceId`. `toSessionRecordInput` copies it to `workspacePath`; SQLite's `upsert` derives `workspace_key` through `normalizeWorkspaceRoot`. `session:list` calls `getForWorkspace`, whose records path calls `listForWorkspace` with the caller path and the same normalization. The value format in detail and `workspacePath` is the caller's mixed-case path, for example `C:/Work/Project`; the Codex identity key remains `c:/work/project`. The legacy `getAll` reader compares detail paths through `normalizeWorkspaceId`.

Specs added: `lists a mixed-case Windows caller path through the records repository`; `preserves a stored caller path and repairs a legacy normalized-key path`. The existing `lists Windows paths regardless of casing and separators` spec now checks persisted detail and the caller-path lookup; existing identity, repository-write and change-event expectations were updated.

## GAP C: native title

`CodexChatAdapter.persistMetadata` now passes the first nonblank value among `sessionTitle`, `sessionName`, and start config `name` to the metadata port. The store's `codexSessionName` rule still trims the supplied title, preserves a user rename, and replaces only a session-id placeholder.

Write path: `chat:start` supplies the tab title as `config.name`; `persistMetadata` selects it when higher-priority title fields are blank or absent. `createCodexChatMetadataPort.save` forwards the selected value as `title` to `updateCodexExecution`, where `codexSessionName` writes `SessionMetadata.name`. `toSessionRecordInput` copies the name to the repository row and summary; session listing reads the summary. The stored value is a trimmed human-readable title, for example `Tab title`, rather than the thread-id placeholder.

Specs added: `passes a start tab name to metadata when it is the only title`; `falls through a blank session title to the start tab name`; `prefers a nonblank session title over session name and tab name`; `passes the available title during resume`.

## Decisions

- Emit the detail workspace path in `metadataChanged.workspaceId`, matching ordinary Claude rows. The frontend uses created/updated notifications to reload sessions and ignores the field; the session-organization listener uses it for delete cascades. The runtime identity cache also ignores this field. A path value keeps the notification contract consistent with the persisted row.
- Preserve a stored Claude-style path even if a later caller uses different casing or separators, provided it normalizes to the same Codex workspace key. Repair normalized-key, foreign, and malformed detail paths from the caller path.
- Keep title selection in the adapter and placeholder/rename behavior in the store. Resume config has no `name` field; its `sessionTitle` and `sessionName` are still forwarded.
- No tests, builds, lint, typecheck, or other verification commands were run, per coordinator instruction. Diff inspection only.

## Fix round

- Guarded the stored detail path normalization. An existing path is kept only when it is a distinct caller path for the current Codex workspace; a foreign path or a normalization error selects `proposed.workspaceId`.
- Added `replaces a D:/Other/Project stored workspace path with the caller path`, `replaces a relative/project stored workspace path with the caller path`, and `preserves an existing POSIX caller path for the same workspace` to cover the repair and preservation rules.
- Added `falls through a blank session title to the session name`; the existing blank-title-to-tab-name spec now also supplies a whitespace-only session name.
- No tests, builds, lint, typecheck, or verification commands were run, as instructed.

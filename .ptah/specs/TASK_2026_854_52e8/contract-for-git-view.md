# Contract for `feat/session-git-view`: session -> worktree root and branch

Owner of this contract: TASK_2026_854_52e8 (`feat/session-auto-links`).
Consumer: `feat/session-git-view`, which owns `libs/frontend/git-ui` and
`libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts`.
This task does not edit either of those.

## What you can rely on

### Host data (Electron and CLI; VS Code reports organization unavailable)

`SessionOrganizationSummary` (`libs/shared/src/lib/types/session-organization.types.ts`)
already carries:

| Field          | Type             | Meaning |
| -------------- | ---------------- | ------- |
| `worktreePath` | `string \| null` | Absolute path of the git worktree the session runs in. `null` means UNKNOWN or the workspace root. Detection may have failed (unreadable `.git`/`HEAD`), may not have run yet (the session has not resolved since this build, or the store was closed), or the session runs in the root. Keep your own git-root fallback whenever it is null. |
| `branch`       | `string \| null` | The branch checked out in that worktree when known. `null` when unknown or HEAD is detached. Compute it yourself if you need it live. |

After this task, `worktreePath` is filled in automatically for:

1. children started by `ptah_session_start` (already true; spawner);
2. a session's `WorktreeCreate` hook (already true; recorded on the session
   the hook fired for);
3. NEW: any session whose SDK working directory is a git worktree, meaning
   `<cwd>/.git` is a file with `gitdir:`. This is recorded when the session id
   resolves (new session or resume), or when the SQLite store opens if the id
   resolved while it was closed. It is only filled in when no path was
   recorded before. `branch` is read from that worktree's `HEAD`.

The path string is the value the host recorded. It is not re-normalized for
display. Compare paths with the same normalization you already use for git roots.

### How it reaches the webview

- `session:list` rows: `ChatSessionSummary.organization.worktreePath / branch`.
- `session:getOrganization { sessionId }` for a session outside the loaded list.
- Change signal: the `session:organizationChanged` push
  (`{ workspaceRoot, sessionIds, reason }`). Re-read the named ids.
- When `ChatStore.organizationAvailable()` is false (VS Code), treat every
  session as "no worktree known" and keep your current fallback.

### Webview accessor (added by this task, chat lib)

`SessionOrganizationCache` at
`libs/frontend/chat/src/lib/services/session-organization/session-organization-cache.store.ts`,
`@Injectable({ providedIn: 'root' })`:

```ts
organizationFor(sessionId: string): Signal<SessionOrganizationSummary | null>;
```

- `null` means unknown: not loaded yet, organization unavailable, or the
  session id is not an SDK session id yet (a fresh tab). When organization is
  unavailable (VS Code) the cache makes no RPC call at all.
- It reads the loaded `session:list` row first and falls back to one
  `session:getOrganization` read. It refreshes on `session:organizationChanged`.
  The cache is bounded (64 entries) and runs no timer.
- Suggested git-root rule:
  `organizationFor(id)()?.worktreePath ?? <your current root rule>`.

## What is NOT part of the contract

- The task-link fields (`tasks`) and `todos` may change shape in later tasks.
  Do not depend on them for git.
- No new RPC method or push type exists for git. Do not wait for one.

## Merge note

This task adds one input (`linkedTask`) to `compact-session-activity` and
`compact-rail-card`, and one computed signal plus one template binding to
`compact-session-card.component.ts`. If your branch edits the same card,
expect a small textual conflict around the `[gitStats]` bindings. Keep both
bindings.

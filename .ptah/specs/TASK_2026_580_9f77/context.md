# Task Context - TASK_2026_580_9f77

## User Request

> i want to create a new task to enhance our session storage with priority and other important features like
> statuses as well also a worktree and PR links to have a more fine-grained control over the big amount of
> sessions we start and to link with our tasks system as well which is also very important

## Task Type

FEATURE. Complex. Full depth: software-architect → user gate → team-leader batches → QA.

## Current setup (research 2026-09-30)

### Session storage

- `SessionMetadata` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:64-122`): `sessionId`, `name`,
  `workspaceId`, `createdAt`, `lastActiveAt`, `totalCost`, `totalTokens`, `cliSessions?`,
  `workingDirectory?`, `resumableSdkSubagents?`, `isChildSession?`. No priority, status, pin, archive, tags,
  branch, PR or task.
- Storage is a JSON key-value store, not SQLite: index key `ptah.sessionMetadata` (`:149`), detail key
  `ptah.session:<id>` (`:150`). VS Code: `workspace-state.json`. Electron: a storage worker for each
  workspace, `{schemaVersion:1, items}`, 1 MiB read cap for each value, 256 KiB for each worker message.
  CLI: a JSON file.
- `_saveInternal` replaces the whole record and carries over only 4 fields (`:451-468`). The importer,
  `create` and `markChildSession` build new records. A new field that is added here is silently erased
  unless each writer is changed.
- Every non-`cliSessions` field goes into the single index key, which is rewritten on each change.
- Children have `isChildSession:true` but no `parentSessionId`. Forks store no source id
  (`session-fork.service.ts:131-136`).

### Session list

- `session:list` (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:65-84`): `offset`, `limit`, `since`
  only. Fixed sort by `lastActiveAt` descending. Rows return `messageCount:0` and `isActive:false`.
- Sidebar (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:76-340`): search on name
  and a date filter, both client-side over pages of 30. Rename and delete only.
- Live run state exists (`SessionTurnState.phase`, `session:status`, `SDK_SESSION_TURN_STATE_REGISTRY`) but
  only tabs use it.
- Electron does not push `session:metadataChanged` (`apps/ptah-electron/src/rpc-host-profile.ts:75`).

### Worktree and PR data

- Only `workingDirectory` is stored. No branch.
- The SDK `WorktreeCreate` callback receives `{sessionId, name, cwd}` but only broadcasts
  `git:worktreeChanged` without a session id (`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:31-36, 347-376`).
- `ptah_git_worktree_add` does not record the calling session.
- Nothing captures PR URLs. `PostToolUsePayload` (`agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts:8-17`)
  has tool name, input, output and session id. Memory and skill triggers already subscribe to it.

### Tasks

- `task.md` frontmatter is the source of truth and is machine-owned (`task-spec.contract.ts`). It has no
  priority, session, branch or PR field. `assignee` and `claim` are reserved and unused.
- The `task_specs` SQLite table is a derived index, rebuilt from files. A link stored only there is lost on
  rebuild.
- Starting a task from the board (`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:111-124`)
  opens a tab named after the task id with a `/orchestrate <taskId>` prompt. No link is saved.
  TASK_2026_471_c054 planned a "View session" button on cards; it is not built.

## Decisions

1. **Storage: SQLite, not the session metadata JSON.** A new table `session_organization` in
   `persistence-sqlite` (next migration after `0049`), keyed by `(workspace_root, session_id)`. Reasons:
   server-side filter and sort over hundreds of sessions, no growth of the 1 MiB index key, no risk from the
   4-field carry-over in `_saveInternal`, and SQLite already exists in Electron and VS Code. The JSON store
   stays the owner of the session itself. When SQLite is not available, the feature degrades (no organization
   fields shown), like the task index fallback.
2. **Session–task links: a join table, not frontmatter.** `session_task_links(workspace_root, session_id,
   task_id, role, created_at, source)`. `role`: `primary` or `related`. `source`: `board-start`, `agent`,
   `user`. Tasks are shared documents; sessions are high-churn and per user.
3. **Workflow status is separate from run state.** User-set status: `active`, `waiting`, `in_review`,
   `done`, `archived`. The live phase (generating, idle, failed) comes from the existing turn-state registry
   and is shown beside it, not stored.
4. **Priority:** `urgent`, `high`, `normal` (default), `low`, as an ordered tuple like `TASK_ESTIMATES`.
5. **Hierarchy:** store `parent_session_id` and `fork_of_session_id` in the new table so child, lane and
   fork sessions can be grouped under a parent.

## Scope

### Phase A — backend

1. Migration: `session_organization` (priority, status, pinned, worktree_path, branch, parent_session_id,
   fork_of_session_id, updated_at), `session_pr_links` (session_id, url, number, repo, state, source,
   created_at), `session_task_links`.
2. A store and service in a backend lib that logs through `IOutputChannel` (not `vscode-core` `Logger`).
3. RPCs: `session:setOrganization`, `session:linkTask`, `session:unlinkTask`, `session:addPrLink`,
   `session:removePrLink`, and new `session:list` params: `status[]`, `priority[]`, `taskId`, `pinned`,
   `hasPr`, `text` (name), `sort` (`lastActive`, `priority`, `created`, `name`). Rows return organization
   fields, linked task ids, PR links and live phase.
4. Delete a session → delete its organization rows.

### Phase B — automatic capture

1. Board start writes a `primary` link to the task (`source: board-start`) as soon as the session id is known.
2. `WorktreeCreate` hook and `ptah_git_worktree_add` record `worktree_path` and `branch` on the calling
   session. `git:worktreeChanged` gets the session id.
3. A `PostToolUse` subscriber detects a `https://github.com/<owner>/<repo>/pull/<n>` URL in the output of a
   `gh pr create` Bash call and adds a PR link (`source: agent`).
4. MCP: `ptah_session_link_task` (or a `sessionId` link option on `ptah_task_update`) so an agent that works
   a task links it without the board.
5. Fork and child creation set `fork_of_session_id` and `parent_session_id`.

### Phase C — UI

1. Sidebar: priority and status chips, pin, filter bar (status, priority, task, has PR), sort menu, grouping
   (by status, by task, by parent), live phase dot. Filters run on the server.
2. Session header or menu: edit priority and status, link or unlink a task, add or open a PR link, open the
   worktree.
3. Task board cards and task detail: list linked sessions with live phase, "Open session", and PR links.
4. Electron pushes an organization-changed event so the sidebar refreshes.

## Out of scope

- A priority field on tasks. File a follow-up if needed.
- Polling GitHub for PR state. `state` is set only from what the agent or the user records.
- Cross-workspace session views (TASK_2026_459).

## Acceptance criteria

1. With 500 seeded sessions, filter by status and priority and sort by priority return in less than 200 ms
   through `session:list`, and the sidebar shows the correct count.
2. Starting a task from the board creates a `primary` link; the card shows the session and its live phase.
3. An agent that runs `gh pr create` in a session adds the PR link to that session without user action.
4. A worktree made by the SDK hook or by `ptah_git_worktree_add` shows on the session with its branch.
5. Organization data survives app restart, session resume, rename, and the importer re-scan.
6. Deleting a session deletes its organization and link rows. Deleting a task folder leaves the link rows
   but the UI shows them as missing.
7. Works in Electron and VS Code. CLI: RPCs work when SQLite is available.
8. Reachability proof for each capture path: a spec fails if the production path does not call it.

## Consumer: TASK_2026_584_5e7a (agent-started sessions)

TASK_2026_584 lets a parent agent start child chat sessions, each in its own worktree, bound to the UI as normal tabs. Each child needs the same data this record holds (worktree, branch, workflow status, task link) plus one field this task does not plan: the **parent session id**. Keep room for it in the schema:

- A nullable `parent_session_id` column on the organization record (or a `spawned_by` link kind), so the session list can group children under their parent.
- A `started_by: 'user' | 'agent'` value, so the UI can mark agent-started tabs.
- Worktree capture must also fire when a session is started by `ptah_session_start`, not only by the SDK hook or `ptah_git_worktree_add`.

The 584 implementation plan decides whether its child-link registry is the first slice of this record or a temporary registry that this task absorbs. Either way, the two tasks share one schema.

## Related defects found during research (file separately)

- The Electron gateway session lister checks `Array.isArray(raw)`
  (`apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts:71`) and misses the
  `{schemaVersion, items}` shape. It probably lists no sessions after the storage split.
- `session:list` returns `messageCount:0` and `isActive:false` for every row.

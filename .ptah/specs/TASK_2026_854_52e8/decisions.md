# Decisions - TASK_2026_854_52e8

The user asked for no questions. Each decision below was settled from source.
Paths are relative to the worktree root. "Verified" means the cited line was
opened and read. "Assumption" names the check the implementer must run.

## D1. Link precedence table (the one rule set)

> Superseded in part by **Review round 1** at the end of this file. RR1-1
> replaces the rank table, the R4/R5 tie and the incremental
> `decideTaskLink` with a full reconcile (`planAutoLinks`). Where this section
> and RR1 disagree, RR1 wins.

### Vocabulary

`SESSION_TASK_LINK_SOURCES` (`libs/shared/src/lib/types/session-organization.types.ts:38-43`)
grows by appending three values, so the existing order stays the same:
`['board-start', 'agent', 'user', 'orchestrate', 'worktree', 'inherited']`.

- Migration impact: none on existing rows. Migration 0050 has no CHECK
  constraints on `source` or `role`
  (`libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts`
  header: "NO CHECK constraints on enum columns"). The store reads tolerantly
  (`session-organization.store.ts:17-19`).
- Downgrade: an older build reads an unknown source as `user`
  (`DEFAULT_TASK_LINK_SOURCE`, `session-organization.store.ts:64`). This is
  accepted. A downgraded build then treats auto links as manual ones, and no
  data is lost.
- Spec: `libs/shared/src/lib/types/session-organization.types.spec.ts:33-36`
  pins the tuple. Update the expected array there.
- Zod: the webview schema allows only `WEBVIEW_TASK_LINK_SOURCES = ['user','board-start']`
  (`libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts:73`).
  It stays as it is: the webview never claims an auto source. Narrow the TS type
  `SessionLinkTaskParams.source` (`rpc-session.types.ts:186`, today
  `Exclude<SessionTaskLinkSource,'agent'>`) to `'user' | 'board-start'`, so the
  new auto sources are not webview-claimable at the type level either.
- Exhaustive maps that must gain the three keys:
  `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:78-82`
  (`SESSION_SOURCE_LABELS: Record<SessionTaskLinkSource, string>`).

### Rank and protection

| Source        | Rank (lower wins) | Protected from auto rules | Written by |
| ------------- | ----------------- | ------------------------- | ---------- |
| `user`        | 0                 | yes | `session:linkTask` RPC (webview) |
| `agent`       | 1                 | yes | `ptah_session_start taskId` (`recordAgentStartedSession`, store `:656`), MCP `ptah_session_link_task` (`session-organization-namespace.builder.ts:146`) |
| `board-start` | 1                 | yes | legacy rows only after D2; still accepted by the RPC schema |
| `orchestrate` | 2                 | no  | NEW host rule R3 |
| `worktree`    | 3                 | no  | NEW host rules R4/R5 |
| `inherited`   | 4                 | no  | NEW host rules R6/R7 |

A protected link is never written, demoted, re-roled or re-sourced by an auto
rule. An explicit (protected) write keeps today's behaviour: a new `primary`
demotes the other primary to `related` (`session-organization.store.ts:13-16, 544-558`).

### Rules

| # | Trigger (host event) | Evidence (exact, no fuzzy) | Candidate role | Source |
| - | -------------------- | -------------------------- | -------------- | ------ |
| R1 | `session:linkTask` RPC | the user's choice | as sent | `user` (or `board-start`) |
| R2 | `ptah_session_start` with `taskId` -> `recordAgentStartedSession` | taskId passed Zod `SESSION_TASK_ID_PATTERN` (`session-tool-args.schema.ts:24,45`) | primary | `agent` (unchanged) |
| R3 | main-thread `UserPromptSubmit` (no `agent_id`), or `UserPromptExpansion` with `skillSlug === 'orchestrate'` and `expansionType === 'slash_command'` | first non-blank prompt line matches `^/orchestrate\s+(<TASK_ID>)(?=\s\|$)` (expansion: the first token of `commandArgs` matches `^<TASK_ID>$`), AND `<root>/.ptah/specs/<id>/task.md` exists | primary | `orchestrate` |
| R4 | the session's stored `worktreePath`/`branch` changed (reconcile) | the distinct `<TASK_ID>` tokens in `basename(worktreePath)` and in `branch`, filtered to the ids whose `task.md` exists in the workspace root or in the worktree. Exactly one remains | primary | `worktree` |
| R5 | same as R4, only when R4 found no id | other sessions of the same workspace with the same `worktree_path` whose PRIMARY link source is `user`, `agent`, `board-start` or `orchestrate`. Their distinct primary task ids number exactly one | primary | `worktree` |
| R6 | the session has `parentSessionId` (reconcile, also re-run for the children when a parent changes) | the parent's current primary link (any source) | related | `inherited` |
| R7 | the session has `forkOfSessionId` (reconcile) | every link of the fork source, with the same role | same as source | `inherited` |

`<TASK_ID>` = `TASK_\d{4}_\d{3,}(?:_[0-9a-f]{4})?`. In R4 the match is
bounded by `(?<![A-Za-z0-9])` and `(?![A-Za-z0-9])`. The sequence uses
`\d{3,}`, not `\d{3}`: the allocator pads the sequence to at least 3 digits and
never caps it (`libs/backend/task-specs/src/lib/id-allocator.ts:16, 1-13`). The
suffix is lowercase hex (`id-suffix.ts`, `TASK_ID_SUFFIX_RE = /^[0-9a-f]{4}$/`).
A regex hit alone is never a link. The `task.md` existence check is required,
which makes the match exact.

### Decision function `decideTaskLink(current, suppressed, candidate)` (pure)

Inputs: the session's current links, its suppressed task ids, and one candidate
`{taskId, role, source}`. Output: zero or one store write.

1. `suppressed.has(taskId)`: no write. The user override wins (D3).
2. The task is already linked to the session:
   - existing source protected: no write;
   - existing auto link, candidate `primary`:
     - existing role `primary`: rewrite its source to the candidate's when the
       candidate ranks strictly better, otherwise no write;
     - existing role `related`: when the session has no primary, or its primary
       is auto with a strictly worse rank, promote it to `primary` with the
       candidate source (the store demotes the old primary). Otherwise rewrite
       its source when the candidate ranks strictly better, else no write;
   - existing auto link, candidate `related`: rewrite its source when the
     existing role is `related` and the candidate ranks strictly better.
     Otherwise no write. A related candidate never demotes a primary.
3. The task is not linked:
   - candidate `related`: link it as `related`;
   - candidate `primary`: link it as primary when there is no primary, or the
     primary is auto with a strictly worse rank (it is demoted to `related`).
     Otherwise link it as `related` with the candidate source.

Properties the tests pin:

- Idempotence: applying a candidate twice writes once.
- Order independence across different ranks: the final role and source per
  task do not depend on event order.
- Equal-rank conflict: two candidates of the same rank with different tasks.
  The earliest wins primary and the later one becomes `related`. This is "first
  `/orchestrate` wins"; it is deterministic for a given event sequence.
- A protected link is never changed.

### What a user override does (tombstones)

- `session:unlinkTask` writes a suppression row `(workspace_root, session_id, task_id)`
  BEFORE it deletes the link. If the delete fails, the link stays and is still
  shielded, so the order is safe without a cross-store transaction.
- A protected write (R1 or R2, `linkTask` with `user`/`agent`/`board-start`)
  deletes the suppression for that pair AFTER the link write.
- Auto rules skip a suppressed pair forever: across events, reload and restart.
  The row is in SQLite.
- Changing a role through `session:linkTask` turns the link's source into
  `user`. That makes it protected, so an auto rule never re-promotes a link the
  user demoted.
- Suppressions move with `rekeySession` and are removed by the delete cascade.

## D2. Board start: move to the host, delete the webview pending map

- Decision: delete `BoardTaskLinkCaptureService`
  (`libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts`),
  its `expect` call (`task-prompt-bridge.service.ts:119-124`) and its call on
  `session:id-resolved` (`chat-message-handler.service.ts:845-850`). A board
  start is linked by host rule R3.
- Evidence: the board prompt always starts with `/orchestrate <taskId>`
  (`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:16, 144-163`;
  all three branches start `${ORCHESTRATE_COMMAND} ${taskId}`). The prompt is
  only prefilled, and the user sends it (`task-start.service.ts:38-41`). The
  host sees the sent prompt with the real SDK session id
  (`user-prompt-submit-hook-handler.ts:75-79, 122-127`, payload `sessionId`
  from `input.session_id`).
- Why this is the simplest correct design: no link exists before the first
  send, because no SDK session exists yet, so there is nothing for a reload to
  lose. After the first send, the link is decided on the host from the prompt
  that was actually sent, and the webview plays no part. A reload BEFORE the
  first send loses the unsent prefilled prompt (the prefill is a one-shot
  signal and composer drafts live in memory). That is accepted and out of
  scope; see RR1-4. The host holds a first-turn candidate only until both the
  metadata exists and the store is open (D2a, RR1-2). If the user edits the
  prompt so it no longer starts with `/orchestrate <id>`, no link is made: the
  link follows what was sent.
- Rejected:
  - (a) Persist the tab -> task pair in SQLite keyed by tab id. Tab ids are not
    session ids, and the recorder contract forbids writes keyed by them
    (`session-organization-recorder.interface.ts:8-10`). It needs a new table
    and a GC path.
  - (b) Add `taskId` to `ChatStartParams` (`rpc-chat.types.ts:73`). The tab
    would need to persist the hint across reload, which means editing
    chat-state tab persistence, and the result is the same as R3.
- Effect: the `board-start` source is no longer produced. It stays in the
  tuple for existing rows (tolerant read) and in the RPC schema.

### D2a. Ordering between the prompt hook and metadata

- Verified: metadata is created inside the SDK `init` callback
  (`sdk-agent-adapter.ts:1597-1615`), and only then does
  `SessionIdResolvedCallbackRegistry.notifyAll` fire (`:1630-1635`). The
  service drops writes for ids without metadata (`session-organization.service.ts:12-17`).
- Assumption: the first `UserPromptSubmit` may run before `init` is processed.
  Check: the auto-link spec covers both orders.
- Decision: when `metadata.get(sessionId)` is null, the R3 candidate is parked
  in memory (a Map keyed by session id, capped at 64, oldest evicted, no timer).
  It is applied on `SessionIdResolved` for that `realSessionId`. When metadata
  exists, the candidate is applied at once.

## D3. Persistence across reload and restart

- Links: already in SQLite (`session_task_links`, migration 0050).
- New migration `0063_session_auto_links` (next free version after `0062`,
  `migrations/index.ts`; re-check the number at rebase time) creates:
  - `session_task_link_suppressions(workspace_root, session_id, task_id, created_at, PK(workspace_root, session_id, task_id))`;
  - `session_todo_progress(workspace_root, session_id, done, total, in_progress, updated_at, PK(workspace_root, session_id))`;
  - `idx_session_org_worktree ON session_organization(workspace_root, worktree_path)` for R5.
  - No CHECK constraints, matching 0050. Static SQL, IF NOT EXISTS.
- No backfill on start. Rules run on events. A rule whose evidence appears
  later (for example, a task folder created after the worktree was recorded)
  runs on that session's next organization change. This is recorded as a known
  limit and is reversible.
- No in-memory state lives longer than one event pair (D2a). Therefore
  "reload" means: the webview holds nothing. "Restart" means: every fact and
  override is a row.

## D4. Session worktree and branch, known on the host

- Verified: metadata stores `workingDirectory` when the cwd differs from the
  workspace ("when the session runs in a git worktree",
  `session-metadata-store.ts:182-186, 1546`). The organization row gets
  `worktree_path` today only from the spawner (`store :638-661`) and the
  `WorktreeCreate` hook (`worktree-hook-handler.ts:290-295`).
- Decision: on `SessionIdResolved`, when `metadata.workingDirectory` differs
  from `metadata.workspaceId` (both normalized), the organization row has no
  `worktreePath`, and `<wd>/.git` is a file whose `gitdir: <path>` is readable,
  call `recordWorktree({sessionId, worktreePath: wd, branch})`. The branch is
  read from `<gitdir>/HEAD` (`ref: refs/heads/<branch>`). A detached HEAD gives
  no branch.
- Reads go through `IFileSystemProvider.readFile`/`exists`
  (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:20-22, 71-74`),
  bound on Electron (`platform-electron/src/registration.ts:113`) and CLI
  (`platform-cli/src/registration.ts:66`). No git process is spawned and no new
  port is needed.
- Rejected: spawning `git rev-parse`. It needs a process port, a timeout and
  error mapping, for two small file reads.

## D5. Todo progress

- Source: `PostToolUseCallbackRegistry` payloads with `toolName === 'TodoWrite'`,
  `success === true`, from the main thread only
  (`post-tool-use-hook-handler.ts:332-363`). Subagent calls carry `agent_id`
  (`:100`), and the webview also skips agents (`compact-session-metrics.ts:96-102`).
- Required agent-sdk change (additive): `PostToolUsePayload` and
  `UserPromptSubmitPayload` gain `readonly agentId?: string`, set only when
  `input.agent_id` is a non-empty string. Existing `toEqual` payload assertions
  stay valid.
- Parse: a Zod schema at the boundary (`todos: array(max 500) of {content: string, status: enum('pending','in_progress','completed'), activeForm?: string}`),
  matching `TodoItem` (`libs/shared/src/lib/type-guards/guards/exec.ts:70-78`).
  Output: `{done, total, inProgress: activeForm || content of the first in_progress item, trimmed, at most 200 chars, or null, updatedAt}`.
- Persist: yes, the latest snapshot per session in `session_todo_progress`. The
  task view must show progress for sessions not loaded in any tab and after a
  restart. Replaying transcripts to get it is too costly.
- Write and emit only when `done`, `total` or `inProgress` changed, so a
  repeated TodoWrite causes no push.
- Delivery: no new RPC method or push type.
  `SessionOrganizationSummary` gains `todos: SessionTodoProgress | null`, and
  `TaskLinkedSession` (`rpc-session.types.ts:225-234`) gains the same field.
  They reach the webview through `session:list`, `session:getOrganization`
  and `session:listForTasks`. Refresh happens on the existing
  `session:organizationChanged` push (`payload-map.ts:331-335`). Its consumers
  already re-read: tasks-ui coalesces fetches
  (`task-session-links.service.ts:54-66, 82`), and chat routes the push in
  `chat-message-handler.service.ts:215-218`.
- Rejected: a new `session:todoProgress` push. It would need a new message
  type, an allowlist entry and a new handler, and the existing change push
  already causes the right re-read.
- `inspector-todos-section.component.ts` is unchanged. It shows the live
  per-tab list from the stream (`:40-70`), which is more detailed than the snapshot.

## D6. Task status policy: no automatic status writes

- Decision: the host never writes task status in this task. There is no
  backlog -> in_progress and no auto-close.
- Evidence:
  - The board deliberately stopped owning status, and the agent that receives
    `/orchestrate` moves the task (`task-start.service.ts:43-47`, TASK_2026_471).
  - `TaskWriterService.updateStatus` writes the status unconditionally, with no
    expected-status precondition (`task-writer.service.ts:492-497`). A host
    write racing the orchestrator could regress `in_review`/`done` to
    `in_progress`. `TASK_CONFLICT` only guards the writer's own read -> write
    window (`:155-159`).
- The requirement says "at most backlog -> in_progress", so zero automatic
  status writes satisfies it.
- Reversible: a later task can add a compare-and-set `expectedStatus` to
  `updateMetadata` and a rule "first primary link of a backlog task".

## D7. Session card shows the linked task and todo progress

- The card already shows live todos from the tab stream
  (`compact-session-card.component.ts:362-379`) and the git stats from
  `SessionGitStatsStore` (`:49-51, 391-400`). That store is NOT edited (owned
  by `feat/session-git-view`).
- New webview store `SessionOrganizationCache` (chat lib, providedIn root):
  `organizationFor(sessionId): Signal<SessionOrganizationSummary | null>`.
  - It reads the loaded `chatStore.sessions()` row first (as
    `SessionOrganizerService.rowFor`, `session-organizer.service.ts:126-129`).
  - Otherwise it does one `session:getOrganization` per session id. The cache
    is bounded at 64 entries, LRU, with no timer.
  - It re-reads on `session:organizationChanged` for a cached id, called from
    `ChatMessageHandler` (no separate listener, per the MESSAGE_HANDLERS rule).
  - When `chatStore.organizationAvailable` is false (VS Code), it fetches nothing.
- The card passes `linkedTask = primary task {taskId, missing} | null` to the
  presentational `compact-session-activity` and `compact-rail-card` (chat-ui)
  as a new input.
- The card's todo value is the webview `known` state when present. Otherwise
  it uses the host snapshot `organization.todos` mapped to `CompactTodoState`
  (`compact-session-metrics.ts:10-18`).
- The same cache is the git-view contract (see `contract-for-git-view.md`).

## D8. File-size discipline and placement

- The pure rules go in `session-organization/src/lib/auto-link/task-link-rules.ts`:
  `decideTaskLink`, the rank table, `parseOrchestrateTaskId`,
  `taskIdsInWorktreeName`.
- The event wiring and evidence gathering go in `session-auto-link.service.ts`
  (subscriptions, the parked map, task existence, reconcile).
- Todo capture goes in `session-todo-progress.service.ts`. It is a separate
  responsibility.
- The two 0063 tables go in their own store, `session-auto-link.store.ts`.
- The main store gets only by-id reads that the rules need (`getOrganization`,
  `listChildIds`, `listWorktreePeers`). The main service gets: `runCapture`
  made public as `commitCapture` (it returns the outcome), suppression on
  unlink, clearing on a protected link, the cascade into the new store, and
  merging todos into `queryWorkspace`.
- Atomicity across the two stores is replaced by ordering (D1 tombstones). A
  failed second-store delete/rekey is logged. An orphan todo/suppression row
  for a deleted session is never read, because every read joins live sessions
  through metadata or links.

## D9. Reconcile trigger and cost bound

- The auto-link service listens to `SessionOrganizationService.onDidChange`
  (reasons `capture` and `user`; `delete` is ignored). For each named session
  that has an organization row in that root, it runs R4 to R7. It then
  reconciles that session's children (R6) and worktree peers (R5) one level
  deep. Further depth happens only through their own change events, which fire
  only when a write happened. So the cascade ends: every rule is idempotent
  (D1 properties).
- Per session, a reconcile already in flight sets a dirty flag. One more run
  follows. There are no timers.
- Positive task-existence results are cached (bounded at 256). A negative
  result is not cached, because the folder may be created later.

## D10. Things deliberately left out

- No new RPC method, no new push type, no new platform-core port. The existing
  ports cover the file reads, and the existing RPCs carry the data.
- No change to the MCP tool surface, and no change to `SESSION_TASK_ID_PATTERN`
  (3-digit sequence). Its mismatch with `\d{3,}` is noted for a later task.
- VS Code: session organization stays unregistered
  (`apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`).
  Its webview gets `organizationAvailable: false`, and the new cache does nothing.
- (Superseded by RR1-8: the task-id pattern is now unified in this task.)

---

# Review round 1 (plan-review.md, codex cross-family review)

Each finding was checked against the cited lines before it was resolved. The
orchestrator's verdict is in brackets. RR1-n overrides any earlier D-section
that it contradicts.

## RR1-1 [ACCEPT, blocker]: order dependence and stale auto links

- Verified: R4 and R5 shared the `worktree` rank (D1). The store only demotes
  a primary when a new one is written, and it upserts; nothing removes a link
  whose evidence is gone (`session-organization.store.ts:784-799`
  `writeTaskLink`, `:244-254` `demoteOtherPrimary`/`upsertTaskLink`).

### New rank table

Lower wins. Rule ids are stored.

| Rule | Source | Rank | Protected | Evidence kept in `auto_evidence` |
| --- | --- | --- | --- | --- |
| R1 user | `user` | 0 | yes | none |
| R2 `ptah_session_start` / MCP link | `agent` | 1 | yes | none |
| legacy board | `board-start` | 1 | yes | none |
| R3 `/orchestrate` | `orchestrate` | 2 | no | none (event evidence, never expires) |
| R4 worktree or branch name | `worktree` | 3 | no | `worktree_path` + NUL + `branch` at decision time |
| R5 worktree peer | `worktree` | 4 | no | the worktree path |
| R7 fork | `inherited` | 5 | no | the fork source session id |
| R6 parent | `inherited` | 6 | no | the parent session id |

R4 is evaluated, and when it yields an id R5 is not considered. Even when both
yield ids, R4 ranks strictly better, so the result does not depend on order.

### Rule ownership is stored

Migration 0063 adds two nullable columns to `session_task_links`:
- `auto_rule TEXT`, one of `R3`, `R4`, `R5`, `R6`, `R7`;
- `auto_evidence TEXT`.

Because they are columns of the link row, the existing rekey and delete SQL
moves and removes them in the same statement (`store.ts:751-758`
`moveTaskLinks`/`deleteAllTaskLinks`), with no new cascade code. A protected
write sets both columns to NULL. That is how a user or agent write "adopts" a
link and freezes it.

### Full reconcile replaces the incremental decision

Pure function:

```
planAutoLinks(current: StoredTaskLink[], suppressed: Set<string>,
              desired: AutoCandidate[]): TaskLinkWrite[]
```

- `current` includes `role`, `source`, `autoRule`, `autoEvidence` and `createdAt`.
- `desired` is the complete set from R4-R7 computed from current evidence.
- R3 rows are carried over from `current`. R3 evidence is the prompt event,
  which cannot "vanish".

Steps:

1. Protected rows are never written. A suppressed task is never in the output
   set.
2. Automatic rows with rule R4-R7 that are not in `desired` (same task, same
   rule) are deleted. Their evidence vanished: a worktree rename, a parent
   primary change, or a peer set that became ambiguous.
3. Candidates = R3 rows ∪ `desired`, minus protected tasks and suppressed
   tasks. A task with several candidates keeps its best rank. Sort by rank,
   then `createdAt` (R3 only; it is stable once stored), then `taskId`. This
   makes the order total.
4. If a protected primary exists, every candidate is `related`. Otherwise the
   first candidate whose rule asks for `primary` (R3, R4, R5, and an R7 copy
   of a primary) becomes `primary`, and every other candidate becomes `related`.
5. The output contains only the row writes that differ from `current`:
   insert, delete, or a role/source/rule/evidence change. Writes run in one
   transaction; the store's demote-then-write keeps the partial unique index
   satisfied.

R3 itself is applied by inserting an R3 row and then running the same
reconcile, so there is one decision path.

Properties pinned by tests:
- Idempotence: a second run produces no writes.
- Order independence: any permutation of the triggers gives the same final rows.
- Stale removal.
- Protected and suppressed rows are never written.

Equal-rank R3 conflicts resolve by the earliest stored `createdAt`. That is
"first `/orchestrate` wins", and it is stable after the rows exist.

Required tests:
- R5-then-R4 and R4-then-R5 give the same result.
- Late peer ambiguity: a second peer task appears, so the R5 link is removed.
- Worktree rename or branch change, so the old R4 link is removed and the new
  one added.
- The parent changes its primary, so the child's R6 link follows.
- The fork source changes, so the R7 links follow.
- The user adopts an auto link (link with `user`): it is never removed by a
  later reconcile.

## RR1-2 [ACCEPT, blocker]: first prompt before SQLite opens

- Verified: the capture pipeline drops a write while the store is closed
  (`session-organization.service.ts:771-774`). Electron starts capture before
  the store opens (`service.ts:5-11`). The store exposes `onDidOpen`
  (`session-organization.store.ts:459`).
- Decision: `SessionAutoLinkService` keeps an in-memory first-turn queue
  `Map<sessionId, {taskId}>` (ids only, cap 64, evict the oldest with one log
  line, no timer). A validated R3 candidate (regex match plus `task.md` exists)
  is queued when either the metadata or the store is not ready. It is replayed:
  - on `SessionIdResolved` for that real session id, when the store is open;
  - on `store.onDidOpen`, for every queued id whose metadata now exists.
    Entries whose metadata is still missing stay queued for their resolve.

  Session ids whose `SessionIdResolved` arrived while the store was closed are
  kept in a second bounded set (cap 256), and are reconciled (D4 worktree
  detection plus R4-R7) on open.
- Tests:
  - prompt, then resolve, then open (one link);
  - prompt, then open, then resolve;
  - resolve, then prompt, then open;
  - reload during the closed window: the webview holds nothing, so the same
    link results;
  - restart before open: the queue is lost, but the session's next resume
    triggers reconcile (RR1-6). R3 itself is not recoverable then. This is
    documented: the prompt event is gone, and manual link remains.

## RR1-3 [ACCEPT, blocker]: one transaction for side tables

- Verified: `rekeySession` runs all statements in one `db.transaction`
  (`store.ts:709-735`), and so does `deleteSession` (`store.ts:668-682`).
  Both stores use the same `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, so
  statements from both join one better-sqlite3 transaction.
- Shape: the main store gets an injected participant (token
  `SESSION_ORGANIZATION_TOKENS.SIDE_TABLES`, optional). It is implemented by
  `SessionAutoLinkStore`:

  ```ts
  interface SessionOrganizationSideTables {
    /** Workspace roots that hold rows of `sessionId` (joins the rekey root query). */
    rootsOf(sessionId: string): string[];
    deleteSession(root: string, sessionId: string): number;   // rows removed
    rekeySession(root: string, oldId: string, newId: string): void;
    suppress(root: string, sessionId: string, taskId: string, now: number): void;
    clearSuppression(root: string, sessionId: string, taskId: string): void;
  }
  ```

  "Caller owns the transaction" applies to every method, as for
  `applyPatch`/`writeTaskLink` today (`store.ts:770, 785`). The main store
  calls them inside its existing transactions:
  - `deleteSession`: delete the side-table rows, then the 0050 rows;
  - `rekeySession`: merge the roots, then `rekeyInWorkspace` plus the side-table
    rekey per root;
  - `unlinkTask(..., {suppress: true})`: suppress and delete in one transaction;
  - `writeTaskLink` with a protected source: clear the suppression in the same
    transaction.

  This adds roughly 30 lines to the main store; all SQL for the new tables stays
  in the new store. The service no longer touches the auto store for
  cascade/override bookkeeping, which removes the D8 ordering workaround. D8's
  "atomicity replaced by ordering" is withdrawn. Todo snapshot upserts also run
  inside the store transaction that ensures the organization row, via the
  auto store's caller-owned method called from a main-store transaction helper
  `withTransaction(fn)` (the one new public method, documented "lib-internal").
- Tests (real SQLite):
  - inject a throwing participant at each call site: in `deleteSession`, in
    `rekeySession` (first root, then second root), in `unlinkTask`'s suppress,
    and in a protected link's clear;
  - after each failure, all four tables are byte-identical to the state before.

## RR1-4 [REJECT, major]: unsent board prompt lost on reload

- The finding is verified as fact: the prefill is one-shot
  (`app-state.service.ts:460-465, 1407-1423`), and drafts are in-memory
  (`composer-draft.store.ts:19-51`).
- Rationale for rejecting it:
  - Before the first send no SDK session exists, so there is no link to lose.
  - The board start is one click to repeat, and it recreates the same prompt.
  - Persisting composer drafts is owned by the composer, not by this task.
- D2's wording was corrected so the claim is exact.

## RR1-5 [ACCEPT, major]: subagent expansion

- Verified: the expansion handler forwards with no `agent_id` check
  (`user-prompt-expansion-hook-handler.ts`, `notifyAll` block). The submit
  handler does check it (`user-prompt-submit-hook-handler.ts:80-83`).
- Decision: `UserPromptExpansionPayload` gains `readonly agentId?: string`,
  populated like the other two payloads (non-empty only). R3 ignores an
  expansion that carries an `agentId`.
- Assumption: the SDK's expansion hook input exposes `agent_id` like the submit
  input (`input.agent_id` is read at `user-prompt-submit-hook-handler.ts:81`).
  Check: typecheck. If the expansion input type lacks it, narrow with an `in`
  guard; do not use a cast.
- Test: a subagent-only expansion gives no link.

## RR1-6 [ACCEPT, bounded]: existing sessions and late task folders

- Resume or restart: `SessionIdResolved` also fires on resume
  (`sdk-agent-adapter.ts:1460-1469`). The reconcile (D4 worktree detection plus
  R4-R7) runs on every resolve, for new and resumed sessions alike, so a
  pre-existing session is reconciled when it is next used after a restart.
  There is no full-history scan at startup.
- Late task folders: subscribe (optional injection) to
  `TaskIndexService.onDidChangeIndex` (`task-index.service.ts:51-57, 129-142`;
  token `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE`).
  - For each event with reason `watcher` or `write`, and for each folder name
    that matches the shared task-id pattern exactly (RR1-8), select at most 50
    sessions of that `workspaceRoot` whose `worktree_path` or `branch` contains
    that exact id (`instr()`, scoped by the
    `(workspace_root, worktree_path)` index prefix, `LIMIT 50`). Reconcile
    them, then re-check the exact token boundaries in `taskIdsInWorktreeName`.
  - `reindex` events (empty `folderNames`) are ignored.
- Dependency: `@ptah-extension/session-organization` imports
  `@ptah-extension/task-specs` (type:feature to type:feature is allowed,
  `eslint.config.mjs:415-423`). task-specs depends on neither
  session-organization nor agent-sdk (`task-specs/src/index.ts:1-9`), so there
  is no cycle. Declare it in the lib's tsconfig/package references as the
  existing deps are.
- Tests:
  - restart with pre-existing metadata and an organization row in a named
    worktree, then a resume resolve: the R4 link is made;
  - a task folder created after the first reconcile, then an index `watcher`
    event: the link is made;
  - a `reindex` event triggers no reads.

## RR1-7 [ACCEPT, major]: 0062 spec pins the maximum version

- Verified: `0062_provider_account_operation_host.spec.ts:51-60` asserts
  `Math.max(...) === 62`.
- Decision: the 0062 spec keeps only its relative registration (62 directly
  after 61). The new 0063 spec asserts that 63 directly follows 62 and is the
  maximum, and checks the schema (both tables, the two new columns, the index)
  and idempotence.

## RR1-8 [ACCEPT, major]: one task-id pattern

- Verified: MCP uses `/^TASK_\d{4}_\d{3}(_[0-9a-f]{4})?$/`
  (`session-tool-args.schema.ts:24, 45`); the allocator allows `\d+`
  (`id-allocator.ts:16`).
- Decision: add `TASK_ID_PATTERN = /^TASK_\d{4}_\d{3,}(?:_[0-9a-f]{4})?$/`,
  `TASK_ID_TOKEN_SOURCE` (the unanchored source used by the rules with explicit
  boundaries), and `TaskIdSchema = z.string().max(64).regex(TASK_ID_PATTERN)`
  in `libs/shared/src/lib/types/task-id.schema.ts`. Zod already lives in
  shared: `task-view.schemas.ts:9`. Export them from the shared index.
  - `SESSION_TASK_ID_PATTERN` is replaced by `TASK_ID_PATTERN` (no other user
    exists; replace, do not alias).
  - The host rules build their regexes from the shared source.
- Tests:
  - shared spec: `TASK_2026_1234` and `TASK_2026_1234_ab12` accepted;
    `TASK_2026_12`, `TASK_2026_123_AB12` and `task_2026_123` rejected;
  - `session-tool-args.schema` spec accepts `TASK_2026_1234`;
  - `task-link-rules` spec: R3 and R4 accept `TASK_2026_1234`.

## RR1-9 [ACCEPT, minor]: guards and contract

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`
  (compose at `:89-114`): assert that `SessionAutoLinkService`,
  `SessionTodoProgressService` and `SESSION_ORGANIZATION_TOKENS.AUTO_LINK_STORE` /
  `SIDE_TABLES` are not registered.
- The chat spec for `SessionOrganizationCache` asserts that no
  `session:getOrganization` call is made when `organizationAvailable` is false.
- The RPC Zod guards stay as they are (`session-organization-rpc.schema.ts:69-73, 96-102`).
  TodoWrite input keeps its Zod parse (D5).
- `contract-for-git-view.md`: `worktreePath: null` means "unknown OR workspace
  root". Failed or not-yet-run detection also leaves it null, so consumers keep
  their own fallback rule.

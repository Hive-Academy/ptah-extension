# Implementation Plan - TASK_2026_854_52e8 (revision 2, after review round 1)

Automatic, deterministic links between chat sessions, registry tasks, worktrees
and agent todos. They are computed on the host, persisted in SQLite, and manual
link/unlink stays as an override.

The precedence table and every decision with evidence are in `decisions.md`.
**Review round 1 (RR1-1..9) overrides D1-D10 where they differ.** This plan
names components, contracts, files and tests; it does not restate those
decisions.

## Mandatory rules for every implementer and lane (repeat them in lane prompts)

- Work only in the worktree
  `D:\projects\ptah-extension\.claude-worktrees\feat-session-auto-links-6e9899b8a83f`.
- Verify with `npm run verify -- -p <changed projects>` only. Never run
  workspace-wide checks, `nx run-many` over unchanged projects, or the `build`,
  `serve`, `dev`, `e2e` or `package` targets. For tests use
  `npm run verify -- -t test -p A,B` and confirm the header says
  "Running target test for N projects".
- Update the DI and RPC guard specs whenever you register services or RPC
  methods. This plan adds no RPC method; see component 15.
- A new host capability is a port in platform-core. None is needed here; the
  plan uses `IFileSystemProvider`.
- Validate with Zod at every boundary: hook payloads, RPC params and MCP args.
- No `any`, no `as unknown as`.
- Backend libs log through the injected `IOutputChannel` with the
  `[SessionOrganization]` prefix, never `console`.
- Import only from lib public index aliases (`@ptah-extension/*`).
- Electron first. Keep VS Code and CLI compiling, and run their typecheck and
  tests when a shared lib they depend on changes.
- Do not edit `libs/frontend/git-ui/**`,
  `libs/frontend/chat/src/lib/services/session-git-stats/**`,
  `libs/frontend/chat-ui/src/lib/organisms/display-panel/**`,
  `libs/frontend/chat-ui/src/display-panel.ts`, or `.ptah/specs/**` of other tasks.

## Inputs and constraints

- Requirements used: `context.md` and `task.md` in this folder, the repository
  `CLAUDE.md`, and `plan-review.md` with the orchestrator verdicts on each
  finding.
- Corrections applied: `plan-review.md` findings 1-3 and 5-9 are accepted.
  Finding 4 is rejected; see RR1-4.
- Design handoff used: none. The UI additions are small and reuse the existing
  card and task-detail styles.
- Missing decision-critical input: none.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Link source and role tuples are the single vocabulary | `libs/shared/src/lib/types/session-organization.types.ts:34-43` | Append the three auto sources here |
| No CHECK constraints; reads are tolerant | `migrations/0050_session_organization.ts` header; `session-organization.store.ts:17-19, 62-65` | New source values need no schema change |
| Primary uniqueness: demote, then write | `session-organization.store.ts:13-16, 244-254, 784-799` | Reconcile writes go through `writeTaskLink` |
| Delete and rekey each run in one transaction | `session-organization.store.ts:668-682, 709-735, 741-765` | Side tables join those transactions (RR1-3) |
| Rekey moves link rows with `moveTaskLinks` | `session-organization.store.ts:751-758` | New link columns `auto_rule`/`auto_evidence` move with no new code |
| Caller-owned-transaction helpers exist | `session-organization.store.ts:770-799` (`applyPatch`, `writeTaskLink`) | The side-tables participant follows the same convention |
| Store open signal | `session-organization.store.ts:459` (`onDidOpen`) | Replay queued first-turn candidates (RR1-2) |
| Capture drops writes while the store is closed | `session-organization.service.ts:5-11, 757-786` | The auto-link service queues instead |
| Board prompt always starts `/orchestrate <taskId>` | `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:16, 144-163` | Host rule R3 replaces the webview pending map |
| `UserPromptSubmit` carries the prompt and the real id; `agent_id` marks subagents | `user-prompt-submit-hook-handler.ts:72-83, 122-127`; `user-prompt-submit-callback-registry.ts:8-13` | Add `agentId?` |
| Expansion fan-out has no `agent_id` check | `user-prompt-expansion-hook-handler.ts` (notifyAll block); `user-prompt-expansion-callback-registry.ts:8-15` | Add `agentId?` (RR1-5) |
| Metadata is created in `init` before `SessionIdResolved`; resume also notifies | `sdk-agent-adapter.ts:1460-1469, 1597-1635` | Reconcile on every resolve (RR1-6) |
| `PostToolUse` fan-out | `post-tool-use-hook-handler.ts:100, 332-363`; `post-tool-use-callback-registry.ts:8-17` | Todo capture, `agentId?` |
| TodoWrite item shape | `libs/shared/src/lib/type-guards/guards/exec.ts:70-78, 239-248` | Zod mirror |
| Metadata `workingDirectory` | `session-metadata-store.ts:182-186, 1546` | Worktree detection (D4) |
| FS port, bound on Electron and CLI | `file-system-provider.interface.ts:20-22, 71-74`; `platform-electron/src/registration.ts:113`; `platform-cli/src/registration.ts:66` | Existence check and `.git`/`HEAD` reads |
| Task index change event | `libs/backend/task-specs/src/lib/task-index.service.ts:51-57, 129-142`; token `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE` (`task-specs/src/lib/di/tokens.ts:27`) | Late task folders (RR1-6) |
| MCP task id is exactly 3 digits; the allocator allows more | `session-tool-args.schema.ts:24, 45`; `task-specs/src/lib/id-allocator.ts:16` | One shared pattern (RR1-8) |
| Zod already used in shared | `libs/shared/src/lib/types/task-view.schemas.ts:9` | `TaskIdSchema` lives in shared |
| The 0062 spec pins max version 62 | `0062_provider_account_operation_host.spec.ts:51-60` | Relax it (RR1-7) |
| Status writes are unconditional; the board delegates status | `task-writer.service.ts:492-497`; `task-start.service.ts:43-47` | No auto status (D6) |
| Change push is ids only; receivers re-read | `payload-map.ts:323-335`; `task-session-links.service.ts:38-66, 80-84` | Todos and links reuse it |
| `groupByTask` builds `TaskLinkedSession` | `session-organization-rpc.handlers.ts:322-347` | Add `todos` |
| Lib wiring | `session-organization/src/lib/di/register.ts`, `di/start.ts`; `apps/ptah-electron/src/di/phase-2-libraries.ts:421-422`; `cli-engine/src/lib/thoth/register-thoth-libraries.ts:164` | Host roots unchanged |
| VS Code composes without session organization | `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:89-114` | Assert the new tokens are absent (RR1-9) |
| Card todos and git, plus the chat-ui inputs | `compact-session-card.component.ts:244-246, 362-400`; `compact-session-activity.component.ts:867-872`; `compact-rail-card.component.ts:401-406` | `linkedTask` input |
| Exhaustive label map | `task-detail.component.ts:78-82` | Labels for the new sources |

## Architecture decision

- Chosen approach: host-side **full reconciliation** of a session's automatic
  links inside `@ptah-extension/session-organization`.
  - A pure `planAutoLinks` computes the complete desired automatic set from the
    current evidence (R4 > R5 > R7 > R6), keeps R3 rows, and removes automatic
    rows whose evidence vanished. It never touches protected or suppressed pairs.
  - Each automatic row records its owning rule and its evidence.
  - Triggers:
    - the prompt and expansion hooks (R3; queued until the metadata exists and
      the store is open);
    - `SessionIdResolved` (new or resumed);
    - the store's open signal;
    - the service's change event (lineage, worktree, links of parents and peers);
    - task index changes, limited to sessions whose worktree or branch names
      the new folder id.
  - Side tables (suppressions, todo progress) share the main store's
    transactions through a caller-owned participant interface.
- Rationale: the result depends only on the stored state and evidence, so it
  does not depend on event order. Every override is a row written atomically
  with the link change. Restart and resume are covered without a startup scan.
- Rejected alternatives:
  - Incremental `decideTaskLink`: order-dependent, and it keeps stale links (RR1-1).
  - Two independent stores with ordered writes: not atomic (RR1-3).
  - Full startup backfill: unbounded (RR1-6).
  - Persisting the tab-to-task pairing or composer drafts: rejected (D2, RR1-4).
- Assumptions:
  - A1: the first prompt hook may come before the metadata exists or the store
    opens. All orders are tested.
  - A2: `UserPromptSubmit.prompt` is the raw text. The expansion signal is the
    fallback.
  - A3: the Electron and CLI smoke compositions bind the FS port, the three SDK
    registries and (optionally) the task index service before
    `startSessionOrganization`. Check by running the smoke specs; stub in the
    spec only.
  - A4: migration version 63 is still free after rebase.
  - A5: the SDK expansion hook input exposes `agent_id` (RR1-5). Check:
    typecheck. If it does not, use an `in` guard.
- Effect on existing code:
  - The webview `BoardTaskLinkCaptureService` is deleted.
  - `SESSION_TASK_ID_PATTERN` is replaced by the shared `TASK_ID_PATTERN`.
  - The main store gains by-id reads, participant calls and the two link
    columns. The main service gains `commitCapture` and adopt/suppress
    plumbing. Everything else is unchanged.

## Component specifications

### 1. Shared vocabulary, wire types and task-id schema (`@ptah-extension/shared`)

- Purpose: the single definition of the new values, fields and the task-id
  grammar.
- Responsibilities:
  - Append `'orchestrate' | 'worktree' | 'inherited'` to `SESSION_TASK_LINK_SOURCES`.
  - Add `SessionTodoProgress { done; total; inProgress: string | null; updatedAt }`.
  - Add `todos: SessionTodoProgress | null` to `SessionOrganizationSummary` and
    to `TaskLinkedSession`.
  - Narrow `SessionLinkTaskParams.source` to `'user' | 'board-start'`.
  - NEW file `task-id.schema.ts`: `TASK_ID_PATTERN`, `TASK_ID_TOKEN_SOURCE`,
    `TaskIdSchema` (RR1-8). Export them from the shared public index.
- Verified contracts: `session-organization.types.ts:38-43, 117-133`;
  `rpc/rpc-session.types.ts:176-187, 225-234`; `task-view.schemas.ts:9`.
- Failure behaviour: not applicable.
- Verification seam:
  - `session-organization.types.spec.ts` pins the tuple;
  - new `task-id.schema.spec.ts` accepts `TASK_2026_123`, `TASK_2026_1234`,
    `TASK_2026_1234_ab12`, and rejects `TASK_2026_12`, `TASK_2026_123_AB12`,
    `task_2026_123`, and anything over 64 chars.
- Files:
  - MODIFY `libs/shared/src/lib/types/session-organization.types.ts` (+spec),
    `libs/shared/src/lib/types/rpc/rpc-session.types.ts`, the shared
    `src/index.ts` (or the types barrel that already exports
    `task-view.schemas`; follow that export path).
  - CREATE `libs/shared/src/lib/types/task-id.schema.ts` (+spec).
  - MODIFY `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts`
    (labels only, so tasks-ui keeps compiling).

### 1b. MCP session-start schema uses the shared task id (`@ptah-extension/vscode-lm-tools`)

- Responsibilities: replace `SESSION_TASK_ID_PATTERN` with `TASK_ID_PATTERN`
  from shared at `session-tool-args.schema.ts:24, 45`, and delete the local
  constant (there are no other references).
- Verification seam: the `session-tool-args.schema` spec accepts
  `TASK_2026_1234` and keeps rejecting `TASK_2026_12`.
- Files: MODIFY
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts`
  (+ its spec; create one next to it if none exists).

### 2. Migration 0063 (`@ptah-extension/persistence-sqlite`)

- Responsibilities:
  - Static SQL. The runner owns the transaction, so use bare ALTERs as in
    0060-0062.
  - `ALTER TABLE session_task_links ADD COLUMN auto_rule TEXT;`
  - `ALTER TABLE session_task_links ADD COLUMN auto_evidence TEXT;`
  - `CREATE TABLE IF NOT EXISTS session_task_link_suppressions (...)` with
    `PK(workspace_root, session_id, task_id)`.
  - `CREATE TABLE IF NOT EXISTS session_todo_progress (...)` with
    `PK(workspace_root, session_id)`.
  - `CREATE INDEX IF NOT EXISTS idx_session_org_worktree ON session_organization(workspace_root, worktree_path)`.
- Verified contracts: `migrations/index.ts` (last entry 62); bare-ALTER
  convention in the `0062_provider_account_operation_host.ts:20-30` header.
- Verification seam:
  - the new `0063_session_auto_links.spec.ts` checks that 63 directly follows
    62 and is the maximum, plus the columns, tables, index, and that the
    runner's ledger applies it once;
  - MODIFY `0062_provider_account_operation_host.spec.ts:51-60` so it asserts
    only 62-after-61 (RR1-7).
- Files:
  - CREATE `migrations/0063_session_auto_links.ts` (+spec).
  - MODIFY `migrations/index.ts` and `migrations/0062_provider_account_operation_host.spec.ts`.

### 3. Hook payload `agentId` (`@ptah-extension/agent-sdk`)

- Responsibilities: add `readonly agentId?: string` to
  `UserPromptSubmitPayload`, `PostToolUsePayload` and
  `UserPromptExpansionPayload`. Set it via a conditional spread only when
  `input.agent_id` is a non-empty string.
- Verified contracts: the three registries; handlers
  `user-prompt-submit-hook-handler.ts:79-83, 122-127`,
  `post-tool-use-hook-handler.ts:354-363`, and
  `user-prompt-expansion-hook-handler.ts` (notifyAll block).
- Verification seam: one test per handler spec. With `agent_id` the payload
  carries it; without it, the key is absent.
- Files: MODIFY the three registries, the three handlers and the three handler
  specs. Create `user-prompt-expansion-hook-handler.spec.ts` if none exists.

### 4. Auto-link rules, pure (`session-organization`)

- Responsibilities:
  - `AUTO_RULES = ['R3','R4','R5','R6','R7']`, the rank table (RR1-1) and
    `isProtectedSource`.
  - `planAutoLinks(current, suppressed, desired): TaskLinkWrite[]`: exactly the
    five steps of RR1-1. Output kinds:
    `{kind:'upsert', taskId, role, source, autoRule, autoEvidence}` and
    `{kind:'delete', taskId}`.
  - `parseOrchestrateTaskId(prompt)` (first non-blank line, input capped at
    64 KiB) and `parseOrchestrateExpansion(skillSlug, expansionType, commandArgs)`.
  - `taskIdsInWorktreeName(worktreePath, branch)`: distinct ids with boundaries.
  - All regexes are built from `TASK_ID_TOKEN_SOURCE`.
- Dependencies: `@ptah-extension/shared` only.
- Verification seam: table-driven spec (see the Test plan).
- Files: CREATE `libs/backend/session-organization/src/lib/auto-link/task-link-rules.ts` (+spec).

### 5. Git worktree reader (`session-organization`)

- Unchanged from revision 1. It reads `<cwd>/.git` (`gitdir:`) and
  `<gitdir>/HEAD` through `IFileSystemProvider`, caps reads at 4 KiB, returns
  null on any failure and never throws.
- Files: CREATE `libs/backend/session-organization/src/lib/auto-link/git-worktree-info.ts` (+spec).

### 6. Auto-link store = side-tables participant (`session-organization`)

- Purpose: all SQL for `session_task_link_suppressions` and
  `session_todo_progress`.
- Responsibilities:
  - Implements `SessionOrganizationSideTables` (RR1-3): `rootsOf`,
    `deleteSession`, `rekeySession` (suppressions: INSERT OR IGNORE, then
    delete the old row; todo: an existing new-id row wins), `suppress` and
    `clearSuppression`. These are caller-owned-transaction methods and never
    open a transaction themselves.
  - Reads: `listSuppressed(root, sessionId)` and `listTodoProgress(root)`.
  - Todo write: `upsertTodoProgressInTx(root, sessionId, progress): boolean`,
    also caller-owned; it returns false when unchanged.
  - `findSessionsNamingTask(root, taskId, limit = 50): string[]`
    (`instr(worktree_path, ?) > 0 OR instr(branch, ?) > 0`, scoped by root,
    `LIMIT`) (RR1-6).
- Verified contracts: same connection and `db` getter as the main store
  (`store.ts:29-39, 427-460`).
- Failure behaviour: throws. The surrounding transaction rolls back.
- Verification seam: a real-SQLite spec using the main store spec's harness.
- Files: CREATE `libs/backend/session-organization/src/lib/session-auto-link.store.ts` (+spec).

### 7. Main store and service changes (`session-organization`)

- Store:
  - Inject the participant with
    `@inject(SESSION_ORGANIZATION_TOKENS.SIDE_TABLES, { isOptional: true })`.
  - Inside the EXISTING transactions:
    - `deleteSession` calls `sideTables.deleteSession`;
    - `rekeySession` merges `sideTables.rootsOf(oldId)` into `rekeyRoots` and
      calls `sideTables.rekeySession` per root;
    - `unlinkTask(root, id, task, now, opts?: {suppress?: boolean})` suppresses
      in the same transaction;
    - `writeTaskLink` with a protected source calls `clearSuppression` and
      writes `auto_rule`/`auto_evidence` as NULL.
  - Extend `upsertTaskLink` SQL to set `auto_rule` and `auto_evidence` from
    `excluded`.
  - `StoredTaskLink` gains `autoRule: string | null` and `autoEvidence: string | null`.
  - New:
    - `getOrganization(root, id)`;
    - `listChildIds(root, parentId)`;
    - `listWorktreePeerPrimaries(root, worktreePath, excludeId)`;
    - `applyAutoLinkWrites(root, id, writes, now, todo?)`: one transaction that
      applies `planAutoLinks` writes through `writeTaskLink`/`deleteTaskLink`.
    - `upsertTodoProgress(root, id, progress, now)`: one transaction that
      ensures the org row and calls the participant's in-transaction upsert.
      This replaces the generic `withTransaction` mentioned in RR1-3; prefer
      these two named methods.
  - Target growth: about 70 lines. All SQL for the new tables stays in
    component 6.
- Service:
  - `runCapture` becomes the public `commitCapture` returning `CaptureOutcome`.
    It is lib-internal and not exported from the index.
  - `unlinkSessionTask` passes `{suppress: true}`.
  - `queryWorkspace` merges `listTodoProgress`.
  - `toSessionOrganizationSummary` maps `todos`.
  - No cascade code is added to the service; the store does it atomically.
- Verified contracts: `service.ts:149-171, 444-475, 539-560, 743-786`;
  `store.ts:467-502, 549-580, 638-682, 709-799`.
- Verification seam:
  - extend the store and service specs;
  - the failure-injection tests of RR1-3 (a throwing participant at each call
    site leaves all tables unchanged).
- Files: MODIFY `session-organization.store.ts` (+spec),
  `session-organization.service.ts` (+spec), `di/tokens.ts` (add
  `AUTO_LINK_STORE` and `SIDE_TABLES`).

### 8. `SessionAutoLinkService` (`session-organization`)

- Responsibilities:
  - `start()`/`dispose()`: synchronous and idempotent, using the capture
    service's release pattern (`capture.service.ts:98-142`).
  - Subscriptions:
    - the prompt-submit registry (skip `agentId`);
    - the expansion registry (skip `agentId`, RR1-5);
    - `SessionIdResolved`;
    - `store.onDidOpen`;
    - `service.onDidChange` (ignore `delete`);
    - optionally `TaskIndexService.onDidChangeIndex` (RR1-6).
  - R3:
    1. Validate the id (shared pattern) and check that `task.md` exists.
    2. If the metadata is missing or the store is closed, queue
       `{sessionId -> taskId}` (cap 64, evict the oldest and log).
    3. Otherwise insert the R3 row, then reconcile.
    4. Replay on resolve and on open (RR1-2).
  - Resolve (new or resumed):
    1. Drain the R3 queue for the id.
    2. Run worktree detection (D4); record only if there is no `worktreePath`.
    3. Reconcile.
    4. If the store is closed, add the id to the pending-reconcile set (cap 256)
       and drain it on open.
  - `reconcile(root, sessionId)`:
    1. Read the org row; skip when absent.
    2. Compute `desired`:
       - R4 from `taskIdsInWorktreeName`, with an existence check in the root
         and in the worktree, exactly one id;
       - R5 only when R4 is empty, from peers' protected or R3 primaries,
         exactly one distinct task;
       - R6 from the parent's primary;
       - R7 from the fork source's links.
    3. Commit `planAutoLinks` through `service.commitCapture`, which calls
       `store.applyAutoLinkWrites` (the suppressions are read in the same
       synchronous callback).
    4. Then reconcile the children and worktree peers one level deep.
    5. A per-session in-flight flag plus a dirty rerun prevents overlap.
  - Index event (`watcher`/`write` only): for each folder name matching
    `TASK_ID_PATTERN`, `findSessionsNamingTask(root, id, 50)`, then reconcile each.
  - Positive existence results are cached (bounded at 256).
- Dependencies, all injected by token with narrow `Pick<>` types: service,
  store, auto store, metadata reader, FS port, output channel, three SDK
  registries, and the optional `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE`. NEW lib
  dependency: `@ptah-extension/task-specs`. It is type:feature to type:feature,
  allowed by `eslint.config.mjs:415-423`, and there is no cycle. Add it to the
  lib's tsconfig references or `package.json` like the existing deps.
- Failure behaviour: every handler is wrapped and logs one line, never throws.
  The queues are bounded. No timers.
- Files: CREATE `libs/backend/session-organization/src/lib/session-auto-link.service.ts` (+spec).

### 9. `SessionTodoProgressService` (`session-organization`)

- As in revision 1, except that the write goes through
  `service.commitCapture`, then `store.upsertTodoProgress` (one transaction,
  RR1-3). It emits only when the progress changed.
- Files: CREATE `libs/backend/session-organization/src/lib/session-todo-progress.service.ts` (+spec).

### 10. Lib DI and public API (`session-organization`)

- `register.ts` runs only when the SQLite connection is registered:
  - register the `AUTO_LINK_STORE` singleton;
  - alias `SIDE_TABLES` to it with `useToken`;
  - register `SessionAutoLinkService` and `SessionTodoProgressService` as
    class singletons.
- `start.ts`:
  - start capture, then auto-link, then todo progress;
  - a failure in one is reported and the others still start;
  - dispose in reverse order.
- `index.ts`: export the new services and store, plus the `Pick` source types.
  Do not export the rule internals or `commitCapture`.
- Files: MODIFY `di/register.ts` (+spec), `di/start.ts` (+spec), `src/index.ts`,
  and `project.json`/`tsconfig*.json` only if the lib declares its deps there
  (check how `agent-sdk` is declared).

### 11. RPC handler: todos on `TaskLinkedSession` (`@ptah-extension/rpc-handlers`)

- Unchanged from revision 1: `groupByTask` adds `todos`. No new method and no
  schema change. The webview link sources stay `user`/`board-start`
  (`session-organization-rpc.schema.ts:69-73, 96-102`).
- Files: MODIFY `handlers/session-organization-rpc.handlers.ts` (+spec), and
  `handlers/session-rpc.handlers.ts` only if needed.

### 12. Remove the webview board pending map (`@ptah-extension/chat`)

- Unchanged from revision 1:
  - DELETE `board-task-link-capture.service.ts` (+spec);
  - MODIFY `task-prompt-bridge.service.ts` (+spec) and
    `chat-message-handler.service.ts` (+spec).
- The pre-send reload limitation is accepted (RR1-4). Do not add draft
  persistence.

### 13. `SessionOrganizationCache` and the card (`@ptah-extension/chat`, `@ptah-extension/chat-ui`)

- Unchanged from revision 1, with one addition: the cache spec asserts that no
  `session:getOrganization` call is made when `organizationAvailable` is false
  (RR1-9).
- Files:
  - CREATE `libs/frontend/chat/src/lib/services/session-organization/session-organization-cache.store.ts` (+spec).
  - MODIFY `compact-session-card.component.ts` (+spec), the chat-ui
    `compact-session-activity.component.ts` (+spec),
    `compact-rail-card.component.ts` (+spec) and `compact-session-metrics.ts` (+spec).
  - The `chat-message-handler.service.ts` push routing is shared with
    component 12. Put both in the same batch.

### 14. Task view todo progress (`@ptah-extension/tasks-ui`)

- Unchanged from revision 1. Files: `task-session-links.service.ts` (+spec),
  `task-detail.component.ts` (+spec) and `task-card.component.ts` (+spec).

### 15. Host guard specs (apps)

- Electron and CLI smoke specs:
  - the submit, expansion and id-resolved registries all have size > 0 after
    `startSessionOrganization`;
  - no `[SessionOrganization]` line is logged.
- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`:
  assert that `SessionAutoLinkService`, `SessionTodoProgressService`,
  `SESSION_ORGANIZATION_TOKENS.AUTO_LINK_STORE` and `.SIDE_TABLES` are not
  registered (RR1-9).
- No RPC method is added. Run `rpc-surface`, `surface-composition`, the
  allowlist and `expected-resolvable` as part of the app tests without editing
  them. If one fails, investigate; do not loosen it.
- Files: MODIFY `apps/ptah-electron/src/di/container.smoke.spec.ts`,
  `apps/ptah-cli/src/di/container.smoke.spec.ts` and
  `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`.

## Integration architecture

- Data flow, `/orchestrate` (board or typed):
  1. The submit or expansion hook fires (main thread only).
  2. The id is validated (shared pattern) and `task.md` must exist.
  3. If the metadata and the store are ready, insert the R3 row and reconcile.
     Otherwise queue, and replay on resolve or open.
  4. The change event fires, then the `session:organizationChanged` push, then
     the webview re-reads.
- Data flow, worktree: resolve (new or resume), then worktree detection,
  `recordWorktree`, the change event, a reconcile (R4/R5), and finally the
  peers are reconciled.
- Data flow, late task folder: the index `watcher`/`write` event, then
  sessions naming the id (bounded), then reconcile.
- Data flow, lineage: `recordAgentStartedSession`/`recordLineage`, then the
  change event, then a reconcile of R6/R7. A parent's change reconciles its
  children.
- Data flow, todos: `PostToolUse(TodoWrite)`, then one transaction (org row and
  progress) only on a change, then the push.
- State or persistence:
  - SQLite holds the links (with rule and evidence), the suppressions and the
    todo snapshots.
  - In memory: the R3 queue (≤ 64), the pending-reconcile ids (≤ 256), the
    existence cache (≤ 256) and the per-session flags. `dispose()` releases them.
- External boundaries:
  - Hook payloads: anchored regex with a length cap (prompt), Zod (todos), and
    `agentId` filtering.
  - A task id reaches the FS only after `TASK_ID_PATTERN`.
  - MCP `taskId` is checked by `TaskIdSchema`.
  - The RPC schemas are unchanged.
- Failure and rollback:
  - Every multi-table write runs in one transaction; a throw rolls back all of it.
  - While the store is closed, R3 candidates and resolved ids are queued, not
    dropped.
  - A restart before the store opens loses an unapplied R3 candidate. The
    state-derived rules re-run on the next resume; manual link remains.
  - FS errors produce no candidate.
- Observability: one `[SessionOrganization] autoLink|todoProgress ...` line
  per drop, eviction or failure, carrying the session id and rule id but no
  prompt text.

## Architecture-level quality requirements

- Functional:
  - The final automatic link set is a function of stored state and evidence
    only, so it is independent of order.
  - Protected and suppressed pairs are never written by an automatic rule.
  - Stale automatic links are removed.
  - Links, suppressions and todos survive recreating the stores and services.
- Performance:
  - No timers; all maps are bounded.
  - Reconcile does indexed by-id reads.
  - Each index event costs at most 50 sessions per folder.
  - There is no startup scan.
- Security: static SQL; one shared task-id grammar applied before any path
  join; no prompt text in logs.
- Maintainability:
  - The rules live only in `auto-link/task-link-rules.ts`.
  - All new-table SQL lives in `session-auto-link.store.ts`.
  - The main store and service grow only as listed in component 7.
- Testability: every row of the RR1-1 table and every RR1 test named below is
  a named test.

## Test plan

`task-id.schema.spec.ts` (shared) and the `session-tool-args.schema` spec: the
RR1-8 cases at both boundaries, including `TASK_2026_1234`.

`task-link-rules.spec.ts` (pure):

- Rank table complete; the protected set is exactly `{user, agent, board-start}`.
- `planAutoLinks`:
  - each RR1-1 step;
  - protected rows are never written;
  - suppressed tasks are never output;
  - an R4 row whose evidence changed is deleted and the new one added;
  - an R5 row is deleted when the peers become ambiguous;
  - an R6 row follows the parent's primary;
  - R7 copies the roles;
  - R3 rows are kept and the earliest `createdAt` wins primary;
  - an R4 candidate beats an existing R5 primary;
  - a protected primary turns every automatic row into `related`.
- Properties:
  - idempotence (the second run is empty);
  - all permutations of {R3, R4, R5, R6} triggers give identical rows.
- Parsers: the revision-1 cases plus `TASK_2026_1234`, and the subagent
  expansion is rejected (caller-level).

`session-auto-link.store.spec.ts` and `session-organization.store.spec.ts` (real
SQLite):

- Rekey moves suppressions, todos and `auto_rule`/`auto_evidence`; delete
  removes them all.
- Failure injection (RR1-3), where a throwing participant leaves all four
  tables unchanged:
  - in `deleteSession`;
  - in `rekeySession` (first root, then second root);
  - in `unlinkTask` suppress;
  - in a protected link's clear;
  - in the todo upsert.
- A protected write over an auto row nulls the rule (adoption).
- `findSessionsNamingTask` respects the root and the `LIMIT`.

`session-auto-link.service.spec.ts` (real stores and fake registries, FS and
index):

- R3 orderings:
  - prompt, then resolve, then open;
  - prompt, then open, then resolve;
  - resolve, then prompt, then open;
  - prompt after both are ready.
  - The queue evicts beyond 64.
  - A subagent submit and a subagent expansion are both ignored.
  - A missing `task.md` gives no link.
- Event-order pairs: R5 then R4 vs R4 then R5; R3 then R4 vs R4 then R3. The
  final rows are identical.
- Late peer ambiguity: the R5 link is removed.
- Worktree rename (`recordWorktree` with a new path or branch): the old R4 link
  is removed and the new one added.
- The parent changes its primary: the child's inherited link updates.
- The fork source changes: the fork's links update.
- Overrides:
  - the user unlinks, then every trigger replays: there is no relink;
  - the user relinks, then unlinks again;
  - the user demotes the auto primary: it is adopted and never re-promoted.
- Restart:
  - recreate everything over the same database, then replay all triggers: the
    rows are unchanged;
  - pre-existing metadata plus an org row in a named worktree with no link,
    then a resume resolve: R4 links.
- Late task folder: the folder is created after the first reconcile, then an
  index `watcher` event links it. A `reindex` event does no reads.
- Store closed at resolve: the id is queued, and the reconcile runs on open.
- Termination: one change event results in a bounded write count.

`session-todo-progress.service.spec.ts`: unchanged from revision 1, plus the
single-transaction behaviour.

Hook specs (agent-sdk): `agentId` present or absent, for all three payloads.

The migration specs, the RPC handler spec, the frontend specs (cache with no
RPC when unavailable, card, chat-ui inputs, tasks-ui) and the app guard specs
are as listed in each component.

## Team-leader handoff

- Recommended executors:
  - components 1, 1b, 2-11 and 15: `backend-developer`;
  - components 12-14: `frontend-developer`.
- Complexity: HIGH. A migration with ALTERs plus two tables, a
  transactional participant, full reconciliation with five triggers, the
  task-id unification across MCP, and frontend changes in three libs.
- Dependencies and ordering:
  - 1, 1b, 2 and 3 come first;
  - 4 and 5 before 8;
  - 6 before 7, and 7 before 8 and 9;
  - 10 after 8 and 9;
  - 11 after 7;
  - 15 after 10;
  - 12-14 need 1 (types) and, for end-to-end behaviour, 7-11.
- Batches (changed from revision 1; see "Batch boundary changes"):
  - **Backend A (foundation): components 1, 1b, 2 and 3.** Verify:
    `npm run verify -- -p @ptah-extension/shared,@ptah-extension/vscode-lm-tools,@ptah-extension/persistence-sqlite,@ptah-extension/agent-sdk,@ptah-extension/tasks-ui`.
  - **Backend B (session organization): components 4-11 and 15.** Verify:
    `npm run verify -- -p @ptah-extension/session-organization,@ptah-extension/rpc-handlers,ptah-electron,ptah-cli,ptah-extension-vscode`.
  - **Frontend C (pending-map removal plus the card and cache): components 12
    and 13.** Verify: `npm run verify -- -p @ptah-extension/chat,@ptah-extension/chat-ui`.
  - **Frontend D (task view): component 14.** Verify:
    `npm run verify -- -p @ptah-extension/tasks-ui`.
- Batch boundary changes against revision 1:
  - (a) Backend A adds component 1b (`vscode-lm-tools`), the new shared
    `task-id.schema.ts`, the expansion payload, and the 0062 spec edit.
  - (b) Component 13 moves from old batch D into batch C, because components
    12 and 13 both edit `chat-message-handler.service.ts`.
  - (c) Batch D now holds only tasks-ui.
  - (d) Backend B adds the `task-specs` dependency of session-organization and
    the VS Code unavailable-spec edit. `@ptah-extension/task-specs` itself is
    not modified, so it is not in any verify list.
- Parallel-safe work:
  - Frontend C can run in parallel with Backend A or B, because their files do
    not overlap. C typechecks against the new shared types only after A lands,
    so start C after A or stub nothing.
  - Frontend D must follow Backend A, which touches `task-detail.component.ts`
    labels.
- Files affected:
  - CREATE:
    - `libs/shared/src/lib/types/task-id.schema.ts` (+spec)
    - `libs/backend/persistence-sqlite/src/lib/migrations/0063_session_auto_links.ts` (+spec)
    - `libs/backend/session-organization/src/lib/auto-link/task-link-rules.ts` (+spec)
    - `libs/backend/session-organization/src/lib/auto-link/git-worktree-info.ts` (+spec)
    - `libs/backend/session-organization/src/lib/session-auto-link.store.ts` (+spec)
    - `libs/backend/session-organization/src/lib/session-auto-link.service.ts` (+spec)
    - `libs/backend/session-organization/src/lib/session-todo-progress.service.ts` (+spec)
    - `libs/frontend/chat/src/lib/services/session-organization/session-organization-cache.store.ts` (+spec)
  - MODIFY:
    - shared: `session-organization.types.ts` (+spec),
      `rpc/rpc-session.types.ts`, the shared index/barrel
    - vscode-lm-tools: `mcp-core/session-tool-args.schema.ts` (+spec)
    - persistence-sqlite: `migrations/index.ts`,
      `migrations/0062_provider_account_operation_host.spec.ts`
    - agent-sdk:
      `helpers/user-prompt-submit-callback-registry.ts`,
      `helpers/user-prompt-submit-hook-handler.ts` (+spec),
      `helpers/post-tool-use-callback-registry.ts`,
      `helpers/post-tool-use-hook-handler.ts` (+spec),
      `helpers/user-prompt-expansion-callback-registry.ts`,
      `helpers/user-prompt-expansion-hook-handler.ts` (+spec)
    - session-organization:
      `session-organization.store.ts` (+spec),
      `session-organization.service.ts` (+spec),
      `di/tokens.ts`, `di/register.ts` (+spec), `di/start.ts` (+spec),
      `src/index.ts`, and dependency declarations if required
    - rpc-handlers: `handlers/session-organization-rpc.handlers.ts` (+spec),
      possibly `handlers/session-rpc.handlers.ts`
    - chat: `chat-store/task-prompt-bridge.service.ts` (+spec),
      `chat-message-handler.service.ts` (+spec),
      `compact-session/compact-session-card.component.ts` (+spec)
    - chat-ui: `compact-session-activity.component.ts` (+spec),
      `compact-rail-card.component.ts` (+spec),
      `compact-session-metrics.ts` (+spec)
    - tasks-ui: `task-session-links.service.ts` (+spec),
      `detail/task-detail.component.ts` (+spec),
      `board/task-card.component.ts` (+spec)
    - apps: Electron and CLI `container.smoke.spec.ts`,
      `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`
  - DELETE:
    - `libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts` (+spec)
- Verification points:
  - The migration number is still 63 after rebase.
  - `planAutoLinks` matches RR1-1.
  - `SESSION_TASK_ID_PATTERN` has no remaining references.
  - `grep -r BoardTaskLinkCapture libs apps` is empty.
  - No `console` in backend libs, no `any`, no `as unknown as`.
  - The VS Code unavailable spec passes.
  - The four scoped `npm run verify` commands pass with the expected project
    counts.

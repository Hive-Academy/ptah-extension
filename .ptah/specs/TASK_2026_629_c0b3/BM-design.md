# BM design — Todos and Git +/- metrics (TASK_2026_629_c0b3)

Decision rows 6, 12 and 27 in `decisions.md`. Revised once per `BM-design-review.md` findings 1-7 and the orchestrator decisions.
Headline: **no new RPC, port or adapter is needed.** Todos come from tool inputs already in the tab, plus one retained
marker on `StreamingState`. Git +/- comes from the existing `git:info` RPC.

## 1. Sources found (Verified)

| # | Fact | Evidence | What it means for BM |
|---|------|----------|----------------------|
| S1 | `TodoWriteToolInput { todos: TodoItem[] }`, `TodoItem { content, status: 'pending'\|'in_progress'\|'completed', activeForm }`. `isTodoWriteToolInput` checks only that `todos` is an array | `libs/shared/src/lib/type-guards/guards/exec.ts:65-77, 239-248` | Reuse the types. Item validation must be added (review #3). |
| S2 | TodoWrite is rendered only per tool call. There is no session-level todo summary | `chat-ui/.../tool-execution/todo-list-display.component.ts:97`, `tool-output-display.component.ts:123-126` | Missing: a "latest TodoWrite of the session" selector. |
| S3 | Finalized turns: `ExecutionChatMessage.streamingState: ExecutionNode \| null` (a tree; tool nodes carry `toolName`, `toolInput`; agent nodes nest sub-agent tools) | `libs/shared/src/lib/types/execution/agent.ts:85-100`; walk pattern `chat-ui/.../compact-session-summary.ts:382-450` | Finalized inputs are in `tab.messages`. Skip `agent` subtrees. |
| S4 | Live turn: flat `StreamingState.events` (`tool_start` with `toolName`/`toolInput`). Streamed input is in `toolInputAccumulators` (`${toolCallId}-input`). `toolInputOf` resolves both and returns the raw input until it parses | `chat-types/src/lib/chat-types.ts:64-78`; `chat-ui/.../compact-session-summary-cache.ts:113-126` | Live input readable with the existing helper. |
| S5 | Live events carry `parentToolUseId` for sub-agent nesting | `libs/shared/src/lib/types/execution/stream.ts:83-86` | Live sub-agent TodoWrite must be excluded (review #1). |
| S6 | `StreamingState.events` is capped at `STREAMING_EVENT_CAP = 5000`. `setStreamingEventCapped` evicts the oldest events FIFO, `tool_start` included. It is the **only** writer of `events` (grep `.events.set(` → only `chat-types.ts:264, 288`) | `chat-types/src/lib/chat-types.ts:194, 246-289, 372-399` | A latest TodoWrite start can vanish. A marker written in this one function cannot be bypassed (review #2). |
| S7 | Finalized-tree retention caps `toolInput` entry by entry, smallest first (16 KB per input). A folded `todos` entry becomes a string or a failure marker | `chat-streaming/src/lib/execution-tree-retention.ts:76-84, 135, 355-401` | A folded list fails the item validation → unknown. |
| S8 | No trimming of `tab.messages` exists in chat-state or chat-streaming (grep for message-cap / `messages.slice(-` found none) | grep, both libs | The newest-first finalized scan sees every finalized turn the tab holds. History before a compaction reload is simply absent (→ "none"). |
| S9 | `git:info` → `GitInfoResult { files: GitFileStatus[], isGitRepo, statusUnavailable? }`. `GitFileStatus.additions?/deletions?: number\|null`, `binary?`, `isDirectory?`, `staged`. Under `statusUnavailable`, an empty list is NOT a clean tree | `libs/shared/src/lib/types/rpc/rpc-git.types.ts:18-46, 120-154`; `rpc.types.ts:1666` | The diff-stat source exists. A failure is unknown, never zero. |
| S10 | Backend: `git status` + staged and worktree `diff --numstat`. Untracked files are counted only up to `MAX_UNTRACKED_NUMSTAT_FILES = 200` and `MAX_UNTRACKED_NUMSTAT_BYTES = 1 MiB` each; beyond either cap the counts are null. Single-flight is per workspace path | `vscode-core/src/services/git-info.service.ts:264-267, 806-822, 967-1037, 3814` | The frontend sums. Null → `partial`. Distinct roots are NOT bounded by the backend (review #5). |
| S11 | `git:info` uses `resolveReadRoot`. That accepts a registered folder or a registered worktree of an open folder's repo. An unknown or removed root → the non-git default | `rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:203-221, 318-348`; spec `git-rpc.handlers.spec.ts:432` | Child worktrees work with no backend change. |
| S12 | Precedent: `ChangeSetStore` (debounce, freshness, generation, push reuse, `sameRoot`) and `ReviewWorktreeStatusService` call `git:info {workspaceRoot}` | `chat/.../change-set/change-set.store.ts:116-130, 520-533, 593-660`; `git-ui/.../review-worktree-status.service.ts:51-76` | Follow that pattern. Don't extend ChangeSetStore: it is change-set keyed and drops counts (`:155-181`). |
| S13 | `git:status-update` = `GitStatusUpdatePayload extends GitInfoResult` + `workspaceRoot?` (absent = active root). Several handlers may take one type | `shared/.../messages/git-status.ts:47-59`; `change-set.store.ts:263-268, 520-525` | Free refresh for watched roots. Worktrees get no push. |
| S14 | `session:turnEnded`/`turnFailed` payloads carry `sessionId` (the SDK id) | `message-constants.ts:146-148`; `change-set.store.ts:459-465` | Turn-end trigger. It must be mapped to tracked tabs. |
| S15 | Working dir: `TabState.agentOrigin?.worktreePath` (child); else the partition `workspacePath` from `findTabByIdAcrossWorkspaces` (null when no workspace is active); else `vscode.config().workspaceRoot` | `chat-types/src/lib/chat-types.ts:519-533, 538-563`; `chat-state/.../tab-workspace-partition.service.ts:23-30`; `change-set.store.ts:524` | Root resolution needs no new state. |
| S16 | Card metrics zone is persistent: `data-zone="metrics"` → `ptah-compact-session-stats` + the `contextPercent` span (row 4 pattern). The smart card feeds plain inputs. A zone with no data keeps its place and shows a placeholder | `chat-ui/.../compact-session-activity.component.ts:787-802, 823-826`; `chat/.../compact-session-card.component.ts` (`contextPercent`, `tabLookup`); `task-description.md:135` | Fixed todo and git slots, with an em dash (review #7). |
| S17 | Detail column: hardcoded `—` for Todos and Changes | `canvas/.../canvas-session-details.component.ts:52-65` | Replace both. |
| S18 | Canvas imports `@ptah-extension/chat` and `chat-ui`. Message handlers are registered in `apps/ptah-extension-webview/src/app/app.config.ts:219` | imports grep; app.config | Store registration point. |
| S19 | Prototype footer: `☑ done/total` + mini-bar, `ctx`, cost, `+add −del` (`git-add`/`git-del`) | `prototypes/shared.js:375-380` | Visual target. |

## 2. Data flow

### 2a. Todos (frontend; one marker in chat-types)
- **MODIFY** `libs/frontend/chat-types/src/lib/chat-types.ts`:
  - Add the optional field `latestTodoWrite?: { readonly toolCallId: string; readonly timestamp: number }` to `StreamingState`.
  - In `setStreamingEventCapped`, when `event.eventType === 'tool_start' && event.toolName === 'TodoWrite' && !event.parentToolUseId` and `event.timestamp >= (marker?.timestamp ?? -Infinity)`, set the marker. Eviction never clears it.
  - `createEmptyStreamingState` leaves it undefined.
- **CREATE** `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-metrics.ts`:
  - `export type CompactTodoState = { readonly kind: 'none' } | { readonly kind: 'unknown' } | { readonly kind: 'known'; readonly done: number; readonly total: number; readonly active: string | null }`
  - `export type CompactGitState = { readonly kind: 'none' } | { readonly kind: 'unknown'; readonly reason: 'unavailable' | 'failed' } | { readonly kind: 'known'; readonly additions: number; readonly deletions: number; readonly partial: boolean }`
  - `export function summarizeTodos(messages: readonly ExecutionChatMessage[], streaming: StreamingState | null): CompactTodoState`
  - `export function parseTodoList(input: unknown): readonly TodoItem[] | null`. Requires `isTodoWriteToolInput` AND, for every item: `status` is one of the 3 values, `content` is a string, `activeForm` is a string. Any failing item → null.
- Rules for `summarizeTodos`:
  1. **Live.** If `streaming?.latestTodoWrite` is set, it decides. Find its `tool_start` among the live `tool_start` events (sub-agent events, those with `parentToolUseId`, are never considered). Resolve the input with `toolInputOf(state, id, start?.toolInput)`. If the start was evicted, read the accumulator directly. `parseTodoList` failing (evicted with no accumulator, still streaming, partial JSON, malformed) → `unknown`. Never fall through to the finalized messages.
  2. **Finalized** (no marker). Walk `messages` newest-first. In each assistant tree, do a DFS that does not descend into `type === 'agent'` nodes and take the last `TodoWrite` tool node. The first one found decides: `parseTodoList` null (folded by retention S7, or malformed) → `unknown`.
  3. None found → `none`. `total === 0` → `none`.
  4. Known: `done` = completed count; `active` = the in_progress item's `activeForm || content`, else null.
- Export the types, `summarizeTodos` and `parseTodoList` from `libs/frontend/chat-ui/src/index.ts`.

### 2b. Git +/- (frontend store over the existing RPC)
working root (S15) → `SessionGitStatsStore.track(root, tabId)` → queued `git:info {workspaceRoot}` or the `git:status-update` push → `stateFor(root)` → `git` input → template.

- **CREATE** `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts`. `@Injectable({providedIn:'root'})`, implements `MessageHandler` for `GIT_STATUS_UPDATE`, `SESSION_TURN_ENDED`, `SESSION_TURN_FAILED`.
  - `track(root: string, tabId: string): () => void`. Keyed by normalized root (`sameRoot` rules, S12). Each root keeps `Set<tabId>` as its ref-count. The first tracker of a root requests a read. The release function removes the tabId. An emptied root drops its entry, its queue slot and its generation (an in-flight result is then discarded).
  - `stateFor(root: string | null): CompactGitState`. Reactive, from `signal<ReadonlyMap<string, CompactGitState>>`. Untracked or not-yet-read → `{kind:'none'}`.
  - `export function sessionWorkingRoot(tab: TabState, partitionPath: string | null, fallback: string | undefined): string | null` returns `agentOrigin?.worktreePath ?? partitionPath ?? fallback ?? null`.
  - **Mapping a turn end to roots.** Tracking is by `tabId`, so a draft with `claudeSessionId === null` can be tracked before it has a session. When a turn end arrives, the store resolves each tracked tabId with `TabManagerService.findTabByIdAcrossWorkspaces(tabId)?.tab.claudeSessionId` at that moment. Every root with a tab whose id equals `payload.sessionId` gets a forced read. No session id is cached, so later id assignment needs no update.
  - **Refresh triggers (only these; no polling):**
    1. First `track` of a root.
    2. `session:turnEnded`/`turnFailed` mapped as above.
    3. `git:status-update` for a matching tracked root (`payload.workspaceRoot ?? vscode.config().workspaceRoot`). Applied with no RPC. It bumps the generation (an in-flight read is discarded) and removes the root from the queue.
  - **Global concurrency:** `MAX_CONCURRENT_READS = 2`. A FIFO queue of roots, each root at most once (coalesced). A request for a root already in flight sets a single `rerun` flag, queued again when the read finishes. A 1 s debounce per root before enqueueing. Freshness 5 s skips a non-forced request. RPC timeout `15_000 ms` via `rpcCall(..., timeout)`. A finished read (ok, failed or timed out) frees its slot and starts the next queued root.
  - **Result → state:**
    - `!isGitRepo` (includes an unregistered or removed worktree, S11) → `none`.
    - `statusUnavailable` → `{kind:'unknown', reason:'unavailable'}`.
    - RPC failure or timeout → `{kind:'unknown', reason:'failed'}` + `console.warn`.
    - Otherwise `known`: sum `additions`/`deletions` over `files` with `!isDirectory`; a null count or `binary` sets `partial` and adds 0. Staged and unstaged rows are both summed.
    - **Old counts are never shown after a failure** (review #6). The next push or read replaces the unknown state.
  - DestroyRef clears the debounce timers and empties the queue. No interval exists.
- **MODIFY** `libs/frontend/chat/src/index.ts`: export `SessionGitStatsStore`, `sessionWorkingRoot`.
- **MODIFY** `apps/ptah-extension-webview/src/app/app.config.ts`: `{ provide: MESSAGE_HANDLERS, useExisting: SessionGitStatsStore, multi: true }` next to the ChangeSetStore line (`:219`).

### 2c. Presentation
- **MODIFY** `chat-ui/.../compact-session-activity.component.ts`:
  - Add `readonly todos = input<CompactTodoState>({kind:'none'})` and `readonly git = input<CompactGitState>({kind:'none'})`.
  - In the board layout metrics zone, render **fixed slots** in the prototype order: todos, context, (stats), git.
  - Todos slot: known → `☑ done/total` + a small `progress` (`aria-label="Todos"`, `title` = active text); none or unknown → `☑ —`, with `title` "No todo list" or "Todo list could not be read".
  - Git slot: known → `+a −d` (mono, `text-success`/`text-error`, `aria-label="Uncommitted lines added and removed"`; partial → a trailing `+` and `title="Some files could not be counted"`); none → `—`; unknown → `—` with `title="Could not read git status"`.
  - The context slot follows the same rule: `Context —` when null (task-description.md:135). Keep `shrink-0` so the stats line truncates first.
- **MODIFY** `chat/.../compact-session-card.component.ts`:
  - `todos = computed(() => summarizeTodos(this.messages(), this.sampledStreaming()), {equal})`. This uses the existing 500 ms sampler, so the cost is at most one event walk per sample.
  - `gitRoot = computed(() => sessionWorkingRoot(this.tab(), this.tabLookup()?.workspacePath ?? null, vscode.config().workspaceRoot))`.
  - An `effect` that calls `store.track(root, tabId)` and releases it in `onCleanup`; this also runs on root or tab changes and on destroy.
  - `git = computed(() => store.stateFor(gitRoot()))`. Bind `[todos]`, `[git]`.
- **MODIFY** `canvas/.../canvas-session-details.component.ts`:
  - Todos row: `done/total` + the active text (truncate, title).
  - Changes row (title "Uncommitted changes"): `+a −d`.
  - `—` for none or unknown, with the same titles.
  - Same `summarizeTodos(tab.messages, tab.streamingState)`, and the same `track`/`stateFor` effect, with the root from `findTabByIdAcrossWorkspaces(tabId)?.workspacePath` and the same fallback.

## 3. New RPC / port?
**No.** `git:info` already returns numstat per file (S9, S10) and accepts worktree roots (S11). It is registered in the shared `rpc-handlers` lib, so the three platform adapters, the ports, the contract suite and `rpc.types.ts` are untouched. A shortstat-only RPC would be cheaper per call. But it would duplicate the status, worktree resolution and single-flight that `GitInfoService` owns, and the event-only triggers plus the 2-read cap bound the cost (R1).

## 4. Batch split (CLI lanes; memory-safe checks only, one heavy check at a time)

**BM1 — chat-types marker + chat-ui selector and slots** (frontend-developer, about 32 tool calls)
- MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts` + its streaming-cap spec (`chat-types.spec.ts` or the existing cap spec in that lib)
- CREATE `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-metrics.ts` + `compact-session-metrics.spec.ts`
- MODIFY `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` + `.spec.ts`, `libs/frontend/chat-ui/src/index.ts`
- Tests:
  - Marker: set by a top-level TodoWrite start; not by one with `parentToolUseId`; survives FIFO eviction past `STREAMING_EVENT_CAP`.
  - `summarizeTodos`:
    - Interleaved parent and sub-agent live TodoWrite → the parent's list.
    - **Cap eviction**: a newer TodoWrite whose start was evicted → `unknown`, while an older finalized list exists.
    - Partial streaming JSON → unknown.
    - Malformed items (bad status, missing content or activeForm) → unknown.
    - Folded input (string `todos`) → unknown.
    - Agent-nested finalized TodoWrite ignored.
    - done/total/active; empty → none.
  - Activity: fixed todo, context and git slots show `—` with the right titles for none and unknown; known values render; partial title.
- Checks:
  - jest on the changed specs (`-c libs/frontend/<lib>/jest.config.ts <spec> --coverage=false --maxWorkers=2`)
  - `npx nx typecheck @ptah-extension/chat-types`, then `@ptah-extension/chat-ui` (one at a time)
  - lint for both

**BM2 — git stats store + card wiring** (frontend-developer, about 38 tool calls; after BM1)
- CREATE `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts` + `.spec.ts`
- MODIFY `libs/frontend/chat/src/index.ts`, `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` + `.spec.ts`, `apps/ptah-extension-webview/src/app/app.config.ts`
- Tests (fake timers, mocked `rpcCall`):
  - Sum ignores directories and nulls and sets partial (including the null counts from the 1 MiB and 200-file caps).
  - Not-repo → none.
  - **Failure after success → unknown('failed') / unknown('unavailable'), then recovery** on the next push and on the next turn-end read.
  - **9 distinct roots tracked at once → at most 2 `git:info` in flight; all 9 complete; a duplicate request for a queued root is coalesced.**
  - A push for a tracked root costs no RPC and discards an in-flight read.
  - A turn end for a tab that was a draft at `track` time (id assigned later) reads its root.
  - Two tabs on one root → one read; releasing one keeps the root, releasing both drops it and discards the in-flight result.
  - `sessionWorkingRoot` precedence.
  - Card binds todos and git, and releases on destroy.
  - A spec asserting `SessionGitStatsStore` declares the three handled message types (the app.config line is reviewed by reading).
- Checks: jest on the two specs (`-c libs/frontend/chat/jest.config.ts ... --maxWorkers=2`), `npx nx typecheck @ptah-extension/chat`, `npx nx lint @ptah-extension/chat`. No app build or typecheck.

**BM3 — canvas detail column** (frontend-developer, about 15 tool calls; after BM2)
- MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts` + `canvas-session-details.component.spec.ts`
- Tests: known values; `—` + title for none and unknown; track released on destroy and on a tabId change.
- Checks: jest on the spec (`--maxWorkers=2`), `npx nx typecheck @ptah-extension/canvas`, `npx nx lint @ptah-extension/canvas`.

BM1→BM2→BM3 is sequential (each consumes the previous batch's exports). None touches chat-input, chat-view, canvas-tile or canvas.store (the other lane). The chat-types edit is confined to `StreamingState` and `setStreamingEventCapped`.

## 5. Risks and open questions (decided)
- **R1 cost.** Each `git:info` = `git status --untracked-files=all` + 2 `diff --numstat` + an operation read + up to 200 untracked reads of ≤1 MiB each. An unregistered worktree root adds `git worktree list` + commonDir. Reads happen only on first display, turn end, or never (push). The global cap of 2 bounds a 9-tile board to 2 concurrent git processes. *Accept.*
- **R2 freshness.** With no polling, a worktree's +/- updates at turn end, not mid-turn. Workspace roots also update on watcher pushes. *Accept (orchestrator decision 4+5).*
- **R3 accuracy.** The figure is HEAD vs. the worktree, from summed staged + unstaged numstat. That is approximate when a path has both, and it excludes commits the session already made. *Label it "uncommitted"; branch totals are out of scope.*
- **R4 shared roots.** Sessions in one workspace show the same +/- (decision 27: "the session's working directory"). *Accept.*
- **R5 TodoWrite only.** Other task-list tool names show `—`. `parseTodoList` is the single extension point. *Accept.*
- **R6 marker scope.** The marker lives on the turn's `StreamingState`. Once the turn finalizes, the finalized tree (S3) is authoritative. *Assumption:* finalizing replaces `tab.streamingState` with null and appends the message in the same tab update. BM1 checks this in the TabManager finalize path. If not, rule 1 still never shows an older list (it returns unknown).
- No user-reserved questions remain.

## 6. Orchestrator amendments (from BM-design-rereview.md, binding for the lanes)

- **A1 (rereview 2, compaction):** `compaction_complete` installs `createEmptyStreamingState()` and clears `latestTodoWrite` while `tab.messages` stays. Make the selector return unknown when a turn is live (tab streaming) and the marker is absent but the empty state came from a reset, OR carry the marker across the compaction reset until the turn is finalized. Pick the smaller safe option and test: live TodoWrite → compaction → older finalized list must NOT be shown as current. Also test same-id `tool_start` replacement in `setStreamingEventCapped` (the marker update runs before both the replace and the FIFO branches).
- **A2 (rereview 8, release/retrack):** the git store's completion guard compares the captured root-entry object identity (or a generation counter that is never reused), not a per-entry generation that restarts. Test: track → release → track again → the first read settles → it is discarded.

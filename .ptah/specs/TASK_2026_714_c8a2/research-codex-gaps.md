# Codex App Server gaps: rollback, file rewind, subagents

Task: TASK_2026_714_c8a2. Decision supported: can legacy paths A (Claude SDK + proxy) and B (`@openai/codex-sdk`) be deleted without losing history rewind, file rewind or subagents.

Versions checked: pinned 0.155.1 (`libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json`), local binary `codex-cli 0.163.0` (schema generated to a temp dir, no model call), latest release `rust-v0.164.0` (2026-10-23, `gh api releases/latest`). Schema line numbers below refer to the pinned `codex-app-server-protocol.schema.json` ("S:").

## Summary

| Gap | Verdict | Easiest solution |
| --- | --- | --- |
| 1 History rollback | Supported. The spike used the wrong method. | Use `thread/revert` (or `thread/fork` with `lastTurnId`). Small. |
| 2 File rewind | Not supported by Codex. Easy to add on the Ptah side. | Host-neutral pre-turn checkpoint in Ptah. Medium. |
| 3 Subagents | Supported (stable, on by default). Ptah only maps it to generic tool rows. | Map `collabAgentToolCall` and `subAgentActivity` to existing `agent_start` / agent-end events. Small to medium. |

## Gap 1: History rollback

**Verdict: supported.** `-32600` was a wrong call, not a missing capability.

### Evidence
- Spike 7e sent `thread/rollback` after a normal `thread/start`/`thread/resume`, got `RPC error -32600` plus a `deprecationNotice` (`spike-run-7e.json`, `notes`; `native-route-evidence.md:30`).
- In 0.155.1, `thread/rollback` is rejected with "paginated threads do not support thread/rollback" when `history_mode == Paginated` (`codex-rs/app-server/src/request_processors/thread_processor.rs` at tag `rust-v0.155.1`, lines 2359-2363; read via GitHub API). New non-ephemeral threads default to Paginated whenever the store supports paginated lists (same file, lines 1459-1461). A normal Ptah spike thread is therefore always paginated, so rollback is always refused. The handler also emits the deprecation notice first (lines 34-35, 811-824), which matches the observed `deprecationNotice`. The exact error text was not captured in the spike (only the code), so this is a strong inference, but it matches the source and T3's behaviour below.
- `thread/rollback` is marked "DEPRECATED ... will be removed soon" (S:23446). It is already removed in current main: README "Thread rollback" says it "has been removed from the API ... Use `thread/revert` for paginated threads" (`codex-rs/app-server/README.md`, section "Thread rollback", main). Verified by generating the 0.163.0 schema: `thread/rollback` absent, `thread/revert` present.
- `thread/revert` exists in the pinned schema (S:718 request, S:23380 `ThreadRevertParams {threadId, beforeTurnId}`; replaces durable history with the prefix before that turn, drops it and every later turn; S:23399 response; S:23431 `thread/reverted` notification at S:4697). No `experimentalApi` gate on it: `experimentalApi` is only needed for the items listed in the README (read state, user verification, etc.), and the pinned schema is generated without `--experimental`. It requires a paginated, non-ephemeral, loaded thread (`thread_processor.rs` main, lines 2206-2216: "ephemeral threads do not support thread/revert", "thread/revert only supports paginated threads").
- `thread/fork` has `lastTurnId` (inclusive, "referenced turn cannot be in progress", S:20931-21042) and `excludeTurns`. It creates a new thread id, leaving the original intact.
- The Codex TUI backtrack uses `thread/revert` with `before_turn_id` (`codex-rs/tui/src/app_server_session/history.rs:142-155`).
- T3 Code: `apps/server/src/provider/CodexThreadRevert.ts` pages `thread/turns/list` (desc) to find the first removed turn, then calls `thread/revert {threadId, beforeTurnId}`. T3 docs state paginated threads "reject `thread/rollback`" and that native `thread/fork` with inclusive `lastTurnId` is the viable branch path (`docs/orchestration-v2/thread-lineage-and-context-transfer.md`, lines 230-232). Their test asserts `thread/rollback must not be sent to a legacy Codex thread` (`CodexAdapterV2.test.ts`). A T3 fixture notes `thread/revert` needs a loaded thread, so a resumed thread must be `thread/resume`d first.
- `thread/revert` and rollback do not touch files: "This only changes persisted conversation history. It does not revert local file changes" (S:23382, S:23450).

### Easiest solution
- Rewind in place: `thread/turns/list` (desc) to map "rewind to user message N" to the Codex turn id, then `thread/revert {threadId, beforeTurnId}`; handle `thread/reverted` and re-read with `thread/turns/list`. Rewind as a branch (matches Ptah's existing `session:fork kind 'rewind'|'branch'`, `session-rpc.handlers.ts:1373`): `thread/fork {threadId, lastTurnId, excludeTurns:true}`.
- Size: about 100-150 lines in `libs/backend/codex-runtime` (two protocol client methods plus the turn-id mapping) and one adapter method behind the existing fork/rewind RPC. Remove `thread/rollback` from the required-method list in the manifest and parity gate; do not call it (gone in 0.163+).
- Caveat: the pinned 0.155.1 `thread/revert` replaces the runtime of a loaded thread (`thread_processor.rs` main, 2217-2260 shows the runtime snapshot/replace). Ptah must not hold in-flight turn state across it.

### Spike step (1 turn)
Fresh thread, 2 turns (`turn 1: say A`, `turn 2: say B`), `thread/turns/list` to get ids, `thread/revert {beforeTurnId: turn2}`, expect `thread/reverted`, `turns/list` shows one turn, then a third `turn/start` asking "what did I ask you before?" shows only turn 1 context. Also try `thread/fork {lastTurnId: turn1}`. Only the third turn is charged (two cheap setup turns can reuse run 7e style "reply OK"; about 12k tokens each, under 30k). Total about 3 turns; can be reduced to 2 by reusing the thread from the resume spike.

## Gap 2: File rewind

**Verdict: not supported by Codex App Server (any version through 0.164). Buildable in Ptah.**

### Evidence
- Pinned schema has no undo, ghost, snapshot-restore or file-restore method: grep for `ghost`, `undo`, `GhostSnapshot` finds nothing relevant; "snapshot" hits are rate-limit and connector snapshots only. Same on the generated 0.163.0 schema.
- Codex's ghost-snapshot/undo is legacy: `ghost_snapshot` config is "Compatibility-only ... so legacy settings still load" (`codex-rs/core/src/config/mod.rs`, `config_toml.rs`), rollout lines of type `ghost_snapshot` are skipped (`codex-rs/rollout/src/recorder.rs`, `thread-store/.../line_parser.rs`). No `Op::Undo` match in current source. There is no app-server surface for it.
- What the protocol gives: `item/fileChange` items with `changes[] {path, kind: add|delete|update(move_path), diff}` (S:21660-21698, S:11873, S:15725), `item/fileChange/patchUpdated`, and `turn/diff/updated` with a cumulative unified diff per turn (S:24848, S:5037). The diff source is `TurnDiffTracker`, which tracks `apply_patch` changes only (`codex-rs/core/src/turn_diff_tracker.rs`, imports `AppliedPatchChange`). Edits made by shell commands (`sed`, `echo >`, formatters, `git checkout`) are not in these diffs. A checkpoint built only from `fileChange`/turn diffs is therefore incomplete and would silently under-restore.
- Ptah's Claude path: native `Query.rewindFiles(userMessageId)` requires SDK file checkpointing and an active query (`libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts:184-262`, `session-lifecycle-manager.ts:151-159, 228`, `sdk-query-options-builder.ts:803`). The RPC is `session:rewindFiles` (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1438-1553`), returns `SessionRewindResult {canRewind, error?, filesChanged?, insertions?, deletions?}` (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:598-609`), and already has workspace path containment checks (`session-rpc.handlers.ts:1526`).
- T3 Code does not rely on Codex for file restore (its docs call rollback a conversation operation); I did not examine its checkpoint implementation, so treat that as unexamined.

### Easiest solution
A Ptah-owned, host-neutral turn checkpoint, independent of the model runtime:
1. On `turn/start` (or when the user message is sent), record a checkpoint keyed by `{threadId, userMessageId or turnId}`.
2. Snapshot method, in order of preference:
   - Git repos: a shadow tree using a temporary index (`GIT_INDEX_FILE=<tmp> git add -A && git write-tree`, with a dangling commit via `git commit-tree`) stored under `.git`-external refs or kept in memory/disk by Ptah. Restore with `git read-tree` plus `git checkout-index -a -f` for changed paths and deletion of files added since. Catches shell edits and untracked files; respects `.gitignore`.
   - Non-git folders: copy-on-first-change of files named by `fileChange` items plus a before/after `fs` stat diff of the cwd for shell commands (bounded by a size cap), or report `canRewind:false` honestly.
3. Return the same `SessionRewindResult` shape, applying the existing path containment check, so the front end needs no change.
- Size: about 250-400 lines plus tests; best placed in a small host-neutral lib or `libs/backend/codex-runtime` file calling `git` via existing process helpers; touches `session-rpc.handlers.ts` (route `session:rewindFiles` to the Codex runtime for Codex sessions) and the parity gate row `history-rewind`. This also works for Claude sessions as a fallback later, but that is out of scope.
- A `fileChange`-only checkpoint (reverse-apply `diff`) is smaller (about 100 lines) but is incomplete for shell edits; use it only as a documented reduced mode. Delete-kind diffs may not carry the removed content (unverified), another reason to prefer the git snapshot.

### Spike step (1 turn)
One turn: ask Codex to create `a.txt` via apply_patch and modify `b.txt` via a shell `echo >>`. Record `fileChange` and `turn/diff/updated` and check whether `b.txt` appears (expected: not). This proves the shell-edit gap and justifies the git snapshot. The checkpoint and restore itself needs no model call and can be unit-tested against a temp git repo.

## Gap 3: Subagents

**Verdict: supported (stable and on by default).** The "no subagent support" claim is wrong; the schema has subagent items and Ptah only translates them as generic tools.

### Evidence
- Items in the pinned schema: `collabAgentToolCall` (S:21855-21933) with `tool` in `spawnAgent, sendInput, resumeAgent, wait, closeAgent, sendMessage, followupTask, interruptAgent, listAgents` (S:8496), `status`, `prompt`, `model`, `reasoningEffort`, `senderThreadId`, `receiverThreadIds`, `agentsStates {status: pendingInit|running|interrupted|completed|errored|shutdown|notFound, message}` (S:8467-8494); and `subAgentActivity {agentPath, agentThreadId, kind: started|interacted|interrupted|completed}` (S:21940-21965, S:20185).
- Child threads: `Thread.parentThreadId` "only set if this thread is a subagent" (S:20463); `SubAgentSource` includes `thread_spawn {parent_thread_id, depth, agent_nickname, agent_role, agent_path}` plus `review`, `compact`, `memory_consolidation` (S:20194-20265, S:19703).
- Feature flags (`codex-rs/features/src/lib.rs`, main): `multi_agent` (Feature::Collab) `Stage::Stable, default_enabled: true`; `multi_agent_v2` Stable, default off; also `SubagentThreadEnvironments` etc. under development. T3 notes some models still use v1 (`collabAgentToolCall`) and v2 uses `subAgentActivity` (`apps/server/src/orchestration-v2/testkit/fixtures/index.ts`).
- The Codex TUI renders both through the app-server (`codex-rs/tui/src/multi_agents.rs`, `agent_status_feed.rs`, `thread_transcript/tools.rs`), so the data is sufficient for a UI. T3 maps `collabAgentToolCall` (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`).
- Ptah today: `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:324-345` maps `collabAgentToolCall` to generic `toolStarted`/`toolCompleted` with only `receiverThreadIds`, dropping `prompt`, `model`, `agentsStates`; `subAgentActivity` is not handled. The lane config sets `agents.enabled=false` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts:104`), so lanes currently disable it, which is a lane choice, not a protocol limit.
- Claude path today: a Task tool use becomes an `agent_start` event (`agentType`, `agentDescription`, `agentPrompt`, `agentId`, `parentToolUseId`; `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:251-269`, type in `libs/shared/src/lib/types/claude-domain.schemas.ts:93`), background agents via `background_agent_started` (`stream-background.ts:37`), plus controls `agent:backgroundList` and the interrupted-subagent context injector (`chat-session.service.ts:1020, 1372-1394`; `parity-inventory.md:57`).

### What "subagent parity" means
Minimum: (a) an agent card appears when Codex spawns a subagent, with description/prompt, model and live status, and finishes with completed/errored/interrupted; (b) the main chat is not corrupted by child-thread events; (c) interrupting the parent turn leaves no fabricated "running" card. Not required for first parity: Claude-specific background-agent output files, `agent:backgroundList` for Codex, resume-interrupted-subagent injection. Those are declared as an explicit reduction if the user agrees (`parity-inventory.md:57, 69`).

### Easiest solution
- In `codex-event-translator.ts`, map `collabAgentToolCall` with `tool in {spawnAgent}` to the same neutral agent-start/agent-end events the Claude path emits (`agentType` from model/role, `agentPrompt` from `prompt`, `agentId` from `receiverThreadIds[0]`, `toolCallId` = item id), and update card status from `agentsStates` on `item/completed`. Map `subAgentActivity` kind `started/completed/interrupted` the same way keyed by `agentThreadId`. Route notifications whose `threadId` differs from the main thread (or `parentThreadId` set) to the card, not the main transcript. Other `tool` values remain generic tool rows.
- Size: about 100-200 lines in `codex-event-translator.ts` (plus its spec) and a threadId filter in the notification router; no frontend change if the existing `agent_start` rendering is reused. Remove any code that forces subagents off for chat.
- Unknown to settle first: how child-thread notifications reach the parent connection. In the TUI, the app-server delivers them to the same client, but no source line settled whether a client must `thread/resume` the child to subscribe. See spike.

### Spike step (1 turn, within 30k tokens)
One turn with `multi_agent` default on: prompt "Spawn one subagent whose only job is to reply OK, wait for it, then say DONE." Capture: `collabAgentToolCall` `spawnAgent` started/completed, `subAgentActivity` (if v2), `thread/started` for the child (with `parentThreadId`), whether child `item/*` notifications arrive on the parent connection without extra requests, and final `agentsStates`. Cap with a small model and `reasoningEffort: low`; the token bound is the risk (a subagent doubles usage), so state the per-turn bound in the case and abort on exceed.

## Spike budget (8 turns left)
Gap 1 (revert and fork): 2-3 turns. Gap 2 (shell vs apply_patch diff coverage): 1 turn. Gap 3 (spawn): 1 turn. Total 4-5, leaving 3 spare.

## Decisions
- Treat `thread/rollback` as removed; the plan must use `thread/revert` and `thread/fork` (options: pin-and-use rollback on legacy threads, which needs `historyMode: legacy` and dies in 0.163+; rejected on evidence). Reversible.
- Do not recommend a `fileChange`-only checkpoint as the main design because `TurnDiffTracker` ignores shell edits.

## Unknowns
- Exact `-32600` message text in 0.155.1 was not logged; confirm in the Gap 1 spike by recording the error message.
- Whether the pinned 0.155.1 binary matches `main` for `thread/revert` loaded-thread requirements (T3 fixture says it needs a loaded thread). The spike settles it.
- Not examined: T3's file checkpointing; the Codex Python/TypeScript SDK; `codex-rs/exec` undo.
- Whether bumping the pin to 0.164.0 is acceptable; none of the three gaps requires it, since `thread/revert`, `thread/fork lastTurnId` and `collabAgentToolCall` are all in 0.155.1.

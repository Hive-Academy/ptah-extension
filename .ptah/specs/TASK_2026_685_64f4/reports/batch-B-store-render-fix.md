# B store and render final fix round

## Completed

- B1: replay treats root `agent_start` as a parent event. Added a multi-chunk replay spec with parent text, Task start, root agent start, parallel tool, later text, completion, and child output. The parent IDs remain in tab state; child IDs remain in scratch.
- N1 / M2: `retain` accepts the session ID, and an evicted terminal entry reopens pinned and finalized before a history load. Lane passes its session; bubble uses the monitor record's parent session or the active session as fallback. Missing session now sets a visible error instead of silently returning. Added a reopen spec.
- N2: reload replaces `clipped` and `truncated` from the current page result. The regression spec verifies a second clean load settles both fields and prevents a third fetch.
- N3: terminal records are remembered for late events; claim refinalizes after applying one. A terminal late-event spec checks `state === null` and `live === false`.
- M1: lane retention is keyed on a computed tool ID; record/session lookup is untracked within the retain effect. A record-replacement spec checks there is no release/re-retain during loading.
- M3: bubble displays loading, not-found, unresolved, and error text with Retry where appropriate. Missing-session errors are visible.
- M4: `$agents` now walks store trees from all spawned tool IDs, including background top-level agents and turns with zero foreground nodes. Added a background-parent nested-agent spec.
- M5: added per-key revision/entry reads; lane, bubble, tile, chips, and `$agents` subscribe to keys they use. `treeFor` no longer advances LRU read order on reactive renders; `retain` advances it on explicit view access. Existing global `entries` remains for other consumers.
- Minors: tile restores summary-first fallback and caps text activity at 240 characters; bubble uses singular `tool`; lane suppresses the finished summary when its tree renders the same output.

## Verification

`ptah_get_diagnostics` after edits reported no diagnostics in requested changed files. The scoped compiler also reported pre-existing errors in sibling files outside this batch. Per batch rules I ran no tests, typecheck, lint, build, serve, e2e, or package command. Team leader should run the changed-project test suites.

## Decisions

- The root `agent_start` stays in parent replay even with `parentToolUseId`, matching live claim and backend event shape. Alternative was to infer ownership from `parentToolUseId` alone; rejected by the replay shape. Reversible.
- Bubble session fallback uses the monitor record first and the active session second because no session input reaches this component through the current execution-node contract. Missing context becomes a visible error. Alternative was a broader input propagation outside batch ownership. Reversible.
- Per-key signals keep reactive reads local; explicit retain records LRU access. Alternative was a global store signal subscription for all views. Reversible.

## Deferred / residual risks

- Nested chips still depend on the parent execution entry being resident or loaded; after eviction, the existing in-place view shows its unavailable notice. A persistent nested-agent index would change scope and retention behavior.
- `$agents` still projects all turns when one referenced key changes; it no longer does so for every unrelated store publish. Further per-turn memoization needs a separate performance pass.
- The active-session fallback may not match a bubble rendered from a background tab if its monitor record is absent. In that case, the history RPC may return not-found or unresolved, both now visible.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B-store-render-fix.md`

# Batch B5b.4 — nested agent chips

## Completed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.ts` — added a pure, cycle-safe store-tree walker. Turn facts now append nested agent facts after top-level facts, retain the parent turn, and keep the first fact for each tool-call key.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-agent-facts.spec.ts` — added nested, nested-of-nested, repeated-key, cycle, absent-entry, and empty-turn cases.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` — expands each turn's roster keys from its agents' store trees, reads `entries()` for signal invalidation, and resolves nested agents in place from their parent store tree.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts` — added a case where an arriving store tree adds a nested chip and the bubble's lane request opens its in-place view and stored output.

## Evidence and risks

- The store exposes read-only `entries()` and `treeFor(key)` (`subagent-execution.store.ts:59-60,214-221`); the component reads the signal before traversing trees. Empty turns return before store access.
- `turnAgentKeysOf` reads the parent message tree (`transcript-turn-contexts.ts:117-140`). The new walker starts from those turn-scoped top-level keys, so nested keys stay with the spawning turn. A visited-key set prevents cycles; a visited-node set prevents repeated node traversal. The parent-tree fact wins when the store repeats its key.
- `laneKey` defines `sub:` and `bg:` prefixes (`compact-lane-rows.ts:25-43`); the component uses it for nested chip keys. In-place lookup searches the store tree when the parent message tree lacks the nested node.
- Scoped `ptah_get_diagnostics` reported **no diagnostics in the four requested files** after the final edit. It also reported 268 errors in sibling files in the chat project; these are outside this batch's ownership. No test, typecheck, lint, build, serve, e2e, or package command was run, as instructed for lanes. The team leader owns test execution.
- `collectTurnAgentFacts` has an optional `treeFor` input, preserving existing callers. The follow-up below wires its production caller to the store.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Share one pure store-tree walker between turn facts and visible chip keys. | Duplicate traversal / shared walker | Both paths need the same recursion, key cycle guard, and order; `transcript-agent-facts.ts` is already pure. | Yes |
| Resolve the store lazily from the component injector. | Eager injection / lazy resolution | Existing roster resolution is lazy, and turns without agent keys should not construct store dependencies. | Yes |
| Keep the fact collector's new `treeFor` input optional. | Required input / optional input | Its current caller is outside this batch; existing facts remain usable while the visible chip path receives the store function. | Yes |
| Keep the first top-level fact for a repeated tool-call key. | First / last | User required one fact per key with top-level precedence; pre-order traversal establishes the first occurrence. | Yes |

## Check fix

The team leader reported 63/63 passing tests across `transcript-agent-facts.spec.ts` and `chat-transcript.component.spec.ts` before this follow-up. This lane did not run tests, typecheck, lint, build, serve, e2e, or package commands.

Files written for the follow-up:

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.ts` — the reactive `$agents` facts read `entries()` and `treeFor(key)` through a lazily resolved store, so nested agents remain in the parent turn.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.spec.ts` — added a two-turn, store-update regression case and provided an injection context for the source's existing specs.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-turn-contexts.ts` — this helper does list a turn's roster keys; it now expands them from each top-level agent's store trees when given `treeFor`.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-turn-contexts.spec.ts` — added parent-turn nested keys, cycle, and empty-turn checks.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` — delegates chip-key expansion to `turnAgentKeysOf`, passing a callback that reads `entries()` only when a top-level agent exists.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B5b4-nested-chips.md` — updated this report.

Scoped `ptah_get_diagnostics` reports no errors in the five changed TypeScript files. It reports 268 errors in sibling chat-project files outside this batch. The team leader still needs to run the new and adjusted specs.

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Construct the host source in an injection context and resolve `SubagentExecutionStore` only from its store-tree callback. | Eager store injection / lazy injector lookup | `TranscriptDisplayFeed` constructs the source from a component field initializer; `collectTurnAgentFacts` invokes the callback only for turns with agents. | Yes |
| Expand nested roster keys inside `turnAgentKeysOf`. | Component-local expansion / helper expansion | The helper is the source of the visible chips' turn keys and already handles their parent-turn grouping. | Yes |

# Batch B5 chat fallout

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.ptah-ui.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\services\chat-store\session-loader.resync-live-seed.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B5-chat-fallout.md`

## Work and evidence

- Added a `SubagentExecutionStore` test provider to the execution-node suite with the store's `entries`, `treeFor`, `retain`, `release`, and `ensureHistory` interface. The tile-mode cases exercise `ExecutionNodeComponent` recursion and `SubagentTileComponent` count and fade behavior; their agent bubble is stubbed, so no execution tree is needed by these assertions.
- Updated the three R-F4 Task resync cases to assert the parent Task node remains in the tab's live tree while subagent starts and tails live in the real `SubagentExecutionStore`. Each tail is asserted once in its owner store tree and absent from the tab tree. The first case also verifies the owner finalizes once without copying its subagent text into the tab message.
- Scoped `ptah_get_diagnostics` found no errors in either changed file. It reported 268 errors in sibling chat project files. Per lane rules, I ran no test, typecheck, lint, build, serve, e2e, or package command; the team leader owns test execution.

## Decisions

- **Case (a), intended B4 ownership change.** The plan's component 8 says `StreamingHandlerService.processStreamEvent` must call `SubagentExecutionStore.claim` before tab resolution and claimed events must not mutate tab state. In source, `subagent-execution.store.ts:146-190` claims `message_start` with a parent tool ID and subsequent events by message owner; `streaming-handler.service.ts:211` returns immediately after a claim. `SessionHistoryReplayer` preserves seeded Task owners in tab state at `session-history-replayer.service.ts:340-454`. Therefore the old assertions expecting subagent events and text inside tab state were stale. Alternatives were changing session-loader production code or changing the spec; the spec change follows the plan and is reversible.

## Risks handled

- **Missing tile provider:** the mock satisfies every store member used by the tile or bubble and avoids the unrelated real-store dependency chain.
- **Task owner liveness:** assertions still require the owner root and Task tool node in the tab tree, plus finalization of the owner exactly once.
- **Nested and concurrent tails:** assertions inspect the outer owner store tree for the nested case and each separate store key for the two-owner case; each tail must occur once.
- **Unverified runtime:** lane rules prohibit tests. Scoped diagnostics establish syntax and type health in changed files, but runtime behavior awaits the team leader's targeted Jest run.

## Check fix

- The team leader's targeted run passed `execution-node.ptah-ui.spec.ts` and 36 of 37 `session-loader.resync-live-seed.spec.ts` cases. The remaining A-2 failure reported that `eventsByMessage.has('subagent-message')` was true; its original event-list failure showed that the tab held only `agent_start` for that message.
- This is the intended root-agent exception, not a session-loader bypass. `session-loader.service.ts:906` forwards the seed to `SessionHistoryReplayer`; it has no seed accumulator call. `session-history-replayer.service.ts:820-843` invokes the seed callback, whose test implementation calls `StreamingHandlerService.processStreamEvent` (`session-loader.resync-live-seed.spec.ts:119-125`). That handler calls `claim` first (`streaming-handler.service.ts:211`). `SubagentExecutionStore.claim` deliberately opens an entry and returns `false` for a root `agent_start` (`subagent-execution.store.ts:151-161`), so the tab retains the agent node; it claims the following `message_start` and text into the store (`subagent-execution.store.ts:148-176`).
- Corrected the A-2 assertion to require exactly the root `seed-agent-start` in the tab's `subagent-message` event list. Its next assertion still requires `seed-subagent-start` in the real store. No production file was changed. The team leader's reported result is from before this one-line assertion fix; I ran no test command under lane rules. A post-edit scoped diagnostics request timed out after 45 seconds and returned `unavailable`, so it did not verify this edit.

# Code Logic Review — TASK_2026_714_c8a2 / D9 fix9

Scope: `session-history-replayer.service.ts` (`restoreNativeCompletedChildren` extraction), `session-loader.service.ts` (`refreshResumableSubagentsForSession` call site), `session-loader.service.spec.ts`, and the new `session-history-replayer.native-recovery.spec.ts`. Static read; no tests, lint, typecheck or git writes were run.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE (with two recommended hardening fixes) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |

The root cause is credible: the live probe showed the cached-tab refresh received the events and never entered `replay`, so the fix6-8 recovery inside `replay` could not run. Extracting it into a method that both paths call is the right shape, and the live PASS corroborates it.

## Checks requested

**Tab-ownership race — OK.** `refreshResumableSubagentsForSession` awaits `chat:resume`, then re-reads the tab (`findTabByIdAcrossWorkspaces(tabId)`) and returns if it is gone or `claudeSessionId !== sessionId`. The restore call comes after that check and is fully synchronous (no await between the check and the monitor/execution store writes), so a tab closed or switched during the RPC cannot be written to. The stores are session-keyed by tool-call id and not tab-scoped, so a stale tab id cannot mis-attribute data. The `_inFlightSessions` guard also prevents concurrent refreshes of the same session.

**Claude untouched — OK.** The method no-ops unless `resumeProviderId ?? tab.providerId === 'openai-codex'` or an `agent_start` has `source:'history'` and a projector-shaped JSON-array id. Claude event ids do not match. For Claude sessions the only added work is one `events.some` pass, and it runs before any store access. Note the precedence: a supplied `resumeProviderId` overrides the tab's provider; that is intended.

**Idempotency with full replay — OK.** Both paths use identical logic. Existing non-terminal monitor records are skipped, terminal records are never rewritten, and `restoreHistoryChild` is guarded by `restoredEventIds` (verified in the fix8 review). A cached-tab refresh followed by a full replay (or the reverse) therefore converges. One caveat: after a live child finishes in a running Codex session, a later refresh would replace the live-built finalized tree with the history snapshot (previously flagged M-b); correctness depends on the projected ids/content matching the live ones.

## Moderate

- **M1. No error isolation around the new call.** `session-loader.service.ts:~1855-1861`. `restoreNativeCompletedChildren` can throw (`injector.get`, `mergeSubagentHistory`, accumulator). In the refresh method it sits before `recordTail`, `applyResumeStats`, the `resumableSubagents` update and `applyCliSessions`, inside one outer `try` whose catch only does `console.warn`. A throw in the child recovery would therefore silently skip the stats, the resumable subagents and the CLI-session sidebar restore for that session. The same call in `replay` would turn a recovery problem into a replay failure. Wrap the call in its own try/catch that logs a warning and continues.
- **M2. Resume tail page is partial.** The refresh requests `historyPaging.tailRequest()`, so `events` is only the tail page. A child whose `agent_start` or `tool_result` lies before the tail is skipped (the guards `!result || children.length === 0` and the `agentId` check make this safe, not wrong). The RPC lane fallback still covers it, but the card/panel entry would be missing for long sessions. Not a regression; worth stating in the report as a known limit.
- **M3. The new spec is weaker than its title says.** `session-history-replayer.native-recovery.spec.ts`:
  - `ExecutionTreeBuilderService` is mocked with `buildTree.mockReturnValue([{content:'PINEAPPLE'}])`, so `expect(execution.treeFor('spawn-1')).toEqual([... 'PINEAPPLE'])` passes regardless of what events were processed. Only the monitor record (status `completed`, `agentId`) and the entry `agentId` are real assertions.
  - The idempotence check only asserts `subagents().size` and `entries().size` equal 1, which holds even if the second call re-merged. It does not assert `buildTree`/merge was not re-run or that `restoredEventIds` short-circuited.
  - Other collaborators are `{}` stubs (`StreamingHandlerService`, `BatchedUpdateService`, `HistoryMessageBuilder`) and the `TabManagerService` mock is partial; the real `AgentMonitorStore` and `SubagentExecutionStore` inject `TabManagerService`, `VSCodeService`, `ClaudeRpcService`, `SessionManager` and `BatchedUpdateService`. I could not confirm that none of the unmocked methods (for example a store calling `rpc.call(...).then`, or `tabManager` signals used in an `effect`) are reached. Passing against the real stores is therefore likely but not verified; treat the first CI run as the check. Adding a Claude-negative case (non-marker ids, no provider) to this file would tie the "Claude untouched" claim to the new entry point.
- The `session-loader.service.spec.ts` routing regression was not re-read in full; it asserts the call happens on the cached path with synthetic events, which is what the root cause needs.

## Verdict
APPROVE at 7/10. The fix addresses the demonstrated root cause with correct ownership and Claude gating. Before merge, add the try/catch (M1) and strengthen the spec assertions (M3).

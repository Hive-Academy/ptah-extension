# Batch 3 report — TASK_2026_614_327a

Status: all three tasks implemented, each with its regression test. No git run; batches.md/task.md untouched.

## Changed files (all under `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e/libs/backend/agent-sdk/src/lib/`)

### Task 3.1 — D.2: release the tap when the stream ends without an abort

- `helpers/session-lifecycle/session-query-executor.service.ts`
  - `CompactionObservingWatchdog` now overrides `stop()`: `super.stop()` then `tap.release()`. `StreamTransformer`'s
    `finally` (`stream-transformer.ts:884`) calls `activityWatchdog.stop()` on every teardown, so a normal stream end now
    unregisters the coordinator record, releases the context-usage port and the subagent monitor's sessions.
  - The abort listener stays. `CompactionSessionTap.release()` is the single idempotent entry point (guarded by
    `released`), documented as such, so Batch 15 only has to move the one `tap.release()` call to the transformer end
    callback and delete the subclass.
- `helpers/session-lifecycle/session-query-executor.service.spec.ts` — new test "releases on a normal stream end with no
  abort, and a resumed run registers afresh (TASK_2026_614 D.2)": real `CompactionCoordinator`, port and monitor mocks;
  `stop()` twice with the signal not aborted → no coordinator record, port and monitor released exactly once, a later
  abort releases nothing again, and a resumed run (`resumeSessionId`) registers the same SDK id afresh.

### Task 3.2 — D.7: effective subagent prompt-cache TTL to the monitor

- `helpers/sdk-query-options-builder.ts` — only the result type and the return: `QueryConfig` gains optional
  `subagentPromptCacheTtl?: SubagentPromptCacheTtl`; `build()` returns `subagentTtl.effective` (env override wins over the
  setting, as resolved by `resolveSubagentPromptCacheTtl`). No system-prompt (TASK_2026_609) lines touched.
- `helpers/session-lifecycle/session-query-executor.service.ts` — the tap gets `setSubagentCacheTtl(ttl)`, called right
  after `queryOptionsBuilder.build()`; `feedSubagentMonitor` passes it as the third `observe` argument (undefined → the
  monitor's `'5m'` default). Stale comment saying the TTL was not visible was replaced.
- `helpers/sdk-query-options-builder.subagent-ttl.spec.ts` — new test: the build result carries the effective TTL
  (`auto`→1h, `5m`→5m, env `5m` with setting `1h` → result `5m` while the SDK option stays `1h`).
- `helpers/session-lifecycle/session-query-executor.service.spec.ts` — harness option `subagentCacheTtl`; new
  describe "effective subagent prompt-cache TTL (TASK_2026_614 D.7)" with a real `SubagentBudgetMonitor`: 1000 unsplit
  cache-write tokens weigh 2000 for a 1h session and 1250 when the build reports nothing. The existing forward test now
  asserts `observe(REAL, sub, undefined)`.

### Task 3.3 — D.12 B-m7: subagent `contextTokens` only when cache figures exist

- `message-transform/assistant-message.transformer.ts` — `contextTokens` is emitted on a subagent message only when both
  `cache_read_input_tokens` and `cache_creation_input_tokens` are numbers; otherwise omitted so the frontend fallback
  applies.
- `message-transform/assistant-message.transformer.spec.ts` — the old "counts missing cache fields as 0" test is
  replaced by "omits contextTokens when the provider reports no cache fields" and "omits contextTokens when only one
  cache field is reported"; the "both present → sum (1500)" test is unchanged and passes.

## Checks (run from the worktree)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` | 0 (Tests: 2952 passed, 3 skipped; lint 0 errors, 48 pre-existing warnings) |
| `npx nx run-many -t typecheck -p ptah-electron,ptah-cli,ptah-extension-vscode` (exported `QueryConfig` changed, additively) | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

Lint warnings on the touched files are pre-existing (`max-lines` on `sdk-query-options-builder.ts`, a non-null
assertion at spec line ~641 not in this batch). `prettier --write` was applied to the executor file (it also reflowed the
pre-existing mis-formatted `feedSubagentMonitor`/constructor lines).

## Notes

- Plan deviations: none. The D.2 test mirrors `StreamTransformer`'s `finally` by calling `activityWatchdog.stop()`
  directly rather than driving a real transformer; Batch 15 will replace that seam.
- Out of scope: `git diff --stat` also shows changes in `cli-agents/agent-process-manager*`, `cli-engine/container.ts`
  and `mcp-core/agent-wait.tool*`; those belong to parallel executors and were not touched by this batch.

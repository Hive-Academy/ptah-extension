# Batch 55 executor report: N7 agent-sdk wiring and broadcast forwarding

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget`. Nothing is committed. Batch 54's
uncommitted files were not edited. This batch adds the `SessionHandoffWriter` registration that Batch 54 needs, so
`di-lint` now passes and Batches 54 and 55 can be committed together.

## Files

All paths are under `libs/backend/`.

| Task | File                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 55.1 | `agent-sdk/src/lib/di/tokens.ts`                                           | `SDK_SESSION_BUDGET: Symbol.for('SdkSessionBudget')`                                                                                                                                                                                                                                                                                                                              |
| 55.1 | `agent-sdk/src/lib/di/register.ts`                                         | Registers `SessionBudgetConfigProvider` and `SessionHandoffBuilder` with `registerSingleton(Class)`. Registers `SessionHandoffWriter` with `instanceCachingFactory(c => new SessionHandoffWriter(c.resolve(TOKENS.LOGGER)))`, which uses the default home dir. Registers `SDK_SESSION_BUDGET` with `useClass: SessionBudgetService`, singleton. All four come before the adapter. |
| 55.1 | `agent-sdk/src/index.ts`                                                   | Exports `SessionBudgetService`, plus the types `SessionBudgetSendCheck` and `SessionBudgetState` (re-exported from shared, following the barrel's existing shared re-exports)                                                                                                                                                                                                     |
| 55.1 | `agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts` | New describe: `SDK_SESSION_BUDGET` resolves through the real `registerSdkServices`, is a singleton, and `canSend` fails open                                                                                                                                                                                                                                                      |
| 55.2 | `agent-sdk/src/lib/sdk-agent-adapter.ts` (+ spec)                          | Details below                                                                                                                                                                                                                                                                                                                                                                     |
| 55.3 | `agent-sdk/src/lib/helpers/stream-transformer.ts` (+ spec)                 | New optional `onCompactBoundary?: (sessionId) => void` on `StreamTransformConfig`. It is called once in the `isCompactBoundary(sdkMessage)` branch with `effectiveSessionId`. There is no new DI in the transformer.                                                                                                                                                              |
| 55.4 | `cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` (+ spec)               | `sendStatsWithRetry` spreads `...(stats.budget && { budget: stats.budget })` next to `sessionStats`                                                                                                                                                                                                                                                                               |

### Adapter changes (55.2)

- **Injection:** the adapter now takes a new last constructor parameter, `@inject(SDK_TOKENS.SDK_SESSION_BUDGET)`, typed
  as `Pick<SessionBudgetService, 'observe' | 'recordCompaction' | 'release' | 'clearAll'>`.
- **`wrapResultStatsForActivity`:**
  - It calls `observe(stats.sessionStats)` on every result, including when no inner callback is registered.
  - It then calls `inner(budget ? { ...stats, budget } : stats)`. Either way the `sessionStats` reference is the
    identical object.
  - If there is no state, the original `stats` object is passed through unchanged, with no `budget` key.
  - An `observe` throw is caught in `observeBudget`. It logs one WARN per adapter (a boolean, so it cannot grow without
    bound), and `inner(stats)` still runs.
- **Compaction recorder:** `recordBudgetCompaction` is an arrow field. It is passed as `onCompactBoundary` at all four
  `transform` call sites (new session, existing-query, resume and slash command). A `recordCompaction` throw is
  WARNed and never reaches the stream.
- **Release on session end:** `endSession` (after teardown), `endSessionIfTokenMatches` (only when `ended`) and
  `interruptSession` all release the budget.
  - Release covers every key the session may be held under: the caller's id, `rec.tabId` and `rec.realSessionId`.
  - These keys are captured before the teardown awaits, by a new `sessionKeys()` helper.
  - `captureStatsLeases` now uses the same helper, with no behaviour change.
- **Disposal:** `dispose()` calls `sessionBudget.clearAll()` next to `statsOwner.clearAll()`.

## Specs added

- **Adapter** (`session budget wiring (TASK_2026_597 N7)`, 9 tests):
  - Parity: the snapshot reaches the callback by the identical reference, with `budget` next to it.
  - AS-1: the tracking id is `tab_1`, but the snapshot and budget carry the real UUID, and `observe` receives that
    snapshot.
  - With no state, the stats object goes through untouched and has no `budget` key.
  - An `observe` throw still publishes both results and WARNs once.
  - `observe` runs even when no callback is registered.
  - The compaction recorder is wired and swallows a throw.
  - Release covers every key of an interrupted session.
  - A token-matched end releases only when it wins.
  - `endSession` releases after teardown, and `dispose` clears all.
- **Transformer** (`onCompactBoundary (TASK_2026_597 N7)`, 3 tests):
  - Two boundaries give two calls, both keyed by the real id after init, on a stream that started under `tab_1`.
  - There is no call when the stream has no boundary.
  - A boundary with no callback set streams normally.
- **sdk-callbacks:** `budget` is forwarded by reference when present, and there is no `budget` property when absent.
- **DI smoke:** the budget service resolves from the real registration (1 test).

## Checks

| Command                                                                                                                                                                                      | Result                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers ptah-extension-vscode ptah-electron ptah-cli --skip-nx-cache` | exit 0, "Successfully ran targets typecheck, lint for 6 projects". No lint warning on any touched file.                               |
| `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime --maxWorkers=2`                                                                                      | exit 0, "Successfully ran target test for 2 projects"                                                                                 |
| `npx jest … -t "session budget\|onCompactBoundary"` (adapter, transformer and smoke specs)                                                                                                   | 13 passed (9 + 3 + 1)                                                                                                                 |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts …/sdk-callbacks.spec.ts -t budget`                                                                                                | 2 passed                                                                                                                              |
| `npx jest … helpers/session-budget/` together with the three agent-sdk specs above (Batch 54 suites included)                                                                                | 7 suites passed, 190 tests                                                                                                            |
| `npx nx run di-lint:lint` (run as its command, `npx ts-node --transpile-only tools/di-lint/check-injects.ts`)                                                                                | "di-lint OK: 1727 @inject sites all resolve to a registered token (758 tokens)". The Batch 54 `SessionHandoffWriter` failure is gone. |
| `npx nx run degradation-audit:lint` (run as its command)                                                                                                                                     | exit 0. `libs/backend/agent-sdk: 4 ok (baseline 4)`. The new catches return nothing, so no new site was added.                        |

Prettier was run on every touched file.

## Deviations

- **Narrow types on the dependency:** the adapter injects the budget typed as a narrow `Pick`, like its
  `historyReader` parameter. It is not typed as the concrete class.
- **`budget` only when present:** the adapter adds `budget` only when `observe` returned a state. The plan text is
  `inner({...stats, budget})`. Passing an explicit `budget: undefined` would have changed the payload shape for
  every non-budget result, and 55.4 forwards `budget` "only when present", so the field is left out instead.
- **Compaction is not filtered by `parent_tool_use_id`:**
  - "Main stream only" is enforced by where the callback lives: the main `transform()` stream.
  - Subagent streams go through the dispatcher and never receive the callback.
  - AS-2 (whether `compact_boundary` in the parent stream is main-loop only) is still for QA, as the batch notes.
- **Config-change re-initialize:** budget states are not cleared on a config-change re-initialize
  (`disposeAllSessions` in the adapter's `onConfigChanged`). That matches `statsOwner`, which is also cleared only on
  `dispose()`. Sessions ended that way keep their entry until the process disposes.

## Out-of-scope observations

None.

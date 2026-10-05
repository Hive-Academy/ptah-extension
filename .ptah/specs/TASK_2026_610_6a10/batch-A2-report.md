# Batch A2 report

## Delivered files

- `libs/shared/src/lib/utils/turn-sources.utils.ts`
  - Adds the pure `buildTurnSourceSnapshot` function and readonly snapshot/source types.
  - Uses `ExecutionChatMessage`, `TurnChangeSet`, and A1's `collectTurnTests` / `summarizeTurnTests`.
  - Represents unfinished turns as pending and terminal missing change-set, execution-tree, token, cost, or duration data as unavailable; no missing value becomes zero.
- `libs/shared/src/lib/utils/turn-sources.utils.spec.ts`
  - Adds 4 snapshot tests: pending, fully available terminal data, unavailable data, and incomplete/late-change-set states.
- `libs/shared/src/lib/utils/usage-format.utils.ts`
  - Adds `formatUsdCost` and `formatDurationMs` with the current badge formatting behavior.
- `libs/shared/src/lib/utils/usage-format.utils.spec.ts`
  - Adds 16 formatter cases covering every cost and duration badge branch.
- `libs/shared/src/lib/utils/index.ts`
  - Adds exports only for the A2 snapshots and formatters.

## Badge rules copied

- `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:56-69`: only finite numeric cost is known; null, undefined, and non-finite values are unavailable (`formatUsdCost` returns `null`). Costs below `$0.01`, including zero, use four fixed decimals; costs at or above `$0.01` use two fixed decimals.
- `libs/frontend/chat-ui/src/lib/atoms/duration-badge.component.ts:27-41`: a positive value below `100` is first multiplied by `1000`; values below `1000` render rounded milliseconds, values below `60_000` render seconds with one fixed decimal, and longer values render whole minutes plus rounded remaining seconds when non-zero.

## Verification

- PASS — `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/turn-sources.utils.spec.ts libs/shared/src/lib/utils/usage-format.utils.spec.ts libs/shared/src/index.zod-free.spec.ts`
  - 3 suites passed; 28 tests passed. A Node ESM-config warning was printed, but Jest completed successfully.
- BLOCKED (unrelated concurrent changes) — `npx tsc -p libs/shared/tsconfig.lib.json --noEmit`
  - Exit code 2 from diagnostics exclusively in `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts` (for example lines 70, 95, 98, 114, 123, and 137). That file is outside A2's allowed paths; no A2 diagnostic was reported.

## Deviations

None from the assigned source/test/index scope. The requested TypeScript command could not complete cleanly because of diagnostics in a concurrently modified out-of-scope file.

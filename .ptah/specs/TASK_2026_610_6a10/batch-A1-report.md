# Batch A1 report

Implemented the pure, zod-free test-command matcher and execution-tree test collection utilities.

## Files

- `libs/shared/src/lib/utils/test-command-matcher.ts` — quote-aware command segmentation, tokenization, and R1-R6 test-command classification.
- `libs/shared/src/lib/utils/test-command.fixtures.ts` — every positive and negative Req 1.2 example-table row as a reusable fixture.
- `libs/shared/src/lib/utils/test-command-matcher.spec.ts` — fixture-driven matcher assertions, plus separator and malformed-input coverage.
- `libs/shared/src/lib/utils/turn-tests.utils.ts` — depth-first, once-per-node Bash test-run collection and outcome summary.
- `libs/shared/src/lib/utils/turn-tests.utils.spec.ts` — Bash filtering, agent-subtree traversal, all status outcomes, background handling, and summary coverage.
- `libs/shared/src/lib/utils/index.ts` — exports for the matcher and turn-test utilities/types.

## Bash node-shape evidence

`libs/frontend/chat-streaming/src/lib/execution-tree-retention.spec.ts:423-425` creates an execution-tree node with `type: 'tool'` and `toolName: 'Bash'`. `libs/shared/src/lib/types/execution/node.ts:149-152` defines the Bash payload as `toolInput`; the new spec cites both and pins the plan's A-2 `toolInput.command` and `toolInput.run_in_background` contract.

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/test-command-matcher.spec.ts libs/shared/src/lib/utils/turn-tests.utils.spec.ts libs/shared/src/index.zod-free.spec.ts` — passed: 3 suites, 52 tests.
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` — passed: exit code 0.
- Scoped TypeScript diagnostics — passed: 0 errors, 0 warnings.

## Deviations

None. The retained execution-tree fixture establishes the Bash node type/name; its `toolInput` payload field is confirmed by the shared `ExecutionNode` contract, which is cited alongside it because no retained fixture contains all command/background payload fields.

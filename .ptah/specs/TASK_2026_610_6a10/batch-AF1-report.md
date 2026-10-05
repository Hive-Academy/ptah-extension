# Batch AF1 report

## Result

Tool-result failure state is now retained as `ExecutionNode.isError`; tool-node
`status` remains `complete` when a result exists. Test recap outcomes use the
retained flag, and test commands whose shell status is masked by `|` or `||`
are reported as unknown.

## Files changed

- `libs/shared/src/lib/types/execution/node.ts` — added optional, readonly
  `isError` with the requested documentation beside `toolOutput`.
- `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts` — passes
  `resultEvent?.isError` to `createExecutionNode`.
- `libs/frontend/chat-execution-tree/src/lib/builders/builders.spec.ts` — adds
  real `tool_result` coverage for `isError: true` while status remains complete.
- `libs/shared/src/lib/utils/test-command-matcher.ts` — retains quote-aware
  segment separators and exports `hasMaskedTestCommandOutcome`.
- `libs/shared/src/lib/utils/turn-tests.utils.ts` — classifies terminal results
  from `isError`, handles masked status, and removes blanket catches.
- `libs/shared/src/lib/utils/turn-tests.utils.spec.ts` — updates legacy status
  fixtures and adds flag/masking assertions.

## Result-event and factory evidence

- `ToolResultEvent.isError` is required by the stream contract at
  `libs/shared/src/lib/types/execution/stream.ts:168-173`.
- The builder obtains that typed result at
  `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:168-170`
  and propagates it at `:227`.
- `createExecutionNode` accepts `Partial<ExecutionNode>` at
  `libs/shared/src/lib/types/execution/factories.ts:11-20`; no factory change
  was required.

## Replay-path evidence

There is no separate replay tool-node builder. `SessionHistoryReplayer.replay`
feeds each stored event through `processStreamEvent` at
`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:209-217`
and finalizes at `:226`. The resulting streaming state is built by
`ExecutionTreeBuilderService`; it wires the same exported `buildToolNodeFn` at
`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:62, 201-205`.
Thus replay uses `tool-node.fn.ts` rather than a divergent path.

## Outcome truth table

| Condition | Outcome |
| --- | --- |
| `run_in_background: true` | unknown |
| non-terminal node while not finalized | unknown |
| terminal node, `isError: true` | failed |
| terminal node, `isError: false` | passed |
| terminal node, absent `isError` (legacy) | unknown |
| matching test segment followed by `|` or `||` | unknown |

`status` remains a finalization/rendering state; it is not used to infer a
test result. The command segmenter remains quote-aware and does not use a new
regular expression for masking detection.

## Tests updated

- Builder integration test: creates an actual `tool_result` with
  `isError: true` and asserts `node.isError === true` plus `status ===
  'complete'`.
- Existing depth-first test fixtures that previously treated `complete` as
  passed now explicitly set `isError: false`; the former `error` fixture sets
  `isError: true`.
- Parameterized tests cover `isError` true, false, and absent for terminal
  statuses. Legacy absent flags are now unknown.
- Added `npm test | tee log` and `npm test || true` unknown-outcome cases.
- A shared-library spec cannot import the real frontend builder without
  violating the dependency direction (`@ptah-extension/shared` is
  `scope:shared`, while `@ptah-extension/chat-execution-tree` is a webview
  feature); the required real-builder coverage is therefore in that feature's
  own `builders.spec.ts`.

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/`:
  24 suites passed, 518 tests passed, 0 snapshots.
- `npx jest -c libs/frontend/chat-execution-tree/jest.config.ts libs/frontend/chat-execution-tree/src/lib/builders/`:
  1 suite passed, 17 tests passed, 0 snapshots.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/chat-execution-tree --parallel=1`:
  4/4 targets succeeded (shared lint and chat-execution-tree lint cached;
  both typechecks ran). Nx Cloud emitted a non-fatal disabled-organization
  notice after target success.

Scoped diagnostics found no diagnostics in the changed files. They reported
two unrelated sibling `BigInt` target errors in
`libs/shared/src/lib/types/capability-id-codec.ts`.

## Extra files

None.

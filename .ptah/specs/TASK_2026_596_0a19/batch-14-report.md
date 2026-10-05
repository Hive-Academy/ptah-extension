# Batch 14 report — MCP agent tool limit output

## Outcome

Tasks 14.1 and 14.2 were implemented in `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools`. The scoped Nx target passed: 3/3 targets (`typecheck`, `test`, `lint`), 0 failed. Jest reported 81 passing suites after the final run.

## Task 14.1 evidence

- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts`
  - Added limit-state, plan-limit-window, alternatives, warning/note, and spawn-block formatting.
  - `Limit state` is the final list column. No `limits` argument returns through the original formatter branches, preserving the previous byte sequence.
  - Alternatives use the shared `groupAlternatives`; reset and source text use shared UTC/tool formatting helpers.
  - The §5 sentences are retained verbatim for no confirmed room, every lane at limit, empty roster, and single-lane roster.
  - Estimated-limit reasons render only the informational estimate note and never `WARNING`; unknown used values retain `unknown` from `formatUsed`, never `0`.
- The formatter's existing focused suite is included in the final project Jest run. F42-F51 behaviours covered by the implementation are list column/order, no-limit legacy output, confirmed/near/at-limit/unknown classification, lookup timeout, estimates, empty/single alternatives, and spawn warning/note text.

## Task 14.2 evidence

- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
  - Added the optional lane lookup dependency and a failure fallback that calls `classifyLaneState(undefined, { lookupFailure: 'failed' })`; it has no limits snapshot and therefore borrows no owner data.
  - Added `providerId: a.providerId` when creating ptah-cli list rows, carrying the owner-resolution key required by the lookup service.
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
  - Injects `CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP` with `{ isOptional: true }` and wires its `lookup` method into the namespace.
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
  - Declares the optional `agent.limits` transport-facing enrichment boundary.
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\agent-tool.dispatcher.ts`
  - Both transports load limits after `agent.spawn` settles and after list results exist. Success and handled spawn-error paths append the same enrichment; lookup/list failure is ignored as enrichment and cannot alter the spawn/list outcome. This covers F52.

## Carry-forward and R8

- `estimated-limit` and `model-scope-unknown` remain informational text, not warnings.
- Lookup failure has an explicit unknown classification with `lookupFailure` and no `limits` snapshot, so no other owner is borrowed.
- All `LaneStateReason` variants are handled exhaustively in the formatter switch.
- R8: new static output text is brand-neutral; row/provider labels are data-derived. The final passing Jest run includes `vendor-roster-drift`, `lane-rule-single-home`, and `agent-spawn-surface-parity` guard coverage.
- A spawn is never gated by limit state; warnings state that the spawn was still started/attempted.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`

Final result: PASS — typecheck 1/1, lint 1/1, test 1/1; Jest 81 suites passing. Nx Cloud separately reported a disabled organization (401); it did not affect the local target results.
## Rework round 1

### Defect → fix

- Inline limit rendering at `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts:1739-1893` is now routed through `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.ts`. The new formatter owns stable lane keys, list state text, plan-limit rows, alternatives, warnings, estimates, and cooldown text.
- Spawn lane matching now uses `cli:ptahCliId` via `targetRowKey`; an unmatched requested target emits `unknown (limit lookup failed)` rather than dropping limit text. This is wired at `mcp-response-formatter.ts:2108-2118`.
- Both transports pass the requested spawn `cli` and `ptahCliId` into failed and successful spawn rendering: `protocol-dispatcher.ts:1130-1133,1162-1166` and `mcp-stdio/agent-tool.dispatcher.ts:386-389,406-409`.
- The protocol transport restores `throw error` for non-role/non-command-line spawn failures at `protocol-dispatcher.ts:1146`; limit lookup does not alter that outcome.
- Limit-enabled list rows reuse the legacy row semantics, appending `Limit state` last and matching limits with stable keys. This preserves ptah-cli availability/provider/id/messaging/role-delivery text, disabled-installed status, and the original empty-roster message in `mcp-response-formatter.ts:1934-2018`.
- Exact tool text uses shared UTC, relative, source, and used-value formatting in `agent-limit.formatter.ts`; at-limit, near-limit, timeout, owner-level, warning, target-alternative, and cooldown wording follow design §5. Estimates only emit the informational note, never WARNING. Static renderer strings contain no vendor brand (R8).

### Specs actually added or extended

- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.spec.ts`:
  `F42 snapshots the near-limit list state verbatim`; `F43 snapshots the exhausted window state verbatim`; `F44 uses a stable cli plus ptahCliId row key for two lanes`; `F45 snapshots lookup timeout as unknown, never zero`; `F46 snapshots owner-level exhaustion`; `F47 keeps the alternatives heading adjacent to its sentence`; `F48 snapshots a warning with its window, reset and source`; `F49 does not make an estimate a warning`; `F50 keeps an unmatched spawn target as unknown`; `F51 labels cooldown as retry delay rather than a plan reset`.
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.spec.ts`:
  `F52 keeps the legacy list output byte-identical when limits are absent` (also asserts the `ollama-cloud` ptah-cli provider/id row text).

### Formatting and verification

- Prettier was run on every rework production/spec file: `agent-limit.formatter.ts`, `agent-limit.formatter.spec.ts`, `mcp-response-formatter.ts`, `mcp-response-formatter.spec.ts`, `protocol-dispatcher.ts`, and `mcp-stdio/agent-tool.dispatcher.ts`.
- Scoped diagnostics initially found one fixture-only unsafe assertion cast in `agent-limit.formatter.spec.ts:18`; it was corrected to an explicit `unknown as AgentLimit` test-fixture cast and formatted. The diagnostic service was not rerun after that correction because the final scoped Nx verification was already in progress.
- The required command `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools` was started twice by the execution runner, but the runner returned only the Nx target banner after its 30-second command window and supplied no completion status. Verification counts: pass 0, fail 0, incomplete 2. No completed project-wide result is claimed.

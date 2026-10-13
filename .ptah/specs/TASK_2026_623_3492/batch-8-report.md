# Batch 8 report: L2 export `formatPlanLimitRows`

## Backend implementation: `TASK_2026_623_3492`, batch 8

**Tasks completed**: Task 8.1, which exports `planLimitRows` as `formatPlanLimitRows`.

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.ts
  - Adds the exported `formatPlanLimitRows(limits: readonly AgentLimit[], now = Date.now()): string[][]`, which is `limits.flatMap(limit => planLimitRows(limit, now))`.
  - `formatPlanLimitsSection` now calls it. The per-lane `planLimitRows` stays private and is unchanged, so both callers share one implementation.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.spec.ts
  - Adds the describe block `formatPlanLimitRows: one implementation for the list and $limits (TASK_2026_623 R10.2)`.
  - Every existing case is unchanged.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\vscode-lm-tools\src\index.ts
  - The barrel exports `formatPlanLimitRows` and `type AgentLimit`, which is the function's parameter type, for the Batch 9 handler.

**Stack observed**:

- TypeScript lib with no DI involvement: the formatter is made of pure functions (agent-limit.formatter.ts).
- Barrel exports follow the existing pattern in `src/index.ts`.
- Jest with ts-jest (`libs/backend/vscode-lm-tools/jest.config.ts`).

**Spec cases (each R10.2 case is checked against the list's own output)**:

The `expectListEquivalent` helper works like this:

- It parses the body rows of `formatPlanLimitsSection(limits, NOW)`.
- It asserts that the first five cells of each `formatPlanLimitRows` row equal the list's cells, in the same order.
- It asserts that every row has six cells and that no cell is empty.

| Case | Expected cells |
| ---- | -------------- |
| Byte identity: `formatPlanLimitsSection(ROSTER)` equals the header plus the joined `formatPlanLimitRows` rows, and equals a full literal snapshot of the section's 8 rows | — |
| Empty roster: `[]` rows; the section is the header only | — |
| Lane with two windows | codex, two rows, pinned exactly |
| No windows, no usage source | `codex \| (none) \| no usage source \| unknown \| - \| -` |
| Owner-level limit with no window | `AT LIMIT (owner level, window unknown)`, `reset unknown`, `error-derived` |
| `reset-usage-unknown` | The state is asserted to be classified as `reset-usage-unknown`. Used is `unknown` and state is `reset passed, usage unknown`. The stale `70%` never appears. |
| Failed and timed-out lookups | `limit lookup failed` and `limit lookup timed out`, each with `-` reset and `-` source |
| Ptah CLI lane with and without `ptahCliName` | Agent cell is `Glm` / `Unknown`. The id `nameless-1` never appears. |
| Mixed roster | List order is kept: 8 rows |

**Risks handled**:

- **Output drift between `formatPlanLimitsSection` and `formatAgentList` after the export (MEDIUM).**
  - There is one implementation: the section now calls `formatPlanLimitRows`, and no cell logic changed.
  - A full literal byte snapshot of the section and an equivalence fixture for each R10.2 case pin the output.
  - Every existing `agent-limit.formatter.spec.ts` case and `mcp-response-formatter.spec.ts` (which covers `formatAgentList`) pass unchanged.
- **"Unknown, never zero" (R10.2 / R10.3).**
  - Missing values use the list's own words ("unknown", "reset unknown", "-"), because the rows come from the list's own code.
  - The spec asserts that no cell is an empty string, and that the reset-passed window never shows its stale percent.
- **Privacy (R10.4) at this layer.** The rows contain only lane name, window, used, state, reset and source text.
  - A Ptah CLI lane is named by `ptahCliName` or `Unknown`, never by its id; the spec asserts this.
  - Batch 9 maps only cells 0-4, so the Source cell (cell 5) is never part of the `$limits` response.
- **Known red window for cross-project specs (Batches 9-12).** Not touched by this batch; no cross-project specs were run.

**Verification**:

1. Jest: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <agent-limit.formatter.spec.ts> <mcp-response-formatter.spec.ts> --coverage=false --maxWorkers=2`.
   - First run: the formatter suite passed (34 tests). `mcp-response-formatter.spec.ts` failed to load with "Could not locate module marked mapped as …\task-623-display-panel\node_modules\marked\lib\marked.umd.js".
   - Cause of the failure: this is an environment fault, not a code fault. The worktree has no `node_modules`, and `jest.preset.js:31-34` resolves `marked` relative to the worktree.
   - Re-run: the same command, adding `--moduleNameMapper` with the lib's own three mappings and `marked` pointing at `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js`. No repository file was changed.
   - Re-run result: **Test Suites: 2 passed, 2 total; Tests: 197 passed, 197 total.** Jest also printed a worker force-exit notice, which is pre-existing teardown noise.
2. `npx nx typecheck @ptah-extension/vscode-lm-tools --parallel=1`: **Successfully ran target typecheck.**
3. `npx nx lint @ptah-extension/vscode-lm-tools --parallel=1`: **Successfully ran target lint**, with 0 errors and 77 baseline warnings, none of them in the changed files.
   - `npx eslint` on the 3 changed files: clean.
   - `prettier --write` was applied to the spec file (whitespace only).

**Plan deviations**:

- The barrel also exports `type AgentLimit`, the parameter type of `formatPlanLimitRows`, so that consumers can type their input. The plan named only the function.

**Out-of-scope observations**:

- `jest.preset.js` hard-codes `node_modules/marked` relative to the repository root. In a git worktree without its own `node_modules`, any vscode-lm-tools spec that reaches `marked` therefore fails to load unless the mapper is overridden. Not changed here.

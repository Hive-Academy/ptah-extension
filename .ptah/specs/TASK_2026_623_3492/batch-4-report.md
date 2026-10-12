# Batch 4 report — S4 converter and `$agents` source (TASK_2026_623_3492)

Executor: backend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel` only. No git
operations were run.

## Tasks

### Task 4.1 — converter emits `/4`, maps new nodes: COMPLETE

- The decision #24 seam is gone. `notConvertible(...)` and its throws were removed. Every container, atom and stat
  trend/spark now maps to `/4`.
- The envelope uses `catalogVersion: SURFACE_CATALOG_VERSION_4` (D1). Per R3.1, this is the only literal change in 610
  output: the six original fixtures deep-equal their old output, with only `catalogVersion` updated.
- Ids:
  - Depth-0 items keep `c${n}`, and statlines still expand to one stat each.
  - The children of container `P` are `${P}.${i}`, counted after stat expansion.
  - One recursive `convertItems` handles both depths.
- Container mapping (R3.2):

  | Fence | Catalog kind |
  | --- | --- |
  | `row` | `stack` with `horizontal` |
  | `col` | `stack` with `vertical` |
  | `grid N` | `grid` with `columns: N` |
  | `card [t]` | `card`; the title is omitted when absent |
  | `section t` | `section` |
  | `accordion t` | `accordion` (D2) |

- Atom mapping (R4 table):
  - `note` → `alert`: info→info, ok→success, warn→warning, error→error.
  - `badge` and `progress` use the tone map neutral/info/ok→success/warn→warning/error. `progress` defaults to `neutral`.
  - `avatar` → `avatar`; `subtitle` is omitted when absent.
- Stat trend/spark:
  - `trend` becomes `{direction, amount, percent, polarity?}`.
  - `spark` is copied as a new array.
- Bindings now carry `scope?: 'session'`, set only when present, so 610 bindings deep-equal their old form.
- A scoped scalar placeholder reads `$agents.session.<field>`.
- Evidence: `ptah-ui-converter.spec.ts` covers:
  - the six 610 fixtures, now `/4`;
  - every `PTAH_UI_CORPUS` case staying flat (`c${n}`) and passing `validateSurfaceDocument` under `/4`;
  - one fixture per container (7 cases, with and without a card title), each validated;
  - eight atom fixtures, each validated;
  - trend/spark (with polarity, without polarity, and a plain stat), validated;
  - a nested block checking `c1.0.0`-style ids, nested stat expansion, and scoped and unscoped `$agents` bindings.

### Task 4.2 — pure `$agents` source module: COMPLETE

- New module `ptah-ui-agents-source.ts`. It is shared-only: it imports `ContextCapacity` (type),
  `usage-format.utils` and `SURFACE_LIMITS`, and nothing from frontend libs.
- Allow-listed input types follow the plan names: `PtahUiAgentsInput`, `TurnAgentFacts`, `AgentNodeFact`,
  `SubagentFact`, `CliLaneFact`. None of them has a task, description, prompt, summary, stdout, stderr, error or
  output-file field.
- Exports for the Batch 5 resolver:
  - `resolvePtahUiAgents(input, scope?)` → `{kind:'unavailable'} | {kind:'available', rows, omittedRows, scalars}`
  - `agentsScalarValue(view, field)`
  - `agentsRowValues(rows, columns)`
  - `agentContextText`, `agentContextAccessibleText`, `agentContextSortKey`
  - `normalizeAgentStatus`
- Merge (R5 rules 1-5):
  - Rule 1: N.toolCallId ↔ R.parentToolUseId.
  - Rule 2: when N has no toolCallId, match on agentId.
  - Rule 5: once an R is claimed, a later candidate gets no merge.
  - Rule 3: an unmatched N gets key `sdk-node:N.id`.
  - Rule 4: an unclaimed R gets key `sdk:R.parentToolUseId`.
  - CLI lanes use `cli:M.agentId` and never merge.
- Field precedence for a merged N+R row:
  - status comes from R while R is pending or running, otherwise from N;
  - tokens, cost and duration come from N when present, otherwise from R;
  - name is R teammateName, then R agentType, then N agentType;
  - context comes from R only.
- Scope (D7):
  - Turn scope is `turnIndex`. Session scope is turns `0..turnIndex`.
  - An R belongs to the first turn whose `spawnToolCallIds` (or node toolCallIds) hold its `parentToolUseId`.
    An unmatched R appears in neither scope.
  - A lane belongs to the last turn with `startedAt <= M.startedAt`.
- Order and cap (R5.11):
  - Rows sort by turn, then known start time, then key. Unknown start times come last within their turn, ordered by key.
  - Rows are capped at `SURFACE_LIMITS.maxTableRows`. `omittedRows` feeds "+N more".
  - Scalars count every row in scope.
- Context (R5.10):
  - Percent needs evidence for the exact model, from `sdk-native` or from `provider-catalog` with a non-empty
    `providerId`, with a positive finite limit. It is computed as `round(t/limit*1000)/10`.
  - Cell text is "50,000 · 25%", "50,000", or "unavailable".
  - Accessible text is "50,000 context tokens, 25 percent of the context window".
  - The sort key is tokens, with null last.
- Evidence: `ptah-ui-agents-source.spec.ts` covers:
  - R5.2: 17 status cases, including unknown and `toString` mapping to `pending`;
  - R5.9 (a)-(f), asserting row count and scalars;
  - R5.3: unavailable for tokens, cost and running duration, and the scalars;
  - R5.12 (a)-(h), plus provider-catalog to one decimal and context sorting;
  - R5.13: session and turn scope, the N+R merge across session, later-turn exclusion, orphan R, unknown-start order,
    `maxTableRows`+1, and reload;
  - R5.1: a sentinel on every private field of N, R and M, found in no output.
  - The `$diff session` / `$limits session` / `$agents sessions` grammar bullet of R5.13 is a parser concern and is
    already covered by the Batch 3 parser spec.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-source.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-source.spec.ts`
- CREATED this report.

No file outside the batch list was edited.

## Verification

This is the Batch 4 command from batches.md. It ran once, in the foreground; the jest pass lines are filtered out.

```text
npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.spec.ts --coverage=false --maxWorkers=2 | tail -n 40
Test Suites: 2 passed, 2 total
Tests:       82 passed, 82 total

npx nx typecheck @ptah-extension/shared --parallel=1 | tail -n 20
NX  Successfully ran target typecheck for project @ptah-extension/shared

npx nx lint @ptah-extension/shared --parallel=1 | tail -n 20
757:1  warning  File has too many lines (758). Maximum allowed is 700  max-lines
✖ 6 problems (0 errors, 6 warnings)
NX  Successfully ran target lint for project @ptah-extension/shared
```

- The 6 lint warnings are the Batch 1/2 baseline. One of them is `surface.schemas.ts` at 758 lines.
- Prettier was applied to the four files before the run.
- The declarative-dashboard typecheck was not run (decision #21).

## Risks and edge cases handled

- **R3.1 610 regression.** The six fixtures deep-equal the old output except for `catalogVersion`. All corpus cases stay
  flat with positional ids and validate under `/4`.
- **Decision #24 seam.** The throws are removed. `renderPtahUiBlock` no longer reaches its catch for containers or atoms.
- **CLI lanes show `context` "unavailable" (decisions #14, #16).**
  - `CliLaneFact` has no context field, so this holds structurally.
  - Spec (g) smuggles a `contextTokens` onto a lane and still gets "unavailable".
- **No percent without a known limit.**
  - Spec (e) proves `getModelContextWindow` returns a positive window for the model, yet no percent is shown without
    evidence.
  - Specs (b), (c), (d), a null limit and a zero limit all show tokens only.
- **Reload yields "unavailable" for R-only fields (D8, R5.6).**
  - In the reload spec, N-backed status, tokens, cost and duration equal their pre-reload values.
  - R context, and lane tokens and cost (`null`, matching `usageTotals: null`), read "unavailable".
  - The `tokens` scalar becomes unavailable.
- **Unknown start sorts last by key (R5.11).** Pinned by its own spec.
- **Missing input.** `null`, `undefined`, or an out-of-range or negative `turnIndex` gives `{kind:'unavailable'}`, and
  every scalar reads "unavailable". It never produces an invalid block.

## Plan deviations

1. **`CliLaneFact` omits `contextTokens`.** The plan lists the field, but decisions.md #16 (rev 3.1, later than the plan
   text) says CLI lanes show "unavailable" in this task. Leaving the field out makes this structural and avoids an
   unused field.
2. **The `tokens` scalar is unavailable when any row's tokens are unavailable.** The same rule applies to `cost`
   (R5.3). The R5 text only spells this out for `cost`. A sum that silently skips an unknown row would be a guessed
   figure ("unavailable, never zero / never guessed"), so `tokens` follows the same rule. Rows with tokens still sum
   normally (R5.9 (c): 420).
3. **R tokens.** R tokens are `inputTokens + outputTokens` when both are present, falling back to `totalTokens`. The
   plan lists all three fields without an order; R5 names "usage input + output" first.
4. **Status is typed `string`.** Fact `status` is a plain string rather than a union, so the R5.2 "unknown → pending"
   rule is reachable. The map lookup uses `Object.hasOwn`, so `toString` and similar names map to `pending`.
5. **Duration while running.** It renders "unavailable" for any non-terminal row (`pending`/`running`), per R5.3.

## Out-of-scope observations

- **Nested bindings are not resolved yet.** The resolver still maps top-level components only, so nested bindings
  (for example `c1.0.0`) keep their placeholder until Batch 5 makes it recursive (Task 5.1). Until then a nested
  `$agents.total` stat shows the literal placeholder text. This is not a fallback, and it is interim only.
- **Zero-agent cost.** With zero agents in scope the `cost` scalar is 0, and the shared `formatUsdCost(0)` renders
  `$0.0000`. That is a true zero, not a missing value. The Batch 5 resolver may prefer to present it differently.
- **Barrel not updated.** `surface.index.ts` does not export the new module. It is not in the Batch 4 file list. The
  plan lists `surface.index.ts` under component 2 for a later batch.

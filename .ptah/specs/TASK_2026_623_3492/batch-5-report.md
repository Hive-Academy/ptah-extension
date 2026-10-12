# Batch 5 report — S5 resolver and pipeline (`compilePtahUiBlock`)

Executor: backend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git run.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.spec.ts`

I edited no file outside the batch file list.

## Task 5.1: resolver with `$agents` / `$limits` inputs — done

- **Live inputs (D5).** `resolvePtahUi(conversion, snapshot, live = {})` takes a third argument,
  `PtahUiLiveSources { agents?: PtahUiAgentsInput | null; limits?: PtahUiLimitsInput | null }`. It is separate from
  `TurnSourceSnapshot`. An absent or null input resolves to "unavailable" and never makes the block invalid.
- **New exported types in the resolver.**
  - `PtahUiLimitRow` has five string cells: `lane`, `window`, `used`, `state`, `reset`.
  - `PtahUiLimitsInput` is one of:
    - `{kind:'pending'}`
    - `{kind:'unavailable'}`
    - `{kind:'available', rows, lanes, atLimit, nearLimit, unknown, asOf}`
  - The field names mirror the plan's `AgentGetLanePlanLimitsResult` (plan:1001-1003), so Batch 17 can map the RPC
    result 1:1.
- **Decision #24 seam removed.** The interim `agents`/`limits` → "unavailable" branches in `scalarValue` and
  `rowsSource` are gone.
- **Recursion (decision #27).**
  - `resolveComponent` walks the children of every layout component, including `accordion`, through
    `isSurfaceLayoutComponent` (`surface-bindings.ts`).
  - Bindings sit in a `Map` keyed by component id, so a binding at any depth (`c0.0.1`) resolves.
  - Scoped `$agents.session.<field>` scalars and `rows` bindings with `scope: 'session'` pass `binding.scope` through.
- **`$agents` builds on `ptah-ui-agents-source.ts`.**
  - It uses `resolvePtahUiAgents`, `agentsScalarValue` and `agentsRowValues`, with no re-implemented merge or
    aggregation.
  - Each resolve memoises one view per scope (turn / session), so several bindings cost one merge per scope.
  - Table cells are clamped like the other host values.
  - The cap note "+N more" comes from `view.omittedRows`.
  - `list $agents` lists `name`, the first registry column.
  - Empty-state text: "No agents this turn", or "No agents in this session" for the session scope (decision #11
    wording).
- **`$limits`.**
  - The scalars are `lanes`, `atLimit`, `nearLimit` and `unknown`. A pending or unavailable read shows its status
    word.
  - Rows keep list order and are capped at `maxTableRows`, with "+N more" for the rest.
  - The table description always carries `as of HH:MM`, from `asOf` in local time (R10.6). It reads "as of 14:32",
    "as of 14:32; +1 more", or "No CLI lanes; as of 14:32" when there are no rows.
  - `list $limits` lists `lane`, once per lane: two windows of the same lane give one item.
- **Zero-agent `cost` (pinned by spec).** It renders `$0.0000` (`formatUsdCost(0)`), and `total` renders `0`.
  Rationale: with no agents in scope the known cost is exactly zero. "unavailable" is reserved for a row whose cost is
  unknown, which follows R5.3 and decision #29.
- **610 behaviour kept.**
  - Diff and tests rows, notes, empty messages, clamping and status rows are unchanged.
  - The note text for diff and tests stays as before: an empty table shows only its empty message.
  - All earlier resolver and pipeline cases pass unchanged, except the one budget-reason case listed under Task 5.2.
- **Reserved id.** `reserved display id` is produced in `compilePtahUiBlock`, because the resolver never sees a display
  id. See Task 5.2 and the Plan deviations section.

New spec cases in `ptah-ui-resolver.spec.ts` (describe `resolvePtahUi live sources`):

- Decision #27: one block holds `section > card > stats` with `$agents.total`, `$agents.session.total`, `$diff.files`
  and `$limits.lanes`, plus a nested `table $agents session` and `accordion > list $limits`.
  - The values resolve to 2, 3, 1 and 3.
  - The session table has three named rows.
  - The list shows three lanes.
  - `JSON.stringify(surface)` contains no `$agents.`, `$limits.`, `$diff.`, `$tests.` or `$usage.` placeholder.
- Turn scope compared with session scope, for a table and a list.
- `$agents` scalars: cost `$0.06`, tokens 200, running 1.
- Zero-agent cost is `$0.0000` and total is 0.
- An agentless session table shows "No agents in this session".
- An `$agents` row cap gives "+2 more" and `maxTableRows` rows.
- Absent and null live inputs give "unavailable" scalars, table rows and list items.
- R10.10: three lanes (one at limit, one near limit with two windows, one failed lookup) give four rows in order,
  `lanes` 3, `atLimit` 1, `nearLimit` 1, `unknown` 1, and the description "as of 14:32".
- "as of" appears with the empty state and with the row cap.
- A pending or unavailable `$limits` read gives status scalars and a status row.

## Task 5.2: pipeline `compilePtahUiBlock(body, surfaceId)` + `usedSources` — done

- **`compilePtahUiBlock(body, surfaceId): CompilePtahUiBlockResult`.**
  - It parses and converts once and never throws.
  - On success it returns `{ok:true, conversion, usedSources: ReadonlySet<PtahUiSourceName>}`. `usedSources` is
    derived from every binding, so it covers bindings at any depth.
  - On failure it returns `{ok:false, code?, reason}`:
    - a reserved `ptah.` id, checked before parsing, gives `{code:'reserved-id', reason:'reserved display id'}`;
    - a parser failure keeps its own code and reason;
    - a throw gives `internal error` with no code.
- **`resolveCompiledPtahUiBlock(compiled, input)`.** It runs resolve and validate on a compiled block, so a caller can
  re-resolve on input changes without parsing again. It never throws, and an invalid result falls back atomically with
  no partial surface. Its input type is `ResolvePtahUiBlockInput = Omit<RenderPtahUiBlockInput, 'surfaceId'>`.
- **`renderPtahUiBlock(body, input)`** keeps its name and parameter shape. It is compile followed by
  `resolveCompiledPtahUiBlock`. `RenderPtahUiBlockInput` gains the optional fields `agents?` and `limits?`, so every
  existing caller (`ptah-ui-block.component.ts`) compiles unchanged.
- **Validator limit reasons (plan:64, R3.3).**
  - A validator breach phrased "over the `<maxX>` limit of `<n>`" now becomes `<maxX> (<n>) exceeded`. That is the
    parser's wording (`ptah-ui-lexical.ts:138-144`).
  - Other limit-shaped reasons still read "block exceeds a display limit". Zod paths never reach the user.
- **Batch 4 note.** No pipeline case expected a code-block fallback for containers, atoms or trend/spark. A new case
  asserts that such a block renders a `dashboard-catalog/4` surface: a grid with a card and an accordion, holding
  note, badge, progress, avatar and a stat with trend and spark.

New or changed spec cases in `ptah-ui-pipeline.spec.ts`:

- **Changed.** The budget case now expects `maxSurfaceBytes (<limit>) exceeded`. It used to expect
  "block exceeds a display limit"; plan:64 requires the change. No other spec in `libs/` pinned the old text (grep).
- **Added for `renderPtahUiBlock`:**
  - a grammar nesting breach whose reason names `maxTreeDepth (8) exceeded`;
  - a reserved id `ptah.turn-summary` → `{ok:false, reason:'reserved display id'}`;
  - the `/4` container and atom render case;
  - live `$agents` and `$limits` inputs passed through.
- **Added for `compilePtahUiBlock`:**
  - `usedSources` = {agents, diff, limits} for nested bindings;
  - an empty set for a literal block;
  - the reserved-id code takes precedence over a parse error;
  - the parser code and reason are kept;
  - `ptah-ui-node-0` is not reserved;
  - one compilation resolves against null, pending, empty and populated snapshots, `toEqual` to `renderPtahUiBlock`;
  - a throwing counter during resolve → `internal error`.

## Verification

Batch 5 command (batches.md), run in the foreground with `--maxWorkers=2` / `--parallel=1`:

```
npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20
```

- **Run 1.**
  - Jest: the pipeline suite passed. The resolver suite failed to compile because of one spec typing error:
    `TS18048: 'table.rows' is possibly 'undefined'` at spec:507. All 59 tests that ran passed.
  - `nx typecheck @ptah-extension/shared`: "Successfully ran target typecheck".
  - `nx lint @ptah-extension/shared`: "✖ 6 problems (0 errors, 6 warnings)". These are the same 6 baseline warnings as
    Batch 4. The `max-lines` warning at 757 lines is in a file this batch did not touch; `ptah-ui-resolver.ts` is
    about 430 lines.
- **Fix.** The spec now uses `table.rows?.length`.
- **Run 2 (Jest part only).** Typecheck and lint had already passed, and the fix was spec-only. Typecheck uses
  `tsconfig.lib.json`, which excludes specs, and ts-jest type-checks the spec during the run.

  ```
  Test Suites: 2 passed, 2 total
  Tests:       83 passed, 83 total
  ```

Not run, per the instructions: the `@ptah-extension/declarative-dashboard` typecheck (decision #21), and any build,
serve, e2e or workspace-wide target.

## Risks and edge cases from the validation section

- **`/3` / 610 regression (HIGH).**
  - Diff and tests resolution is unchanged, and every earlier resolver and pipeline case passes, including all corpus
    cases.
  - An empty table still shows only its empty message; the "as of" note applies to `$limits` only.
  - One reason text changed (validator budget), as plan:64 requires.
- **Reserved `ptah.` display id (R2.5, D11).**
  - `compilePtahUiBlock` rejects it with code `reserved-id` and reason "reserved display id" before parsing.
  - Inline ids (`ptah-ui-…`, `ptah-ui-block.component.ts:59`) do not match the `ptah.` prefix, and a spec pins this.
- **Reload, R-only fields "unavailable" (D8).** This is handled in the agents module (Batch 4). The resolver passes
  its values through, and any missing input resolves to "unavailable".
- **`$limits` RPC failure, or VS Code (no capability).** A null, absent or `{kind:'unavailable'}` input renders
  "unavailable" scalars, table rows and list items. The block stays valid (R10.7), as the specs show.
- **`$limits` privacy.** The resolver reads only the five string cells, the four counts and `asOf`. The input type has
  no field for owner, account or session. The response-level sentinel tests belong to Batches 7 and 9.
- **Unknown never zero.** Missing figures stay "unavailable" or "pending". Zero-agent cost is a deliberate true zero,
  pinned by a spec.

## Plan deviations

1. **The reserved-id check lives in `compilePtahUiBlock`, not in the resolver.**
   - Task 5.1 lists it among the resolver's requirements, but the resolver never receives the display id. The compile
     step receives it as `surfaceId`.
   - The plan's pipeline spec seam (plan:501) also places the reserved-id case in the pipeline.
   - The code is the parser's declared `'reserved-id'`.
2. **`PtahUiLimitsInput` is defined in `ptah-ui-resolver.ts`.** The plan does not give its shape. It is defined there,
   rather than in `ptah-ui.types.ts`, because the types file is not in this batch's file list. It adds a
   `{kind:'pending'}` state for the time before the first read returns; plan:692 names only `{kind:'unavailable'}`.
3. **A new exported helper, `resolveCompiledPtahUiBlock`.** It is the resolve-and-validate half of the D5 split. Without
   it a caller holding a compiled block could not re-resolve without parsing again, which would defeat "parse and
   convert once per body".
4. **`list $limits` deduplicates lanes.** R10.8 says it lists `lane`, and the scalars count lanes. Repeating a lane once
   per window would list the same lane twice.

## Out-of-scope observations

- `surface.index.ts` does not yet export the following, and the file is not in this batch's list:
  - the new functions `compilePtahUiBlock` and `resolveCompiledPtahUiBlock`;
  - the types `PtahUiLimitsInput`, `PtahUiLimitRow`, `PtahUiLiveSources`, `CompiledPtahUiBlock`,
    `CompilePtahUiBlockResult` and `ResolvePtahUiBlockInput`.

  Batches 17, 18 and 20 import through the `@ptah-extension/shared/mcp-apps-contracts/surface` entry and will need
  them.
- **Eager closure, for Batch 32.** `ptah-ui-resolver.ts` now imports `ptah-ui-agents-source.ts` at runtime, and
  `surface.index.ts` already re-exports `resolvePtahUi` and `renderPtahUiBlock`. So any eager importer of that barrel
  now also reaches the agents module, which D6 lists as forbidden-eager. The same was already true of the parser and
  the resolver. Today's barrel consumers (`ptah-ui-block`) are lazy, but the Batch 32 gate patterns should include
  `ptah-ui-agents-source.ts`.

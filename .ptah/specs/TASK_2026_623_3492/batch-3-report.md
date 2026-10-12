# Backend implementation — `TASK_2026_623_3492`, batch 3 (S3 fence and parser rewrite)

**Verdict:** both tasks are done and the Batch 3 verification command passes: Jest 180/180, typecheck passes, lint has 0 errors and the same 6 warnings as Batches 1-2. Four files outside the batch's list were changed or added, all in the same lib. The reasons are in the "Out-of-list files" section.

## Tasks completed

### Task 3.1: types and fence (`display [id]`, closed fences only): COMPLETE

- `ptah-ui.types.ts`
  - `PtahUiDocument.elements` is now `readonly PtahUiNode[]`. A node is either a container or an element.
  - Container types: `PtahUiStackElement` (`row` / `col`), `PtahUiGridElement` (`columns`), `PtahUiCardElement` (optional `title`) and `PtahUiTitledContainerElement` (`section` / `accordion`, with a required `title`).
  - New atom types: `note`, `progress`, `badge` and `avatar`, with closed tone unions `PtahUiNoteTone` and `PtahUiTone`.
  - Stat items:
    - `PtahUiStatItem` gains `trend?: PtahUiTrend` (`direction`, `amount`, `percent`, `polarity?`, mirroring `SurfaceStatTrend`) and `spark?: number[]`.
  - Sources and scope:
    - `PtahUiSourceName` adds `'agents' | 'limits'`.
    - `PtahUiScalar`, the source table and the source list gain `scope?: 'session'`.
  - Failure codes:
    - The new `PtahUiParseFailureCode` type adds `'depth' | 'reserved-id' | 'limit'`.
    - Nothing produces `'reserved-id'` yet. Task 5.1 owns the `ptah.` check.
  - Fence segments:
    - The fence segment gains `target?: 'display'` and `displayId?: string`.
- `ptah-ui-fence.ts`
  - `readPtahUiOpener` recognises exactly three openers, after trailing spaces are removed:
    - `` ```ptah-ui ``
    - `` ```ptah-ui display ``
    - `` ```ptah-ui display <id> ``
  - The `<id>` must match `SURFACE_ID_PATTERN` and be at most `SURFACE_LIMITS.maxSurfaceIdLength` characters (imported from the zod-free `surface-catalog`).
  - Any other `ptah-ui …` info string falls through to `readOpeningFence` and stays an ordinary code block (R2.1).
  - Inline and display fences share one ordinal sequence, which keeps the R2.8 order.
- `ptah-ui-fence.spec.ts`: the 11 existing cases are unchanged. The new `describe('segmentPtahUi display openers (R2.1)')` adds 26 cases:
  - the opener with no id and the opener with an id;
  - a check that inline segments have no `target` / `displayId` key;
  - CRLF line endings and trailing spaces;
  - an id of exactly the maximum length, and one character over;
  - the `ptah.` id passed through for the pipeline to reject;
  - a shared ordinal across inline and display fences;
  - 13 invalid openers (`sidebar`, two ids, double spaces, `Display`, glued keyword or id, `.a`, `a/b`, `v1:a`, over-length id, indented opener, tilde opener);
  - an unclosed display fence while streaming;
  - a block that appears only once its closing fence arrives;
  - a closed block followed by an unclosed one with the same id;
  - a display fence nested inside an outer fence.

### Task 3.2: parser REWRITE (nested layout grammar): COMPLETE

- `ptah-ui-parser.ts` (rewritten; grammar structure only)
  - Recursive descent: `parseItems(state, depth, out)` reads siblings at `depth`. A line's depth is its leading spaces / 2.
    - An odd indent is a `depth` failure.
    - A line deeper than the current depth is a `depth` failure that keeps the 610 wording "unexpected indented line".
    - A line at a lower depth ends the container.
    - Blank lines between items are skipped.
  - Every depth failure reads `<reason> (line N, expected depth D)`, as the plan's Risks table asks.
  - Element bodies sit at exactly depth+1 (`isBodyLine` / `bodyContent`), so a valid 610 block parses to the same document.
  - Containers (EBNF `ckw`):
    - `row` and `col` take no text.
    - `grid N`: N from 1 to 4. `grid 0` is `syntax`. `grid 5` is `limit` "maxGridColumns (4) exceeded".
    - `card [t]`.
    - `section t` and `accordion t`: text required.
    - A container with no child is invalid.
  - `title` is allowed only at depth 0, and only as the first element.
  - Atoms:
    - `note ntone text` and `badge tone text`: an unescaped pipe is literal and `\|` decodes to a pipe.
    - `progress label | pct [| tone]`: pct is a `udecimal` from 0 to 100, literal only.
    - `avatar name [| subtitle]`.
  - Catalog caps, all reported in the validator's limit words:
    - `maxTreeDepth (8) exceeded`: an item at depth d has tree depth d+1.
    - `maxChildrenPerNode (50) exceeded`: stats count one child per statline, as the converter expands them.
    - `maxComponents (200) exceeded`.
  - Body caps (8,192 bytes, 200 lines) and the control-character check are unchanged.
- `ptah-ui-values.ts` (new, split out of the parser)
  - `PTAH_UI_SOURCES` gains:
    - `agents`: scalars `total running completed failed tokens cost`; columns `name status tokens cost duration context`.
    - `limits`: scalars `lanes atLimit nearLimit unknown`; columns `lane window used state reset`.
  - `PTAH_UI_SOURCES` is re-exported from `ptah-ui-parser.ts`, so the converter's import is unchanged.
  - Statline parsing:
    - A statline has 2, 3 or 4 cells.
    - An empty trend is allowed only when a spark follows.
    - The trend regex is `^[+-]udecimal%?( +good|bad)?$`.
    - A spark needs at least 2 numbers in 610 number form.
  - Scalars are `$src.field` or `$agents.session.field`.
  - Row sources are `$src` or `$agents session`.
  - `session` after any other source, or misspelt, is a `syntax` failure.
  - `isName` now accepts camelCase (`atLimit`).
- `ptah-ui-lexical.ts` (new, split out of the parser)
  - Holds the lexical helpers moved unchanged from the old parser: `splitLines`, `parseCells`, `decodeText`, `headerText` and the number checks.
  - Also holds the failure constructors.
  - `parseCells` now takes content with the indentation already removed. The caller enforces the indentation.
- `ptah-ui-parser.spec.ts`: the 610 cases are kept, with one forced change, explained under Risk 1 below. The new `describe('parsePtahUi R3 nesting delta')` covers the following.
  - 610 compatibility:
    - every `PTAH_UI_CORPUS` case parses;
    - every corpus case, re-based one level under `col`, deep-equals its flat parse;
    - a 610 statline gets no `trend` / `spark` key.
  - A valid and an invalid case for each lexical-delta row: keywords, indentation, element bodies, `title`, pipes, scope keyword, sources, empty container, numbers.
  - The R3.4 fixture list:
    - a three-space indent;
    - a depth jump of two;
    - an empty `row`;
    - `grid 0` and `grid 5`;
    - a `title` inside a container;
    - a scalar as a `progress` value;
    - pct 100.0 (valid) and 100.1 (invalid);
    - a trend with no spark, and an empty trend with a spark;
    - a one-point spark;
    - CRLF line endings at depth 2.
  - R3.3 limits, each at the limit and one over:
    - `maxTreeDepth`;
    - `maxChildrenPerNode`, including the statline-expansion count;
    - `maxComponents`: exactly 200 is valid. One over cannot be reached, because the 200-line cap (`too-many-lines`) fires first, and the spec pins that.
    - `maxGridColumns`.
  - The `session` grammar cases from R5.11.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui.types.ts`: node, container and atom types; `scope`; new failure codes; display fields on the fence segment.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.ts`: the `display [id]` opener; only closed fences become segments.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.spec.ts`: 26 new display-opener cases.
- MODIFIED (rewritten) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.ts`: the R3 nested grammar, depth and catalog caps (606 lines).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.spec.ts`: R3, R3.3, R3.4 and R5.11 fixtures, plus the corpus re-basing checks.
- CREATED (out of list) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-values.ts`: `PTAH_UI_SOURCES`, statline, trend, spark, scalar and row-source parsing (217 lines).
- CREATED (out of list) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-lexical.ts`: lexical helpers and failure constructors (145 lines).
- MODIFIED (out of list) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.ts`: only the change needed to keep the build compiling (see below).
- MODIFIED (out of list) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts`: only the change needed to keep the build compiling (see below).

## Out-of-list files and why

1. **`ptah-ui-lexical.ts` and `ptah-ui-values.ts` (new).**
   - The rewritten parser was 920 lines. The first verification run showed a new `max-lines` warning (861 counted lines against the repository's limit of 700), which took lint from 6 warnings to 7.
   - I split it by responsibility:
     - grammar structure stays in `ptah-ui-parser.ts` (606 lines);
     - value and source references go to `ptah-ui-values.ts`;
     - lexical rules and failures go to `ptah-ui-lexical.ts`.
   - Public exports are unchanged: `parsePtahUi` and `PTAH_UI_SOURCES` still come from `./ptah-ui-parser`.
   - Lint is back to the 6 baseline warnings. The one shown in the tail is the existing `surface.schemas.ts` warning at 758 lines.
2. **`ptah-ui-converter.ts` and `ptah-ui-resolver.ts`.**
   - The batch's own gate, `nx typecheck @ptah-extension/shared`, cannot pass with only the Batch 3 files changed, for three reasons:
     - The widened `PtahUiDocument.elements` breaks the converter's `switch`: it is no longer exhaustive, so TS2366 is raised.
     - The resolver's `scalarValue` `switch` is not exhaustive over the new `agents` / `limits` source names.
     - The resolver's `snapshot[name]` lookup gives TS7053 for `agents` / `limits`.
   - I made the smallest changes that keep the types sound and do not take Batch 4 or Batch 5 work:
     - **Converter.** It still emits the 610 flat `/3` shape. A container, a new atom, or a statline with a trend or spark makes it throw an `Error` from `notConvertible(...)`.
       - `renderPtahUiBlock` already catches throws (`ptah-ui-pipeline.ts`, `catch → 'internal error'`). So a block that uses the new grammar falls back atomically to a code block in the window before Batch 4. It never produces a partial surface.
       - Task 4.1 replaces this seam when it switches the converter to `/4`.
       - Existing 610 conversion is byte-identical.
     - **Resolver.** `agents` and `limits` resolve to `'unavailable'`, as scalars and as row sources. That is the 610 rule for a source with no input, and the same rule Task 5.1 states ("missing source → unavailable"). Task 5.1 replaces it with the real inputs.
   - Same lib, same rollback boundary as the Batch 1 `surface-bindings.ts` precedent.
   - The converter, resolver and pipeline specs were not run. They are not in the Batch 3 command. I checked that no case in them uses the new keywords or sources: the only parser-message pin is `unknown element \`gauge\` (line 1)`, which is unchanged. Batches 4 and 5 run those specs.

## How each listed risk and edge case was handled

1. **HIGH: the parser rewrite could break 610 fences (existing spec cases must stay unchanged).**
   - Every existing `ptah-ui-parser.spec.ts` case still passes unchanged except one: `rejects note because it belongs to PR D`.
     - That case asserted `note info Later` is invalid. R3 makes `note` valid: the task description says it "folds 610 PR D", and the R3 EBNF has `note(d)` with "610 PR D, unchanged spelling".
     - The case cannot stay as it was, so it is now `accepts note now that R3 folds in PR D`, with an exact `toEqual`.
     - This is the only existing case whose assertion changed.
   - Messages pinned by other specs are unchanged: `source \`usage\` has no columns (line 1)` and `unknown element \`gauge\` (line 1)`.
   - New evidence that 610 output is unchanged:
     - every corpus case parses;
     - each corpus case, re-based one level under `col`, gives children that deep-equal its flat parse. This shows depth-relative bodies reproduce 610 exactly;
     - a 610 statline produces no `trend` / `spark` key.
   - Task 6.2's converter corpus deep-equal remains the end-to-end check.
2. **Fences without `display` behave as before.**
   - Inline segments carry no new keys, so all 11 existing `toEqual` fence cases are unchanged and pass. One new case asserts that `target` and `displayId` are absent.
   - **Plan deviation.** The plan says `target: 'inline'|'display'`. I typed it as optional `target?: 'display'`, absent meaning inline. With a required `target: 'inline'`, the existing `toEqual` fence cases (and the "610 fences unchanged" note) would fail. Consumers check `segment.target === 'display'`.
3. **Unclosed fences never yield a block.**
   - An opener with no matching close (including a display opener) stays markdown. This is the existing `findPtahUiClose` behaviour, kept for all three openers.
   - Specs cover:
     - an unclosed display fence while streaming;
     - a block that appears only when the closing fence arrives;
     - a closed block followed by an unclosed one with the same id, where the second stays markdown.
4. **Depth and size caps.**
   - The parser rejects caps before conversion, using the validator's limit words: `maxTreeDepth`, `maxChildrenPerNode`, `maxComponents` and `maxGridColumns`.
   - Each limit has a case at the limit and one over. `maxComponents` one-over is pinned as `too-many-lines`, explained above.
   - Recursion depth is bounded at 8 because the depth check runs before any container recurses.
   - Body caps are unchanged and their existing cases pass.
5. **Reserved `ptah.` id.**
   - The fence accepts it on purpose and records `displayId: 'ptah.turn'`. The block therefore reaches the pipeline, which rejects it with a reason (R2.5 / D11, Task 5.1). It does not silently become an ordinary code block.
   - The `'reserved-id'` failure code exists for that task.

## Verification

Command (from batches.md "Batch 3 verification"), run in the foreground:

`npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-fence.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40 && npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20 && npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`

The command ran twice. Each run checked different code, so neither was run again just to read its output:

- **Run 1:** jest 180/180 passed; typecheck passed; lint 0 errors and 7 warnings. The new warning was `max-lines` on `ptah-ui-parser.ts`. I identified it with a lint of only the changed files (`npx eslint <7 changed files>`).
- **Run 2 (after the split):**

  ```text
  Test Suites: 2 passed, 2 total
  Tests:       180 passed, 180 total
  > tsc --noEmit --project libs/shared/tsconfig.lib.json
  NX  Successfully ran target typecheck for project @ptah-extension/shared
  757:1  warning  File has too many lines (758). Maximum allowed is 700  max-lines
  ✖ 6 problems (0 errors, 6 warnings)
  NX  Successfully ran target lint for project @ptah-extension/shared
  ```

Other notes:

- Six warnings is the same baseline as Batches 1 and 2. The `surface.schemas.ts` 758-line warning shown above was already present.
- Nx Cloud printed "organization disabled (401)". It is unrelated and has no effect on the local results.
- Between the two runs I used one plain `tsc --noEmit -p libs/shared/tsconfig.lib.json`, which came back clean, to confirm the split compiled.
- Not run, by instruction: the `@ptah-extension/declarative-dashboard` typecheck (known red until Batch 13), and every build, serve, e2e or workspace-wide target.

## Out-of-scope observations (not touched)

- `libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.ts`
  - `hasPtahUiFenceLine` still matches only the exact `` ```ptah-ui `` opener, so the eager gate does not open for a message whose only fence is a display fence.
  - The plan already assigns the `display` extension to a later frontend task (implementation-plan.md:93, 880).
- In the window before the frontend display batches (C3, Batch 18), `segmentPtahUi` returns display fences as `kind: 'fence'` segments with `target: 'display'`.
  - `PtahUiMessageTextComponent` does not branch on `target` yet. When that lazy chunk is loaded for a message that also has an inline fence, a display fence in that message would render inline.
  - Nothing produces display fences before the hint and skill batches, and the branch must not be pushed before Batch 13 anyway.
- `surface.index.ts` does not yet re-export the new public types: `PtahUiNode`, the container and atom element types, `PtahUiStatItem`, `PtahUiTrend`, `PtahUiTone`, `PtahUiNoteTone`, `PtahUiSourceScope` and `PtahUiParseFailureCode`. The plan lists `surface.index.ts` under component 2, and a later batch should add them where consumers need them.

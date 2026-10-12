# Batch 29 report: A1 prompt hint and no-write-back fixtures

Executor: backend-developer. Both tasks are complete. The checks in the "Batch 29 verification" block pass. No git
commands were run.

## Task 29.1: `PTAH_UI_HINT`: COMPLETE

`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:7`. This is the full hint text, after the
template-literal escapes are removed:

> Use ```ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron;
> ```ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests
> $usage $agents $limits; the host supplies real values—never type them yourself. Load the ptah-surface-authoring skill
> for grammar and examples.

- **Size.** 371 characters and **87 tokens** (`gpt-tokenizer` `encode`, the same encoder the spec uses). The 610 hint
  was 77 tokens.
- **Within budget, `$limits` kept.** Under R8.1, `$limits` is dropped only when the hint is over 100 tokens. At 87
  tokens it stays. For the record, the hint would be 85 tokens without ` $limits`, so no text was omitted.
- **Gate unchanged.** The hint gate in `sdk-query-options-builder.ts` was not edited. The builder still appends
  `PTAH_UI_HINT` at line 321.
- **R8.3.** The hint does not name the `session` scope, the `context` field or any row field.
- **Words dropped from the 610 hint.** "comparisons" and the comma-separated "reference $diff, $tests, or $usage" were
  removed to make room for the display target and the id-update rule.

Spec: `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts` has 7 tests.

| Line | Test | What it proves |
| --- | --- | --- |
| :24 | `stays within the 100-token budget` | R8.1 |
| :28 | `points to the on-demand skill without advertising deferred elements` | `ptah-surface-authoring` is named and nothing matches `/note/i` |
| :33 | `says that the host supplies values for every available source` | "the host supplies" and the exact run `$diff $tests $usage $agents $limits` are present |
| :40 | `names the display target and the id-update rule` | ```` ```ptah-ui display [id] ```` and "reusing an id updates it in place" are present |
| :45 | `keeps the session scope and row fields in the skill only (R8.3)` | the words `session` and `context` are absent |
| :50 | `uses only parseable ptah-ui examples` | kept from 610; the regex also matches `display [id]` openers now |
| :61 | `names an opener and sources that the fence grammar accepts` | see below |

**Edge case: the "examples parse" check.** The hint has no full example fence, because one would cost about 19
tokens and push it to 106. So the example-parse test at :50 checks nothing for this text. The test at :61 adds a real
check:

- It takes the display opener from the hint, replaces `[id]` with `turn-stats`, and confirms that `segmentPtahUi`
  yields `{kind:'fence', target:'display', displayId:'turn-stats'}`.
- It confirms that a `stats` line naming each listed source (`$<source>.<scalar>`) passes `parsePtahUi`.
- The first attempt used `table $<source>`. It failed for `$usage`, which has no columns
  (`ptah-ui-values.ts:30`), so the test now uses one scalar per source.

## Task 29.2: host-data sentinel specs: COMPLETE

The sentinels are the same in both specs:

- `$agents` (R5.8): the name `zz_sentinel_623_agent` and the cost `0.623623`.
- `$limits` (R10.5): the lane `zz_sentinel_623_lane` and the used value `62.3623%`.
- Summary (R6.7): the summary has no sentinel of its own. It is built from the seeded turn's data, so its file path
  `zz_sentinel_610.ts` and its test label `A5_SENTINEL_TEST_LABEL` carry it. The comments in both spec files say this.

### `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts`

- **Sentinel list.** `SENTINELS` at :13 adds the four 623 sentinels. The two existing 610 tests, at :76 and :111, now
  also assert them against the provider prompt and the system hint.
- **New test at :157:** `keeps a prior display fence naming $agents and $limits raw, with no resolved host values`.
  - Input: a prior assistant ```` ```ptah-ui display agent-usage ```` fence that uses `$agents.total`,
    `$agents.cost`, `$limits.atLimit`, `table $agents` and `table $limits`.
  - It asserts that the fence reaches the provider prompt raw, and that the system hint names `$agents` and `$limits`.
  - It asserts that no sentinel appears in the provider prompt, the system hint, or the whole serialized `options`
    object. The options are serialized with a replacer that drops functions and repeated objects, so cyclic provider
    objects cannot throw.

### `libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`

New fixtures:

- **`$agents` data (:373).** The `AgentMonitorStore` the `$agents` adapter reads holds two sentinels, each costing
  `0.623623`:
  - a subagent whose `teammateName` is the sentinel name;
  - a CLI lane whose `displayName` is `<sentinel>_cli`.

  It is a `Pick<subagents | agentsOwnedBySession>` stub, the pattern `ptah-ui-agents.source.spec.ts:166-176` uses.
- **`$limits` data (:117).** The RPC stub answers `agent:getLanePlanLimits` with `LIMITS_RESULT`: the sentinel lane,
  used `62.3623%`.
- **Summary (:433).** The **real** `DisplayDockState` is provided and seeded through its public `setSummaries` with
  `buildTurnSummaryModel(buildTurnSourceSnapshot(...))` of the seeded turn.
- **Transcript text (:98).** The stored assistant text now also contains a ```` ```ptah-ui display agent-usage ````
  fence (`DISPLAY_FENCE_BODY`) that names `$agents` and `$limits`.
- **Sentinel lists.** `SENTINELS_623` (:135) is merged into `SENTINELS` (:149), so all five tests assert the 623
  sentinels against the `chat:continue` params.

New tests:

- **:540** `keeps $agents names and costs and $limits lanes and used values out of params and stored text (R5.8,
  R10.5)`.
  - Positive control: `renderPtahUiBlock` resolves the sentinel name, `$0.62`, the sentinel lane and `62.3623%` from
    the injected store and RPC. The `$agents` input is built by `agentsInputFrom` at :193, from the store's
    allow-listed fields.
  - It then asserts that no sentinel appears in the `chat:continue` params. It also checks the stored transcript: the
    raw references `$agents.cost` and `table $limits` are present, and no 623 sentinel is.
- **:575** `keeps the host-built turn summary out of the serialized chat:continue request (R6.7)`.
  - Positive control: `DisplayDockState.summaryFor(TAB_ID)` holds a model whose text contains the sentinel path and
    test label.
  - It then asserts that no sentinel appears in the params.
- **Unchanged.** The negative control at :494 is kept. I also fixed an index-signature access the TypeScript compiler
  reported there (TS4111): `params?.files` is now `params?.['files']`.

The specs fail closed: each boundary assertion follows a positive control, and the negative control proves that the
helper can fail.

## Verification

Each check was run once, one at a time, from the worktree root in bash. Every Jest call carried the required
`--moduleNameMapper`, `--coverage=false` and `--maxWorkers=2`.

| # | Command | Result |
| --- | --- | --- |
| 1 | `npx jest -c libs/backend/agent-sdk/jest.config.ts …/ptah-ui-hint.spec.ts …/sdk-query-options-builder.host-data.spec.ts` | 2 suites passed, **10/10 tests** |
| 2 | `npx jest -c libs/frontend/chat/jest.config.ts …/message-sender.host-data.spec.ts` | 1 suite passed, **5/5 tests**, re-run once after the TS4111 fix |
| 3 | `npx nx lint @ptah-extension/agent-sdk --parallel=1` | Succeeded: 0 errors, 50 warnings |
| 4 | `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` | Succeeded |
| 5 | `npx eslint` on the four changed files | exit 0, no output |
| 6 | `ptah_get_diagnostics` on the three spec files | see below |

- **Run 1 failed once first.** The first run had one failure, the `table $usage` case described under Task 29.1. The
  test was fixed and the suite re-run.
- **Lint warnings.** None of the 50 warnings are in the batch files: the direct eslint run on them was clean.
- **Diagnostics.** No errors in the two agent-sdk specs. The chat spec's only error was the TS4111 at the existing
  negative control, now fixed. The other errors reported are in sibling chat spec files this batch does not touch.
- **Not run.** `nx typecheck` and `nx lint` for chat were not run, because the batch verification block does not list
  them. The chat change is one spec, which `tsconfig.lib.json` excludes from typecheck; it is covered by the direct
  eslint run and the diagnostics.

## Risks and rulings

- **R8.1 budget.** Measured at 87 of 100 tokens. `$limits` kept; the count without it (85) is recorded above.
- **The `/note/i` ban.** Asserted. The hint contains no "note", including as part of "annotate" or "notes".
- **Gate unchanged (task-description R8.1).** `sdk-query-options-builder.ts` was not edited.
- **Vacuous example parse.** Replaced by checking the opener and the sources the hint actually names (Task 29.1).
- **Sentinel through serialization (610 lesson).** `0.623623` serializes unchanged, unlike `0.610610`, and
  `62.3623%` is a string. Both are asserted in their serialized form.
- **Real data, not hypothetical.** Every 623 sentinel is first shown to resolve through the real `renderPtahUiBlock`,
  or to sit in the real `DisplayDockState`, before its absence is asserted.
- **Lazy-closure rule (D14).** The chat spec imports `buildTurnSummaryModel` statically from
  `@ptah-extension/chat-ui/turn-recap`, as `chat-transcript.display.spec.ts:73` already does. Specs are not part of
  the app's eager closure, and no production import changed.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\batch-29-report.md`

## Out of scope

- `measurement.md` (Batch 31) should record the hint text above, its 371 characters and 87 tokens, and the
  85-token count without `$limits`.
- The skill copies (Batch 30) must document `$limits` and the display/id rules, because the hint now points agents to
  them.

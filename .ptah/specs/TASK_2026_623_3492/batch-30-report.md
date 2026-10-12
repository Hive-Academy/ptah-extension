# Batch 30 report: DOC1 `ptah-surface-authoring` skill text

Executor: technical-content-writer. No git commands run. `PTAH_UI_HINT` untouched (decision #136/#140).

## Files

Task 30.1 (modified; the 610-era files existed and were rewritten):

- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\catalog.md

Task 30.2 (mirror, byte-identical copies of the three above):

- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\SKILL.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\ptah-ui.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\catalog.md

Report: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.ptah\specs\TASK_2026_623_3492\batch-30-report.md

## Task 30.1 evidence

- `SKILL.md`: source list (`$diff $tests $usage $agents $limits`, `session` scope), the `display [id]` target and replace-by-id rule, pointers to both references.
- `references/ptah-ui.md`:
  - Targets, display and id rules: opener grammar from `ptah-ui-fence.ts` (`readPtahUiOpener`, `isDisplayId`, `SURFACE_ID_PATTERN`, `maxSurfaceIdLength` 128), `ptah.` reserved prefix from `ptah-ui-pipeline.ts:46-54`, anonymous vs `id:` surfaces from `display-surfaces.ts:137`, unclosed fence stays markdown (`ptah-ui-fence.ts` close search).
  - R3 EBNF (depth-relative `IND(d)`, containers, atoms, trend/spark, `session` scope) and lexical table, checked against `ptah-ui-parser.ts`, `ptah-ui-lexical.ts`, `ptah-ui-values.ts` (keywords, grid 1..4, even indentation, title depth 0, 2/3/4-cell statlines, trend regex, spark >= 2 points, progress <= 100, `session` only after `$agents`).
  - Sources table from `PTAH_UI_SOURCES` (`ptah-ui-values.ts:19-39`).
  - `$agents`: context rule from `agentContextText` / `recordContext` (`ptah-ui-agents-source.ts:232-250,444-450`), CLI lanes `context: null` (`:427`), unavailable never 0, session scope and row cap from task-description R5.7/R5.11.
  - `$limits`: scalars/columns from `PTAH_UI_SOURCES`; pending/unavailable, "as of", first-appearance lane list, "+N more" from `ptah-ui-resolver.ts:201-217,370-403`.
  - Budgets from `SURFACE_LIMITS` (`surface-catalog.ts:160-172`).
  - Common mistakes: `session` misuse (each invalid form traced to `parseScalar`/`sessionScope`), CLI context, indentation (`depthFailure`, odd-indent check), body depth in containers, cols/list bodies, empty containers, reserved ids, partial updates, dollars, trend/spark/progress numbers.
- `references/catalog.md`: kept the 19 `/3` entries untouched; appended a `## dashboard-catalog/4 kinds` section with no `###` headings and no fences, so `surface-catalog-reference.spec.ts` (exactly one json example per `/3` kind) still holds. Covers `accordion`, `avatar`, `stat.trend`, `stat.spark` from `surface.schemas.ts:528-577`, `surface-catalog.ts:68-90`, `surface.types.ts`; states that `/4` is not accepted by `ptah_surface_update` (`surface.validator.ts:355-385`). Accordion has only `actions` optional; spark ceiling is `maxSeriesPoints` 5,000.

## Corpus mapping (every ptah-ui fence in ptah-ui.md)

| Example in ptah-ui.md | Corpus case |
| --- | --- |
| Subagent usage dashboard (`display subagent-usage`) | `skill-subagent-usage-dashboard` |
| Id update, first block (`display build-progress`) | `skill-id-update-first` |
| Id update, second block (`display build-progress`) | `skill-id-update-second` |
| CLI tools list with usage and context (`display cli-tools`) | `skill-cli-tools-usage-context` |
| Turn summary | `turn-summary-sources-crlf` |
| Literal table with escapes | `literal-table-escapes-unicode` |
| Changed files | `changed-files-columns` |
| Test runs | `test-run-list` |
| Line chart | `coverage-trend-chart` |
| Mixed flat block | `release-checklist-mixed` |
| Grid of source stats | `container-grid-stats` |
| Accordion | `container-accordion-tests` |
| Notes | `atom-note-tones` |
| Progress | `atom-progress-tones` |
| Trend and spark | `stat-trend-spark` |
| Nested layout | `mixed-nested-release` |

Checked by a throwaway script (/tmp/v30/check.js, outside the repo): 16 `ptah-ui` fences, 0 mismatches against corpus body and opener (display id included). The CRLF case is shown with LF; the compared body normalises line endings.

## Task 30.2 evidence

`cp -r` of the asset directory over `.claude/skills/ptah-surface-authoring`; `diff -r` of the two trees printed nothing, exit 0.

## Verification commands (run one at a time)

1. `diff -r apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring .claude/skills/ptah-surface-authoring` : no output, exit 0.
2. `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts ... --maxWorkers=2`: 1 suite passed, 31 tests passed.
3. Extra guard, because catalog.md changed: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts .../surface-catalog-reference.spec.ts ... --maxWorkers=2`: 1 suite, 4 tests passed.

## Notes for the team-leader

- Nothing in the skill claims a CLI context percent; it states CLI `context` is `unavailable` today.
- Claims that rest on task-description rather than code lines I could open (turn/session scoping, "+N more" for `$agents`, `$limits` read only when a block resolves) are written from R5.5/R5.7/R5.11/R10.1; the resolver/agents module implement the row cap and notes. Not independently tested here.
- `content-manifest.json` is not regenerated (Batch 31).

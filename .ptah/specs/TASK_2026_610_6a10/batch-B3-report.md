# Batch B3 report

## Corpus cases

- `turn-summary-sources-crlf`
- `literal-table-escapes-unicode`
- `changed-files-columns`
- `test-run-list`
- `coverage-trend-chart`
- `release-checklist-mixed`

The corpus covers title and source stats, a literal table, `$diff` table columns,
`$tests` list, a chart, and a mixed agent update. Its valid grammar edges cover CRLF,
`\|`, `\\`, `\$`, an empty table cell, Unicode, and a literal mid-cell `$`.

## Compactness

Counts use `gpt-tokenizer` 4.0.0. The comparison is the fence body as authored versus
`JSON.stringify(convertPtahUi(parsePtahUi(body).doc, 'ptah-ui-corpus'))`: compact JSON,
with bindings unresolved, exactly as Req 5.13 requires.

| Corpus case | Fence tokens | JSON tokens | Fence / JSON |
| --- | ---: | ---: | ---: |
| turn-summary-sources-crlf | 39 | 193 | 0.202 |
| literal-table-escapes-unicode | 41 | 123 | 0.333 |
| changed-files-columns | 19 | 129 | 0.147 |
| test-run-list | 8 | 81 | 0.099 |
| coverage-trend-chart | 35 | 109 | 0.321 |
| release-checklist-mixed | 70 | 218 | 0.321 |

Every fence count is lower than its unresolved conversion JSON count.

## Trust cases

- Markdown stays literal in titles, stat/table cells, list items, and chart labels.
- `<script>` and `<img onerror>` stay literal in those positions.
- `javascript:` and `https:` text stays literal in those positions.
- HTML entities stay literal in those positions.
- Converted surfaces have no `url`, `actions`, or `data` property, and no input component kind.
- A validator byte-budget breach returns a reason naming `maxSurfaceBytes`.
- Every corpus case renders with `ok: true`.

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts`: 2 suites, 53 tests passed.
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit`: passed (exit code 0).

## Defects found

None in the pipeline during this batch's focused trust, corpus, compactness, and type checks.

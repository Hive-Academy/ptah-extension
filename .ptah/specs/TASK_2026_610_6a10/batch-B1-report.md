# Batch B1 report — ptah-ui fence segmentation and parser

## Delivered API

| File | Public API |
| --- | --- |
| `libs/shared/src/mcp-apps-contracts/ptah-ui.types.ts` | `PtahUiDocument`, `PtahUiElement`, element/source/value types, `PtahUiParseResult`, `PtahUiSegment` |
| `libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts` | `segmentPtahUi(text: string): PtahUiSegment[]` |
| `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts` | `PTAH_UI_SOURCES`, `parsePtahUi(body: string): PtahUiParseResult` |

The source table is deliberately limited to `diff`, `tests`, and `usage`; `$context` rejects as unknown, per Req 3.10 at `task-description.md:532-536`.

## Grammar-to-test traceability

| EBNF production or lexical row | Tests |
| --- | --- |
| `fence`, `body`, `blank`, `NL` | `segments a closed ptah-ui fence and preserves its raw body`; `accepts CRLF lines`; `keeps an unclosed ptah-ui fence as markdown for streaming` |
| `element`, `title` | `parses every implemented production in a document`; `rejects a title that is not first or repeated`; `rejects an empty title` |
| `stats`, `statline`, `value`, `scalar`, `vcell` | `recognizes a stats scalar and distinguishes an escaped dollar`; `requires a stats value beginning with a bare dollar to be a scalar`; `allows a literal dollar at the start of a stats label`; `rejects an empty stats cell`; `rejects a row source as a stats value` |
| literal and source `table`, `tablerow`, `colsline` | `allows an empty table cell`; `allows a literal dollar at the start of a table cell`; `rejects a ragged literal table row`; `accepts valid known cols`; `rejects an unknown cols name`; `rejects repeated cols names`; `rejects a scalar as a table argument` |
| literal and source `list`, `item` | `accepts a known table and list row source`; `rejects a scalar as a list argument`; `rejects an empty list item` |
| `chart`, `point`, `number` | `accepts a grammar number`; `allows a literal dollar at the start of a chart label`; `rejects non-grammar chart number 1e3`; `rejects non-grammar chart number 1,000`; `rejects an empty chart title`; `rejects an empty chart label` |
| `note` deferred | `rejects note because it belongs to PR D` |
| `rowsource`, `name`, source definitions | `accepts a known table and list row source`; `rejects an unknown source including $context`; `rejects an unknown scalar field` |
| keywords/tokens exact lowercase | `requires exact lowercase keywords`; `rejects an unknown element keyword` |
| header/body column rules | `rejects a three-space body indent` |
| control characters | `rejects tabs and other controls` |
| escaped pipe | `decodes escaped pipe, backslash and dollar` |
| escaped backslash | `decodes escaped pipe, backslash and dollar` |
| escaped dollar | `recognizes a stats scalar and distinguishes an escaped dollar`; `requires a stats value beginning with a bare dollar to be a scalar`; `decodes escaped pipe, backslash and dollar` |
| invalid escape | `rejects a stray escape` |
| unescaped pipe in text | `allows an unescaped pipe in text` |
| empty text/cell distinctions | `rejects an empty title`; `rejects an empty list item`; `rejects an empty chart title`; `allows an empty table cell`; `rejects an empty stats cell`; `rejects an empty chart label` |
| Unicode | `accepts Unicode text and cells` |
| byte/line caps | `accepts a body of exactly 8,192 UTF-8 bytes`; `rejects a body of 8,193 UTF-8 bytes before parsing`; `rejects more than 200 lines before parsing` |
| outer-fence tracking | `does not treat a target fence inside a backtick outer fence as a block`; `does not treat a target fence inside a tilde outer fence as a block`; `does not treat a target fence inside a two-space indented outer fence as a block`; `recognizes a three-space indented outer fence`; `does not treat a four-space indented line as an outer opener`; `requires an outer close to use the opening marker and enough characters` |

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-fence.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts` — passed: 2 suites, 43 tests.
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` — passed.

## Grammar interpretation

The corrected grammar makes `$` a normal `cchar` (`task-description.md:348`). Its only source position is the beginning of a stats value (`value = scalar | vcell`, `task-description.md:327-328`): `$diff.files` parses as a scalar, `$5.00` rejects because it is not one, and `\$5.00` is literal. In every other cell position — including a literal table cell, stats label, and chart label — leading and mid-cell dollars are literal (`task-description.md:367`). This preserves the required `$diff.files` versus `\$diff.files` distinction.

The target opener remains the normative exact ```` ```ptah-ui ```` form at column 0 (`implementation-plan.md:428`). General outer backtick/tilde fences accept CommonMark's zero-to-three leading spaces, while four spaces remain an indented code block; this tracking only suppresses nested target fences (`implementation-plan.md:427`).

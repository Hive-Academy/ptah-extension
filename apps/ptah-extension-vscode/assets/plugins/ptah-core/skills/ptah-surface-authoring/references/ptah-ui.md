# ptah-ui reference

Use a `ptah-ui` block for compact summaries, recaps, statistics, and comparisons in Ptah chat. The host fills `$diff`, `$tests`, and `$usage` for the message turn. Reference those sources instead of typing file lists, test counts, or costs already available to the host.

Valid blocks render only in the Ptah Electron app. If parsing fails, the whole block is shown as ordinary code with a short reason line.

## Normative EBNF

Trailing spaces at the end of any line are removed before parsing.

````text
fence      = "```ptah-ui" NL body "```" ;          (* info string exactly "ptah-ui"; closing line exactly "```" *)
body       = { blank } element { { blank } element } { blank } ;
blank      = NL ;                                   (* a line that is empty after trailing-space removal *)
element    = title | stats | table | list | chart ;

title      = "title" SPS text NL ;                  (* at most one; must be the first element *)
stats      = "stats" NL statline { statline } ;     (* 1..8 statlines *)
statline   = IND cell BAR value NL ;                (* exactly two cells, both non-empty *)
value      = scalar | vcell ;                       (* a value that starts with "$" is always a scalar *)
vcell      = ( cchar - "$" ) { cchar } ;           (* a literal value cannot start with a bare "$"; write "\$" *)
table      = "table" NL tablerow tablerow { tablerow }      (* literal: header row, then 1..N rows *)
           | "table" SPS rowsource NL [ colsline ] ;
tablerow   = IND cell { BAR cell } NL ;             (* every row has the header's cell count; cells may be empty *)
colsline   = IND "cols" SPS name { BAR name } NL ;  (* names from the source's row columns, no repeats *)
list       = "list" NL item { item }
           | "list" SPS rowsource NL ;
item       = IND "- " text NL ;
chart      = "chart" SPS ( "line" | "bar" ) SPS text NL point { point } ;
point      = IND cell BAR number NL ;               (* label cell non-empty *)
rowsource  = "$" name ;                             (* source with no field *)
scalar     = "$" name "." name ;                    (* source plus field *)
name       = lower { lower } ;
lower      = "a" | "b" | ... | "z" ;
number     = [ "-" ] digit { digit } [ "." digit { digit } ] ;
text       = tchar { tchar } ;                      (* non-empty after trimming surrounding spaces *)
cell       = { cchar } ;                            (* surrounding spaces trimmed *)
tchar      = escape | char - "\" ;
cchar      = escape | char - ( "\" | "|" ) ;        (* "$" is literal in cells; only a value's first char is a source position (see vcell, lexical table) *)
escape     = "\|" | "\\" | "\$" ;
BAR        = "|" ;                                  (* unescaped; spaces around it belong to the trimmed cells *)
IND        = SP SP ;                                (* exactly two; the next character is not SP *)
SPS        = SP { SP } ;
SP         = U+0020 ;
NL         = U+000A | U+000D U+000A ;
char       = any Unicode scalar value - ( U+0000..U+001F | U+007F ) ;   (* excludes TAB, CR and LF *)
````

## Lexical table

| Item                                     | Rule                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keywords and tokens                      | `title stats table list chart cols line bar` are lowercase and exact. Any other header word makes the block invalid.                                                                                                                                                 |
| Header lines                             | Start at column 0. Body lines start with exactly two spaces then a non-space character. Three or more spaces, or one, is invalid.                                                                                                                                    |
| Tab, other control characters            | Invalid anywhere in the body (excluded from `char`).                                                                                                                                                                                                                 |
| Escaped pipe (backslash, pipe)           | Decodes to a literal pipe inside a cell or text. An unescaped pipe is a cell separator in cell lines (`statline`, `tablerow`, `colsline`, `point`). In `text` positions (title, chart title, list item) an unescaped pipe is a literal character.                    |
| Escaped backslash (backslash, backslash) | Decodes to a literal backslash, in cells and in text.                                                                                                                                                                                                                |
| Escaped dollar (backslash, dollar)       | Decodes to a literal `$`. It is needed only where a `$` would otherwise start a source reference: the start of a `value` cell, or a `table`/`list` argument. A `$` anywhere else (inside text, inside a table row cell, or mid-cell) is literal and needs no escape. |
| Any other `\` sequence                   | Invalid, including a trailing lone `\`.                                                                                                                                                                                                                              |
| Source reference                         | Recognised only in a `stats` value (`scalar`) and as the `table`/`list` argument (`rowsource`). A scalar in a table argument, or a row source in a stats value, is invalid.                                                                                          |
| Empty text                               | Invalid for `title`, the `chart` title, `note` text and list items, after trimming.                                                                                                                                                                                  |
| Empty cell                               | Valid in `tablerow`. Invalid in `statline` (both cells) and in a `point` label.                                                                                                                                                                                      |
| Numbers                                  | Only `number` is accepted in a chart point: no `+`, exponent, thousands separator or unit.                                                                                                                                                                           |
| Unicode                                  | Any non-control character is allowed in `text` and `cell`, and renders as plain text.                                                                                                                                                                                |

## Dollar rules

`$` is literal in a table cell, except when it starts a `stats` value source reference. For example, `$5.00` is valid in a table cell. In a `stats` value, write `\$5.00` for a literal price; a bare `$5.00` is interpreted as a source attempt and is invalid. Use `$diff.files`, `$tests.passed`, or `$usage.cost` only as a stats value; use `$diff` or `$tests` for source-backed tables and lists.

## Sources

Every source is scoped to the turn containing the block. `list $source` lists the first row column only.

| Source   | Scalars (type)                                               | Rows (columns)                                                                                                  | Backed by                               |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `$diff`  | `files` int; `additions` int; `deletions` int                | `path` string, `status` A/M/D/R/U, `additions` int or null, `deletions` int or null (default columns: all four) | `TurnChangeSet` in the change-set store |
| `$tests` | `total`, `passed`, `failed`, `unknown` int                   | `command` string, `outcome` passed/failed/unknown                                                               | Req 1.2 detection                       |
| `$usage` | `input` int; `output` int; `cost` USD or null; `duration` ms | none                                                                                                            | `ExecutionChatMessage`                  |

## Limits and release elements

A fence body is at most 8,192 UTF-8 bytes and 200 lines. This release supports `title`, `stats`, `table`, `list`, and `chart`.

## Worked examples

### turn-summary-sources-crlf

```ptah-ui
title Release readiness
stats
  Files changed | $diff.files
  Tests passed | $tests.passed
  Prompt cost | $usage.cost
  Quoted budget | \$5
```

### literal-table-escapes-unicode

```ptah-ui
title Migration notes
table
  Check | Detail | Owner
  Schema \| contract | \\ | Priya
  Price | $5 today | équipe
  Empty detail |  | 東京
```

### changed-files-columns

```ptah-ui
title Files prepared for review
table $diff
  cols path | additions | deletions
```

### test-run-list

```ptah-ui
title Verification runs
list $tests
```

### coverage-trend-chart

```ptah-ui
title Coverage trend
chart line Coverage by run
  Baseline | 72.4
  Parser | 78.1
  Pipeline | 84.6
```

### release-checklist-mixed

```ptah-ui
title Release checklist
stats
  Reviewers | 2
  Risk | low
table
  Area | Status
  Parser | ready
  Renderer | queued
list
  - Run the focused shared tests
  - Attach the compactness report
chart bar Completed checks
  Draft | 1
  Verified | 3
```

## Common mistakes

- Do not exceed 8,192 bytes or 200 lines.
- Put `title` first and give it text; use at most eight stat lines.
- Indent body lines with exactly two spaces; do not use tabs or other control characters.
- Give stats exactly two non-empty cells, literal tables a header plus one row with matching cell counts, and literal lists at least one `- ` item.
- Use only `line` or `bar` charts, with a title and at least one non-empty-label numeric point.
- Follow a source table only with one valid, non-repeated `cols` line; use only columns provided by that source.
- Use only `\|`, `\\`, and `\$` escapes. Use a scalar source only for stats and a row source only for a table or list.

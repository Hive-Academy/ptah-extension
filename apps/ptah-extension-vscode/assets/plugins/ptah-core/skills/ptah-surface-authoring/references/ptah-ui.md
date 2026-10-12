# ptah-ui reference

Use a `ptah-ui` block for compact summaries, recaps, statistics, comparisons, subagent usage and CLI plan limits in Ptah chat. The host fills `$diff`, `$tests`, `$usage`, `$agents` and `$limits`. Reference those sources instead of typing file lists, test counts, costs, agent names or limits already available to the host.

Valid blocks render only in the Ptah Electron app. If parsing or validation fails, the whole block is shown as ordinary code with a short reason line; for a `display` block the panel keeps its previous content and nothing about the failure is sent back to you.

## Targets, display and ids

The opener line decides where the block renders. Trailing spaces on the opener are ignored; the parts are separated by exactly one space.

| Opener                      | Result                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| ` ```ptah-ui `              | Inline in the message.                                                                         |
| ` ```ptah-ui display `      | Sent to the display panel. With no id, every such block creates a new panel surface.           |
| ` ```ptah-ui display <id> ` | Sent to the display panel under `<id>`. A later valid block with the same id replaces it.      |

Rules:

- `<id>` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$` and is at most 128 characters. No colon, no space.
- Ids starting with `ptah.` belong to the host. A `display` block that uses one is invalid and falls back to a code block with a reason.
- Any other info string that begins `ptah-ui` (for example `ptah-ui sidebar` or `ptah-ui display a b`) is an ordinary code block.
- An id update replaces the surface's content with the new block's content. Re-send the whole block, not a diff. Components whose content did not change keep their view state, such as an expanded accordion.
- Ids are scoped to the current chat tab's session. The same id in another tab is a different surface.
- A fence that is not closed yet (still streaming) stays markdown, and the panel is not touched until the closing ` ``` ` arrives. Blocks apply in transcript order, so the later block with an id wins.
- Both targets use the same body grammar below.

## Normative EBNF

Trailing spaces at the end of any line are removed before parsing. A line's depth is its leading spaces divided by two. `IND(d)` is exactly `2*d` spaces followed by a non-space.

````text
fence      = opener NL body "```" ;                 (* closing line exactly "```" *)
opener     = "```ptah-ui" [ SP "display" [ SP surfaceid ] ] ;
surfaceid  = idstart { idchar } ;                   (* 1..128 characters *)
idstart    = letter | digit ;
idchar     = letter | digit | "." | "_" | "-" ;

body       = { blank } [ title { blank } ] item(0) { { blank } item(0) } { blank } ;
blank      = NL ;                                   (* a line that is empty after trailing-space removal *)
title      = "title" SPS text NL ;                  (* at most one; depth 0 only; must be the first element *)
item(d)    = container(d) | element(d) ;
container(d) = IND(d) ckw NL item(d+1) { { blank } item(d+1) } ;   (* at least one child *)
ckw        = "row"
           | "col"
           | "grid" SPS gridcols                    (* "1" .. "4" *)
           | "card" [ SPS text ]
           | "section" SPS text
           | "accordion" SPS text ;                 (* collapsed by default *)
element(d) = stats(d) | table(d) | list(d) | chart(d) | note(d)
           | progress(d) | badge(d) | avatar(d) ;

stats(d)   = IND(d) "stats" NL statline(d+1) { statline(d+1) } ;     (* 1..8 statlines *)
statline(e)= IND(e) cell BAR value [ BAR trend [ BAR spark ] ] NL ;  (* 2, 3 or 4 cells; label and value non-empty *)
value      = scalar | vcell ;                       (* a value that starts with "$" is always a scalar *)
vcell      = ( cchar - "$" ) { cchar } ;           (* a literal value cannot start with a bare "$"; write "\$" *)
trend      = [ ( "+" | "-" ) udecimal [ "%" ] [ SPS polarity ] ] ;   (* empty only when a spark follows *)
polarity   = "good" | "bad" ;
spark      = number SPS number { SPS number } ;     (* at least 2 points *)
table(d)   = IND(d) "table" NL tablerow(d+1) tablerow(d+1) { tablerow(d+1) }   (* literal: header row, then 1..N rows *)
           | IND(d) "table" SPS rowsource NL [ colsline(d+1) ] ;
tablerow(e)= IND(e) cell { BAR cell } NL ;          (* every row has the header's cell count; cells may be empty *)
colsline(e)= IND(e) "cols" SPS name { BAR name } NL ;   (* names from the source's row columns, no repeats *)
list(d)    = IND(d) "list" NL item_(d+1) { item_(d+1) }
           | IND(d) "list" SPS rowsource NL ;
item_(e)   = IND(e) "- " text NL ;
chart(d)   = IND(d) "chart" SPS ( "line" | "bar" ) SPS text NL point(d+1) { point(d+1) } ;
point(e)   = IND(e) cell BAR number NL ;            (* label cell non-empty *)

note(d)     = IND(d) "note" SPS ntone SPS text NL ;
ntone       = "info" | "ok" | "warn" | "error" ;
progress(d) = IND(d) "progress" SPS cell BAR pct [ BAR tone ] NL ;   (* label non-empty; 0 <= pct <= 100 *)
pct         = udecimal ;
badge(d)    = IND(d) "badge" SPS tone SPS text NL ;
avatar(d)   = IND(d) "avatar" SPS cell [ BAR cell ] NL ;             (* name non-empty, optional subtitle *)
tone        = "neutral" | ntone ;

rowsource  = "$" name [ SPS "session" ] ;           (* "session" only after "$agents" *)
scalar     = "$" name [ ".session" ] "." name ;     (* ".session" only after "$agents" *)
name       = lower { letter } ;                     (* camelCase, e.g. "atLimit" *)
udecimal   = digit { digit } [ "." digit { digit } ] ;
number     = [ "-" ] digit { digit } [ "." digit { digit } ] ;
text       = tchar { tchar } ;                      (* non-empty after trimming surrounding spaces *)
cell       = { cchar } ;                            (* surrounding spaces trimmed *)
tchar      = escape | char - "\" ;
cchar      = escape | char - ( "\" | "|" ) ;
escape     = "\|" | "\\" | "\$" ;
BAR        = "|" ;                                  (* unescaped; spaces around it belong to the trimmed cells *)
SPS        = SP { SP } ;
SP         = U+0020 ;
NL         = U+000A | U+000D U+000A ;
char       = any Unicode scalar value - ( U+0000..U+001F | U+007F ) ;   (* excludes TAB, CR and LF *)
letter     = "a" .. "z" | "A" .. "Z" ;
lower      = "a" .. "z" ;
````

The flat grammar is the depth-0 case: a `stats`, `table`, `list` or `chart` at column 0 with its body at two spaces. Every block written that way is still valid.

## Lexical table

| Item                                     | Rule                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keywords and tokens                      | `title stats table list chart cols line bar row col grid card section accordion note progress badge avatar display session good bad neutral info ok warn error` are lowercase and exact. An unknown header word at any depth makes the block invalid.                |
| Indentation                              | A line's depth is its leading spaces divided by 2. An odd count, a tab, or a depth greater than the parent's depth + 1 is invalid. A line at depth `d` or lower ends the container at depth `d`.                                                                       |
| Element bodies                           | The body lines of `stats`, `table`, `list` and `chart` sit exactly one level deeper than their header: at depth 0 that is two spaces, inside a container at depth 1 it is four spaces.                                                                                |
| `title`                                  | At most one, at depth 0 only, and the first element. A `title` inside a container is invalid.                                                                                                                                                                         |
| Containers                               | `row` and `col` take no text. `grid` takes a column count from 1 to 4. `card` text is optional; `section` and `accordion` text is required. A container with no child item is invalid.                                                                                 |
| Tab, other control characters            | Invalid anywhere in the body (excluded from `char`).                                                                                                                                                                                                                  |
| Escaped pipe (backslash, pipe)           | Decodes to a literal pipe inside a cell or text. An unescaped pipe is a cell separator in cell lines (`statline`, `tablerow`, `colsline`, `point`, `progress`, `avatar`). In `text` positions (title, chart title, card, section and accordion text, note, badge, list item) an unescaped pipe is a literal character. |
| Escaped backslash (backslash, backslash) | Decodes to a literal backslash, in cells and in text.                                                                                                                                                                                                                 |
| Escaped dollar (backslash, dollar)       | Decodes to a literal `$`. It is needed only where a `$` would otherwise start a source reference: the start of a `value` cell, or a `table`/`list` argument. A `$` anywhere else is literal and needs no escape.                                                       |
| Any other `\` sequence                   | Invalid, including a trailing lone `\`.                                                                                                                                                                                                                               |
| Source reference                         | Recognised only in a `stats` value (`scalar`) and as the `table`/`list` argument (`rowsource`). A scalar in a table argument, or a row source in a stats value, is invalid. `trend`, `spark`, `progress`, `avatar` and `badge` take literal values only.               |
| Scope keyword                            | `session` is lowercase and exact. It is valid only in `$agents session` (row source) and `$agents.session.<scalar>`. After any other source, in any other position, or misspelt, the block is invalid.                                                               |
| Empty text                               | Invalid for `title`, the `chart` title, `note`, `badge`, `card`/`section`/`accordion` text and list items, after trimming.                                                                                                                                            |
| Empty cell                               | Valid in `tablerow`, and as the trend cell of a statline when a spark follows. Invalid in the label and value of a `statline`, in a `point` label and in a `progress` label or `avatar` name.                                                                          |
| Numbers                                  | Chart points use `number`: no `+`, exponent, thousands separator or unit. `progress` percent and `trend` use `udecimal`; the only unit is the trailing `%` on a trend. A `progress` percent above 100 is invalid.                                                      |
| Unicode                                  | Any non-control character is allowed in `text` and `cell`, and renders as plain text.                                                                                                                                                                                 |

## Dollar rules

`$` is literal in a table cell, except when it starts a `stats` value source reference. For example, `$5.00` is valid in a table cell. In a `stats` value, write `\$5.00` for a literal price; a bare `$5.00` is interpreted as a source attempt and is invalid. Use `$diff.files`, `$tests.passed`, `$usage.cost`, `$agents.total` or `$limits.lanes` only as a stats value; use `$diff`, `$tests`, `$agents` or `$limits` as the argument of `table` or `list`.

## Sources

Every source except `$limits` is scoped to the turn containing the block. `list $source` lists the first row column only. A source with no data yet reads `pending`, and a source the host cannot supply reads `unavailable`; neither is ever shown as 0.

| Source            | Scalars (type)                                                                                                    | Rows (columns)                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `$diff`           | `files` int; `additions` int; `deletions` int                                                                     | `path` string, `status` A/M/D/R/U, `additions` int or null, `deletions` int or null (default columns: all four) |
| `$tests`          | `total`, `passed`, `failed`, `unknown` int                                                                        | `command` string, `outcome` passed/failed/unknown                                                               |
| `$usage`          | `input` int; `output` int; `cost` USD or unavailable; `duration` ms                                               | none                                                                                                            |
| `$agents`         | `total`, `running`, `completed`, `failed` int; `tokens` int or unavailable; `cost` USD or unavailable             | `name`, `status`, `tokens`, `cost`, `duration`, `context`                                                       |
| `$agents session` | the same fields, written `$agents.session.<scalar>`                                                               | the same columns, written `table $agents session` or `list $agents session`                                     |
| `$limits`         | `lanes`, `atLimit`, `nearLimit`, `unknown` int (they count lanes, not rows)                                       | `lane`, `window`, `used`, `state`, `reset`                                                                      |

`$usage` has no columns, so `table $usage` and `list $usage` are invalid.

### `$agents`

- Rows list the turn's subagents and the CLI lanes. One logical agent is one row, however many records describe it; `total` equals the row count.
- `name` is the agent's name or type, never its task, description, prompt or output. None of those can reach a block.
- `status` is one of `pending`, `running`, `completed`, `failed` or `stopped`.
- `tokens`, `cost` and `duration` read `unavailable` when the host does not have the value, never 0. The scalars `$agents.tokens` and `$agents.cost` are `unavailable` when any row's value is unavailable.
- `list $agents` lists `name`. A table shows at most 1,000 rows and ends with a "+N more" note when rows are left out. A `list $agents` shows the first 1,000 names with no "+N more" note.
- Rows are ordered by turn, then by start time within the turn, then by key. Rows with no known start time sort last within their turn.
- **Turn scope.** `$agents` shows only agents that started in the block's own turn.
- **Session scope.** `table $agents session`, `list $agents session` and `$agents.session.<scalar>` cover every agent of the tab's session that started in the block's turn or an earlier turn, never a later one. An agent appears once whichever turn it started in. The session scalars count all rows in scope, including rows hidden by the row cap.
- **`context`.** The cell is the agent's last-request context.
  - Known tokens and a known window: the token count and the percent, for example `50,000 · 25%`.
  - Known tokens, window not known: the token count alone, with no percent. The host never guesses a window from the model name.
  - No token count: `unavailable`, never 0.
  - Agents run through a CLI lane carry no context figure today, so their `context` cell reads `unavailable`. Show CLI usage with `tokens`, `cost` and `duration`, and expect `context` to be `unavailable` for those rows.
  - Sorting by `context` orders by token count and puts `unavailable` rows last.
  - There is no `context` scalar: a sum of per-agent contexts has no meaning.
- After a reload, values the host holds only in memory render `unavailable`. They are not filled in from another turn.

### `$limits`

- Rows are the same plan-limit rows `ptah_agent_list` shows for the CLI lanes on this host: one row per lane per window, or one row for a lane with no windows. `lane`, `window`, `used`, `state` and `reset` are the host's own text, so a missing value reads as the list does (`unknown`, `reset unknown`, `-`), never `0%`.
- The scalars count lanes: `lanes` is the number of lanes, and `atLimit`, `nearLimit` and `unknown` count lanes in that state.
- `$limits` is current state, not tied to the turn. The table shows the read time as "as of HH:MM". The host reads plan limits only when a valid `$limits` block is resolved.
- `list $limits` lists each lane once, in first-appearance order. A table shows at most 1,000 rows and ends with a "+N more" note when rows are left out.
- No account, email, owner key or credential is ever part of a `$limits` value.

## Limits and budgets

A fence body is at most 8,192 UTF-8 bytes and 200 lines. After conversion a block may have at most 200 components, nesting depth 8, 50 children per container and 4 grid columns. A block that exceeds any of these is invalid and the reason names the limit. A stats block counts one component per statline.

## Worked examples

Every block below is a case of the shared ptah-ui corpus (`libs/shared/src/mcp-apps-contracts/ptah-ui.corpus.ts`), so each one parses, converts and renders. The title of each example is its corpus case name.

### Subagent usage dashboard (`skill-subagent-usage-dashboard`)

Counts and cost in a two-column grid, then the per-agent table, all filled by the host for this turn.

```ptah-ui display subagent-usage
title Subagent usage
grid 2
  stats
    Agents | $agents.total
    Running | $agents.running
  stats
    Tokens | $agents.tokens
    Cost | $agents.cost
table $agents
  cols name | status | tokens | cost | duration
```

Note that the `stats` body lines sit at four spaces because the `stats` header is at depth 1, and that the `cols` line sits at two spaces under the depth-0 `table`.

### Updating a panel surface by id (`skill-id-update-first`, `skill-id-update-second`)

Send the first block while work is running.

```ptah-ui display build-progress
title Build progress
progress Subagents finished | 40 | info
stats
  Completed | $agents.completed
  Failed | $agents.failed
```

When the work finishes, send the whole block again with the same id. The panel surface is replaced by the new content.

```ptah-ui display build-progress
title Build progress
progress Subagents finished | 100 | ok
stats
  Completed | $agents.completed
  Failed | $agents.failed
note ok All subagents finished
```

### A list of CLI tools with the usage and context stats (`skill-cli-tools-usage-context`)

`table $agents session` lists every agent of the session with its `context`; `table $limits` puts the CLI lanes' plan limits beside it. Both tables sit one level deep inside the `row`, so their `cols` line is at four spaces. `$limits` has no `cols` line here, so it shows all five columns.

```ptah-ui display cli-tools
title CLI tools
row
  table $agents session
    cols name | status | tokens | context
  table $limits
```

Today a CLI lane's `context` reads `unavailable`; its `tokens` come from the lane's own usage when the host has it.

### Turn summary (`turn-summary-sources-crlf`)

```ptah-ui
title Release readiness
stats
  Files changed | $diff.files
  Tests passed | $tests.passed
  Prompt cost | $usage.cost
  Quoted budget | \$5
```

### Literal table with escapes (`literal-table-escapes-unicode`)

```ptah-ui
title Migration notes
table
  Check | Detail | Owner
  Schema \| contract | \\ | Priya
  Price | $5 today | équipe
  Empty detail |  | 東京
```

### Changed files (`changed-files-columns`)

```ptah-ui
title Files prepared for review
table $diff
  cols path | additions | deletions
```

### Test runs (`test-run-list`)

```ptah-ui
title Verification runs
list $tests
```

### Line chart (`coverage-trend-chart`)

```ptah-ui
title Coverage trend
chart line Coverage by run
  Baseline | 72.4
  Parser | 78.1
  Pipeline | 84.6
```

### Mixed flat block (`release-checklist-mixed`)

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

### Grid of source stats (`container-grid-stats`)

```ptah-ui
title Session totals
grid 2
  stats
    Files changed | $diff.files
    Tests passed | $tests.passed
  stats
    Prompt cost | $usage.cost
    Duration | $usage.duration
```

### Accordion (`container-accordion-tests`)

```ptah-ui
accordion Test runs
  list $tests
```

### Notes and progress (`atom-note-tones`, `atom-progress-tones`)

```ptah-ui
note ok Migration applied cleanly
note warn Cache warm-up is slower than usual
note error Two snapshot tests fail on Windows
```

```ptah-ui
progress Coverage target | 84.6 | ok
progress Bundle budget | 97.5 | warn
progress Migration | 0
```

### Trend and spark on a stat (`stat-trend-spark`)

The third cell is the trend (`+` or `-`, an amount, an optional `%`, an optional `good` or `bad`); the fourth is the spark, two or more numbers separated by spaces. A trend can be left empty only when a spark follows.

```ptah-ui
title Service health
stats
  Latency p95 | 182 ms | -12% good | 240 221 198 182
  Error rate | 0.4% | +0.1 bad
  Throughput | 1.2k rps |  | 0.9 1.0 1.2
```

### Nested layout (`mixed-nested-release`)

```ptah-ui
title Release overview
grid 2
  card Quality
    stats
      Coverage | 84.6% | +6.2% good | 72.4 78.1 84.6
      Open bugs | 3 | -2 good
  card Owner
    avatar Priya Raman | Release manager
    badge ok On track
section Checks
  accordion Test runs
    list $tests
  accordion Changed files
    table $diff
      cols path | additions | deletions
note warn Renderer review is still open
```

## Common mistakes

- **`session` in the wrong place.** The scope word belongs only to `$agents`. Write `table $agents session`, `list $agents session` and `$agents.session.tokens`. Invalid: `$diff session`, `table $agents sessions`, `$agents session.tokens`, `$agents.session` with no field, `Session` in capitals. `$agents` alone is the current turn, not the session.
- **Expecting a CLI `context` percent.** CLI lanes have no context figure today. Do not build a layout that depends on it; the cell reads `unavailable`.
- **Indentation.** Use spaces only, two per level, and never skip a level. Invalid: a tab, three spaces, a child indented four spaces deeper than its container, an element body at the same depth as its header.
- **Wrong body depth inside a container.** A `stats`, `table`, `list` or `chart` body is one level deeper than its own header, wherever the header sits. A `table $agents session` at four spaces (inside a `row` inside a `card`, say) needs its `cols` line at six spaces. In the `row` example above the table is at two spaces, so `cols` is at four.
- **A sibling after a source table.** Only a `cols` line may follow `table $source`; a `list $source` takes no body at all.
- **Empty or one-line containers.** A `row`, `col`, `grid`, `card`, `section` or `accordion` needs at least one child at the next depth. `grid` needs a count from 1 to 4. `section` and `accordion` need text; `row` and `col` take none.
- **`title` anywhere but first.** One `title`, at column 0, before everything else.
- **Reusing a host id.** Do not start a display id with `ptah.`. Do not use spaces, colons or more than 128 characters.
- **Re-sending a partial update.** An id update replaces the surface. Send the whole block each time.
- **Typing what a source provides.** Never type agent names, token counts, costs, limits or file lists. Reference the source.
- **Dollars.** A stats value that starts with `$` is read as a source. Write `\$5` for a literal price.
- **Progress and trend numbers.** `progress` takes 0 to 100 with no `%` and no `$`. A trend needs a sign: `+4.2%` or `-12% good`, not `4.2%`. A spark needs at least two numbers.
- Do not exceed 8,192 bytes or 200 lines, nor eight statlines in one `stats`.
- Give literal tables a header plus one row with matching cell counts, and literal lists at least one `- ` item.
- Use only `line` or `bar` charts, with a title and at least one point with a non-empty label and a numeric value.
- Use only `\|`, `\\` and `\$` escapes. Use a scalar only as a stats value and a row source only for a table or list.

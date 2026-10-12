# Tool-call card styling: three directions

Mockup (all three, dark/light toggle, real samples): `style-options.html` (open from disk).
Scope: `tool-call-item` (container), `tool-call-header`, `tool-input-display`, `tool-output-display`, `code-output`, `diff-display`, `todo-list-display`. No new tokens or dependencies.

## 0. Rules shared by all three directions

These fix the reported defects. Each direction only changes chrome.

**One place per fact**

| Fact | Lives in | Never also in |
| --- | --- | --- |
| What the call does (Bash/PowerShell `description`, Agent `description`) | header primary text | body, Input list |
| The command / prompt / pattern / URL | body (command) or header target (path, pattern, url) | Input list |
| `run_in_background`, `timeout`, `offset`/`limit`, `-i`, `glob`, `output_mode`, `subagent_type`, `model` | "param chips" (header-meta line) | Input list |
| Tool name | header, once. MCP: `server` as muted prefix + tool name as plain text. Ptah superpower: one gold "Ptah" chip + tool name. | A second badge with the same string (the `ListAgents` + `ListAgents` bug) |
| Language | the single output/input header label | badge in header AND inner block header |
| Duration, status | header right edge | body |

**Param display rule.** Remove from the generic key/value list: every key already consumed by the header (`file_path`, `command`, `description`, `pattern`, `path`, `url`, `prompt`, `subagent_type`, `content`, `old_string`, `new_string`, `todos`) and every key rendered as a chip (booleans, numbers, short enums). What remains (unknown/MCP args) renders as `key  value` rows: key `text-base-content-muted`, value `text-base-content`, both `font-mono text-[11px]`, values `whitespace-pre-wrap break-words`, truncated to 120 chars with "show more". If nothing remains, no "Input" section and no "Input" label at all. Never use `text-primary/70` for keys (noise, and low contrast in light themes).

**Chips.** `badge badge-ghost badge-sm font-mono text-[11px] h-5 px-1.5 text-base-content-muted`. Boolean true renders as the key name (`background`); false is omitted. Numbers get units (`timeout 60 min`, `lines 1-60`). Timeout 3600000 renders as `60 min`.

**Output header (one line, always the same).** `[language label] [n lines] ......... [Show full output] [Copy]`. Label sources: `getLanguageLabel` for code, `Text` for plain text (never "Plain text" twice, never uppercase). No "Output" heading: the block itself is the output; the header row is only rendered when the block is expandable or has a non-text language. Plain text of <= 3 lines gets no header, only a floating Copy on hover/focus.

**Scroll rule.** The tool card never scrolls. Exactly one scroll container exists in the card: the output block (`.out`). Collapsed: `max-h-[9.6em] overflow-hidden` with the existing bottom mask fade. After "Show full output": `max-h-96 overflow-y-auto`. Input blocks (command, Write content) use the same pattern with their own "Show all N lines"; they never nest inside the output block. Horizontal: `whitespace-pre-wrap break-words`, never `overflow-x-auto`.

**Font sizes.** Raise the floor from 10px to 11px for body/mono, 12px (`text-xs`) for the header primary text. 10px survives only for the duration badge. Mono = existing `font-mono`.

**Contrast (WCAG 2.2 AA: 1.4.3 text 4.5:1, 1.4.11 non-text 3:1).** Pairs measured from `tailwind.config.js` values and `styles.css`:
- Dark: `base-content` #e8e6e1 on `surface-1` (~#1c1c22) 14:1; `base-content-muted` on base-300 5.01:1 (documented in `base-content-muted.spec.ts`). Pass.
- Light: `base-content-muted` on base-300 5.01:1 (documented). Pass.
- `text-success` #16a34a and `text-error` #dc2626 on dark surface are ~3.6:1 and ~3.5:1: they pass only as icons (1.4.11, 3:1), never as 11px text. Rule: status words (`failed`, error message) use `text-base-content`; the icon and rail carry the colour. Error text body uses `text-base-content` on `bg-error/10`.
- Gold: `--ptah-gold` #d4af37 on dark 8.4:1; light theme deepened `oklch(58% 0.132 75)` ~3.4:1, so gold text in light uses `--ptah-gold-strong` (5.24:1, documented at `styles.css:698`). Gold as a border/icon (>= 3:1) may use `--ptah-gold`.
- Colour is never the only signal: status icon + word in `aria-label`, error also has a text line.

**Common classes** (all directions): container `bg-surface-1 border border-surface-border rounded` (existing `tool-call-item` classes), gold container adds existing `ptah-gold-border`. Focus ring: existing `focus-visible:outline outline-2 outline-offset-2 outline-base-content`. Toggle target >= 28 px tall (`min-h-7`). Streaming: `animate-pulse` on the status icon only (respect `motion-reduce:animate-none`), header text is not replaced by a second streaming sentence.

---

## Direction A: Quiet / inline log

Idea: a call is one log line, like a terminal transcript. No card border, no tinted blocks until expanded. Lowest density cost; closest to what an agent run feels like.

**Container:** collapsed `px-1 py-0.5 rounded hover:bg-surface-highlight` (token `--surface-highlight` via `bg-[var(--surface-highlight)]`); expanded adds `ml-3 pl-3 border-l border-surface-border` around the body. No `bg-surface-1`, no outer border (gold variant: `border-l` uses `ptah-gold-border` colour `border-[color:var(--ptah-gold)]/40`).

**Header (collapsed and expanded, identical):** one line, `flex items-baseline gap-2 min-h-7 text-xs`.
`[status glyph 8px dot] [tool name: font-mono text-base-content-muted] [primary: text-base-content truncate] [chips inline text-[11px] text-base-content-muted] ........ [duration]`. Chevron only appears on hover/focus (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`) and is always present in the DOM. Status dot: `w-2 h-2 rounded-full bg-success | bg-error | bg-info animate-pulse`.

| Family | Header primary | Chips | Expanded body: input | Expanded body: output |
| --- | --- | --- | --- | --- |
| Command (Bash, PowerShell) | `description`; if none, first command line | `bg`, `60 min` | `$ ` + command, `font-mono text-[11px] whitespace-pre-wrap`, no box, Copy on hover | output block below, plain, `text-base-content-muted`; header row appears only when > 3 lines |
| Command, background | same; dot is `bg-info` and word `started` after chips | `bg` | same | one-line result "Started in background (id)" shown as a plain line, no block |
| Command, failed | same; dot `bg-error`, chip `exit failed` (text-base-content) | same | same | stderr in block `bg-error/10`, text `text-base-content`, no separate error alert (the alert and block are one) |
| Read | file name bold + dir muted | `lines 1-60` | none | code block, header label `TypeScript`, gutter-less |
| Write | file name + dir | `+84 lines` | none (content IS the output view) | highlighted content, one scroller, "Show all 84 lines" |
| Edit | file name + dir | `1 replacement` | none | diff, only changed hunks, `-`/`+` gutter, 2 lines of context |
| Search (Grep/Glob) | pattern in mono, quoted | `in src/`, `*.ts`, `-i` | none | result list: file lines, count in header label `12 files` |
| WebSearch/WebFetch | query / hostname + path | `fetch`, `prompt` hidden | prompt text as muted paragraph (it is the only fact not in header) | text block, label `Text` |
| TodoWrite | `3 of 5 done` | none | none | list, `[x]` / `[ ]` glyphs, in-progress row bold |
| Agent/Task | `description` | `frontend-developer` (subagent_type), model if set | prompt as muted paragraph, clamp 6 lines | final text, label `Text` |
| MCP generic | `server` muted + tool name; first arg `key=value` appended muted | none | remaining args as rows (hidden when none) | text block, label `Text` |
| MCP Ptah | gold `Ptah` chip + tool name (no second badge) | none | as generic | as generic |
| Error | dot red, primary unchanged | `failed` chip | unchanged | error block (above) |
| Streaming | dot blue pulsing, no output | none | input visible as it arrives | none until complete |

Classes: output block `bg-base-300/40 rounded px-2 py-1.5 font-mono text-[11px] leading-snug`; header row `flex items-center gap-2 text-[11px] text-base-content-muted mb-1`; Show-full `btn btn-ghost btn-xs min-h-7 h-7 px-2 text-[11px] font-normal`.

Pros: smallest, no repeated boxes. Cons: less affordance, expand target is a thin line (mitigated by `min-h-7` + hover tint); failed state relies on dot + chip.

---

## Direction B: Structured card

Idea: keep today's card, but give it fixed sections with a strict vocabulary. Closest to the current implementation, so cheapest to ship, clearest hierarchy.

**Container:** existing `bg-surface-1 border border-surface-border rounded my-0.5` (+ `ptah-gold-border` for Ptah). Failed: add `border-l-2 border-l-error`.

**Header:** `px-2 py-1.5 min-h-8 flex items-center gap-2 text-xs`, `[chevron] [tool icon] [tool name text-base-content-muted font-mono, shown unless the header already carries an MCP server/Ptah chip; hidden under 420 px] [primary text-base-content font-medium truncate] ... [status icon] [duration]`. Chips sit in a second header line only when expanded (`px-2 pb-1.5 flex flex-wrap gap-1`), and collapsed shows at most the first two chips inline at >= 520 px (`hidden min-[520px]:inline-flex`).

**Body (expanded only):** `border-t border-surface-border px-2 py-2 space-y-2`. Section label style: `text-[11px] font-medium text-base-content-muted` ("Command", "Prompt", "Arguments", "Result", "Diff"), once, and only the label that names the content (not the generic words "Input"/"Output").

| Family | Header | Chips line | Body |
| --- | --- | --- | --- |
| Command | description (fallback: first command line) | `background`, `timeout 60 min` | "Command" section: box `bg-base-300/50 rounded` with `$` prefix, Copy at top-right; "Result" section: output block with single header row |
| Command, background | description, status `Started` (`text-info` icon) | `background` | command box; result is one line, no box |
| Command, failed | description, `XCircle` `text-error` + visually-hidden "Failed" | same | command box; "Error" section `bg-error/10 border border-error/30 rounded` replaces Result (no duplicate alert) |
| Read | file name + dir muted + open-file button | `lines 1-60`, language chip `TypeScript` (this is the one language label; output header omits it) | "Content" code block |
| Write | file name + dir | `new file`/`overwrite`, `84 lines`, language | content block (single scroller, Show all lines) |
| Edit | file name + dir | `1 replacement` | "Diff" block: `bg-base-300/50`, rows `grid grid-cols-[2.5rem_1fr]`, removed `bg-error/10`, added `bg-success/10`, sign glyph `-`/`+` for non-colour cue |
| Search | pattern (mono, in quotes) | path, glob, flags | "Matches" list; header label `12 files` + Copy |
| WebFetch/WebSearch | url or query | `prompt` omitted (shown in body) | "Prompt" muted paragraph (fetch only); "Result" text |
| TodoWrite | `3 of 5 done` + mini progress `progress progress-success w-12 h-1` | none | rows with status glyph + text |
| Agent/Task | description | `frontend-developer`, model | "Prompt" clamp 6 lines + "Show prompt"; "Report" text block |
| MCP generic | `server` muted + tool name | up to 3 short args as chips; rest in "Arguments" rows | "Arguments" rows only if leftovers; "Result" block |
| MCP no-arg | same | none | no Arguments section; only Result |
| MCP Ptah | `ptah-superpower-badge` reading `Ptah` (replace "Ptah Superpower" text; drop `ptah-tool-name-badge`) + tool name plain | as generic | as generic; section labels `text-[color:var(--ptah-gold-strong)]` |
| Error | `XCircle` + failed border | none | Error section (above) |
| Streaming | `Loader2 animate-spin text-info`, no duplicate description | args as they stream | input only |

Classes: section gap `space-y-2`; code box `rounded bg-base-300/50 px-2 py-1.5 font-mono text-[11px] leading-snug`; output header `flex items-center gap-2 px-2 py-1 border-b border-surface-border text-[11px] text-base-content-muted` (inside the box, so the box looks like one object).

Pros: obvious structure, best for screenshots/review, smallest diff from today. Cons: tallest; a nested box inside a card can still feel heavy in a 360 px panel.

---

## Direction C: Timeline / rail

Idea: a status rail on the left carries state; everything else is a compact two-column grid (label | content). Reads like a trace; best at scanning many calls in a row.

**Container:** `relative pl-3 my-0.5` with a rail `absolute left-0 top-1 bottom-1 w-[3px] rounded-full` coloured by state: `bg-success/70` done, `bg-error` failed, `bg-info animate-pulse` running, `bg-[color:var(--ptah-gold)]` for Ptah tools, `bg-base-300` neutral/unknown. Card background none (hover `bg-surface-1`), border none; expanded body `bg-surface-1 rounded`.

**Header:** `flex items-center gap-2 min-h-8 text-xs`: `[tool icon 14px] [tool name font-mono text-base-content-muted w-[4.5rem]-ish shrink-0 (truncate)] [primary truncate] [chips] [duration]`. The fixed tool-name column aligns primaries vertically across a run of calls (the scan benefit). Under 420 px the name column collapses to icon only (`hidden min-[420px]:inline`; icon keeps `aria-label`).

**Body grid:** `grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1.5 p-2 text-[11px]`; labels are `IN`, `ARGS`, `OUT`, `ERR` in `text-base-content-muted font-mono text-[11px]`; content sits in column 2. Under 420 px the grid becomes one column with labels above (`max-[419px]:grid-cols-1`).

| Family | Header | `IN` | `ARGS` | `OUT` |
| --- | --- | --- | --- | --- |
| Command | description | `$ command` mono pre-wrap | chips as `bg`, `60 min` in header; `ARGS` row not rendered | output with single header row |
| Command, background | rail `info`, header chip `started` | command | none | one line |
| Command, failed | rail `error` | command | none | `ERR` row `bg-error/10`, replaces OUT |
| Read | file name + dir | none | `lines 1-60` | code, label `TypeScript` |
| Write | file name + dir | none | `84 lines` | content, Show all lines |
| Edit | file name + dir | none | `1 replacement` | diff |
| Search | pattern | none | path, glob, flags as `key value` | list |
| WebFetch/Search | url/query | prompt | none | text |
| TodoWrite | `3 of 5 done` | none | none | `OUT` list (the only row) |
| Agent/Task | description | prompt (clamped) | `frontend-developer`, model | report |
| MCP generic | server muted + tool | none | leftover args as `key value` rows | text |
| MCP no-arg | same | none | no row | text |
| MCP Ptah | gold rail + `Ptah` word in `text-[color:var(--ptah-gold-strong)]` + tool | as generic | as generic | as generic |
| Error | rail `bg-error` | unchanged | unchanged | `ERR` |
| Streaming | rail pulsing | input as it arrives | none | none |

Output header row: sits in column 2 above the block, single line, same as shared rule.

Pros: best scanability across a long run; state readable at a glance (rail is 3 px, plus icon so it is not colour-only). Cons: biggest rewrite (header layout, grid body), needs a responsive collapse of the label column, light-theme rail colours need checking.

---

## Comparison

| | A Quiet log | B Structured card | C Timeline rail |
| --- | --- | --- | --- |
| Density (collapsed row height) | Highest (28 px, no box) | Medium (32 px + borders) | High (32 px, no box) |
| Scanability of a long run | Good | Medium | Best (aligned name column + rail) |
| Expanded readability | Medium | Best (explicit sections) | Good |
| Narrow panel (360 px) | Best | Good | Good with the stacked fallback |
| Implementation cost | Medium (new header, remove container chrome) | Lowest (reuse container, header, sections) | Highest (new layout + responsive grid) |
| Risk | Expand affordance, thin hit target | Still boxy / heavy | Rail colour in light themes, layout regressions |

## Recommendation

Ship **B** as the base this round, borrowing C's left status rail for state (`border-l-2` in success-less neutral, error, info, gold) and A's rule that the header never repeats body facts. The shared rules in section 0 remove every defect you listed regardless of direction: one tool name, one command, one language label, one scroller, no "Input"/"Output" generic headings, 11 px text, muted keys. B is the smallest diff against the components the frontend developer is editing now; revisit C after B lands if scanning long runs is still the complaint.

Open decision for the user: confirm that dropping the generic "Input"/"Output" headings is acceptable (they are replaced by content-specific labels such as Command, Result, Diff).

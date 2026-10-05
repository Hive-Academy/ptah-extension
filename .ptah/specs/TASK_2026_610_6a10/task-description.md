# Requirements - TASK_2026_610_6a10

Revision 3 (2026-10-04). Changes from revision 2:

- It applies the Gate 1 user decisions and fixes the 12 defects in `task-description-review.md`.
- It makes the fence grammar, the test-command matcher, the A2UI envelope and every measurement method normative.

Revision 2 applied the user decisions in `context.md` ("User decisions 2026-10-04") and the coordinator's PR A
rescope.

Rule tags:

- **[user]** — requested or decided by the user (context.md, or the Gate 1 decisions of 2026-10-04).
- **[project]** — a standing rule from a cited earlier task.
- **[lane]** — proposed by this document. The user may veto it.

Untagged criteria follow directly from a tagged rule.

## Context

### What already exists for the turn recap

Verified in this worktree:

- **Per-turn changed files with +/- counts.** These are shown by the change-set card
  (`libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts`).
  - The card is mounted after the turn-ending message inside a lazy `@defer`
    (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:69-103`).
  - Its data is a `TurnChangeSet` (`libs/shared/src/lib/types/rpc/rpc-change-set.types.ts:47-70`). It is recorded
    by the backend at turn end against git HEAD, persisted per session, re-read with `git:turnChangeSets`
    (`rpc.types.ts:1687`), pushed live as `git:turnChangeSet`, and held in
    `libs/frontend/chat/src/lib/services/change-set/change-set.store.ts`.
  - It already has unknown-data states: `countsUnavailable`, `baselineMissing`, `truncatedCount`, and per-file
    `null` counts and `binary`.
  - It is a git diff, so it includes changes made by shell commands.
- **Turn tokens, cost and duration.** These are on `ExecutionChatMessage`
  (`libs/shared/src/lib/types/execution/agent.ts:143-150`). They are shown as footer badges
  (`message-bubble.component.html:126-172`).
- **Context-window fill.** This is computed live from `lastTurnContextTokens` and `contextWindow`
  (`libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:18,71`).
- **What is missing:**
  - Tests-run detection. Bash `ExecutionNode`s already carry `toolName`, `toolInput`, `toolOutput` and `status`.
    The status is one of `pending | streaming | complete | interrupted | resumed | error`
    (`libs/shared/src/lib/types/execution/node.ts:35-41,138-156`).
  - Any way for the agent to reference this data in its reply.
- **The TUI** (`apps/ptah-tui/src/hooks/use-sessions.ts:250`) subscribes to `session:stats` only. It does not consume
  `git:turnChangeSet` today.

### Markdown and surfaces today

- **Markdown.** Assistant text goes through the single markdown chokepoint `ptah-markdown-block`
  (`libs/frontend/markdown/src/lib/markdown-block.component.ts`).
  - Its `'full'` preset (`provide-markdown-rendering.ts:475-498`) rewrites every fenced code block into a header plus
    `<pre><code class="language-…">` (`marked-extensions.ts:177-202`).
  - It then sanitises the HTML string with a private DOMPurify instance: a class allowlist, a style policy, forbidden
    tags and attributes, and a containment root (`provide-markdown-rendering.ts:42-283`).
  - The output is an HTML string. An interactive Angular renderer cannot be emitted through it.
- **The renderer.** `libs/frontend/declarative-dashboard` (`src/index.ts:1-32`) exports:
  - `SurfaceRendererComponent` and `SURFACE_VIEW_MODEL_BUILDER`
  - `buildSurfaceViewModel`, `buildDashboardViewModel` and `mapDisplayNode`
  - `SURFACE_PAGE_SIZE`
  - render-state, interaction and view-model types

  Its individual stat, table and chart components are not exported. `chat` and `chat-ui` (type:feature) may import
  it (type:ui).
- **The contract.** It is `libs/shared/src/mcp-apps-contracts`, at `dashboard-spec/2` and `dashboard-catalog/2`
  (`surface-catalog.ts:10-11`), with a fail-closed zod validator.
  - The Apps-profile tool `ptah_surface_update` takes a discriminated `operation` input
    (`surface.schemas.ts:536-562`).
  - The host scopes surfaces to the calling chat session. Callers never pass a session, tab or routing id
    (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts:150-157`).
- **The coding tool list.** TASK_2026_595 made the dashboard and surface tools Apps-only. That cut the coding
  `tools/list` to 54,471 characters on Electron (`TASK_2026_595_1c01/measurement.md`).

### Token counting

`ptah_count_tokens` is host-dependent (`libs/backend/workspace-intelligence/src/services/token-counter.service.ts:5-6`):

- In VS Code it uses the native LM API.
- In Electron it uses `gpt-tokenizer` (`package.json`: `^4.0.0`).

Every token figure in this document means the **`gpt-tokenizer` count on the Electron host** (`ptah_count_tokens`
there). The resolved package version is recorded with each measurement.

### The user's decisions

On 2026-10-04 the user decided [user]:

- The coding agent authors visuals as a compact ```` ```ptah-ui ```` fenced block in its normal reply, not as a tool
  call.
- Data the host owns is referenced by name and resolved at render time.
- An invalid block falls back to a code block.
- A2UI v0.9 JSON is accepted only at the boundary.
- Custom templates are deferred.

The reason given: agent output stays in context and is resent on every request, and JSON is about 60% syntax.
`research-report.md` gives the A2UI mapping and the context-cost estimate.

## Classification

- **Type:** FEATURE. A new authoring channel for the coding agent, host data bindings, and an inbound A2UI adapter.
- **Estimate:** L. Five things drive the size:
  - a normative grammar with a parser and a converter
  - a security-relevant mount point in the markdown pipeline
  - four host sources with reload and virtualization rules
  - a TUI text form
  - an A2UI adapter on an existing Apps tool, sequenced behind TASK_2026_594's catalog bump
- **Priority:** not defined here.

## Resolved at Gate 1

| Item | Resolution | Tag |
| ---- | ---------- | --- |
| Rev 1 D1 (template form), D3 (template cap) | Moot. Part 4 (templates) is deferred. | [user] |
| Rev 1 D2 (interactivity) | Fence blocks are display-only, plus client-side view actions (Req 2.17) | [lane], accepted with the fence decision |
| D1: TASK_2026_539 | Dropped from this task. Fence blocks never enter the host surface store. | [user] |
| D2: A2UI entry point | An alternative input on the existing Apps-profile `ptah_surface_update`. All-or-nothing per message array. Coding profile unchanged. At most 500 tokens of growth (Req 4). | [user] |
| D3: agent note on the recap | None. Revision 1 Req 1.10 is withdrawn. | [user] |
| D4: TUI | The TUI prints valid blocks as plain text, and the hint is sent in TUI sessions | [user] |
| Fallback presentation | An invalid block renders as an ordinary code block, plus a small muted reason line outside the code text. The line is not part of copy or history. | [user] |

No decision is open.

## Scope

In scope:

- **Part 1 (PR A):**
  - tests-run detection with a normative matcher (Req 1.2)
  - the tests row at turn end
  - the TUI turn summary
  - a host-source read layer over the existing stores
  - No new diff card and no new stats display.
- **Part 2 (fence channel):**
  - the normative ```` ```ptah-ui ```` grammar, its parser, and conversion to the internal spec
  - validation by the existing validator
  - rendering in coding-chat assistant messages through `declarative-dashboard`
  - the code-block fallback with its reason line
  - the streaming and identity rules
  - the system-prompt hint
  - the `ptah-ui` section of the on-demand skill
  - the TUI plain-text rendering
- **Part 3 (host data sources):** `$diff`, `$tests`, `$usage`, and optionally `$context` (Req 3.10).
- **Part 4 (A2UI boundary):** an `a2ui` alternative input on `ptah_surface_update` (Apps profile only).
- **Part 5 (performance and context):** the gates and measurements in Req 5.
- **Catalog additions after TASK_2026_594's `dashboard-catalog/3`:** a static text or heading kind, and a note kind
  (or 594's status kinds).

Out of scope:

- **Any new coding-profile tool,** including `ptah_render`. Superseded by the fence decision. TASK_2026_595 stays
  [user][project].
- **Agent-registered custom templates (revision 1 Part 4). Deferred.**
  - Host sources remove most of their token saving, because the repeated cost was data rows.
  - Templates also extend the "no agent HTML" rule (TASK_2026_490/493/494) and need an approval UI and a
    per-workspace store.
  - Revisit as a separate task after fence usage is measured [user].
- **TASK_2026_539** (chat-tab claim/release, `surface:release` RPC). It returns to its own task [user].
- **A recap note written by the agent** [user].
- **A second per-turn diff card, or a duplicate of the footer stats** (Req 1.12) [user via coordinator].
- **A2UI in the coding chat,** in a fence or any other form [user].
- **A2UI client-to-server messages,** A2A or AG-UI transport, emitting A2UI, and v0.8 or v1.0.
- **Rejected A2UI components:** media components (`Image`, `Icon`, `Video`, `AudioPlayer`), `Modal`, `List`
  (templated children), `Tabs`, `Divider`, `Slider`, `DateTimeInput`, `FunctionCall`, and inline catalogs
  (research-report.md mapping table).
- **Interactive inputs, `surface.submit`, selection-to-agent and write-back from fence blocks.** A fence has no
  channel back to the host [lane].
- **Updating or deleting an earlier block.** Blocks are immutable [lane].
- **Rendering `ptah-ui` outside coding-chat assistant messages** (Req 2.10) [lane].
- **Feeding block validation errors back to the agent** [lane].
- **A `$session` source.** No displayed session total was verified (`session-live-stats.util.ts:47` calls its total
  "a ranking key, never a displayed figure").
- **The recap in headless `ptah-cli` output.** No renderer exists there.
- **Public "first coding agent with A2UI" wording,** and tool-search deferral of other tools.

## Requirements

### 1. Turn recap from existing data (Part 1, PR A)

**Requirement:** at the end of each turn, a coding-chat user sees what the turn changed, which tests it ran and with
what outcome, and what it cost. The existing change-set card and badges are reused, and only tests-run is added.
Nothing costs model tokens.

1. **Files changed.** When a turn changed files, the existing change-set card shall list them as today
   (TASK_2026_576). This task shall not change its content. A spec pins that it still mounts after the turn-ending
   message.
2. **Tests run.** A test command is classified by this matcher [lane, normative].

   **Input.** The `toolInput.command` string of every Bash `ExecutionNode` in the turn's tree, including subagent
   nodes. Commands run with `run_in_background` are classified, and their outcome is `unknown`.

   **Segments.** Split the command into segments on `&&`, `||`, `;`, `|` and newline, outside single or double
   quotes. Text inside quotes is never inspected, so `bash -c "npm test"` does not match. Then apply these rules to
   each segment, in order:

   - **R1 (directory changes).** A segment whose first token is `cd`, `pushd` or `popd` is removed. It never
     matches.
   - **R2 (prefixes).** Drop leading `VAR=value` tokens, then one leading `time`.
   - **R3 (explicit wrappers).** Drop one leading wrapper, longest first: `pnpm exec`, `pnpm dlx`, `npm exec`,
     `yarn dlx`, `npx`, `bunx`.
   - **R4 (match).** The segment matches when its tokens start with any pattern in the table below.
   - **R5 (plain package-manager wrapper).** When R4 finds no match and the first token is `pnpm`, `yarn` or `bun`,
     drop that token. Match the rest against the **executable** patterns only.
   - **R6 (info flags).** A segment whose only remaining arguments are `--version`, `-v`, `--help` or `-h` does not
     match.

   | Pattern | Kind | Notes |
   | ------- | ---- | ----- |
   | `npm test`, `npm t`, `npm run test` | script | `test` or `test:*` |
   | `pnpm test`, `pnpm run test` | script | `test` or `test:*` |
   | `yarn test`, `yarn run test` | script | `test` or `test:*` |
   | `bun test` | script | |
   | `nx test` | executable | |
   | `nx run <project>:test` | executable | target `test` or `test:*` |
   | `nx run-many` or `nx affected` | executable | with `-t`/`--target`/`--targets` (space or `=`) whose comma list contains `test` |
   | `jest`, `vitest` | executable | including `vitest run` |
   | `pytest`, `py.test`, `python -m pytest`, `python3 -m pytest` | executable | |
   | `go test`, `cargo test`, `dotnet test` | executable | |

   A node is a test command when at least one of its segments matches. It is listed once, with its full command
   text.

   **Outcome.** The outcome is taken from the node, not the segment:

   | Node state | Outcome |
   | ---------- | ------- |
   | `status: 'complete'` | `passed` |
   | `status: 'error'` | `failed` |
   | `pending`, `streaming`, `interrupted` or `resumed`, or a background run | `unknown` |

   The outcome reflects the shell's exit status. Masking (`|| true`, a pipe into `tail`) is a documented limitation.

   **Examples.** A spec pins each of these. Each rule has at least one positive and one negative fixture:

   | Rule | Positive (matches) | Negative (no match) |
   | ---- | ------------------ | ------------------- |
   | Quoting | — | `echo "npm test"`, `bash -c "npm test"`, `git commit -m "fix tests"` |
   | R1 | `cd libs/x && pnpm vitest run` | `cd tests` |
   | R2 | `CI=1 npm run test:unit`, `time nx test chat` | `NODE_ENV=test node build.js` |
   | R3 | `npx nx run-many -t lint,test`, `pnpm exec jest` | `npx prettier --check .` |
   | R4 script | `npm t`, `yarn run test:e2e` | `npm run build`, `npm install -D vitest` |
   | R4 executable | `nx test chat`, `nx run chat:test:ci`, `nx run-many --targets=lint,test`, `python -m pytest -q`, `go test ./...` | `nx build chat`, `nx affected -t build`, `grep -r jest src`, `cat jest.config.ts` |
   | R5 | `pnpm vitest run`, `yarn jest --ci`, `pnpm nx test chat` | `pnpm install`, `yarn add -D jest`, `bun run build` |
   | R6 | — | `jest --version`, `pnpm vitest --help` |

   Detection runs on the existing execution tree and needs no new backend data [lane, per coordinator].
3. **Stats.**
   - Tokens, cost and duration stay in the existing footer badges.
   - A `null` cost renders as unavailable, never as `$0`. This is existing behaviour, pinned by a spec.
   - No metric appears twice for the same turn.
4. **Nothing to report.** When a turn changed no files and ran no test command, no tests row and no change-set card
   shall render.
5. **Zero model tokens [user].**
   - No model call or tool call shall be made to build the turn-end display.
   - Assertions are made at the boundaries named in Req 5.12, using the fixtures defined there. They extend to
     tests-row values: the sentinel test outcome label and the change-set sentinel path.
6. **Missing data.**
   - The change-set card's own states apply unchanged.
   - A test command whose node has no terminal status, or whose output was cut by retention, shows `unknown`.
7. **Aborted or failed turns.** The tests row shows what was recorded up to that point and is marked "incomplete".
   A command still running shows `unknown`.
8. **Reloaded history.** The tests row is rebuilt from the stored execution tree for that turn only. When the turn's
   tree was not stored, no tests row renders.
9. **TUI.** After each assistant message the TUI shall print a summary in this order and format. The fixture below is
   normative for layout, and its values are illustrative:

   ```text
   Changes: 3 files, +42 -7 (baseline missing: may include earlier changes)
     M src/a.ts  +40 -5
     A src/b.ts  +2 -0
     M img/logo.png  binary
     +2 more files
   Tests (incomplete):
     failed   nx test chat
     unknown  npx jest foo
   Tokens 12,345 in / 1,234 out | Cost unavailable | 1m 12s
   ```

   Rules:
   - **Order.** Files appear in change-set order. Tests appear in execution order.
   - **Per-file counts.** A `null` count prints `stats unavailable`. A binary file prints `binary`.
   - **Turn-level states.** `countsUnavailable` prints `counts unavailable`. `truncatedCount` prints
     `+N more files`. `baselineMissing` prints the suffix shown above. An aborted or errored turn prints
     `(incomplete)` after `Tests`.
   - **Omitted sections.** A section with nothing to report is omitted.
   - **Shared matcher.** The TUI uses the same matcher as the webview. One shared command fixture yields identical
     outcomes in both.
   - **Missing change sets.** When the TUI process does not receive change sets (it does not subscribe today), the
     first line prints `Changes: unavailable in this runtime`. It never prints a guessed list.
10. **Agent note.** Withdrawn [user, Gate 1 D3].
11. **Runtimes.** The tests row has the same content and layout in the VS Code webview and the Electron webview, in
    both themes.
12. **No second diff card [user via coordinator].**
    - When a turn completes, the transcript contains at most one per-turn file-change listing for it: the existing
      change-set card.
    - A spec asserts that no other turn-end component lists changed files or per-file +/- counts.
    - A `ptah-ui` block binding `$diff` is message content, not a turn-end card, and is exempt.
13. **Host-source exposure.**
    - Turn values for `$diff`, `$tests` and `$usage` are readable by the Part 2 renderer from the existing stores
      (the change-set store, `ExecutionChatMessage`) and the new detection.
    - No new RPC method or backend push is added for them [lane].
    - The only exception: an entry in `implementation-plan.md` that names the value, shows why it cannot be derived
      in the webview, and is approved at Gate 2.

### 2. `ptah-ui` fenced blocks in the coding chat (Part 2) [user]

**Requirement:** the coding agent adds a validated visual to its reply by writing a ```` ```ptah-ui ```` block in its
normal markdown. Coding sessions get no new tool schema.

#### Grammar (normative) [lane]

The grammar below is the acceptance target for PR B (all elements except `note`) and PR D (`note`). The architect may
change spellings only through a Gate 2 amendment to this section.

EBNF (ISO 14977 style: `{ }` repeat zero or more times, `[ ]` optional, `|` alternative, `-` except). Trailing
spaces at the end of any line are removed before parsing.

```text
fence      = "```ptah-ui" NL body "```" ;          (* info string exactly "ptah-ui"; closing line exactly "```" *)
body       = { blank } element { { blank } element } { blank } ;
blank      = NL ;                                   (* a line that is empty after trailing-space removal *)
element    = title | stats | table | list | chart | note ;

title      = "title" SPS text NL ;                  (* at most one; must be the first element *)
stats      = "stats" NL statline { statline } ;     (* 1..8 statlines *)
statline   = IND cell BAR value NL ;                (* exactly two cells, both non-empty *)
value      = scalar | vcell ;                       (* a value that starts with "$" is always a scalar *)
vcell      = [ ( cchar - "$" ) { cchar } ] ;        (* a literal value cannot start with a bare "$"; write "\$" *)
table      = "table" NL tablerow tablerow { tablerow }      (* literal: header row, then 1..N rows *)
           | "table" SPS rowsource NL [ colsline ] ;
tablerow   = IND cell { BAR cell } NL ;             (* every row has the header's cell count; cells may be empty *)
colsline   = IND "cols" SPS name { BAR name } NL ;  (* names from the source's row columns, no repeats *)
list       = "list" NL item { item }
           | "list" SPS rowsource NL ;
item       = IND "- " text NL ;
chart      = "chart" SPS ( "line" | "bar" ) SPS text NL point { point } ;
point      = IND cell BAR number NL ;               (* label cell non-empty *)
note       = "note" SPS ( "info" | "ok" | "warn" | "error" ) SPS text NL ;   (* no body; PR D *)

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
```

Lexical table:

| Item | Rule |
| ---- | ---- |
| Keywords and tokens | `title stats table list chart note cols line bar info ok warn error` are lowercase and exact. Any other header word makes the block invalid. |
| Header lines | Start at column 0. Body lines start with exactly two spaces then a non-space character. Three or more spaces, or one, is invalid. |
| Tab, other control characters | Invalid anywhere in the body (excluded from `char`). |
| Escaped pipe (backslash, pipe) | Decodes to a literal pipe inside a cell or text. An unescaped pipe is a cell separator in cell lines (`statline`, `tablerow`, `colsline`, `point`). In `text` positions (title, chart title, note, list item) an unescaped pipe is a literal character. |
| Escaped backslash (backslash, backslash) | Decodes to a literal backslash, in cells and in text. |
| Escaped dollar (backslash, dollar) | Decodes to a literal `$`. It is needed only where a `$` would otherwise start a source reference: the start of a `value` cell, or a `table`/`list` argument. A `$` anywhere else (inside text, inside a table row cell, or mid-cell) is literal and needs no escape. |
| Any other `\` sequence | Invalid, including a trailing lone `\`. |
| Source reference | Recognised only in a `stats` value (`scalar`) and as the `table`/`list` argument (`rowsource`). A scalar in a table argument, or a row source in a stats value, is invalid. |
| Empty text | Invalid for `title`, the `chart` title, `note` text and list items, after trimming. |
| Empty cell | Valid in `tablerow`. Invalid in `statline` (both cells) and in a `point` label. |
| Numbers | Only `number` is accepted in a chart point: no `+`, exponent, thousands separator or unit. |
| Unicode | Any non-control character is allowed in `text` and `cell`, and renders as plain text. |

**Fixtures [lane].** The PR B (and PR D for `note`) parser fixtures shall include one valid and one invalid case for
every row of the lexical table, and these cases at minimum:

- CRLF line endings
- `\|`, `\\` and `\$` decoding
- a stray `\x` (invalid)
- a tab (invalid)
- a three-space indent (invalid)
- an unescaped `|` inside a title (literal)
- `$` mid-cell (literal)
- an empty title, note, chart title or list item (invalid)
- an empty table cell (valid)
- an empty stats cell (invalid)
- a scalar as a table argument (invalid)
- an unknown `cols` name (invalid)
- a ragged row (invalid)
- `1e3` and `1,000` as chart values (invalid)
- a body of exactly 8,192 bytes (valid) and 8,193 bytes (invalid)

The valid edge cases (CRLF, the three escapes, an empty table cell, Unicode text, a literal mid-cell `$`) are also
entries in the Req 5.13 corpus.

Source types:

- A **scalar** reference (`$source.field`) is valid only as a `stats` value.
- A **row source** (`$source` with no field) is valid only as the argument of `table` or `list`.
- Any other placement is invalid.

Caps [lane]:

- A fence body is at most 8,192 UTF-8 bytes and 200 lines.
- The existing `SURFACE_LIMITS` (tree depth, children per node, components, data size) also apply after conversion.
- Rationale: one block stays near 2k tokens in the worst case, because it is resent on every later request.

Illustrative valid block (PR B plus PR D):

```ptah-ui
title Session store split
stats
  Files | $diff.files
  Added | $diff.additions
  Tests passed | $tests.passed
  Cost | $usage.cost
table $diff
  cols path | additions | deletions
list
  - Split SessionStore into reader and writer
chart bar Bundle size (KB)
  main | 412
  branch | 398
note warn Run the migration before release
```

#### Acceptance criteria

1. **Recognition.** When a coding-chat assistant message contains a closed fence whose info string is exactly
   `ptah-ui`, the system shall parse it, convert it to an internal `dashboard-spec/2` envelope, validate it with the
   existing validator, and render it in place through `declarative-dashboard`.
2. **Conversion fidelity.** For each grammar element, a fixture pairs a fence with its expected internal envelope.
   The converter's output shall deep-equal the expected envelope, and both shall render identically.
3. **Fail closed, atomic [user][project: TASK_2026_490/494].**
   - When any part of a block violates the grammar, the source table, the caps or the validator, the whole block
     shall render as an ordinary code block. The code text shall be identical to how any other fence renders today.
   - Nothing from that block shall render as a surface, and the rest of the message renders normally.
4. **Never breaks the message.** When parsing, conversion or rendering throws, the message still renders and the
   block falls back as in 2.3. No banner or toast replaces message content.
5. **Reason line [user].** When a block falls back, a small muted line shall render below the code block, outside its
   code text, saying why. For example: "Not rendered: unknown element `gauge` (line 4)".
   - The code block's copy action, a message copy, and the stored message shall contain the raw fence only, never
     the reason line.
   - Nothing about the failure is sent to the agent.
6. **Streaming [user].**
   - While a `ptah-ui` fence is open, it shows as a plain code block or a lightweight placeholder, never a partial
     surface.
   - When the closing fence arrives, the block renders, without waiting for the turn end.
   - When the turn ends with the fence still unclosed, it stays a code block.
7. **Block identity and mounting [lane].**
   - A block's identity is (message id, text node id, ordinal of the `ptah-ui` fence within that text node).
   - **Within one live message instance** (from fence close until that message component is destroyed), each
     identity shall be instantiated exactly once, whatever text streams after it. A spec counts renderer
     instantiations across later chunks.
   - Theme changes and parent signal updates shall not re-instantiate a block.
   - **Permitted remounts.** A block may be instantiated again only when its message leaves and re-enters the
     transcript render window (virtualization, `TranscriptRenderWindow`), when the tab is re-created, or when the
     session is reopened. On remount it re-parses from the stored text and re-resolves its sources (Req 3.7). For
     a turn in a terminal state, the rendered output shall equal the output before the remount.
8. **Plain text only [project: TASK_2026_490, dashboard-catalog text rule].** A literal containing markdown, HTML, a
   URL or an entity renders as literal characters. No link, image or element is created from it.
9. **Unforgeable mount [project: TASK_2026_532].**
   - Agent HTML, or any other fence, that imitates the implementation's mount marker shall not produce a surface.
   - The `'full'` preset's class allowlist, forbidden tags and forbidden attributes are not loosened.
   - Trust specs pin both.
10. **Scope of rendering [lane].**
    - In user messages, subagent and agent-card transcripts, thinking blocks, and every non-chat consumer of
      `ptah-markdown-block`, a `ptah-ui` fence renders as an ordinary code block, with no reason line.
    - The `'basic'` and `'member'` presets are unchanged.
11. **Charts [project: TASK_2026_490 Rev 4 C].** Charts render through the renderer's chart kinds, never through
    third-party HTML.
12. **Caps.** A block over the byte or line cap, or over a `SURFACE_LIMITS` budget after conversion, falls back with
    a reason naming the cap.
13. **Copy and history [lane].** Copy and storage keep the raw fence text. Export and sharing are an open question.
14. **System-prompt hint [user].**
    - When a coding session starts in the VS Code webview, the Electron webview or the TUI, the system prompt
      contains one hint: the fence name, the element keywords, the source names, and the skill name.
    - CLI agent lanes (`/agent/{id}`) and headless `ptah-cli` sessions get no hint.
15. **On-demand reference [user].** The full grammar, the source table and worked examples are in the
    `ptah-surface-authoring` skill (TASK_2026_594), in a `ptah-ui` section. They are not loaded by default.
16. **TUI [user, Gate 1 D4].**
    - When a valid block appears in a TUI session, the TUI prints the converted envelope's plain-text fallback
      (`surface-text-fallback.ts`), with sources resolved as in Req 3. Sources the TUI cannot resolve print
      `unavailable`.
    - An invalid block prints as raw fence text, followed by the reason line.
17. **View actions only [lane].**
    - Rendered blocks allow only the renderer's local view actions: sort, filter and page within a table, and
      expand or collapse.
    - None of them sends anything to the host or the agent.
    - Blocks have no inputs, no `surface.submit` and no selection capture.

### 3. Host data sources (Part 3) [user]

**Requirement:** a block shows data the host already holds by naming a source, so the agent never types rows the
host owns. Each source is scoped to the turn of the message that contains the block.

| Source | Scalars (type) | Rows (columns) | Backed by | Tag |
| ------ | -------------- | -------------- | --------- | --- |
| `$diff` | `files` int; `additions` int; `deletions` int | `path` string, `status` A/M/D/R/U, `additions` int or null, `deletions` int or null (default columns: all four) | `TurnChangeSet` in the change-set store | [user] |
| `$tests` | `total`, `passed`, `failed`, `unknown` int | `command` string, `outcome` passed/failed/unknown | Req 1.2 detection | [user] |
| `$usage` | `input` int; `output` int; `cost` USD or null; `duration` ms | none | `ExecutionChatMessage` | [user] |
| `$context` | `used` int; `window` int; `percent` 0-100 | none | Req 3.10 | [lane], optional |

`list $source` lists the first column only.

1. **Resolution.** The webview resolves sources from the stores above. The values equal what the change-set card,
   the footer badges and the tests row show for the same turn.
2. **Pending.** When a block that binds a source renders before its turn reaches a terminal state, each bound value
   shows a pending state. It is filled at turn end within the same instance (Req 2.7), without re-instantiation.
3. **Unknown name or field.** The whole block falls back (Req 2.3), and the reason line names it.
4. **Unavailable.** When a known source has no data for the turn, each value bound to it renders as "unavailable",
   never as `0`, `$0` or blank, and the rest of the block renders. The cases include:
   - no change set
   - a `null` cost
   - `countsUnavailable`
   - no context window reported
   - a reloaded turn whose tree was not stored
5. **Partial data.** The existing meanings carry through:
   - per-file `null` counts or binary files show "unknown" or "binary"
   - `truncatedCount > 0` adds "+N more"
   - `baselineMissing` marks the values as possibly including earlier changes
   - aborted turns are marked incomplete
6. **Empty.** An available but empty source shows an empty state (for example "No files changed this turn"), not
   an error.
7. **Reload and remount.** On any remount permitted by Req 2.7, sources re-resolve for the block's own turn from the
   persisted change sets and the stored execution tree. A block never shows another turn's data. Where a value
   cannot be rebuilt, Req 3.4 applies.
8. **Host owns the values.** Literals never merge into source rows. A literal and a binding are always separate
   cells or lines.
9. **No write-back [user].** Resolved values never enter the stored message text or any outgoing request
   (Req 5.12).
10. **`$context` is optional [lane].**
    - `$context` ships in PR C only if the architect shows that a per-turn snapshot exists: the value as of the end
      of that turn, retained across reload.
    - Otherwise it is dropped from the hint, the skill and the source table, and `$context` becomes an unknown name
      (Req 3.3). The live, session-wide value is not acceptable.

### 4. A2UI v0.9 adapter at the boundary (Part 4) [user]

**Requirement:** an agent that speaks A2UI v0.9 can drive an Apps-page surface through `ptah_surface_update`. The
adapter converts to the internal contract, and the existing validator stays the only trust boundary.

1. **Verify before design.**
   - Before PR E is designed, the mapping shall be checked against the raw a2ui-project `server_to_client.json` and
     basic-catalog JSON at a pinned commit.
   - The result is recorded as an addendum to research-report.md, with the commit hash and any differences.
   - Component names in 4.3 may be corrected only through that addendum.
2. **Envelope [user].**
   - `ptah_surface_update` accepts exactly one of the existing `operation` input (unchanged) or `{ a2ui: [ … ] }`.
   - The `a2ui` value is an array of 1 to `SURFACE_LIMITS.maxPatchOps` A2UI v0.9 message objects.
   - Both keys present, neither present, or any other key: the call is rejected.
3. **Catalog id and subset.**
   - Ptah advertises exactly one A2UI catalog id: `ptah-dashboard-catalog/<N>`. `<N>` equals the
     `SURFACE_CATALOG_VERSION` number in force when PR E lands, expected to be `3` after TASK_2026_594.
   - The id is Ptah-owned and fixed. It is stated in the tool description and the skill. No inline or agent-supplied
     catalog is accepted.
   - The catalog accepts exactly:

     | Group | Components | Maps to |
     | ----- | ---------- | ------- |
     | A2UI-named | `Text` | the static text kind (PR D) |
     | A2UI-named | `Row`, `Column` | `stack` |
     | A2UI-named | `Card` | `card` |
     | A2UI-named | `CheckBox` | `checkbox` |
     | A2UI-named | `TextField` | `text` |
     | A2UI-named | `ChoicePicker` | `select` |
     | A2UI-named | `Button` | `action.name` must equal an id in `SURFACE_ACTIONS` verbatim |
     | Ptah-named | `PtahStat`, `PtahTable`, `PtahList`, `PtahLineChart`, `PtahBarChart` | the matching display kinds |
     | Ptah-named | `PtahNote` | the note kind (PR D) |

   - Any other component or `catalogId` is rejected.
   - The catalog is unavailable until PR D and TASK_2026_594 have merged. PR E depends on both, so no build
     advertises it earlier.
4. **Batch boundary and sequences [user: all-or-nothing per array].**
   - One `ptah_surface_update` call carries one `a2ui` array. That array is the atomic unit.
   - Every message in it names the same `surfaceId`. Mixed ids are rejected [lane].
   - Allowed sequences:
     - **Create:** `createSurface`, then one or more `updateComponents`, and optional `updateDataModel` messages.
       This becomes an internal `create`. A `createSurface` with no components is rejected.
     - **Update:** on an existing surface, `updateComponents` and `updateDataModel` messages in any order. They are
       applied in array order.
     - **Delete:** `deleteSurface` as the only message.
   - `createSurface` on an existing id is rejected. A non-create message for a missing id is not-found.
5. **Routing and ownership.**
   - The surface is scoped to the calling chat session exactly as native operations are (`surface-tools.ts:150-157`).
   - A2UI messages cannot name a session, tab or routing id.
   - Another session's id is not-found.
   - An anonymous caller gets the native behaviour: a create returns the text fallback and nothing is stored, and
     other sequences fail with "surface state unavailable".
   - `surfaceId` must satisfy the internal `SurfaceIdSchema`. v1-prefixed ids are rejected.
6. **Commit point [lane].**
   - A2UI carries no revision. The host converts the whole array, applies it to the surface state current at that
     moment, and validates the result with the existing validator.
   - It then commits once: one revision increment and one push.
   - On any failure, nothing is stored, nothing is pushed, and the revision is unchanged.
   - Converted data writes touch only their own paths.
   - The success result has the native shape (surface id, revision, status) and never echoes the input.
7. **Component tree.** A cycle, an orphan, a duplicate id, a component reused by two parents, a missing `root`, or a
   tree over the budgets: the call is rejected.
8. **Data paths.** A JSON Pointer with array indices, `~0`/`~1` escapes, a segment outside the internal segment
   pattern, or a depth over 8: the call is rejected. An omitted `value` removes the data at that path.
9. **Unsupported content.** Any rejected component (see Out of scope), a `FunctionCall`, templated children, an
   inline catalog, a `Button` name outside `SURFACE_ACTIONS`, or a version other than `v0.9`: the whole call is
   rejected.
10. **Error shape.** Failures return an A2UI-shaped `error` (`code`, `surfaceId`, `path`, `message`). `path` points
    into the submitted array.
11. **No host sources [lane].** A `$`-prefixed value or path segment never resolves host data. It is a literal or
    fails the segment pattern.
12. **Schema budget [user].**
    - The `ptah_surface_update` entry in the Apps-profile `tools/list` (`JSON.stringify` of that one entry, read
      from a real `handleMCPRequest` call as in TASK_2026_595) shall grow by at most 500 tokens. The baseline is
      the PR's merge-base with `main`, recorded by hash.
    - It is measured on the Electron-like and the VS Code-like host. The characters and the `gpt-tokenizer` count
      (Context, "Token counting") are recorded in `measurement.md`.
    - The coding profile is unaffected (Req 5.10).

### 5. Performance and context rules (Part 5, a gate on every PR)

1. **Initial chunk set (unchanged from revision 1).**
   - In a production webview build, no module from `declarative-dashboard`, the A2UI adapter, the template feature,
     `@ptah-extension/shared/mcp-apps-contracts`, zod reached through these, or any chart library appears in the
     initial chunk set.
   - "Initial total" is reported on the branch and on `main` at `f314a4f8a`, with every eager byte added named.
   - Any other growth fails. This is the same gate as TASK_2026_494 Req 9.1.
2. **No eager renderer load.** When no message contains a valid `ptah-ui` block, the renderer chunk is not
   requested. The network or file log proves it.
3. **Render on fence close.** See Req 2.6 and 2.7.
4. **Live cap.**
   - When a tab holds more rendered blocks than the live cap, the oldest by identity order become static snapshots:
     no live bindings, no enabled controls, no change detection.
   - A remount does not promote a snapshot, unless it is again within the newest blocks.
   - The plan fixes the cap and justifies it against `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`.
5. **Updating a snapshot.** Withdrawn. Blocks are immutable.
6. **Host eviction.** Withdrawn. Fence blocks never enter the host store.
7. **Reload.** See Req 2.7 and 3.7. No error is shown.
8. **Recap timing (unchanged).** The turn-end display is built when the turn completes, not during streaming.
9. **Fence modules lazy [lane].**
   - The parser, the converter and the source resolver load only when a message text contains a line that is
     exactly ```` ```ptah-ui ````.
   - The only eager code allowed is that line check. It needs no zod and no parser, and its bytes are named in the
     5.1 report.
10. **No coding tool-schema delta [user].**
    - Coding-profile `tools/list` (`JSON.stringify(result.tools)` from a real `handleMCPRequest` call, the
      TASK_2026_595 method) shall have the same tool names and the same character count at the PR's head as at its
      merge-base with `main`.
    - It is measured on the Electron-like and the VS Code-like host, recorded by hash in `measurement.md`, and
      repeated on every PR.
11. **Hint budget [user].**
    - The hint of Req 2.14 shall be at most 100 tokens (`gpt-tokenizer`, see Context).
    - The exact text, the characters and the count are recorded in `measurement.md`.
    - The default system prompt contains no other `ptah-ui` or catalog text.
12. **No host data in outgoing requests [user].** Fixture:
    - an assistant message whose text has a `ptah-ui` block binding `$diff`, `$tests` and `$usage`, plus agent prose
      "All tests passed and 3 files changed"
    - sources seeded with sentinels: change-set path `zz_sentinel_610.ts`, cost `0.610610`, duration `610610`

    After that turn ends and the next prompt is sent, the following shall hold:
    - **Stored text.** The stored message text (the text `ExecutionNode.content`) equals the agent's text
      byte-for-byte.
    - **Webview to host.** The serialized `ChatContinueParams` sent for the next turn contain none of the sentinel
      values.
    - **Host to provider.** The query input built by `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
      for that turn (prompt and system prompt) contains none of the sentinel values.

    Agent prose is never asserted on. The same fixture covers Req 1.5.
13. **Compactness evidence [lane].**
    - PR B checks in a corpus of at least six cases (one per PR B element, plus one mixed). Each case is a canonical
      fence string and the canonical internal JSON: the converter's output, `JSON.stringify` with no whitespace,
      bindings unresolved.
    - A spec computes both `gpt-tokenizer` counts at the pinned package version. It asserts that each fence is
      smaller, and writes the figures to `measurement.md`.
    - No ratio target is set.

## Non-functional requirements

- **Context budget:** Req 5.10, 5.11, 5.12 and 1.5, and Req 2.15 (reference on demand).
- **Security:**
  - The existing zod validator is the only trust boundary for fence and A2UI input.
  - Text is plain text.
  - No agent scripts, event handlers, URLs or network requests from agent content [project: TASK_2026_490/493/494].
  - The sanitiser is not loosened (Req 2.9).
  - Trust specs cover Req 2.3, 2.8, 2.9, 4.2, 4.9 and 4.11.
- **Compatibility:**
  - VS Code and Electron webviews: Req 1-3 and 5. TUI: Req 1.9 and 2.16.
  - The VS Code webview CSP is unchanged.
  - `dashboard-spec/1` and `/2` keep rendering on the Apps page.
  - The native `operation` input of `ptah_surface_update` is unchanged.
- **Accessibility:**
  - **Automated.** An `axe-core` scan (already a dev dependency) of fixtures for the tests row and for each block
    element reports zero serious or critical violations, in both themes. The elements are title, stats, table,
    list, chart and note. The states are pending, unavailable, empty, fallback-with-reason and snapshot.
  - **Keyboard.** A fixture message containing a block with a sortable table is checked. Tab reaches every
    interactive control in DOM order. No block traps focus. Non-interactive elements are not tab stops.
  - **Names and alternatives.**
    - Each chart has an accessible name (its title) and a text alternative listing its points (for example the
      `surface-text-fallback` rows).
    - A snapshot keeps the same alternative.
    - The reason line is associated with its code block (for example `aria-describedby`).
    - Pending and unavailable are conveyed in text, not by colour alone.
- **Tests:** `nx test` passes for every touched project among `shared`, `markdown`, `declarative-dashboard`, `chat`,
  `chat-ui`, `chat-streaming`, `agent-sdk`, `vscode-lm-tools` and `ptah-tui`.

## Delivery order and PR split

| PR | Contents | Depends on |
| -- | -------- | ---------- |
| A | Req 1: matcher and tests row, TUI summary, host-source read layer (1.12, 1.13), Req 5.12 fixture for 1.5, gates 5.1 and 5.8 | none |
| B | Req 2 for title, stats, table, list and chart (`/2` kinds), Req 3.3 name check, Req 5.2-5.4, 5.9-5.11, 5.13. Literal data only. | PR A merged (both touch the message and turn-end area) |
| C | Req 3 source resolution (and `$context` per 3.10), Req 5.12 | PRs A and B |
| D | Static text and note kinds (or 594's status kinds), and the `note` element | TASK_2026_594 `dashboard-catalog/3` merged; PR B |
| E | Req 4 A2UI input on `ptah_surface_update` | Req 4.1 addendum; PR D |

Coordinator note: a Codex lane is building PR A against revision 1's Req 1. Req 1.1 and 1.3 of that revision
duplicate existing code. The orchestrator must re-point the lane to this Req 1 before its output is accepted.

Part 5 is a gate on every PR. Req 5.10 is re-measured on each PR. Req 4.12 is measured on PR E.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Coding-chat user (VS Code, Electron) | Tests next to the existing change card; richer visuals with no slowdown | One change card per turn; tests row; blocks render on fence close; cold start unchanged |
| TUI user | The same information as text | The Req 1.9 summary format; blocks as plain text |
| Coding agent (any provider) | A tiny hint, host data by name, no new tool | Hint of 100 tokens or fewer; zero tool delta; invalid blocks degrade harmlessly |
| A2UI-speaking agent author | The v0.9 subset on the Apps profile | The Req 4.3 catalog; A2UI-shaped errors |
| Security reviewer | No markup, URL or styling escapes; the sanitiser unchanged | Trust specs; unforgeable mount |
| Owners of TASK_2026_576, 594 and 539 | No duplicate card; no conflicting catalog bump; 539 returned | Req 1.12; PR order; Out of scope |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| The PR A lane rebuilds the change card or the stats | HIGH | MEDIUM | Orchestrator re-points the lane now. Reviewer fails any PR that breaks Req 1.12. |
| The TUI does not receive change sets | HIGH | LOW | Req 1.9 defines `unavailable in this runtime`. The architect decides whether to subscribe the TUI to `git:turnChangeSet`. |
| Agents emit malformed fences often | MEDIUM | MEDIUM | Skill worked examples; the Req 5.13 corpus doubles as parser fixtures; the reason line tells the user |
| Mounting a renderer in a string-sanitised pipeline opens a forgeable marker | MEDIUM | HIGH | Req 2.9 trust specs. Code-logic reviewer checks against TASK_2026_532 defects 1-6. |
| Virtualization remounts cause flicker or lost snapshot state | MEDIUM | MEDIUM | Req 2.7 identity and remount rules, Req 5.4. Frontend reviewer runs a long-session fixture. |
| The A2UI mapping is wrong | MEDIUM | MEDIUM | Req 4.1 addendum before PR E |
| Catalog collision with TASK_2026_594 | HIGH | MEDIUM | Team-leader blocks PR D until 594 merges |
| The test matcher misclassifies masked exit codes | MEDIUM | LOW | The limitation is documented in Req 1.2; specs pin the examples |

## Open questions

- **Export and sharing.** Should rendered blocks and the tests row appear in session export or sharing? Product
  owner.
- **Host-data marking.** Should host-bound values be visually marked as host data? Designer.

## Handoff

- **Next specialist:** a Codex cross-side review of revision 3. Then, in parallel:
  - **ui-ux-designer:** tests row; block placement; pending, unavailable, empty, reason-line and snapshot states.
  - **researcher-expert:** the Req 4.1 addendum.
  - **software-architect** follows.
- **Why:** the decisions and the grammar are fixed. What remains open is the visual design and one external fact gap.

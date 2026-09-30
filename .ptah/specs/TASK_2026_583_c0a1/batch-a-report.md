# Batch A report — TASK_2026_583_c0a1 (components 1-3, chat-ui)

## Files

- CREATED `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts`: `describeToolTarget` (`short`/`full`/`isPath`), `displayToolName`, `isPtahMcpToolName`, `toolStatusBadgeClass`, `shortenToolPath`, `truncateToolText`.
- CREATED `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.spec.ts`: table tests for each tool family, both Ptah MCP naming styles, missing input and `__summary`.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts`: now calls the util. The private `shortenPath`/`truncate` and the duplicated description, badge and name logic are gone. The template is unchanged.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`:
  - marks gain `toolName` and `excerpt`;
  - content gains `format` (`markdown` | `snippet` | `plain`);
  - tool mark `text` is the redacted target, built only from the tool input;
  - the error excerpt keeps 8 lines / 600 characters before redaction;
  - new newest-first `selectRecapItem`;
  - status is "Failed" only when the selected content is an error;
  - `describeTool`/`toolVerb`/`safePathOrText` are deleted.
- MODIFIED `compact-session-summary.spec.ts`: new cases (a)-(e), and updated expectations for the new label, text and redaction.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`:
  - the recap renders by `format`, with the snippet as an interpolated `<pre>` that has no scroll of its own;
  - list cards are flattened, recap `pre` blocks no longer scroll, and headings have no border;
  - tool rows show `ptah-tool-icon`, a status-coloured name badge, the target and a check or cross icon;
  - the detail of a failed row is its excerpt;
  - `isMarkdownContent` is removed.
- MODIFIED `compact-session-activity.component.spec.ts`: `format` added to fixtures, plus 7 new cases (tool row, failed-row excerpt, no success output, literal glob, snippet, markdown/plain, CSS flattening).

## Deviation from the plan

- The plan says the live `tool_result` can reach its `tool_start` through `state.events.get(toolCallId)`. That is wrong. `events` is keyed by event id (`accumulator-core.service.ts:381-391`), so the live lookup always missed and the name always came out as "tool". The code now finds the start through `state.toolCallMap`. Spec fixtures fill `toolCallMap` the same way the accumulator does.

## Verification

- `npx nx test chat-ui --skip-nx-cache --maxWorkers=2`:
  - Tests: 345 passed, 345 total.
  - Test Suites: 33 passed, 5 failed.
  - All 5 failures are "Could not locate module marked": `jest.preset.js:31` maps `marked` to `<worktree>/node_modules`, and this worktree has no `node_modules`. This is an environment problem, not caused by this batch.
  - The failing suites are tool-input-display, tool-output-display, code-output, agent-card-output and diff-display. None of them was touched.
- Scoped run of `compact-session/` and `utils/`: 7 suites, 133 tests, all passed.
- `npx nx lint chat-ui`: 0 errors, 8 warnings. The only warning in a changed file is `max-lines` on `compact-session-activity.component.ts`. It was already over the limit before this change; the new tool-row code made it longer.
- `ptah_get_diagnostics` on the four changed source files: no errors.

## Review fixes

Source: `code-style-review.md` and `code-logic-review.md`.

| Id | Fix | Files |
| --- | --- | --- |
| S1 | Pure feed-row code (`CompactFeedRow`, `CompactFeedToolBadge`, badge/glyph constants, `TONE_TOOL_STATUS` with a note on `warning`/`idle`, `markFeedRow`, `toolFeedRow`) moved to `compact-feed-rows.ts`; component keeps name, selector and inputs and delegates. New TestBed-free `compact-feed-rows.spec.ts`. Component: 1213 -> 1053 lines (963 counted by `max-lines`, same as HEAD's 965; the remainder is the inline style block). | `compact-feed-rows.ts` (new), `compact-feed-rows.spec.ts` (new), `compact-session-activity.component.ts` |
| S2 | One path shortener: `compact-wire-text.ts` keeps its URL guard and delegates to `shortenToolPath`. Rows now read `.../a/b.ts` (backslashes become `/`). | `compact-wire-text.ts`, `compact-wire-text.spec.ts`, activity spec |
| S3 | One `lucide-angular` block with a tone-selected icon and colour. | activity component template |
| L1 | A finalized agent is pushed after its children, so a completed agent answers its children's failures (no recap, no "Failed"). | `compact-session-summary.ts` + spec |
| L2 | Done: a live `tool_start` without input reads the input from `toolInputAccumulators` once it parses; partial JSON keeps the tool name. | `compact-session-summary.ts` + spec |
| L3 | The apply pass treats missing or stale `minH`/`maxH` as a change, so a node created or restored at its target geometry gets its 2..5 bounds. | `canvas-workspace-grid.component.ts` + spec |
| L4 | `ToolTarget.text` (uncut: Bash description before command) drives the compact row, matching the normal header's `short`. | `tool-target.utils.ts` + spec, summary + spec |
| L5 | `boundedText` writes tool output up to the excerpt budget and stops; nothing is stringified whole. | `compact-bounded-text.ts` (new) + spec |
| L6 | A failed agent carries `format: 'snippet'` and a bounded excerpt; the recap renders it as plain monospace. | `compact-session-summary.ts` + spec |

Verification:

- `npx nx run-many -t test -p chat-ui canvas --parallel=2 -- --maxWorkers=2`: chat-ui 40 suites / 401 tests passed; canvas 9 suites / 219 tests passed.
- `npx nx run-many -t lint -p chat-ui canvas`: 0 errors; chat-ui 8 warnings (same count as batch A reported), canvas clean. Remaining warning in scope: `max-lines` on the activity component (963 counted).
- `tsc --noEmit` on chat-ui and canvas `tsconfig.lib.json`: clean.

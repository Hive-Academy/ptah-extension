# Batch 21q — executor report (TASK_2026_559_8ca9)

## Summary

The stdio `AgentToolDispatcher` now sends every success result through the same
tool-result budget step the HTTP dispatcher uses (`applyToolResultBudget`). That
covers the six handlers that had no bound (`agent_spawn`, `agent_status`,
`agent_message`, `agent_report`, `agent_stop`, `agent_list`) and `agent_read`. Error
results stay un-budgeted, as on the HTTP surface. The six sweep tests that failed
before now pass without any change to their assertions.

## Files changed

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`
  - The free `toolSuccess(request, text, sc)` function is replaced by one private method,
    `toolSuccess(request, tool, text, sc)`. The method runs `applyToolResultBudget` with
    `toolName: ptah_<tool>`, `requestId: request.id`, `spoolRoot: this.spoolRoot()` and
    an `output` channel that writes to the dispatcher logger at warn. It then builds the
    `{ content, structuredContent }` result from `budgeted.text`.
  - All nine success call sites use the method: spawn, status (both the unchanged line
    and the full status), read, message, report (both the refusal and the delivery),
    stop and list. `toolError` is unchanged, so errors stay un-budgeted.
  - New helpers: `budgetToolName` (`agent_x` → `ptah_agent_x`, the name
    `_meta['anthropic/maxResultSizeChars']` is declared under, the same key `agent_read`
    already used) and `budgetOutputChannel`.
  - Doc comments updated: the file header, the `spoolRoot` constructor parameter, and
    the `agent_read` comment (which said "stdio has no budget step of its own").
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts`
  - New `describe('AgentToolDispatcher — result budget')` with 3 specs (see below).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`
  - Fixture only: the `stdio MCP server tools` describe gets a `beforeEach` that points
    `process.cwd` at the existing per-test `mkdtemp` `spoolRoot`, and an `afterEach` that
    restores it. **No assertion was edited, skipped or weakened.** See Deviations.

`tool-result-budget.ts`, `protocol-dispatcher.ts` and `protocol-dispatcher.spec.ts` were
not touched, so the Batch 21/21p changes are intact.

## Design

- **One step, not six copies.** The whole budget step is the single `toolSuccess`
  method. Each handler states only its tool name.
- **Budget source.** `getToolResultBudget('ptah_<tool>')` is the value
  `protocol-dispatcher.ts` stamps as `_meta['anthropic/maxResultSizeChars']`, so the
  declaration and the enforcement cannot drift. All six tools use the default of
  2,000 tokens / 8,000 chars.
- **Mirrors `protocol-dispatcher.ts`.** Its `createToolSuccessResponse` / `budgetToolText`
  budgets success text only; `createErrorResponse` and `isError` results are not
  budgeted. The same split applies here. The spool root is the dispatcher's existing
  injectable `spoolRoot` (default `process.cwd()`), which `agent_read` already uses.
  The trailer (reducer name, token counts, spool path) comes from
  `applyToolResultBudget` itself.
- **`agent_read` windowing is kept.** `renderAgentRead` still produces a view that fits
  the budget. The budget step returns text within the budget byte-for-byte and spools
  nothing, so its output is unchanged. This matches the HTTP path, where `agent_read`'s
  view also goes through `createToolSuccessResponse`.
- `structuredContent` is passed through unchanged (see Out-of-scope).

## FB evidence (fails-before / passes-after)

Command: `nx test @ptah-extension/vscode-lm-tools --testFile=mcp-contract.sweep.spec.ts --testNamePattern="stdio MCP server tools"`

Before (unmodified production code): `Tests: 6 failed, 21 skipped, 4 passed, 31 total`.
Each test failed on `expect(text.length).toBeLessThanOrEqual(8000)` with these received
lengths: 280123, 79139, 280167, 280089, 280151, 490877.

- `stdio MCP server tools (TASK_2026_559 Batch 21 r2: real served-catalog routing) › agent_spawn: real contract (KNOWN PRODUCT DEFECT — see report if failing)`
- `… › agent_status: real contract (KNOWN PRODUCT DEFECT — see report if failing)`
- `… › agent_message: real contract (KNOWN PRODUCT DEFECT — see report if failing)`
- `… › agent_report (attributed): real contract (KNOWN PRODUCT DEFECT — see report if failing)`
- `… › agent_stop: real contract (KNOWN PRODUCT DEFECT — see report if failing)`
- `… › agent_list: real contract (KNOWN PRODUCT DEFECT — see report if failing)`

After: `Tests: 21 skipped, 10 passed, 31 total`. All six pass.

## New specs (`agent-tool.dispatcher.spec.ts`, `AgentToolDispatcher — result budget`)

Each spec injects a fresh `mkdtemp` root through the dispatcher's 6th constructor
argument and removes it in `afterEach`.

1. **Oversized success is bounded, trailed and spooled byte-equal.** An `agent_stop`
   result with a 200k-char session id:
   - the text is ≤ 8,000 chars and ≤ 2,000 tokens;
   - it ends with `[reduced: … — full output: …]`;
   - exactly one spool file is written, the trailer names that file, and the file is
     byte-equal to `formatAgentStop(result)`;
   - `structuredContent` is unchanged.
2. **Small success is returned unchanged.** The text equals `formatAgentStop(result)`
   exactly, and no spool file is written.
3. **Error result is not budgeted.** A 20k-char rejection is returned as the full
   `agent_stop failed: …` text with `isError: true`, and nothing is spooled.

Result: `Tests: 35 skipped, 3 passed, 38 total` (filtered run).

## Verification (from the worktree root)

1. `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`
   → `Successfully ran targets test, lint, typecheck for project @ptah-extension/vscode-lm-tools`
   (1 project). An earlier full test run in this batch: `Test Suites: 73 total`,
   `Tests: 2049 passed, 1 todo`. Its only failure was a wrong assertion in my own new
   spec, fixed before the final run. The known real-port HTTP flake did not occur.
2. `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`
   → `Successfully ran target typecheck for 2 projects`.
3. `nx run ptah-electron:validate-deps --skip-nx-cache`
   → `Successfully ran target validate-deps for project ptah-electron and 1 task it depends on`.
4. `nx run degradation-audit:lint --skip-nx-cache`
   → `degradation-audit: TOTAL 300 unsuppressed site(s)`. Unchanged; no new catch sites
   were added.

## Deviations

- **Fixture-only edit to `mcp-contract.sweep.spec.ts`.** Its stdio block never redirected
  the stdio spool root, which is `process.cwd()`, the workspace root under Jest. The
  existing `agent_read` sweep test was therefore already spooling into the worktree's own
  `.ptah/tmp/mcp-out`: files from 05:34-05:43 predate this batch. With the fix, the six
  oversized tests would have written there too. I added a `process.cwd` spy that returns
  the file's existing `mkdtemp` `spoolRoot`. No assertion changed.
- **Cleanup.** I deleted the three `agent_read-*.txt` spool files my own fails-before runs
  wrote to the worktree `.ptah/tmp/mcp-out` (13:39). The older files from before this
  batch are still there, for the owner to remove.

## Out-of-scope observations

- The stdio `structuredContent` still carries the unbounded source values: for example,
  `agent_spawn` repeats `startedAt` and `agent_list` repeats every agent. A host that
  reads `structuredContent` instead of `content` still receives the large payload. The
  HTTP surface sends no `structuredContent` on success. Bounding it is a separate
  contract decision.
- The stdio `tools/list` (`mcp-stdio/tool-builders`) does not stamp
  `_meta['anthropic/maxResultSizeChars']` on its tools, unlike the HTTP `tools/list`. The
  budget is now enforced, but it is not declared on the stdio surface.
- `toolSuccess` resolves `this.spoolRoot()` (default `process.cwd()`) before it knows
  whether the text is within the budget. `process.cwd()` can throw only if the working
  directory was deleted. Every call site except the `agent_report` refusal is inside the
  handler's `try`.

## Revision round 1 (review r3)

Scope: R3-01 (product part), R3-05 and R3-06. `mcp-contract.sweep.spec.ts` and
`mcp-mandate-manifest.spec.ts` were not edited. Paths are relative to
`libs/backend/vscode-lm-tools/src/lib/code-execution/`.

### R3-01 — agent replies lost their body to the Markdown outline reducer

- **Change.** `mcp-core/tool-result-budget.ts:81-105` — `TOOL_CONTENT_HINTS` now marks
  all seven `ptah_agent_*` tools `preformatted`. This is the mechanism the HTTP surface
  already used for `ptah_agent_read`, diagnostics, symbol index and task list. With it,
  no semantic reducer runs. The text keeps its prefix up to the budget, the raw text is
  spooled, and the trailer shows `reduced: none` plus the spool path.
  `applyToolResultBudget` looks the hint up by tool name, so one table entry covers
  both surfaces.
- **The HTTP surface had the same loss.** `protocol-dispatcher.ts:3052-3078`
  (`budgetToolText`) budgets under the same `ptah_agent_*` names with no hint. A 20 KB
  HTTP `ptah_agent_message` was therefore outlined exactly as on stdio. The same table
  entry fixes it; `protocol-dispatcher.ts` itself is untouched.
- **Specs.**
  - `mcp-stdio/agent-tool.dispatcher.spec.ts`, describe
    `oversized replies (review r3: R3-01, R3-05)` › `R3-01 …`:
    1. **20 KB single-run probe** (`'MARK-small-' + 'e'.repeat(20000)`). Keeps the
       marker plus at least 1,000 chars of the detail after it. The token budget sets
       this prefix, because a single run counts one token per byte. The trailer shows
       `reduced: none`.
    2. **20 KB prose reply.** Keeps `raw.slice(0, 5000)` verbatim with `reduced: none`.
       The spool file named in the trailer is byte-equal to the raw text.
    3. **Reply above the outline cap (300 KB).** Still bounded in chars and tokens, and
       the marker is kept.
  - `mcp-core/tool-result-budget.spec.ts`:
    - The `TOOL_CONTENT_HINTS` pin is updated.
    - New shared-layer regression `cuts an agent reply to a prefix instead of outlining
away its body`, which covers the HTTP path.
- **FB.**
  - Stdio spec 1 failed before the fix with `Expected substring: "MARK-small-"`. The
    received text was the `## Agent Message` outline.
  - Spec 2 failed on the reducer: it kept the prose but named a reducer other than
    `none`.
  - The shared spec failed when only the `ptah_agent_message` hint was temporarily
    removed: `Expected: "none" / Received: "markdown-outline"`. The hint was restored
    right after.
  - Spec 3 passed both before and after; it is the guard that the upper bound still
    holds.

### R3-05 — unbounded structuredContent

- **Change.**
  - New file `mcp-stdio/bounded-structured-content.ts`:
    - `structuredContentFits` checks the serialized JSON against the tool budget (chars
      and tokens).
    - `boundStructuredContent` builds a smaller plain object that is always valid JSON:
      - Top-level scalars are kept: numbers, booleans, nulls and strings of up to 128
        chars. This covers agentId, status, mode and total.
      - Arrays keep their first items, each reduced to its scalar fields. The shortest
        array is filled first.
      - Long strings keep a prefix in the room that is left. A field whose prefix would
        be under 32 chars is omitted.
      - The note goes under `ptah_truncation`:
        `{ truncated: true, limitChars, fullStructuredContent | spoolFailure, fullText?, omittedFields, cutFields, lists: {key: {shown,total}} }`.
      - If even the skeleton cannot fit, only the recovery note is returned.
  - `mcp-stdio/agent-tool.dispatcher.ts:257-325` — `toolSuccess` now runs
    `budgetStructured`:
    - JSON within the budget is returned unchanged.
    - Otherwise the full value is spooled as JSON through the existing `spoolToolText`
      (same directory, naming and pruning), and the bounded object is returned. Its
      note names that JSON file and the text spool file.
  - Error envelopes are unchanged.
- **Specs** (same describe, `R3-05 …`).
  - Every oversized case asserts:
    - `JSON.stringify(structuredContent).length ≤ 8000`, and tokens ≤ 2000.
    - `ptah_truncation.truncated === true` and `limitChars === 8000`.
    - The `fullStructuredContent` file parses back to the original value.
  - **`agent_message` (20 KB).**
    - `agentId` and `mode` are kept.
    - `detail` is a prefix that starts with the marker, and
      `cutFields.detail = {shown,total}`.
    - `fullText` is the file named in the text trailer.
  - **`agent_status` (400 agents).**
    - Each shown agent keeps `agentId`, `cli` and `status`; the 200-char task is
      dropped.
    - `lists.agents = {shown, total: 400}`.
  - **`agent_list` (2,000 agents).** `total` (2000) and `roles` are kept whole, and
    `lists` covers both arrays.
  - **Small result.** `structuredContent` is `toEqual` the original, and nothing is
    spooled.
- **FB.** Before the fix, the three oversized specs failed on the size assertion. The
  received JSON lengths were 20054, 132302 and 314936. The small-result spec passed
  before and after.

### R3-06 — stdio tools/list declared no result ceiling

- **Change.**
  - `mcp-stdio/tool-builders.ts:33-51` adds three things:
    - `MAX_RESULT_SIZE_META`.
    - `SESSION_SUBMIT_MAX_RESULT_CHARS = 1024 * 1024`.
    - `agentToolBudgetName`, moved here from the dispatcher so that declaration and
      enforcement share one name mapping.
  - `tool-builders.ts:65-86` — `rename()` stamps
    `_meta['anthropic/maxResultSizeChars'] = getToolResultBudget('ptah_' + name).chars`
    on the seven agent tools.
  - `tool-builders.ts:170` — `session_submit` declares its own cap.
  - The values are stamped in the builders, not in `handleToolsList`. That way the
    bootstrap-window `tools/list` in `apps/ptah-cli/.../mcp-serve.ts:217`, which calls
    `buildMcpMvpTools()` directly, advertises the same values.
- **session_submit value.**
  - Source: `apps/ptah-cli/src/services/mcp/session-submit.service.ts:61`,
    `AGGREGATE_BUFFER_CAP = 1024 * 1024`.
  - It is enforced on `aggregatedText.length` (:439-454), so it is a char (UTF-16)
    bound even though the comment says bytes. The only other text the tool returns is
    the short "no aggregated text" fallback (:595-598).
  - The lib must not import the app, so the value is restated in the lib, documented
    with its source, and not exported.
  - Follow-up for the app owner, not done here: have the app import one shared constant
    from the port instead of keeping two literals.
- **Specs** — `mcp-stdio/stdio-mcp-server.service.spec.ts` › `handleToolsList`:
  - An exact map: 8000 for each of the seven agent tools, 1048576 for `session_submit`.
  - Each agent value is also checked equal to `getToolResultBudget('ptah_' + name).chars`.
  - A filtered catalog keeps the declaration.
- **FB.** The exact-map spec failed before the fix: every value was `undefined`.

### Deviation — one spec outside the listed files

`mcp-core/agent-spawn-surface-parity.spec.ts:15-31` asserted
`{...stdioBuilder, name} toEqual httpBuilder`. The stdio builder now carries `_meta`
itself. HTTP stamps `_meta` at `tools/list` time instead (`protocol-dispatcher.ts:654-664`).
The spec now compares against the HTTP builder plus the ceiling its `tools/list` stamps.
It still asserts that the served definitions match, and more strictly than before. No
other assertion changed.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`
  → `Successfully ran targets test, lint, typecheck`.
  - Full lib Jest run: `Test Suites: 73 passed`, `Tests: 1 todo, 2060 passed, 2061 total`.
  - The six stdio "real contract" sweep tests pass, as does the rest of the sweep. No
    sweep test failed because of the product change: the HTTP agent drivers keep their
    markers under the prefix cut.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`
  → `Successfully ran target typecheck for 2 projects`.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → success.
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`.
  No catch sites were added.
- No new files were written to the worktree's `.ptah/tmp/mcp-out`. The five
  `agent_read-*.txt` files there (05:38-05:43) predate this batch.
- Constraints:
  - No `as any` or `@ts-ignore` added, and no new catch blocks.
  - No cross-lib deep imports.
  - `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are untouched.
  - Spec spool roots use `mkdtemp` and are removed in `afterEach`.

### Out-of-scope observations

- The HTTP surface still sends no `structuredContent` on success, so R3-05 does not
  apply there.
- `mcp-stdio/index.ts:14` still says "7-tool MVP catalog", but there are 8 tools. This
  doc nit was left alone.

# Batch 13 executor report: agent_read / agent_status at the MCP surface

Lane A (hub), worktree `task-559-mcp-tool-contract`, base HEAD e29289a85. Executor: backend-developer (sub-agent).
Nothing staged or committed.

## Tasks

- 13.1: `offset` is passed through the agent namespace, the HTTP dispatcher and the stdio dispatcher. The formatter shows
  the window, and the `ptah_agent_read` description states the default and the `offset` parameter. Batch 12's deferred
  r1 M2 item is closed: both surfaces now show `totalLines` and `omittedLines`.
- 13.2: a 60 s repeat-status throttle in `protocol-dispatcher.ts`, with an injected clock, plus specs for both tasks.

## Files (all MODIFIED)

- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`: `PtahAPI['agent'].read` gained `offset?`. This is
  the agent namespace interface only; `AstCodeInsights` is untouched (Lane I handoff).
- `.../namespace-builders/agent-namespace.builder.ts`: `read` forwards `offset` to `readOutput`.
- `.../mcp-core/protocol-dispatcher.ts`:
  - new `deps.now?: () => number`
  - `AgentReadArgsSchema` (zod, not strict): a string or negative `tail`/`offset` is now a tool error. Before, it was
    silently read as 0.
  - `offset` passed to `read` and to the formatter
  - `repeatAgentStatusLine` and a WeakMap per `PtahAPI` of the last full status each caller received for each agent
- `.../mcp-core/mcp-response-formatter.ts`:
  - `formatAgentRead(result, offset?)` prints `**Lines:** L of N`.
  - When lines were omitted, it adds `Showing lines A-B of N (M omitted; pass offset/tail to page)`, or
    `Showing no lines of N (…)` when the window is empty.
  - "No output yet" now appears only when `totalLines === 0`. Before, an empty window over real output said so too.
- `.../mcp-core/tool-description.builder.ts`: the `ptah_agent_read` description and schema state the 200-lines-per-stream
  default and add `offset`, a 0-based forward window.
- `.../mcp-stdio/agent-tool.dispatcher.ts`:
  - `AgentReadSchema` gained `offset` (int ≥ 0). The schema is strict and is shared with the tool definition, so without
    this the new schema field would have been rejected.
  - `offset` is passed through.
  - `structuredContent` gained `totalLines` and `omittedLines`.
- Specs: `protocol-dispatcher.spec.ts`, `mcp-response-formatter.spec.ts`, `tool-description.builder.spec.ts`,
  `stdio-mcp-server.service.spec.ts`, `agent-namespace.builder.spec.ts`.

## Throttle contract (as implemented)

- **Key.** Caller plus agentId. The caller is `agent:<_callerAgentId>`, otherwise `session:<_callerSessionId>`, taken
  from the Batch 3 `resolveMcpCaller`.
  - A caller with neither an agent nor a session identity (workspace-only or anonymous) is never throttled. Such callers
    cannot be told apart, so they must not throttle one another. This is the conservative per-caller choice.
- **Throttled answer.** Only while the agent is `running` and the status and the CLI session id are both unchanged, and
  only within 60 s of the last full body. The answer is exactly
  `Status unchanged since <iso of last full body> (<status>). Wait for <agent-lane-completed> instead of polling.`
- **Window.** A throttled answer does not extend the window, so a caller gets at most one full body per minute.
- **Terminal statuses.** Any non-`running` status always returns the full body and drops the entry.
- **Errors.** A thrown lookup returns before the throttle runs, so an error is never hidden.
- **Other cases that are never throttled.** The all-agents form (no agentId) and an array result.
- **Bounded map.** Every entry older than 60 s (or one dated in the future) is pruned on each status call. The map is
  weak per `PtahAPI`, so it lives only as long as its server.

## Fails-before (User Decision 17)

The new specs were first run against the unchanged source. That run gave 8 failing tests and 2 suites that failed to
compile:

- **Failing tests.**
  - The throttled repeat.
  - Per-caller isolation.
  - The offset passthrough (HTTP).
  - The omitted-lines line on the default read.
  - The 5,000-line budget test (the omission line was missing).
  - The `ptah_agent_read` description.
  - stdio offset routing and structured counts.
  - The stdio tail call, now asserted with 3 arguments.
- **Suites that failed to compile.**
  - `mcp-response-formatter.spec.ts`: TS2554, because `formatAgentRead` took 1 argument.
  - `agent-namespace.builder.spec.ts`: TS2554, because `read` took 2 arguments.
- **Argument validation.** The HTTP argument-validation spec was added after the fix. I checked it by temporarily
  restoring the old unvalidated handler. It failed with `Expected: true, Received: undefined`, and I then restored the
  real handler.
- **Guards that already passed on old code.** Changed status gives the full body, a new CLI session id gives the full
  body, an exited agent gives the full body, an error is not hidden, and anonymous and all-agents calls are not
  throttled. These pin that the throttle never hides these cases.

## Budget, end to end

The 5,000-line default call goes through the real `handleMCPRequest` budget layer, with the spool root at a `mkdtemp`
directory that `afterEach` removes. The default window of 200 lines at about 70 chars each is 6,255 tokens. The budget
layer cut it to 4,538 chars and 1,955 tokens (limits: 8,000 chars and 2,000 tokens) and kept the `Showing lines
4801-5000 of 5000 (4800 omitted…)` line. It spooled the full window inside the temp root. The spec asserts the char
limit, the `countTokensPiecewise` token limit, the omission line and the spool location. No `ptah-b13-*` directory is
left in the temp directory.

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`:
  - test: 69 suites and 1,952 tests pass. Jest printed its usual "worker process has failed to exit gracefully"
    warning.
  - lint: pass.
  - typecheck: pass. An earlier combined run failed only because I appended `--maxWorkers` and it reached `tsc`
    (TS5023). The re-run without that flag passed.
- `nx run-many -t=typecheck -p @ptah-extension/vscode-lm-tools ptah-cli ptah-electron`: 3 of 3 pass.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered".
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300` (unchanged).
- `prettier --check` on the 11 changed files: all formatted.
- `git status --short`: the 11 modified files above. The two untracked task-folder files were there before and are not
  mine.

## Plan deviations

- **stdio dispatcher (`agent-tool.dispatcher.ts`).** This file is not in the 13.1 file list. It is named in Batch 12's
  "Deferred to Batch 13" note and had to change: its strict schema would otherwise reject the new `offset` that the
  shared tool definition advertises.
- **HTTP `ptah_agent_read` validation.** Now validated with zod. This is a small behaviour change: malformed numbers are
  now errors instead of a silent 0.
- **`ptah_agent_status` description left unchanged.** The stdio `agent_status` reuses the same definition and is not
  throttled, so a description that claimed a throttle would be false there.

## Out-of-scope observations

1. **The window range is approximate when both streams have output.** `readOutput` windows each stream separately but
   reports combined counts only. With both stdout and stderr non-empty, `A-B` is therefore approximate; the formatter's
   JSDoc says so. Exact ranges need per-stream totals on `AgentOutput` (shared and cli-agent-runtime, Batch 12's files).
2. **The budget cut keeps the oldest lines of the default window.** The 200-line default is about 3x over the 2,000-token
   budget at typical line widths. The budget layer's cut keeps the start of the window (lines 4801-4859 in the spec) and
   drops the newest lines, which are the ones a tail read wants. A smaller default, or a cut that keeps the tail for
   `ptah_agent_read`, would fix it. That belongs to a future batch.
3. **The stdio `agent_status` (CLI `mcp-serve`) has no throttle.**

Observations 1-3 are resolved in revision round 1 below.

## Revision round 1 (r1 REVISE 4/10)

Review: `reviews/batch-13-code-logic-review-r1.md` (B1, S1/F2, S2/F3, S3/F4).

### Fixes

- **B1: the default read no longer hides the end.** New shared renderer `mcp-core/agent-read.view.ts`
  (`renderAgentRead(result, offset, budget)`) replaces `formatAgentRead`.
  - It narrows the window before rendering, and checks each candidate with `fitsBudget`, the same test the budget step
    uses (the Batch 15 pattern).
  - A tail keeps the newest lines that fit. A forward page keeps its first lines.
  - Each stream states its exact kept range: `Showing lines A-B of N (M omitted; pass offset/tail to page)`.
  - If not even one whole line fits, the renderer shows the end of the newest line (for a forward page, the start of the
    first line) and says so: `Showing the last C of L chars of line n of N (…)`.
  - The text always fits, so the HTTP budget step leaves it unchanged: no cut, no trailer, no spool. Offset/tail reach
    every line.
- **S2: exact per-stream ranges.** `AgentOutput` gained `stdoutTotalLines` and `stderrTotalLines` (shared), filled by
  `readOutput` (cli-agent-runtime, 2 lines).
  - Each stream section states its own range, and no combined interval is printed.
  - `**Lines:** shown of total` counts the lines actually shown.
- **S1: one shared status throttle.** New module `mcp-core/agent-status-throttle.ts` (`checkRepeatAgentStatus`) holds
  the policy, moved out of `protocol-dispatcher.ts` unchanged. Both dispatchers call it.
  - Stdio keys it on the host-declared `PTAH_MCP_HOST_AGENT_ID` / `PTAH_MCP_HOST_SESSION_ID` and has an injectable clock
    (constructor argument, default `Date.now()`).
  - Stdio hosts do not receive `<agent-lane-completed>`, so the stdio line says when the full status returns instead:
    `Status unchanged since <iso> (<status>). Repeat calls return this line until <iso+60s>; a status change is reported
at once.`
  - The stdio short answer's `structuredContent` is `{ agentId, status, unchangedSince }`, not the agent object.
  - HTTP wording is unchanged.
- **S3: stdio read budget.** `agent_read` uses the same renderer and budget (`getToolResultBudget('ptah_agent_read')`).
  `structuredContent` agrees with the visible text: `lineCount` counts the lines shown, `omittedLines` is total minus
  shown, and per-stream `stdout`/`stderr` views give the first and last line shown.
- **Description.** The `ptah_agent_read` description now says the default returns fewer lines when they would exceed
  the result size limit (the newest lines are kept), and that each stream states the exact lines shown.

### Fails-before

The new transport specs were run against the round-0 code first: **7 failed**.

- **HTTP**, with 200-char lines and `FINAL_FAILURE` on the last line:
  - Two tail-read specs, on 5,000-line and 200-line buffers: final line kept inline, range exact, text within both
    limits, budget step untouched.
  - The forward-page exact range.
  - A single over-long line, shown by its end.
  - Per-stream exact ranges.
- **stdio:**
  - Default read within both limits, keeping `FINAL_FAILURE`, with structured counts that match the text.
  - Repeat-status throttle.

The new `agent-read.view.spec.ts` covers a module that did not exist in round 0, and I did not run it against round 0.

Guards that already passed in round 0 (finished agent / no identity gives the full body on stdio) are kept.

### Files (round 1)

- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts`, `agent-read.view.spec.ts`,
  `agent-status-throttle.ts`.
- MODIFIED:
  - `protocol-dispatcher.ts`: read uses the renderer; the throttle wrapper delegates to the shared module.
  - `agent-tool.dispatcher.ts`: throttle, budgeted read, clock.
  - `mcp-response-formatter.ts`: `formatAgentRead` removed, along with its specs in `mcp-response-formatter.spec.ts`.
  - `tool-description.builder.ts` and its spec.
  - `protocol-dispatcher.spec.ts`, `stdio-mcp-server.service.spec.ts`.
  - `libs/shared/src/lib/types/agent-process.types.ts`: `AgentOutput` only, 4 lines.
  - `libs/backend/cli-agent-runtime/.../agent-process-manager.service.ts` (+2 lines) and its spec (per-stream totals
    asserted).
- **Not touched:** `AstCodeInsights` (Lane I handoff).

### Test hygiene

HTTP read specs inject a `mkdtemp` spool root and remove it in `afterEach`, and they assert that no `.ptah` directory
is created. The one `ptah-b13-*` entry left in the temp directory is the reviewer's `ptah-b13-review-probe.cjs`, not a
spec leftover.

### Process note

A `prettier --write` on the whole `code-execution` directory reformatted 9 unrelated files. They were clean before this
round, and I wrote their committed content back with `git show HEAD:<path>`. Only files changed in this batch differ
from HEAD now.

### Verification (round 1)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: pass, 70 suites and 1,963
  tests. Lint has 0 errors (warnings only, none in the new files; `eslint` on them is clean).
- Also run with cli-agent-runtime and shared: all 3 projects pass (2,114 and 1,069 tests, plus 1 existing skip).
- `ptah-cli` and `ptah-electron` typecheck: pass.
- `ptah-electron:validate-deps`: "All external imports are covered".
- `degradation-audit:lint`: TOTAL 300.
- `prettier --check` on the changed and new files: clean.
- `git status`: `batches.md` and `context.md` show as modified. I did not edit them; the coordinator presumably did.

### Remaining limits

- **Equal cap per stream.** Both streams get the same line cap. When one stream's newest line is itself over budget,
  both streams drop to the partial-line form, even if the other stream's lines are short.
- **No new timeout on status/read lookups.** Hung or malformed agent results are still not fault-injected; this is the
  reviewer's "not verified" row.

## Revision round 2 (r2 REVISE 6/10)

Review: `reviews/batch-13-code-logic-review-r2.md` (R2-S1, R2-S2). The "equal cap per stream" limit recorded in round
1 was R2-S2 and is fixed below.

### Fixes

- **R2-S1: a narrowed window is always spooled.** `renderAgentRead(result, offset, budget, spool)` is now async and
  takes a spool function.
  - "Narrowed" means the view shows fewer lines of a stream than `readOutput` returned for it, or only part of a line.
    In that case the whole returned window of that stream (`result.stdout` / `result.stderr`, byte for byte) is saved
    with the Batch 2e `spoolToolText`.
  - The stream's notice names the file:
    `Showing lines A-B of N (M omitted; pass offset/tail to page). Lines X-Y in full: <path>`.
  - If the save fails, the notice says `Lines X-Y could not be saved in full (<code>)`.
  - A view that shows the whole window writes nothing.
  - The partial-line notice no longer suggests that paging reaches the clipped characters. It now reads
    `… chars of line n of N (K other lines omitted; pass offset/tail to page them)`.
  - A spool notice takes room, so the renderer repeats until every narrowed stream has been saved. This takes at most
    one extra pass per stream.
- **Spool roots.**
  - HTTP uses the existing host-owned `resolveSpoolRoot(deps)`.
  - stdio gets a new constructor argument, `spoolRoot`, which defaults to `process.cwd()` of the `mcp-serve` process.
    That directory is set by the launching host, not by the model, so it is the stdio counterpart of the HTTP host
    folder.
- **R2-S2: each stream gets its own budget.**
  - A stream whose edge line (newest for a tail, first for a forward page) fits on its own always keeps whole lines.
  - Only a stream whose edge line cannot fit is shown in part. It first gets a reserve of up to 512 chars; then the
    whole-line streams grow; then the part-shown line takes whatever room is left.
  - If both edge lines fit alone but not together, both are shown in part. This is the only case where a fitting line
    is clipped.
- **Description.** `ptah_agent_read` now says that a line too long to fit is shown in part, and that the full window is
  then saved to a file the result names.

### Fails-before (run against the round-1 code before the fix)

The first run gave **10 failing tests**.

- **HTTP:**
  - The long-line tail on 5,000-line and 200-line buffers, and the forward page: no spool named.
  - A 40,026-char line with `MIDDLE_FAILURE`, read as the default tail and as `offset 0, tail 1`: the middle was
    unreachable.
  - The reviewer's exact R2-S2 fixture in both directions: the huge line on stderr, and on stdout. Both failed on the
    missing short `FINAL_FAILURE … OUT_END` line, which is the right reason.
  - The single over-long line, because its notice wording changed.
- **stdio:**
  - Clipped line spooled and named.
  - Default long-line read spooled.

The description spec assertion failed against the old text. The view spec (`agent-read.view.spec.ts`) targets the new
async signature, so it was run after the fix only. Its new cases are: R2-S2 both directions, and spool-failure
disclosure (`EACCES`).

### Test hygiene

- HTTP specs spool into a `mkdtemp` root that `afterEach` removes. They check that the file is in
  `<root>/.ptah/tmp/mcp-out` and byte-equal to the window, and that a fitting read creates no `.ptah`.
- stdio specs spy on `process.cwd` to return a `mkdtemp` root and remove it afterwards.
- The view spec uses an in-memory fake spool.
- The only `ptah-b13-*` files in the temp directory are the reviewer's three probe `.cjs` scripts.

### Files (round 2)

- MODIFIED: `mcp-core/agent-read.view.ts` (allocation and spool), `agent-read.view.spec.ts`, `protocol-dispatcher.ts`
  (spool hook), `protocol-dispatcher.spec.ts`, `mcp-stdio/agent-tool.dispatcher.ts` (spool root and hook),
  `stdio-mcp-server.service.spec.ts`, `tool-description.builder.ts` and its spec.
- Prettier ran only on these files.

### Verification (round 2)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime
@ptah-extension/shared --skip-nx-cache`: all 3 projects pass.
  - vscode-lm-tools: 70 suites, 1,972 tests.
  - cli-agent-runtime: 2,114 tests.
  - shared: 1,069 tests, plus 1 existing skip.
  - Lint: 0 errors. `eslint` on the new and changed renderer and dispatcher is clean.
- `ptah-cli` and `ptah-electron` typecheck: pass.
- `ptah-electron:validate-deps`: covered.
- `degradation-audit:lint`: TOTAL 300.
- `prettier --check` on the changed files: clean.
- `git status`: only batch files, plus `batches.md` / `context.md`, which I did not edit.

### Remaining limits

- **Edge lines that fit alone but not together.** When both streams' edge lines each fit alone but not together, both
  are clipped. Both windows are spooled, so nothing is lost.
- **No lookup timeout.** Still no new timeout or fault injection for hung agent lookups (unchanged from r1).

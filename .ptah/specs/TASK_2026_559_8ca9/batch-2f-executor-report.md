# Batch 2f executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). No git operations were run. `batches.md` was not edited.

## Tasks

### Task 2f.1 — every success response goes through the budget; debug telemetry — DONE

All paths are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

- `mcp-core/protocol-dispatcher.ts`
  - `createToolSuccessResponse` (:2188) is now `async`. It calls `budgetToolText` (:2217). That function reads the
    tool name from `request.params.name` (`toolNameOf`, :624) and returns text within the tool's budget unchanged.
    It measures that text the same way `applyToolResultBudget` does: the char ceiling first, then a bounded
    `countTokensPiecewise` (`tokensWithinBudget`, :2244). Any other text goes to `applyToolResultBudget` with:
    - `outliner: deps.codeOutliner`;
    - `requestId: request.id`;
    - `spoolRoot` from `resolveSpoolRoot` (:2263): `getCallerWorkspaceRoot()`, else `ptahAPI.workspace.getInfo().path`,
      else `os.tmpdir()`;
    - `output`: a logger-backed `IOutputChannel` at `warn` (`budgetOutputChannel`, :2284).
  - `onToolResult` receives `budgeted.text`, which is the same text the model gets.
  - Every call site awaits the call. That is 55 sites: 52 `return await createToolSuccessResponse(`, and 3 ternaries
    now written `: await createToolSuccessResponse(`. `ptah_lsp_references` on the definition returned 56 references,
    all inside `protocol-dispatcher.ts`, because the function is module-private. The LSP resolves against the main
    checkout, not the worktree, so the line numbers differ. A grep of the worktree `apps/` and `libs/` confirmed there
    are no other users.
  - `handleExecuteCodeCall` (:2320) now sends its success text through `createToolSuccessResponse` (:2358). The error
    path is unchanged.
  - `handleToolsCall` (:593) keeps the response it returns. In `finally` it writes exactly one
    `logger.debug('[MCP] tool result', 'CodeExecutionMCP', {...})` line inside `runObserver`, with these fields:
    `{ tool, durationMs, resultChars, rawTokens, returnedTokens, reducer, truncated, isError }`
    (`toolResultTelemetry`, :648).
    - `resultChars` is the total length of the text blocks in the returned response.
    - Budget counts come from a `WeakMap<MCPResponse, …>` (`budgetOutcomes`, :2178) that `createToolSuccessResponse`
      fills. The dispatcher does not count tokens again.
    - `isError` is true for an `isError` tool result, a JSON-RPC `error`, or a throw (no response).
    - The slow-tool `warn` is unchanged apart from reusing the rounded `durationMs`.
  - `ProtocolHandlerDependencies.codeOutliner?: CodeOutliner` (:187) is new and optional.
- `mcp-http/http-mcp-server.service.ts` (see Deviation 1): optional
  `@inject(TOKENS.TREE_SITTER_PARSER_SERVICE, { isOptional: true })` as the last constructor parameter (:290).
  `new TreeSitterCodeOutliner(parser)` is built once in the constructor and passed as `codeOutliner` (:379).

### Task 2f.2 — declare the budget in tools/list — DONE

- `declareResultBudgets` (:532) runs after `markEagerTools` (:405). It sets
  `tool._meta = { ...tool._meta, 'anthropic/maxResultSizeChars': getToolResultBudget(tool.name).chars }`.
  Existing keys are kept (spread), and the value depends only on the name. Every builder returns a fresh object, so
  nothing is shared between calls.

## Specs (`mcp-core/protocol-dispatcher.spec.ts`)

New `describe('… tool-result budget (TASK_2026_559 2f.1)')` (:2114). Each test uses a temp caller workspace root that
is removed afterwards.

- **JSON result.** A fake tool (`ptah_project_detect_monorepo`) returns more than 50k chars of JSON. The result is
  within 8,000 chars and 2,000 tokens, and it ends with the trailer. The spool file is byte-equal to the raw JSON.
  `onToolResult` got the same text. The telemetry has `rawTokens > returnedTokens`.
- **Log result.** A 50k-char log arrives through `ptah_dashboard_propose_spec`, which passes its text through
  verbatim. All three `ERROR … ECONNREFUSED` lines are present, and the spool file is byte-equal to the log.
- **`execute_code`.** A success result from the real engine (800 rows of pretty JSON) is budgeted, with a trailer.
  The spool file parses to the 800 rows.
- **Under budget.** The text comes back unchanged and no spool directory is created. The debug line carries exactly
  the eight fields. No `info` line is written for it.
- **Tool error.** The line is logged with `isError: true`, `rawTokens: null` and `returnedTokens: null`.
- **JSON-RPC error.** An unknown tool is logged with `isError: true` and `resultChars: 0`.
- **No caller root.** When the caller declares no root, the spool goes under `ptahAPI.workspace.getInfo().path`.
- **Screenshot.** The 40k-char image block passes through byte-equal and nothing is spooled.
- **`ptah_browser_content` pin.** See the risk below.

New `describe('… tools/list maxResultSizeChars (TASK_2026_559 2f.2)')` (:2452):

- Every listed tool carries the key, set to `getToolResultBudget(name).chars`. This runs with IDE and SQLite enabled,
  more than 50 tools. `ptah_browser_content` is 33,792 and the default is 8,000.
- `ptah_get_diagnostics` keeps `anthropic/alwaysLoad` next to the new key.
- `JSON.stringify` of two calls is equal, both with the default capabilities and with all capabilities on.

Two existing assertions that expected `_meta` to be `undefined` (for `execute_code` and a browser tool) now expect
`{ 'anthropic/maxResultSizeChars': 8000 }` only, without `alwaysLoad`.

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  exits 0 with "Successfully ran targets test, lint, typecheck". This was run again after the Prettier pass.
- Jest for the lib alone (`jest -c libs/backend/vscode-lm-tools/jest.config.ts --maxWorkers=2`): 67 of 67 suites and
  1,493 of 1,493 tests pass.
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache` exits 0. This was an extra
  check: the host apps resolve `CodeExecutionMCP` through DI, and the change to it is additive and optional.
- `prettier --check` passes on the three changed files. Prettier also rewrapped the lines where `await` made a call
  longer. It fixed one union type at :583-585 that was not Prettier-clean at HEAD, and that is included.
- No TODO, FIXME, placeholder or stub markers were added.

## Deviations

1. **`mcp-http/http-mcp-server.service.ts` changed. It is outside the batch's file list.** The dispatcher cannot
   reach a `TreeSitterParserService`: the parser is private to `PtahAPIBuilder`, and `ProtocolHandlerDependencies`
   had no outliner. Without wiring, the "Batch 2d outliner" would never reach production. This service is the only
   production caller of `handleMCPRequest` (checked with grep).
   - The parser token is injected as the last constructor parameter, marked optional. The two specs that construct
     the service positionally still compile and pass unchanged.
   - `TOKENS.TREE_SITTER_PARSER_SERVICE` is registered by `workspace-intelligence/src/di/register.ts:172-182` in
     every host, and `PtahAPIBuilder` already requires it non-optionally.
   - On VS Code, where the WASM grammars are missing, `TreeSitterCodeOutliner` resolves `null` and code falls back to
     the log reducer. This is the Batch 2d contract.
   - Alternative not taken: a `createCodeOutliner()` on `PtahAPIBuilder`. That touches two files plus a mock.
2. **The dispatcher checks the budget itself before calling `applyToolResultBudget`.** `applyToolResultBudget` takes
   `spoolRoot` as an eager string. Resolving it on every call would call `ptahAPI.workspace.getInfo()`, which is
   `WorkspaceAnalyzer.getCurrentWorkspaceInfo`, for every result. It would also break the existing spec that
   `ptah_count_tokens` never calls `getInfo`.
   - `tokensWithinBudget` repeats `budgetText`'s identity branch exactly: `length <= chars`, then
     `countTokensPiecewise(text, tokens) <= tokens`. The outcome is identical, and the spool root is only resolved
     for text that must be reduced or cut.
   - Cost: over-budget text is counted twice, once here with the limit and once in the helper. This is bounded by
     the char pre-check.
   - `tool-result-budget.ts` was not changed.
3. **`handleExecuteCodeCall` success path.** Before, a throwing `onToolResult` on success fell into the `catch` and
   turned a successful run into an `isError` "Code execution failed" result. Now the callback runs inside
   `runObserver`, as it does for every other tool, so the success result survives. The error path's unguarded
   `onToolResult` call was left as it was.
4. **Telemetry for responses outside the budget.** This covers tool errors, JSON-RPC errors, the screenshot image
   response, `approval_prompt` and throws. For these, `rawTokens` and `returnedTokens` are `null`, `reducer` is
   `'none'` and `truncated` is `false`. `null` was chosen over a count because the notes say not to count tokens
   again in the dispatcher. `null` also keeps "not measured" distinct from 0.
5. **`ptah_browser_content` pin differs from the wording in the brief.** The brief expected "cut + spool + trailer".
   What happens today for a large page is **reduction without a cut**, followed by a spool and a trailer:
   - The formatter caps each section at 32 KiB, so the output is about 57k chars.
   - The Markdown reducer (`markdown-outline`) keeps the text section whole, including the formatter's
     `[...truncated]`.
   - It replaces the whole HTML code block with `(code block, N lines, omitted)`, so there is no `— partial` marker.
   - The raw output is spooled byte-equal, and the trailer is
     `[reduced: markdown-outline — showing … tokens — full output: <abs path>]`.

   The spec pins exactly that, so the follow-up fix will show as a deliberate change. The Batch 2e follow-up still
   applies: the HTML section is lost under the override. It is now lost to an omission line rather than a cut.

## Risk handling

| Risk (source) | Handling |
| --- | --- |
| Telemetry at `info` would become the highest-volume writer again (plan validation, research-report.md:200-204, cross-cutting.md:319-329) | The per-call line is `logger.debug` only, and it is written once per `tools/call` from `handleToolsCall`'s `finally` inside `runObserver`, so a throwing logger cannot replace the result. A spec asserts there is exactly one debug line and no `info` line with that message. The existing slow-tool `warn` is unchanged. The budget helper's reducer-failure lines go to `warn`. They are rare, only fire when a reducer throws or the budget step fails, and never fire per call. |
| Image blocks are not budgeted (Task 2f.1 validation note, Batch 2f notes) | The screenshot image branch does not go through `createToolSuccessResponse`, so it is untouched. A spec asserts a 40k-char image block passes byte-equal and nothing is spooled. Only text blocks are counted in `resultChars`. |
| Error paths must be covered by the telemetry | The line is derived from the returned response in `finally`. Specs cover a tool error (`isError:true`) and a JSON-RPC error (`isError:true`, `resultChars:0`). A throw with no response is logged with `isError:true`. |
| `onToolResult` must see what the model sees | It is passed `budgeted.text`, and a spec asserts equality with the response text on an over-budget result. |
| Spool root resolution | The order is caller root, then workspace root, then `os.tmpdir()`. A failed or missing `workspace.getInfo` falls through to the temp directory and is never an error. A relative caller root falls back to the temp directory inside `applyToolResultBudget`. The caller-declared root decides where `<root>/.ptah/tmp/mcp-out/` is written, as the plan specified. That is the same identity channel the path-resolving tools already trust. |
| `tools/list` byte stability (prompt cache) | The value depends only on the tool name. Keys are added in a fixed order: `alwaysLoad` first when the tool is eager, then `maxResultSizeChars`. A spec compares `JSON.stringify` of two calls under two capability sets. |
| `ptah_browser_content` override cut (Batch 2e follow-up) | Pinned as it behaves today (Deviation 5). Not fixed here. |

## Out-of-scope observations

- `handleExecuteCodeCall`'s error path calls `deps.onToolResult` without `runObserver`, so a throwing callback there
  rejects the call. This existed before this batch and was not changed.
- Other `handleIndividualTool` paths also call `onToolResult` without `runObserver`: the screenshot image branch
  (`deps.onToolResult?.(…)` directly). This existed before this batch and was not changed.

## Revision round 1

Source review: `reviews/batch-2f-code-logic-review-r1.md` (REVISE 5/10). Each finding is fixed and has a spec that
reproduces the reviewer's case. Both out-of-scope observations above are now fixed (F3). Nothing else was changed.

### F1 (blocking): the spool root comes from host-owned records

`resolveSpoolRoot(deps)` in `protocol-dispatcher.ts`:

- The caller-declared root is used only when it is absolute and `findKnownWorkspaceFolder` finds a host-known folder
  with the same canonical key. The folder returned is the **host's record**, not the caller's string. Canonical
  keys come from `canonicalFolderKey`: `path.resolve` (removes `..`), then `fs.promises.realpath` where the folder
  exists, then trailing separators stripped, then lowercase on win32. The check is equality, not containment.
- Host-known folders are `deps.workspaceProvider.getWorkspaceFolders()` plus the host root
  (`ptahAPI.workspace.getInfo().path`).
- If the declared root does not match, the spool goes under the host root, else under `os.tmpdir()`.
- A UNC path (`\\server\share` or `//server/share`) is never passed to `realpath`, so a share the caller names is not
  touched. UNC paths are compared lexically, so a UNC root is used only if it is a host-known folder.
- The temp fallback, exclusive create and id sanitising in `tool-result-budget.ts` are unchanged.
- New optional dependency: `ProtocolHandlerDependencies.workspaceProvider?: Pick<IWorkspaceProvider, 'getWorkspaceFolders'>`.
  `http-mcp-server.service.ts` passes its existing injected `this.workspaceProvider` (a one-line wiring change). If
  the provider is absent, only the host root is trusted.

Specs (`describe('spool root trust (review F1)')`):

- `ignores a declared root whose parent segments leave the known folder, and spools under the host root`
- `never spools to (or touches) a declared UNC share the host does not know` (also asserts `realpath` never receives
  the share)
- `ignores an unknown absolute declared root, and spools under the host root`
- `uses a declared root that canonicalizes to a known folder, as the host recorded it` (`<known>/sub/../`, uppercased
  on win32, with a second open folder chosen over the host root)

The budget `callTool` helper now passes `workspaceProvider: knownFolders(spoolRoot)` by default. Without it, the
existing specs that declare `spoolRoot` would correctly fall back.

### F2 (serious): approval exception, screenshot text budgeted

- `approval_prompt` is a documented machine-control exception. `declareResultBudgets` skips it, so it does **not**
  carry `_meta['anthropic/maxResultSizeChars']`. Its `updatedInput` is never reduced, and no trailer is added. The
  reason is written in the `declareResultBudgets` doc comment and at the dispatch branch. `APPROVAL_PROMPT_TOOL_NAME`
  replaces the literal in the dispatcher.
- Screenshot mixed response: only the text caption goes through `budgetToolText`, and so through
  `applyToolResultBudget` when it is over budget. The image block is built from `screenshotResult.data` unchanged.
  The response's budget outcome is recorded, so its telemetry now has token counts.
- Specs:
  - `returns an oversized approval_prompt input whole and does not declare a result ceiling for it` (50k input,
    exact JSON echo, no spool, no `maxResultSizeChars`)
  - `budgets the screenshot text block and leaves its image block byte-identical` (a 20k-char `filePath` in the
    caption, text ≤ 8,000 with a spool reference, image `toEqual` the input)
- The 2f.2 spec was renamed to `declares every listed tool except approval_prompt at its budget-table char ceiling`.

### F3 (serious): remaining observers guarded

The screenshot `onToolResult`, the `execute_code` error-path `onToolResult`, and the `execute_code` error
`logger.error` now run inside `runObserver`. Specs:

- `keeps a screenshot success (with its image) when the transcript callback throws`
- `keeps the actionable execute_code error when the transcript callback throws` (a real engine timeout; the result is
  `isError` with the "Execution timeout (50ms) … Try breaking" guidance, not a JSON-RPC error and not
  "observer failed")

### F4 (moderate): telemetry logs only registered names

`handleToolsCall` logs `telemetryToolName(toolNameOf(request))`. This name is used both for the debug metric and for
the slow-tool warn. It returns the name only when it is in `registeredToolNames`. That set is built once from
`buildToolDefinitions({ hasIDECapabilities: true })`, which is the list `tools/list` serves with every namespace and
capability on. Any other name becomes `'<unknown>'`. `buildToolDefinitions` is the tool array extracted from
`handleToolsList` without changes, so the allowlist and `tools/list` cannot drift. The budget lookup still uses the
raw name, and an unknown name there gets the default budget.

- Spec: `logs an unregistered tool name as <unknown>, never verbatim` (`D:/private/secret-token`, checked across
  the debug, info and warn calls)
- The existing unknown-tool spec now expects `tool: '<unknown>'`.

### Verification (round 1)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Successfully ran targets test, lint, typecheck".
- `protocol-dispatcher.spec.ts` alone: 102 of 102 pass.
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache` → success. The new
  dependency field is optional and additive.
- `prettier --write` was run on the three changed files. Only the spec was reformatted.

### Out-of-scope observation (round 1)

- Code that throws from inside the `execute_code` sandbox reaches `handleExecuteCodeCall` as a non-host-realm value.
  `error instanceof Error` is false, so the agent sees "Code execution failed: Unknown error" instead of the thrown
  message (for example, `File not found:` guidance is never triggered). This predates the batch and was not changed.
  It is why the F3 spec uses the host-side timeout error.

## Bounded correction (round 2 review)

Scope: F1 only (reviews/batch-2f-code-logic-review-r2.md). F2, F3 and F4 are unchanged.

**Root cause.** `resolveSpoolRoot` called `hostWorkspaceRoot(deps.ptahAPI)`, which read `ptahAPI.workspace.getInfo()`.
In production that API is session-aware: it resolves the caller's declared URL root first. The result was then added
to the trusted set and also used as the fallback, so a declared root could authorize itself.

**Fix** (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`):

- Deleted `hostWorkspaceRoot`. The spool path no longer calls `ptahAPI.workspace` at all. The trusted folders come
  only from `deps.workspaceProvider.getWorkspaceFolders()`. This is the platform provider injected at
  http-mcp-server.service.ts:380, not the session-aware wrapper. The fallback is the first of those folders, or
  `os.tmpdir()` when there is none.
- The declared root is checked against the host's folders before anything else happens. No caller-root workspace
  analysis runs on this path.
- Added `stripExtendedLengthPrefix`, applied before `path.isAbsolute`, before `path.resolve`, and to the
  `realpath` result.
  - `\?\D:\x` and `\.\D:\x` become the local path `D:\x`.
  - `\?\UNC\server\share` becomes `\server\share`, which stays lexical and is never passed to `realpath`.
- Only exact canonical equality matches. A subfolder does not match. A junction or symlink under a known folder
  canonicalizes to its target, so it does not match either. The value returned is always the host's own folder
  record.
- The `ProtocolHandlerDependencies` type is unchanged. Only the doc comment on `workspaceProvider` changed.

**Specs** (`protocol-dispatcher.spec.ts`, describe `spool root trust (review F1)`):

- The fake `workspace.getInfo` is now caller-aware, as in production: it returns `{ path: getCallerWorkspaceRoot() }`.
  The provider fake returns the known folder.
- Every case asserts that `getInfo` was not called.
- Cases:
  - ignores an unknown absolute declared root, and spools under the known folder
  - ignores a declared root whose parent segments leave the known folder, and spools under the known folder
  - does not trust a subfolder of a known folder, and spools under the known folder
  - does not trust a junction/symlink under a known folder that points outside it
    - This creates a real junction on win32 (a dir symlink elsewhere). It skips with a warning only if the OS
      refuses to create the link. It ran on win32 here.
  - never spools to (or touches) a declared UNC share the host does not know
    - Covers both `\server\share` and `\?\UNC\server\share`. `realpath` is never called with the server name.
  - falls back to the system temp directory when the host has no open folder
  - uses a declared root that canonicalizes to a known folder, as the host recorded it
  - matches the `\?\` extended-length spelling of a known folder (win32 only)
- Updated: "spools under the host provider folder when the caller declared none, without a workspace lookup".
  It used to assert that `getInfo` was called. It now asserts that `getInfo` was not called.

**Verification** (from the worktree root):

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`:
  all three targets succeeded.
- test: 67 suites, 1506 tests passed.
- lint: 0 errors. There are 44 warnings, none of them in protocol-dispatcher.ts or its spec.
- The ptah-cli and ptah-electron typechecks were not run because no dependency type changed.

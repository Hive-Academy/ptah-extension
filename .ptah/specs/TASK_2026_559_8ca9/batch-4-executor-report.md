## Backend implementation — `TASK_2026_559_8ca9`, batch 4

**Tasks completed**: 4.1 (barrel export of `PTAH_MCP_SUBSTITUTION_SECTION`), 4.2 (`server-instructions.ts` + `handleInitialize`)

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/agent-sdk/src/lib/prompt-harness/index.ts — adds `PTAH_MCP_SUBSTITUTION_SECTION` to the re-export list
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/agent-sdk/src/index.ts — adds `PTAH_MCP_SUBSTITUTION_SECTION` beside `PTAH_CORE_SYSTEM_PROMPT` (:283-287)
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/package.json — adds `"@ptah-extension/agent-sdk": "0.0.1"` (see Plan deviations)
- CREATED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts — pure `buildServerInstructionsFrom(section)`, memoised `buildServerInstructions()`, `MAX_SERVER_INSTRUCTIONS_CHARS = 512`
- CREATED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.spec.ts — 21 tests (shipped mandate, derivation, drop order, malformed input)
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts — one import plus `instructions: buildServerInstructions()` in the `handleInitialize` result. No caller branching
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts — the handshake test asserts `result.instructions`; a new test in `caller identity (TASK_2026_559 Batch 3)` sends `initialize` with all four `CALLERS` and asserts identical instructions

**Stack observed**: TypeScript Nx monorepo. Jest via `@nx/jest` (`libs/backend/vscode-lm-tools/project.json`). Module boundaries come from `@nx/enforce-module-boundaries` depConstraints in `eslint.config.mjs:254-400`. `@nx/dependency-checks` applies to the lib `package.json` (`libs/backend/vscode-lm-tools/eslint.config.mjs`). Specs that reach the agent-sdk barrel import `reflect-metadata` first (`vendor-roster-drift.spec.ts:28-33`).

### Task 4.1 evidence

- The export was added to both barrels. The constant was not touched: `git diff --stat -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` printed nothing.
- Module-boundary check:
  - vscode-lm-tools has the tags `scope:extension` and `type:feature`. agent-sdk has the same two tags.
  - The depConstraints allow `scope:extension` → `scope:extension` and `type:feature` → `type:feature`. No constraint applies to `domain:*` tags.
  - agent-sdk has no import of vscode-lm-tools; only comments mention it. So this adds no cycle.
  - `nx lint` passed for both projects.

### Task 4.2 evidence

The derived output for the shipped constant is 505 chars and 505 bytes (all ASCII):

```
Use ptah_* tools instead of built-ins:
Manual workspace exploration -> ptah_workspace_analyze
Bash find / Glob tool -> ptah_search_files
Running build to check errors -> ptah_get_diagnostics
Grep for symbol usages -> ptah_lsp_references
Navigating to find definitions -> ptah_lsp_definitions
git status via Bash -> ptah_get_dirty_files
Fall back to Bash, Grep or Glob only to write files (ptah is read-only), to run build/test/git commands, or when a ptah tool errors.
10 more: execute_code -> ptah.help()
```

How the text is derived:

- **Table rows.** The builder finds the first Markdown table separator row and takes the contiguous data rows after it.
  - From column 1 ("Instead of…") it removes `**` and backticks and collapses whitespace.
  - Column 2 must match `name` or `name { args }`. The builder keeps the name only; a row that does not match is skipped.
- **Fallback line.** The line starting with `Fall back to` is taken the same way, with Markdown stripped.
- **Glue.** Only three short strings are literals: the header, `-> `, and the closing. The closing is `N more: execute_code -> ptah.help()`, or `Other tools: execute_code -> ptah.help()` when every row fits.
- **Budget.** The header, the fallback line and the wider of the two closings are reserved first. Rows are then added in table order until the next row would overflow; that row and everything after it are dropped, so the kept rows are always a leading run of the table. If the fallback line alone cannot fit, it is cut at a word boundary with `...`.
- **Computed once.** `buildServerInstructions()` is a module-level lazy memo (`cached ??= …`), so it is not rebuilt per request.

Guards in `server-instructions.spec.ts`:

- (a) Length is ≤ 512 and the text ends with `ptah.help()`. This is checked for the shipped constant and for every malformed and overflow case.
- (b) Every `X -> tool` name that is listed appears in `PTAH_MCP_SUBSTITUTION_SECTION`, and the first listed tool is `ptah_workspace_analyze`.
- (c) Derivation:
  - Renaming `ptah_workspace_analyze` in the table changes the output, and the old name disappears.
  - Rewording the fallback line changes the output.
  - An exact-output test uses a two-row synthetic table.
- Drop order: a 40-row table keeps a leading run of rows, and the closing reports the correct omitted count.
- Malformed input never throws and stays bounded. The cases are:
  - empty or whitespace-only
  - prose only
  - a table without a separator
  - a separator without rows
  - single-cell rows
  - a huge fallback line (truncated at a word boundary)
  - a huge row
  - CRLF line endings (same output as LF)
  - a non-string input

The dispatcher spec now asserts that `initialize` returns `result.instructions === buildServerInstructions()` in the handshake test. In the caller-identity describe, it asserts the same byte-identical string for the agent, session, workspace and anonymous callers with a Codex `clientInfo`.

**Verification**:

- `node_modules/.bin/jest -c libs/backend/vscode-lm-tools/jest.config.ts <server-instructions.spec.ts> <protocol-dispatcher.spec.ts> --maxWorkers=2` → 2 suites passed, 136 tests passed.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache --parallel=2` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects". All 6 tasks passed.
  - The first run failed `vscode-lm-tools:lint` with an `@nx/dependency-checks` error: `@ptah-extension/agent-sdk` was missing from `dependencies`. It is fixed as described below.
  - That run also failed both typechecks, because I had passed `-- --maxWorkers=2` and that flag was forwarded to `tsc`. It was my invocation error, not a code error, and was dropped for the rerun.
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache --parallel=2` → exit 0, both passed.
- `git diff --stat -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` → empty.
- `eslint` on the four new or changed barrel and instruction files → exit 0, no warnings.
- The VS Code extension app typecheck was not run because it was not in the requested command set.

**Risks handled**:

- **Byte-stable / no caller branching (Notes for Batch 4, edge case in Plan validation).** `handleInitialize` stays outside `runWithMcpRequestContext` and never calls `resolveMcpCaller`. The value is memoised and identical for all four caller kinds (pinned in the spec).
- **Stale copy of the mandate.** The text is derived, not copied, and the rename and reworded-fallback specs pin that.
- **Codex read window.** A hard 512-char budget with a spec guard. The glue is ASCII, so chars equal bytes for the shipped text.
- **Dispatcher hub size (follow-up c).** All derivation logic lives in `server-instructions.ts`. The dispatcher gains 3 lines.
- **Shared constants unchanged (User Decision 4).** `ptah-core-prompt.ts` is byte-identical; it only gained a barrel re-export.
- **Module-boundary lattice.** Checked as described under Task 4.1; it allows this import, so no rule was suppressed.

**Plan deviations**:

- `libs/backend/vscode-lm-tools/package.json` is not in the Batch 4 file list. I added `"@ptah-extension/agent-sdk": "0.0.1"` there because `@nx/dependency-checks` fails lint on the first production (non-spec) value import from agent-sdk. This follows the existing pattern for `@ptah-extension/cli-agent-runtime` in the same file. The alternative was suppressing the rule, which the brief forbids.
- The batch verification line uses `-t test,lint,typecheck`. I ran the brief's quoted form with `--parallel=2` added, to cap load on the shared machine.

**Out-of-scope observations**:

- Every consumer that loads `protocol-dispatcher.ts` now loads the agent-sdk barrel at module load, which reaches tsyringe decorators. The production hosts (VS Code, Electron, CLI) already bundle agent-sdk and load `reflect-metadata`, and the full vscode-lm-tools suite passed. A jest spec in another project that imports the dispatcher without `reflect-metadata` would now need that import. No such failure appeared in the two projects I ran.
- `.ptah/specs/TASK_2026_559_8ca9/code-logic-review.md` and `research/diagnostics-worktree-repro.ts` were already untracked before this batch. I did not touch them.

## Revision round 1

Review: `reviews/batch-4-code-logic-review-r1.md` (REVISE 7/10, two moderate findings). Only `server-instructions.ts` and its spec changed.

**M1 (the omitted substitutions pointed to the wrong place)**: the closing line no longer sends clients to `ptah.help()` to find omitted substitutions. Every table tool is a direct MCP tool, so:

- Tools from rows that do not fit are now named, in table order, on an `Also direct tools: a, b` line while room remains. Rows still take priority, per the approved ordering rule.
- Any tools left unnamed are counted: `N more ptah_* substitutions: see tools/list. execute_code API: ptah.help()`.
- When nothing is left unnamed, the closing is `execute_code API: ptah.help()`. This replaces `Other tools: execute_code -> ptah.help()`.
- The text still ends with `ptah.help()`, now described as the execute_code API help.

**M2 (limit counted characters, not bytes)**: every budget step now uses `size()`, which is the larger of the UTF-16 length and `Buffer.byteLength(utf8)`. That covers the reserved closing, the fallback line, the rows and the omitted-names line. Fallback truncation walks whole code points, so it never splits a surrogate pair. It keeps the word-boundary cut and the closing.

**Shipped text** (500 chars / 500 UTF-8 bytes; measured with an esbuild bundle of the real builder and constant):

```
Use ptah_* tools instead of built-ins:
Manual workspace exploration -> ptah_workspace_analyze
Bash find / Glob tool -> ptah_search_files
Running build to check errors -> ptah_get_diagnostics
Grep for symbol usages -> ptah_lsp_references
Navigating to find definitions -> ptah_lsp_definitions
Fall back to Bash, Grep or Glob only to write files (ptah is read-only), to run build/test/git commands, or when a ptah tool errors.
11 more ptah_* substitutions: see tools/list. execute_code API: ptah.help()
```

The longer closing line costs one row (`ptah_get_dirty_files`), so 5 rows are kept instead of 6. No omitted names fit the 12 characters that remain, so none are listed for the shipped mandate. The names line appears only for tables where room remains, and specs cover that case.

**New or changed specs** (`server-instructions.spec.ts`):

- `sends every omitted substitution to a direct tool that tools/list serves`: builds `tools/list` through `handleMCPRequest` with `hasIDECapabilities: true`. It asserts that every omitted table tool is listed, that named tools are the omitted ones in table order, that the unnamed count matches the text, and that no `more: execute_code -> ptah.help()` remains.
- `fits the 512 char and byte client read window and ends with ptah.help()`
- `drops the rows that do not fit in table order, names what fits, counts the rest`
- `names every omitted tool and closes with only the API help when they all fit`
- `budgets UTF-8 bytes for a CJK row, not only characters`
- `truncates an emoji fallback line on whole code points, keeping the closing`
- `truncates a non-ASCII fallback line at a word boundary within the byte budget`
- Malformed-input table: added fixtures for a CJK row, many CJK rows, emoji rows, and CJK, emoji, spaced-emoji and accented fallback lines. Every case now asserts both limits and whole code points (a UTF-8 round trip leaves the text unchanged).

**Verification**:

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache --parallel=2` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects".
- Spec alone via jest: 33/33 passed.
- `git diff --stat -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` → empty.

## Bounded correction (round 2 review)

**Finding addressed**: round 2 F1 / M1 remainder (`reviews/batch-4-code-logic-review-r2.md`). The text claimed every mapping and all "11 more" substitutions were in `tools/list`. That is false on non-IDE hosts and when the `ide` or `code` namespace is disabled.

**Change** (in `server-instructions.ts` only, the builder stays one cached, caller-independent string):

- Header `Use ptah_* tools instead of built-ins:` → `Prefer these ptah_* tools when listed in tools/list:`.
- A fixed line `If a tool is not listed, use the built-in.` follows the derived `Fall back to…` line, which is unchanged and still derived.
- Omitted-tools prefix `Also direct tools: ` → `Also, if listed: `.
- The numeric closing `N more ptah_* substitutions: see tools/list. …` → the fixed pointer `More substitutions: see available ptah_* tools in tools/list. execute_code API: ptah.help()`. It appears only when some omitted tools stay unnamed; otherwise the closing is `execute_code API: ptah.help()`.
- Budget reservation now covers header + unlisted-fallback line + the widest closing. Unchanged: derivation from `PTAH_MCP_SUBSTITUTION_SECTION`, `size()` = max(chars, bytes), code-point-safe truncation, rows dropped in table order, final `ptah.help()`, and the capability/namespace gates in `protocol-dispatcher.ts`.

**Shipped text** (509 chars, 509 UTF-8 bytes):

```
Prefer these ptah_* tools when listed in tools/list:
Manual workspace exploration -> ptah_workspace_analyze
Bash find / Glob tool -> ptah_search_files
Running build to check errors -> ptah_get_diagnostics
Fall back to Bash, Grep or Glob only to write files (ptah is read-only), to run build/test/git commands, or when a ptah tool errors.
If a tool is not listed, use the built-in.
Also, if listed: ptah_lsp_references
More substitutions: see available ptah_* tools in tools/list. execute_code API: ptah.help()
```

**Spec changes** (`server-instructions.spec.ts`):

- Added a `listedTools(host)` helper. It builds `tools/list` through `handleMCPRequest` for given `hasIDECapabilities` / `disabledMcpNamespaces`.
- Replaced `sends every omitted substitution to a direct tool that tools/list serves` with:
  - `makes no unconditional availability claim, so it holds on every host`: the conditional header is first, the unlisted-fallback line is present, there is no `N more`, and neither the old `instead of built-ins` nor `Also direct tools` wording remains. Only the header and the non-numeric closing mention `tools/list`.
  - `points omitted substitutions to tools/list, named in table order, without a count`.
  - `it.each` over five hosts: IDE with all namespaces, non-IDE, IDE with `ide` disabled, IDE with `code` disabled, and non-IDE with `code` disabled. Each asserts one identical string. The full-capability host must list every shown tool. Restricted hosts must get the conditional header and the unlisted fallback, with no numeric promise.
  - `the full-capability host lists every substitution tool; restricted hosts lack some`: guards the premise that the four restricted hosts really lack mandate tools.
- Updated `keeps every row, in order, when the table fits` (new header and the unlisted line) and renamed `drops the rows … counts the rest` → `drops the rows … points to tools/list for the rest` (asserts `MORE_CLOSING`, no count).

**Verification**:

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache --parallel=2` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects".
- `git diff --stat -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` → empty.
- Shipped text printed from an esbuild bundle of the builder, with the SDK alias pointed at `ptah-core-prompt.ts`. The temp bundle was deleted afterwards.

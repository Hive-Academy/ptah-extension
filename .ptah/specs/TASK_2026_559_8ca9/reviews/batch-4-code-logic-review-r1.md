# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

Batch 4 verdict: **REVISE**. The shipped handshake works and is derived, cached, caller-independent and protocol-compatible. Two bounded defects remain: the advertised discovery route cannot recover several omitted substitutions, and the builder enforces UTF-16 length rather than the requested UTF-8 byte ceiling. This is in the sound-but-needs-correction band, above 5–6 because startup, handshake and prior-batch tests pass; below 8 because these are reproduced contract gaps rather than hypothetical improvements.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

## Five logic questions

### 1. How does this fail silently?

A non-ASCII table row is accepted under the character budget but returns more than 512 bytes without an error (`server-instructions.ts:74`, full path under `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`). A byte-limited consumer would lose the closing discovery instruction. The actual shipped ASCII constant is unaffected: measured 505 characters / 505 bytes.

### 2. What user action produces unexpected behaviour?

A client follows the shipped `10 more: execute_code -> ptah.help()` guidance to discover symbol search. Root help omits the `code` namespace, and `ptah.help('code')` returns `Topic 'code' not found` (`server-instructions.ts:54`; `namespace-builders/system-namespace.builders.ts:34`, `:588`). Memory and webSearch detail lookups fail likewise. The client must discover the direct MCP tools through another route.

### 3. What input data produces a wrong answer?

`'|---|---|\n| ' + '\u754c'.repeat(400) + ' | ptah_ast_analyze |'` produces 500 UTF-16 units and 1,300 UTF-8 bytes. The parser accepts this malformed/headerless table at `server-instructions.ts:95`; the budget accepts its row at `:74`.

### 4. What happens when a dependency fails?

Instruction derivation has no asynchronous or I/O dependency after module loading (`server-instructions.ts:45`, `:88`). Malformed/non-string sections return bounded character strings rather than throw. The SDK barrel evaluates runtime modules, but the same SDK dependency already exists through cli-agent-runtime; no new cycle or production reflect-metadata ordering failure was reproduced. Existing tool failures, budget telemetry and caller identity checks passed in the requested suite (`protocol-dispatcher.ts:235`, `:683`, `:2209`; `protocol-dispatcher.spec.ts:2368`, `:3039`). The diagnostics service itself reported unavailable after 45 seconds; independent Nx typechecks passed.

### 5. What is missing that the requirements never mentioned?

The plan tells the builder to send omitted mappings to help (`batches.md:1276`) without verifying that help documents those mappings. It also specifies characters (`batches.md:1274`); the review request additionally requires bytes. The existing tests cover only `.length`, so do not establish that stronger guarantee (`server-instructions.spec.ts:173`). No persistent state, cancellation or disposal mechanism is needed for this synchronous cached string (`server-instructions.ts:85`).

## Failure modes

### F1 — Omitted substitutions lead to incomplete API help (Moderate)

- Trigger: external client follows the closing line of the shipped initialize instructions to discover one of the ten omitted mappings, notably symbol search.
- Symptom: help lists namespace APIs rather than the omitted direct-tool mappings; `code`, `memory` and `webSearch` detail requests return topic-not-found.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts:51`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:34` and `:588`; source mandate `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:47` and `:59`.
- Current handling: six leading rows survive. Both `ptah_code_search_symbols` and `ptah_ast_analyze` are omitted. All ten omitted tools are direct MCP tools, registered at `protocol-dispatcher.ts:384`, `:385`, `:458`; they do not require execute_code. Only the self-documentation call requires it. The numeral ten correctly counts omitted rows; the defect is relying on help as discovery for the rest. No claim is made that the arrow literally forces execution of every omitted tool through execute_code.
- Reproduction: evaluated the current builder, source constant and `buildHelpMethod` through TypeScript transpilation in isolated Node VM contexts (unrelated imported services stubbed). Shipped tail is exactly `10 more: execute_code -> ptah.help()`. `help('code')`, `help('memory')`, and `help('webSearch')` each returned `Topic ... not found`; root overview contains no code namespace or symbol-search mapping.
- Recommendation: retain the required final `ptah.help()` but describe it as API help, explicitly direct clients to the listed direct MCP tools for omitted substitutions, or ensure the promised help route actually contains those mappings. Add a guard checking the discovery destination, not just the closing string. Do not modify the protected prompt constants.

### F2 — Unicode input exceeds the byte ceiling (Moderate)

- Trigger: a parsed table row contains non-ASCII prose; reproduction above uses 400 CJK characters.
- Symptom: 500-character result occupies 1,300 UTF-8 bytes, despite the requested maximum of 512 bytes.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts:58`, `:71`, `:74`, `:124`; tests at `server-instructions.spec.ts:173` check character length only.
- Current handling: all accounting and slicing use JavaScript `.length`. The shipped constant is ASCII and passes both bounds; this is an input/future-mandate edge case, not a demonstrated current client truncation.
- Reproduction: transpiled and ran the actual pure builder in Node; `out.length === 500`, `Buffer.byteLength(out, 'utf8') === 1300`, and `out.endsWith('ptah.help()') === true`.
- Recommendation: budget UTF-8 bytes as well as characters, including fallback truncation, preserving code points and the closing. Assert both limits for CJK, emoji and non-ASCII fallback fixtures.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

- **F1:** incomplete omitted-tool discovery, `server-instructions.ts:54`. Correct the new guidance or its discovery destination; dropping later rows itself follows the approved ordering rule and is not a separate finding.
- **F2:** byte ceiling not enforced, `server-instructions.ts:74`. Use byte-aware accounting and regression fixtures.

## Data flow

1. **OK:** the unchanged-source export is re-exported by `agent-sdk/src/lib/prompt-harness/index.ts:13` and `agent-sdk/src/index.ts:286`; no duplicate mandate literal is introduced.
2. **OK with coupling noted:** `server-instructions.ts:17` imports the SDK public barrel. Both projects are `scope:extension` / `type:feature` (`agent-sdk/project.json:6`, `vscode-lm-tools/project.json:6`), and both lint targets passed.
3. **OK:** table and fallback text are parsed from the provided section (`server-instructions.ts:47`, `:94`, `:110`). Rename/reword guards exercise derivation (`server-instructions.spec.ts:66`, `:79`).
4. **F2:** reserve glue/fallback, then keep a prefix of rows (`server-instructions.ts:58`, `:72`); character budget does not bound UTF-8 bytes.
5. **F1:** append an accurate omitted-row count but an incomplete discovery route (`server-instructions.ts:81`).
6. **OK:** lazy synchronous memo means a single calculation per module instance, no race across an await (`server-instructions.ts:85`).
7. **OK:** initialize returns the string directly within `result`, with no caller/client branching and outside request context (`protocol-dispatcher.ts:229`, `:279`, `:297`).
8. **OK:** tools/list still composes the same set by caller, stamps eager flags and result budgets; tools/call retains request context and telemetry (`protocol-dispatcher.ts:235`, `:334`, `:683`). Existing Batch 2f/3 guards passed.

## Runtime import graph and structural judgment

Built two **in-memory esbuild bundles** from the dispatcher with the worktree tsconfig, `bundle:true`, `platform:'node'`, `format:'cjs'`, `packages:'external'`, `metafile:true`, `write:false`. Comparison variant removed only the new server-instructions import and result property in an onLoad transform; it is a controlled Batch 4 comparison, not a git-baseline checkout.

| Measurement | Without Batch 4 dispatcher additions | Current |
| --- | ---: | ---: |
| Input modules | 806 | 807 |
| agent-sdk input modules | 145 | 145 |
| Output bytes | 3,516,501 | 3,519,446 |

Existing path: `protocol-dispatcher.ts:29` → `cli-agent-runtime/src/index.ts:23` → `cli-agent-runtime/src/lib/wiring/agent-events.ts:30` → agent-sdk barrel. New shorter path: `protocol-dispatcher.ts:113` → `server-instructions.ts:17` → the same barrel. Traversing esbuild's resolved input graph from agent-sdk found **no path back to vscode-lm-tools**, including transitively.

Both bundle variants retain the same dynamic imports for Claude, Codex and Cursor SDKs; no sqlite external was introduced. SDK modules/decorators are already in the existing dispatcher graph. All production composition roots import reflect-metadata first: `apps/ptah-extension-vscode/src/main.ts:1`, `apps/ptah-electron/src/main.ts:1`, `apps/ptah-cli/src/main.ts:27`. Thus the executor's suggestion that this newly creates a dispatcher-wide reflect-metadata requirement overstates the delta. No startup regression is supported by this evidence. These are module-graph/bundle checks, not packaged-host launch tests.

A declared pure secondary entry point would reduce direct coupling and can be a follow-up; the current import is allowed by the lattice and adds no demonstrated heavy dependency regression. A direct deep import would violate repository boundaries. Moving the constant into shared/platform-core now would modify protected `ptah-core-prompt.ts`, contrary to Decision 4; it is not a required fix for this batch.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Derived table/fallback, no literal mandate copy | COMPLETE | Parser and mutation guards verified |
| Shipped output at most 512 chars/bytes, final ptah.help() | COMPLETE | Measured 505/505 |
| All malformed inputs bounded in chars and bytes | PARTIAL | F2: UTF-8 bytes unbounded by 512 |
| Same instructions for Codex/Claude and all caller kinds | COMPLETE | Eight extracted-handler executions, one distinct string; suite also covers both client fixtures |
| Computed once | COMPLETE | Synchronous module memo at server-instructions.ts:89 |
| Useful discovery of omitted substitutions | PARTIAL | F1: help lacks relevant topics |
| InitializeResult top-level string field | COMPLETE | Actual handler result accepted by installed MCP SDK InitializeResultSchema |
| Prompt constants byte-identical | PARTIAL | Executor reports empty diff; independent baseline comparison unavailable under reviewer's no-git rule |
| No new runtime cycle/load-order regression | COMPLETE within graph scope | Metafile traversal and production entry-point ordering checked; no host launch performed |
| No Batch 2f/3 regression | COMPLETE within scoped verification | Requested project checks and their regression guards passed |

The field placement also matches the official [MCP 2024-11-05 InitializeResult schema](https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2024-11-05/schema.ts), which declares optional `instructions?: string` alongside capabilities and serverInfo.

Implicit requirements not addressed: completeness of the advertised discovery destination (F1). Same text across caller kinds deliberately does not tailor instructions to host capability/namespace settings; no additional finding is assigned to that planned behavior.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/non-string input | YES | Empty parsed section still emits header/closing | No new defect |
| Missing separator or malformed tool cell | YES | No rows / invalid rows skipped | Covered by tests |
| Oversized ASCII row or fallback | YES | Drop row suffix / truncate fallback | Covered by tests |
| Unicode row | NO | UTF-16 length admits 1,300-byte result | F2 |
| CRLF section | YES | Normalized line parsing | LF-equivalence guard |
| Repeated/concurrent initialize | YES | Synchronous memo, no request-dependent values | No per-session state |
| Code/memory/webSearch help lookup | NO | Topic-not-found | F1 |
| SDK dependency cycle | YES in examined graph | No return path to vscode-lm-tools | Packaged hosts not launched |

## Verification and limitations

- Ran once from worktree root: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache`. All six tasks passed; Nx reported successful completion in about one minute. No port EACCES failure occurred. One completion read; no suite rerun.
- Scoped `ptah_get_diagnostics` returned `typescript-compiler — Unavailable`, still running after 45 seconds. Not treated as a code defect; both requested Nx typechecks passed.
- Node VM reproductions executed the actual transpiled pure builder and help function, plus the extracted initialize function, without changing source or adding tests. Eight initialize combinations (two clients × four caller kinds) passed SDK schema validation with identical text.
- Read the Batch 4 scope/notes, plan validation, executor report, context decisions and both specified research passages. This task is plan-free; no task-description.md, implementation-plan.md or code-style-review.md was present. `ptah_search_files` returned no AGENTS.md; native instruction-file search also returned none. Native reads were used because no direct file-read tool was listed.
- The supplied seven-file review scope was used. The role explicitly prohibits git operations, so git status/diff and an independent before/after byte comparison of `ptah-core-prompt.ts` / `NATIVE_AGENT_TOOL_POLICY` were not run. Executor's empty-diff assertion is supporting evidence only, not independently certified. No source file, task state, or raw session log was edited/read respectively.

## Executor deviations

Adding `@ptah-extension/agent-sdk` to `vscode-lm-tools/package.json:17` is justified by the new direct value import and dependency-check lint; no rule was suppressed. Limiting executor parallelism is operationally reasonable. Keeping derivation outside the dispatcher and preserving table order implements `batches.md:1244` and `:1276`. Omitting symbol/AST rows is therefore not itself an unauthorized deviation; promising help for them without validating that route is F1. The executor established characters and shipped ASCII bytes, but not the stronger all-input byte guarantee. Its no-cycle conclusion is corroborated by graph inspection, while its newly introduced reflection-dependency concern is not supported by the before/current graph comparison.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for the two reproductions and scoped checks; limited for protected-file baseline identity and packaged-host behavior.
- Top risk: external clients following the new closing cannot discover the omitted symbol-search substitution through the promised help route.
- What a robust implementation would add: truthful direct-tool versus API-help guidance, a tested discovery destination, and UTF-8-aware length guards preserving the required closing.
# Batch 25a report: Task 25.1 and the capper token/register part of Task 25.3

**Verdict**: the work is done, and agent-sdk test, lint and typecheck pass, as do di-lint and degradation-audit. One check fails: the importer typecheck fails in `@ptah-extension/agent-generation` (TS1479, `marked` is ESM-only and that project uses `module: node16`). The fix is a one-line tsconfig change in a project this batch does not own. The orchestrator needs to decide whether to make it (see Blocker).

## Changed files

- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts`
  - Contains `ToolOutputCapper`, with `cap(toolName, toolInput, toolResponse, cwd): Promise<unknown>` and `static appliesTo(toolName)`.
  - When nothing changed, `cap` returns the same response object. Task 25b can test `!==` to decide whether to emit `updatedToolOutput`.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.spec.ts`: 13 tests.
- MODIFIED `libs/backend/agent-sdk/src/lib/di/tokens.ts`: adds `SDK_TOOL_OUTPUT_CAPPER` (`Symbol.for('SdkToolOutputCapper')`) and `SDK_CODE_OUTLINER` (`Symbol.for('SdkCodeOutliner')`).
- MODIFIED `libs/backend/agent-sdk/src/lib/di/register.ts`: registers the capper right after `SDK_COMPACTION_CONFIG_PROVIDER`.
- MODIFIED `libs/backend/agent-sdk/package.json`: adds the dependency `"@ptah-extension/tool-output-reducers": "0.0.1"`. This file is outside the batch list; see Deviations.

## Behaviour

- **Scope.** The capper handles `Bash`, `PowerShell`, `Grep`, `Read`, and any `mcp__*` tool except `mcp__ptah__*`. For a skipped tool it returns the input before reading the config. Any other tool name passes through.
- **Budget.** The token budget is `CompactionConfigProvider.getConfig().toolOutputBudgetTokens`. The char ceiling is the token budget × 4, the same ratio `tool-result-budget.ts` uses.
- **Shape-preserving (AS9).**
  - The text fields it rewrites are: Bash/PowerShell `stdout`/`stderr`, Grep `content`, Read `file.content`, and the `text` of MCP `type: 'text'` blocks. MCP results are handled both as a bare block array and as `{ content: [...] }`.
  - Every other field and block is copied unchanged. A response of any other shape is returned unchanged.
  - When a response has several text fields, they share the budget. A field that fits within an equal share keeps its raw text, and the remaining budget is split equally among the fields that do not fit.
- **Whole-file Read over budget** (no `offset` and no `limit`):
  - The content is reduced with `reduceOutput` within the space left after the trailer is reserved, then cut to fit.
  - Reducer choice: the Markdown reducer for `.md`, `.mdx` and `.markdown` files. Otherwise the code reducer with the file extension as `languageHint`, if an outliner is bound. Otherwise the log reducer.
  - The trailer reads: `[outline: <reducer> — showing N of M tokens — full file: <path> — read with offset/limit for the omitted lines]`.
  - Nothing is spooled, because the file itself is the full copy.
- **Everything else over budget.** The text goes through `applyOutputBudget` from `@ptah-extension/tool-output-reducers`: reduce, cut, spool to `<cwd>/.ptah/tmp/mcp-out/`, then add the trailer with the spool path. Ranged Reads take this path too.
- **Fail-open.** Any error returns the original response. It logs one `logger.warn` line naming the tool and the error class; the class comes from `instanceof`, so the error message is never printed. Reducer and budget-step diagnostics go to the logger through a small `IOutputChannel` adapter.

## Stack observed

- tsyringe DI with `Symbol.for` tokens (`di/tokens.ts`), and `register.ts` using `container.register` and `instanceCachingFactory`. The precedent for the factory is the boundary registry at `register.ts:424`.
- Logger and config are injected with `@inject(TOKENS.LOGGER)`, the same way as the sibling `compaction-config-provider.ts` and `session-budget.service.ts`.
- Module boundaries: agent-sdk is `scope:extension, type:feature` and the reducers library is `scope:extension, type:util`. Root `eslint.config.mjs:260,365` allows that dependency.

## Checks (each run once unless noted)

| Check | Result |
| ----- | ------ |
| `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk` (first run) | Test: 136 of 139 suites passed and 2 were skipped (2831 tests passed). The one failure was `subagent-message-dispatcher.spec.ts` "passes limit/offset through": a 5000 ms timeout under load. Run alone, it passes 23/23 (a load flake, like the known `session-handoff-writer` one). Lint failed with 1 error: `@nx/dependency-checks`, missing `@ptah-extension/tool-output-reducers` in package.json. The typecheck was invalidated because a `--maxWorkers` passthrough reached `tsc`. |
| `nx run-many -t lint,typecheck -p @ptah-extension/agent-sdk` (after the package.json fix and the factory change) | Exit 0, "Successfully ran targets lint, typecheck". No warnings in the new files. |
| `jest tool-output-capper.spec.ts` plus `di/` smoke spec (after the final edits) | 2 suites, 21 tests passed. |
| Importer typecheck: the affected set for `agent-sdk/src/index.ts`, minus `api-*`, `ptah-license-server`, `ptah-landing-page-e2e` | 17 of 18 passed. `ptah-extension-vscode-e2e` and `degradation-audit` have no typecheck target. **FAILED: `@ptah-extension/agent-generation:typecheck`**, TS1479 at `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts:30` (`import ... from 'marked'`). |
| `npx nx run di-lint:lint` | First run failed: `SDK_CODE_OUTLINER` was `@inject`ed (`isOptional`) but registered nowhere. di-lint has no optional exemption. After switching to the factory: exit 0, "di-lint OK: 1738 @inject sites all resolve". |
| `npx nx run degradation-audit:lint` | Exit 0, `libs/backend/agent-sdk: 4 ok (baseline 4)`. |
| `*.png` | None rewritten; `git status` shows only the five files above. |

## Blocker: agent-generation importer typecheck

- **Cause.** `libs/backend/agent-generation/tsconfig.json` sets `"module": "node16"`, and it is the only lib or app that does. agent-generation typechecks agent-sdk source. agent-sdk now reaches `@ptah-extension/tool-output-reducers`, whose `markdown.reducer.ts` statically imports the ESM-only `marked`. Under node16 a CommonJS file cannot `require` an ESM module, which gives TS1479.
- **Why this batch cannot avoid it.** Any import of the reducers barrel puts that file into the program, and so do `import type` and dynamic `import()`. The only way around it is for agent-sdk not to use the reducers, which contradicts the plan.
- **Evidence for a fix.** `npx tsc --noEmit -p libs/backend/agent-generation/tsconfig.lib.json --module preserve --moduleResolution bundler` exits 0. These are the settings agent-sdk, vscode-lm-tools and tool-output-reducers use in their `tsconfig.lib.json`.
- **Recommended fix (not applied).** It is outside this batch's ownership. In `libs/backend/agent-generation/tsconfig.lib.json`, add `"module": "preserve", "moduleResolution": "bundler"`, or replace `"module": "node16"` in its `tsconfig.json`. Then re-run `npx nx run @ptah-extension/agent-generation:typecheck`.

## Deviations

1. **The `SDK_CODE_OUTLINER` injection uses a factory instead of `@inject(..., { isOptional: true })`.**
   - di-lint requires every `@inject` token to be registered somewhere, and the hosts bind this token only in 25b.
   - The capper's third constructor parameter is a plain optional `outliner?: CodeOutliner`. di-lint skips `?` parameters.
   - `register.ts` builds the capper with `instanceCachingFactory`. On the first resolve, the factory passes `c.resolve(SDK_CODE_OUTLINER)` only when `c.isRegistered(SDK_CODE_OUTLINER, true)`.
   - These are the same semantics as `isOptional`, because the lookup happens at first resolution. The hosts must bind the token before the capper is first resolved, which 25b's phase-file binding satisfies.
2. **`libs/backend/agent-sdk/package.json` was edited.** The repository's `@nx/dependency-checks` lint rule (agent-sdk `eslint.config.mjs`) requires the new dependency. No other active agent owns this file.
3. **Spool file names.** The plan's `cap` signature has no tool-use id, so the spool request id is the tool name, for example `Bash-<epoch>-<hex>.txt`.
4. **The capper imports `Logger`/`TOKENS` from `@ptah-extension/vscode-core`, as every sibling agent-sdk helper does.** agent-sdk already declares that dependency. The "no new vscode-core import" note is read as "no outliner or other host type pulled into agent-sdk". The outliner type comes from `@ptah-extension/tool-output-reducers`.

## Out-of-scope observations

- `CompactionConfigProvider.getConfig()` writes a debug log line on every call. The capper calls it once per capped tool call, so debug logs get one line per Bash/Grep/Read/MCP call. If that is too noisy, cache the value or skip the log; that file belongs to 17a.
- In a capped Read, `file.numLines`/`totalLines` keep their original values while `content` is the outline. This is by design (AS9 shape preservation), but 25b may want to know about it.

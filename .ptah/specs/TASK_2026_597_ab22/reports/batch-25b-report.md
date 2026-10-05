# Batch 25b report: Task 25.2 and the host outliner bindings

**Verdict**: done. All checks pass.

## Changed files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts`
  - New optional third constructor parameter: `@inject(SDK_TOKENS.SDK_TOOL_OUTPUT_CAPPER) capper?: ToolOutputCapper`. It is optional so the two external specs that build the handler with two arguments still compile.
  - The hook now caps first and fans out second. It returns `{ continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput } }` only when the capper's result `!==` the input `tool_response`.
  - Fail-open: a capper error logs a warning and returns the original response.
  - The callback fan-out moved into a private `fanOut` method with its own try/catch. It runs regardless of the capper result and sees the original output. The capper now runs even when the callback registry is empty (previously the hook returned early).
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.spec.ts`: 3 new tests (updated output returned, same object gives no `hookSpecificOutput`, capper throw fails open).
- MODIFIED `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` and `apps/ptah-electron/src/di/phase-2-libraries.ts`
  - Each registers `SDK_TOKENS.SDK_CODE_OUTLINER` with a `useFactory` that returns `new TreeSitterCodeOutliner(c.resolve(TOKENS.TREE_SITTER_PARSER_SERVICE))`.
  - The registration sits right before `registerSdkServices`. The parser is resolved lazily from workspace-intelligence.
- MODIFIED `libs/backend/vscode-lm-tools/src/index.ts` (outside the listed files): adds the export `TreeSitterCodeOutliner`. It was not in the public barrel, and the apps cannot deep-import.

## CLI host

I did not bind it. `registerVsCodeLmToolsServices` is not called from the CLI app (`apps/ptah-cli`) itself. The CLI composition lives in `libs/backend/cli-engine/src/lib/container.ts`, which I did not inspect. Binding there needs a new `vscode-lm-tools` import in cli-engine and a check that `TREE_SITTER_PARSER_SERVICE` is registered. Without a binding, the capper falls back to the log reducer for code files. This needs an orchestrator decision.

## Checks

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`: success. No flakes this run.
- The agent-sdk importer typecheck (18 projects, excluding `api-*`, `ptah-license-server`, `ptah-landing-page-e2e`, `ptah-extension-vscode-e2e`, `degradation-audit`) passed, including both apps and `agent-generation`. The `agent-generation` typecheck passes because its `tsconfig.lib.json` was already modified in the working tree after 25a.
- `npx nx run di-lint:lint --skip-nx-cache`: "di-lint OK: 1739 @inject sites all resolve".
- `npx nx run degradation-audit:lint`: exit 0.
- No `*.png` files changed.

## Deviations

- The `vscode-lm-tools` barrel export is outside the 4-file list (see above).
- The Electron binding is in `phase-2-libraries.ts` (the phase that calls `registerSdkServices`), not `phase-3-storage.ts`. The parser comes from workspace-intelligence, which is registered earlier in the same phase.

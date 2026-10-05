# Batch 7 report (D.10: CLI binds SDK_CODE_OUTLINER)

## Changed files
- MODIFIED libs/backend/cli-engine/src/lib/container.ts: imports `TreeSitterCodeOutliner` from `@ptah-extension/vscode-lm-tools`; new exported `registerCodeOutliner(container)` registers `SDK_TOKENS.SDK_CODE_OUTLINER` as a lazy factory `new TreeSitterCodeOutliner(c.resolve(TOKENS.TREE_SITTER_PARSER_SERVICE))` (same as VS Code/Electron); called in `setup()` after `registerPluginMarketplaceServices` and before `registerSdkServices`.
- CREATED libs/backend/cli-engine/src/lib/container-code-outliner.spec.ts: regression test; resolves `SDK_CODE_OUTLINER` to a `TreeSitterCodeOutliner`, and checks registration is lazy.

## Checks
- `npx nx run-many -t typecheck,test -p cli-engine,ptah-cli`: exit 0 (first run hit a transient TS2739 in agent-sdk session-query-executor.service.ts:775, another agent's in-flight work; gone on re-run, not touched)
- `npx nx run cli-engine:lint`: exit 0
- `npx nx run di-lint:lint`: exit 0
- `npx nx run degradation-audit:lint`: exit 0
- `npx nx build ptah-cli`: exit 0
- `node dist/apps/ptah-cli/main.mjs --help`: exit 0

# @ptah-extension/workspace-intelligence

Workspace analysis for AI features: project and framework detection, monorepo detection, file
system and context services, token counting, tree-sitter based code outlines and diagnostics
(see `src/index.ts` and the folders under `src/`). Consumed by the Electron app, `rpc-handlers`,
`agent-generation`, `vscode-lm-tools` and other backend libs.

The test target depends on `scripts/tree-sitter-grammars.json` and `assets/tree-sitter/**`
(`project.json`).

```bash
npm run verify -- -p workspace-intelligence
```

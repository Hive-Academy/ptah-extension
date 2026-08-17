---
id: TASK_2026_273
status: backlog
type: bugfix
title: >-
  ptah-cli and ptah-tui register AST services but never ship the tree-sitter
  grammars, so AST init aborts on every file
description: >-
  `cli-engine/src/lib/container.ts:498,612` registers both
  `registerWorkspaceIntelligenceServices` and `registerVsCodeLmToolsServices`, so
  the code-execution `ast` namespace is live in the CLI and the TUI. But
  `scripts/copy-wasm.js` only runs for `ptah-extension-vscode`, `ptah-electron`
  and `ptah-electron-e2e` — never for those two — so `resolveWasmPath` points at
  a `wasm/` directory that does not exist and initialization aborts for every
  file. `apps/ptah-cli/package.json` `files` lists only the `.mjs` bundles plus
  docs, so adding the copy step alone would still publish a package without the
  grammars. Pre-existing and affecting all five grammars, not something C#
  introduced; `verify-packed-wasm.js` only guards the Electron asar, which is why
  it went unnoticed. Also unverified: that script's new C# entry has never been
  run against a real packaged asar (needs the electron-builder `package` target).
---

# CLI/TUI tree-sitter grammars never ship

Machine-owned metadata carrier. Prose lives in `./context.md`.

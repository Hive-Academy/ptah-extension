# TASK_2026_273 — CLI/TUI AST grammars

Found during TASK_2026_270 Batch 1b (C# AST). Not caused by it.

## The two halves of the fix

1. **Copy step** — add `ptah-cli` (and `ptah-tui`, which builds into the same
   `dist/apps/ptah-cli/`) to the `copy-wasm` targets.
2. **Publish step** — `apps/ptah-cli/package.json` `files` must include `wasm/`,
   or the npm package still ships without grammars while looking fixed.

Doing only (1) is worse than doing nothing: local dev works, the published
package stays broken, and the next person assumes it is covered.

## The decision this needs from a human

Total wasm payload is 7.45 MB raw / 0.66 MB compressed (C# alone is 4.87 MB raw
— larger than the other four combined). Shipping all five to npm adds roughly
7.4 MB to `@hive-academy/ptah-cli`. Options:

- ship all five and accept the size;
- ship a subset (TS/JS/Python/Go) and let C# be Electron/VS Code only;
- lazy-download grammars on first AST use into `~/.ptah/`, like plugin content.

The third is the most consistent with how `ContentDownloadService` already works
and the only one that does not grow the package, but it adds a network
dependency to a previously offline path.

## Also in scope

`apps/ptah-electron/scripts/verify-packed-wasm.js` gained
`wasm/tree-sitter-c-sharp.wasm` in TASK_2026_270 but has never run against a real
packaged asar — the `package` target was out of scope there. Verify it here, and
consider whether an equivalent guard should exist for the CLI package.

---
status: in_progress
type: bugfix
title: Restore the ptah-cli copy-wasm dependency
description: >-
  The ptah-cli test target never runs because its copy-wasm dependency fails
  with WASM file not found for web-tree-sitter.wasm. The whole ptah-cli test
  suite is therefore unverified on this machine.
---

# Restore the ptah-cli copy-wasm dependency

`npx nx run-many -t test -p ptah-cli` does not run a single test. The
`ptah-cli:copy-wasm` dependency fails first with:

```
WASM file not found: ...node_modules\web-tree-sitter\web-tree-sitter.wasm
```

Find the cause and fix it. See `context.md`.

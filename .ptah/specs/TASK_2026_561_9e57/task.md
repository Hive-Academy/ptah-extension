---
id: TASK_2026_561_9e57
status: backlog
type: FEATURE
title: Close the remaining TASK_2026_559 Track B tool and workspace follow-ups
depends_on: []
created: '2026-09-26T14:00:00.000Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Close the open Track B items from TASK_2026_559: reducer known issues, enrich_file, dependency
  graph, symbol index, MCP transport, release checks, workspace_analyze and language support.
estimate: L
labels:
  - compaction
  - mcp
  - token-efficiency
relates_to:
  - TASK_2026_560_2ae5
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Close the Track B known issues and follow-ups that TASK_2026_559 recorded but did not schedule. The
item list is `context.md` sections B1 and B3-B9. Check each item against current code before you
plan it, because the list was written in September 2026 and has not been checked item by item.
Track A (the compaction layer) is out of scope here. Its open parts are in TASK_2026_634_daec.

Drop the parts that applied only to removed hosts (PR #892):

- B5 Batch 6 (a): the VS Code startup index run.
- B7: the installed `ptah-cli` checks and `apps/ptah-cli/scripts/verify-packed-wasm.cjs`. Only the
  Electron check (`apps/ptah-electron/scripts/verify-packed-wasm.js`) remains.
- B7 Batch 14: `codex-cli.adapter.ts` is gone. Re-check the `resumeRestoresContext` doc gap against
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/` before you keep it.

## Current state (2026-11-07)

- Done: Track A mostly shipped (PRs #634, #647, #755). B2 is done: `tsx.language.ts` uses
  `tree-sitter-tsx.wasm`, and `.mts`/`.cts` are in the language registry
  (`libs/backend/workspace-intelligence/src/ast/languages/`).
- Spot checks, still open:
  - B5: no `symbol_name_lower` column exists in `libs/backend`.
  - B6: `decodeURIComponent` is called with no try/catch in the caller extractors
    (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:284,309,344`).
  - B6: `protocol-dispatcher.ts` is 4,449 lines
    (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`).
  - B8: `FrameworkDetectorService` has no `@nestjs/core` rule, and `ProjectDiscovery` is not exported
    from `libs/backend/workspace-intelligence/src/index.ts`.
- B7: the `file-settings-manager.bench.spec.ts` timeout is tracked in TASK_2026_456_b421.
- The source folder `TASK_2026_559_8ca9` is not on this branch. Read its `batches.md` from git
  history.

Full history in [./context.md](./context.md). Its line numbers are old.

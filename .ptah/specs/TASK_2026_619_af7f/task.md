---
id: TASK_2026_619_af7f
status: backlog
type: BUGFIX
title: Fix the ptah code-intelligence and memory MCP tools that miss their mcp-bench claims
depends_on:
  - TASK_2026_624_d671
created: "2026-10-06T17:50:32.390Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Phase 1 (tools/mcp-bench and index freshness) shipped in PR #672. Remaining: fix each tool that
  misses its prompt claim against the scorecard, then choose the eager tool set from it.
estimate: XL
labels:
  - mcp-tools
  - benchmark
  - code-index
  - memory
  - P2
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Phase 2 only. Use the `tools/mcp-bench` scorecard and its native (rg / Glob / Read) baseline to fix
each ptah tool that misses its prompt claim:

1. Code index (`ptah_code_search_symbols`): changed and large files must keep their symbols, and
   coverage must be truthful.
2. `ptah_relevance_rank_files`: rank on content BM25 plus the symbol index, not file names.
3. `ptah_lsp_references` and `ptah_get_dependents`: real TS language service in the Electron host;
   warm the dependency graph at session start.
4. A ranked text search tool (`ptah_search_text`, compact ripgrep output) to close the text-search
   gap, if the scorecard still shows it.
5. `ptah_memory_search`: workspace scope and recall.
6. Choose the eager and deferred tool set from the scorecard.

Bench-guided fixes wait for the scored run of TASK_2026_624_d671. A correctness defect that is
reproduced on its own can start at once. Paid bench runs need user approval.

## Current state (2026-11-07)

- Done: Phase 1 in PR #672 (`ffeea1657`): `tools/mcp-bench` and `.github/workflows/mcp-bench.yml`.
  Related: the honest MCP tool contract (#604) and the memory/skills bench (#686).
- Open: no Phase 2 fix PR has merged. No `ptah_search_text` tool exists in `libs/backend`.
- The eager set is still the fixed `ALWAYS_EAGER_TOOLS` list in
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:706`, not a
  scorecard-based choice.
- The bench hosts are `cli-headless` (its own entry, `tools/mcp-bench/src/transport/bench-host.entry.ts`)
  and `electron` (`tools/mcp-bench/src/bench-hosts.ts:84`). The headless CLI app was removed
  (PR #892); check that the `cli-headless` bench host still builds before a scored run.
- `handoff.md` and the batch reports in this folder are history from the Phase 1 sessions.

Full context, plan and discussion live in [./context.md](./context.md).

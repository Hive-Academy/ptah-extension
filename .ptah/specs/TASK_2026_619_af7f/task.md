---
id: TASK_2026_619_af7f
status: backlog
type: BUGFIX
title: "Fix the ptah code-intelligence and memory MCP tools that miss their mcp-bench claims"
depends_on:
  - TASK_2026_624_d671
created: "2026-10-06T17:50:32.390Z"
updated: "2026-10-30T03:38:08.921Z"
description: "Phase 1 (tools/mcp-bench benchmark and index freshness) shipped in PR #672. Remaining: use the scorecard and gate baseline to fix each tool that misses its claim, then choose the eager tool set."
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

Phase 1 builds a real-repository benchmark with independent ground truth and a native Grep/Glob/Read baseline. Phase 2 fixes code search, relevance ranking, references, dependents and memory until each tool meets its prompt claim.

Full context, plan and discussion live in [./context.md](./context.md).

---
id: TASK_2026_351
status: done
type: BUGFIX
title: >-
  Skill-synthesis lanes: outputFormat retry, timeout template fallback minting
  duplicate junk candidates, maxTurns 1, wrong mcpServerRunning flag
depends_on: []
created: '2026-08-28T18:55:33.569Z'
updated: '2026-08-29T02:10:03.412Z'
description: >-
  Four lane faults in one boot: (1) "lane ignored outputFormat; retrying once
  without it" for haiku (log.log:1010); (2) "synthesizer: lane failed: timeout"
  then template fallback registered candidate slug "...-already-know-about-5" —
  the -5 suffix shows the same junk candidate already exists five times
  (log.log:1088-1091); (3) "lane exhausted its turns on pass 1; collapsing to a
  single pass" for the archaeologist lane because maxTurns is 1 (log.log:1445);
  (4) every lane query logs "MCP disabled (server not running)" while the MCP
  server is up on 51821 (log.log:945,1062,1355,1400,1432). Fix each: dedupe
  fallback candidates by session+content hash instead of appending a numeric
  suffix, raise lane turns, and pass the real MCP state.
executor: backend-developer
estimate: M
labels:
  - skill-synthesis
  - agent-sdk
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Four lane faults in one boot: (1) "lane ignored outputFormat; retrying once without it" for haiku (log.log:1010); (2) "synthesizer: lane failed: timeout" then template fallback registered candidate slug "...-already-know-about-5" — the -5 suffix shows the same junk candidate already exists five times (log.log:1088-1091); (3) "lane exhausted its turns on pass 1; collapsing to a single pass" for the archaeologist lane because maxTurns is 1 (log.log:1445); (4) every lane query logs "MCP disabled (server not running)" while the MCP server is up on 51821 (log.log:945,1062,1355,1400,1432). Fix each: dedupe fallback candidates by session+content hash instead of appending a numeric suffix, raise lane turns, and pass the real MCP state.

Full context, plan and discussion live in [./context.md](./context.md).

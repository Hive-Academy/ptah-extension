---
id: TASK_2026_663_50d4
status: backlog
type: BUGFIX
title: "Lane data quality: deliverable vs role-file conflicts and OpenCode quota errors"
depends_on: []
created: "2026-10-14T01:38:43.225Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Declared deliverables must win over a role's default file name (or spawn rejects the conflict).
  Check that OpenCode quota errors reach lane outcomes as a usage-limit failure, not "Unknown error".
estimate: M
labels:
  - lanes
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Lane outcomes feed lane ranking, so a lane must not write wrong outcome data. Two items are left
from TASK_2026_535 §D and §E:

1. §D, role contract vs declared deliverables: when a spawn declares `deliverables` and its `role`
   names a different default output file, the declared deliverables must win, or the spawn must
   reject the conflict. Record a role-conflict verdict or failure kind in the lane outcome. The
   role code is in `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts`
   and `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/lane-role-condenser.ts`.
2. §E, quota errors: confirm that an OpenCode quota or rate-limit error reaches the lane outcome as
   a usage-limit failure kind. `describeOpencodeError` still falls back to `'Unknown error'` when
   the event has no message
   (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:197-206`).
   Fix the path if the classifier does not see the real text.

## Current state (2026-11-07)

- Done: OpenCode lanes run with `--standalone` and get the `ptah_*` tools (`b33535508`;
  `opencode-cli.adapter.ts:40-52,582-601`).
- Done: lane MCP attachment is verified, which fixed the grok lane without `ptah_web_search`
  (`b0e9a54d7`).
- Done: a usage-limit classifier exists
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-classifier.ts:202`, used at
  `agent-process-manager.service.ts:3284`), and usage-limit failures no longer lower a lane's score
  (`3e0d1bd96`, PR #954).
- Left: §D has no code (no role-conflict handling in `libs/`), and the OpenCode quota path in item 2
  is not verified.
- TASK_2026_535 and TASK_2026_646_136a were retired; read them with
  `git show ff531866f:.ptah/specs/<folder>/<file>`.

Full context, plan and discussion live in [./context.md](./context.md).

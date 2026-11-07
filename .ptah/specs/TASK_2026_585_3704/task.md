---
id: TASK_2026_585_3704
status: backlog
type: FEATURE
title: Live-session QA evidence for the Electron Apps page
depends_on:
  - TASK_2026_494_ca38
created: "2026-10-01T00:00:00.000Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Record the three TASK_2026_494 manual QA items that need a live, authenticated agent turn in an
  Electron Apps session: surface-tool permission prompt, tool-result rendering, get_state follow-through.
estimate: S
labels:
  - e2e
  - electron
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

QA evidence only. Run three checks in a live, authenticated Apps session of the Electron dev build
from `main`. Each check spends paid agent turns, so get the user's approval first. A finding goes
to the owner of the affected surface.

1. **Permission prompt.** Ask for a form so the agent calls `ptah_surface_update` and
   `ptah_surface_get_state`. Confirm that both run without an unexpected permission prompt. If a
   prompt appears, it must render on the Apps page, not in the coding chat.
2. **Tool-result rendering.** The dashboard and surface tool results render in the Apps transcript through
   `ExecutionNodeComponent` as generic MCP tool output.
3. **`ptah_surface_get_state` follow-through.** Select a table row, ask "what is this row?", and
   confirm that the agent calls `ptah_surface_get_state`.

Deliverable: `test-report.md` in this folder, with one screenshot per item and PASS, FAIL or a
finding for each.

## Current state (2026-11-07)

- Not run. No `test-report.md` exists in this folder.
- The Apps page still exists (`libs/frontend/mcp-apps-page`). The system prompt tells the agent to
  use `ptah_surface_get_state`: `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:24-25`.
- The surface tools are served by
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`, and the caller
  policy is `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts`.

Full context, plan and discussion live in [./context.md](./context.md).

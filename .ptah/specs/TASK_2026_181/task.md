---
id: TASK_2026_181
status: done
type: FEATURE
title: Tasks board - richer carrier metadata plus views, filters and a command palette
description: Two feature families on top of the TASK_2026_179 contract. (B) Richer task metadata - labels, estimates, sub-tasks and typed relations (blocks / blocked-by / duplicate) layered onto the existing depends_on, all file-native in carrier frontmatter so no server is required. (C) Saved views, multi-axis filtering, bulk status operations and a keyboard-first command palette; bulk ops ride the conflict-safe write path and MCP tasks namespace shipped in Phase 2. Native agent integration and messaging-gateway intake are deliberately NOT in scope - their UX is undecided pending a canvas-vs-inline investigation.
assignee:
depends_on: [TASK_2026_179]
executor:
claim:
created: 2026-08-04T00:00:00.000Z
updated: 2026-08-04T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`; batch breakdown
in `./batches.md`.

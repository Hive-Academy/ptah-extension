---
id: TASK_2026_888_36b0
status: backlog
type: FEATURE
title: Add steer and interrupt to the opencode lane via opencode serve
description: >-
  Phase 2 of TASK_2026_591_fff5. Phase 1 (queue-next-turn) merged in #658. Steer and
  interrupt through opencode serve has a design-only plan that waits on the user's answers.
depends_on: [TASK_2026_591_fff5]
created: 2026-11-07T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Split out of TASK_2026_591_fff5 by the TASK_2026_886_032a status sweep. Phase 2 adds steer and
interrupt to the opencode CLI lane through a server-backed adapter on `opencode serve`.

The design plan is `../TASK_2026_591_fff5/implementation-plan.md` (status: design only). Get the
user's answers to its `## Open Questions for the User` before any code. The open questions from
the probe (`../TASK_2026_591_fff5/context.md:45-50`): per-lane or shared server, Basic credential
handling, SSE parsing instead of line parsing, completion on `session.execution.succeeded` instead
of process exit, how MCP config reaches a server-hosted session (no per-process
`OPENCODE_CONFIG_CONTENT`), and a version floor found by probing the surface.

## Current state (2026-11-07)

- Done: Phase 1, queue the next turn (PR #658, `779b89b5d`). The adapter reports
  `continuation: supported` and `steer` / `interrupt: unsupported`
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:355-361`).
- Done: the Phase 2 design plan exists in the parent folder. It is not approved.
- Left: user approval of the plan, then the implementation. No `opencode serve` code exists in
  `libs/backend/cli-agent-runtime`.
- The probe source was retired from `.ptah/specs`. Read it with
  `git show ff531866f:.ptah/specs/TASK_2026_465_a25a/opencode-serve-probe.md`.

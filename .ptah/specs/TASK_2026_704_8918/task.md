---
id: TASK_2026_704_8918
status: backlog
type: BUGFIX
title: Find and fix the NG0956 track-by-identity warning in the chat view
depends_on: []
created: "2026-10-19T01:28:47.811Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  The Electron console repeated NG0956 (track by identity re-creates a size-1 collection) on
  2026-10-19. The emitting template is unknown. Check current main first; cancel if it is gone.
estimate: S
labels:
  - frontend
  - angular
  - console-noise
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

On 2026-10-19 the Electron renderer console repeated Angular warning NG0956 ("track by identity
caused re-creation of the entire collection of size 1"). It was seen with the session inspector
open and Plan Limits cards visible.

1. Run the Electron app on current main with DevTools open. If NG0956 no longer appears, propose
   to cancel this task as obsolete.
2. If it appears, expand the warning or break on `console.warn` to name the emitting
   component and template.
3. Change its `track` expression to a stable key (an id) and add a spec if the list is computed.

## Current state (2026-11-07)

- The reported layout is gone: PR #777 (`92c289d2e`, 2026-10-20) removed the single-session layout.
- The only NG0956 fix on main, `312b54f36` (canvas lane block tracked by key), is older than the
  report.
- A static search found no `@for` that tracks an object by identity in the plan-limit tiles: they
  track strings (for example `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:200`).
  A static search cannot rule out the warning; only a DevTools check can.
- The paired `agent:getLanePlanLimits` timeout is fixed (`LANE_PLAN_LIMITS_TIMEOUT_MS = 15_000`,
  `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:18`). The
  `code-logic-*.md`, `fix-round-report.md` and `rpc-timeout-investigation.md` files in this folder
  belong to that timeout work, not to NG0956.

Full context, plan and discussion live in [./context.md](./context.md).

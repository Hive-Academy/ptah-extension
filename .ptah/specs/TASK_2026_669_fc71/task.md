---
id: TASK_2026_669_fc71
status: backlog
type: BUGFIX
title: Prune per-session autopilot write counters
depends_on: []
created: "2026-10-14T17:08:12.587Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  The renderer AutopilotStateService keeps a per-session write counter that is never deleted when a
  session ends (PR #725 review, Moderate). Prune it and add a spec.
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`libs/frontend/core/src/lib/services/autopilot-state.service.ts:96` declares
`sessionWrites = new Map<SessionId, number>()`. Each toggle for a session increments it
(`:278-281`), and `refreshSession` reads it to discard a stale host read (`:178-184`). No code
deletes an entry, so a long-running Electron renderer grows the map by one entry per session.

Expected: delete the entry when the session is released, for example where `setSessionLevel`
forgets a session that is no longer live (`:315-325`). Do not delete it while a `refreshSession`
read for that session is in flight, or the stale-read guard compares against a reset counter. Add
a spec. Verify with `npm run verify -- -p @ptah-extension/core`.

## Current state (2026-11-07)

- Not started. The map is set at `:278-281` and never deleted.

Full context, plan and discussion live in [./context.md](./context.md).

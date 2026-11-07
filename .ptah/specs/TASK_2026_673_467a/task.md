---
id: TASK_2026_673_467a
status: backlog
type: BUGFIX
title: Serialize handoff pointer collection per session
depends_on: []
created: "2026-10-14T19:33:47.394Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Concurrent prompts of one session can read the same rotation window of pending handoff records
  (review M4). Serialize collect per cursor key, or reserve a disjoint window before awaiting.
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_657_subagent_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`collect` in `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-index.ts:268`
reads the session's rotation cursor (`:280`), awaits each head read in the window (`:297`), and
then writes the cursor (`:308`). Two prompts of the same session that run at the same time start
from the same cursor, so they name the same pending handoff records, and a late visit can move
the cursor back. No data is lost (deferred review finding M4).

Fix: serialize `collect` per cursor key, or reserve a disjoint window before the first await. Add
a spec with a gated head read and two concurrent calls. Verify with
`npm run verify -- -p @ptah-extension/agent-sdk`.

## Current state (2026-11-07)

- Not started. The file has no per-cursor lock or window reservation.

Full context, plan and discussion live in [./context.md](./context.md).

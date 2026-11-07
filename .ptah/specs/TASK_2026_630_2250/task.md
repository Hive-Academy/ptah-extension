---
id: TASK_2026_630_2250
status: backlog
type: REFACTORING
title: Display panel follow-ups from TASK_2026_623
description: >-
  Open display panel follow-ups from TASK_2026_623: shared path-link wrap, dock wiring split out of
  ChatView, CLI lane context, chip counts, Edit/Write meta, and four partly pinned acceptance specs.
depends_on: []
created: 2026-10-12T00:00:00.000Z
updated: '2026-11-07T00:00:00.000Z'
---

## Description

Open items deferred by TASK_2026_623_3492 (agent-controlled display panel). The item numbers match
the table in `context.md`, which has the source decision for each.

- **Item 3:** the shared `ptah-file-path-link` atom wraps long paths instead of truncating them
  (`design-spec.md:140`). Check every consumer.
- **Item 4:** move the dock wiring out of `chat-view.component.ts` into a dock collaborator.
  Behaviour-preserving.
- **Item 6 (only if users report it):** a width-aware row estimate for code output. Today a
  `max-h-48` vertical-scroll fallback is accepted.
- **Item 7:** CLI lanes report real context use, so `$agents` no longer shows `context`
  "unavailable".
- **Item 8 (needs a user or designer decision):** item counts and totals on the expanded display
  chip.
- **Item 9 (needs a new data source):** the Edit meta line range and the Write new-file vs
  overwrite flag.
- **Spec gaps:** R1.10 (turn summary never auto-opens the panel), R2.10 (copy returns the raw fence
  only), R9.6 (chip totals wrap at chat-narrow width), and the security case (imitated
  `<ptah-ui-display-chip>` markup in agent text creates no chip or surface).

Re-check each item against the unified display panel (PR #943, merged 2026-11-05) before you
start it. That PR added files, images, PDF and reports to the same panel.

## Current state (2026-11-07)

- Done: item 1 (Gate 3 visual re-check), items 2 and 5 (PR #704), and the dashboard-avatar spec
  titles (now R4.5,
  `libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.spec.ts:16,30`).
- Item 3 open: `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts:37,41` still use
  `truncate`.
- Item 4 open: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` is 2143
  lines with 75 dock references. The dock state lives in
  `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts`.
- The chip is `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts`.

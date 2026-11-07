---
id: TASK_2026_641_bf2b
status: backlog
type: BUGFIX
title: Pin the locale in the memory UI date formatters
depends_on: []
created: "2026-10-12T19:39:46.732Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Three memory-curator-ui formatters still call a bare toLocaleString(), so dates follow the
  machine locale. Pin them like the diagnostics panel. The TUI half is obsolete (TUI removed).
executor: frontend-developer
parent: TASK_2026_637_e30b
estimate: XS
labels:
  - memory
  - P3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Memory UI date formatters in the Electron renderer must not depend on the machine locale. Pin the
locale in these formatters, the same way the diagnostics panel does:

- `libs/frontend/memory-curator-ui/src/lib/components/corpus-list.component.ts:296`
- `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:409`
- `libs/frontend/memory-curator-ui/src/lib/components/timeline-view.component.ts:175`
- Decide on `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts:198`
  (`toLocaleTimeString([], ...)`): fold it in or exclude it on purpose.

Acceptance: a spec with a non-en-US locale shows that no memory UI date or number formatter uses
the machine locale.

## Current state (2026-11-07)

- Done: `formatSnapshot` uses Angular `formatDate` with `LOCALE_ID` (`cfdf00172`, PR #957;
  `.../diagnostics/memory-diagnostics-accordion.component.ts:327,499-504`).
  `storage-health-panel.component.ts:48` pins `'en-US'`.
- Obsolete: the TUI storage-panel half (from TASK_2026_444). The Ink TUI
  (`apps/ptah-tui`) was removed in PR #892.
- Left: the three bare `toLocaleString()` calls above and the `event-feed` decision.

Merged on 2026-10-12 from TASK_2026_444 and TASK_2026_445.

Full context, plan and discussion live in [./context.md](./context.md).

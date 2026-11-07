---
id: TASK_2026_637_e30b
status: backlog
type: FEATURE
title: >-
  Thoth UI epic: Overview tab, quarantine list and restore, retention fault notice, locale
depends_on: []
created: "2026-10-12T19:39:38.235Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Epic for the Electron Thoth memory UI (tabs memory, skills, cron, gateway). Children: 587
  Overview, 572 quarantine list and restore, 517 retention fault notice, 641 locale, 457, 266.
estimate: XL
labels:
  - epic
  - memory
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic for the Thoth memory UI in the Electron renderer. The children carry the work: the Thoth
Overview and activity ledger (former TASK_2026_439 phase 6), list and restore of quarantined
memories, an active retention fault notice, storage health follow-ups (lifecycle preview, pinned
date locale), and the memory graph explorer.

## Current state (2026-11-07)

- Thoth tabs on main are `memory | skills | cron | gateway`
  (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:47`). The skill-synthesis
  tabs were purged in PR #788 and are out of scope.
- Open children (all `backlog`): TASK_2026_587_bffd, TASK_2026_572_07c4, TASK_2026_517_b90a,
  TASK_2026_641_bf2b, TASK_2026_457_e48b, TASK_2026_266.
- The TUI was removed (PR #892). TASK_2026_641_bf2b is now only the memory UI locale fix; its TUI
  storage-panel half is obsolete.
- The diagnostics `formatSnapshot` already formats with Angular `LOCALE_ID` (`cfdf00172`, PR #957;
  `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:499`).

Full context, plan and discussion live in [./context.md](./context.md).

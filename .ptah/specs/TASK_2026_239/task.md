---
id: TASK_2026_239
status: backlog
type: BUGFIX
title: Skills settings panel shows a max-items value the nightly tier ignores
description: >-
  TASK_2026_180 B0.10 gave the nightly drain tier its own item cap
  (`skillSynthesis.drain.nightlyMaxItemsPerRun`, default 40) because the shared
  `maxItemsPerRun` (4) was starving the archaeology stage. The new key is routed
  through file settings so it takes effect and persists, but it was deliberately
  NOT put on the RPC wire — adding it to `SkillSynthesisSettingsSchema` and the
  shared DTO would have dragged two Angular components and their fixtures into a
  backend batch. Net effect: the Skills settings panel displays "Max items per
  run: 4" while the nightly tier ignores that number entirely, so a user tuning
  it sees no change in nightly throughput.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-15T00:00:00.000Z
updated: 2026-08-15T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

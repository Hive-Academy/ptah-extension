---
id: TASK_2026_857_f660
status: in_progress
type: FEATURE
title: Lane learning integrity and host-side pre-flight routing
description: >-
  Make lane outcome learning trustworthy (failures recorded, taskKind always set,
  subagents recorded, host-captured review verdicts, seed-blended scores) and run
  route_decide pre-flight on the host when scope is agreed, injecting a Routing reminder.
depends_on: []
created: 2026-10-30T16:00:00.000Z
updated: 2026-10-30T16:00:00.000Z
---

## Description

Three pieces, Electron first:

1. Learning integrity: failed / limit-stopped / crashed lane runs write outcome rows; the host
   fills `taskKind` when a spawn omits it; subagent runs land in the production outcome store.
2. Host-side routing: a background per-turn System One scope check; run `ptah_route_decide`
   pre-flight when scope is agreed (or changed a lot) and inject a `Routing:` system reminder.
3. Quality signals: capture review verdicts on the host and attach them to the reviewed run;
   blend learned rates toward seed scores instead of replacing them.

Out of scope: prompt/rule text changes (handled on another machine), VS Code and TUI features.

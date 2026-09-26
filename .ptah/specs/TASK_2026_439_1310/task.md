---
id: TASK_2026_439_1310
status: in_progress
type: FEATURE
title: 'Thoth rework: memory lifecycle, evidence-first skills, usable UI'
description: >-
  Umbrella for the Thoth tribunal verdict (2026-09-14). Four lifecycle features
  were built and tested but never wired to a production caller (observation
  purge, memory decay, candidate namer, invocation tracker), so the DB grew to
  1.28 GB, no memory is ever archived or deleted, and no skill was ever
  promoted. Six phases, each shipped with a reachability proof. Phase 1 runs as
  TASK_2026_440_834c.
depends_on: []
created: 2026-09-14T15:00:00.000Z
updated: '2026-09-26T14:40:53.853Z'
labels:
  - partial
---

## Description

See `context.md` for the phases and `tribunal/verdict.md` for the cited evidence.

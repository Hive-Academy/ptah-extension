---
id: TASK_2026_597_ab22
status: in_progress
type: BUGFIX
title: Stop token burn in spawned CLI lanes and add the Ptah compaction layer
description: >-
  URGENT. Codex, OpenCode and Ollama Cloud lanes burn plan quota: 9 Codex lanes sent about 22M input
  tokens in 4 hours (context 27k to 184k over 74 turns, frontier default model, 25k-token fixed
  prefix, desktop plugins loaded, whole-file reads). Scope is TASK_2026_561 Track A (A0-A9),
  TASK_2026_562 Wave 2 and Wave 4.2-4.4/4.6, and the defects measured on 2026-10-03.
depends_on: []
created: 2026-10-03T12:00:00.000Z
updated: 2026-10-03T12:00:00.000Z
relates_to:
  - TASK_2026_561_9e57
  - TASK_2026_562_4b1d
  - TASK_2026_406
  - TASK_2026_557_tokaudit
---

## Description

Urgent token and billing fix for spawned CLI lanes, plus the Ptah-owned compaction layer.
Full context, evidence, scope and user decisions live in [./context.md](./context.md).

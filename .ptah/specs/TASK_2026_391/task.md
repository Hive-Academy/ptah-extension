---
status: backlog
type: BUGFIX
title: >-
  Curator extract treats an unparseable final message as an honest empty extraction and consumes the session's observations
description: >-
  The extract() fall-through arm in sdk-internal-query.curator-llm.ts returns extracted with zero drafts when the model's final message is prose or a truncated JSON object, because parseDrafts returns [] for both "no JSON found" and "Zod rejected it". The trigger reads that as a run that honestly found nothing and marks the session's queued observations processed, so the session can never be curated again. Pinned as intended by a spec since 2026-08-23; TASK_2026_376 raised the turn budget 1 to 6, which makes a prose wrap-up after tool calls the ordinary shape of a run.
parent: TASK_2026_635_5ea5
labels:
  - P1
relates_to:
  - TASK_2026_567_90d4
updated: '2026-10-12T19:41:51.738Z'
---

# TASK_2026_391

Defect chain, failure scenario, required fix and acceptance criteria are in
`context.md`. Origin: TASK_2026_376 independent gate review, Blocker 1.

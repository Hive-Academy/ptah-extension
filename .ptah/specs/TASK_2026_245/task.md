---
id: TASK_2026_245
status: backlog
type: feature
title: >-
  Give the replay gate a production producer — decide whether a cluster draft
  becomes a candidate row
description: >-
  `ReplayValidatorService` grades a drafted skill against a held-out cluster
  member and writes `replay_confidence` onto `skill_candidates`. TASK_2026_180
  B3.5 registered its stage handler but deliberately shipped NO producer, because
  nothing creates the graded candidate row the gate needs. The cluster path
  (`SkillCuratorService.runSuggestionPass`) runs clustering, cluster-synthesis and
  judge INLINE on a timer and persists a SUGGESTION, not a candidate.
  `cluster-holdout-end-to-end.spec.ts` shows the recovery a producer must perform,
  but performing it in production means calling `registerCandidate` on a cluster
  draft — which puts that draft back into clustering, dedup and AUTO-PROMOTION,
  so a cluster skill could ship without the user ever accepting its suggestion.
  That is a product decision, not a wiring detail, and it is what this task exists
  to make.
---

# Give the replay gate a production producer

Machine-owned metadata carrier. Prose lives in `./context.md`.

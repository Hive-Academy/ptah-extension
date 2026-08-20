---
id: TASK_2026_256
status: done
type: refactoring
title: >-
  Extract the six queue stage handlers out of skill-synthesis.service.ts, which
  doubled in size and now mixes service lifecycle with stage dispatch
description: >-
  `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` went from
  906 lines on `main` to 1929 during TASK_2026_180 — it is now the largest file
  in the lib. Roughly 650 of those lines are queue stage-dispatch logic
  (`registerStageHandlers`, the six `run*Stage` methods, `enqueueArchaeology`,
  `enqueueCandidateGates`, `enqueueGate`, `gateTarget`, `gateClusterSessionIds`,
  `recordVerdictFallback`, `withClaimHeartbeat`, `candidateBody`) added inline
  rather than in a directory of their own. That is inconsistent with the same
  task's own practice: every other new concern it introduced got its own
  directory (`queue/`, `lanes/`, `gates/`, `archaeology/`, `digest/`, `naming/`),
  and the lib's CLAUDE.md documents them that way. The file now mixes service
  lifecycle, settings reading, `analyzeSession`, the RPC-backing promote/reject
  methods, and six unrelated stage protocols. Suggested seam: a
  `queue/stage-handlers.service.ts` owning `registerStageHandlers()` and the six
  `run*Stage` methods plus their private helpers, taking the collaborators it
  already has injected; `SkillSynthesisService.start()` then calls its
  `registerStageHandlers()`. Behaviour-preserving structural work only. Raised
  by the code-style review of TASK_2026_180 on 2026-08-16 and confirmed by the
  orchestrator; deliberately not folded into that task, whose remaining batches
  were feature work.
---

# Split the stage handlers out of `SkillSynthesisService`

Machine-owned metadata carrier. Prose lives in `./context.md`.

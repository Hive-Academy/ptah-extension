---
id: TASK_2026_322
status: in_review
type: BUGFIX
title: >-
  Skill candidates carry no workspace, so a brand-new project's review queue
  shows every other project's captures
description: >-
  `skill_candidates` is the one layer of the synthesis subsystem with no
  workspace column. `skill_synthesis_queue` has `workspace_root` (migration
  `0032`) and the drain round-robins on it; `skill_session_verdicts` has it
  (`0034`) and `SkillCandidateStore.getWinRates` reads it scoped; only the
  candidate rows never got one. `listByStatus` is therefore an unfiltered
  `SELECT * FROM skill_candidates WHERE status = ?`
  (`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:243`) and
  `SkillsSynthesisRpcHandlers.collectByStatus`
  (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1988`)
  forwards it verbatim, so the Skills tab in a freshly opened project shows the
  pending captures of every project that shares `~/.ptah/state/ptah.sqlite`.
  Origin IS already recorded but is unusable for this — `SkillSynthesisService`
  writes a `contextId` that is a sha256 of the workspace root
  (`skill-synthesis.service.ts:766`), consumed only by `countDistinctContexts`
  as a GENERALITY signal, and a hash cannot be reversed to a path. Adds
  migration `0040` (nullable `workspace_root` plus a backfill from
  `skill_synthesis_queue.candidate_id`), an optional `workspaceRoot` argument on
  `listByStatus` following the `getWinRates` convention exactly, and a `scope`
  parameter on `skillSynthesis:listCandidates`. Promotion, clustering, dedup,
  residency and the gates stay CROSS-PROJECT — a promoted skill is global by
  design and scoping those reads would be a different, wrong change.
---

# Skill candidates are not workspace-scoped

Machine-owned metadata carrier. Prose lives in `./context.md`.

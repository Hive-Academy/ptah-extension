---
id: TASK_2026_254
status: done
type: REFACTORING
title: >-
  Review the 15 subagent templates and the 22 plugin skills for duplicated
  boilerplate, shipped build artifacts and drifting instructions
description: >-
  Two prompt corpora have grown without a review pass and are now the largest
  ungoverned text Ptah loads. `libs/backend/agent-generation/templates/agents/`
  is 15 templates totalling ~248KB, each one a whole system prompt --
  `software-architect.template.md` alone is 773 lines / ~9k tokens. Three
  blocks are copy-pasted across them rather than shared, the widest into 10 of
  15 files, so a fix to one leaves nine stale.
  `apps/ptah-extension-vscode/assets/plugins/` is 219 files / 1.74MB across 5
  plugins and 22 skills, downloaded at runtime by ContentDownloadService and
  paid for again in context on every load. It ships generated build output
  (`ptah-react` carries a 79.9KB compiled `AGENTS.md` plus a README documenting
  the `pnpm build` that regenerates it) and repeated example blocks that differ
  only in one string. Nothing here is user-visibly broken; the cost is tokens,
  and drift between copies that no test compares.
---

# Review the subagent templates and the plugin skills

Machine-owned metadata carrier. Prose lives in `./context.md`.

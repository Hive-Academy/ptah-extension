---
id: TASK_2026_158
status: done
type: FEATURE
title: Spec-driven subagent evaluation and optimization in the Skills Library
description: Join task-spec verdicts (TASK_2026_157) with invocation telemetry and per-agent token/cost data into a per-subagent scorecard that drives the Library tab enhancer
assignee:
depends_on:
  - TASK_2026_157
executor:
claim:
created: 2026-07-15T00:00:00.000Z
updated: 2026-07-15T01:58:49.000Z
---

## Description

Task-management phase 1 (TASK_2026_157) formalized `.ptah/specs/` with frontmatter + a SQLite derived index. This task closes the loop with the earlier skill-synthesis judge/enhance work: use graded spec verdicts as the evaluation substrate for **subagents and orchestration skills** in the Thoth Skills tab Library, so each subagent can be scored (success rate, token consumption, cost, duration) and optimized by the judge-gated enhancer.

See `context.md` for the linkage map, existing signal sources, and identified gaps.

---
id: TASK_2026_646_136a
status: in_progress
type: FEATURE
title: >-
  Optional decision model for orchestration routing (task type, executor, lane,
  model) via a ptah_route_decide tool
description: >-
  Let users set a "Decision model" background role (an Ollama decision model
  such as tev1, nimble, clef-flash, clef or laya, TypeSafe Jev, or any model
  with structured output). A new ptah_route_decide MCP tool feeds it the
  request, the ptah_agent_list rows with limit state, memory preferences and
  past lane outcomes, and returns typed routing choices with confidence. The
  orchestration skill uses it at Pre-flight and Gate 0.1 and falls back to the
  rule tables when no model is set or confidence is low.
depends_on:
  - TASK_2026_441_7825
created: 2026-10-13T00:20:00.000Z
updated: '2026-10-14T00:40:49.200Z'
estimate: XL
labels:
  - orchestration
  - lanes
  - routing
---

See `context.md`.

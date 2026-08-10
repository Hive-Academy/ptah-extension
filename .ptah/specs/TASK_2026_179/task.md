---
id: TASK_2026_179
status: done
type: REFACTORING
title: Task-spec contract module, collider rename and callable write paths (Phases 1-2)
description: Phase 0 fixed the orchestration skill and docs. Phases 1 and 2 make the carrier contract executable - a single shared contract module consumed by backend and frontend, a permanent batches.md/tasks.md fallback, a data-plane README written at host activation, a CI ratchet against filename drift, then createDirectoryExclusive as the one real CAS primitive, a conflict-detecting updateStatus, a journalled task-doctor for adopting the 12 carrier-less folders, CLI spec verbs, an always-on MCP tasks namespace and RPC adopt/doctorPlan.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-04T00:00:00.000Z
updated: 2026-08-04T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`; batch breakdown
in `./tasks.md`.

---
status: done
type: BUGFIX
title: >-
  HIGH -- REQUIRED BEFORE D2 IS DONE: git:applyHunks has NEVER been
  exercised end-to-end in Electron
description: >-
  git:applyHunks has NEVER been exercised end-to-end in Electron. This was a
  NAMED BATCH 8 EXIT CRITERION of TASK_2026_173 (batch-8-dispatch.md section
  7) and NO PASS MET IT. D2 IS NOT DONE UNTIL IT IS RUN. Every corruption-risk
  guard is proven against real git 2.54.0.windows.1 in throwaway
  repositories; what is unproven is that a click in the running UI wires
  through to the RPC correctly -- a different class of risk than data
  safety, but a real, currently-unverified gap. Register item 12 of 17 from
  TASK_2026_173 Batch 9 -- NOT discretionary polish.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

# HIGH — REQUIRED BEFORE D2 IS DONE

**`git:applyHunks` has NEVER been exercised end-to-end in Electron.** This is not discretionary polish
— it is a named exit criterion from `TASK_2026_173` Batch 8 (`batch-8-dispatch.md` §7) that **no pass
met**, and `TASK_2026_173`'s D2 (hunk-level stage/revert) is **not** done until it is run.

See `context.md` for the full justification, why the risk is scoped the way it is, and the fix.

**Status: HIGH — REQUIRED BEFORE D2 IS DONE.**

---
id: TASK_2026_296
status: backlog
type: refactoring
dependsOn:
  - TASK_2026_295
title: >-
  Close the session-identity class at the door — a third required declaration,
  two unvalidated RPC entry points, and a rule still hand-rolled eight ways
description: >-
  TASK_2026_295 stopped the empty session id being minted and taught every
  consumer to refuse it, but it stopped short of three things it deliberately
  deferred. `MemoryExtractedPayload.sessionId` is a third required `string`
  declaration of the same shape and the last thing in the repo still forcing a
  `?? ''` coercion, in `cli-engine` and `thoth-runtime`; it pairs with
  `compaction-callback.port.ts`, which declares the same field with no
  non-empty guarantee, so the port permits exactly what the curator now has to
  tolerate at runtime. `agent:resumeCliSession` and `chat:subagent-query` take
  frontend input with no Zod schema at all, despite `rpc-handlers/CLAUDE.md`
  requiring one — and they are precisely the two doors an empty id came through,
  so validating there makes the class unrepresentable at the boundary instead of
  caught by twenty guards downstream. Finally, "a blank id means absent" is
  still hand-rolled eight different ways across ten files; that surface was
  expected to shrink once the widening landed, so it needs re-auditing before a
  shared primitive is written for call sites that may no longer exist.
---

# Close the session-identity class at the boundary

Machine-owned metadata carrier. Prose lives in `./context.md`.

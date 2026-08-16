---
id: TASK_2026_255
status: backlog
type: BUGFIX
title: >-
  Sixteen carriers show a false "no type" warning because the parser matches
  TASK_TYPES case-sensitively and the doctor does not
description: >-
  `parseTaskFile` narrows the frontmatter `type` with `z.enum(TASK_TYPES)`
  (`libs/backend/task-specs/src/lib/task-frontmatter.ts:320`), which is
  case-SENSITIVE, so `type: bugfix` parses as no type at all plus an
  `invalid_type` validation issue -- the card then renders the amber warning
  triangle and a "no type" badge, and `frontmatterValid` goes false. The same
  lib already narrows the same union case-INSENSITIVELY thirteen files away, in
  `task-doctor.service.ts:302-306`, so the doctor and the parser disagree about
  the same file. Sixteen carriers are currently affected (234, 235, 237, 238,
  239, 240, 241, 243, 245, 246, 247, 248, 249, 250, 251, 253) -- every one of
  them authored by hand rather than through a write path, because both machine
  paths are already safe: `TaskWriterService` takes a typed `TaskType` and the
  MCP `ptah_task_create` tool constrains with `enum: [...TASK_TYPES]`. So this
  fires on exactly the carriers agents write with their file tools, which is
  what the task-spec contract tells them to do.
---

# Carriers with a lowercase type read as having no type

Machine-owned metadata carrier. Prose lives in `./context.md`.

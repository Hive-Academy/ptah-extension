---
id: TASK_2026_225
status: backlog
type: BUGFIX
title: >-
  chat-session-resume-activate TS-04 fails — resumeSession reports success:false
  when the session is already live
description: >-
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts`
  fails deterministically at HEAD: "ChatSessionService — resumeSession
  activate:true (TS-04) › reports activated:true when the session is already
  live (no autoResume needed)" asserts `result.success` is true and receives
  false (spec line 206). It reproduces in isolation, so it is not a
  suite-interaction flake, and the run also emits "A worker process has failed
  to exit gracefully" for that file. Found while re-establishing the NFR-1 test
  floor for TASK_2026_173 and explicitly ruled NOT attributable to it — the file
  appears in none of that task's commits and was last touched by d7101460b
  (feat(output-styles)). Suspect the output-styles change altered the
  already-live session path so `resumeSession` no longer returns success, but
  the direction has not been confirmed; whether the spec or the service is wrong
  is itself part of the task.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

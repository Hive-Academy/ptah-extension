---
id: TASK_2026_422_dee6
status: backlog
type: BUGFIX
title: Native uuid stamping picks the oldest unstamped user bubble
description: >-
  TabManagerService.reconcileUserMessageNativeUuid stamps the SDK transcript
  uuid onto the FIRST user bubble with an optimistic id and no nativeUuid.
  After a failed direct send, the next prompt's uuid lands on the failed
  bubble, so fork and rewind anchor on the wrong message.
---

Follow-up from TASK_2026_420 (team-leader R1). See `context.md`.

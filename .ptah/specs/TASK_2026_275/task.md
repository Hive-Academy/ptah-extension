---
id: TASK_2026_275
status: backlog
type: refactoring
title: >-
  external-marketplaces.component.ts runs five state machines in 961 lines with
  no injectable store
description: >-
  The component owns marketplace list CRUD, add-form validation, per-source browse
  expansion, the two-call consent/install state machine, and uninstall — five
  independently-testable concerns in one class, unlike the orchestrator+ChatStore
  split in `libs/frontend/chat` or `TabManager` in `chat-state`. Its 706-line spec
  is the symptom: every browse test loads the whole install state machine too. All
  Angular mechanics are correct (OnPush, signals, `inject()`, new control flow, no
  `[innerHTML]`), so this is structure rather than a defect — but the next feature
  on this surface, per-plugin update badges for instance, lands in the same file.
  Extract the RPC orchestration into an injectable store before that happens.
---

# Split the external-marketplace surface

Machine-owned metadata carrier. Prose lives in `./context.md`.

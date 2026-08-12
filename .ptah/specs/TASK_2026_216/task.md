---
status: done
type: BUGFIX
title: >-
  Delete-confirm and name-input modals have no role, no aria-modal, no focus
  management, and clickable modal-backdrop divs
description: >-
  editor-panel.component.ts:443-500's delete-confirm and name-input modals
  have none of the accessibility shape TASK_2026_173 Batch 7's new
  save-conflict dialog uses, leaving this one file with one accessible modal
  and two inaccessible ones -- an inconsistency that will read as an
  oversight rather than a scope boundary. Left alone deliberately: fixing
  inside Batch 7 would have blurred the save-semantics diff. Register item
  10 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Fix: apply the exact shape the conflict dialog already uses.

---
id: TASK_2026_184
status: done
type: BUGFIX
title: KeyboardNavigationService.configure clamps instead of resetting, so a narrowed list keeps a stale active row
description: configure() at libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts:100-110 clamps activeIndex to itemCount-1 rather than resetting it. For a filter-as-you-type list this leaves the active row pointing at whatever survived the clamp, not at the new first match. unified-suggestions-dropdown.component.ts:140 is a live victim - it configures from suggestions().length inside an effect and never resets, and it owns a resetFocus() at :268 that this path does not call. Type to narrow, press Enter, insert the wrong file. Found during TASK_2026_181 Batch 10, which worked around it locally in tasks-ui. Four consumers depend on the current behaviour, so the fix needs its own tests rather than a drive-by.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-05T00:00:00.000Z
updated: 2026-08-05T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

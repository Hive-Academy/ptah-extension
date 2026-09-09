---
id: TASK_2026_405
status: in_review
type: feature
title: Move the activity ticker out of the navbar into a floating toast
description: >-
  The back-office activity ticker renders inside the Electron navbar and changes
  the width of the header row when a message arrives. Move it into a floating
  toast overlay anchored to the top-right corner, above the navbar, so that the
  navbar layout stays fixed.
---

# TASK_2026_405 — Activity toast

## Problem

`ActivityTickerComponent` is embedded in the navbar action cluster of
`electron-shell.component.ts:215`. Each new activity message changes the width
of the inline element and moves the tab strip. This is a layout shift in the
header.

## Goal

Show the same activity messages as a floating toast at the top right of the
window. The toast must not occupy space in the navbar.

## Scope

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts`
- The specs of both components.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts`

## Out of scope

- `BackOfficeActivityService` state model and coalescing rules.
- `ActivityEventPayload` wire contract.
- The `thoth-runtime` emitters.
- A general toast system for other features.

## Acceptance criteria

1. The navbar contains no activity element. The tab strip position does not
   change when an activity message arrives.
2. The toast floats over the content, anchored to the top-right corner, below
   the navbar row.
3. The toast keeps the current content: level dot, truncated summary, and the
   click target that opens Thoth.
4. The toast hides itself when `isIdle()` is true, and appears again on the next
   message.
5. The toast does not block clicks on the elements under it when it is hidden.
6. `data-testid="activity-ticker-line"` still identifies the message line.
7. Unit specs and the e2e scenario pass.

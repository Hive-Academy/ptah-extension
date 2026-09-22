---
id: TASK_2026_524_1125
status: in_review
type: REFACTORING
title: >-
  Enable Angular Router in the shared webview behind an in-memory
  PlatformLocation, and make a session addressable
description: >-
  The rule that the Angular Router cannot run in this webview is documentation,
  not a measured limit. A custom in-memory PlatformLocation makes the Router
  viable in the VS Code webview and the Electron renderer at the same time,
  because it never touches the History API. Replace the hand-rolled view switch,
  the three divergent initialView allow-lists and the bespoke lazy-view loader
  with one route table, then persist the logical URL so a reload and a restart
  restore the surface and the active chat tab. Consume the navigation sets that
  TASK_2026_492_0bcc defines. Do not route the chat and canvas surfaces, whose
  always-mounted pattern protects CanvasStore.
---

# Enable Angular Router in the shared webview behind an in-memory PlatformLocation

Depends on: `.ptah/specs/TASK_2026_492_0bcc` (navigation sets and workspace
types). Evidence: the three lane reports in this folder —
`host-constraints.md`, `current-navigation.md`, `package-capability.md`.

See `context.md`.

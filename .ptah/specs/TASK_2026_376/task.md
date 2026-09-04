---
status: in_review
type: bugfix
title: Background agent lifecycle, empty assistant bubbles and internal-query hygiene
description: >-
  Seven findings from a live Electron dev session on 2026-09-03. Three are
  confirmed UI-visible defects in the background-agent lifecycle and the
  assistant-message transformer. One is a silent data loss in the memory
  curator. Two are internal-query hygiene items, one of them a
  prompt-injection surface. One needs investigation before it is called a
  defect. Evidence, per-finding severity and the batch split are in
  context.md.
---

# TASK_2026_376

Diagnosed from a DevTools console capture and an Electron main-process log.
Prose, evidence and the batch assignment live in `context.md`.

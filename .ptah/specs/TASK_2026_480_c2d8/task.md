---
status: backlog
type: bugfix
title: Renderer holds one full core and 1 GB heap with seven open sessions
description: >-
  The Electron renderer averaged 94 percent of one core across 67 minutes and
  holds 1,051 MB. This is the continuous UI lag in scrolling, typing indicators
  and session detail. Investigation first, because no CPU profile exists yet.
---

Main process is only at 7 percent of a core, so this is renderer-side.
A profile requires relaunching with `--remote-debugging-port`.

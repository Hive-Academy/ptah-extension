---
status: done
type: bugfix
title: Reap child process trees on Windows cross-spawn targets
description: >-
  Three spawn sites have no termination path and four more kill a single process
  over a cross-spawn wrapper, so on Windows the cmd.exe grandchild survives.
  Apply the existing killProcessTree pattern.
updated: '2026-10-10T18:18:03.633Z'
---

# Reap child process trees

Apply the repository's existing `whenSpawned` + `killProcessTree` reaping
pattern to every spawn site that terminates a child over a cross-spawn
wrapper, and add a termination path to the three sites that have none.

See `context.md` for the measured evidence and the site list.

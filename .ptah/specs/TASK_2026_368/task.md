---
status: in_review
type: bugfix
title: Electron main process never exits after a deferred will-quit on Windows
description: >-
  Every quit is deferred since TASK_2026_331 B1 (`requiresDeferredDisposal` is
  true whenever the agent process manager exists). The chain calls
  `event.preventDefault()` in `will-quit`, disposes, then re-issues
  `app.quit()` from an async `finally`. On Windows that second `app.quit()` is
  silently ignored (electron/electron#33643): no second `will-quit`, no `quit`
  event, no exit. The process lives on windowless until killed. Every Electron
  e2e spec has failed on teardown since Aug 28, and CI has not completed a run
  since Aug 25. Fix is to re-issue the quit from a macrotask.
---

# Electron main process never exits after a deferred will-quit on Windows

The deferred quit chain completes correctly and re-issues `app.quit()`, and
Electron ignores it. The process stays alive with no window until something
kills it.

The fix is one line at the injection site in `apps/ptah-electron/src/main.ts`:
the `quit` dep handed to `handleWillQuit` now schedules `app.quit()` on a
macrotask instead of calling it directly.

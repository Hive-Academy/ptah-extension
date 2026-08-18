---
id: TASK_2026_264
status: in_review
type: FEATURE
title: >-
  Electron e2e for the auth-switch permission defect, because the unit specs
  mock the one thing most likely to be wrong
description: >-
  TASK_2026_247 fixed a config change denying every in-flight permission across
  every window, tab and background subagent. Its own "Verification" section
  describes a reproduction that was never run, and its closing note records that
  the fix is pinned by unit specs rather than by the live auth-change. Those
  specs prove `cleanupPendingPermissions` is scoped and that a `systemAbort`
  maps to `interrupt: false` — but they mock `ConfigWatcher`, so nothing proves
  the watcher fires on a real settings write or that `disposeAllSessions` is
  reached at all. `apps/ptah-electron-e2e` already launches the real `main.mjs`
  with an `rpcBridge` that nothing intercepts and a `ptahHome` fixture giving
  the app an isolated `os.homedir()`, so a real provider switch can be driven
  without touching the developer's credentials. The blocker is that reproducing
  the defect needs a pending permission request at the moment config changes,
  and there is no seam in `src/support/` to establish one without a live model.
  Building that seam is the task; the provider switch is the easy half.
---

# Electron e2e for the auth-switch permission defect

Machine-owned metadata carrier. Prose lives in `./context.md`.

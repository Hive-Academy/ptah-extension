---
id: TASK_2026_251
status: backlog
type: BUGFIX
title: >-
  Two Electron DI risk guards are red — PTY_HOST and APP_UPDATER cannot resolve
  because chat services register before output styles
description: >-
  `apps/ptah-electron/src/di/container.smoke.spec.ts` has two failing tests,
  `resolves PTY_HOST to the very same instance as PTY_MANAGER_SERVICE` and
  `resolves APP_UPDATER to the very same instance as UPDATE_MANAGER_TOKEN`. Both
  throw the same guard from `libs/backend/rpc-handlers/src/lib/chat/di.ts:90` —
  "registerChatServices(): registerOutputStyleServices(container, logger) must
  run first". Those two specs exist to pin risks R1 and R2 (token aliasing), so
  the failure is not a stale assertion: it is two risk guards that currently
  assert nothing while reading as known-red. Found 2026-08-15 while measuring a
  baseline for TASK_2026_180 B5.1; pre-existing, and reproduced identically
  before and after that batch and after B4.4.
---

# Two Electron DI risk guards are red on a phase-ordering fault

Machine-owned metadata carrier. Prose lives in `./context.md`.

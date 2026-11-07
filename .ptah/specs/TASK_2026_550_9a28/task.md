---
id: TASK_2026_550_9a28
status: backlog
type: DEVOPS
title: Speed up and stabilize the Electron e2e suite
depends_on: []
created: '2026-09-24T06:19:59.827Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Share one Electron app per Playwright worker instead of booting one per test. Keep a fresh
  launch for specs that need a clean profile, and measure suite time before and after.
estimate: M
labels:
  - e2e
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`electronApp` in `apps/ptah-electron-e2e/src/support/fixtures.ts:60` has no `scope`, so every test
calls `launchPtah()` and boots the full main process. With `workers: 1`
(`apps/ptah-electron-e2e/playwright.config.ts:22`) the suite pays one boot per test.

1. Make `electronApp` worker-scoped, with a per-test reset (renderer reload, RPC mock reset, state
   reset through `ui.prepare()`).
2. Keep a test-scoped opt-out and list the specs that need it (for example `startup-config`,
   `state`, `smoke`, persistence and lifecycle specs).
3. Review each spec for leaked state. Include the flake audit and the mocked-vs-real fixture audit
   for the git, `harness/*` and `tasks/*` families from `context.md`.
4. Measure suite time before and after.

Run e2e targets only when the user asks for it.

## Current state (2026-11-07)

- Done: the start-up hang after `IpcBridge IPC listeners initialized` (Problem 2) was fixed by
  PR #597 (CLI MCP registration moved out of the pre-window phase, boot-trace watchdog).
- Open: the fixture is still test-scoped (`fixtures.ts:60`).
- Not checked: whether the PR 586 flakes listed in `context.md` still recur.

Full history in [./context.md](./context.md).

---
id: TASK_2026_389
status: backlog
type: devops
title: >-
  Electron e2e harness: make PTAH_E2E gate the heavy boot subsystems, fix the
  30s warmup dead-wait, and improve local failure diagnosis
depends_on: []
created: '2026-09-07T00:00:00.000Z'
updated: '2026-09-07T00:00:00.000Z'
description: >-
  ptah-electron-e2e boots the full Electron app once per test (fixtures.ts
  test-scoped electronApp), and most specs boot it with no workspace open, so
  every test pays the embedder-warmup barrier (up to 30s), the messaging
  gateway, and full DI bring-up regardless of what the spec exercises.
  PTAH_E2E is already read in four places (update-manager.ts, the VS Code
  bootstrap.ts, verify-and-report.ts, agent-rpc.handlers.ts) but the embedder
  warmup, messaging gateway and membership priming are not gated on it. A real
  git-workspace fixture (real-rpc-fixtures.ts + git-scratch-repo.ts) already
  exists and is used by 4 of 7 git specs; the other 3 git specs and most of
  the rest of the suite intentionally run against a mocked RPC layer with no
  workspace. Locally, retries are 0 and trace is off, so a flaky or slow
  failure is hard to diagnose. Worker-scoping electronApp (one boot per
  worker instead of per test) is the biggest possible speed win but conflicts
  with the documented "tests must remain serial, the app owns global state"
  rule in apps/ptah-electron-e2e/CLAUDE.md and needs a proven per-test reset
  path first.
executor: devops-engineer
estimate: M
labels:
  - e2e
  - electron
  - test-infra
  - performance
relates_to: []
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Speed and fidelity fixes for the Electron e2e harness: gate heavy boot subsystems on PTAH_E2E, stop paying the 30s warmup-barrier dead wait on specs that never use the memory curator, raise local diagnosability (traces/retries), and separately evaluate (not yet implement) worker-scoped electronApp. See [./context.md](./context.md).

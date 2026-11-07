---
id: TASK_2026_715_6cba
status: backlog
type: FEATURE
title: Codex multi-account on the App Server route
depends_on: [TASK_2026_712_5d7c, TASK_2026_714_c8a2]
created: "2026-10-22T18:42:55.000Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Add named Codex accounts (one CODEX_HOME per account) on the Codex App Server route, reusing the
  provider account store and the Electron Accounts surface. Both dependencies are done.
estimate: L
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Add named Codex accounts in Electron. Each account has its own `CODEX_HOME`, and chat and lanes
pick the account on the Codex App Server route. Reuse the provider account store, its RPC and the
Electron Accounts surface that TASK_2026_712_5d7c built for Claude. Start with a fresh architect
pass (`implementation-plan.md`) against current main. The former TASK_2026_712 Codex batches 36-43
(`../TASK_2026_712_5d7c/batches.md`) are inputs only: they target the legacy Codex resolver.

## Current state (2026-11-07)

- The start condition is met: TASK_2026_712_5d7c and TASK_2026_714_c8a2 are `done` (Codex App
  Server in PRs #809, #823 and #881).
- The account store is Claude-only: `provider: z.literal('claude')` and SQL fixed to
  `provider = 'claude'`
  (`libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:48,189,223`). All
  account modules in `libs/backend/auth-providers/src/lib/accounts/` are `claude-*` or generic
  `provider-account-*`.
- The per-home seam exists: `CodexHomeAuthReader`
  (`libs/backend/codex-runtime/src/lib/codex-home-auth-reader.ts:10`), implemented by
  `CodexHomeAuthService`
  (`libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:77`).
- Not started.

Full context, plan and discussion live in [./context.md](./context.md).

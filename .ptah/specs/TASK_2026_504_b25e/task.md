---
status: backlog
type: refactoring
title: >-
  Replace uuid with crypto.randomUUID, then take uuid 14
description: >-
  uuid is ESM-only from version 12, and three libs build as CommonJS. Replace the seven
  non-spec uuid imports with crypto.randomUUID() and drop the dependency.
updated: 2026-11-07T00:00:00.000Z
---

# uuid 11 -> 14

## Description

Follow-up 7 of TASK_2026_498_5513. Held back deliberately. `uuid` is ESM-only from version 12.
`libs/shared`, `libs/backend/agent-sdk` and `libs/backend/cli-agent-runtime` build with
`"format": ["cjs"]` (`project.json:16` in each), so a transpiled `require('uuid')` fails at runtime.
The remedy is to use the native `crypto.randomUUID()` and drop the dependency.

## Current state (2026-11-07)

- Not done. `package.json:137` still has `"uuid": "^11.1.0"`.
- Seven non-spec files import `uuid`:
  - `libs/shared/src/lib/types/agent-process.types.ts`
  - `libs/shared/src/lib/types/branded.types.ts`
  - `libs/backend/agent-sdk/src/lib/permission/permission-description.ts`
  - `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-permission-bridge.ts`
  - `libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts`
  - `libs/frontend/chat-state/src/lib/identity/ids.ts`
- The VS Code webview is removed (PR #892), so the old question about its secure context is gone.
  Only the Electron renderer and Node remain.

## The remaining check

`crypto.randomUUID` requires a secure context in a browser. Confirm that the Electron renderer
(`apps/ptah-extension-webview`, loaded by `apps/ptah-electron`) is a secure context in dev and in the
packaged app. If it is, all seven sites share one remedy.

## Why there is no pressure

`uuid` 11 appears in no security advisory. The current version works. This is a
cleanup, not a fix.

## Scope

1. Confirm secure-context behavior in the Electron renderer.
2. Replace the seven `uuid` imports with `crypto.randomUUID()`.
3. Remove the dependency from the root manifest.
4. Confirm the three CommonJS libraries still work: `npm run verify -- -p <touched projects>`.

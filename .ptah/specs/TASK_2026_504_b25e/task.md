---
status: backlog
type: refactoring
title: >-
  Replace uuid with crypto.randomUUID, then take uuid 14
description: >-
  `uuid` is ESM-only from version 12. `libs/shared`, `libs/backend/agent-sdk`
  and `libs/backend/cli-agent-runtime` build with `"format": ["cjs"]`, so a
  transpiled `require('uuid')` fails at runtime. The remedy is to drop the
  dependency for the native `crypto.randomUUID()` across six files. One check
  is outstanding before that is safe.
---

# uuid 11 -> 14

Follow-up 7 of TASK_2026_498_5513. Held back deliberately.

## The blocking question

`crypto.randomUUID` requires a secure context in a browser. Nobody has verified
that the VS Code webview scheme qualifies. Answer that first. If the webview
does not qualify, the six sites do not share one remedy and this task must
split by runtime.

## Why there is no pressure

`uuid` 11 appears in no security advisory. The current version works. This is a
cleanup, not a fix.

## Scope

1. Confirm secure-context behavior in the VS Code webview and in Electron.
2. Replace the six `uuid` call sites with `crypto.randomUUID()`.
3. Remove the dependency from the root manifest.
4. Confirm the three CommonJS libraries still build and run.

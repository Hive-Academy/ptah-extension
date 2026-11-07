---
id: TASK_2026_355
status: backlog
type: BUGFIX
title: Repair the remaining CP1252-mojibake em dashes in 8 .ts files and add a guard
depends_on: []
created: '2026-08-29T01:40:14.012Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  131 mojibake em dashes (bytes c3 a2 e2 82 ac e2 80 9d) remain in 8 .ts files, down from 344
  in 65. Replace them with a plain em dash or "-", keep any intentional test input, and add a
  guard spec that fails on the byte sequence.
executor: backend-developer
estimate: S
labels:
  - logging
  - encoding
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Full context, plan and discussion live in [./context.md](./context.md).

## Description

The byte sequence c3 a2 e2 82 ac e2 80 9d is a UTF-8 em dash decoded as CP1252 and encoded
again. TASK_2026_354 masks it at runtime through `sanitizeConsoleText`
(`libs/backend/vscode-core/src/logging/console-text.ts`). Remaining work:

- Replace the sequence in these files (count in brackets, as of 2026-11-07):
  - `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts` (89)
  - `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts` (22)
  - `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts` (11)
  - `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts` (3)
  - `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` (1)
  - `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts` (1)
  - `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts` (1)
- Leave the 3 occurrences in `console-text.ts` if they are the sanitizer's own match pattern,
  and keep any spec input that tests the sanitizer on purpose.
- Add a guard spec (or lint rule) that fails on the byte sequence, with an allow-list for the
  intentional cases.
- Run it when no other agent edits those libs, to avoid collisions.

## Current state (2026-11-07)

- Partly done by other work: 131 occurrences in 8 files remain, down from 344 in 65.
- No guard spec exists.
- The runtime mask from TASK_2026_354 is in place (`console-text.ts`, exported from
  `libs/backend/vscode-core/src/logging/index.ts`).

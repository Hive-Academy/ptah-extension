---
id: TASK_2026_602_0427
status: backlog
type: BUGFIX
title: Handle an unreadable key in the provider setup wizard and drop stale check verdicts
depends_on: []
created: "2026-10-03T12:10:01.948Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The provider setup wizard in Settings treats a keyUnreadable connection as "no stored credential",
  and the original caller of a superseded connection check still receives the old key's verdict.
executor: frontend-developer
estimate: S
labels:
  - settings
  - providers
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

This is the provider setup wizard in Settings (`ptah-provider-setup-wizard`), not the removed
first-run setup wizard.

1. **Unreadable key.** `auth:getApiKeyStatus` can mark a row `keyUnreadable: true`, and then
   `hasApiKey: false` means "unknown". The Settings page passes `hasKey === true` to the wizard, so
   the wizard acts as if no key is stored and does not tell the user that a key may exist. Pass a
   third state (stored / not stored / unknown) and show "Could not read the stored key." in the
   wizard.
2. **Stale verdict.** A check started after a key change never joins an old check, and the old
   check's result is not recorded. But the original caller of the old check still gets the old
   key's verdict as its return value. When `complete` refuses the ticket, return a fixed
   "superseded" result instead.

Acceptance: a wizard spec (an unreadable row shows the unknown state) and a connection-check spec
(the caller of a superseded check never gets the old verdict).

## Current state (2026-11-07)

- Both notes are open.
- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:684-689`
  computes `wizardCredentialStored` as `hasKey === true` and binds it to
  `[existingCredentialPresent]` at `:499`.
- `libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts:159-166` calls
  `recorder.complete(ticket, record)` and then returns `record` with no superseded check. The file
  has no "superseded" result.

Full context, plan and discussion live in [./context.md](./context.md).

# TASK_2026_602 — unreadable key in the setup wizard, stale check verdicts

Two minor notes from `TASK_2026_555/batch-55-logic-recheck.md` (N-3 and N-1). N-2 and N-4 of the same re-check were
fixed in TASK_2026_555.

## 1. Setup wizard treats an unreadable key as "no key" (N-3)

Since TASK_2026_555 M-6, `auth:getApiKeyStatus` can mark a row `keyUnreadable: true` (`hasApiKey: false` then means
unknown). The card and the drawer show "Could not read the stored key." with Retry.
`libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (around line 270) passes
`wizardCredentialStored = hasKey === true` to the setup wizard, so for such a row the wizard behaves as if no key is
stored and does not tell the user that a key may exist. Overwrite still works, so no data is lost.

Fix direction: pass a third state to the wizard (stored / not stored / unknown) and show the fixed text there.

## 2. The original caller of a check can get an old verdict (N-1)

`libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts` (around lines 108-124): after TASK_2026_555 M-1, a
check started after a key change never joins an old check, and the old check's result is not recorded. But the
**original** caller of the old check still receives the old key's verdict as its return value. The Settings drawer
does not show that value today (it re-reads the route), so the UI is not affected. Another client (CLI, a future UI)
could show a green check for a key that no longer exists.

Fix direction: when `complete` refuses the ticket, return a fixed "superseded" result instead of the stale record.

## Acceptance criteria

1. Wizard spec: an unreadable row shows the unknown state, never "no stored credential".
2. Connection-check spec: the caller of a superseded check never receives the old verdict.
3. Typecheck, lint, tests for chat, core, rpc-handlers; Settings Playwright folder green.

## Out of scope

The backend key store.

# Batch 40b report — membership host-text fix (TASK_2026_555)

Author: Search & Voice owner (frontend-developer, in-process). Follow-up to the Batch 45b host-text
scan. No build, Playwright, screenshots, git writes or `batches.md` edits.

## Change

`libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts`

- `submitLicenseKey()`: `result.data.error`, `result.error` and
  `` `Failed to verify membership key: ${error.message}` `` (old :597-599, :604-605) replaced by
  one fixed sentence, `ACTIVATE_KEY_FAILED` = "Could not activate the membership key.", for all
  three failure paths.
- `confirmLogout()`: `result.data.error`, `result.error` and
  `` `Log out failed: ${error.message}` `` (old :638-640, :645-646) replaced by `LOGOUT_FAILED` =
  "Could not log out." The confirm stays open on failure, as before.
- Kept: the local key-format message ("Invalid format. Key must start with "ptah_lic_" followed by
  64 hex characters.") — produced by the card itself before any RPC. The success line
  ("Membership activated! Plan: … Reloading...") is unchanged.

## Spec

`license-status-card.component.spec.ts`: 14 → 17 tests.

- Removed the three tests that asserted host text ("server says no", "Key not recognized",
  "connection lost").
- Added `HOST_FAILURES` (RPC failure, `{ success:false, error:'host detail' }`, thrown
  `Error('host detail')`) × {log out, key activation} = 6 `it.each` cases. Each asserts the exact
  fixed sentence in the `role="alert"` element and that "host detail" is not rendered; log out
  also asserts the confirm stays open, activation that no success line is shown.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 libs/frontend/chat/src/lib/settings/license/license-status-card`
  → 1 suite passed, 17 tests passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` (one run covering
  Batches 40b and 43b) → "Successfully ran targets typecheck, lint"; no warning or error lines.

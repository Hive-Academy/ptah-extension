# Batch 36d report — Gate V 36 visual re-check 2 (tasks a-b)

Author: the Orchestration owner, an in-process frontend-developer, track A worktree (head 493baad02, 36c committed).
No commit and no change to batches.md. Source: `visual-review-gate-v36.md` "Re-check 2". `CHAT` = `libs/frontend/chat/src/lib/settings`,
`HARNESS` = `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`.

## Task a — N3: a failed Cursor save left focus on body and Esc dead

**Cause:** while a write ran, the key input, Save, "Remove stored key" and the confirm's buttons were natively `disabled` (`cursor-credential-popover.component.ts:65, 76, 79, 90-91` at 493baad02). The focused control lost focus to `body`, so the popover's Esc handler no longer received the key.

**Fix** (`CHAT/ptah-ai/cursor-credential-popover.component.ts`):

| Change | Line |
| --- | --- |
| `INERT` = `aria-disabled:cursor-not-allowed aria-disabled:opacity-50`, added to `ACTION` and to Save. This follows the 36b move-button pattern. | `:10-13` |
| The key field is `[readonly]` and `aria-busy` while busy, never `disabled`. | `:72` |
| Save, Remove stored key, Remove key and Cancel use `[attr.aria-disabled]`, never `[disabled]`. Save is also `aria-disabled` while the field is empty. The handlers refuse the click while busy or empty (existing guards, plus the new `askRemove` / `cancelRemove`). | `:83-99` |
| After a save, focus goes to the key field: after a failure, for a retry with the typed key kept; after a save, onto the cleared field. If a saved key moves the row and re-creates the popover, the matrix's `(opened)` → `focusCredentialKey()` focuses the new field. | `:163-166` |
| "Remove stored key" opens the confirm with focus on its Cancel; Cancel returns focus to "Remove stored key". | `:169-180` |
| A failed removal keeps the confirm, with focus still on "Remove key", which is only `aria-disabled` during the write. A removal that lands closes the confirm and focuses the key field. | `:197-203` |

The colour and text classes are unchanged. File size: 205 lines.

**Jest** (`CHAT/ptah-ai/cursor-credential-popover.component.spec.ts`):
- `:104-106`: Save is `aria-disabled` while the field is empty and enabled once a key is typed.
- `:180`: while any save runs, the controls are `aria-disabled`, the field is `readOnly`, nothing is natively disabled, and a click writes nothing.
- `:194` `describe('N3 …')`:
  - Save keeps focus while it runs; after a failed save, focus is on the key field.
  - After a saved key, focus is on the cleared field.
  - Remove → Cancel focused → Cancel → "Remove stored key" focused.
  - A failed removal keeps the confirm and focus on "Remove key"; a removal that lands moves focus to the key field.

**Playwright:** `HARNESS/settings-orchestration.e2e.spec.ts:387`, both hosts. With the fixture refusing the write:
- The outcome reads "The key was not saved." and focus is on the key field, which keeps its value.
- Esc closes the popover, and focus returns to Cursor's Credentials trigger.

## Task b — opt-in Cursor key store in the harness, and the removal-focus scene

**Fixture:** a new file, `HARNESS/settings-cursor-key.fixtures.ts`, exporting `cursorKeyStoreOverrides(page, { failCursorSave? })`. It is a `bootSettings` override, so `settings.fixtures.ts` is unchanged.
- Its `agent:setConfig` records the call and applies every other field as before.
- For `cursorApiKey` it sets `cursorApiKeyStored` / `cursorApiKeyConfigured` and sets Cursor's `detectedClis` entry to installed or uninstalled. This mirrors the host: Cursor is detected once a key resolves.
- `failCursorSave` answers the write with `{ success: false }`.

**Scene:** `HARNESS/settings-orchestration.e2e.spec.ts:345`, both hosts.
1. Expand Uninstalled → Credentials on the Cursor row: focus is on the key field.
2. Save: the toast reads "Key stored, not verified.", the row moves to the installed group, and the status shows "Set". Esc → focus returns to the installed row's trigger.
3. Collapse the Uninstalled group → Credentials → "Remove stored key": focus is on Cancel. "Remove key": the toast reads "Stored key removed.".
4. The row is now in the collapsed group, kept shown by its open popover, with focus inside.
5. Esc: the popover closes, the group is collapsed (`aria-expanded="false"`), the Cursor row is gone, and **focus is on the Uninstalled toggle**, not `body`.
6. A further Esc keeps focus on the toggle and leaves the tab intact.

This is the browser check of 36c task d that re-check 2 could not run.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness`: success.
- `npx nx run-many -t test -p @ptah-extension/chat -- --maxWorkers=2`: success. Targeted popover and matrix suites: 63 / 63.
- `npx nx build ptah-extension-webview`: exit 0.
- `settings-orchestration.e2e.spec.ts --reporter=list --workers=2` (cwd `libs/frontend/webview-e2e-harness`): **40 passed**. That is 36 earlier scenes plus the 2 new Cursor scenes × 2 hosts.

## Captures

No capture was written or changed: `git status` shows no modified screenshot. The untracked `screenshots/gate-v36r2/` folder belongs to the visual reviewer and was not touched.

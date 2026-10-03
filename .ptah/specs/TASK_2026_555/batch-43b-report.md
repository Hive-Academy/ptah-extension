# Batch 43b report — output-style host-text follow-up (TASK_2026_555)

Original Batch 43 author: the antigravity CLI lane. This follow-up: Search & Voice owner
(frontend-developer, in-process), from the Batch 45b host-text scan. No build, Playwright,
screenshots, git writes or `batches.md` edits.

## Backend audit

**Parity warning** (`output-style.store.ts` `parityWarning`, was :127, shown by
`output-style-parity-section.component.ts:163`). Producers of `OutputStyleParityOutcome.error`:

| Code | Producer | Message |
|---|---|---|
| `WRITE_FAILED` | `libs/backend/output-styles/src/lib/claude-settings.writer.ts:183`, `:197`, `:246` (via `writeFailure` :393-408), `:288-290`; `libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.ts:392-393` | Fixed template + display path |
| `SETTINGS_CONFLICT` | `claude-settings.writer.ts:263` | Fixed template + display path |
| `NO_WORKSPACE` | `claude-settings.writer.ts:329-330` | Fixed |
| `IMMUTABLE` | `output-style-rpc.handlers.ts:370-371` | Fixed |
| `SETTINGS_MALFORMED` | `claude-settings.writer.ts:215` over `parseSettings` :129-142 | **Embeds `JSON.parse` exception text** (`sanitizeDiagnostic(errorMessage(error))`, :129-134) |

The display path is built from constants only: `~/.claude/<file>` (:318) or `.claude/<file>`
(:339), never from an exception.

**Conflict prompt** (`save()` :228-233 → `output-style-editor.component.ts:153`, only for
`FILE_EXISTS` / `STALE_FILE`, `editor.component.ts:576`):

- `STALE_FILE` — `libs/backend/output-styles/src/lib/output-style-file.writer.ts:203-207`: fixed
  template around `existing.fileName`, a file name found by listing the tier directory (`locate`).
- `FILE_EXISTS` — `output-style-file.writer.ts:222-226`: fixed template around `target.fileName`,
  the slug of the style name (`styleFileName(slugifyStyleName(name))`, :171-181) or the existing
  file's name.

Neither embeds exception text, so the prompt is **kept unchanged**. Every other save failure
already shows the fixed `OUTPUT_STYLE_SAVE_FAILED` (`editor.component.ts:580`).

## Change

`libs/frontend/chat/src/lib/settings/output-style/output-style.store.ts`

- New `parityWarningText()`:
  - `SETTINGS_MALFORMED` → "{path} is not a valid settings file. Ptah did not change it — fix
    the file by hand, or choose a different one." (`path` is the constant-derived display path;
    "The settings file" if absent). The parser detail is never shown.
  - `WRITE_FAILED`, `SETTINGS_CONFLICT`, `NO_WORKSPACE`, `IMMUTABLE` (`FIXED_PARITY_CODES`, the
    codes audited above) → the backend message unchanged.
  - Any other code → "Your style is active in Ptah, but the settings file for the command line
    could not be updated." (the backend's own fallback text, handlers :392-393).
- `parityWarning` uses it. No change to `save()` or the conflict prompt.

## Spec

`output-style.store.spec.ts`: 20 → 22 tests.

- The "keeps the selection when only the parity write fails" expectation now checks the fixed
  `SETTINGS_MALFORMED` sentence.
- New: a `SETTINGS_MALFORMED` message carrying "(host detail)" yields the fixed sentence and does
  not contain "host detail".
- New: `SETTINGS_CONFLICT` passes its fixed backend message through; an unlisted code
  (`DELETE_FAILED`, message "host detail") yields the fixed fallback.
- The existing `FILE_EXISTS` save test and the editor conflict test are unchanged and pass.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 libs/frontend/chat/src/lib/settings/output-style libs/frontend/chat/src/lib/settings/license`
  → 4 suites passed, 85 tests passed (includes the Batch 40b license spec, 17).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` (one run covering
  Batches 40b and 43b) → "Successfully ran targets typecheck, lint"; no warning or error lines.

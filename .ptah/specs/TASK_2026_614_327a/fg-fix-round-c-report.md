# Fix round C (frontend): TASK_2026_614_327a, Stage F + G

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.html`

No backend file was touched. The backend entries in `git status` belong to fix rounds A and B.

## Finding 1: logic review C, S1 / FM-1 (a pending percent draft is lost on Tab)

- Cause: the field commits on `(change)`, and `change` fires only when the value changed since focus. When a partner save made a focused draft valid, `commitPartner` only re-validated it. Leaving the field without typing then fired `blur` but not `change`, so the draft was never written.
- Fix: `blurred(key)` now also runs `if (this.drafts()[key] !== undefined) void this.commit(key);`.
  - The Batch 19 rule is kept: `commitPartner` still does not save a focused sibling. It is saved only on its own blur or Enter.
  - No double write: when `change` fires on blur, the browser fires it before `blur`. `write()` sets `savingKey` synchronously, so `busy()` is true and the blur commit returns early.
  - An invalid or unchanged draft stays guarded by the early returns already in `commit`.
- Specs added (in `describe('tighten < handoff ...')`):
  - `Tab after editing both: leaving the focused partner without typing saves its now-valid draft`. Steps: tighten 85 is refused, then handoff 95 is entered with change and blur, focus moves to tighten, and tighten blurs with no `change`. Both writes happen in order and no error remains.
  - `leaving a field whose change already saved it does not write it twice`. Steps: focus, then change, then blur. Exactly one write happens.
  - The existing "focused partner is not auto-saved" spec still passes without changes.

## Finding 2: style review S1 (the inline template breaks `max-lines`)

- The template was moved byte-for-byte from the old lines 86-703 into `session-stats-summary.component.html`, with the 4-space literal indent removed. The component now uses `templateUrl: './session-stats-summary.component.html'`.
- A script did the extraction and first checked that the template had no backtick, `${` or backslash, so nothing was unescaped by the move. The markup is otherwise unchanged and behaviour is the same.
- The inline `styles` block (about 75 lines) stays inline, because the file is now 409 lines, well under the 700 limit. The repository already uses `templateUrl`, for example in `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`.

## Checks (all from the worktree root)

| Command | Exit | Result |
| --- | --- | --- |
| `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat @ptah-extension/chat-ui --parallel=2` | 0 | All 6 targets passed |
| `npx eslint <both component .ts files>` | 0 | No output, so no `max-lines` warning for session-stats-summary |
| `npx jest -c libs/frontend/chat/jest.config.ts .../session-budget-settings.component.spec.ts` | 0 | 37/37 passed, including the 2 new specs |
| `npx jest -c libs/frontend/chat-ui/jest.config.ts session-stats-summary` | 0 | 29/29 passed (templateUrl resolves) |
| `npx nx run di-lint:lint` | 0 | Passed (cache hit) |
| `npx nx run degradation-audit:lint` | 0 | Passed (cache hit) |

No baseline PNGs were rewritten, since `git status` shows no `.png` changes, so there was nothing to restore. Nothing was committed and `batches.md` was not edited.

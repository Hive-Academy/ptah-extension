# Batch P1 report: persistent toast announcer

Plan: `implementation-plan-p6.md`, component 2, decision P6-A1, acceptance 20, batch P1. Executor: frontend-developer.

## Changed files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/connection-drawer/models-tiers-tab.component.spec.ts`

## What was done, per plan item

| Plan item | Done |
|---|---|
| Two `sr-only` live regions rendered unconditionally, outside the `@if` | Two divs at the top of the template, outside the toast `@if`. One is `role="status" aria-live="polite" aria-atomic="true"`. The other is `role="alert" aria-atomic="true"`. Both carry the `sr-only` class. |
| Test ids `settings-toast-live-status` / `-live-alert`, `-inline` through `testId()` | Bound via `testId()`, so the inline variant gets `settings-toast-inline-live-status` / `-alert`. |
| Text is '' first, then the message after 50 ms | A new effect reads `feedback.toast()`. It clears any pending timer, sets both `liveStatus`/`liveAlert` signals to '', then starts one `setTimeout(ANNOUNCE_DELAY_MS = 50)` that writes the message into the region matching the toast's tone. Every new toast object restarts the cycle, including an identical repeated message, because the service sets a new object each time. |
| Cleared on dismiss | When the toast becomes `null`, both regions are cleared and the timer is cancelled. |
| Card markup unchanged except `role`/`aria-live` removed | Only `[attr.role]` and `[attr.aria-live]` were removed from the card. Classes, test ids, Undo and Dismiss are unchanged. |
| A destroyed component clears its timer; at most one timer per instance; no observer | `DestroyRef.onDestroy` calls `clearAnnounceTimer()`. One `announceTimer` field is held at a time. |
| Spec: regions exist and are empty before any toast; text only after the tick (fake timers); identical messages clear then set; dismiss clears | New `describe('persistent live regions (P6-A1)')` with `jest.useFakeTimers()`. It tests the 49 ms / 50 ms boundary, alert-versus-status routing, a repeated identical message on the same region element, dismiss cancelling a pending announcement, destroy leaving no announcement, and the card having no `role`/`aria-live`. The first test also asserts both regions with their role, aria-live, aria-atomic and sr-only attributes, empty before any toast. |
| Existing role assertions moved (evidence 28) | `settings-toast.component.spec.ts`: the success, failure, inline success, inline failure and drawer-placement tests now assert the live regions (real 60 ms wait helper `afterAnnounceTick`). The placement test also asserts that the regions sit outside the popover region. `models-tiers-tab.component.spec.ts`: the 2 role assertions were replaced by an `announced('status' or 'alert')` helper that reads `settings-toast-inline-live-*` after a real 60 ms wait. |

No new catch block was added. The existing one keeps its degradation-audit marker. No `process.cwd()`, and no `jest.spyOn` on module namespaces.

## Verification

Command, run from the worktree root:
`node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=settings-toast|models-tiers-tab"`

- First run: exit 0. The grep filter lost the summary lines; the log showed only the NX summary.
- Replay with `--output-style=static` added: exit 0. It printed "Running target test for project @ptah-extension/chat", then **Test Suites: 2 passed, 2 total; Tests: 34 passed, 34 total**. 0 failed.
- `ptah_get_diagnostics` was unavailable: the TypeScript check was still running after 45 s. No separate typecheck target was run, because the batch allows only the jest command.

## Decisions

- The card gets no replacement attribute such as `data-tone`. The plan says "card markup unchanged except role/aria-live removed", so tests assert tone through the live regions instead. Reversible.
- The older tests use a real 60 ms wait, and only the new P6-A1 block uses fake timers. This keeps the existing async `feedback.save()` flows untouched. Reversible.

## Open points

1. **Modal inertness of the page regions.** The page-toast live regions live in the page, not in the top layer. While a modal `<dialog>` is open, content outside it is inert and some screen readers may skip changes to those regions. The drawer's Models & Tiers tab already uses the inline variant, whose regions are inside the drawer. Other modal surfaces that rely on the page toast should be confirmed in the Electron visual/AT review (acceptance 22).
2. **Possible double announcement.** If a page toast and an inline toast are mounted at the same time, both read the same `SettingsSaveFeedbackService.toast()`, and both sets of regions announce. This was already true of the old card roles, so it is not a regression. Worth confirming that the Settings page toast is not mounted inside the same accessible tree while the drawer shows its inline copy.
3. No other spec in the workspace asserts a `role` on `settings-toast*`. Checked by grep over `libs` and `apps`, including the webview-e2e-harness scenarios.

# Workflow badge visual review fixes

## Changed files and fixes

- `libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.ts:24-47`: the full badge uses `badge-sm` and an `sr-only` `Workflow:` prefix instead of `aria-label`. Added `variant` input (`full` by default, `compact` for the tab bar). Compact renders the Lucide `Workflow` icon at 12 px inside a 16 px span, with hidden full text and a title tooltip.
- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:105`: uses `variant="compact"` on tagged tabs.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:61-67,134-167`: the badge is an in-flow row above the card, aligned to its text inset. Tagged expanded cards reserve 20 px for the row and shift the action trigger down 20 px; untagged and collapsed card layout stays as before.
- `libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.spec.ts:5-39`: checks full and compact variants, hidden text, no `aria-label`, and null workflow.
- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts:177-194`: checks compact icon, title and hidden text; untagged tab has no badge.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts:218-253`: checks the in-flow badge, reserved height, and unchanged untagged/collapsed layout.
- `libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts:298-318` and `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts:49-58`: replace old `aria-label` assertions with hidden prefix and text checks.

## Verification

| Command | Final result |
| --- | --- |
| `npx prettier --write <eight changed files>` | Pass; 8 files processed. The two later canvas edits were formatted again (2 files). |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1` | Pass; 4/4 targets. After the canvas height adjustment, canvas typecheck and lint passed again (2/2 targets). |
| `npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2` | Pass; 3,949 passed, 2 skipped, 0 failed (3,951 total). Initial run: 3,948 passed, 2 skipped, 1 failed due to an outdated text expectation, then fixed. |
| `npx nx test @ptah-extension/canvas --parallel=1 --maxWorkers=2` | Pass; 374 passed, 0 failed (23 suites). Initial run: 373 passed, 1 failed due to an outdated text expectation, then fixed. Final run after the height adjustment: 374 passed. |

Ptah scoped diagnostics reported no errors in the edited canvas files; it listed seven unrelated errors in sibling files. Nx project typecheck and lint passed. Nx Cloud reported its organization is disabled, without failing local targets.

## Decisions

- Chose the existing Lucide `Workflow` icon, already used in chat, for a recognizable compact marker. Reversible by changing the icon binding.
- Reserved 20 px above tagged rail cards so the badge does not reduce the card's content height; moved the action trigger by the same amount. Untagged cards keep their original height and DOM. Reversible by changing the tagged height and offset together.

## Deviations

- No browser visual run was requested or performed. The visual layout is covered by DOM and class assertions and by the project checks.
- Item 5, scrolling after Open beside, was left untouched as requested.

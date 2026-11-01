# B5b A5 parity follow-up

| Parity row               | Implementation file:line                                                                                                            | Spec name                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P17 outcome summary      | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:119-127,193-206`; `libs/frontend/setup-wizard/src/index.ts:20,23-26` | `renders five outcome counters, per-file results, safe failure copy and diverged Library copies` |
| P18 grade expectation    | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:129`; `libs/frontend/setup-wizard/src/index.ts:21`                   | `shows grade expectation for a written result and stale notice only after a failed Library pass` |
| P19 Library-stale notice | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:130`; `libs/frontend/setup-wizard/src/index.ts:22`                   | `shows grade expectation for a written result and stale notice only after a failed Library pass` |
| P22 close message        | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:285-288`                                                             | `posts SETUP_WIZARD_COMPLETE when Open chat is clicked`                                          |

## Deleted files

- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion.component.spec.ts`

After deletion, `rg` found no `CompletionComponent` or `completion.component` references in setup-wizard, onboarding, webview, or Electron TypeScript source.

## Decisions

- A5 uses the bound terminal agent run's `result.agentOutcomes`, `target`, `libraryPass`, and `libraryDiverged`. This is the same result fact source specified for the P22 move; the legacy `CompletionData.result` contract and handler remain in place.
- The existing outcome component supplies the five counters, file list, safe failure copy, opened-folder notice, and diverged Library action. A5 maps `rejected` to failed and omits `skipped`, matching the A3 bound-result mapping.
- Grade and stale Library copy are gated by the existing `libraryReachable` rule for Electron and the harness root. A5 keeps its existing layout and theme-token classes. The Open chat host message was already present.
- The done capture fixture now has one written, one kept, and one failed file, plus a failed Library pass. The capture scrolls the outcome section into view before the shot. The fixture was not run.
- The local `.claude/skills/angular-frontend-patterns/SKILL.md` was read; the connected skill catalog did not return the skill. The Ptah dependency index was incomplete, so the caller check used `rg` as fallback.

## Not done

- No rendered visual review or capture was run because this task expressly forbids launching the app or Playwright. Thus visual fidelity against the approved §13 reference was not checked by screenshot; source uses the existing A5 `data-glass-surface="content"` wrapper and base/state tokens.

## Verification

1. `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard,@ptah-extension/webview-e2e-harness` — exit 0; `NX   8 tasks: 8 succeeded`.
2. `npm run verify -- -t typecheck -p ptah-extension-webview,ptah-electron` — exit 0; `NX   2 tasks: 2 succeeded`.

`npx prettier --write` was run twice on every changed source and this report; the second source pass was unchanged. `git diff --check` found no whitespace errors in the scoped source files.

# CI fix 2 report

## Command Center unit failures

- **Root cause:** The Electron-only `VSCodeService` override supplied `isElectron` but omitted `getState` and `setState`. Mounting the shared display dock now instantiates persisted-state consumers; `ThemeService` and `GitReviewService` call `this.vscode.getState`.
- **Change:** `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:1426` supplies `getState` (returning `null`) and `setState` Jest doubles. All five existing dock assertions remain.

## Electron file-link e2e failure

- **Root cause:** The test expected a markdown link in the review shell spot editor, while this task routes markdown files to the display panel. The `.ts` link still routes to git review.
- **Change:** `apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:133` retains the code-file spot-editor checks. At lines 247–265, the markdown click now checks the docked display region, selected `readme.md` tab, rendered markdown content, and unchanged window URL. The HTTP-link and reload checks remain. A search of the other Electron e2e specs found no other chat-link case for `.md`, `.png`, or `.pdf`; `file-view-tab.spec.ts` tests the review shell directly.

## Verification

- Reviewed the display sheet, display panel, file viewer, and file-link router selectors and routing.
- Scoped `ptah_get_diagnostics` was requested for both changed specs, but the TypeScript compiler had not completed within its 45-second window; it reported both files unchecked. Tests were not run because this sandbox blocks process spawn and the task delegates execution to CI.

## Decisions

- Reused the minimal `VSCodeService` state-method mock pattern already present in frontend specs. This is reversible and keeps the production behavior intact.

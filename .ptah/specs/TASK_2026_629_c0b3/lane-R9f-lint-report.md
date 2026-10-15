# R9f canvas transcript spec lint repair

## Nine lint errors and fixes

| Original line | Error | Fix |
| --- | --- | --- |
| 4 | `@angular-eslint/component-selector` on third-party `markdown` stub | Added the repository's one-line selector rule disable immediately above its decorator, matching `settings.component.spec.ts`. |
| 13 | `@nx/enforce-module-boundaries` for `ActionBannerService` | Import from public `@ptah-extension/chat`. |
| 14 | Same for `ChatStore` | Import from public `@ptah-extension/chat`. |
| 15 | Same for `SessionHistoryReplayer` | Removed the override and internal import; ChatView uses the real root service. |
| 16 | Same for `HistoryPagingService` | Removed the override and internal import; ChatView uses the real root service. |
| 17 | Same for `DisplayDockState` | Reach its write side through the public `PTAH_UI_DISPLAY_DOCK_SYNC` token from the real ChatView child injector. The test uses a narrow structural extension for `setLiveTurn`. |
| 18 | Same for `ChangeSetActionsService` | Import from public `@ptah-extension/chat`. |
| 19 | Same for `DisplayDockComponent` | Resolve the real dock component by `ptah-display-dock` selector from ChatView's Angular component imports; keep it mounted under the Rail child injector. |
| 20 | Same for `AgentMonitorPanelComponent` | Resolve by `ptah-agent-monitor-panel` selector from the dock's Angular component imports, then replace it with the local stub in the focused test. |

The focused Rail case still mounts a real `ChatViewComponent` and real dock, asserts exactly one `ptah-display-dock`, and checks that the same panel instance receives the updated surface across visibility changes. Eight cases remain.

## Verification

- `node .ptah/tmp/check-run.mjs r9f-lint-spec -- npx nx test @ptah-extension/canvas --testFile=canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 8 passed, 8 total`.
- `node .ptah/tmp/check-run.mjs r9f-lint-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: `✖ 17 problems (0 errors, 17 warnings)`; `NX Successfully ran target lint for project @ptah-extension/canvas`.
- Scoped TypeScript diagnostics: no diagnostics in the changed spec. The diagnostic tool reported seven errors in other project files; no typecheck target was run, as instructed.

## Decisions

- Changed only the assigned spec and this report. No chat exports, lint configuration, or cross-library relative imports were added.
- The selector lookup uses Angular's `ɵcmp.dependencies` metadata, which may be an array or a factory in this test environment. This keeps the real dock while preserving the shallow test setup. It is coupled to Angular's internal metadata and should be reconsidered if Angular changes that representation.
- The two history services run with their real implementations. Existing public `ClaudeRpcService` and `VSCodeService` stubs bound their external behavior; the focused case passes.

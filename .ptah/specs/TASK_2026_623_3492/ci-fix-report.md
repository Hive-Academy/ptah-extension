# CI fix report — PR #704

## Jest: chat `FILE_LINK_OPENER`

Root cause: the real execution-node tree reaches `ToolCallHeaderComponent`, whose required `FILE_LINK_OPENER` token was absent from the affected agent-card and execution-node test beds.

Changed: the six affected chat specs provide `{ open: jest.fn() }` for `FILE_LINK_OPENER`.

Focused chat regression tests previously passed: 2 suites, 31 tests.

## Degradation audit

Root cause: `errorName` deliberately handles hostile thrown values and returns a safe literal. Production lookup/build paths log through the injected logger and throw an unavailable error.

Changed: `lane-plan-limits-rpc.handlers.ts` documents the intentional defensive literal fallback with the audit's `optional-capability` suppression. The baseline was not raised.

Previously verified: degradation audit passed with `libs/backend/rpc-handlers: 1 ok (baseline 1)`.

## Sonar new-code findings

Changed:

- Lane-limit sorting uses `localeCompare`.
- Parser header recognition uses bounded string scanning in place of super-linear regexes.
- The display-dock resize separator is a semantic native button.
- Global replacements use `replaceAll`; identifier hashing uses `codePointAt`.

Previously focused checks passed: shared parser (177 tests), chat-ui (164 tests), and dashboard avatar (5 tests).

## Electron turn summary chip (TASK_2026_623)

The transcript was restored to its approved behavior: in Electron, the turn summary chip replaces the change-set card (decisions #5, #10, and #106). No change-set card is rendered in Electron.

Changed Electron E2E specifications:

- `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts` now verifies that the two-file turn yields a `chat-turn-summary` chip with the stable `2 files` metric, persists after reopening, and has no critical/serious Axe violations when collapsed and expanded in both themes.
- `apps/ptah-electron-e2e/src/specs/git/visual-review.spec.ts` now captures the collapsed and expanded turn summary chip instead of the removed Electron card.

The E2E suite was intentionally not run.

## Lint warning review

Chat lint remains at 35 warnings. The apparent increment is the unused `Gauge` import at `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:16`; that file is unchanged by this CI-fix work, so no unrelated edit was made. Chat lint has no errors.

## Final verification

All commands were run serially (`--parallel=1`):

- `nx typecheck @ptah-extension/chat`: passed.
- `nx typecheck @ptah-extension/chat-ui`: passed.
- `nx typecheck @ptah-extension/shared`: passed.
- `nx typecheck @ptah-extension/declarative-dashboard`: passed.
- `nx typecheck @ptah-extension/rpc-handlers`: passed.
- `nx lint @ptah-extension/chat`: passed; 35 existing warnings, 0 errors.
- `nx lint ptah-electron-e2e`: passed; 15 existing warnings, 0 errors.

Nx emitted its unrelated disabled-Nx-Cloud notice after successful targets.

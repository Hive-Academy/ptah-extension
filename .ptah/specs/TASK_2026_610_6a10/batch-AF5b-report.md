## DevOps change — `TASK_2026_610_6a10`, batch AF5b

**Scope**: eager-closure build gate and the chat review-dock Jest spec.

**Files**:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\eager-closure-gate.js` — rejects stats that do not contain the required `main.js` output.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\apps\ptah-electron\src\config\eager-closure-gate.spec.ts` — adds the renamed-entry/no-`main.js` synthetic failure case.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\components\templates\electron-shell.review-dock.spec.ts` — stubs the unused lazy `ptah-ui` entry and gives only the cold dock-mount test a 20-second budget.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\batch-AF5b-report.md` — this evidence report.

**Surface observed**: `package.json` defines `gate:eager-closure`, which invokes `scripts/eager-closure-gate.js` against `dist/apps/ptah-extension-webview/stats.json`. Chat tests use `libs/frontend/chat/jest.config.ts`; the Electron gate spec uses `apps/ptah-electron/jest.config.ts`. `batches.md` assigns AF5 as file-disjoint hardening work.

**Triggers affected**: none. This changes local/CI verification behavior only; it adds no publish, release, deployment, secret, or branch trigger.

**Gate change**: `assertNoForbiddenEager` now throws `[eager-closure-gate] stats output is missing required main.js entry.` before calculating the eager closure. Consequently the CLI gate exits 1 for malformed or renamed-entry stats instead of silently accepting an empty closure.

**Flake root cause and fix**: importing `ElectronShellComponent` reaches the shell's transitive `execution-node` dependency. That component references `@ptah-extension/chat-ui/ptah-ui` for a deferred template, and its cold graph load/compile can exceed Jest's default five-second hook limit under the full suite. The spec now mocks that unused entry with a minimal standalone `PtahUiMessageTextComponent` stub. The shell compile was still slow enough under full-suite load, so fixture creation was moved into the individual tests and only the cold dock-mount test receives the justified 20-second timeout. Its assertions are unchanged.

**Verification**:

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts` — PASS: 1/1 suite, 6/6 tests, 0 snapshots (4.46 s).
- `npm run gate:eager-closure` — PASS: 720 eager inputs; 2,848,414 initial-chunk bytes.
- `npx jest -c libs/frontend/chat/jest.config.ts --testPathPatterns electron-shell.review-dock` — PASS: 1/1 suite, 2/2 tests, 0 snapshots (24.599 s).
- First required cold full run, before the fixture-timeout correction — FAIL as reproduced: 163/164 suites passed; 3,006/3,009 tests passed; 2 skipped; review-dock timed out in `beforeEach` at five seconds.
- Final `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --skip-nx-cache` — PASS: Nx reported 1 successful target task, cache skipped, duration 1m45s. Nx suppressed Jest's per-suite/test counts in its non-verbose successful output, so no unobserved counts are reported.

**Rollback**: revert the three modified source/spec files. The gate then resumes its prior behavior for missing `main.js`, and the review-dock test returns to its original module graph and timeout behavior.

**Secrets or variables required**: none.

**Out-of-scope observations**: the scoped diagnostics service did not complete within 45 seconds and returned all three edited files as unchecked; the passing Jest/Nx checks above supplied executable verification instead. No unrelated files were touched.

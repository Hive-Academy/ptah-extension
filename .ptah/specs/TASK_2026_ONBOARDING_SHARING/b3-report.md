# B3 frontend implementation report

## Files changed

- `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` and `.spec.ts`: added `getAnalysisStatus()` and its RPC behavior test.
- `libs/frontend/onboarding/src/lib/home/analysis-found-card.component.ts` and `.spec.ts`: status card, Use it, Re-run, sharing hint, relative age buckets and focused tests.
- `libs/frontend/onboarding/src/lib/shell/onboarding-workspace.store.ts` and `.spec.ts`, `workspace-header.component.ts`: Electron folder list and actions, active-path reset effect, and store/header tests.
- `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts` and `.spec.ts`: mounted header/card, added the Analyze another project action, and refreshes resume actions on folder switch.
- `libs/frontend/onboarding/src/lib/home/onboarding-resume.store.ts`: clears prior-folder resume actions while the new folder is queried.
- `libs/frontend/onboarding/src/lib/shell/onboarding-shell.component.ts` and `.spec.ts`: shows a read-only workspace header in running flows.
- `libs/frontend/onboarding/src/lib/analyze/analysis-step.store.ts` and `.spec.ts`: loads a known slug directly, resets workspace-scoped analysis state, and discards pending results from the previous folder.
- `libs/frontend/onboarding/src/lib/proposal/new-project-intake.page.ts` and `.spec.ts`: entry header, workspace emptiness check and confirmation, including switch-aware recheck and a retry when the check fails. Submission waits for a successful check.
- `libs/frontend/onboarding/src/lib/proposal/team-builder-start.page.ts`: entry header.
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts` and `.spec.ts`: Electron Open folder uses `ElectronLayoutService.addFolder()`; VS Code keeps its command.
- `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.spec.ts`: added the required `workspaceEffectivelyEmpty` response fixture.
- `libs/frontend/chat/src/lib/services/composer-attachments.service.ts` and `.spec.ts`: file drops always prevent the browser default; pure text drops pass through. The new spec asserts `defaultPrevented` for a PDF.

## Verification

- `npm run verify -- -t test,typecheck -p @ptah-extension/onboarding,@ptah-extension/setup-wizard,@ptah-extension/chat-ui` — final run: `NX   6 tasks: 6 succeeded, 4 cached`. An intermediate run failed: `NX   6 tasks: 5 succeeded, 4 cached, 1 failed` because two intake specs submitted before the new folder check resolved. The specs now await that check, and the final run passed.
- `npm run verify -- -t typecheck -p @ptah-extension/chat,ptah-extension-webview` — final run: `NX   2 tasks: 2 succeeded, 1 cached`.
- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns=composer-attachments.service.spec.ts` — `NX   1 task: 1 succeeded`.
- `npm run verify -- -t lint -p degradation-audit` — `NX   1 task: 1 succeeded`.
- `git diff --check` — clean.

## Decisions

- The root `angular-frontend-patterns` skill search returned zero catalog results. The repository copy at `apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-frontend-patterns/SKILL.md` was read and applied.
- The current branch and worktree were already supplied, with B1/B2 edits present. No git state-changing command was used.
- Folder creation uses the host's `workspace:addFolder` picker, which B1 configured with `createDirectory`; cancellation leaves the active folder unchanged.
- The onboarding reset watches the active workspace path and calls `AnalysisStepStore.resetForWorkspace()` and `SetupWizardStateService.reset()`. The first-run flag remains global.
- The age color is informational, separate from backend freshness. The card uses semantic success/warning/error tokens and explicit text.
- Independent Codex review found an analysis load race, a pending intake check bypass, and stale resume actions after switching folders. These were fixed. A fourth finding about folder-picker error propagation is listed below.

## Not done

- The non-blocking CLAUDE.md linking failure note cannot be displayed from the current B1 contract: `wizard:load-analysis` logs `linked.error` in `setup-rpc.handlers.ts` but returns only `MultiPhaseAnalysisResponse`, with no link-error field. Backend and shared-library changes were out of scope.
- No Electron visual review was possible without launching an application target; the user explicitly limited verification to the listed commands. UI behavior is covered by component tests, but visual quality was not assessed from a rendered Electron screen.
- `ptah_get_diagnostics` was attempted on changed files; its TypeScript service timed out. The scoped Angular/Nx typechecks above passed.
- `ElectronLayoutService.addFolder()` catches and logs picker failures instead of reporting them to callers. The Home Open folder action now uses that service, but a picker failure cannot display the existing Home error message without changing the shared Electron layout service contract.

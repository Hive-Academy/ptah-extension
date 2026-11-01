# B3 revision R1 report

## Defect fixes

1. **Switch race.** `ElectronLayoutService` now exposes `workspaceSwitchPending` from the optimistic switch through completion of the debounced backend switch (`libs/frontend/core/src/lib/services/electron-layout.service.ts:102,147,537,597`). `OnboardingWorkspaceStore.readyForActivePath` also requires `workspaceResolved` (`libs/frontend/onboarding/src/lib/shell/onboarding-workspace.store.ts:26`). The card clears its old result on switch, waits for readiness, and accepts a response only when its request token and workspace path still match (`libs/frontend/onboarding/src/lib/home/analysis-found-card.component.ts:74-103`). Use it is guarded by the same readiness/token check (`:113-127`). Home clears resume actions during the switch and refreshes after settlement (`libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts:420-427`; `onboarding-resume.store.ts:34`). Specs: card's delayed A→B switch and late A result (`analysis-found-card.component.spec.ts:68`), workspace readiness (`onboarding-workspace.store.spec.ts:61`), Home resume gate (`onboarding-home.component.spec.ts:143`), and pending resume invalidation (`onboarding-resume.store.spec.ts`).
2. **Status RPC failure.** The card displays a fixed-copy alert with a Retry button and logs the failure through `LoggingService` (`analysis-found-card.component.ts:51-55,86-99,105-110`). The catch has a truthful degradation-audit marker. Spec: `analysis-found-card.component.spec.ts:93` checks the alert, retry, and log without exposing the raw error.
3. **State on folder switch.** The card resets loaded status, load error, unavailable state, and busy state whenever path/readiness changes (`analysis-found-card.component.ts:74-83`). Spec: `analysis-found-card.component.spec.ts:109` checks that a prior load failure disappears after switching; the late-response spec at `:68` checks the old status is discarded.
4. **Picker failures.** `addFolder()` returns `added | cancelled | failed`, including RPC failure, `data.error`, and thrown failures (`electron-layout.service.ts:71,362-403`). Onboarding and Home show a fixed-copy folder error for `failed` (`onboarding-workspace.store.ts:47-67`; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts:207-221`). Existing callers can ignore the return value. The Home catch marker now describes its actual behavior. Specs: `electron-layout.service.spec.ts:1779,1791,1840,1850`, `onboarding-workspace.store.spec.ts:71`, and `setup-status.store.spec.ts:302`.
5. **Distinct folder dialogs.** The header's Open and New actions (`workspace-header.component.ts:20-21`) pass `open` and `create` through the onboarding store (`onboarding-workspace.store.ts:47-60`) and Electron layout service (`electron-layout.service.ts:362-367`). The backend uses a plain `openDirectory` picker titled `Open Folder` for `open`, and a `createDirectory` picker titled `Create or choose an empty folder` for `create` (`libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts:209-224`). Specs: `onboarding-workspace.store.spec.ts:43,53`, `electron-layout.service.spec.ts:1792`, and `workspace-rpc.handlers.spec.ts:189,199`.
6. **Visible age guidance.** Warning and error ages append `· consider re-running` in visible text; the semantic color and screen-reader label remain (`analysis-found-card.component.ts:36-39`). Spec: `analysis-found-card.component.spec.ts:14` and the card age rendering assertions.
7. **Fresh Re-run.** Re-run clears selection and passes a one-time `rerun=1` intent (`analysis-found-card.component.ts:130-134`). The analyze page starts a fresh run before clearing that intent and skips the resumable saved run (`libs/frontend/onboarding/src/lib/analyze/analyze-workspace.page.ts:323-338`). Specs: `analysis-found-card.component.spec.ts:109` and `analyze-workspace.page.spec.ts:55`.

## Contract changes

- `workspace:addFolder` now accepts `{ mode?: 'open' | 'create' }` (`libs/shared/src/lib/types/rpc.types.ts:1763-1765`). An absent mode preserves the prior create-enabled dialog and `Add Workspace Folder` title. The handler also accepts an absent params object at runtime (`workspace-rpc.handlers.ts:209-224`). Spec: `workspace-rpc.handlers.spec.ts:173` tests both `{}` and `undefined`.
- `ElectronLayoutService.addFolder(mode?)` sends `{}` when its argument is absent, preserving existing callers (`electron-layout.service.ts:362-367`). Spec: `electron-layout.service.spec.ts:1779,1792`.

## Verification

- `npm run verify -- -t test,typecheck -p @ptah-extension/onboarding,@ptah-extension/setup-wizard,@ptah-extension/chat-ui,@ptah-extension/core,@ptah-extension/rpc-handlers,@ptah-extension/shared` → `NX   12 tasks: 12 succeeded, 8 cached` (final run). The first run reported `NX   12 tasks: 11 succeeded, 1 failed` because a new core spec assumed the picker RPC was the first call; setup calls `workspace:getInfo` first. The assertion was corrected and the same scope passed.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode` → `NX   2 tasks: 2 succeeded`.
- `npm run verify -- -t typecheck -p ptah-extension-webview` → `NX   1 task: 1 succeeded`.
- `npm run verify -- -t lint -p degradation-audit` → `NX   1 task: 1 succeeded`.
- `git diff --check` → no whitespace errors.

## Decisions

- Kept the existing VS Code folder command path; the new picker outcome is consumed only in Electron branches.
- The coordinator authorized a minimal shared/backend contract extension for defect 5. Kept absent-mode behavior byte-for-byte equivalent at the picker boundary.
- Used the existing independent B3 code logic review for this revision. An additional read-only reviewer was attempted but timed out before its tool handshake, so it produced no findings.
- No rendered UI screenshot was taken: the task prohibits build, serve, dev, and browser targets. Scoped unit/type checks and static template inspection are the available evidence.

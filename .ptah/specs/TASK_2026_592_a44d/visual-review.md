# Visual Review - TASK_2026_592_a44d

Disclosure: same-side review. The reviewer is a subagent in the same orchestration as the implementers. It was chosen because it is the only image-capable reviewer. It did not edit production code.

## Summary

| Metric            | Value                                                  |
| ----------------- | ------------------------------------------------------ |
| Overall score     | 8/10                                                   |
| Assessment        | APPROVED (Part A PASS; Part B not run, see below)      |
| Visual breaking   | 0                                                      |
| Serious           | 0                                                      |
| Moderate          | 1 (dialog text is long; low-contrast panel, see below) |
| Viewports tested  | 1 (1100x700, Chromium)                                 |
| Screenshots taken | 16 (kept; 4 combos x before/after x 2 shots)           |
| Components tested | 1 (tab close confirm dialog)                           |

## Environment

- Head build: `npx nx build ptah-extension-webview --configuration=development --skip-nx-cache` in the worktree (head c01099880 plus the worktree's uncommitted batch work). It printed "Successfully ran target build". Served from `dist/apps/ptah-extension-webview/browser` through the harness `startFixtureServer({rootDir})`.
- Base build: the same command in a temporary detached worktree at 95cb1de78 (node_modules junction). It printed "Successfully ran target build". The temporary worktree was removed afterwards and `git worktree prune` was run; no `tmp-592` entry remains. The main node_modules was untouched (junction removed with `rmdir`).
- Harness: Playwright (chromium, `--workers=2`), harness helpers `installCspStub`, `installPostMessageBridge`, `installRpcAutoResponder` (mocked RPC, empty fixtures), VS Code host config (`ptahConfig.isVSCode`).
- Tab seeding: the dev build exposes Angular's `ng` debug API. The spec read `TabManagerService` off the `ptah-tab-bar` component, called `openSessionTab('sess-aaaa', 'Refactor auth module')`, then forced the status to `sleeping` or `awaiting-background` with the private `updateTabInternal`. `applyTurnState` alone left the tab at `loaded` in this harness (no workspace path), which is a harness limitation, not an app defect. A second tab ("Other chat") was created so closing the first leaves a tab behind. The app starts in Canvas layout; the spec toggled to single mode via `toggleLayoutMode()` so the tab bar renders.
- Themes: `data-theme` observed as `anubis` (dark) and `anubis-light` (light).
- Viewport: 1100x700 only. This is an audit selection, not a support contract. No responsive sweep was done because the change is a message string on an existing dialog.
- D: free space before start: 48.8 GB (threshold 15 GB).
- Temporary spec/config: written under `e2e-tmp/` in the task folder, then deleted. A copy was kept OUTSIDE the repo at `C:\Users\abdal\AppData\Local\Temp\...` via git-bash `/tmp/e2e-keep` (`close-tab.e2e.spec.mts`, `playwright.config.ts`). Nothing new is in the committed tree. Note: an earlier `e2e-tmp/package.json` briefly broke the Nx project graph, as reported by the coordinator. It was removed at once; the spec was switched to `.mts`.

## Part A: before/after screenshots

All images are in `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\.ptah\specs\TASK_2026_592_a44d\screenshots\`. In each pair, `-1-before-close` is the tab bar with the background tab hovered, and `-2-after-click-close` is the state after clicking the tab's "Close tab" button.

AFTER (this worktree, expected: the confirm dialog with the new text, tab kept):
- `after-dark-sleeping-2-after-click-close.png` - anubis, sleeping tab: "Close Tab?" dialog with the new text, tab still open.
- `after-dark-awaiting-background-2-after-click-close.png` - anubis, awaiting-background tab: same dialog.
- `after-light-sleeping-2-after-click-close.png` - anubis-light, sleeping tab: same dialog.
- `after-light-awaiting-background-2-after-click-close.png` - anubis-light, awaiting-background tab: same dialog (viewed; dialog is clear, red "Close" button, "Keep Open" secondary).
- `after-*-1-before-close.png` (4 files) - pre-click state of each combination.

BEFORE (base 95cb1de78, expected: tab closes at once, no dialog):
- `before-dark-sleeping-2-after-click-close.png`, `before-dark-awaiting-background-2-after-click-close.png`, `before-light-sleeping-2-after-click-close.png`, `before-light-awaiting-background-2-after-click-close.png` - the "Refactor auth module" tab is gone, only "Other chat" remains, no dialog (viewed the light/sleeping one).
- `before-*-1-before-close.png` (4 files) - pre-click state.

Measured results (from the spec's console output):

| Build  | Theme | Status               | "Close Tab?" shown | New message shown | Tabs left |
| ------ | ----- | -------------------- | ------------------ | ----------------- | --------- |
| base   | dark  | sleeping             | no (0)             | no                | 1         |
| base   | dark  | awaiting-background  | no (0)             | no                | 1         |
| base   | light | sleeping             | no (0)             | no                | 1         |
| base   | light | awaiting-background  | no (0)             | no                | 1         |
| head   | dark  | sleeping             | yes (1)            | yes               | 2         |
| head   | dark  | awaiting-background  | yes (1)            | yes               | 2         |
| head   | light | sleeping             | yes (1)            | yes               | 2         |
| head   | light | awaiting-background  | yes (1)            | yes               | 2         |

Dialog text observed: "Close Tab? / This session has unsaved changes, is streaming, or has background work running. Closing it ends the session. Close anyway?" with "Keep Open" and a red "Close" button. This matches the contract in `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`needsConfirmation`).

**Part A verdict: PASS.** Before: no dialog and the tab closes. After: dialog with the new text and the tab stays open until confirmed, in both themes and for both statuses.

Not covered: the confirm path (clicking "Close") and the cancel path (clicking "Keep Open") were not clicked. Those are covered by the unit tests in `tab-manager.lifecycle.spec.ts` (batch-1-report.md). The `chat:abort` message sent on confirm was not asserted in the browser because the RPC is mocked.

## Findings

### Visual breaking
None.

### Serious
None.

### Moderate and minor
1. Moderate, dialog copy length. The new message is three lines in a ~360px-wide box. It reads well, but it is generic for the four cases (unsaved, streaming, background, sleeping). A user closing a sleeping tab is told "is streaming", which may confuse. File: `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`needsConfirmation` message). Screenshot: `after-dark-sleeping-2-after-click-close.png`. Suggest a status-specific message, or leave it; this is a copy choice, not a defect.
2. Observed, pre-existing, not from this change: at 1100px the second tab is clipped to "Oth" because the tab strip shares the toolbar row with the nav (`after-dark-sleeping-2-after-click-close.png`). Also the Thoth hint toast overlaps the tab bar's left area. Both are visible in the base screenshots too.

## Prototype fidelity

- Approved prototype: None for this task (no new surface; the change is the text of an existing confirm).
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype): the 8 before/after pairs above (dark and light, both statuses). Result: the dialog primitive, title, labels ("Keep Open" / "Close") and error-style confirm button are unchanged from the existing `ConfirmationDialogService` look; only the body text changed. No visual regression found.

## Viewport results

| Screen             | Elements checked                      | Status | Screenshot                                         |
| ------------------ | ------------------------------------- | ------ | -------------------------------------------------- |
| 1100x700, anubis   | dialog layout, text fit, buttons      | PASS   | `after-dark-sleeping-2-after-click-close.png`      |
| 1100x700, light    | dialog layout, text fit, buttons      | PASS   | `after-light-awaiting-background-2-after-click-close.png` |

Other widths (for example 400px) were not opened and are not reported as passing.

## Component and interaction results

| Component              | States tested                                              | Status | Screenshot |
| ---------------------- | ---------------------------------------------------------- | ------ | ---------- |
| Close Tab confirm      | open on sleeping, open on awaiting-background, both themes | PASS   | `after-*-2-after-click-close.png` |
| Tab close (base build) | closes with no prompt (expected "before")                  | PASS   | `before-*-2-after-click-close.png` |
| Confirm / cancel click | not exercised in the browser                               | N/A    | none (unit-tested) |

## Design system compliance

No custom styles were added. The dialog uses the existing themed modal; colours come from the theme (dark: near-black panel, red `Close`; light: off-white panel, pink-red `Close`). No hex literals were reviewed in source because no styles changed.

## Accessibility audit

Not measured with computed contrast or target-size probes; the change is text-only. Visual check only: in the light theme the body text is a muted grey-mauve on off-white and looks lower in contrast than the title. Treat as an unmeasured observation; it is existing styling. Focus order inside the dialog was not tested.

## Visual performance

No layout shift or animation was observed in the captured states. Not measured further.

## Part B: runtime claude.exe check

**Result: SKIPPED. Isolation is not fully possible from here, so nothing was run.** No Ptah.exe or claude.exe process was started, signalled or attached to.

Findings from `apps/ptah-electron/src/main.ts:52-58`:
- A dev run (`NODE_ENV=development`) sets userData to `%APPDATA%\Ptah Dev`, so its single-instance lock is separate from the real `Ptah` profile. A `--user-data-dir=<dir>` flag is also used by the showcase harness (`apps/ptah-electron-e2e/src/showcase/_harness/showcase-launcher.ts:129-132`, `PTAH_SHOWCASE_USER_DATA_DIR`).
- That isolates only the Electron profile. The Claude CLI children still read the user's global `~/.claude` credentials, and `~/.ptah` state is shared. A real message in the dev app would use the user's Claude login and write to those shared directories. `%APPDATA%\Ptah Dev` already exists and was not inspected.
- The Electron main was not built in this worktree, and a license/auth gate in a fresh profile was not checked. I judged the risk to the user's live sessions and credentials higher than the value of the check, so I stopped.

Manual steps for the user (use a throwaway profile and a separate workspace; do not touch the real Ptah.exe):
1. Build and launch a dev instance with an isolated profile, for example from the worktree: `$env:PTAH_SHOWCASE_USER_DATA_DIR='C:\Temp\ptah-592-profile'` then start the Electron dev target with `--user-data-dir=C:\Temp\ptah-592-profile`. Note its PID (the new Electron main PID).
2. List the dev app's claude.exe children before any action:
   `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object ParentProcessId -eq <DEV_PID> | Select ProcessId,ParentProcessId,CreationDate`
3. In tab A send one tiny message ("hi") and wait for idle. Re-run the command from step 2 and note the PID. Close tab A (X button; an idle tab closes with no dialog). Within about 10 s re-run the command. Expected: that PID is gone.
4. Open two workspace folders, each with one idle session (one tiny message each). Record the PIDs. Switch between the workspaces a few times. Re-run the command. Expected: both PIDs still present (switch must not end sessions).
5. For a sleeping or awaiting-background tab: closing it must show the "Close Tab?" dialog; confirming should end its claude.exe within about 10 s.
6. Stop only the dev instance (`Stop-Process -Id <DEV_PID>`), never the real Ptah.exe.

## Verdict

- Recommendation: APPROVE (Part A). Part B remains open and needs the manual run above.
- Confidence: MEDIUM. The dialog and no-dialog behaviour are proven at 1100px in two themes and two statuses. The runtime end-of-session behaviour (`chat:abort` reaching claude.exe) is not proven here.
- Key concern: Part B not executed; claude.exe exit on close is only covered by unit tests so far.

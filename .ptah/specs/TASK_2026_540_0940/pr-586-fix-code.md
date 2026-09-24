# PR 586 — review-fix report (4 findings)

Branch/worktree: `feat/task-540-global-config-menu` (`.claude-worktrees/feat-task-540-global-config-menu`), 2026-09-24.
Scope: exactly the 6 permitted files. Nothing committed.

---

## Fix 1 — CI failure (electron-e2e job): focus race in keyboard spec

**File:** `apps/ptah-electron-e2e/src/specs/config-menu/config-menu-keyboard.spec.ts:85-88` (inserted after the `await trigger.click();` at line 84)

**Diff (one-line summary):** added `await expect(page.locator('[data-test="config-menu-item-thoth"]')).toBeFocused();` (plus a 3-line why-comment) between the trigger click and the first `ArrowDown` press, so the keydown only fires after the menu's async first-item focus landed — the same pattern the first test in the file already uses at lines 34-35.

Test-only change; no production code touched.

## Fix 2 — CodeRabbit: no-workspace content gate could overflow the window

**File:** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:213`

**Diff (one-line summary):** `<div class="h-full w-full"><router-outlet /></div>` → `<div class="flex-1 min-h-0 overflow-hidden"><router-outlet /></div>` — the wrapper now sizes like its sibling branches (welcome branch `flex-1`, workspace branch `flex flex-1 overflow-hidden`) instead of being 100% + navbar tall with `min-height:auto`. `w-full` dropped: the root container is `flex flex-col h-screen`, so flex children stretch across the cross axis anyway. Nothing else in the template changed.

**config-gate spec check (as instructed):** `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts` does **not** assert the old class string — a grep for `h-full w-full` across the templates dir finds no match in that file; it only asserts `router-outlet` presence/absence (lines 113, 164, 190, 257, 267, 301). No edit needed (and that file was not on the editable list). The chat Jest suite, which includes that spec, passed after the change.

## Fix 3 — SonarCloud: `moveFocus` (S7753 findIndex→indexOf, S3358 nested ternary)

**File:** `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts:138-146`

**Diff (one-line summary):**
- (a) `buttons.findIndex((button) => button === panel.ownerDocument.activeElement)` → `buttons.indexOf(panel.ownerDocument.activeElement as HTMLButtonElement)` — no `as any`, no new suppression.
- (b) the nested ternary for `nextIndex` → `let nextIndex: number;` + `if (currentIndex === -1) { nextIndex = direction === 1 ? 0 : buttons.length - 1; } else { nextIndex = (currentIndex + direction + buttons.length) % buttons.length; }`.

Behaviour identical (wrap-forward/wrap-backward/no-focus cases unchanged); pinned by the chat Jest suite (`global-config-menu.component.spec.ts`), which passed.

## Fix 4 — CodeRabbit: harness rule "one assertion target per spec file"

- **NEW** `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/vscode-host.ts` — `installVSCodeHost(page: Page)` exported, moved verbatim from the old spec's lines 30-56, carrying the HOST CONFIG NOTE (no `isElectron`; `app.html` takes the `ptah-app-shell` branch). It imports only `type { Page }` from `@playwright/test`; `installPostMessageBridge` / `installCspStub` stay imported by the specs from their original `'../../postmessage-bridge'` / `'../../csp-stub'` paths (moving those imports into `vscode-host.ts` would have left two unused imports and failed lint).
- `config-menu-absent.e2e.spec.ts` — rewritten to menu absence only: imports `installVSCodeHost` from `./vscode-host`; still installs the CSP stub + postMessage bridge (app boot needs the `acquireVsCodeApi` stub, and `installVSCodeHost` only injects `ptahConfig` once that stub exists) but no longer binds the now-unused bridge handle; test renamed to "the VS Code shell renders with no configuration menu"; header points at the new sibling spec for navigation.
- **NEW** `switch-view-navigation.e2e.spec.ts` — the SWITCH_VIEW checks (settings + thoth routing, menu still absent after a switch), same `test.use({ useAppBuild: true })`, same imports from `'../../test-fixtures'`, `describe('webview > vscode-shell > switch view navigation')`, short JSDoc header in the existing style.

### Extra bug found and fixed while verifying (must-review)

The SWITCH_VIEW assertions inherited **fabricated selectors** from the original spec: `ptath-settings` and `ptath-thoth-shell` (typo: `ptath`). Those strings exist nowhere in the app — the original spec's navigation half could never have passed against the real bundle (it evidently never ran with one; `useAppBuild` specs need a fresh `nx build ptah-extension-webview`, else the fixture server throws). The first e2e run failed exactly there: Settings content rendered, but the locator matched nothing. Real selectors, confirmed by an exploration pass with file:line evidence:

- `ptah-settings` — `libs/frontend/chat/src/lib/settings/settings.component.ts:62`
- `ptath-thoth-shell` — `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:49`

Fixed `switch-view-navigation.e2e.spec.ts:40,46` to `ptah-app-shell ptah-settings` / `ptah-app-shell ptah-thoth-shell` — the same locator pattern the Electron specs already use (e.g. `config-menu-remount.spec.ts:79,96,124`). Also confirmed the Electron keyboard spec's own `ptah-app-shell ptah-setup-hub` (line 94) is correctly spelled and real (`setup-hub.component.ts:71`), so Fix 1 needed nothing beyond the focus wait.

---

## Verification (tails as requested)

1. `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat --skip-nx-cache` — **PASS** (exit 0)
   `√ nx run @ptah-extension/chat:typecheck` / `√ nx run @ptah-extension/chat:test` / `√ nx run @ptah-extension/chat:lint` — "Successfully ran targets typecheck, lint, test for project @ptah-extension/chat", 1m04s.
2. `npx nx run-many -t typecheck,lint -p ptah-electron-e2e,@ptah-extension/webview-e2e-harness --skip-nx-cache` — **PASS** (exit 0)
   4/4 tasks ✓ ("Successfully ran targets typecheck, lint for 2 projects", 23.7s). Re-run for the harness alone after the final locator typo fix — **PASS** (typecheck+lint ✓, 5.6s), so lint/typecheck cover the exact final file state.
3. `npx nx build ptah-extension-webview` — **PASS** (exit 0)
   "Application bundle generation complete" — output at `dist/apps/ptah-extension-webview` (only the pre-existing 2.5 MB initial-budget warning).
4. `npx nx e2e @ptah-extension/webview-e2e-harness -- src/lib/scenarios/vscode-shell` — **PASS** (exit 0)
   `ok 1 … config-menu-absent.e2e.spec.ts … the VS Code shell renders with no configuration menu (1.5s)` / `ok 2 … switch-view-navigation.e2e.spec.ts … SWITCH_VIEW messages still route to Settings and Thoth (1.6s)` — "2 passed (3.9s)".

The Electron e2e suite was **not** run, per instructions.

## Could not do / deviations

- Nothing skipped. One deviation beyond the letter of Fix 4: correcting the two typo'd locators in the ported SWITCH_VIEW checks (see above) — without it the mandated e2e verification cannot pass, and the original assertions were provably dead (selectors exist nowhere in the repo).
- `electron-shell.config-gate.spec.ts` was checked (Fix 2) and deliberately not edited: it pins `router-outlet` presence, not the wrapper class.

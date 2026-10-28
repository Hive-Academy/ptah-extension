# Visual Review - TASK_2026_719_4f64 (P4)

Verdict: REVISE (score 6.5/10). Visual breaking 0, Serious 1, Moderate 2.

## Environment

- Electron only (per CLAUDE.md). AFTER: worktree `claude-named-accounts`, HEAD cf398919d, rebuilt with `node scripts/verify.mjs --exec --task visual-build-after -- npx nx build ptah-electron` (EXIT 0), then `copy-renderer.js`. BEFORE: worktree `claude-named-accounts-before` at 396f0135b, same commands (EXIT 0). Logs: `screenshots/build-after.log`, `screenshots/build-before.log`.
- Driven by `screenshots/capture.mjs` (Playwright `_electron.launch`, PTAH_E2E=1, temp user-data-dir and PTAH_DB_PATH, `rpc` ipcMain listeners replaced with mocks). No real sign-in, Claude process or credentials. Fake script string and fake profile ids only.
- Window 1400x900 (and 2600x1000 for one lane probe). Themes: dark = `ptah-glass`, light = `ptah-glass-light`, applied via `data-theme` / `data-theme-mode`. Viewport sizes are an audit selection, not a support contract.
- All screenshots are in `.ptah/specs/TASK_2026_719_4f64/screenshots/` as `<before|after>-<screen>-<theme>.png`.

## Per-screen results

| Screen | Before | After | Themes | Findings |
| --- | --- | --- | --- | --- |
| 1 Drawer, sign-in pending, window open | `before-s1-drawer-pending-{dark,light}.png`; text "Waiting for the sign-in outcome." (`before-s1-access-text.txt`) | `after-s1-drawer-pending-{dark,light}.png`; `[data-testid="account-access-detail"]` = "Finish sign-in in the Claude window." (`after-s1-access-text.txt`) | both | Copy matches U2. No layout breakage, no shift, Cancel sign-in unchanged. |
| 2 Drawer, fallback block | none (block absent; `before-s2-drawer-fallback-*.png` shows the plain pending drawer) | `after-s2-drawer-fallback-{dark,light}.png`, `after-s2-focus-copy-{dark,light}.png`, `after-s2-focus-check-status-{dark,light}.png`, `after-s2-focus-after-copy-light.png`, `after-s2-copied-dark.png`, `after-s2-measure.json` | both | `account-fallback` renders script (`pre`, wraps, no horizontal overflow, tabindex=0), "Copy script", "Run it in a new terminal window.", "Check status". Detail line reads "No Claude window could be opened for this sign-in." Copy -> "Script copied." (live region). Buttons 59x32 and 94x32 CSS px (above 24x24 AA). Both new buttons show a clear focus ring in dark and light and are reached by Tab in order Copy, Check status, Cancel. Script colour/background are theme tokens, readable in both themes. Drawer title truncates with ellipsis for the 56-char label. No profile id, email or path in the block (fake script text only). |
| 3 Accounts section | `before-s3-accounts-section-{dark,light}.png`; `routing-held` count 1, text "Named account starts are awaiting release authorization." | `after-s3-accounts-section-{dark,light}.png`, fullpage dark; `routing-held` count 0 | both | Held note removed, text diff confirms only that paragraph is gone. No other change. Long label wraps cleanly. See D2 (profile id shown). |
| 4 Lane card badge | `before-s4-*.png` | `after-s4-lanes-{dark,light}.png`, `after-s4-after-click-dark.png`, `after-s4-wide-dark.png` | both | NOT REACHABLE in Electron. See D1. `span[data-testid="lane-account"]` count 0 for named, default and removed-account lanes. "Default" / "Removed account" / long-label variants could not be rendered. |
| 5 Session list row | `before-s5-session-list-{dark,light}.png` (no account text) | `after-s5-session-list-{dark,light}.png`, `after-s5-session-list-fullpage-dark.png`, `after-s5-geometry.json` | both | Rows read "Account: Work", "Account: Client Acme Corp production research team shared account", "Default", "Removed account", placed after "N msgs". Row height 52px unchanged, no overflow, contrast fine in both themes, no ids rendered. See D3. |

## Defects

### D1 (Serious): the lane account badge never renders on Electron's lane surfaces

- Selector: `span[data-testid="lane-account"]`; source `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts:110-119`.
- Evidence: four live Claude lanes were pushed (`agent-monitor:spawned`) into a session, with a named, a long-label, a default and a removed-account binding. `lane-account` count was 0 and `ptah-agent-card-header` count was 0, at 1400 and at 2600 px wide. Screenshots: `after-s4-after-click-dark.png`, `after-s4-wide-dark.png`.
- Cause: `agent-card.component.ts:67-176` renders `ptah-execution-header` when `presentation === 'flat'`, and `ptah-agent-card-header` only in the card branch (`:176-189`). Electron's canvas lane view (`canvas-lane-view.component.ts:182`, `presentation="flat"`) and the right-hand agents panel tiles use the other renderers. The card branch only appears in the monitor panel's lanes mode, which I could not trigger in Electron.
- Impact: the user-visible U5 outcome (which account a lane runs under) is not visible in the Electron primary surface.
- Fix: also show the account text in the flat `ptah-execution-header` / its Details list, or in the sidebar lane tile, or confirm the card presentation is the intended Electron surface and show how to reach it. The 10rem truncation and title behaviour could not be verified for the same reason.
- Limitation: the unit tests pass on the header alone, so this is a surface-coverage gap, not a header bug.

### D2 (Moderate): profile id is rendered on cards and in the drawer

`acct_work_0001` appears in the accounts card (mono text) and `Work …0001` in the route summary, in both BEFORE and AFTER (`*-accounts-section-text.txt`), and `account-profile-id` is in the drawer Overview tab. The profile id is opaque and pre-existing, not introduced by this task, and none of the new surfaces (pending copy, fallback block, lane badge, session row) render one. Flag only if the "no profile id rendered" rule is meant to cover the Accounts section as well.

### D3 (Moderate): long account label is not capped in the session row

The row label is only `min-w-0 truncate` (no 10rem cap); the 56-char label showed in full on a 700px-wide modal (`after-s5-geometry.json`, `accTruncated: false`). It will truncate with the title tooltip in a narrower modal, which I did not test. The 10rem cap applies to the lane badge only.

## Prototype / before-after

No prototype required (no new surface). Before/after pairs for dark and light exist for screens 1, 2 (before has no fallback), 3, 4 (no difference visible) and 5. No regressions found in the shell, settings page or session modal outside the changed elements.

## Accessibility notes

New buttons: focus ring visible both themes; Tab order correct; targets at least 32px high. Script `pre` is focusable with a label. Copy feedback is a polite live region. Contrast of the new text was judged visually from screenshots, not measured numerically (only script colour/background tokens were read).

## Not checked

- The lane card badge (Default, Removed account, long label truncation at 10rem, title text): not renderable in Electron (D1).
- Numeric contrast ratios, hover and active states, a narrow (about 400px) viewport, reduced motion, and layout shift measured with Performance APIs (only visual comparison).
- Real clipboard contents (the copy success state was observed, the clipboard was not read).
- Real RPC behaviour: all account, session and lane data is mocked.
- The VS Code and TUI hosts (out of scope).

## Verdict

REVISE. Confidence: MEDIUM-HIGH. Key concern: D1, the lane account label does not appear on Electron's lane surfaces.

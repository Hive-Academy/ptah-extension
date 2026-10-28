# Visual Review P5 - TASK_2026_719_4f64 (Accounts tab, detail, add form, Remove modal, "N connected" badge)

## Summary

| Metric            | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Overall score     | 6/10                                                      |
| Assessment        | NEEDS_REVISION requested form: REVISE (rubric strictness: 2 breaking findings = REJECTED at 245 px / 200% zoom only) |
| Visual breaking   | 2                                                         |
| Serious           | 1                                                         |
| Moderate          | 3                                                         |
| Minor             | 0                                                         |
| Viewports tested  | 5 (window/drawer 1400 -> 512 px drawer, 360, 320, 245, 200% zoom at 245 CSS px) x dark + light |
| Screenshots taken | about 190 (`screenshots/p5-*.png`)                        |
| Components tested | Accounts tab, Use-for selects, ambient row, rows, add form, detail (3 tabs), Remove modal, card badge |

Both breaking findings only occur at the narrowest widths (245 px drawer / 200% zoom). 520, 360 and 320 px are clean.

## Environment

- Electron app only, built at `dist/apps/ptah-electron/main.mjs` (worktree HEAD 29ed77782, not rebuilt). Launched by Playwright `_electron` with PTAH_E2E=1, temp user-data-dir and DB, faked RPC in the main process (no sign-in, no Claude process, no credentials). Harness: `screenshots/p5-capture.mjs` (first run), `p5-capture3.mjs` (final, correct drawer root), `p5-capture4.mjs` (overflow probe). Data: results in `screenshots/p5-results*.json`.
- Fake data: ambient connected; Work (signed in), a 56-char label account (not signed in, later cancelled/fallback script), Personal (not signed in).
- Drawer width is 512 px at a 1400 px window (spec says 520). Narrow widths set via BrowserWindow content size (245/320/360); 200% = zoom factor 2 on a 245 CSS px window.
- Theme: `ptah-glass` (dark) and `ptah-glass-light`. Standard applied: WCAG AA (4.5:1 text, 3:1 focus ring/components, 24 px targets).
- Limit: the native `<select>` popup is an OS surface and is not captured by Playwright; option lists were read from the DOM instead.
- Note: first-pass screenshots of the drawer only captured its header (wrong locator); every screenshot cited below comes from the final run.

## Findings by severity

### Visual breaking

#### 1. Account rows collapse at 245 px / 200% zoom (name wraps one character per line, chips overlap)

- File: `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts` (row body, about lines 240-300: `flex flex-1 ... gap-2 items-center`, `flex-wrap: nowrap`, buttons in the same row as the text)
- Viewports affected: 245 px, 200% zoom (245 CSS px). 320 px and wider fine.
- Screenshots: `p5-accounts-list-w245-dark.png`, `p5-accounts-list-w245-light.png`, `p5-accounts-list-zoom200-dark.png`; prototype reference `prototype/p5/sheet5-add-error-remove-reflow.png` (width 245 and 320 reflow).
- Selector: `[data-testid=accounts-tab-row]` / `[data-testid=accounts-tab-row-body]`.
- Measured: for the 56-char label the name element is 37 px wide and 176 px high (row height 244 px); `word-break: normal`, `overflow-wrap: break-word`; text "Client Acme Corp production research team shared acct 56x" renders as "Client / Acme / Corp / produ / ctio...". On "Work" the status line and the two "Used for:" chips overlap each other ("Not signed in" over "Used for: New chats"), shown in `p5-accounts-list-w245-light.png`.
- Problem: Sign in and Manage buttons stay on the same line as the text, leaving about 37-90 px for the name. The prototype stacks the actions below at 245 px.
- Impact: names are unreadable, chips illegible; two accounts cannot be told apart. Violates design-spec "reflows the same way ... no label is truncated".
- Fix: let the row wrap (`flex-wrap`, actions to a second line below ~300 px, `min-w-0` on text); give the name `break-words`. Also add `title` with the full label (none exists today).

#### 2. Account detail view scrolls horizontally and its inner tabs clip at 245 px / 200% zoom

- File: `account-detail-view.component.ts` (inner tab strip: Overview / Access / Profile), drawer body `native-drawer-body`.
- Viewports affected: 245 px, 200% zoom. 320 px fine (tabs 17-294 of 320).
- Screenshots: `p5-ovf-profile-w245-dark.png`, `p5-ovf-profile-zoom200-dark.png`, `p5-x-profile-w245-dark.png`; prototype: `sheet5` state n3 width 245 (inner tabs wrap to two lines, no scroll).
- Measured: `native-drawer-body` scrollWidth 266 vs clientWidth 234 (scrollLeft 32 after focus); detail tabs Overview left -15 px, Profile right 235 of 245. Horizontal scrollbar visible at the bottom of the drawer. At zoom200: 266 vs 239.
- Problem: the three inner tabs do not wrap (min about 280 px), so the body scrolls sideways and the outer tab strip is shifted out of view.
- Impact: horizontal scroll at narrow width, partially off-screen controls.
- Fix: `flex-wrap` on the inner tablist like the outer strip (`[&_[role=tablist]]:flex-wrap`).

### Serious

#### 3. "Use for" block stays above the detail view (prototype replaces the tab body)

- File: `accounts-tab.component.ts` (use-for rendered before the list/detail `@if`, about lines 180-230).
- Viewports affected: all (520, 360, 320, 245).
- Screenshots: `p5-remove-modal-520-dark.png`, `p5-detail-long-w320-dark.png`, `p5-detail-overview-signedin-520-dark.png`; prototype `sheet3-selection-add-remove.png` state rc and `sheet5` state rc/n3 (detail starts directly under the tab strip with "All accounts" back link).
- Measured: "All accounts" back link sits about 400 px below the tab strip at 520 px (y=413 of 835), pushing the detail heading, tabs and actions toward or below the fold; at 320 px the heading is at y=595.
- Impact: the detail view's primary content is far down; the hierarchy differs from approved prototype; on short windows Sign in/Remove need scrolling.
- Fix: hide the Use-for block and Accounts heading while the detail view is open (spec 3.1 / 3.6), keeping the subscription alive as already designed.

### Moderate and minor

- Moderate: after "Check again" the focus lands on the "Checking..." status and shows a wide square focus box that spans past the text (`p5-ambient-checking-520-light.png`, `[data-testid=ambient-status]`). Prototype shows no box. Use `outline-none` on programmatic-only focus targets or move focus back to the button.
- Moderate: chips "Used for: ..." and the card badge "2 connected" use 10 px text (`accounts-tab-row-chip`, `connected-accounts-badge`, `provider-connection-card.component.ts:124`); below the 11-12 px used elsewhere in the drawer. Not an AA failure (no size minimum), reported as guidance.
- Moderate: long labels have no `title` (wrapping used instead of truncation, `longRowTitle.els` empty); with Finding 1 the full text is not recoverable at 245 px by hover either.

## Prototype fidelity

- Approved prototype: `prototype/p5/index.html`, `design-spec-p5.md`, sheets 1-5.
- Fidelity assessment: DEVIATES (Findings 1-3); otherwise MATCHES at 520/360/320.
- Matches: tab order Overview & Used By, Accounts, Credentials, Models & Tiers; Use-for labelled native selects with hints; "Existing Claude login" first row with read-only status and Check again only; named rows with avatar, state dot, chips, Sign in/Manage; inline add form with duplicate-name error and Escape returning focus to "Add another account"; detail inner tabs Overview/Access/Profile (signed-in opens Overview, otherwise Access); fallback script block "Sign in from a terminal" with Copy script; nested Remove modal with Cancel/Remove; outer tab strip wraps instead of truncating (320: second line).
- Before/after: not applicable (prototype exists).

## Viewport results

| Viewport | Screen | Status | Screenshot |
| --- | --- | --- | --- |
| 512 (1400 window) | list, add, detail, modal | PASS (no overflow, doc scrollWidth = clientWidth) | p5-accounts-list-520-dark/light.png |
| 360 | list, add error, detail, modal | PASS (drawer 291 px content, no overflow) | p5-accounts-list-w360-*.png |
| 320 | list, add, detail, modal | PASS (tabs wrap to 2 lines) | p5-accounts-list-w320-dark.png, p5-detail-long-w320-dark.png |
| 245 | list | FAIL Finding 1 | p5-accounts-list-w245-*.png |
| 245 | detail/profile | FAIL Finding 2 | p5-ovf-profile-w245-dark.png |
| 200% zoom (245 CSS) | list, detail | FAIL Findings 1, 2 | p5-accounts-list-zoom200-dark.png |

Remove modal at 245: 235 px wide, no overflow offenders (`p5-x-remove-modal-w245-*.png`).

## Component and interaction results

| Component | States | Status |
| --- | --- | --- |
| Tab strip | order = Overview & Used By, Accounts, Credentials, Models & Tiers; wraps at <=360 | PASS |
| Use-for selects | focus, change by keyboard, option list (named not-signed-in disabled with "(sign in first)") | PASS (popup not capturable) |
| Check again | busy ("Checking...", button disabled/dimmed) | PASS with Moderate focus-box note |
| Add form | empty, duplicate error ("That name is already used..."), valid, Escape -> focus to Add button | PASS |
| Detail | access, fallback script, pending, cancelled, signed in overview, signed out, profile | PASS at >=320 |
| Remove modal | Enter on trigger opens; focus lands on Cancel; Tab cycles Remove/Cancel only (7 Tabs, never leaves); Shift+Tab reverse; Escape closes the modal only, drawer stays open, focus returns to `account-detail-remove` (same trigger); Cancel button also returns focus to the trigger | PASS |
| Card badge | "2 connected" (1 signed-in named + connected ambient) right-aligned in the card footer, left of the status edge, no clipping at 297 px card | PASS (see Moderate for 10 px) |

## Design system compliance

- Focus rings: `outline-2` base-content plus 5 px offset shadow ring; ring contrast measured against the surface: dark 12.98-15.71, light 13.31-15.39 on every Tab stop of the list (all 22 stops, `p5-results3.json` focusList/focusListLight). All controls have a visible ring.
- The measured 2.48:1 for the Remove button ring (dark) and 1.04:1 for "Sign in" are artefacts of my calculation against the button fill (ring sits 2 px off the button on the dialog surface; Sign in uses a gold gradient); visually the ring and the dark-on-gold text are clear (`p5-x-remove-confirm-focus-dark.png`, `p5-accounts-list-520-dark.png`). Not reported as defects.

## Accessibility audit

- Text contrast at 512 px drawer: dark minimum 13.07:1, light minimum 6.49:1 (all text nodes except gradient buttons, disabled "Save name" exempt). Card badge/card text: dark 12.54, light 6.26.
- Targets: no interactive element under 24x24 CSS px (`smallTargets` empty at 512, 360, 320; selects 32 px high).
- Semantics: Accounts tab is a `region`; list `role=list` labelled "Claude accounts"; rows `role=button` with "Account details for <name>"; Remove dialog is a native `<dialog>` with `aria-labelledby` (title "Remove Work?"); heading receives focus when detail opens and "Manage <name>" regains focus on back.
- Live regions (faked RPC, polite `role=status`): "Sign-in started.", "Working...", "Sign-in cancelled.", "Signed out.", toast "New chats will use Work for new sessions.", ambient "Connected". Tree order (`p5-accounts-tab-aria.yml`, `p5-detail-aria.yml`): Use for, selects, Accounts heading, ambient row, named rows, Add button; detail: back, heading, state, tabs, panel, live region.

## Visual performance

- Loading states: "Checking..." visible for a 4 s delayed refresh; no layout shift observed when snapshot arrived. Not otherwise measured.

## Verdict

- Recommendation: REVISE (two breaking defects limited to 245 px / 200% zoom; strict rubric would label REJECTED until fixed)
- Confidence: HIGH for the measured findings, MEDIUM for badge prototype fidelity (no prototype frame for the badge)
- Key concern: rows and detail tabs do not reflow at 245 px / 200% zoom, which the design spec promises explicitly.

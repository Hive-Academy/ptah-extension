# Visual Review - TASK_2026_555 (Settings redesign)

## Providers (Gate V 28)

Reviewer: in-process visual-reviewer subagent. **Same-side disclosure:** the author of Batches 21-28 is an in-process
frontend-developer subagent and this reviewer is also in-process. The cross-side CLI lane (Glm) cannot read images, so
no cross-side visual check exists. Treat this as a same-side review.

Method: static comparison of the Batch 28 captures (1024x768, no harness re-run, no browser session) against
`prototypes/final/screenshots/index-anubis*-1024x768.png` and `interactions/*.png`, in both themes and both hosts, plus
source reading for causes. Two crops were magnified (badge outline) and one pixel sample was taken (muted text in the
light scope popover). No hover/focus states were re-captured. Focus rings were judged only where a capture shows them
(catalog search, outlined buttons in drawers, tab-strip), so keyboard-focus coverage on the page is not re-verified here
(Gate G covers it).

Sources of expectation: the approved prototype, design-spec deviation 6 (colour only on icons, dots and badges; text stays
base-content), WCAG AA, and the accepted-deviations list below.

### Verdict

| Host | Verdict | Basis |
| --- | --- | --- |
| VS Code (vscode) | **PASS WITH NOTES** | Order, structure, density and fold match the prototype in both themes. Defects 1-5 are moderate/minor. |
| Electron | **PASS WITH NOTES (visual) / fold budget FAIL, escalated** | The layout is correct (2-column grid, 80 px cards, popovers on top, nothing clipped except Defect 4), but card 5 ends at 831 px against the 660 px budget. This needs the user's decision (Q-extra-1); I do not call it a visual defect in the build. |

No visual-breaking and no serious defect found in the examined states. Score 7/10: sound structure and theming; gaps are
in badge wrapping, one stray outline, the active-card colour, and one popover state that runs off the viewport.

### Orchestrator re-check after the revise

The owner fixed Defects 1-5 (`batch-28-report.md` "## Visual revise (Gate V 28)"). The orchestrator checked the
refreshed captures `current-providers-vscode-anubis-light`, `current-providers-electron-anubis` and
`current-main-agent-save-to-vscode-anubis`:

- The badge outline is gone.
- The active card has the primary spine.
- No card carries a "Use for main agent" link.
- The CLI node spans the full row in Electron.
- The popover in its confirm state is fully visible.

The Electron fold is settled by the user decision (task.md "Gate V 28", per-host budget). The full settings folder is
green: 114 passed and 12 skipped (the `fixme` scenes) over 3 repeats. The team-leader confirmed that `:focus-visible`
still shows a ring on the popover triggers after the `styles.css` selector change. The outline is on the inner
button, and the changed rule sets only background and border on the non-focusable `div.popover-trigger`.

**Providers verdict: PASS** in both hosts, after the revise. The Verdict table above is the pre-revise review.

### Electron fold note (escalation, not a defect)

Numbers from `batch-28-report.md`, 1024x768, both themes identical:

| Metric | Budget | Electron | VS Code (for reference) |
| --- | --- | --- | --- |
| Tabs bottom | <= 660 | 123 | 83 |
| Routing map bottom | <= 660 | 503 | 354 |
| Connections heading bottom | <= 660 | 547 | 398 |
| Card 5 bottom | <= 660 | **831** | 590 / 592 |
| Card height | <= 80 | 80 x5 (pass) | 80 x5 |
| Grid columns at 1024 / 800 px | 2 (Electron) / >= 2 at 800 | 2 / **1** | 3 / 3 |

Cause, confirmed in the captures (`current-providers-electron-anubis-1024x768.png`): the workspace sidebar, git rail and
shell padding leave the page about 670 px wide, so the routing map wraps to 2 + 1 nodes (map ends at 503) and card 5
lands on row 3. At 800 px the content is under 492 px and the grid falls to 1 column. In the capture, cards 1-4 are fully
visible and card 5 plus the "Connect another provider" tile and the hint strip start at or below the fold. The page
scrolls, nothing is clipped or overlapping, so this is a budget miss rather than broken layout. Options are listed in
`batch-28-report.md` ("ESCALATION: Electron fold"); the choice belongs to the user.

### Defects

1. **Stray square outline around the "Effort · Workspace" badge (light theme, both hosts) - Moderate**
   - Captures: `current-providers-vscode-anubis-light-1024x768.png` (region: Main Agent node, below the "Active" pill,
     x 230-345, y 212-237), `current-providers-electron-anubis-light-1024x768.png`, and every light capture with the
     Main Agent node (`current-main-agent-*-light-*`, `current-scope-popover-*-light-*`).
   - Differs from the prototype: the prototype's override badges are clean rounded pills. In light, a thin square-cornered
     rectangle sits around the rounded pill (visible in a 3x crop). It does not appear in the dark captures.
   - Likely source: the popover trigger wrapper / button in `setting-scope-row.component.ts:77-85` (a `<button trigger>`
     inside `ptah-native-popover`); the outline is probably the wrapper or a default button border/ring showing in
     light only. Not confirmed without a DOM inspection.

2. **Main Agent node header and body wrap differently from the prototype (VS Code, both themes) - Moderate**
   - Captures: `current-providers-vscode-anubis-1024x768.png` and `...-light-...` (Main Agent node, x 110-370, y 180-340).
   - Differs: the prototype keeps the status/override badges on the title row and "MODEL:" with its value on one line.
     In VS Code (node 261 px wide) the "Effort · Workspace" badge drops to a second right-aligned row under "Active", and
     "MODEL:" is stacked above "Default (chosen by Claude)". That makes this node 169 px tall against a shorter map in the
     prototype and leaves the node visually uneven with its two siblings. Electron (316 px nodes) renders these inline.
   - Likely source: `routing-map-node.component.ts:37` (`shrink-0` title) and `:41` (`flex-wrap` badge group with the status
     pill at `:43`), plus the model row in the page composition (`providers-settings.component.ts:57` region).

3. **Active connection card uses the secondary (gold) spine, which reads as a warning beside the orange Ollama spine - Moderate**
   - Captures: all `current-providers-*` (Claude card left edge; Ollama card left edge). Dark: yellow-gold spine on
     "Claude (Subscription)" and orange spine on "Ollama Cloud".
   - Differs: the prototype marks the active-for-main-agent card with a primary (blue/teal) outline and the failed card with
     a red outline. Here "active" and "unreachable" are two similar warm colours, so active and needs-attention are hard to
     tell apart at a glance. The prototype's coloured per-provider initials are also flattened to one navy/neutral tile
     (minor, see notes).
   - Likely source: `provider-connection-card.state.ts:97` (`case 'active': return 'secondary'`) and `:99`
     (`unreachable` -> `warning`); the spine is added in `:107`.

4. **Main Agent popover, provider-change confirm state, runs past the viewport bottom (both hosts, both themes) - Moderate**
   - Captures: `current-main-agent-save-to-vscode-anubis-light-1024x768.png` (Save-to row at y about 745, popover bottom
     beyond 768), `current-main-agent-save-to-electron-anubis-1024x768.png` (Save-to select at y about 756, clipped).
   - Differs: the prototype popover is fully inside the frame. The default popover passes the in-viewport assertion
     (304x284), but when the D6 confirm block is shown the popover grows to about 400 px and its last row, "Save to:", is
     cut by the viewport. The page can scroll, so the control is reachable, but it is not seen without scrolling.
   - Likely source: the popover height is uncapped after the Batch 26 visual revise (no `max-h`, no flip); the visual spec
     asserts in-viewport only for the default state. Not traced to a line.

5. **Cards carry an inline "Use for main agent" link that the prototype cards do not have - Minor (check against the decision)**
   - Captures: `current-providers-vscode-anubis-1024x768.png` (Moonshot, OpenAI Codex, sovereigneg cards).
   - Differs: the prototype cards show only status text and "Used by". The link is an added action row that lengthens the
     status line and pushes "Used by N" right. It matches the "Use for main agent" design in Batch 26 carry-forward 3, so it
     may be intended; I list it because the prototype does not show it.
   - Source: `provider-connection-card.component.ts:85-112`.

### Notes (minor, no action required unless the user wants pixel parity)

- Electron light/dark captures show a broken image icon beside "Ptah" in the shell top bar (top-left, all Electron
  captures). It is outside the Providers page (shell logo asset in the harness host); not attributed to this task.
- Routing-map header copy differs from the prototype ("Select a work node to see or change what it runs on" versus
  "Click any work node to reassign model or effort"). Text only.
- Card initials avatars are a single neutral tone; the prototype uses a different hue per provider. See also the accepted
  "computed initials" deviation.
- Status text on cards and nodes is base-content with colour on the dot/badge, as deviation 6 requires; I found no
  coloured body text in the captures.
- Contrast: the muted rows in the light scope popover ("Global", "Desktop app") sampled at about 5:1 (darkest anti-aliased
  pixel 128,99,110 on 250,247,245), which passes AA for normal text. Dark-theme muted text looks comparable but was not
  measured.
- Drawer "Advanced" tab (`current-drawer-sovereigneg-advanced-vscode-anubis-1024x768.png`): the "Delete connection" block
  sits flush against the drawer footer with its description ending at the footer edge. It scrolls, so not clipped; looks
  tight.
- Drawer "Models & Tiers" (`current-drawer-sovereigneg-models-electron-anubis-light-1024x768.png`): the model field
  truncates its value ("Default (sovereigneg sonne..."), and the provider row has a loose gap under the labels. This is
  the accepted "Models & Tiers row density" deviation; truncation is handled with an ellipsis, not clipped.
- Catalog modal (`current-provider-catalog-*`): centred 512x461, search ring visible in both themes, Connect buttons are
  outlined with base-content text (accepted), list scrolls after six rows with no visible scroll affordance (minor).
- Stacking fix verified in `current-scope-popover-electron-anubis-light-1024x768.png`: the popover is above the CLI node
  and its "4 enabled" badge, with nothing painted through. Same in the VS Code scope-popover captures. The Batch 27b defect
  is closed.
- Drawer scrim now darkens and blurs the page, matching the prototype (`current-drawer-moonshot-*` versus
  `drawer-moonshot.png`).
- Hint strip: one row, names truncated with an ellipsis on the left, "Browse catalog →" right-aligned, directly under the
  grid, in both hosts. The Batch 27 layout delta is closed. The Electron strip is below the fold (see the fold note).

### Structure comparison against the prototype (VS Code, 1024x768)

| Aspect | Prototype | Current | Result |
| --- | --- | --- | --- |
| Order | map, Connections header + filter + primary, grid, hint strip | same, plus #22 line above the map | Matches (accepted deviation 1) |
| Grid | 3 columns, 2 rows, dashed tile | 3 columns, 832 px wide, dashed tile | Matches (accepted width) |
| Card height | about 80 px | 80 px | Matches |
| Header | pill count, filter, primary button | same; controls 36 px | Matches (accepted control height) |
| Drawer tabs and footer | 4 tabs, Close + Save Changes | kind-specific tabs, Close only on Overview | Accepted |
| Popovers | Reassign, scope, background roles | Reassign and scope captured; background roles popover is not in the capture set | Not compared |
| Themes | dark and light | both present; light has Defect 1 | Matches with Defect 1 |

Not compared: the prototype's Background Roles "Inspect" popover (`index-3.png`) has no current capture in the set, and the
Orchestration tab is out of scope here.

### Accepted deviations (not defects)

From `batches.md` Batch 28 carry-forwards and `batch-28-report.md`:

1. Drawer width `max-w-lg` (prototype 32rem); computed initials "MK"/"SO"/"CS"/"OC" versus the prototype's "KM"/"SV"; the
   Overview has no footer primary action (Check connection is in the status card).
2. Flagged for the user, no contract change: no key hint ("•••• 8f21"), no Overview latency ("92ms"). The latency appears
   only in the Credentials Replace check.
3. Container-width node grid and card grid (Electron 2 columns at about 670 px); no quota pill on the CLI node.
4. Badge text stays "{short} · App" in both hosts (D16); the host name ("VS Code" / "Desktop app") appears in the popover.
   The "VS Code" App-layer label is flagged for the user. Global wording differs across surfaces ("Global · all Ptah apps",
   "Global · all apps", "All Ptah apps"); pre-existing, decision at Gate V 28.
5. Catalog modal: openers always enabled; modal `size="md"` (512x461); `autofocus` removed (focus comes from `showModal()`);
   Connect buttons and "Browse catalog →" are base-content text with a primary border; tile uses a primary dot, not the
   plus-circle icon; row copy comes from the registry. The modal backdrop button's accessible name and focus ring are
   flagged for the ui owner.
6. Main Agent popover model control is a plain `<select>` with no search (flagged; "popover search" scene is `fixme`);
   the deep-link scene is `fixme`. No "Apply & Save": model and effort save on selection (D2), provider on confirm (D6);
   "Save provider to {scope}…" link; effort is a segmented group with default / low / medium / high / xhigh / max.
7. #22 ("Runs 100% locally…") stays in the shell above the map, not inside the page.
8. "Connect provider" and the filter are 36 px, not 32 px; "+" is an inline SVG.
9. Read states: errors and Retry per region; the "Loading…" lines are replaced by skeletons and `aria-busy`.
10. Clear-override review sits under the routing map, not under the grid.
11. Removed with the header block: the "N providers · M configured" line (replaced by the pill), workspace name and path,
    and the "No workspace open. Workspace overrides are unavailable." sentence (flagged; may need to return).
12. The filter is new; "No connections match" with "Clear filter" comes with it.
13. Models & Tiers row density; inline Models toast with the drawer at `z-[60]`.
14. Codex CLI is not listed under "Used by" for OpenAI Codex (flagged, HANDOFF open item 3).
15. The Electron fold (escalated above), and the 4 Electron/VS Code dark and light drawer captures with the new scrim.

### Captures reviewed

All `current-*` files named in the task brief, in both hosts and both themes: providers, main-agent-popover,
main-agent-save-to, scope-popover, provider-catalog, drawer-moonshot (overview, credentials, models),
drawer-sovereigneg (overview, models, advanced), drawer-claude-cli-credentials. Files opened directly: providers (all 4),
main-agent-popover (vscode dark, electron light), main-agent-save-to (vscode light, electron dark), scope-popover (vscode
dark, electron light), provider-catalog (vscode dark, electron light), drawer-moonshot (vscode dark, electron light),
drawer-moonshot-credentials (vscode light), drawer-sovereigneg-advanced (vscode dark), drawer-sovereigneg-models (electron
light), drawer-claude-cli-credentials (electron dark). The remaining capture variants were not opened; they are assumed
to follow the same themes and hosts and are not individually attested.


## Batch 38 final review (2026-10-02, visual-reviewer subagent — same-side, disclosed)

Same-side, disclosed: no image-capable CLI lane; this is an in-process visual-reviewer subagent, the same side as the authors of Batches 21-52. Screenshots were read by the model directly. No source file was edited; both throwaway probe specs (harness and Electron) were deleted after use (`git status` shows no tracked source change).

### Verdict

| Metric | Value |
| --- | --- |
| Verdict | **PASS WITH NOTES** |
| Score | **8/10** |
| Counts | 0 critical, 0 serious, 2 moderate, 4 minor |
| Scope | 4 tabs x 2 hosts x 2 themes at 1024x768 (the repository's gate size; no other width except the 800 px fold check) |
| Evidence | `screenshots/gate-v38/` (48 PNG + JSON), the committed folder run, a live Electron probe |

Why 8 and not 9-10: structure, order, one primary per region, fold budgets, focus, overlays and axe are clean in all 16 combinations, but two carry-forward items are real state-integrity gaps (a card that says "Connected" after a failed check; card actions that do not check their own connection), and one Gate G assertion is intermittently red. Why not 6-7: nothing overflows, overlaps or is unreachable, there is no coloured text, no contrast failure inside Settings, every overlay closes and returns focus, and each note has a small fix.

### Environment

- Build: `dist/apps/ptah-extension-webview/browser/main.js` 20:54:07; no non-spec source under `libs/frontend` or `apps/ptah-extension-webview` is newer, and the head `b45a7ca46` commit after it is docs/harness only. The Electron renderer copy `dist/apps/ptah-electron/renderer/main.js` is 21:05:39 (newer than the webview bundle), so both are current for the head. No rebuild.
- Served by the harness fixture server (`useAppBuild: true`), Playwright chromium, `--workers=2`.
- Standard: WCAG 2.2 AA (4.5:1 text, 3:1 components, 24x24 targets) plus the task rules (no coloured text, `table-xs`, one primary).
- Probes (all deleted): axe wcag2a/2aa/21aa/22aa on every tab in 4 host/theme combinations, a coloured-text scan (computed colour against the 7 `text-*` colour tokens), a Tab walk of every tab (up to 70 stops), backdrop and Esc on 5 overlays, list-width measurements, an 800 px overflow measurement, marketplace tables.

### Committed folder run (the one required run)

`npx playwright test --config=playwright.config.ts src/lib/scenarios/settings --reporter=list --workers=2`: **91 passed, 2 skipped, 1 failed (3.0 min)**. The 2 skips are the known `test.skip` "deep link main-model" scenes. The 1 failure is `settings-visual.e2e.spec.ts:430` "baseline smoke — both tabs (vscode, anubis)" at `settings-visual.e2e.spec.ts:132` (`overflowAt800` received 1, expected <= 0), the same intermittent 1 px case as before; the three other baseline-smoke combinations and the live-shaped tests passed. Every fold budget in the log is met: Providers VS Code tabs 83 / map 354 / heading 398 / card5 590 (618 with live-shaped data), Electron tabs 123 / map 503 / heading 547; Orchestration VS Code 125 / 206 / 247 / 550, Electron 165 / 266 / 309 / 600 (all <= 660). See answer 5 below for the 800 px case.

**Captures rewritten by the run vs HEAD.** `git status` lists 49 modified `current-*` PNGs (no new names, no `baseline-*`). I compared each with its HEAD version (a pixel counts when the summed channel difference is > 24):

- **Visible change: 2 files, 2 pixels each** (at x 114-115, y 159): `current-live-orchestration-vscode-anubis-1024x768.png` and `current-live-orchestration-vscode-anubis-light-1024x768.png`. Anti-aliasing noise at a badge edge; not a visual change.
- **No pixel over the threshold: the other 47.** The differences are 6-98 pixels in the small ones and up to 49,325 sub-threshold pixels in the drawers (scrim and blur dithering). They are the Advanced captures (tables, mcp, output-style, system-prompt drawer, vscode-lm), the Search & Voice captures (`search-voice-electron-anubis` and the voice drawers), Orchestration (vscode default, add/tiers modals in Electron, copilot and cursor popovers, role popover), Providers (providers, main-agent popover/model-search/save-to, provider-catalog, scope-popover) and the two live-orchestration files above.
- So **no capture has a visible change vs HEAD**. I did not restore anything (the team-leader handles it).

### Findings

| Id | Severity | Tab / host / theme | Evidence | Cause (file:line) | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| B38-1 | Moderate | Providers, all 4 combos | `screenshots/gate-v38/carry-failed-card-vscode-anubis.png`, `carry-failed-drawer-vscode-anubis.png`, `carry-*.json` (`failedCheck`: card "Connected" / `data-state=connected` before and after; drawer "Connected & verified" then "Check failed") | The card derives its state from the route status only and never reads `lastCheck` (`provider-connection-card.state.ts` `resolvedState`, used at `provider-connection-card.component.ts:67`); the drawer reads `lastCheck` (`overview-tab.component.ts:164`) | A failed recorded check wins over "connected" on the card: warning dot, "Check failed" and the Retry action (same copy as the drawer). The data is already in the route (`providers[].lastCheck`). |
| B38-2 | Moderate | Providers, all 4 combos | Source fact (the harness records no read RPCs, so the click showed 0 recorded calls: `carry-*.json` `cardAction` is not evidence of the count) | Card "Check connection" / "Retry" call `state.checkConnection()` (`providers-settings.component.ts:134-135`), which is `refresh()` over 12 reads (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:177-197`); only the drawer calls `checkProviderConnection(id)` (`providers-settings.component.ts:192`, service `:352`) | Wire the two card outputs to `state.checkProviderConnection(connection.id)` for checkable connections (key / OAuth / CLI) and keep `refresh()` for the rest; with B38-1 the result then shows on the card without opening the drawer. |
| B38-3 | Minor | Providers: Main Agent popover and drawer Models & Tiers, all 4 combos | `carry-main-list-vscode-anubis-light.png`, `carry-tier-list-vscode-anubis.png`; 214 px list vs 278-280 px field (popover); 190 px list vs 210 px field (drawer tier picker) | `provider-model-search-field.component.ts:71` `[matchInputWidth]="compact()"`: only the compact (Orchestration) variant matches the field width; the main-agent field (`main-agent-reassign-popover.component.ts:126`) and the picker (`provider-model-picker.component.ts:208`) are not compact | Make `matchInputWidth` independent of `compact` (default true on the search field). One ui change covers all three. |
| B38-4 | Minor | Orchestration, VS Code both themes; live Electron docs shot | `agent-orchestration-vscode-anubis-light.png` ("5. OpenC" cut), `apps/ptah-docs/public/screenshots/agents-orchestration.png` ("5. C" cut) | The order strip clips the last chip mid-glyph when 5 CLIs are ordered (`agent-orchestration-config.component.ts`); Batch 33(b) accepts the fade for Electron, here it is a hard clip in both hosts at 5 entries | Truncate whole chips ("+N") or put an ellipsis/fade on the strip edge; the order popover already shows the full list. |
| B38-5 | Minor (harness) | Gate G, vscode/anubis, intermittent | `settings-visual.e2e.spec.ts:132` red once in this run (earlier gate reports saw the same case) | Integer `scrollWidth - clientWidth` compared with 0 right after `setViewportSize` | Compare the widest descendant's right edge with the container's right edge and allow 1 px. See answer 5. |
| B38-6 | Minor (outside this task) | Electron shell sidebar, both themes | `sweep-electron-anubis.json`, `sweep-electron-anubis-light.json`: active workspace name 2.96:1 (#2563eb on #242430, dark); "Hide Workspaces" rail label 3.45:1 (dark) and 1.3:1 (light, #44ebd3 on #f3efec) | Shell workspace sidebar, not Settings | Track for the shell owner. The Batch 51 "0 color-contrast" claim holds inside `ptah-settings` only (confirmed: 0 inside Settings in all 16 combinations and in the live app). |

Also noted, not findings (accepted or known): the VS Code Main Agent `MODEL:` value wraps to two lines in the 261 px node ("Default (chosen by / Claude)", `providers-vscode-anubis.png`); Ollama "Unreachable" uses the warning (orange) spine while the prototype shows a red "Check failed" card (kept at the Gate V 28 re-check); a broken shell logo image in the harness Electron captures (harness asset); Electron Providers card 5 below the fold (Gate V 28 decision).

### Pass line

| Item | Result | Evidence |
| --- | --- | --- |
| Fold assertions green | **Met for every budget; one intermittent harness red** (B38-5) | 91 passed / 1 failed above; all region bottoms <= 660 in both hosts |
| Structure, order, one primary per region | **PASS** | Providers: shell line, routing map (3 nodes), Connections header with one primary "Connect provider", card grid, dashed tile, catalog strip (`providers-vscode-anubis.png` vs `index-anubis-1024x768.png`). Orchestration: policy bar, matrix (one primary "Add Ptah CLI Instance"), Uninstalled group collapsed, roles `<details>` closed (`agent-orchestration-vscode-anubis-light.png` vs `orchestration-anubis-light-1024x768.png`). Advanced and Search & Voice: P2 cards, one primary or none per card (`advanced-vscode-anubis.png`, `search-voice-electron-anubis-light.png`) |
| No `text-primary` / `text-error` TEXT | **PASS** | Computed-colour scan of every text node in `ptah-settings`: 0 hits on all 4 tabs x 4 combos. Source scan of settings components, `ui/native` and `core`: every `text-primary/secondary/warning/error/success/info` hit is on a `w-N h-N` icon, none on text |
| Focus visible | **PASS** | Tab walk, 14-27 stops per tab, every stop has an outline or box-shadow ring: `noRing: none` in all 16 (`sweep-*.json`) |
| Esc / backdrop closes every overlay and returns focus | **PASS** | Harness, 4 combos: Main Agent popover, connection drawer, catalog modal, Add-instance modal and Tier modal, each by backdrop click and by Esc: all closed; focus returned to Reassign, the card, "Connect provider", "Add Ptah CLI Instance" and "Tiers for Glm" (`overlays-*.json`). Two-step Esc in search lists: Esc 1 closes only the list (popover stays), Esc 2 closes the popover and returns focus to Reassign (`carry-*.json` `afterEsc1/2`) |
| axe: no nested-interactive beyond the card pattern | **PASS** | One node, `div[data-tone="warning"]` (the clickable Ollama card holding its Retry), Providers tab only, all 4 combos and live; none on the other three tabs |
| axe: 0 color-contrast | **PASS inside Settings** (B38-6 outside) | 0 in `ptah-settings` in all 16 combos and in the live app |
| Electron file dialogs unaffected by `showModal()` | **PASS (dialogs stubbed)** | Live Electron: after opening and closing the catalog `<dialog>` (`showModal()`), "Export settings" invoked `dialog.showSaveDialog` and "Import settings" plus its confirm invoked `dialog.showOpenDialog` in the main process (`live-native-dialogs.json`). Both were stubbed to return "cancelled", so no real OS window was seen |

### Carry-forward answers

1. **Model list width vs field (28b).** Fact: the Main Agent popover list is 214.4 px against a 278-280 px field (VS Code and Electron, both themes); the drawer tier picker list is 189.5 px against a 209.5 px field. The Orchestration popover list matches its field (the compact variant). Cause: `matchInputWidth` is tied to `compact`. Recommendation: fix (B38-3), a one-line ui change that covers the drawer too. Not a blocker.
2. **List reopens after "Enter a model ID…".** Fact: after Cancel in the manual-ID state, focus returns to the field and the list reopens (`aria-expanded=true`, focus on the input, all 4 combos); one Esc closes the list and a second closes the popover and returns focus to Reassign. Recommendation: keep. It is predictable (focus opens a combobox), costs one keypress and is the accepted two-step Esc; changing it would diverge from the shared field rule.
3. **Card "Connected" vs drawer "Check failed" after a failed drawer check.** Fact: reproduced in 4 combos with a failing `auth:checkConnection`. The drawer reads "Check failed" ("The provider rejected the stored key. Checked just now"); after closing it the card still reads "Connected" with `data-state="connected"` (`carry-failed-card-*.png`). Recommendation: carry the recorded check on the card (B38-1). A green "Connected" next to a check the user just saw fail is what D15 ("never verified after a failure") forbids, and the fix reads data already in the route.
4. **Card Check / Retry refresh the whole page.** Fact: `providers-settings.component.ts:134-135` call `state.checkConnection()`, which is `refresh()` of 12 reads and records no check; only the drawer runs `auth:checkConnection` for one connection. This is a source fact, not a measured call count (the harness records no read RPCs). Recommendation: route the card actions to `checkProviderConnection(id)` for checkable connections (B38-2), together with B38-1.
5. **800 px zero-margin fold failure (`settings-visual.e2e.spec.ts:132`).** Fact: at 800 px the VS Code Providers page measures a 752 px box with three grid tracks of 242.656 / 242.672 / 242.672 px (sum 727.99 plus two gaps = 752 within 1/64 px). The widest descendant's right edge equals the container's right edge (776) at 800, 801, 802 and 803 px in both themes, and document scroll width equals client width. 45 forced repeats (40 immediate reads right after the resize) gave 0 overflow, and 3 of 4 combinations passed in the full run. The 800 px screenshot shows nothing cut or scrolled (`fold800-vscode-anubis.png`). Verdict: **sub-pixel rounding jitter, not a real overflow.** I could not reproduce the 1 px, so the exact trigger is not proven; the integer `scrollWidth` rounds a content width of 752.00x up by one. Recommendation: change the assertion (B38-5).
6. **Table headers outside Settings (the Batch 51 app-wide `.table :where(thead, tfoot)` rule).** Fact: header colour is the measured muted token in both themes. Marketplace MCP Servers table (`provider-table`, real render): 5.53:1 light, 5.55:1 dark. Marketplace `coverage-table`: 4.94:1 light, 5.19:1 dark. Markup with the exact classes of the dashboard table (`table table-xs w-full`) and the skill-synthesis table (`table table-xs`): 4.94 and 5.53 light, 5.19 and 5.55 dark. The dashboard and skill-synthesis views are not mountable in the harness, so those two were checked as injected markup, **not** through their real components. The real marketplace screenshots show the headers legible and still muted, not heavier (`outside-marketplace-servers-anubis-light.png`, `outside-marketplace-servers-anubis.png`, `outside-marketplace-overview-anubis-light.png`, `outside-synthetic-anubis-light.png`). No regression found. Not checked: the real dashboard, skill-synthesis and git diff views.

### Prototype fidelity

- Approved prototype: `prototypes/final/index.html`, `orchestration.html` and their `screenshots/` (Gate 1.7); Advanced and Search & Voice against `pattern-map-advanced-search-voice.md` P1-P12 (no prototype, by decision).
- Fidelity assessment: **MATCHES** in structure, order, component choice (badges, popovers, drawers, native dialog modals), single primary per region and both themes, with the accepted deviations (design-spec §6 3-6, D9-D11, D16 layer badges, Gate V 28/36/50 decisions). Not re-raised: Electron card 5 below the fold, order chips fading in Electron, 512 px drawers, "Follows Autopilot" copy, Test only on Ptah instances, `table-xs` density.
- Before/after vs `screenshots/current-01-top.png`: the old page (a flat column of outlined buttons, an eight-row scope block, no map, no fold) is replaced by the routing map and a 5-card grid inside 660 px in VS Code (`providers-vscode-anubis.png` vs `current-01-top.png`). `current-02` and `current-03` show the same flat list further down and have no counterpart, because the new page has nothing equivalent below the fold. No regression found.
- Before/after (`current-*` vs HEAD): see "Captures rewritten" above; no visible change.

### Live Electron pass

- **Docs shots (Batch 52, temp copy of the real profile).** `apps/ptah-docs/public/screenshots/settings-overview.png` (1600x1000): Providers with real data, "Desktop app override" and "Workspace override" badges whole under a one-line "MAIN AGENT" title, provider OpenAI Codex, model `gpt-5.6-sol`, 3 cards plus the dashed tile and the catalog strip, nothing clipped. `agents-orchestration.png`: versions normalised ("v0.155.1", "v1.0.83", "v1.2.15", "v2.0.12"), Antigravity model on one line ("claude-sonnet-4-6"), OpenCode's long id on two lines, Glm row actions on one line, Uninstalled group collapsed. Only defect: B38-4 (order chip "5. C" cut). Both read well and are accepted as docs assets.
- **My own live pass (real Electron, built dist, throwaway profile copy through the docs harness, window set to 1024x768, dark theme).** All four tabs rendered with real data (`live-providers.png`, `live-agent-orchestration.png`, `live-advanced.png`, `live-search-voice.png`), no horizontal overflow, axe inside `ptah-settings`: 0 violations on Orchestration, Advanced and Search & Voice, and the single known card-pattern `nested-interactive` on Providers. Catalog modal: Esc and backdrop both close it and return focus to "Connect provider". Main Agent popover Esc returns focus to Reassign. Connection drawer Esc returns focus to the card. The live Advanced tab showed the licensed-state "Membership Key Not Active" alert (base-content text with an orange icon and border, `live-advanced.png`), which the harness fixture never renders. The user's real profile was not touched, and the running Ptah instance was not used.
- **Not checked live:** the light theme, real (unstubbed) OS file dialogs, authenticated provider checks and key writes (nothing was saved or checked), the VS Code host (harness only), widths other than 1024x768.

### Not examined / residual uncertainty

The unrendered states listed in Gate V 50 item 6 (key-not-active alert as a fixture, test-connection result lines, output-style banners, voice download progress and error states, go vet stale/error alerts) were not re-measured; the only one seen live is the membership alert. Dashboard and skill-synthesis tables were checked as markup only. Each folder run rewrites about 49 captures with sub-threshold bytes; that is a repeatable cost of the run, not a visual change.

- Recommendation: APPROVE WITH NOTES (PASS WITH NOTES, 8/10)
- Confidence: HIGH on folds, axe, focus, overlays, coloured text and the carry-forward facts; MEDIUM on the 800 px trigger (not reproduced); LOW on unrendered error states and the look of real OS dialogs.
- Key concern: B38-1 and B38-2. The connection card can say "Connected" after a failed check, and its own Check/Retry do not check that connection.


## Batch 38 re-check 1 (2026-10-02, visual-reviewer subagent — same-side, disclosed)

Same-side, disclosed (in-process subagent, no image-capable CLI lane). Head `eeaa94951` (Batch 53). Build: `dist/apps/ptah-extension-webview/browser/main.js` 21:43:27; no non-spec source under `libs/frontend` or `apps/ptah-extension-webview` is newer. No source edited, no git writes; the three throwaway probe specs were deleted. Evidence: `screenshots/gate-v38r1/` (PNG + `recheck-*.json`, `esc-after-check-*.json`).

**Committed folder run** (`--reporter=list --workers=2`): **121 passed, 2 skipped, 1 failed (8.1 min)**. The failure was "baseline smoke — connection drawers, Models & Tiers and Advanced (electron, anubis)" at 42 s: a 30 s timeout clicking the drawer's "Advanced" tab while the machine was loaded. Re-run alone, `--repeat-each=3 --workers=1`: 3/3 passed (3-5 s each). Treated as load flake, not a regression; the 8-test split also leaves the 800 px fold test green in all four combinations (`B53 ...` lines in the log: order strip, list-vs-field).

**Captures rewritten:** 74 `current-*` PNGs (no new names, no `baseline-*`), compared with HEAD by pixel (summed channel difference > 24). Over-threshold counts: 3 files with 2 px at (114-115, 159) (`current-live-orchestration-vscode-anubis-light`, `current-orchestration-popover-model-vscode-anubis-light`, `current-orchestration-vscode-anubis`) and 1 file with 11 px along y 137-143 (`current-orchestration-popover-model-electron-anubis-light`, the edge of the Re-detect button). All are anti-aliasing noise; the other 70 have no pixel over the threshold. So **no capture has a visible change vs HEAD**. Nothing restored.

### B38 status

| Id | Status | Evidence |
| --- | --- | --- |
| B38-1 card shows the failed check | **Fixed** | 4 combos: card `data-state` goes `connected` -> `check-failed`, text "Check failed", with a red spine and Retry (`card-failed-vscode-anubis-light.png`, `card-failed-*.png`). After the card's own Retry with a verified result it returns to `connected` / "Connected". |
| B38-2 card Check/Retry check only their connection | **Fixed** | 4 combos: Retry on the sovereigneg card sent exactly one `auth:checkConnection` with that provider (`recheck-*.json` `afterRetry.calls: ["sovereigneg"]`). Ollama Cloud (not checkable): Retry sent 0 checks, card stays "Unreachable". Focus after Retry is on the card (`div` named "sovereigneg: Connected...", `role=button`), not `body`. |
| B38-3 list at least the field width | **Fixed** | 4 combos: Main Agent popover list 280/278 px = field 280/278 (was 214); drawer tier picker 209.5 = 209.5 (was 190 vs 210); Orchestration matrix popover 248 = 248; list x equals field x (`list-main-*.png`, `list-tier-*.png`, `list-matrix-*.png`). The shared ui change reaches only `provider-model-search-field` (the only user of `NativeAutocompleteComponent` outside ui); all three users read correctly, nothing clipped. Not checked: the setup wizard's picker (not opened). |
| B38-4 whole chips + "+N" | **Fixed** | VS Code both themes: "1. Codex -> 2. Antigravity -> 3. Glm -> 4. Copilot -> +1" (5 elements, none clipped, last chip right edge 731 < strip right edge 768-770). Electron: "1. Codex -> 2. Antigravity -> +3" (`orchestration-electron-anubis.png`). |
| B38-5 fold assertion without jitter | **Fixed** | Folder run: all 800 px fold tests green in 4 combos; the new `B53` logs show 0 overflow. |
| B38-6 shell sidebar contrast (outside) | Unchanged, out of scope | Not re-measured. |

### Pass line re-check

- **axe** (scoped to `ptah-settings`, 4 tabs x 4 combos): `color-contrast` 0 everywhere; `nested-interactive` only the known card, Providers only.
- **Focus**: Tab walk 13-26 stops per tab, 0 stops without a ring in all 16.
- **Esc/backdrop on the drawer after a check**: backdrop click closes it and focus returns to the card in all 4 combos. Esc closed it in the main probe (focus on the card), **but see N1**.
- **Retry focus**: returns to the card, as above.

### New finding

| Id | Severity | Where | Evidence | Cause / fix |
| --- | --- | --- | --- | --- |
| N1 | Moderate | Providers drawer, Overview "Check connection", VS Code dark (not run in other combos) | `esc-after-check-*.json`: after a check (mouse click and keyboard Enter, failed and verified), focus is on `body` in 5 of 12 runs, and Esc then leaves the drawer open for 4+ seconds (`drawer: 1`, `active: BODY`). In the other 7 runs focus stayed on the button and Esc closed the drawer and returned focus to the card. A parallel 12-run stress showed the same state repeatedly (the next card click was blocked by the still-open drawer's backdrop). | The button is natively disabled while the check runs (`overview-tab.component.ts:175`, `[disabled]="loading() \|\| checking() \|\| saving()"`); a focused disabled button drops focus to `body`, and nothing restores it. Same family as the earlier Cursor popover N3. The file is not in Batch 53 (last change 28d), so it is **not a regression**, but the pass line "Esc closes every overlay" does not hold for this path. Fix: `aria-disabled` plus a guard in the handler (as the Cursor popover and order popover do), or refocus the Check button when the check ends. Tab and the Close button still work, so keyboard users are not trapped. |

### Verdict

**PASS WITH NOTES, 9/10 for the Batch 53 fixes; overall 8/10.** All five Batch 38 findings are fixed in both hosts and both themes, with no regression in axe, focus rings, backdrop close or card focus return. One new Moderate (N1, pre-existing, intermittent focus loss after the drawer's Check) keeps the overall score at 8. Open: N1, B38-6 (shell sidebar, outside this task), the setup wizard picker not re-checked after the shared list-width change, and the unstubbed OS dialogs / light-theme live pass from the first review.


## Final review on PR 631 (2026-10-03, visual-reviewer subagent — same-side, disclosed)

Same-side, disclosed (in-process subagent, no image-capable CLI lane; screenshots read by the model). Head `af8a35684` (merge of origin/main). No source edited, no git writes; the three throwaway probe specs (`webview-e2e-harness/src/lib/scenarios/finalprobe/`) are deleted. Evidence: `screenshots/final-pr/` (16 tab captures, `scan-*.json`, `ring-details-*.json`, `overlays-busy-*.json`, `matrix-*busy*.json`, `tinted-alerts-*.json`, clips named in the table).

### Verdict

| Metric | Value |
| --- | --- |
| Verdict | **PASS WITH NOTES** |
| Score | **7/10** |
| Counts | 0 breaking, 2 serious (focus-ring contrast), 2 moderate, 3 minor |
| Scope | 4 tabs x 2 hosts x 2 themes at 1024x768 (gate size; 800 px only through the folder run's fold tests) |

Why 7 and not 8-9: structure, folds, overlays, coloured text, axe and the Batch 54 drawer/toggle busy behaviour are clean in all 16 combinations, but two focus indicators measure under 3:1 (F1 light checkboxes and radios, F2 interactive provider cards in both themes), which the severity rule files as Serious (NEEDS_REVISION if the team holds to "no Serious"). Why not 5-6: nothing overflows or is unreachable, every overlay closes and returns focus, and both Serious items are one-class fixes.

### Environment

- Build: `npx nx build ptah-extension-webview` from the worktree root: exit 0 (nx re-extracted the cached production output, `dist/apps/ptah-extension-webview/browser/*` stamped 01:35 today; the cache key covers the merged sources). Served by the harness fixture server (`useAppBuild: true`), Playwright chromium, `--workers=2`.
- Folder run (`src/lib/scenarios/settings`, `--reporter=list --workers=2`): **124 passed, 2 skipped (known "deep link main-model" fixme), 0 failed (4.3 min).** Fold budgets met: Providers VS Code tabs 83 / map 354-382 / heading 398-426 / card5 590-618; Electron tabs 123 / map 503-513 / heading 547-557 (card 5 below the fold, accepted); Orchestration policy bar 125 (VS Code) / 165 (Electron), roles summary 550 / 600 (<= 660); 800 px overflow 0; order strip whole chips (VS Code 4 + "+1", Electron 2 + "+3").
- **Captures rewritten:** 46 `current-*` PNGs (no new names, no `baseline-*`). Pixel diff vs HEAD (summed channel difference > 24): 43 files have no such pixel; 3 files have 2 px at (114-115, 159) (`current-live-orchestration-vscode-anubis`, `current-orchestration-popover-model-vscode-anubis`, `-anubis-light`), the same badge-edge anti-aliasing noise as the earlier gates. **No visible change vs HEAD; nothing restored.**
- Standard: WCAG 2.2 AA (4.5:1 text, 3:1 components and focus indicators, 24x24 targets) plus the task rules. Contrast measured in the page (canvas-resolved colours composited over the ancestor background chain); an offset focus ring is measured against its parent's background.

### Findings

| Id | Severity | Tab / host / theme | Evidence (`screenshots/final-pr/`) | Cause (file:line) | Fix |
| --- | --- | --- | --- | --- | --- |
| F1 | Serious | Advanced and Search & Voice, both hosts, **light only** | `ring-checkbox-vscode-anubis-light.png`, `ring-details-*-anubis-light.json`, `scan-advanced-*-anubis-light.json`, `scan-search-voice-*-anubis-light.json`: the Tab ring on every `checkbox-primary` / `radio-primary` is `rgb(68,235,211)` on `rgb(250,247,245)` = **1.4:1**. Dark is 3.35:1 (blue), passes | The `checkbox checkbox-xs checkbox-primary` / `radio-primary` inputs: `web-search-config.component.ts:159`, `agent-behaviour-section.component.ts:132,211,236`, `mcp-port-config.component.ts:141,169`, `output-style-parity-section.component.ts:75`, `output-style-list.component.ts:286`. daisyUI's `.checkbox-primary:focus-visible` (outline in the primary colour) out-ranks main's low-specificity gold rule in `apps/ptah-extension-webview/src/styles.css:630-633` | Add `focus-visible:outline-base-content` (or the gold-strong variable) to those inputs, or extend the light rule to `:is(.checkbox, .radio, .toggle):focus-visible`. The unchecked radio and checkbox borders use the same teal (`disabled-output-style-row-vscode-anubis-light.png`, Explanatory/Learning radios): visibly pale; not measured separately |
| F2 | Serious | Providers, both hosts, **both themes** | `ring-card-vscode-anubis-light.png`, `ring-card-vscode-anubis.png`, `ring-details-*.json` `card`: the focused card draws `box-shadow 0 0 0 2px primary/60` with a transparent outline. Light ring colour `rgb(68,235,212)` = 1.4:1 at full opacity (about 1.3:1 at the 60 % drawn); dark `rgb(37,98,235)` = 3.55:1 at full opacity (about 2:1 at 60 % by my blend arithmetic) against the page background. The card is the first Tab stop of the grid | `libs/frontend/ui/src/lib/native/card/native-card.component.ts:202-203` (`focus-visible:ring-2`, `focus-visible:ring-primary/60`) | Use a full-opacity ring that clears 3:1 on both themes: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content` like the card's own Retry link (`provider-connection-card.component.ts:100`) |
| F3 | Moderate | Orchestration matrix cell popover during a held save; mouse pick 4/4 combos, keyboard pick VS Code dark only | `matrix-busy-*.json`, `matrix-mouse-busy-vscode-anubis.json`, `matrix-keyboard-busy-vscode-anubis.json`, `busy-matrix-popover-*.png`. Mouse pick with `agent:setConfig` held: popover stays, **focus on `BODY`**, Esc does nothing until the save returns (then it closes and focus returns to the cell). Keyboard pick: focus stays on the search field (`aria-disabled`), Esc closes the popover, but **focus lands on `BODY` and does not return to the cell**, also after the save returns | `ptah-ai/cli-model-effort-popover.component.ts` (close-while-saving path; the clicked option takes focus out of the aria-disabled field); not traced to a line | Close path while busy: refocus the cell that opened the popover. Mouse path: keep focus on the search field when an option is picked (preventDefault on option mousedown). Real saves return in milliseconds, so it only shows on a slow host |
| F4 | Moderate | Advanced, both hosts, both themes | `disabled-output-style-row-vscode-anubis.png`, `-anubis-light.png`, `ring-details-*.json` `disabledIcon`: built-in Edit/Delete icons at opacity .4 are **3.28:1 (dark)** and **2.48:1 (light)** effective | `output-style/output-style-list.component.ts:361,377` (`disabled:opacity-40`) | **Verdict on the question asked: acceptable.** Disabled controls are exempt from the contrast criteria, the icons still read as present (pencil and bin outlines are visible in both themes), the row carries the "Built-in" chip and the footnote "Built-in styles are part of the agent — Ptah can select them but not change it", and main's ghost-button default does not change the look (the explicit `disabled:bg-transparent disabled:border-transparent` wins). In light they are close to the edge; `disabled:opacity-50` would give about 3:1. Optional |
| F5 | Minor | Advanced, both hosts, both themes | `ring-summary-vscode-anubis.png`, `ring-summary-vscode-anubis-light.png` | `output-style/output-style-parity-section.component.ts:68`: the "Command-line parity" `<summary>` has no Ptah ring class, so it shows the browser's default two-tone `outline: auto`. It is visible in both themes (my 1.1:1 reading for dark is only the dark half of a dual ring) | Give it the same `focus-visible:outline-2 outline-offset-2 outline-base-content` as the Orchestration roles summary |
| F6 | Minor | Orchestration, Electron, both themes | `agent-orchestration-electron-anubis-light.png`, `agent-orchestration-electron-anubis.png` | In the Electron stacked layout the provider name truncates with an ellipsis beside the status badge ("OpenAI …", "Google …", "Ollama …", "GitHu…"); VS Code shows the full names. The stacked layout was accepted earlier; the truncation loses the provider name | Put the provider on its own line, or add a `title` with the full name |
| F7 | Minor | Advanced, light | `tinted-alerts-anubis-light.json` (injected markup, not a real component) | Settings alerts are tinted boxes with `text-base-content` (e.g. `license-status-card.component.ts:320`), so main's filled `.alert-error` ink override does not reach them. Measured with the Settings classes: text 13.7:1 (error) and 14.5:1 (warning) in light, 13.1-13.9:1 in dark. The warning/info/success **icons** are 2.2-2.3:1 in light (error 6:1); text carries the meaning, so not a failure | Keep; if an icon ever stands alone, use a darker token |

Also checked, no finding: the "Explore Ptah Builders" icon is `text-secondary` (`license-status-card.component.ts:255`): amber 8.2:1 dark, 4.1:1 light on the card, beside base-content icons (Export, Import, key) and the primary-coloured Create Account icon; colour on an icon is allowed and it reads as one deliberate accent (`explore-builders-vscode-anubis-light.png`). The toast `btn-warning` Undo is 6.6:1 dark and 5.7:1 light.

### Pass line (batches.md Batch 38)

| Item | Result | Evidence |
| --- | --- | --- |
| Fold assertions green | **PASS** | 124 passed, 0 failed; numbers above |
| Structure, order, one primary per region | **PASS** | Providers: shell line, routing map (3 nodes), Connections header with one primary, 5-card grid, dashed tile, catalog strip (`providers-vscode-anubis-light.png` vs `prototypes/final/screenshots/index-anubis-light-1024x768.png`; Electron 2 columns with the map's third node on its own row, the accepted Gate V 28 layout). Orchestration: policy bar, matrix with one primary "Add Ptah CLI Instance", Uninstalled group collapsed, roles `<details>` closed (`agent-orchestration-vscode-anubis.png` vs `orchestration-anubis-1024x768.png`). Advanced / Search & Voice: P2 cards, one primary or none per card; Voice Engines and Go vet render only in Electron (host-gated by design, `search-voice-settings.component.ts:22`) |
| No `text-primary` / `text-error` text | **PASS** | Computed-colour scan of every text node in `ptah-settings` against the 7 `text-*` tokens: 0 hits on all 16 combinations (`scan-*.json` `coloured`) |
| Focus visible | **PASS for presence, FAIL for contrast on two controls** | 0 stops without a ring in 16 of 16 (Tab walk 18-70 stops per tab). Where the redesign set `outline-base-content` the ring wins over main's gold: light 41,19,52 (>= 5.5:1), dark 232,230,225. Where it did not, the gold-strong ring applies in light (135,78,0, >= 5.5:1) and gold in dark (212,175,55). Exceptions: F1 and F2 |
| Esc / backdrop closes overlays and returns focus | **PASS** | `overlays-busy-*.json`, 4 combos: Main Agent popover (Esc and backdrop -> Reassign), catalog dialog (-> "Connect provider"), connection drawer (-> the card); Add-instance and Tier modals are covered by the green folder run |
| axe: color-contrast 0 in Settings | **PASS** | 0 in `ptah-settings` on all 16 (wcag2a/2aa/21aa/22aa) |
| axe: nested-interactive only the known card | **PASS** | One node, Providers tab only, all 4 combos; none on the other three tabs |

### Interaction of main's merged styles with the redesign (question 2)

- **Light focus ring:** main's rule (`styles.css:630-633`, `:where()`-wrapped) does not override an explicit `outline-base-content`: confirmed in the walk (ring `41,19,52` on those stops, 5.5-19:1). It reaches buttons, inputs and selects that have no utility, and the busy drawer Check button shows the gold-strong ring (`busy-drawer-check-vscode-anubis-light.png`). It does **not** reach daisyUI checkbox/radio-primary (F1) or the card's box-shadow ring (F2).
- **Disabled and busy controls after 54.1 and main's ghost default:** busy buttons dim through the shared aria-disabled rule and keep focus; the built-in output-style icons are faint but acceptable (F4).
- **Error ink:** no Settings surface uses a filled `.alert-error`; see F7.

### Busy-state behaviour (question 3)

| Case | Result |
| --- | --- |
| Drawer "Check connection" held (4 combos) | **PASS**: `aria-disabled=true`, not natively disabled, focus stays on the button, Esc closes the drawer while the check runs and focus returns to the card (`busy-drawer-check-*.png`, `overlays-busy-*.json`); the folder run's N1 scene also passes |
| Matrix toggle save held (4 combos) | **PASS**: focus stays on the checkbox (`aria-disabled`, not native), Tab moves on, released cleanly (`matrix-busy-*.json`) |
| Matrix cell popover pick held | **Partial** (F3): focus and Esc do not hold on the mouse path, and focus is not returned after Esc on the keyboard path |

### Not examined / residual uncertainty

Unrendered error and progress states (test-connection result lines, voice download progress, go-vet stale/error alerts) were not rendered; the tinted-alert numbers use injected markup. The keyboard pick in F3 was run in VS Code dark only. 800 px was checked only through the folder run's fold tests. Real OS dialogs, the live Electron app and a light-theme live pass were not repeated. The Electron shell sidebar contrast (B38-6) is outside this task and not re-measured. Not re-raised: Electron card 5 below the fold, 512 px drawers, `table-xs` density, Ollama warning spine, order chips "+N".

- Recommendation: PASS WITH NOTES (7/10); fix F1 and F2 before merge if the team treats Serious as blocking (both are one-class changes).
- Confidence: HIGH on folds, axe, coloured text, overlays, the drawer-busy result and the F1/F2 numbers at full opacity; MEDIUM on the effective F2 ratios (blended by hand) and on F3 beyond the paths run.

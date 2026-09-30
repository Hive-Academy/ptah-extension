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

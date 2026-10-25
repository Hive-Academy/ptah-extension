# Visual Review - TASK_2026_712_5d7c (Claude Accounts UI, Batches 29-33)

Verdict: **NEEDS_FIX** (0 Blocking, 0 Serious, 2 Moderate, 3 Minor). Confidence: MEDIUM (see "Not captured").

## Environment

- Electron only (project rule). Built from this worktree: `nx run-many -t build-dev copy-renderer-dev -p ptah-electron --parallel=1` (exit 0), launched through the repo's Playwright-Electron harness (`apps/ptah-electron-e2e/src/support/{electron-launcher,fixtures,ui-driver}.ts`) with an isolated user-data dir and isolated DB.
- Review-only spec and config live under `visual-review/e2e/` (task folder). No production code was edited. No sign-in, add, rename, default or remove reached a real account.
- Populated, error and "empty snapshot" states use mocked `provider:*` RPC through `UiDriver.mockRpc`. All other RPCs return `{}`, so the Connections grid shows "Providers could not be loaded" in mocked shots. That is a mock artifact, not a defect.
- Themes: `ptah-glass` (dark) and `ptah-glass-light` (light), set through `data-theme`. Other themes were not reviewed.
- Window content widths: 1600, 1100, 900, 700, 600, 400. The shell has `minWidth: 800` (`apps/ptah-electron/src/windows/main-window.ts:125`). I lowered the minimum in the test process only, so widths below 800 are a forced audit condition, not a supported window size. The audit selection is not a support contract.
- Container-query tiers actually hit (section width measured): 1202px at the 1600 window (two summary cells, >=960), 702px at 1100 (stacked), 518px at 900 (single column), 350px at 700, 600 and 400.
- Screenshots and measurements are in `.ptah/specs/TASK_2026_712_5d7c/visual-review/`. Measurement files: `populated.json`, `empty-mock.json`, `error.json`.

## Findings

| # | Sev | Finding | Screenshot | Likely source | Prototype difference |
|---|-----|---------|------------|---------------|----------------------|
| 1 | Moderate | Chooser option: a long profile label runs past the pill's right border and is hard-clipped ("...very long profile la"). No wrap or ellipsis. Seen at 400 in light. The Personal option clips the same way in the dark chooser. | `chooser-light-400.png`, `chooser-dark-400.png` | `account-chooser.component.ts` option row, about lines 110-135 (label element needs `truncate` or `break-words` with `min-w-0`) | The prototype wraps or limits the label inside the option. The profile cards in the build do wrap ("must wrap" is on a second line), so the chooser is inconsistent with them. |
| 2 | Moderate | Drawer tablist focus order: Tab cycles only Overview -> Close panel -> Overview. Access and Profile tabs are not reachable with Tab, and focus never reaches panel content on Overview. This is acceptable only if arrow keys move between tabs. I did not test Left/Right, Home or End, so it is unverified. | `drawer-overview-dark-1600.png`; focus log in `populated.json` (`drawerTab`) | `account-details-drawer.component.ts:139` (tab buttons) | The prototype's Tab cycle is described as excluding hidden-panel controls. It does not state roving tabindex. Confirm arrow-key support or make all tabs tabbable. |
| 3 | Minor | The mocked "empty snapshot" status for ambient is "Existing Claude login". "Held" and API notes ("Named account starts are awaiting release authorization.", "Used only when Claude sign-in is the main route...") are absent from `prototype/index.html`. They are added production copy. | `empty-dark-1600.png`, `pop-dark-1600-window.png` | `accounts-section.component.ts` (heldNote, apiNote) | Not in the prototype. Needs design sign-off or a design-spec entry. |
| 4 | Minor | Drawer held message starts with the heading "Held for release authorization" and then a host sentence. Neither is in the prototype copy. | `drawer-signin-held-dark-1600.png` | `account-details-drawer.component.ts:151` | The D32 decision records this as executor-built copy. |
| 5 | Minor | On the real run without an active workspace, the section shows "Accounts load when a workspace is open." and the Add button looks fully styled. I did not check the `disabled` attribute or its dimming. | `real-dark-1600-window.png` | `accounts-section.component.ts:165-168` (`[disabled]="!snapshot()"`) | The prototype has no idle state. |

## Checks and results

**Overflow.** At every width in both themes, `documentElement.scrollWidth <= innerWidth`, section `scrollWidth <= clientWidth`, and no descendant spills past the section edges (`populated.json` -> `static`). The empty-mock run is identical. Caveat: at windows narrower than 800, the shell (workspace sidebar plus rails) clips the settings pane. Element crops such as `pop-light-400.png` show the section cut off at the right by the shell. That is the forced sub-minimum window, not the component, whose own container is 350px and stacked.

**Layout tiers.**
- At 1600 (section 1202px) the summary grid has two cells (`595px 595px`), matching the >=960 tier.
- At 1100 (702px) and below it is one column.
- Cards wrap labels and move Manage under the metadata in the narrow tier.
- Comparison is against the prototype's 640-959, <640 and embedded branches. The build uses container queries (60rem and 40rem), as the prototype's embedded branch does.

**Layout shift.** Observed CLS was 0 in the populated run and in the empty-mock run. This only covers the interactions scripted in the spec.

**Keyboard and focus (dark and light, 1600 and 400).**
- Section Tab order: Change (main), Change (lane), then card, Manage, card, Manage... in DOM order.
- The ring is shown on every stop: 2px solid, offset 2px.
- Chooser: focus lands on "Use existing default", Tab then moves through the options and Cancel. Add dialog: focus lands in the label input, then Close, input, Cancel, Add profile.
- Escape closes the chooser, the Add dialog and the drawer in all four combinations (`closed = true` from visibility checks). Focus returns to the opener each time (Change for main session, Add Claude account, Manage Work).
- A second drawer opened after a sign-in attempt closed normally on Escape (no stuck drawer in the rerun).
- An earlier run hit a `Remove` locator that matched "Remove workspace". That was a spec bug, fixed and rerun.

**Contrast.**
- Focus ring, dark: oklch(0.96) vs surfaces, 14.05-17.68:1.
- Focus ring, light: oklch(0.236) navy on light surfaces, 15.39:1 in the section. This resolves the D35/D37 open point: the light-theme ring is neutral and passes 3:1.
- Light-theme ring measurement inside the chooser, Add dialog and drawer reported 1.18:1. This is a measurement artifact: the surfaces are translucent glass and my background walk found a dark ancestor. `chooser-light-400.png` and `add-error-light-1600.png` show a dark ring on a light surface. I did not pixel-verify the ring contrast in the light dialogs.
- Lowest measured text, light: 6.49:1 (12px muted). Dark: 12.94:1. Both pass 4.5:1.
- Primary button text contrast was not computed (gradient background; the computed value, 1.04, is not valid). Visually the dark text on yellow is legible.

**Copy vs design-spec.**
- Header, sub-line, "Add Claude account", the two scope sentences, "No named Claude accounts yet.", chooser title and "This changes only the selected future route.", the Add dialog and the duplicate-directory sentence render verbatim.
- The duplicate error showed the exact spec sentence (mocked `conflict`).
- The status headings I saw in the drawer (e.g. "Held for release authorization") were not compared with every row of the spec's §3.5 table.

**Placement (D37).** The real run shows Accounts between the connection cards and the catalog hint (`real-dark-1600-window.png`). Screen-reader grouping under Connections: not verified (no accessibility-tree dump taken).

## Not captured, and why

- **Real empty state with a workspace.** The real launch with the worktree passed as the CLI argument did not register an active workspace, so the host list call never ran. The only real state rendered is the idle message in finding 5. The "empty" visuals (`empty-*.png`) are mocked host-shape data, not the real host.
- Loading skeleton, stale banner and a real `error` state from the real host: only the mocked error state was run (`error-dark.png`, `error-light.png`; text check "Could not load accounts. Retry."). I did not inspect those two images visually.
- Hover and active states, disabled Add, toast, reduced-motion, and the unavailable-resume dialog.
- Arrow-key behaviour in the drawer tablist (finding 2).
- Windows narrower than the shell minimum as a supported size; a true 400px embedded host container.
- Themes other than `ptah-glass` and `ptah-glass-light`; VS Code and TUI hosts (out of scope).
- The prototype was compared by copy grep and source reading plus the screenshots above, not by side-by-side render of `prototype/index.html`.

## Prototype fidelity

DEVIATES (minor): findings 1, 3 and 4. Layout tiers, component choice (badges, Manage outline buttons, one primary action), owner-evidence labels and the drawer tab set match.

# Command Center scene prototype — revision 2

Open `index.html` directly in Chrome or Edge. It is one offline HTML file with inline CSS, SVG and JavaScript. The toolbar is for design review only. Select dark/light, window size, 8/24/32/empty data, one of seven voice states and input/output levels. The 32-node option exposes the 23-node cap and split overflow wording.

## Screens and interaction

- The 1440, 1100, 900, 892 and 400px simulations use the actual scene container width. At 900/892/400px, source curves and four thick ribbons remain visible. Below a **340px scene**, the defined compact fallback hides only decorative connectors.
- The 24-node stream list scrolls through up to 23 placed nodes with 10/6/4/3 complete rows visible, depending on stage width. Scrolling, focus movement and resize remeasure SVG anchors in a coalesced animation frame. The link under the stream viewport focuses the full rail.
- Hover previews after 150ms without selection. Click/Enter/Space selects and pins. Escape closes the plate and restores focus to the trigger. Up/Down roves one scene tab stop; the rail has its own one-tab-stop list. Selection keeps existing row elements mounted.
- The plate shows display labels. It tries either side of the row only when the full plate fits clear of the stream, dial and cards. Otherwise it reserves space below the scene (wide) or between the stream and dial (stacked and compact). This keeps the plate clear at 1440 through the 340px fallback. The dial has static ticks and a tribunal stream shows phase progress and lane satellite cues. Voice states and levels affect the ring; reduced motion freezes animation and level scaling.
- In stacked layouts, a 24px gutter carries curves past the stream list before they bend to the dial. Four ribbons use ordered left/right start points. The 160px dial omits its inner voice caption; the stage header retains voice status. The empty data set hides the otherwise redundant “View all work” link.

## Deviations

- Theme literals are embedded from Anubis/Anubis-light so this one-file prototype works offline. Production must use semantic CSS variables for all picker themes.
- System fonts substitute when Inter, Cinzel or JetBrains Mono are absent. Counts, ages and voice levels are sample values; no host RPC or command submission runs.
- The source has no `parity-inventory.md` in this task folder. The detailed **Preserve list / parity contract** in `../design-spec.md` cross-references current scene code. Screenshots in `../review/` show the reviewer’s prior round. This revised prototype was checked in headless Chrome from helpers and screenshots under `%TEMP%/cc689b/`; the edit scope excludes new files under this prototype folder.

## Project rules applied

- [project-rule] Anubis/DaisyUI semantic base, surface, gold and status tokens; source: `apps/ptah-extension-webview/tailwind.config.js`, `src/styles.css`.
- [project-rule] The page owns the 336px rail and 16px gap; source: `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`.
- [project-rule] Projection IDs and ancestry drive placement; selected/failed/awaiting priority and 23-node cap; source: `libs/frontend/command-center/src/lib/scene/scene-layout.ts:71-114`.
- [project-rule] Hover is a 150ms preview and selection is click/keyboard; source: `libs/frontend/command-center/src/lib/components/command-overlay.component.ts:177-216`.
- [project-rule] Seven voice states and level-driven ring; source: `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:407-451`.

## Lane-introduced constraints

- [lane-proposed] Container breakpoints 340/680/960px, dial diameters 160/200/292px, and exactly 3/4/6/10 visible stream rows. Gate 1.7 review is required.
- [lane-proposed] Four aggregate status cards, active delegated-work count, 96 static dial ticks and 16/20px ribbons. Gate 1.7 review is required.
- [lane-proposed] Stacked routing gutter of 24px, ordered ribbon entry offsets of −0.65r/+0.65r/−0.35r/+0.35r, and `plate height + 56px` reserved placement space. Gate 1.7 review is required.

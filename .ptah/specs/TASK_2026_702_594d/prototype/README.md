# Chat start screen prototype

Open `start-screen.html` directly in a browser. It is a standalone HTML file with inline CSS, JavaScript, and SVG. No server, backend, npm package, or CDN is needed. The lower-right controls switch theme and screen state; query parameters also work, for example `start-screen.html?theme=light&state=partly-ready`.

States: `first-run`, `partly-ready`, `all-ready`, `running-cap`, `name-popover`, `reduced-motion`, `layout-warning`, `layout-warning-tiles`, `single-chat`, and `single-chat-ready`. The first two and `all-ready` have dark/light captures; the remaining captures emphasize the dark variant. Click New session for the trigger-anchored name popover. In `layout-warning` or `layout-warning-tiles`, switch the warning fixture or dismiss the inline notice. The populated state shows it above neutral bounds for the existing tile area. Use Enter/Create or Escape/Cancel in the popover, and click a readiness or setup action to see its route; when both counted items are ready, use the compact Ready strip for Run setup, Generate agents, and Project guidance, and click a recent card or Previous sessions to see its mocked outcome. These interactions are static fixtures, not live product state. `capture-screenshots.js` writes sixteen screenshots, including Aurora on normal and 280px single-chat captures in expanded and Ready states, to `screenshots/`; `check-contrast.js` measures rendered background pixels behind text.

## Deviations

- Prototype interactions use local fixtures in place of `ChatStore`, plugin catalog, setup RPC, wizard, and history dialog. The design spec names their production sources and guards.
- The all-ready sample assumes Skills and Agents are verified ready (2 of 2). Project scan is an uncounted Run setup action, including in the compact Ready strip.
- The single-chat fixture embeds a compact 128px WebP copy of the existing Ptah icon and shows illustrative prompt labels while preserving the real prompt-suggestions component in production. The prototype uses inline copies of the project theme values and surface formulas to stay self-contained, so no production CSS build is linked. Fonts fall back to system sans and Georgia if Inter/Cinzel are unavailable.
- Surrounding tab and rail chrome is present for context. The canvas dock is absent in all states under user decision #9; its warning texts use the dismissible board notice.

## Project rules applied

- [project-rule] The themes, `--bcm`, button fills, and gold values come from `apps/ptah-extension-webview/tailwind.config.js`.
- [project-rule] Raised checklist treatment mirrors `.surface-3` in `apps/ptah-extension-webview/src/styles.css:385-405`.
- [project-rule] Empty-board creation, rail history, cap reasons, shared name popover, setup routes, and dock-removal/notice parity come from `../parity-inventory.md` and `../task-description.md`.
- [project-rule] The local CSS Aurora adaptation and its pause rules follow `../decisions.md` #12 and the upstream `ngx-aurora.component.scss`; the full Omnedia MIT notice is in `aurora-notices.txt`.

- [project-rule] The single-chat order, existing logo, conditional setup card, prompt suggestions, and decorative footer come from `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` and `../task-description.md` AC10.

## Lane-introduced constraints

none.

See `../parity-inventory.md` and the complete row-by-row map in `../design-spec.md` for the retained capabilities. Gate 1.7 user approval is required before implementation.

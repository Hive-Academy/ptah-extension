# Attention notifications prototype

Open `notifications.html` directly in a browser. It is self-contained, offline, and does not use Ptah production code. The toolbar at the top center appears on hover or keyboard focus. It changes theme and state; URL query parameters also work, for example `notifications.html?theme=dark&state=permission`.

## States

`permission`, `question`, `lane`, `focused`, `stack`, `failure`, `failed-turn`, `git-warning`, `git-open`, `local-info`, `panel`, `empty`, `bell-badge`, `os-windows`, `vscode`. Theme is `dark` or `light`. The stack shows three of five requests and `+2 more`; at 800px it shows one and `+4 more`. The focused state keeps a count of one but suppresses its snackbar. The voice failure snackbar hides after eight seconds; live requests stay until action or presentation dismissal. Every permission card and row shows provider and tool name. If the tool name is unavailable in production, Allow is disabled and Open session remains available. Click the bell to open the panel; Clear all notices removes Recent notices and transient failure/warning snackbars while retaining live request snackbars and Needs you. The git snackbar appears only while the git surface is hidden; the git-open state shows its local strip instead. Buttons simulate routing or resolution, with no backend calls. Escape closes the panel and restores focus to the bell.

Run `node capture-screenshots.js` from this folder or with an absolute path to refresh 27 captures in `screenshots/`. The bell-badge close-up is a 240x110 crop of a 1440x900 state; two sidebar captures use 400x800 and the others use 1440x900 or 800x900. The capture script checks viewport sizes, horizontal overflow, snackbar/composer and snackbar/tab-bar collision, and WCAG AA text contrast pairs (at least 4.5:1) and warning/failure icon contrast (at least 3:1). Captures include dark and light permission, question, lane permission, focused request, three-card stack, voice and failed-turn failures, git warning and local Branch created toast, dark and light panel, empty panel, bell badge, Windows and VS Code mocks, 800px stacks in both themes, git surface open, and the 400px sidebar snackbar and panel.

## Project rules applied

- `[project-rule]` Dark and light DaisyUI theme colors, Inter font, and muted text values come from `apps/ptah-extension-webview/tailwind.config.js`.
- `[project-rule]` The `surface-3` hierarchy, border, and elevation direction come from `apps/ptah-extension-webview/src/styles.css` and the existing panel in `libs/frontend/notification-center/src/lib/notification-center.component.ts`.
- `[project-rule]` Existing bell placement and tabs follow the user-provided app screenshot; decision #13 removes the full canvas dock, including the ticker, chip, and its New Session action.
- `[project-rule]` Successful and neutral finished-turn rows and sounds are removed by the 2026-10-19 user decision in `../context.md`; the retained capabilities are mapped row by row in `../parity-inventory.md` and `../design-spec.md`.

## Lane-introduced constraints

- `[lane-proposed]` 348px snackbar maximum width, three-card stack with `+N more`, and upper-right canvas placement directly under the tabs.
- `[lane-proposed]` 340px panel width and compact Needs you / Recent notices arrangement.
- `[lane-proposed]` Eight-second failure, ten-second warning, and six-second local routine toast times; the prototype only simulates the failure timer.
- `[lane-proposed]` General host notice setting defaults on; failure host notices default off. The prototype shows eligible host content but does not persist a setting.

## Deviations

The file uses inline CSS/JavaScript instead of a generated Tailwind bundle because the requested deliverable is one self-contained HTML file. It embeds exact eager-theme color values, while some mock chrome dimensions, tab styling, and the panel/surface-3 approximation are local prototype geometry. All line icons are inline Lucide-style SVG paths; the OS and VS Code frames are illustrative because those hosts own their actual appearance. The mock board is a neutral background for placement review. The action buttons simulate completion and navigation; they do not represent RPC or permission handling.

Gate 1.7 is pending approval. Review the states and `[lane-proposed]` rules before implementation.

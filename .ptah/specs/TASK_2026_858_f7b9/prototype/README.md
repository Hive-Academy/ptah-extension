# Machines view prototype - TASK_2026_858_f7b9

Static, self-contained HTML/CSS/JS design artifact for the Electron Machines view (requirements 3, plus the UI parts of 1.8-1.9, 2.2-2.4, 4 and 6). Not an app review.

Project rules: Electron first (`apps/ptah-electron`); no TUI or VS Code feature work; no commits or pushes; verification only with `npm run verify -- -p <changed projects>` (none run here; no build, serve, dev, e2e or package targets).

## Open

`index.html` (file URL). Use the black bar at the top to switch state; "Theme" toggles dark/light. Hash form: `index.html#<state>` or `index.html#<state>&light`. States: `empty`, `add`, `pairfail`, `readiness`, `list`, `listRecon`, `stream`, `approval`, `approvalLost` (Phase 2), `approvalDenied` (Phase 1 neutral denial), `replay`, `owner`, `ownerHung`, `ownerUnavail`, `ownerFree` (watch-only session: driven elsewhere, holder not responding, lock unavailable, lock freed), `nofolders` and `nofoldersList` (no local folder: navbar shows only Machines). `narrow.html` shows two states in 400px frames (the narrow rules apply under 760px).

## Token sources

- Dark: theme `ptah-glass`; light: theme `ptah-glass-light` in `apps/ptah-extension-webview/tailwind.config.js` (base-100/200/300, base-content, `--bcm`, `--state-ink-*`, primary, radii 1.5rem / 9999px). Fonts from the same file (`Inter`, `JetBrains Mono`, `Cinzel` for the logo).
- Layout and tab strip mirror `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (global navbar tabs, workspace sidebar).
- Local CSS `prototype.css` re-declares those values because the app's production CSS purges unused classes. No new colour was invented. Derived values marked in the CSS: `--edge-ui` (input border, base-content mix so inputs reach 3:1) and `--rsm` (.375rem, Tailwind `rounded-md` as in `session-list-row.component.ts`, used for inputs and dense inline blocks).

## Screenshots (`screenshots/`, 1280x760, dark and light for each)

`01-empty`, `02-add`, `03-pairfail`, `04-readiness`, `05-list` (dark and light), `05b-reconnecting-skew`, `06-streaming`, `07-approval`, `07b-answered-elsewhere`, `07c-not-permitted`, `08-reconnect-replay`, `09-local-driver`, `09b-local-driver`, `09c-local-driver`, `09d-local-driver` (each as `-dark` and `-light`, eight files; regenerated for watch-only), `10-no-local-folder`, `10b-no-folder-machines`, plus `11-narrow-400-list-dark-and-light.png` (two 400px frames showing the active Machines tab and Open buttons). Taken with the `ptah_browser_*` tools in a headless browser. Embedded sidebar width is covered by the narrow rule set; a dedicated wide (>1600px) capture was not taken.

## Lane-introduced constraints

none. (The rules in the spec are tagged `[project-rule]` with a source, or are open decisions in `design-spec.md`. Nothing here is a proposed ban on an existing component.)

## Gate 1.7

Not yet passed. Needs the cross-side reviewer's APPROVED, or the user's APPROVED, before implementation. Nothing in this prototype is an app screenshot; it uses sample data (Horus, Anubis, Chappie, Gatsby-lab are the machines named in `task-description.md`).

## Known prototype limits

- Static: the pairing cells, buttons and rows do not act; hover/focus styles are real CSS and can be tried with Tab.
- Motion (spinner on Reconnecting, caret) is shown live; with `prefers-reduced-motion: reduce` both become static (CSS included).
- "Theme / notifications" at the right of the navbar is a placeholder for the existing `ptah-theme-toggle`, notification centre and config actions.

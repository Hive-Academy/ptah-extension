# Prototype - TASK_2026_701_9e4b (revision 1)

Open `index.html` in a browser. Static, no build. Each page has a theme toggle (`?theme=anubis` or `?theme=anubis-light`).

| Page | Shows |
| ---- | ----- |
| `wizard-preview.html` | Wizard-view modal: target choice (reload + reset), backend warnings, "Exists - may be replaced" rows, forced-keep unreadable row, informational rival-CLI targets, states, host copy matrix |
| `sidebar.html` | Generation sidebar context (source status, model picker, selection controls) and its preview dialog with "Change" target; live focus cycle |
| `packs.html` | Both pack entry surfaces, target choice before every install, prompt with/without conflicts, results per host, primary failure |
| `marketplace.html` | Installed view (header, search, 3 ordered groups, inspector, states), consent dialog with every block, busy/failure, report, installer families and repair route |
| `library.html` | One fixture shared with Marketplace, provenance mapping, states, model editor |
| `completion.html` | Completion and sidebar next steps: outcomes, diverged naming, grade copy, variants, VS Code |
| `focus.html` | Keyboard focus on the keep/replace control, both themes |

Interactive: keep/replace radiogroups (arrows, Space/Enter; forced-keep rows reject Replace), Keep all / Replace all, "What changes", target buttons (reload, reset to Keep), "Change", dialogs (opener, Tab confinement, Escape, focus restore: "Open preview dialog", "Generate 7 agents", "Install All", "Update Acme Toolkit", "Review and replace..."), tabs, Marketplace roving rows (Up/Down/Home/End), inspector (Enter / Escape), search, Uninstall (Removing... then error).

Tokens come from the `anubis` and `anubis-light` themes in `apps/ptah-extension-webview/tailwind.config.js` and `styles.css`; CSS is hand-written to mirror daisyUI classes (no node_modules in the worktree). Screenshots: `screenshots/` (1280 px and 400 px, dark and light), listed in `design-spec.md` section 8.

## Parity cross-reference (parity-inventory.md lines)

24-32 wizard-preview A, sidebar A; 33-35 spec 3.1; 36-44 wizard-preview A/A0/B; 45-51 sidebar A (source status, model picker, selection controls, Generate); 52-57 sidebar A/B/C; 58-64 packs A-D; 70-85 marketplace A/B; 86-95 marketplace C/D/E; 96-103 marketplace F/G; 104-105 library A/B.

## Rule provenance

[user-requested]: default Keep with explicit file replacement; Electron-only Library (D3, no VS Code Library UI).
[project-rule]: Anubis tokens and daisyUI-style classes (tailwind.config.js, styles.css); status as text not colour; solid warning fill with warning-content; keyboard access and path-inclusive accessible names; one primary action per surface; existing capabilities remain (parity-inventory.md).
[approved elaboration] (PM6, PM10, PM12-PM14): changed-since-preview protection, provenance fallback, edited-managed protection, host copy mapping.

## Lane-introduced constraints

- [lane-proposed] Outer 2px `base-content` focus ring with 2px offset on the keep/replace control, plus a check mark on the selected segment.
- [lane-proposed] Keep/replace and target choice are radiogroups of buttons so they stay inside the sidebar dialog focus trap; forced-keep Replace uses `aria-disabled`.
- [lane-proposed] Segmented-control radius `--rseg` (.375rem dark, .5rem light) is a deviation from the light theme button radius (2rem).
- [lane-proposed] Diff rows: 14% success/error mixed into surface-1 (sRGB) with base-content text, `+`/`-` markers.
- [lane-proposed] Bulk Replace all without a second prompt; pack prompt always opens (it carries the target choice); collapsed "Change" in the sidebar; Library refresh status line; exact copy strings; result-to-repair route.

## Revision 2 (Gate 1.7 round 2)

Inspector follows the selected row and search is word-wise (marketplace.html A); every pack entry opens the shared install dialog with pack/file scope (packs.html A, C); the repair prompt is bound to its installer family including release-manager.md (marketplace.html F); the sidebar starts on Keep (sidebar.html A); sync warnings follow the displayed target (wizard-preview.html, sidebar.html B). `?open=<key>` opens a state for screenshots only. Lane-introduced constraints: none new.

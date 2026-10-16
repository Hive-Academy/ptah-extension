# TASK_2026_649 prototype: AI Team Builder / New Project builder page

Static, dependency-free prototype of the builder page described in `../design-spec.md`
(page = shared chat stand-in + the existing builder sidebar, plus the shared leave dialog and the
Setup Hub changes). All data is example data. It uses the project's real Anubis tokens
(`assets/tokens.css`, dark `anubis` and light `anubis-light`) and a Lucide sprite
(`assets/sprite.js`). The chat column is a labelled stand-in because the real
`<ptah-session-embed>` is not part of this design.

## Open it

- Builder page: open `index.html` in any browser (double click works; fonts fall back to system
  fonts offline).
- Setup Hub excerpt: open `hub.html`.
- Every state is a URL query string, e.g. `index.html?theme=light&chat=idle&apply=ready`.
  Parameters you omit take the defaults shown in bold.

## URL parameters

### `index.html` (builder page)

| Param | Values | What it sets |
| ----- | ------ | ------------ |
| `theme` | **dark**, light | Theme (`anubis` / `anubis-light`) |
| `kind` | **configure**, newproject | "AI Team Builder" (Configure Harness) or "New Project Setup" (adds the Stack profile section) |
| `chat` | **streaming**, idle, empty, ask | Agent running, idle, no messages, or waiting on a question and a permission request |
| `apply` | none, **partial**, ready, blocked, applying, applied, error | Apply section state (spec 5.2) |
| `files` | short, all | Applied result file list: first rows or all 7 (with Copy list) |
| `health` | **ok**, issues | Health line after apply |
| `stack` | **warn**, ok | Stack profile: older-than-minimum toolchain warning or clean (New Project) |
| `ai` | **idle**, mixed, nopersona, doc | AI helper states: all idle, result/busy/error mix, needs-persona disabled, generated document |
| `preset` | open, saved, loaded, error | Presets: save form open, saved confirmation, preset loaded, save error |
| `sess` | open | Session section expanded |
| `init` | ok, loading, error | Builder setup (spec 5.8) |
| `hydr` | ok, loading, restored, failed, unavailable, stackgone | Proposal restore after reload (spec 5.4) |
| `empty` | 0, 1 | No configuration yet |
| `pin` | 0, 1 | "Pinned" badge in the header |
| `sb` | open, closed | Sidebar: docked panel (wide) or sheet over the chat (narrow) |
| `notice` | resumed | Page notice strip under the header (spec 6) |
| `launch` | err | Builder-instructions-failed notice |
| `page` | missing, wrongkind | "Session no longer open" card, or the "not an AI Team Builder session" card (spec 5.8) |
| `dlg` | `start-over.running`, `.pending`, `.busy`, `.error`, `.idle` | Shared leave dialog and its variants (spec 7.1) |
| `draft` | 0, 1 | An earlier saved draft exists (adds the "replaces it" note in the dialog) |
| `aside` | full | Capture helper: show only the sidebar at full height (used by `*-sidebar-full-*` shots) |

Narrow layouts come from the viewport: resize the window below 720 px of page width (the layout
reacts to the container, not the viewport), or run a capture at 400 / 360 px.

### `hub.html` (Setup Hub excerpt)

`hub` = **draft**, none, resume, conflict, resumeconflict, delete, abortwarn, draftmissing,
openfailed, relay. `theme` as above.

## Re-capture screenshots

Needs Playwright from the worktree's `node_modules` (override with
`PLAYWRIGHT_ENTRY=<path to playwright/index.mjs>`). Run from the repository worktree:

```
node .ptah/specs/TASK_2026_649_33c4/prototype/assets/capture.mjs shots [name-filter]
node .ptah/specs/TASK_2026_649_33c4/prototype/assets/capture.mjs checks
node .ptah/specs/TASK_2026_649_33c4/prototype/assets/contrast-check.mjs
```

- `shots` writes `screenshots/*.png`. With `name-filter`, only shots whose name contains it are
  refreshed (e.g. `leave-dialog`, `sidebar-full`, `narrow-400`). Console errors are listed per page.
- `checks` drives a real keyboard: dialog role/aria, focus trap, Escape, focus return, sheet
  Escape, `inert` on covered content, a dialog opened over the open sheet (trap, derived `inert`
  restored, focus return), focus return when the sheet closes with focus inside, no horizontal scroll at 400 / 360 px, and 24 x 24 px targets.
- `contrast-check.mjs` measures the contrast pairs listed in design-spec section 9.
- `*-sidebar-full-*` shots render the page at 1280 px wide (so the sidebar uses its docked layout)
  and clip to the sidebar box at its full scroll height.

`gen-sprite.mjs` rebuilds `sprite.js` from the Lucide icons used.

## Screenshots

Viewports: wide = 1280 x 820 (applied shots 1280 x 1120), narrow = 400 x 860 (360 x 760 where
named), Hub = 1100 x 760, sidebar-full = 336 px wide at full height.

| Screenshot | Design-spec section |
| ---------- | ------------------- |
| `dark-configure-building-wide`, `light-configure-building-wide` | 3 Page anatomy (agent running, partial preview), 5.2 |
| `dark-configure-ready-wide`, `light-configure-ready-wide` | 3, 5.2 (ready to apply) |
| `dark-configure-applying-wide` | 5.2 (applying) |
| `dark-configure-apply-blocked-wide` | 5.2 (Apply blocked while the agent runs) |
| `dark-configure-apply-error-wide` | 5.2 (Apply failed, error with retry) |
| `dark-configure-applied-wide`, `light-configure-applied-wide` | 5.2 (applied: files, warnings, health) |
| `dark-configure-applied-health-issues` | 5.2 (health issues) |
| `dark-configure-pin-badge-wide` | 3 (pin badge) |
| `dark-configure-sidebar-closed-ready-dot` | 3 (panel hidden, "ready" dot on the toggle) |
| `dark-configure-empty-wide` | 4, 5.4 (first screen: normal composer placeholder, builder guidance in the sidebar, D6) |
| `dark-configure-init-loading`, `dark-configure-init-error` | 5.8 (setup states) |
| `dark-page-session-missing`, `dark-page-wrong-kind` | 5.8 (session missing card, wrong session kind card) |
| `dark-newproject-stack-unavailable` | 5.3 (stack profile details unavailable fallback) |
| `dark-configure-hydrating`, `light-configure-proposal-unavailable`, `dark-configure-proposal-restore-failed` | 5.4 (restore states) |
| `dark-configure-launch-error` | 6 (builder instructions failed) |
| `dark-configure-draft-resumed` | 6 (draft resumed) |
| `dark-newproject-stack-profile-wide`, `light-newproject-stack-profile-wide` | 3, 5.3 (stack profile) |
| `dark-sidebar-full-configure-ai-helpers`, `light-sidebar-full-configure-ai-helpers` | 5.1, 5.5, 5.7 (whole sidebar) |
| `dark-sidebar-full-newproject-stack` | 5.1, 5.3, 5.5 (needs-persona disabled helpers) |
| `dark-sidebar-full-presets-save-form` | 5.5 (generated document), 5.6 (save form validation) |
| `light-sidebar-full-presets-saved` | 5.6 (saved confirmation) |
| `dark-sidebar-full-preset-loaded` | 5.6 (preset loaded) |
| `dark-leave-dialog-start-over`, `light-leave-dialog-start-over` | 7.1 (leave dialog, agent running) |
| `dark-leave-dialog-save-pending` | 7.1 (nothing to save yet) |
| `dark-leave-dialog-saving` | 7.1 (saving, buttons busy) |
| `light-leave-dialog-save-failed` | 7.1 (save failed) |
| `dark-leave-dialog-new-project-from-hub`, `light-leave-dialog-resume-from-hub` | 7.1, 7.2 (dialog opened from the Hub) |
| `dark-hub-resume-draft`, `light-hub-resume-draft` | 7.2 (draft card) |
| `dark-hub-new-project-resume` | 7.2 (New Project in progress) |
| `dark-hub-delete-draft-confirm` | 7.2 (delete draft confirm) |
| `dark-hub-abort-warning` | 7.2 (agent may still be running) |
| `dark-hub-draft-session-missing` | 7.2 (draft whose chat session is gone) |
| `dark-hub-open-failed` | 7.2 (launcher failed) |
| `dark-hub-relay-cancelled` | 7.2 (legacy relay with a conflicting mode) |
| `dark-narrow-400-closed-peek`, `light-narrow-400-closed-peek` | 8 (peek bar) |
| `dark-narrow-400-sheet-open`, `light-narrow-400-sheet-open` | 8 (sheet) |
| `dark-narrow-400-needs-answer` | 8 (New Project, question pending, sheet closed) |
| `dark-narrow-400-newproject-sheet` | 8 (New Project sheet) |
| `dark-narrow-360-sheet-applied` | 8 (360 px, applied) |
| `dark-narrow-400-leave-dialog` | 7.1, 8 (dialog at 400 px) |

## Notes

- Lane-introduced constraints: see design-spec section 13. This prototype adds none beyond those.
- `inert` on the covered chat column (sheet open) and on the page behind the dialog is part of the
  prototype and covered by `capture.mjs checks`; it does not change any screenshot.

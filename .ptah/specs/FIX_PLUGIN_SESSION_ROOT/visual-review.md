# Visual Review - FIX_PLUGIN_SESSION_ROOT (PR #868, "after" only)

Verdict: PASS (no visual-breaking or serious findings; 2 moderate, 2 minor). Score 8/10. Electron only.

## Environment

- Worktree `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root`, branch `fix/plugin-session-root`, head `3418112b3`.
- Build: `node scripts/verify.mjs --exec --task visual-868 -- npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron` (2 tasks succeeded, main.mjs 17:02). During the build the worktree briefly had uncommitted edits from another session in `plugin-catalog-panel.component.ts` (a `result.data?.success === false` save-error branch) and `plugin-rpc.handlers.ts` (a comment). By the end the tree was clean. The bundle I reviewed may or may not include those two edits. Neither touches the notice or note markup.
- Launch: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs` (the same path as `apps/ptah-electron-e2e`), `NODE_ENV=test`, `PTAH_E2E=1`, with `HOME` set to a temp dir, a temp `--user-data-dir`, and temp `PTAH_DB_PATH` / `PTAH_SESSIONS_DB_PATH`. The real `~/.ptah` was only read (the plugins folder was copied).
- Scenario (all under `/tmp/ptah868`):
  - Project `/tmp/ptah868/proj` (git repo, plugin `ptah-angular` enabled).
  - Worktree `proj/.claude-worktrees/feat-very-long-worktree-directory-name-for-overflow-check-0123456789` (a 126-character path to stress overflow).
  - The worktree has its own saved config: `ptah-react` on, skill `react-best-practices` off. It has a `.ptah/` folder, as a real checkout of this repo would.
  - Two sessions in the temp `sessions.sqlite`, plus matching Claude CLI jsonl files under the temp home. "Worktree session" has `workingDirectory` set to the worktree. "Main project session" does not.
  - The real RPC `plugins:get-config {sessionId}` returned the expected `sessionNotice` for the worktree session: 2 overrides, `inheritsProjectSettings: true`.
- Themes: `anubis` (Dark family) and `anubis-light` (Light family), chosen through the theme popover. The default Glass theme was not captured.
- Viewports: window 1200x800 (inner 1200x774) and 600x800 (inner 600x774). There is no documented support policy, so these are an audit selection.
- Scripts are in `/tmp/ptah868/scripts/` (`capture.cjs`, `capture2.cjs`, `capture3.cjs`).

## Screenshots

All files are in `screenshots/` next to this report.

| File | Theme | State |
| --- | --- | --- |
| a-notice-dark-1200.png | dark | (a) Plugins panel (Marketplace > Ptah Plugins), worktree tab active, notice shown, 1200 |
| a-notice-dark-600.png | dark | (a) same, 600 |
| a-notice-light-1200.png | light | (a) 1200 |
| a-notice-light-600.png | light | (a) 600 |
| b-chat-after-switch.png | dark | Main project session opened as the active tab |
| b-no-notice-dark-1200.png | dark | (b) panel after switching to the main-project session: no notice |
| b-no-notice-light-1200.png | light | (b) same |
| c-save-note-dark-1200.png | dark | (c) post-save note in the panel footer |
| c-save-note-dark-600.png | dark | (c) 600 |
| c-save-note-light-1200.png | light | (c) |
| c-save-note-light-600.png | light | (c) 600 |
| c-save-focus-dark-600.png | dark | Keyboard focus on Save with the note shown, 600 |
| c-save-focus-light-600.png | light | same |
| d-card-before-dark.png | dark | Dashboard (Analytics tab) skill card before choosing |
| d-card-before-light.png | light | same |
| d-dialog-dark.png | dark | "Configure Ptah Skills" dialog opened from the card |
| d-dialog-light.png | light | same |
| d-card-saved-dark-1200.png | dark | (d) note under the card after Save, 1200 |
| d-card-saved-dark-600.png | dark | (d) 600 |
| d-card-saved-light-1200.png | light | (d) |
| d-card-saved-light-600.png | light | (d) 600 |

## Findings

### Moderate

1. Mid-word breaks in the notice text.
   - File: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:235,240,245`. All three variants put `break-all` on the whole paragraph.
   - Evidence: `a-notice-light-1200.png` shows "Its folder se / ts these itself". `a-notice-dark-1200.png` breaks "fol/der". `a-notice-*-600.png` breaks the path as "very-lon / g-worktree". Computed `word-break: break-all`.
   - Impact: ordinary prose splits mid-word at every width, so it reads as broken.
   - Fix: use `[overflow-wrap:anywhere]` (or `break-words`) on the paragraph. If you want the path to wrap at any character, put it in a `<code class="break-all">` span.
2. The notice is not amber, and the incomplete-lineage warning has no visual weight.
   - File: `plugin-catalog-panel.component.ts:230` (`border-base-300 bg-base-200/30 ... text-base-content-muted`) and `:267-271`.
   - Evidence: the notice is neutral grey in both themes. The brief says "read-only amber notice" and an "incomplete lineage warning variant". The warning is only one extra muted line with no warning colour or icon.
   - Impact: a layer that could not be read looks as calm as the informational case. It also deviates from the stated design. There is no design handoff for this task, so I rate it moderate.
   - Fix: use warning tokens (for example `border-warning/40 bg-warning/10`) and an icon, at least for `incomplete`. This variant was not rendered here (see below).

### Minor

3. At 600px the post-save note in the panel footer wraps to 5 lines in a narrow centre column between the "1 of 6 selected" text and the Save button (`c-save-note-*-600.png`, note box 220x80). Nothing overflows, but it is cramped. Consider a separate full-width row (`plugin-catalog-panel.component.ts` ~L589-598, `flex-1` footer).
4. The dashboard at 600px shows a horizontal scrollbar at the bottom (`d-card-saved-dark-600.png`). `document.scrollWidth` equals the viewport width, so some inner container scrolls. The save note (494px wide) is inside its card, so I could not attribute this to the change. I did not capture a "before", so this is unverified and probably pre-existing.

## Checks that passed

- Overflow: the notice's `scrollWidth` is at most its `clientWidth` (852/854 at 1200, 436/438 at 600). The 126-character path wraps inside the box, with no horizontal page scroll in the Plugins panel at either width (`docScrollW == docClientW`).
- Contrast, measured with canvas-composited colours:
  - Notice: dark 5.93:1 (fg rgb 152,146,145 on rgb 21,21,26), light 5.84:1 (fg rgb 116,86,101 on rgb 246,243,240). Both meet AA 4.5:1 for 12px text.
  - Save note: same text colours (`text-base-content-muted`) on the same panel surfaces, so about the same ratios. I did not measure it separately.
  - Dashboard note: 14px, same muted colour, on `surface-2`. Not measured separately.
- Semantics: the notice is `<section role="status">` with 0 focusable children. The post-save notes are also `role="status"`. The Save button shows a clear focus ring in dark and light (`c-save-focus-*`).
- Notice cleared: after switching to the Main project session the notice element is absent (`metrics.notice === null`, `b-no-notice-*`).
- The dashboard card note renders in both themes, with no overflow at 600 (494px wide inside the 600 viewport).
- Contents: the notice lists "Ptah React: on" and "react-best-practices: off" with plugin names resolved. The copy is clear.

## Not rendered, and why

- Live clear on a tab switch while the panel stays mounted. The Marketplace view hides the Sessions rail, so I switched tabs in Chat and then re-opened the panel. This proves a fresh mount with the main tab shows no notice. It does not exercise the same-instance effect (`plugin-catalog-panel.component.ts:799-822`).
- The "does not use this project's plugin settings" variant, the "no overrides" variant, the "and N more" line (more than 10 overrides) and the incomplete-lineage warning. Only the override-list variant was seeded.
- The dashboard dialog never showed the session notice (`dialog notice present 0`). The active tab in that run was the main-project session, so this is expected. I did not repeat it with the worktree tab active.
- The default Glass theme, and any "before" state (by instruction).
- Scenario caveat: a worktree under the project without its own `.ptah/` folder resolves to the project as its harness root. Before I added `.ptah/` the notice came back with no overrides (the worktree's saved config was not seen). This is backend behaviour, not UI.

## Cleanup

All state is in `/tmp/ptah868` (temp home with the copied plugins, `sessions.sqlite`, `ptah.sqlite`, the user-data dir, the scratch project and worktree, the scripts and `app.log`). Run:

```
git -C /tmp/ptah868/proj worktree remove --force /tmp/ptah868/proj/.claude-worktrees/feat-very-long-worktree-directory-name-for-overflow-check-0123456789
rm -rf /tmp/ptah868
```

No tracked source was edited. `dist/apps/ptah-electron` was rebuilt and is git-ignored. The screenshots are untracked files under `.ptah/specs/FIX_PLUGIN_SESSION_ROOT/screenshots/`. The real `~/.ptah` and `~/.config/Ptah*` were not written. One `NODE_ENV=development` probe wrote only under the temp HOME.

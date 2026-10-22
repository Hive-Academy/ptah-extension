# Electron visual review — run 4

**Verdict: REVISE — 6/10.** Rail and bell permission hierarchy now match the approved one-primary pattern. Snackbar density improved, but its fixed desktop position still blocks the composer and the two-card stack masks Git. This is above run 3's 4/10 and the 3–4 band because both rail action hierarchy and narrow composer occlusion are fixed; it stays in the 5–6 band because a core input remains covered. It is below 7–8 because the remaining overlap occurs in normal captured states, in both themes.

## Build and evidence

`npx nx build ptah-extension-webview --parallel=1` exited 0; `node apps/ptah-electron/scripts/copy-renderer.js` then copied the build. `dist/apps/ptah-electron/renderer/main.js` had a fresh `2026-10-21T01:07:56.2482666Z` timestamp; `dist/apps/ptah-electron/main.mjs` existed, so no main build was needed. The one `shoot-populated.cjs` run exited 0 with **24/24 shots, zero errors, `portFreeAfter=true`, `tempRemoved=true`** in `visual-check/capture-results-2.json`. An independent listener check found port 9347 free. All 24 PNGs below were opened. Comparison source: approved `rail-redesign/prototype/screenshots/full.png` and `rail-redesign/design-spec.md`; the user's subsequent compact snackbar requirement takes precedence over the prototype's tall three-card stack.

Required key shots:

- Dark rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png`
- Light rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png`
- Best dark snackbar, single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`
- Best light snackbar, single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png`

## Run-3 defect and feedback status

| Item | Status and evidence |
| --- | --- |
| Permission queue and bell lack filled primary | **Fixed.** Both rail and both live bell shots show one filled Allow, one row of visible actions, and More. `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:13-30`. Needs you stays inside its framed queue card, kind precedes title, and no round floating badge appears. |
| Snackbar stack covers Stats | **Partly fixed.** Two cards replace three and move left. The stack still covers about 82 px of Stats' left edge at 1440×900 and masks the Git heading/branch area near y=655–710 in both theme stack shots. A single card touches Stats' empty lower area but does not hide its content. |
| 800 px snackbar covers composer | **Fixed in the captured 800×900 states.** The card is at about x=432–784, y=571–660; the composer begins near y=727, leaving ~67 px clear. Only one card is shown. |
| User's snackbar size/balance feedback | **Partly addressed.** Cards are ~352 px wide, have title/kind and a close control on row one, metadata left and action right on row two, with no visible disabled-reason row. The single card is ~89 px high, still ~17–25 px above the requested 64–72 px. Dark and light card text is legible in the screenshots; disabled Show in canvas looks faint, with its reason available through tooltip/ARIA in source at `notification-snackbar.component.ts:52-66`. |

## Findings

1. **Visual breaking — desktop snackbar blocks the composer.** At 1440×900 a single card occupies about x=800–1152, y=731–820, covering roughly **228 × 89 px** of the composer at x=552–1028, including the right side of its prompt/input surface. This occurs in both [dark single](../visual-check/dark-snackbar-permission.png) and [light single](../visual-check/light-snackbar-permission.png), and both stack shots. Likely cause: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the host `bottom: 5rem; right: 18rem` over the central content; line 31 sets card padding and lines 45–62 keep the second action row within that footprint.
2. **Serious — the two-card desktop stack still obscures Git.** In [dark stack](../visual-check/dark-snackbar-stack.png) and [light stack](../visual-check/light-snackbar-stack.png), the upper card starts near y=643 and runs to ~731, crossing ~82 px into Stats from x=1070–1152. It masks the left part of Git's heading/branch line around y=655–710. Agents and Todos content stays clear. The stack's `+4 more` indicator sits in Stats near y=620. Likely cause: the same fixed host placement at `notification-snackbar.component.ts:20`, combined with two-card limit and overflow control at `:95-97` and `:73-76`.
3. **Moderate — compact card still exceeds the requested height.** Both [dark single](../visual-check/dark-snackbar-permission.png) and [light single](../visual-check/light-snackbar-permission.png) measure about **89 px high**, above the requested 64–72 px. This adds to the composer overlap. The content is two rows with balanced left/right placement and a visible close button; the gap is density rather than a missing control. Likely contributors: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:31,45,52` (padding, row gap, 36 px action minimum height). The header's 10 px kind label at `:38` remains small but readable in these shots; no separate contrast failure is asserted.

## Shot inventory

Every path is absolute. “Fail” denotes the overlap or density findings above; “Pass” is limited to the state actually pictured.

| Screenshot | Theme | Viewport | Result | Note |
| --- | --- | --- | --- | --- |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png` | dark | 1440×900 | Fail | Single card covers composer; ~89 px high. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-question.png` | dark | 1440×900 | Fail | Question card covers composer; title and close visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-lane.png` | dark | 1440×900 | Fail | Lane card covers composer; action right aligned. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-failure.png` | dark | 1440×900 | Fail | Failure card covers composer; text legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png` | dark | 1440×900 | Fail | Two cards cover composer and part of Git. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-bell-badge.png` | dark | 1440×900 | Fail | Bell count visible; same two-card overlap. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel.png` | dark | 1440×900 | Pass | Bell rows show titles; scroll contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-clear-all.png` | dark | 1440×900 | Pass | Recent cleared; pending retained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-empty.png` | dark | 1440×900 | Pass | All clear state visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png` | dark | 800×900 | Pass | One card, above composer; covers central sample content. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png` | dark | 1440×900 | Pass | Filled Allow, More, kind first, card contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png` | dark | 1440×900 | Pass | Live bell row title, filled Allow and More visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png` | light | 1440×900 | Fail | Single card covers composer; ~89 px high. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-question.png` | light | 1440×900 | Fail | Question card covers composer; title and close visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-lane.png` | light | 1440×900 | Fail | Lane card covers composer; action right aligned. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-failure.png` | light | 1440×900 | Fail | Failure card covers composer; text legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png` | light | 1440×900 | Fail | Two cards cover composer and part of Git. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-bell-badge.png` | light | 1440×900 | Fail | Bell count visible; same two-card overlap. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel.png` | light | 1440×900 | Pass | Bell rows show titles; scroll contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-clear-all.png` | light | 1440×900 | Pass | Recent cleared; pending retained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-empty.png` | light | 1440×900 | Pass | All clear state visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png` | light | 800×900 | Pass | One card, above composer; covers central sample content. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png` | light | 1440×900 | Pass | Filled Allow, More, kind first, card contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png` | light | 1440×900 | Pass | Live bell row title, filled Allow and More visible. |

## Limitations

The capture covers Electron at 1440×900 and 800×900 in dark and light themes. It does not exercise a ~400 px viewport, another browser, keyboard focus, opening the More menu, a submitted permission response, hover tooltip timing, or measured resolved-color contrast. The stack uses synthetic projections, while the rail and live bell use a real `permission:request`; both are captured from the copied current renderer. No application source was edited. No static image establishes layout shift during interaction.

## Decisions

- **Decision:** Keep a placement defect open despite the smaller two-card limit. **Options:** count lower card count as resolution, or require active controls to remain unobscured. **Evidence:** paired single and stack shots show composer and Git overlap; source fixes the host at `notification-snackbar.component.ts:20`. **Reversible:** yes.
- **Decision:** Treat the 800 px composer issue as fixed for this run's captured state. **Options:** retain the old finding, or close it for the tested viewport while noting other widths are untested. **Evidence:** paired 800 px shots show ~67 px vertical separation. **Reversible:** yes.

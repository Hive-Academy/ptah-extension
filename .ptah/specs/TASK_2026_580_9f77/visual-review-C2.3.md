VERDICT: APPROVED

Score: 8.5/10

Counts: visual breaking 0, serious 0, moderate 1, minor 2.

# Visual Review - TASK_2026_580_9f77 Batch C2.3 ("Sessions (N)" section in the task detail panel)

## Environment

- Build: `npx nx build ptah-extension-webview --configuration=development` in the worktree with the uncommitted C2.3 files (`task-detail.component.ts` and its spec); HEAD already contains C2.1 (open-session bridge). Served from `dist/apps/ptah-extension-webview/browser` by a throwaway Node server on 127.0.0.1; Playwright Chromium. Electron was not launched.
- Host stub: VS Code-style host with `workspaceRoot`; mocked `tasks:board`, `tasks:get` (full detail) and `session:listForTasks` (available with links, `{available:false}`, or delayed 1500 ms). Session ids are UUIDs (the open bridge rejects non-UUIDs).
- Fixtures: D1 no sessions and no files; D2 three sessions (generating with PR #42 https and PR #43 http, idle with no PR, not-open with a very long name and a PR without a number); D3 eight sessions (long names, mixed phases including failed, background, sleeping, not open, three PR links on one row).
- Themes `anubis`/`anubis-light`; viewports 360, 800, 1400 (audit selection; the repository documents no matrix). Evidence: `visual-c23/` (screenshots, `results.json`, `c23.mjs`).

## Findings

### Moderate

1. At 360px the whole detail panel sits 13px right of the viewport edge and is 359px wide, so its right edge (including each row's "Open session" button) is cut off 12px past the viewport (`after-many-anubis-light-360.png`: "Open session" touches the edge; the Context rows' external-link icons and the header close button are cut the same way). The section itself does not overflow (rows 0 overflow, parent `scrollWidth` equal to `clientWidth`, no document overflow). This is the existing panel container, equal for D1 with no sessions, and not introduced by C2.3, but the new button is in the clipped zone. Fix belongs to the detail container (it should be `w-full` of the viewport at narrow widths), not the section.

### Minor

2. Layout growth when links arrive: the section is rendered from the first paint (same DOM node before and after, `sameNode: true`), but it grows from 38 to 204 px with 3 rows, so Files moves 806 to 972 (CLS 0.0138, both themes, 1500 ms delayed map, `shift-before-*.png`, `shift-after-*.png`). In practice the board-wide map usually landed before the detail opens. Not blocking.
3. The first stop in the tab order after a programmatic focus shows no ring (`:focus-visible` false for focus set by script). Keyboard-reached stops all show the 2px ring; reported only so it is not mistaken for a defect.

## Checks that passed

| Area                | Result                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows, dots          | 10px dot with `border-base-content/70` ring, named `role="img"` "Live phase: <phase>". Ring against the detail background: 6.21:1 light, 7.68:1 dark (all phases, the not-open dot is the hollow ring at the same value; ring over fill 9.5 to 12.7). Fill alone is 2.37 to 2.59 light, so the ring carries it, as on the C2.2 card.                           |
| Meta line           | "Primary · started from the board · running", "Related · linked by an agent · idle", "Related · linked by you · not open"; contrast 5.01:1 light, 5.31:1 dark (at least 4.5); section title and empty text use the same muted token.                                                                                                                           |
| Names               | Truncate with `title` (the 150-character name truncates, short names do not); "Open session <full name>" aria-label.                                                                                                                                                                                                                                           |
| PR links            | https numbered PR: "#42 · open", 80x24 link with 15.92:1 (light) and 14.86:1 (dark) contrast, underlined. Numberless https: "PR". Non-https (http): "#43 (not linked)" as plain muted text, 5.01/5.31:1, not focusable, no anchor. Three PRs on one row wrap cleanly. "No pull request" italic muted state on rows with none.                                  |
| Open session button | 82x24, inside the row; 2px focus-visible ring (`oklch(0.7665 0.1387 91.06)` dark, `oklch(0.58 0.132 75)` light), `focus-1-anubis-1400.png`.                                                                                                                                                                                                                    |
| Empty state         | "No sessions linked to this task" is `text-[11px] italic text-base-content-muted`, 11px, same classes and colour as the Files empty "No files in this task folder yet" (5.31/5.01:1), and the "Sessions (0)" title matches "Files (N)" (12px, 5.31/5.01). Same for `{available:false}` (VS Code host): empty line, no error.                                   |
| Many sessions       | Eight rows with long names at 360, 800, 1400: no row overflow, no document overflow; section 510px tall, only vertical scroll.                                                                                                                                                                                                                                 |
| Keyboard order      | Row 1 PR link, Open session; row 2 Open session; row 3 PR link, Open session; then the Files buttons. Plain-text unlinked PR is skipped.                                                                                                                                                                                                                       |
| Open session bridge | With the C2.1 bridge and a UUID session id: click sets the app view to `chat` (from `tasks`), the Tasks view and detail are hidden, and `session:load`, `session:cli-sessions`, `session:status` are called for that session id (grid layout canvas path). Verified at 360 and 1400 in both themes. A non-UUID id silently does nothing, so ids must be valid. |
| Console             | 0 errors in every run.                                                                                                                                                                                                                                                                                                                                         |

## Prototype fidelity

No prototype exists for this task (plan :973). Compared with plan component 12 and the C2.2 card: the dot style, phase wording and "not linked" handling match; no regression to the Workflow or Files panels (positions unchanged apart from the Sessions section between them).

## Verdict

APPROVED. No breaking or serious defect. One moderate item is the 360px clipping of the detail panel container, which also affects the new button but belongs to the existing panel. Confidence: HIGH (computed values, both themes, three widths, real bridge). The score would reach 9.5 once the container clipping is fixed.

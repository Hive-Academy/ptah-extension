# Visual Review (BEFORE) - TASK_2026_586_2b3e

Baseline capture at base commit `c4ab013f3` (origin/main, no fix). No verdict is issued; this run records the defects the fix must remove and how to reproduce the shots.

## Environment

- Rendering path: Playwright harness `libs/frontend/webview-e2e-harness`, serving the REAL `ptah-extension-webview` bundle (`useAppBuild: true`) with the postMessage bridge, CSP stub and an in-page RPC auto-responder. No dev server needed.
- Build confirmation: bundle built from this worktree at base commit: `npx nx build ptah-extension-webview --configuration=development --skip-nx-cache` (succeeded; sourcemaps deleted afterwards to save disk). `node_modules` in the worktree is a junction to the main checkout's `node_modules` (untracked, gitignored).
- Themes: `anubis` (dark) and `anubis-light` (light), set through `localStorage['ptah-theme']` (the pre-paint hint the app reads).
- Viewports: 375x812, 1024x768, 1366x768 (audit selection, not a support contract). Chromium only.
- Host config: `ptahConfig.isElectron: true` (required to pass the Skills tab desktop gate; same justification as `skills-lane-pickers.e2e.spec.ts`).

## Reproduce (exact command and fixture)

Fixture/spec file (ADDED, test-harness only, no production source touched):
`libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/thoth-feed-visual.e2e.spec.ts`
(untracked; an in-spec `installFixtures` holds all RPC fixtures, no separate fixture file).

```
cd libs/frontend/webview-e2e-harness
SHOT_DIR="<abs output dir>" npx playwright test --config=playwright.config.ts thoth-feed-visual --workers=2
```

For the AFTER run: rebuild the webview on the fixed branch first (same nx command), then run the above with `SHOT_DIR` pointing at `.../screenshots/after`. Result at base: 6 tests passed (3 viewports x 2 themes), 36 PNGs. If the fix renames `data-test="panel-events"`, `ptah-skill-event-feed`, `ptah-skill-pipeline-status` or `panel-triggers`, update those locators in the spec (AFTER may legitimately remove the trigger panel and pipeline-status/diagnostics duplicate).

Seeded data (all in the spec):
- `skillSynthesis:diagnostics.recentEvents`, OLDEST FIRST like the backend: ineligible (6h ago), boot-scan, 5 repeated `analyze-run` for `sess-1001` (15 min apart), TWO `ineligible` events with the identical timestamp (`sess-2001`, `sess-2002`), 3 more `analyze-run` for `sess-3001`, subagent-stop, curator-pass, and the newest event = `error` (long message). 15 events total.
- Skills tile: `skillSynthesis:listCandidates` returns 3 rows when the shell first loads; the spec then bumps the count to 7 (4 are rows from `C:\other-project`) BEFORE switching to the Skills tab. Fixture assumption: a call with no `scope` (the tile's call) returns every workspace's rows; `scope: 'workspace'` returns 2.
- Triggers: sessionEnd/bootScan/subagentStop/postToolUse on, turnComplete off.
- Queue: 2 items, 1 drain run, 1 stage spend. Digest/suggestions/specs/clones empty.
- Not fixtured: the Providers settings RPCs, so the Settings screenshots show the page in its "Loading..." state (see limitations).

Capture sequence per viewport/theme: open Thoth (Memory tab, first load) -> shot 01 -> bump candidate count -> click Skills -> Activity sub-view -> shots 02-05 -> switch to Settings view -> shot 06.

## Screenshots

Directory: `.ptah/specs/TASK_2026_586_2b3e/screenshots/before/` (suffix `-<viewport>-<theme>.png`, viewports 375/1024/1366, themes dark/light = 36 files).

| Prefix | Content |
| --- | --- |
| `01-shell-tiles-initial` | Thoth shell, sidebar tiles after first load (Skills tile = 3 pending) |
| `02-skills-activity-full` | Skills > Activity, full page, after backend count moved to 7 |
| `03-event-feed-closeup` | "Recent events" panel (`[data-test="panel-events"]`) |
| `04-pipeline-status-closeup` | `ptah-skill-pipeline-status` card |
| `05-trigger-toggles-closeup` | "Triggers" panel in the diagnostics accordion (to be moved to Settings) |
| `06-settings-<vp>-<theme>` | Settings screen where the toggles will land |

## Visible defects (verified in 02/03 at 1366 dark and light; same at 1024 and 375)

1. Oldest-first feed, newest hidden. `03-event-feed-closeup-*`: the list starts at the 6h-old `ineligible` and ends at the 30m-old `analyze-run`. The feed shows the first 10 of 15 events, so the newest 5 (`analyze-run` 15m/5m, `subagent-stop`, `curator-pass`, and the newest `error`) never appear. A user sees the failure last, if ever.
2. Duplicated rows. Five consecutive identical `analyze-run  sess-1001  accepted=true, edits=4` rows (relative times collapse to "1h ago" x3 because only minute/hour precision is shown), and three more for `sess-3001`. No grouping or count.
3. Colliding row identity. The two `ineligible` events with the same timestamp render as two rows (`sess-2001`, `sess-2002`) but share the track key `timestamp + '-' + kind` (`event-feed.component.ts`); the visual is correct only by luck, Angular will warn about duplicate keys and reuse DOM on updates.
4. Stale/wrong status chip. `02-*` / `04-*`: the pipeline card header reads "Last analysis: 5m ago  (orange dot) ineligible" even though the newest event is an `error` and the newest analyze-run succeeded; the chip is driven from `events[0]` (the OLDEST event, an ineligible).
5. Overlapping summaries on Activity. Pipeline status card ("Last analysis", "Today: 9 accepted, 8 ineligible") is followed directly by the diagnostics accordion's "Last analyze run" + "Last curator pass" cards and "Sessions analyzed today (17)" with the histogram, then "Candidates by status" (7/4/2) which repeats the stats strip at the top of the page (Candidates 7, Promoted 4, Rejected 2). The same facts appear 2-3 times with different wording/formatting (relative "5m ago" vs absolute "10/1/2026, 3:06:16 AM").
6. Stale shell tile. `01-*` vs `02-*`: sidebar Skills tile says "3 pending / candidates to review" while the page header strip on the same screen says Candidates 7. The tiles load once (`ThothShellComponent.ngOnInit` -> `refreshIfNeeded`) and never refresh on tab switch. The tile also counts rows from another project (see fixture assumption above).
7. Trigger toggles live inside the Activity tab (`05-*`), mixed with read-only diagnostics; Settings (`06-*`) has no trigger controls.
8. Event rows truncate silently: long error outcome is cut off with no title/expansion (`03-*`, error row not visible at all in the 10-row window, but `outcome` uses `truncate`).

Additional observation, outside this task's scope but visible: at 375px the app shell does not fit (`02-skills-activity-full-375-*`, `01-*-375-*`): the content column is wider than the viewport and is clipped on the left edge ("Run Curator" and "Candidates" are cut, the sidebar tiles scroll horizontally, "Memory" tile is clipped). Present at base on the shell, not something the fix introduces; the AFTER run should compare against it rather than treat it as a regression.

## Limitations

- Settings captures (`06-*`) show the Providers page in its loading state because only the Skills/Memory RPCs are fixtured; the AFTER run (where trigger toggles are expected in Settings) must either navigate to the tab that hosts them (and add any RPC the new section needs, e.g. `skillSynthesis:getTriggers` is already answered) or extend the fixtures from `skills-lane-pickers.e2e.spec.ts` (`auth:getEffectiveRoute`, `config:getScopes`, `agent:getConfig`, ...).
- The disk (D:) was at 99-100% during the run; screenshots were rendered to the user temp dir first and copied in. No source files were modified; no git commands that change the tree were used. Untracked additions: the spec above and the `node_modules` junction (gitignored).
- No contrast, focus or target-size measurements were taken in this baseline run.

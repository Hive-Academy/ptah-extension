# Visual re-review (Electron) - TASK_2026_701_9e4b

Scope: only the states changed by the visual fix round (original issues 1, 3, 4, 6). Not a full review.
HEAD 2f725273d plus the uncommitted marketplace changes.

## Method
- Rebuilt the renderer of this worktree first (stale dist did not contain the fixes): `node scripts/verify.mjs --exec --task visual-rereview -- npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron --parallel=1` (exit 0; the new bundle contains `min-w-[7rem]`). Log: `tmp/rebuild.log`.
- Same isolated launch as the original review (`launchPtah()`: temp user-data dir, temp PTAH_DB_PATH, mocked RPC; a copy of the driver with only the output folder changed: `tmp/visual/driver2.ts`). Each run was under the lock. The user's app was never touched; every instance was closed by the driver. One consent-failed attempt crashed at startup (exit 3221226505) and was re-run successfully.
- Themes `anubis` (dark) and `anubis-light` (light). Wide = 1280, narrow = 400 content width (`innerWidth` 1280 / 400 recorded in the JSON). Screenshots: `reviews/visual/rereview/` (prefix below). Metrics: `<scenario>.json` in the same folder.

## Results (P = `reviews/visual/rereview/`)

| Issue | Theme | Width | Screenshot | Result |
|---|---|---|---|---|
| 1 config-home button wraps | dark | wide | P/installed-conflict__page__dark__wide.png | PASS (one line, 538 px, inside notice) |
| 1 | dark | 400 | P/installed-conflict__page__dark__narrow.png | PASS (button 268 px inside 286 px notice, label wraps to 3 lines, scrollWidth 266 <= clientWidth 266) |
| 1 | light | wide | P/installed-conflict__page__light__wide.png | PASS |
| 1 | light | 400 | P/installed-conflict__page__light__narrow.png | PASS (268 px in 286 px notice, no overflow) |
| 3 name not squeezed | dark | wide | P/installed-conflict__page__dark__wide.png | PASS (all names full, even the 60-char name) |
| 3 | dark | 400 | P/installed-conflict__page__dark__narrow.png | PASS (name "Ptah Core Tools" and "react-patterns" full; long name shows "my-local-skill-..." about 112 px) |
| 3 | light | wide | P/installed-conflict__page__light__wide.png | PASS |
| 3 | light | 400 | P/installed-conflict__page__light__narrow.png | PASS (same as dark) |
| 4 badge inside border | dark | wide | P/installed-conflict__page__dark__wide.png | PASS (one line; "Plugin: Ptah Core Tools" 120 px, text fits) |
| 4 | dark | 400 | P/installed-conflict__page__dark__narrow.png | PASS for the border (one line, no text on the outline), but see New regression A |
| 4 | light | wide | P/installed-conflict__page__light__wide.png | PASS |
| 4 | light | 400 | P/installed-conflict__page__light__narrow.png | PASS for the border, see New regression A |
| 4 (second fixture) | dark / light | wide / 400 | P/installed-imported__page__{dark,light}__{wide,narrow}.png | PASS for the border; same behaviour as above (badge 24-29 px at 400) |
| 6 failure alert visible without scroll | dark | wide | P/consent-failed__failed__dark__wide.png | PASS (alert directly above Cancel / Retry install, outside the scroll area, list still has 4 items and scrolls) |
| 6 | dark | 400 | P/consent-failed__failed__dark__narrow.png | PASS (alert 310 px, fully readable above the actions) |
| 6 | light | wide | P/consent-failed__failed__light__wide.png | PASS |
| 6 | light | 400 | P/consent-failed__failed__light__narrow.png | PASS |

## New regression in the same states

### A. Moderate - provenance badge collapses to about one character at 400 px
- Evidence: P/installed-conflict__page__dark__narrow.png, ...light__narrow.png, installed-imported narrow pair. Badge widths from the metrics: 14-19 px (conflict fixture) and 24-29 px (imported fixture). They render as "P.", "s", "v" inside a tiny pill. The border is clean (issue 4 fixed) and the name is readable (issue 3 fixed), but the origin label is no longer readable at narrow width; only the `title` tooltip carries it.
- Source: the badge has `min-w-0 max-w-[40%] shrink` and the row link `min-w-[7rem] flex-1` (`installed-skills-page.component.ts` about :286 and :322-332). The name floor wins over the badge, which shrinks to its padding.
- Impact: at 400 px the new provenance information is effectively hidden. Suggest a small floor on the badge (for example `min-w-[3.5rem]`) or hiding it below a width and showing the origin in the meta line. This is a design choice; the previous review offered those options.
- Severity is Moderate (nothing is broken or overlapping; a tooltip still exposes the text).

## Not regressions
- The 32 px right-edge clip at a true 400 px window (original issue 2, app shell `min-w-[400px]`) is unchanged and still visible in the narrow shots (for example the notice right edge 406 and the title row). Not part of this round.

## Regression A re-check

Fix under test: row `<li>` is `flex flex-wrap items-center gap-x-3 gap-y-1`, badge is `badge badge-sm max-w-full shrink-0 border`. Renderer rebuilt under the lock (`tmp/rebuild2.log`, exit 0; bundle contains the new classes). Same isolated launch (`tmp/visual/driver3.ts`), instances closed by the driver. Screenshots: `reviews/visual/rereview2/` (prefix P2); metrics in the JSON files there.

| Scenario | Theme | Width | Screenshot | Badge text readable | Name room (3) | Badge in border (4) | Wrapped layout | Result |
|---|---|---|---|---|---|---|---|---|
| installed-conflict | dark | wide | P2/installed-conflict__page__dark__wide.png | yes, 81-120 px, scrollWidth = clientWidth | full names | yes | single line per row, aligned right | PASS |
| installed-conflict | light | wide | P2/installed-conflict__page__light__wide.png | yes | full names | yes | same | PASS |
| installed-conflict | dark | 400 | P2/installed-conflict__page__dark__narrow.png | yes, full text ("Plugin: Ptah Core Tools" 120 px, "skills.sh: acme/skills" 106 px) | "Ptah Core Tools", "react-patterns" full; long name still "my-local-skill-..." (7rem floor) | yes | badge + action wrap below the name, left-aligned | PASS (see note B) |
| installed-conflict | light | 400 | P2/installed-conflict__page__light__narrow.png | yes | same | yes | same | PASS (note B) |
| installed-imported | dark | wide | P2/installed-imported__page__dark__wide.png | yes | full | yes | single line | PASS |
| installed-imported | light | wide | P2/installed-imported__page__light__wide.png | yes | full | yes | single line | PASS |
| installed-imported | dark | 400 | P2/installed-imported__page__dark__narrow.png | yes | as above | yes | as above | PASS (note B) |
| installed-imported | light | 400 | P2/installed-imported__page__light__narrow.png | yes | as above | yes | as above | PASS (note B) |

Regression A is resolved: the badge is fully readable at 400 px, keeps its single-line border, and the name keeps at least about 112 px. No shadow or doubled-outline artefact on the badge in either theme.

Note B (Minor, not blocking): at 400 px the wrapped rows are not uniform. For "Ptah Core Tools" and "react-patterns" the badge and the action sit on a second line under the icon+name. For the long-named row the badge stays on the first line next to the truncated name and "Uninstall" drops to a second line at the left (P2/installed-imported__page__light__narrow.png). Row heights therefore differ (about 70 to 90 px) and the action position varies per row. Nothing overlaps or clips. A fixed layout (badge always under the name, action always on the right) would be more consistent.

## Verdict
PASS for the four fixes (issues 1, 3, 4, 6) and for the Regression A fix. Remaining: Minor note B only; no Serious or Blocking findings.

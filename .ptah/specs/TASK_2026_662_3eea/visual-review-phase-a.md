# Visual Review - TASK_2026_662 Phase A (batches 7 and 11)

Verdict: APPROVED (score 8/10). Blocking 0, Serious 1 (pre-existing, not introduced by the batches), Moderate 2, Minor 1.

## Environment

- Build: `npx nx run ptah-electron:build-dev` then `copy-renderer-dev` from the worktree
  `.claude-worktrees/skill-synthesis-purge` (branch `refactor/skill-synthesis-purge`); both exited 0. The
  Electron bundle in `dist/apps/ptah-electron` was produced from this worktree's sources just before the run.
- Launch: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs` with `--remote-debugging-port=9390`
  (never 9333/9380), private HOME/APPDATA/LOCALAPPDATA/`--user-data-dir`/`PTAH_DB_PATH` under `os.tmpdir()`,
  all removed on exit. Same capture recipe as the "before" run (`before/capture-before.cjs`): fresh private data
  with 4 seeded agents (architect, backend-developer, frontend-developer, code-reviewer), not a copy of the
  user's real Ptah data, so the real data and `~/.ptah/settings.json` were never touched and
  `skillSynthesis.enabled` was left alone. Ollama endpoints pointed at 127.0.0.1:1.
- Viewport 1280x800 (same as before; audit selection, not a support contract). Themes: dark = `anubis`,
  light = `anubis-light`. Only one viewport was opened, so narrow-width behaviour is not covered.
- Scripts: `visual/after/capture-after.cjs` (screens, graded variants), `visual/after/capture-after-a11y.cjs`
  (contrast, focus, geometry). Raw notes: `visual/after/index-raw.txt`, `visual/after/a11y-raw.txt`.
- Graded cases: `skill_task_grades` rows were inserted into the private DB (node:sqlite) after boot so true
  (COMPLETE) and false (FAILED) verdicts render; ungraded agents render the null path with no extra seeding.
- Cleanup: both Electron instances exited via `app.close()`; `netstat` shows nothing on 9390 and no electron
  process remains.

## Per-screen comparison (before vs after)

All files are in `visual/before/` and `visual/after/` (`before-X` vs `after-X`).

| Screen | Theme | Before | After | Verdict | Notes |
|---|---|---|---|---|---|
| Library > Agents | dark | before-library-agents-dark.png | after-library-agents-dark.png | PASS | Grid, tab counts, toolbar identical. |
| Library > Agents | light | before-library-agents-light.png | after-library-agents-light.png | PASS | Same. |
| Library > Skills | dark/light | before-library-skills-*.png | after-library-skills-*.png | PASS | Empty state unchanged (no seeded skills). |
| Library > Commands | dark/light | before-library-commands-*.png | after-library-commands-*.png | PASS | Empty state unchanged. |
| Agent card (architect, ungraded) | dark | before-agent-card-dark.png | after-agent-card-dark.png | PASS | Pill text "no data yet" -> "No grade"; same neutral ghost badge, same position; "0 inv" and the rest of the row did not move. |
| Agent card (architect, ungraded) | light | before-agent-card-light.png | after-agent-card-light.png | PASS | Same neutral outline pill. |
| Agent drawer (architect, ungraded) | dark | before-agent-drawer-dark.png | after-agent-drawer-dark.png | PASS | Scorecard pill reads "No grade"; the "No graded runs yet." block below is unchanged; no shift or overflow. |
| Agent drawer (architect, ungraded) | light | before-agent-drawer-light.png | after-agent-drawer-light.png | PASS | Same. The before shot was a differently scrolled full-window capture, so comparison is by the pill and block, not pixel diff. |
| Agent card graded (new, no before) | dark | n/a | after-agent-card-graded-{0..3}-dark.png | PASS | "No grade" (neutral), "100% ok" (success), "0% ok" (error), "75% ok" (success). `0%` shown only for the real measured-zero reviewer. |
| Agent card graded (new) | light | n/a | after-agent-card-graded-{0..3}-light.png | PASS | Same tones. |
| Drawer graded rows (COMPLETE / FAILED) | dark | n/a | after-agent-drawer-graded-{1,2,3}-dark.png, after-scorecard-rows-{1,2,3}-dark.png | PASS | COMPLETE = success tone, FAILED = error tone, spine colour matches. |
| Drawer graded rows | light | n/a | after-agent-drawer-graded-3-light.png, after-scorecard-rows-3-light.png | PASS | Same. |
| Drawer keyboard focus | dark/light | n/a | after-drawer-focus-{architect,frontend,reviewer}-{dark,light}.png | PASS | Close and Edit buttons show a 2px outline; see Accessibility. |

Not in scope for batches 7 and 11 (captured only for completeness, unchanged): Skills header, Recommended,
Sessions, Activity, Settings (`after-skills-*`). The Providers/routing-map/consumer-assignments screens in
`before/` were not re-captured because no batch touched them.

## Checks requested

- "No grade" text and neutral tone: renders for the null rate on the card badge and the drawer scorecard. Class
  list `badge badge-sm badge-ghost` (neutral), not success/error. OK.
- Stray "0%": `document.body.innerText` contains no `0%` in the ungraded state; the only `0% ok` is the seeded
  code-reviewer with a real failing grade (a measured zero is kept by design, batch 8 notes). OK.
- Layout shift / overflow: `documentElement.scrollWidth > clientWidth` is false in dark; pill widths 40-54px,
  heights 16px (card/drawer) and 14px (row verdict); "No grade" (54px) is wider than "no data yet" was in the
  before shot by no more than a few px and wraps nothing. No clipping in cards or drawer in either theme.
- Focus: the scorecard pill and the row verdict pills are non-interactive spans (`tabindex=-1`, no role), so they
  have no focus state to review. Drawer tab order alternates Edit -> Close inside the drawer (focus trapped,
  Escape closes) and both buttons show a visible 2px solid outline (after-drawer-focus-architect-light.png
  shows the close ring clearly).

## Findings

### Blocking

None.

### Serious

1. Graded success/error pills fail WCAG AA 1.4.3 for normal text (pre-existing, not introduced by batches 7 or 11).
   - Evidence (measured via canvas-resolved computed colours, `a11y-raw.txt`): dark `badge-success` text
     232,230,225 on 22,163,74 = 2.64:1 ("100% ok", "75% ok", COMPLETE); dark `badge-error` on 220,38,38 =
     3.87:1 ("0% ok", FAILED). Light `badge-error` 4.12:1. Light `badge-success` 6.01:1 passes. Text is 10px
     (pills) and 9px (row verdicts), so the 4.5:1 normal-text threshold applies.
   - Screenshots: after-agent-card-graded-2-dark.png, after-agent-drawer-graded-3-dark.png,
     after-agent-drawer-graded-3-light.png.
   - Cause: daisyUI `badge-success` / `badge-error` token pairing in the dark theme; the classes are applied at
     `libs/frontend/skill-synthesis-ui/src/lib/components/clones/scorecard-badge.component.ts` (success pill) and
     `scorecard-detail.component.ts:118-119` (verdict pill). These classes existed before the batches; the new
     "No grade" pill uses neither. Track separately; do not gate Phase A on it.
   - The new neutral "No grade" pill passes: dark 13.89:1, light 14.21:1.

### Moderate

1. The null (`succeeded: null`) detail-row pill could not be rendered live. `skill-scorecard.service.ts`
   `toInvocationRow` / `buildRecentVerdicts` map every stored verdict to `pass`/`fail`, so no running path emits
   a null row yet; only the empty "No graded runs yet." state and the null card/drawer rate pill were seen. The
   `scorecard-detail.component.ts:185-201` branch (neutral card, default `badge badge-xs` pill with no tone
   class) is covered by unit specs only, so its real contrast and tone in both themes are unverified. Re-check
   when a later batch makes a null row reachable.
2. Pill text is 10px (card/drawer) and 9px (row verdict). Below common legibility guidance (not an AA minimum),
   pre-existing sizing. Screenshots as above.

### Minor

1. The verdict dots on the card (`scorecard-verdict-dots`, 6px, red/green only, title text only) show no
   ungraded/neutral dot style, which matters once null verdicts reach `recentVerdicts`; currently
   `recentVerdicts[].succeeded` is boolean so nothing to render yet.

## Prototype fidelity

- No approved prototype was supplied for these two batches (text-only label and tone change on existing
  surfaces); the before/after pass above applies instead. Fidelity: NOT APPLICABLE.
- Before/after pairs (dark + light): agent card (`before-agent-card-dark/light.png` vs `after-agent-card-dark/light.png`),
  agent drawer (`before-agent-drawer-dark/light.png` vs `after-agent-drawer-dark/light.png`), Library agents/skills/commands
  (`before-library-*` vs `after-library-*`). No regressions; the only visible difference is the "no data yet"
  pill text becoming "No grade" in the same neutral style.

## Visual performance

No layout movement observed when the pill text changed (same row height, card heights 323/323/331/331 dark,
371/371/379/379 light, with the 8px difference only on cards carrying the red verdict dot or "Last enhanced"
line). Models list shows "Loading models…" in some dark shots and an expanded provider table in light; this is
timing of an unrelated async load and differs between runs, not a regression from these batches.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the card/drawer null and true/false tones; MEDIUM overall (single 1280x800 viewport, null
  detail row not reachable live)
- Key concern: pre-existing sub-AA contrast on the dark success/error badges that now carry the graded values.

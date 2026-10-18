# P5 Visual Review - TASK_2026_646_136a - Agents tab after Batch 39b

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **NEEDS_FIX** |
| Overall score | 6/10 |
| Visual breaking | 0 |
| Serious | 1 |
| Moderate | 1 |
| Minor | 2 |
| Viewport | 1100 x 700, dpr 1 (logged `actual viewport`), themes `anubis` and `anubis-light` |
| Screenshots | 8 PNG (4 from the standard capture, 4 from a settled re-capture) |

Why 6: the outcome state model works and the drawer reads correctly, but on the card (the surface a user sees first) the
outcome value "no data yet" is clipped to "no ..." in the default window, so the state text S-2 was meant to make readable is not readable.
7 to 8 would need that fixed; below 5 would need broken navigation or a wrong state, and neither occurred.

## Environment

- Build under test: `D:\projects\ptah-extension\.claude-worktrees\646-after-shots`, detached at `f5d28d2f4` (contains 39b), dev build already present. Nothing built, no nx/jest, no source edited.
- Script: `visual\batch-8-before\capture-agents-tab.cjs`, copied byte-identical to `visual\batch-8-after\` and run as
  `node capture-agents-tab.cjs <A> <T>\visual\batch-8-after after` (arguments: worktreeRoot, outDir, prefix). Same framings as BEFORE:
  `after-agents-list-{dark,light}.png`, `after-agents-drawer-{dark,light}.png`, 1100 x 700.
- Second capture `visual\batch-8-after\capture-agents-tab-settled.cjs` (the same script plus a 15 s settle wait and DOM dumps, no other change; output `visual\batch-8-after\settled\settled-*.png`),
  made because the first AFTER shots were taken while the host was still busy (see Moderate 1).
- Isolation unchanged (temp HOME/USERPROFILE, `--user-data-dir`, `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`, temp workspace). No Ollama or provider was configured or contacted by this script. One Electron at a time; both runs closed it (0 `electron.exe` remain).
- Seed unchanged: 4 agent clones (architect, backend-developer diverged, frontend-developer enhanced 1 h ago, code-reviewer); no outcome rows exist, so the expected state is `ready` with no data.
- Standard: WCAG 2.2 AA applied (no declared standard); only layout and state text were assessed here, no contrast measurement beyond visual read.

## Findings

### Serious

#### S1. Card outcome value "no data yet" is clipped to "no ..." and its label wraps

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:177-188` (a `grid-cols-2` `<dl>` whose `<dd>` has `truncate`), fed by `agent-outcome-signals.ts` (label `Outcomes (30d)`, value `no data yet`).
- Viewport / theme: 1100 x 700, dark and light, all four cards. Measured in the page: `dd[data-testid="clone-metric-outcome-empty"]` has `scrollWidth 63` vs `clientWidth 33`, no `title` attribute. The label "OUTCOMES (30D)" wraps onto two lines.
- Screenshots: `settled\settled-agents-list-light.png`, `settled\settled-agents-list-dark.png`, `after-agents-list-dark.png` (card text reads "OUTCOMES (30D) no ..."). Compare `batch-8-before\before-agents-list-dark.png` (no truncation; it showed the sentence "Never invoked yet ...").
- Problem: each of the two metric cells is about 33 px wide inside the card, so any outcome sentence is cut. The other states S-2 introduced use longer text ("Loading outcome data…", "Outcome data unavailable") in the same cell and would be cut the same way; for `unavailable` and `not-persistent` the separate notes below the grid (`:192-207`, "Outcome data unavailable." / "Outcome data is not stored durably on this host.") do carry the message, but the loading text is not readable.
- Impact: the user sees "no ..." instead of "no data yet" on every agent card in the default window, which is exactly the "no data" vs failure wording S-2 asked to keep distinct. The scorecard badge below says "no data yet", so the information is recoverable on the card, but the dedicated outcome cell is broken.
- Fix: let the outcome cell span the full row (`col-span-2`), drop `truncate` for the outcome metrics (or add `title` and wrap), keep the label on one line.

### Moderate

#### M1. Controls look disabled and provider rows show "unknown" while the host is busy

- Evidence: `after-agents-list-dark.png` (first capture, 2.5 s after opening the tab): "Refresh", "Show diverged only"-adjacent actions, "Rebase all diverged (1)" and "Sync provider copies" are greyed, provider rows read "claude unknown / codex unknown ...", the drawer's "Edit" is greyed (`after-agents-drawer-dark.png`). BEFORE showed them enabled with "not synced" and "claude source".
- The settled capture (15 s) shows them enabled and provider states resolved (`settled\settled-agents-list-light.png`), so this is a transient "busy" state during the background reconcile (log: "User-layer pass (content-download-complete) deferred until background work clears"), not a permanent regression. No visible busy indicator explains the greyed controls during that window. Not tied to 39b by evidence; reported because the AFTER state differs from BEFORE.

### Minor

- **m1.** After the settle, every card shows a red "Models unavailable: RPC timeout: skillSynthesis:ge..." line (`settled\settled-agents-list-light.png`, DOM text in `run2.log`). It comes from `agent-model-editor.component.ts:421`, which renders the raw `loadError` (an RPC method name). The isolated profile has no providers, which makes the call time out; unrelated to 39b, but it is raw error text in the UI.
- **m2.** "Enhance now" is disabled with the sentence "Needs 5 recorded runs ..." and "Revert" disabled on every card (expected for the seed; same as BEFORE).

## State-text check against the seeded data

| Surface | Seeded data | Observed | Correct |
| --- | --- | --- | --- |
| Drawer (architect) | no runs, host durable | "OUTCOMES (30D) / no data yet", then "Actions", Scorecard "no data yet", "0 inv", "No graded runs yet." (`settled-agents-drawer-light.png`, `-dark.png`) | yes |
| Card | same | label "OUTCOMES (30D)", value shown "no ..." (clipped from "no data yet", DOM text "no data yet") | text correct, display clipped (S1) |
| `unavailable` / `not-persistent` notes | not seedable (needs a failing or non-durable store) | not rendered, `notes: []` in the DOM dump | not verified visually |
| Loading | first read | transient, not captured with legible text (clipped, S1) | not verified |

No "Never invoked yet" sentence appears on the agent cards any more: agent cards always carry an outcome cell (`clone-card.component.ts:425-431`), which is the intended behaviour of Req 9.1, not a 39b change.

## Layout comparison, after vs before

- Same framings, 1100 x 700: card grid, tab strip, diverged banner, drawer layout all match in structure.
- Differences: the card metric block (Outcomes cell added; S1), provider rows ("claude source / not synced" vs "unknown" while busy; same after settle), the model editor strip ("Loading models..." vs the RPC timeout error after settle; m1), drawer gains an "OUTCOMES (30D)" block at the top (renders correctly) and its "Edit" is greyed only in the busy window.
- No horizontal scroll, overlap, or clipped drawer; drawer content fits in 1100 x 700 in both themes. Narrow width was not part of this framing set and was not tested.

## Verdict

- Recommendation: REVISE (NEEDS_FIX). Confidence: HIGH for S1 (measured clipping, 2 themes, 4 cards), MEDIUM for the unavailable and non-durable states (not rendered).
- Key concern: S1, the outcome text on the card is truncated to "no ...".

## Screenshots

- `visual\batch-8-after\after-agents-list-dark.png`, `after-agents-list-light.png`, `after-agents-drawer-dark.png`, `after-agents-drawer-light.png`
- `visual\batch-8-after\settled\settled-agents-list-dark.png`, `settled-agents-list-light.png`, `settled-agents-drawer-dark.png`, `settled-agents-drawer-light.png`
- Logs: `visual\batch-8-after\run1.log`, `run2.log`. BEFORE: `visual\batch-8-before\before-agents-*.png`.

# Batch 41 Visual Review - TASK_2026_646_136a

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **APPROVED** |
| Score | 8/10 |
| Visual breaking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 2 |
| Viewports | Agents: 800, 1100, 1500, 1900 wide x 700 high, dpr 1. Decision card: 1100 and 784 (the OS clamped the requested 700), dark and light |
| Screenshots | 59 PNG in `decision\`, 12 in `agents-measure\`, 4 in `agents\`, plus `decision-settled\` and `decision-diag\` |

Why 8: both fixes render correctly and are measured (the 41c outcome cell and the 41e deferred Orchestration tab). Nothing broke and nothing
regressed against the Batch 8 settled shots or the Batch 40 recheck shots. Not 9 to 10 because three things are unproven:

- the `unavailable` and `loading` outcome states cannot be seeded,
- the 4-column breakpoint (512 px) is never reached,
- the Decision card showed "Status not reachable" in a cold-start run (Moderate 1).

## Environment

- Build under test: `D:\projects\ptah-extension\.claude-worktrees\646-after-shots`, detached at `c779018ad` (Batch 41e). `nx build-dev ptah-electron` and
  `nx copy-renderer-dev ptah-electron` both succeeded. No other build or test was run.
- This build does not include `cda1eb30e` (41f), which is newer than `c779018ad`.
- Isolation is identical to the earlier scripts: temp HOME/USERPROFILE, `--user-data-dir`, `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`, temp workspace.
  - Unseeded Decision scenarios log `guard: isolated ollama baseUrl -> http://127.0.0.1:1`.
  - `ollama-unreachable` uses 127.0.0.1:1.
  - The real Ollama at 127.0.0.1:11434 was never contacted.
  - One Electron at a time. `tasklist` shows 0 `electron.exe` after every run.
- Scripts, all in `visual\batch-41-recheck\`:
  - `capture-agents-tab-settled.cjs` (copy of the Batch 8 settled script, run with prefix `b41`).
  - `capture-decision-card.cjs` (guarded copy).
  - `measure-agents-grid.cjs`: the settled script plus a width sweep and per-card grid measurement. It changes only the measurement and the extra window sizes.
  - `capture-decision-card-diag.cjs`: the Decision script plus app log echo.
  - `capture-decision-card-settled.cjs`: the Decision script plus a 40 s wait before opening Settings.
  - `compare-decision.cjs`: compares Batch 40 and Batch 41 metrics.
- Standard: WCAG 2.2 AA (no declared standard). The contrast figures come from the capture script's own in-page measure, the same one Batch 40 used.

## P5 Agents tab (Batch 41c)

Run: `agents\b41-agents-list-{dark,light}.png`, `b41-agents-drawer-{dark,light}.png`, log `agents.log`.
Sweep: `agents-measure\b41m-agents-list-{dark,light}[-w800|-w1100|-w1500|-w1900].png`, log `measure.log`.

| Check | Result | Evidence |
| --- | --- | --- |
| Outcome cell shows the full sentence, no "no ..." | PASS | All 4 cards read "OUTCOMES (30D) / no data yet", in dark and light at all 4 widths. At 1100: `dd` `clientWidth` 179, `scrollWidth` 179, no `truncate` class. The old cell was 33 px with `scrollWidth` 63 (P5 S1). |
| Label stays on one line | PASS | "Outcomes (30d)" `dtLines` = 1 at every width. |
| Outcome sentence uses the full row | PASS | Item `grid-column` is `1/-1` and `itemW` equals the container width: 179 at 1100, 379 at 1500, 419 at 1900, 376 at 800. |
| Grid columns follow the card width, not the viewport | PASS | The `.clone-card-metrics-container` has `container-type: inline-size`. Container 179 px gives `81.5px 81.5px` (2 columns). 376 px gives `180px 180px`. 379 px gives `181.5px 181.5px`. 419 px gives `201.5px 201.5px`. |
| Viewport-independence demonstrated | PASS | At an 800 px window the card is 410 px wide. At a 1100 px window it is 213 px wide (the Thoth side panel takes room). Both give a 2-column grid sized to the card (376 px vs 179 px). The old `grid-cols-2 sm:grid-cols-4` would have produced 4 columns at 1100. |
| Truncated values have a `title` | PASS | "Last enhanced" `dd`: `truncate` true, `title` "1h ago", at every width. Full-row outcome sentences have no `title` and wrap instead (as designed). |
| "Outcome data unavailable" not duplicated | NOT EXERCISED | The state cannot be seeded (it needs a failing store). 0 occurrences on every card and 0 `clone-outcome-unavailable` notes, so no duplicate. The once-only behaviour rests on `clone-card.component.spec.ts:355`. |
| No horizontal scroll | PASS | `horizScroll` false at 800, 1100, 1500 and 1900. |
| No layout regression vs `batch-8-after\settled` | PASS | Same framing. Card order, banner, drawer layout and button states are the same as the settled shots. The outcome cell now sits on its own line above the scorecard. |
| Drawer | PASS | `b41-agents-drawer-light.png` and the dark one: the OUTCOMES block, Actions, Scorecard ("no data yet", "0 inv", "tokens: no data yet", "cost: no data yet"), Body and History all fit at 1100 x 700. Drawer unchanged by 41c. |

Measured card geometry (dark equals light):

| Window | Card | Container | Columns | Outcome item |
| --- | --- | --- | --- | --- |
| 800 | 410 | 376 | 2 x 180 | 376 |
| 1100 | 213 | 179 | 2 x 81.5 | 179 |
| 1500 | 413 | 379 | 2 x 181.5 | 379 |
| 1900 | 453 | 419 | 2 x 201.5 | 419 |

## P4 Decision model card behind the new `@defer` (Batch 41e)

Runs: `decision\b41-decision-*` (cold start), `decision-settled\b41s-decision-*` (after 40 s). Scenarios: `default` and `ollama-unreachable`, dark and light, 1100 and 784.

| Check | Result | Evidence |
| --- | --- | --- |
| Orchestration tab renders after the placeholder | PASS | Settings > Agent Orchestration opened, then `provider-consumer-assignments` was visible. 7 consumer rows rendered (`consumer rows: 7`, `summary badge: 7 roles`), and `consumer-row-decision` was last, in both runs. The `aria-busy` placeholder itself was not screenshotted (the script waits through it). |
| Card matches the Batch 40 recheck | PASS (settled run) | `default` and `ollama-unreachable` in `decision-settled`: card text identical for all 23 and 4 records. `card` PNGs are byte-identical to `batch-40-recheck\recheck-decision-*-card-{dark,light}.png` in all 4 comparisons. 3 of 4 `section` PNGs are byte-identical. The 4th (`default`, dark) is visually the same in a side-by-side read. |
| Contrast unchanged | PASS | `default`: all 23 measure records identical (text, fg, bg, ratio). `ollama-unreachable`: all but 3 records identical (the 3 are explained below). Minimum ratios: dark 4.82:1 (editor), light 5.39:1, summary text 12.29 to 13.18:1. All are at or above 4.5:1. |
| Ollama guard | PASS | `decision.log:3` and `decision-settled.log:3` show the guard. The unreachable seed `baseUrl` is `http://127.0.0.1:1`. |

Contrast difference in `ollama-unreachable` (settled run, light, 1100): the summary line `span#consumer-summary-decision`, its icon and one 12 px icon were measured on
`#efeae6` instead of `#faf7f5`. The text colour is unchanged (`#291334`, `#745665`).

- Ratios: 14.21:1 (was 15.92:1) and 5.39:1 (was 6.04:1). Both pass AA.
- The pixels in the card and section PNGs are identical, so the difference is the capture's pointer position or hover state, not a style change.

## Findings

### Moderate

#### M1. Cold start: the Decision card reads "Status not reachable" and hides the selected model

- Evidence:
  - `decision\b41-decision-ollama-unreachable-card-dark.png` and `-light.png`. Card text: "Decision model / not reachable / Status not reachable / The decision model status is not reachable. ... / Retry".
  - Batch 40 showed "Ollama · tev1 / Could not reach Ollama ... / Set up Ollama" for the same seed (`batch-40-recheck\recheck-decision-ollama-unreachable-card-dark.png`).
  - The failure reproduced twice (`decision.log`, `diag.log`).
- Cause from the logs (`diag.log`, `udd\logs\Ptah Electron-2026-10-16.log`):
  - The host was still starting up: the event loop lagged 3.66 s, `auth:getAuthStatus` took 4.4 s and `config:models-list` took 6 to 10.5 s.
  - 4 concurrent `agent:getConfig` calls each took 5.0 to 5.5 s, and each ran a decision probe that failed in 1.5 s ("fetch failed", connection refused).
  - The renderer then logged `RPC timeout for method: agent:getConfig`. The row's `RPC_TIMEOUT_MS` is `5_000` (`decision-model-row.component.ts:55`), so `reload()` set status `null` (`:518-523`).
  - The seed was intact (`[final config.json]` still holds `ollama/tev1`).
- With the host settled (40 s wait before opening Settings) the same build renders the correct state (see the table above). The row degrades honestly: Retry is offered and saving stays open.
- Attribution: the diff from `f5d28d2f4` to `c779018ad` does not touch the status read path. `decision-model-row.component.ts` changed only in the `setConfig` error message, and the handler diff has no status change. I cannot prove Batch 41 caused this. The Batch 40 run used the same script timing and did not hit it, so a load difference on this machine is the likelier cause. This is not proven.
- Impact: a user who opens Settings in the first seconds after launch on a loaded machine sees a generic "not reachable" until they press Retry.
- Suggest: raise the timeout, or share one `agent:getConfig` call across the four rows that read it. Optional, not blocking.

#### M2. The unavailable and loading outcome states are not visually verified

- `unavailable` and `loading` cannot be produced with the isolated seed. The full-row, once-only sentence rests on the specs (`clone-card.component.spec.ts:355` and `:381`) and the measured `ready` (empty) state. The `ready` state shares the same `fullRow` code path.
- The 4-column breakpoint (container 512 px or wider) was not reached. The widest container measured was 419 px at a 1900 px window. The 1-column floor (under 160 px) was not reached either.
- Suggest: a visual check with a stubbed `agent:getOutcomes` response if these states matter.

### Minor

- **m1.** At the 1100 px window the "Last enhanced" label wraps to 2 lines in an 81.5 px cell (`dtLines` 2 in `measure.log`). It is a single line at 800, 1500 and 1900. The label is legible. `agents-measure\b41m-agents-list-dark-w1100.png` shows the 4th card.
- **m2.** Every card still shows the raw error "Models unavailable: RPC timeout: skillSynthesis:getAgentModels" (`agents\b41-agents-list-dark.png`). This is carried over from P5 m1, an isolated profile with no providers, and unrelated to 41c.

## Prototype fidelity

- Approved prototype: not part of this re-check (Batch 41 is a fix batch).
- Before/after comparison: dark and light shots before and after for each surface:
  - Agents tab. Before: `batch-8-after\settled\settled-agents-list-{dark,light}.png` (outcome clipped to "no ..."). After: `agents\b41-agents-list-{dark,light}.png`. Result: clipping fixed, no other regression.
  - Decision card. Before: `batch-40-recheck\recheck-decision-{default,ollama-unreachable}-{card,section}-{dark,light}.png`. After: `decision-settled\b41s-decision-*`. Result: card PNGs byte-identical; sections identical (the `default` dark section differs by bytes only).

## Verdict

- Recommendation: APPROVE. Confidence: HIGH for the 41c outcome cell and the 41e render, MEDIUM for the unproven states in M2 and the cause in M1.
- Key concern: M1, the cold-start "Status not reachable" on the Decision card (reproducible, with a plausible cause in the logs and not attributable to Batch 41).

# Delta 3 notes - session stats move into the inspector (TASK_2026_677_efcd)

Source: decisions.md row 50 (user), row 54 (tray scope). Spec: `design-spec.md` section "Delta 3 - session stats in the inspector" (D3.1-D3.9), decisions D44-D56.
Open `index.html?bare=1&replay=0&insp=open` (dark; add `&theme=light`). Variants: `stats=full|at|none|single|ctx|lane|unk|more`, `body=partial|empty|loading`, `insp=closed`, viewport 1440 / 760 / 400.
Files: `assets/delta3.js` (mock data + sections), `assets/delta3.css`, small edits in `assets/app.js` (inspector composition, Orchestrator card, toggle sync) and `index.html` (toggle ring, limit chip),
`assets/contrast-delta3.mjs` (measured pairs, all pass), `assets/capture.mjs checks` (section K) and `capture.mjs delta3` (screenshots `screenshots/delta3-<state>-<width>-<theme>.png`, git-ignored).
Result: `capture.mjs checks` 200 PASS, 0 FAIL; contrast-delta3 all pairs pass (anubis, anubis-light).

## Where every item of today's strip and tray goes

| # | Today (screenshot 1 / 2) | New place | Parity |
| --- | --- | --- | --- |
| 1 | Collapsed strip + expand / collapse chevron | removed; headline values always visible, per-window and per-lane detail keep a disclosure | C-19 |
| 2 | CONTEXT 15.3 % (152.9k) + progress strip | SESSION context ring tile (80 / 95 % thresholds, PM-21); the thin bar under the strip is gone | C-25 |
| 3 | Compaction count | Context tile, `2 compactions` | C-3 |
| 4 | TOKENS `~19.1M / 50.0M` + `~` estimate | Tokens tile: `~` (sr-only `estimated`), `of 50.0M budget`, budget bar | C-26, C-27, C-5 |
| 5 | COST `~$8.87`, known subtotal, cost budget | Cost tile (`~`, budget caption + bar when set, `known subtotal $0.00`) | C-28, C-5 |
| 6 | TIME 15m 59s | Time tile (+ `6 turns`, carried from the old card stats) | C-21 |
| 7 | AGENTS 4 | Agents tile | C-22 |
| 8 | LANES 2 (dashed pill) | LANES header meta `1 lane · 2 runs` (aria-label keeps the count text) | C-20 |
| 9 | MODEL chip (one model) / MODELS 2 dropdown / per-model table | SESSION Models row: one model = name; 2+ = disclosure with stacked per-model rows (In, Out, Cache read, Cache creation, Cost) + Total | C-23, C-24 |
| 10 | Orchestrator card line `Opus 5.5 · idle` | card shows state only (`idle`, `waiting on 4 agents`) | C-50 |
| 11 | Limits alert (near / at limit) | top of SESSION with `Plan limits` link; refresh-failed notice first line of PLAN LIMITS | C-33, C-34 |
| 12 | PLAN LIMITS: Claude account, `721c`, Provider API badge | PLAN LIMITS header provenance line (mark, caption with tail kept, source chip) | C-29 |
| 13 | Weekly 85 % and 5-hour 32 % bars, reset absolute + relative, state chip | one tile per window: label, state word, bar, `% used`, reset line; whole tile is the disclosure | C-30 |
| 14 | Per-window expand chevron (passed / next reset, note, sources) | tile disclosure panel: Used, Resets (each fact), Note, Source | C-31 |
| 15 | Status / evidence / cooldown tiles | one-line tiles in PLAN LIMITS (not drawn in the mock; spec D3.4) | C-32 |
| 16 | LANES caption `lane · not in totals` | LANES header caption line | C-35 |
| 17 | Lane tile (Codex CLI · software-architect, 2.7M tokens, cost unknown, 2 runs, Completed, Room, Provider API) | LANES dashed tile; disclosure shows owner, runs, window bar, evidence, notes | C-36, C-37 |
| 18 | Subtotal (2.7M known, $0.00 known cost, 1 lane, 2 runs, 2 cost unknown) | LANES Subtotal tile | C-38 |
| 19 | Background-agent tray `1 foreground · 1 running` + dots | AGENTS summary line (tray grammar) + row avatars | C-40 |
| 20 | Tray row status line, Focus | AGENTS row (status word, duration, activity; tokens appended when known); row button = Focus | C-41, C-42 |
| 21 | Tray `...` menu: View transcript, Steer (inline input), Send to background, Stop | AGENTS row `Actions for agent` menu + inline steer input | C-43..C-47 |
| 22 | Tray population (dedupe, this session) | AGENTS list (same sources); no group for other sessions (row 54) | C-48 |
| 23 | Sub-agent model in the inline bubble footer | moves to the dock hover card and AGENTS row title / description (D56) | C-49 |

## Reaching the stats with the inspector closed (D3.7, D51)

Closed toggle: 28 px context ring, dot (precedence: pending request > at limit > near limit > workflow), visually hidden description (`Context 15%. Weekly plan limit is near. 1 needs you.`);
header limit chip `Limit near` / `At limit` (glyph + word) while the inspector is closed. Opening takes one action (toggle). Shots: `delta3-closed-760-*`, `delta3-closed-400-*`.

## Prototype stand-ins (not product decisions)

- Plan-window state words (`Near limit` at 85 %) are mock values; the product uses the engine's `PlanWindowState`.
- Lucide `eye`, `info`, `gauge`, `message-square-text`, `arrow-down-to-line` are injected by `delta3.js` (the shared sprite does not carry them); the product imports them from `lucide-angular`.
- The `Plan limits` provider mark uses the Claude mark; with no authoritative provider id the product shows the neutral `Gauge` (D37).
- Revise r1 draws: tile details as keyboard disclosures (`info` button per tile), lane-only limit (`stats=lane`), unknown window (`stats=unk`), status / evidence / cooldown tiles and the cost-budget bar (`stats=more`), the sub-agent model in AGENTS rows. Still not drawn: the tray token count (spec only). The dock hover card carries NO model line (review finding 2).
- Gap kept honest (D55): only the session owner's windows and lane states that exist today are shown; Codex is shown with its window because the mock lane has a different owner.

## Architect flags

See design-spec D3.9: reuse the plan / lane tile components with a restyle, six `resolved*` inputs, engine tones for near / at limit, toggle state from the 9.1 aggregate, AGENTS aggregate carries tray action flags.

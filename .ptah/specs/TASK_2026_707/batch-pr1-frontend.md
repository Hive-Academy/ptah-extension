# TASK_2026_707 — PR 1 FRONTEND batch: compact uniform plan-limit tiles

Executor: frontend-developer (CLI lane). Worktree of all code changes:
`D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles` (branch `feat/plan-limit-tiles`).
No git operations were performed.

## Files changed (absolute paths)

New:

- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts` — standalone OnPush tile, `input.required()` owner/now, `output()` refresh/actionClick, `computed()` view; no per-tile timer.
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html` — uniform tile template.
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts` — 11 tests.
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts` — pure view-model mapping extracted from the 838-line card.
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts` — 22 tests.

Modified (rewritten, much smaller):

- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` — 838 → 259 lines; keeps owner selection, data flow, refresh, the refresh-failed notice; renders the tile grid.
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts` — 1717 → 451 lines; now owner mapping and data flow only.

Deleted:

- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-row.component.ts` — no importer remains (grep over `libs`/`apps` verified; no separate spec file existed).

Unchanged:

- `libs/frontend/dashboard/src/index.ts` — still exports only `ProviderAccountCardComponent`; no export change.
- `libs/shared/src/lib/types/plan-limit.types.ts` — NOT edited, per the batch rules. (The parallel backend lane already landed `statusReason`/`PlanLimitStatusReason` in it; the frontend only consumes it.)

## Acceptance criteria

1. **Tile component** — `ProviderAccountTileComponent` in
   `libs/frontend/dashboard/src/lib/components/provider-account-tile/` (ts + html + spec).
   Standalone, OnPush, `input.required()`/`output()`/`computed()`, no `@Input`/`@Output`, no
   NgModule, no per-tile timer — the shared `PlanLimitsStore` clock value is an input.
   Anatomy per provider: header (provider mark, `label · key-suffix`, plan badge, refresh),
   ONE primary bar (most constrained eligible window: finite used % and future reset; highest
   %, then nearest reset, then stable key), compact chips for other windows (label, value,
   compact reset), one secondary line (tokens/cost/requests/balance, compact numbers via
   `Intl.NumberFormat`), and a status pill in the same bar slot when no window is eligible.
2. **View model** — `plan-tile-view.model.ts` (+ spec), pure, extracted from the card.
   Claude rule implemented: a generic `weekly` window in `reset-usage-unknown` state is
   hidden from the compact view when a `weekly_model*` window exists; its reset/status stay
   in the tile header tooltip. A valid generic weekly stays (chips keep both).
3. **Grid + row removal** — the card renders `ul.tiles` with
   `grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr))`, 3–4 per desktop row, equal
   height (grid stretch + `:host{height:100%}`). `provider-account-row.component.ts` deleted.
   Long notices truncate with a `title` tooltip.
4. **Preserve list** — item-by-item check below.
5. **Backend lane fields** — `plan-limit.types.ts` untouched. The reason → label mapping lives
   in ONE place: `PLAN_LIMIT_REASON_LABELS` + `planLimitReasonLabel()` in
   `plan-tile-view.model.ts`, pre-seeded with the real keys the backend lane landed
   (`no-open-session`, `no-oauth`, `no-local-server`, `cli-unavailable`, `cli-parse-failed`,
   `api-key-no-subscription-quota`).

## Preserve-list check (where each item now shows)

| Item | Where it shows now |
| --- | --- |
| Per-window reset times | Primary bar: reset line under the bar. Chips: compact reset (`in 5h 0m`, `22m ago`, `reset unknown`). Every bar/chip `title` tooltip: full absolute + relative reset facts (including "reset passed … / next reset …" sentences). |
| Near-limit at 90% (`NEAR_LIMIT_PERCENT`) on any window | 90% tick on the primary bar; bar fill and chip turn warning at ≥ 90%; "Near limit" chip text for the window; `marks 90% (near limit)` in the section description. Applied to every window (chips), not only the primary. |
| Source badge (provider-api / live event) | Bar and chip `title` tooltips: `Sources: used Live event · reset Provider API` (per-field). Evidence-notice tooltips carry their source (`From error`, `Live event`, …). |
| Per-owner refresh | Refresh button in each tile header; disabled while the store loads; emits through the card to `load({providerId, refresh: true})`. |
| OpenCode local tokens + estimated cost | Secondary line: `1,234 tokens · $5.67`; tooltip: label, `Range: last 30 days`, provenance note ("Local CLI accounting · not a plan percentage or reset"). |
| Codex activity | Secondary line: `7.3B lifetime tokens` (string → BigInt-safe compacting, never an unsafe `Number` coercion); tooltip keeps the disclaimer "Activity is not remaining messages, credits, or billing." |
| Ollama request counts | Secondary line: `2,588 requests` (exact with separators below 10,000 — no fabricated plan percentage). |
| Notices | Status row in the tile (status chip + truncated notice + inline action), evidence and cooldown notices as truncated lines with `role="status"`; every truncation carries its full text in a `title` tooltip. |
| Accessible progressbar name/value | `role="progressbar"`, `aria-label="<window> plan usage"`, `aria-valuemin/max="0/100"`, `aria-valuenow` (rounded), `aria-valuetext="94% used"`. |
| Refresh aria-label | `Refresh <label> usage` (e.g. `Refresh Claude account · cdef usage`). |
| Keyboard focus | Only native `type="button"` buttons (refresh, inline action); no custom key handling; no non-focusable divs acting as buttons. |
| Theme tokens (Tailwind + DaisyUI, dark + light) | All colour via oklch theme vars (`--bc`, `--b2`, `--su`, `--wa`, `--er`); DaisyUI badge/btn classes; the light-theme bar re-tint rules moved with the bar; decorative per-provider accent `--accent` only tints the mark. |

## Test results

Command (memory-safe, scoped to the changed specs only):

```
npx jest -c libs/frontend/dashboard/jest.config.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts \
  libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts \
  --coverage=false --maxWorkers=1
```

Result: **3 suites passed, 47 tests passed, 0 failed** (7.1 s).

Coverage of the plan's test seam: primary tie-breaks (percent, reset, key), Claude duplicate
(hidden + tooltip; both kept when valid), 90% boundary (bar fill, chip tone), large-number
formatting (`'7337444803'` → `'7.3B'`, `'9007199254740993'` → `'9007.2T'` via BigInt, decimal
strings coerced only inside the safe range), notices + tooltips, refresh emit/aria/disabled,
status pill cause (including the typed-reason priority), progressbar name/value, source
labels, secondary lines (requests vs tokens·cost), inline action emission, owner selection
order + change, load effect ({providerId} once/on change/stop after destroy), Refresh,
empty snapshot ("Account usage unavailable", never 0%), spinner, refresh-failed notice block
(incl. real-store push clearing it), LOCALE_ID zone-name locale, one tile per owner.

## Decisions

1. **Claude duplicate rule by window shape, not providerId.** Hidden window = key `'weekly'`
   with `reset-usage-unknown` state + any `weekly_model`/`weekly_model:*` window present.
   Covers both Claude provider ids (`anthropic`, `claude-cli`) without hardcoding. The hidden
   window's reset/status sentences go into the tile header tooltip. Options: providerId match
   (rejected — provider ids vary); window shape (chosen; matches the plan's rule as stated).
   Reversible: one function.
2. **Primary eligibility excludes `reset-usage-unknown` windows even when a future reset
   exists** (window-state case b: `lastResetAt` after the observation leaves a future
   `resetsAt`). Showing its percent would fabricate a value the reset invalidated. Such a
   window becomes a chip/pill fact only.
3. **Number formatting thresholds.** `compactCount`: exact separators below 10,000
   (`2,588` — Ollama request counts keep precision), `Intl.NumberFormat` compact above
   (`7.3B`). `compactTokens`: pure-integer strings through BigInt (never an unsafe `Number`
   coercion); decimal strings coerced only after a regex + safe-range check, else `unknown`.
   ICU keeps its own mantissa for very large values (`9007.2T`); the brief's `7.3B` example
   holds for realistic token counts.
4. **Typed reason wiring.** The backend lane's `statusReason` field already exists in the
   shared DTO, so the mapping was seeded with the real `PlanLimitStatusReason` keys (not
   placeholder names) and the pill/notice consult it before the generic per-status sentence —
   this is what fixes the Grok audit defect ("No subscription quota for API-key login; local
   usage only." instead of the generic API-key line). One function, `planLimitReasonLabel`,
   is the only place to touch when more reasons arrive.
5. **Source badges live in title tooltips** (the preserve list allows "chip, secondary line
   or tooltip"); tone information stays visible via bar/chip/pill colours, so no screen-real
   estate is spent on per-field badges inside a 16rem tile.
6. **Status pill text priority:** windows exist but none eligible → fixed sentence "No plan
   window reports a known usage with a future reset"; else status notice (stale /
   service-unavailable / local-usage-only) → typed reason → per-status sentence →
   "Usage unavailable". Tone: warning for stale/CLI failures, neutral otherwise.
7. **Time formatting stays per-tile** with its own injected `LOCALE_ID` + host zone; the card
   keeps `LOCALE_ID` only for the card-level refresh-failed notice. The locale still cascades
   from the TestBed provider, so the existing zone-locale test passes through the tile
   unchanged.
8. **Card spec slimmed to owner mapping and data flow** (451 lines, 14 tests) per the plan's
   test seam; all 16 design-state presentation tests moved to the tile and view-model specs,
   where the pure mapping is asserted without a DOM where possible.

## Clarifications needed

None. The backend lane's shared-type changes were already in the worktree and were consumed
without editing `libs/shared/**` or `libs/backend/**`.
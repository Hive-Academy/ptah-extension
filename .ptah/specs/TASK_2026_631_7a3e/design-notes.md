# Provider usage list – design notes (TASK_2026_631_7a3e)

Prototype: `prototype/index.html` (self-contained; theme switcher, width toggle / resizable frame, live contrast table). No screenshots captured (browser not run in this step).

## Layout rules
- `<ul>` of `<li>`; each li = one full-width `<section aria-labelledby>` row (one per `OwnerSectionView`). Replace the `:host` auto-fit grid with a single-column flex/stack.
- Row grid (container query on the `li`, not viewport): **>1100px** `identity | windows | actions`; **641–1100px** identity + actions on line 1, windows on line 2; **≤640px** header, then windows as a vertical list, local-usage left-aligned.
- Windows: flex-wrap, `flex:1 1 11.5rem`, max 22rem, so 1–5 windows never stretch absurdly.
- Rows without windows (`windows.length === 0`) are **compact**: identity | one-line reason + optional action | refresh. No empty bar area.
- Left border (4px) + mark tint = per-provider accent (decorative; name always in text).

## Colour / state mapping
| State | Source in code | Bar | Glyph/label | Text |
|---|---|---|---|---|
| ok (<90%) | `classifyWindow` = `ok` | `success` | none | base-content |
| near limit (≥ `NEAR_LIMIT_PERCENT` = 90) | `near-limit` | `warning` | ▲ Near limit | base-content |
| limit reached / cooldown | `limit-reached`, `cooldown` | `error` (100%) | ■ Limit reached | base-content |
| unknown / aged / not-confirmed / estimate-only | other `PlanWindowState` | hatched neutral track, no fill (never an empty 0 bar) | `?` | muted |
| unavailable / no plan | `status` ≠ ok, `unknownReason` | – | neutral badge | muted |
| local-only | `localUsage` | – | info badge | – |
| official vs unofficial source | `PlanLimitSource` | – | chip; `provider-unofficial`/`estimated` dashed + italic | muted |

Colour is never the only signal: state word/glyph + `aria-valuetext`. State text stays base-content; hue lives on bar, glyph, badge tint/border (avoids low-contrast orange text on light themes; text-safe glyph tints `--su-t/--wa-t/--er-t` are darkened in light/retro).

> NOTE: `NEAR_LIMIT_PERCENT` is **90**, so an 85% window is still "ok" in real code. The prototype uses 92% for the near-limit demo; to show warning at 85 the constant would have to change (shared, affects chat view too).

## Field → visual
| Visual | Field |
|---|---|
| Provider mark / accent | `owner.providerId` (`ProviderMarkComponent`; accent map is new) |
| Name + 4-char id | `section.label` / `owner.key` suffix (`ownerDisplayLabel`) |
| Plan/subtitle | `section.subtitle` |
| State badge | `statusChip` (`ProviderAccountUsageStatus`, `unavailableReason`, `unknownReason`, `staleSince`) |
| Source chips | `commonSources` / `row.sources` (`PLAN_LIMIT_SOURCE_LABELS`) |
| Window label, % | `row.name`, `row.percent`, `row.valueText` (`PlanLimitWindow.used`) |
| Reset relative + absolute | `row.resetLines` (`formatRelative`, `formatLocalAbsolute`) |
| Compact reason + action | `statusNotice.text` / `STATUS_SENTENCES`, `noUsageSource` |
| Local usage | `localUsage` (`tokens`, `estimatedCostUsd`, `range`) – right column, caption "Local CLI accounting" |
| Not shown in prototype (keep as today, below row) | `evidence` notices, `cooldown`, Codex `activity`, `estimateNote` |

## Mapping onto existing components
- [provider-account-card.component.ts](file:///D:/projects/ptah-extension/.claude-worktrees/provider-analytics-list/libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts): change `styles` (line ~152) to `display:block`; wrap sections in `<ul>/<li>`; restructure section template into identity / `mid` / actions grid with container query on the li; `statusChip` becomes a pill with glyph; move local-usage box into actions column; windows container (~269) becomes flex-wrap with `.win` blocks (name+% on top, bar, resets); bar `success` class should be `bg-success` (today `bg-base-content`); add 90% tick; compact variant when `windows.length===0`. Keep view-model, `data-testid`s, progressbar semantics – only template/CSS changes (+ a small `providerAccent()` helper).
- [analytics-card.component.ts](file:///D:/projects/ptah-extension/.claude-worktrees/provider-analytics-list/libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts): ensure the card hosting `<ptah-provider-account-card>` gives it full width (no multi-column grid cell) and carries the "Provider accounts & plan limits" heading.
- Update existing specs asserting classes (`bg-base-content` bar) if any.

## Open questions
1. Raise sensitivity: keep 90% near-limit or lower (e.g. 80%) for earlier warnings?
2. Provider accent colours are brand-ish approximations; approve, or use the single theme `primary` for all?
3. Should compact rows (unavailable/no key) sort to the bottom, or keep selected-provider-first ordering only?
4. Retro theme tokens are DaisyUI defaults, not in `tailwind.config.js` – approximated; confirm in-app.
5. Show per-window source chips when sources differ within a row (as today), or only row-level chips?

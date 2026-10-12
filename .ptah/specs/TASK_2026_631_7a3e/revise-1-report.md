# Revise-1 report — TASK_2026_631_7a3e (provider list redesign)

Fixes from `.ptah/specs/TASK_2026_631_7a3e/code-logic-review.md` (S1, M1–M4, minors) plus the
round-1 instructions. All behaviour-preserving; every `data-testid` kept.

## Fixes

### 1. S1 (serious): aged / estimate-only / not-confirmed windows no longer read as healthy green

- `provider-account-card.component.ts:608-618` — `buildWindowRow`'s `barTone` now maps **only
  `state === 'ok'`** to `'success'`; `aged`, `estimate-only`, `not-confirmed` (and the other
  non-limit, non-near states) map to the new `'neutral'` tone. `WindowRowView.barTone` documents
  the rule at `:86-92`. A stale 97% now renders the pre-redesign neutral fill, never green.
- `provider-account-row.component.ts:299` — the fill binds
  `[class.bg-base-content]="row.barTone === 'neutral'"` (the exact pre-redesign fill class),
  beside the existing `bg-error` / `bg-warning` / `bg-success` bindings. The state word/glyph chip
  is untouched, so colour is still never the only signal.
- Spec `:994-1059` — new test "keeps a neutral fill for aged, estimate-only and not-confirmed
  windows, never a healthy green": a stale **97% aged** window (the reviewer's exact scenario),
  a 40% estimate-only and a 57% not-confirmed window each assert `bg-base-content` on the fill and
  explicitly `not bg-success`, plus their `◷ Aged` / `~ Estimate only` / `? Not confirmed` chips.

### 2. M1: compact reason occupies the `mid` grid area

- `provider-account-row.component.ts:346-349` — the compact-reason `<p>` is now
  `class="mid text-xs"` (plus the tone class), so it is placed in the named `mid` area instead of
  relying on auto-placement into a free cell. CSS `.mid` (grid-area + min-width + margin) at `:83-87`.
- Spec `:840` — the compact-row test now pins `reason.classList.contains('mid')`.

### 3. M2: a stale owner without windows keeps its warning tone

- `provider-account-row.component.ts:526-532` — new `compactReasonClass(tone)`: neutral/info
  notices stay the one-line muted reason (the approved compact design), but a **warning or error**
  notice keeps the bordered box it had before the redesign
  (`rounded border px-2 py-1 … border-warning`). Bound at `:347-348`.
- Spec `:1061-1081` — new test "keeps the warning tone on a stale owner without windows (compact
  row)": `role="status"`, `border-warning`, "Showing cached account data" text and the
  "Cached data" badge.

### 4. M3: file split — the card is back below its original size

- **New** `provider-accent.ts` (45 lines) — `PROVIDER_ACCENTS`, `providerAccent()` and the generic
  muted-tier fallback, moved out of the card.
- **New** `provider-account-row.component.ts` (522 lines) — presentational row: the whole row
  template, the row-local CSS (grid areas, container queries, bars, mark box) and the tone helpers
  (`statusChipClass`, `chipClass`, `noticeBorder`, `compactReasonClass`, `roundPercent`,
  `clampPercent`, `accentFor`, the `NEAR_LIMIT_PERCENT` tick). Inputs `section` (required) and
  `refreshing`; output `refresh`. Types come from the card via `import type` (no runtime cycle);
  `Tone` is now exported from the card for it.
- `provider-account-card.component.ts` is **668 lines** (was 1166; original pre-redesign 943): it
  keeps the view model, the store/effect/refresh wiring, and the slim list template (`:190-247`)
  with the `:host` / `.rows` / `.row` container styles (`:167-189`). All DOM output and testids are
  unchanged — the row section simply renders inside `ul > li > ptah-provider-account-row`.

### 5. M4: specs pin the redesign's key behaviours

- `:948-992` — new test "pins the near-limit boundary: 89% is still ok, 90% turns warning"
  (fresh windows at 89% and 90%: 89 → no chip + `bg-success`; 90 → `▲ Near limit` + `bg-warning`),
  matching `classifyWindow`'s `percent >= NEAR_LIMIT_PERCENT` (window-state.ts:232).
- `:994-1059` — the neutral-tone test (fix 1).
- `:1061-1081` — the stale-compact warning test (fix 3).
- `:840` — the compact `mid` pin (fix 2).
- `:1190` — the two-generic-labels test now queries `h5` (row titles dropped one level, see minor 1).
- The accent test (`:910-946`) was updated for the table changes (see minor 5).

## Minor fixes

1. **Heading levels** — the analytics block heading stays `h4`; each row's owner title is now
   `h5` (`provider-account-row.component.ts:193`) and the empty-state placeholder heading is `h5`
   (`provider-account-card.component.ts:204`), so rows sit one level under the block heading.
2. **"90%" copy bound to the constant** — `analytics-card.component.ts:12,62` exposes
   `nearLimitPercent = NEAR_LIMIT_PERCENT`; `analytics-card.component.html:83-85` interpolates
   `{{ nearLimitPercent }}%`. The analytics spec now pins `/marks\s+90%/` so the rendered copy is
   covered.
3. **Mark overflow** — `.mark-box` is 2.25rem (`provider-account-row.component.ts:71-79`): the
   provider mark's own box is a fixed 32px, so the old 2rem box with a 1px border clipped it by
   ~1px per side.
4. **Empty grid-row whitespace** — row whitespace now comes from margins, not `row-gap`:
   `.owner-row` uses `gap: 0 0.75rem` (`:52`) with `margin-top: 0.5rem` on `.mid` / `.local` /
   `.below` (`:83-87`, `:88-93`, `:100-106`), reset to 0 for `.mid`/`.local` inside the wide
   container query (`:165-178`); and `.below` renders only when it has content — the template
   wraps it in `@if (noUsageSource || evidence || cooldown || activity || windows&&statusNotice)`
   (`:386-393`). An absent area now adds no gap at any width.
5. **Accent table** — dropped `gemini` (no such owner id in `PROVIDER_BRAND_SLUGS` /
   `PROVIDER_MARKS`); added the four other real owner ids that `ProviderMarkComponent` draws
   vendored marks for: `openrouter` `#6d28d9` (their "Grape" purple), `moonshot` `#4f46e5`,
   `z-ai` `#0ea5e9`, `grok` `#71717a` (xAI monochrome). All in `provider-accent.ts:26-43`, with the
   provenance documented in its header comment. These four hues are brand-ish approximations
   (OpenRouter's is grounded in their brand-assets page naming "Grape"; the others are judgement)
   — flag for approval like the round-1 ones.

## Verification

```
npx jest -c libs/frontend/dashboard/jest.config.ts ^
  src/lib/components/provider-account-card/provider-account-card.component.spec.ts ^
  src/lib/components/analytics-card/analytics-card.component.spec.ts ^
  --coverage=false --maxWorkers=2
```

Result: **Test Suites: 2 passed, 2 total. Tests: 62 passed, 62 total. Time: ~5.1 s. Exit code 0.**
(59 previous + 3 new tests; the bar-state, accent, compact and 16-design-state suites all still
pass against the split components.)

Not run, per the round rules: `nx typecheck` / `lint` / `build` / `e2e` (the orchestrator owns
them). The container-query CSS and heading hierarchy are unverifiable in jsdom; the structural
specs pin what jsdom can see.

## Files added / changed

Added:
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-accent.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-row.component.ts`

Changed:
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (1166 → 668 lines)
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts`
- `.ptah/specs/TASK_2026_631_7a3e/revise-1-report.md` (this file)

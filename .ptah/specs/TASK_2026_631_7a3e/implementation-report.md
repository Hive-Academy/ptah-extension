# Implementation report — TASK_2026_631_7a3e (provider accounts / plan limits list redesign)

Approved design implemented: `.ptah/specs/TASK_2026_631_7a3e/prototype/index.html` + `design-notes.md`,
with the user decisions applied (NEAR_LIMIT_PERCENT stays 90; per-provider accents as in the prototype).

## What changed

### `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`

- **`styles` (lines 195–341)** — the `:host` auto-fit card grid (`repeat(auto-fit,minmax(...,21rem),1fr)`)
  is now `:host{display:block}`; a `.rows` `ul` stacks full-width rows; each `li` is its own
  `container-type:inline-size` container named `row`, so every row adapts to the width it itself has
  (never the viewport):
  - base/narrow (≤640px, also the no-container-query fallback): stacked grid areas
    `identity actions / mid mid / local local / below below`; `.wins` is a vertical list; local usage
    left-aligned.
  - `@container row (min-width:641px)` (medium): `.wins` flows horizontally (`flex:1 1 11.5rem`,
    `min-width:10.5rem`, `max-width:22rem`); `.local` right-aligned.
  - `@container row (min-width:1101px)` (wide): `identity | windows | local | refresh` on one line
    (`minmax(14rem,19rem) | minmax(0,1fr) | max-content | max-content`, centered), footnotes row below.
  - `.owner-row` = `surface-2` card with `border-left:4px solid var(--accent)`;
    `.owner-row--compact` (no windows) halves vertical padding.
  - `.identity h4{overflow-wrap:anywhere}` + `min-w-0` + `minmax(14rem,19rem)` at wide — the name can
    wrap but is never squeezed to one letter per line.
  - `.mark-box` tints the provider mark with `color-mix(in oklab, var(--accent) 22%/55%, …)`.
  - `.bar-tick` = 1px tick at `NEAR_LIMIT_PERCENT` (bound in the template, not hardcoded CSS);
    `.bar-unknown` = hatched neutral track (`repeating-linear-gradient`, `oklch(var(--bc)/0.12)`).
- **template (lines 342–669)** — restructured, same data and semantics:
  - `@for` sections became `<ul class="rows">` / `<li class="row">` / one `<section>` per owner
    (selected provider still first — view model untouched). The `@empty` placeholder moved to
    `@if (list.length === 0) { … } @else { … }` so the placeholder is never a `ul` child.
  - Identity (`data-testid="section-header"`): mark in tinted box, `h4` owner label, then a wrapping
    meta line = subtitle (`[title]` kept) + `commonSources` chips (`data-testid="source-chip"`, dashed +
    italic when unofficial, `aria-label="Usage source"` kept) + status badge
    (`data-testid="status-chip"`, `statusChipClass`, `whitespace-normal` kept).
  - Windows (`data-testid="window-row"` per `.win`): `win-top` = name (`text-[13px] font-semibold`, same
    class as before) + state chip (unchanged `chipClass`, glyph + word — colour never the only signal) +
    value (`data-testid="window-value"`, `tabular-nums`, `whitespace-nowrap` for percents) + sr-only
    `valueText`; bar = the existing `role="progressbar"` with all aria attributes plus the 90% tick, and
    the ok fill is now `bg-success` (was `bg-base-content`); `percent === null` renders the hatched
    `aria-hidden` track (`data-testid="window-unknown-bar"`) — still never a 0% bar; reset lines, limit
    line, note, per-window source chips and `estimate-note` kept verbatim below the bar.
  - Compact rows (`windows.length === 0`): one-line reason `p[role="status]"`
    (`data-testid="compact-reason"`) from `statusNotice.text` — no empty bar area.
  - Local usage (`data-testid="local-usage-stat"`): a `.local` grid area (beside refresh on wide, own
    full-width line below the identity on medium/narrow) — label, value, range and the
    "Local CLI accounting · not a plan percentage or reset" caveat all kept.
  - Refresh button unchanged (same classes, `aria-label`, `title`, `disabled` binding) in `.actions`.
  - `.below` (full width, below the row): sr-only "No usage source" note (kept), the owner
    `statusNotice` box for window-owning rows (kept `role="status"` + `noticeBorder`), owner evidence
    notices, cooldown notice, Codex activity block — all markup unchanged.
- **accent table (lines 146–188)** — `PROVIDER_ACCENTS` + exported pure `providerAccent()`
  (decorative only; provider name always in text): anthropic/claude-cli `#d97757`,
  openai-codex/codex `#10a37f`, opencode(-go/-zen) `#3b82f6`, antigravity `#8b5cf6`, gemini `#4285f4`,
  github-copilot/copilot `#8957e5`, ollama/ollama-cloud `#9ca3af`; every other id falls back to the
  theme muted tier `oklch(var(--bcm, var(--bc)))`. Class method `accentFor()` (line 735) feeds
  `[style.--accent]` (line 387).
- Header doc comment (lines 1–26) updated to describe the list layout.
- **View model, store/clock/generation-guard logic, refresh behaviour: untouched**
  (`buildOwnerSections` and everything below it are byte-identical).

### `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html`

- Lines 80–86: added the block heading `Provider accounts & plan limits` (h4) + one-line sub
  ("One row per quota owner. The tick on each bar marks 90% (near limit); bars highlight a reached
  limit.") above `<ptah-provider-account-card />`. The hosting wrapper was already full-width
  (`flex flex-col`, no grid cell), so no width change was needed there.

### Specs

`provider-account-card.component.spec.ts`:
- header comment notes the redesign coverage.
- **16b rewritten** (line 773): now pins the prototype-defect fix — the local-usage stat is a sibling
  grid area of the identity (`stat.parentElement === section`, never inside `section-header`,
  document-order after it), identity keeps `min-w-0`, status chip still `whitespace-normal`.
- **4 new tests**:
  - line 812 `renders one full-width list row per owner` — one `li` per owner, each section in its own
    `li`, list order preserved.
  - line 826 `renders a compact one-line reason row for an owner without windows` —
    `owner-row--compact` class, no `.wins`, reason text, refresh still present.
  - line 844 `colours each window bar by state and ticks the 90% near-limit mark` — ok → `bg-success`
    (and not `bg-base-content`), near → `bg-warning`, limit → `bg-error`, tick `style.left === '90%'`,
    unknown → hatched `aria-hidden` track and no `role="progressbar"`/tick.
  - line 909 `carries a decorative per-provider accent with a generic fallback` — asserts the
    `--accent` value per provider id incl. the `oklch(var(--bcm, var(--bc)))` fallback.
- line 1176: the failed-refresh notice test now asserts the notice is followed by the `UL` (structure
  changed from sibling sections to a list); behaviour assertion (notice above the kept sections,
  2 sections) unchanged.

`analytics-card.component.spec.ts`: the "renders the first page of cards" test now also pins the
"Provider accounts & plan limits" heading inside `analytics-section-provider-accounts`.

## Verification

Command (only Jest on the changed spec files, per the memory-safe rules):

```
npx jest -c libs/frontend/dashboard/jest.config.ts ^
  src/lib/components/provider-account-card/provider-account-card.component.spec.ts ^
  src/lib/components/analytics-card/analytics-card.component.spec.ts ^
  --coverage=false --maxWorkers=2
```

Result: **Test Suites: 2 passed, 2 total. Tests: 59 passed, 59 total. Time: ~9.3 s. Exit code 0.**
(4 new tests + 1 rewritten; all pre-existing behaviour specs still pass — including the 16 design
states, selection order, provider effect, refresh, empty snapshot, real-store passes.)

Not run, and why: `nx typecheck` / `lint` / `build` / `e2e` are forbidden while the other lane runs
(the orchestrator runs typecheck/lint afterwards). The Playwright visual spec
(`plan-limits-visual.e2e.spec.ts`) was checked by reading: it only counts
`provider-account-section`s and checks `cooldown` / `refresh-failed` visibility — all testids and
semantics preserved.

## Deviations from the prototype/design notes (and why)

1. **Copilot accent `#8957e5`** — the prototype had no Copilot row; this is GitHub's Copilot marketing
   purple, in the same "brand-ish approximation" spirit the design notes flag for approval.
2. **Generic fallback** — prototype used `#888`; I used the theme muted tier
   `oklch(var(--bcm, var(--bc)))` (the repository's own neutral accent, `change-set-card`, documented
   ≥3:1 on every base layer in both anubis themes; `#888` would not adapt to retro/anubis-light).
3. **Unknown-vs-aged bars** — design-notes' table row also listed aged/not-confirmed/estimate-only as
   "hatched, no fill", but the prototype's own `win()` code and the task text hatch only
   unknown/unavailable. I followed the prototype/task: any known percent keeps a value-coloured fill
   (`bg-success` default); the hatched track renders only when `percent === null` (exactly where the
   old template drew no bar). No value is hidden that was visible before.
4. **State word/glyph styling** — kept the existing bordered chip (border + tint, base-content text;
   repository convention "semantic colour only as border and tint, never as text", design §8) instead
   of the prototype's tone-coloured state text; the design notes themselves require "state text stays
   base-content; hue lives on bar, glyph, badge tint/border". The prototype's custom
   `--su-t/--wa-t/--er-t` text-safe tints do not exist in the app's themes, and plain `oklch(var(--wa))`
   text fails 4.5:1 on anubis-light.
5. **`aria-label` on the row section kept** (not the prototype's `aria-labelledby` heading link) —
   same accessible name, and existing specs assert `aria-label`.
6. **Window name stays `text-[13px]`** (current size) rather than the prototype's 12px.
7. jsdom cannot apply component CSS (container queries, grid areas), so the responsive behaviour itself
   is verified by the structural specs (DOM order, grid-area classes, `min-w-0`) plus the design's own
   prototype; visual verification in the running webview remains with the e2e/visual suite.

## Files changed/added

- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (modified)
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts` (modified)
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html` (modified)
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts` (modified)
- `.ptah/specs/TASK_2026_631_7a3e/implementation-report.md` (this file)

No files were added or deleted; the 943-line component grew to 1119 lines (+176, all template/CSS for
the approved layout) — the view-model half is unchanged, so no child-component split was needed.

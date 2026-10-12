# Code Logic Review — `TASK_2026_631_7a3e`

Scope: `git diff origin/main` for provider-account-card component (.ts, spec) and analytics-card (.html, spec). Read-only; no checks run (orchestrator owns them). Line numbers are the working-tree file `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (PAC) unless stated.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION (minor) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 4 |
| Minor | 5 |

Presentation-only claim holds: `buildOwnerSections`, `buildWindowRow`, store/effect/clock/refresh code are untouched (diff hunks touch only the doc header, new accent table, `styles`, `template`, and a 5-line `accentFor`; the last hunk is PAC:733-738). All `data-testid`s from origin/main still exist (checked by diffing the testid set; only `compact-reason` and `window-unknown-bar` are new). Source chips, Codex activity, cooldown, evidence notices, local usage text, refresh button attrs, sr-only valueText, progressbar aria attrs are all carried over.

## Findings

### Serious

**S1. Aged / estimate-only / not-confirmed windows render a green "ok" fill, even at very high percent** — PAC:1077-1083 (`barTone`, unchanged logic) + PAC:481-487 (now `bg-success`).
`classifyWindow` returns `aged`, `estimate-only`, `not-confirmed` *before* `near-limit` (window-state.ts:203-232), so e.g. a stale reading of 97% maps to `barTone: 'success'`. Previously the "ok" fill was neutral `bg-base-content`; the redesign made it green, so a 97% stale/estimated bar now reads as healthy. The state chip word is shown (colour is not the only signal), but the bar colour actively contradicts it. Design-notes (colour table) said these states are "hatched neutral track, no fill"; implementation report deviation 3 chose to keep value-coloured fill for any known percent. Fix: map `aged | estimate-only | not-confirmed` to a neutral tone (neutral fill, e.g. `bg-base-content/40`), reserving `bg-success` for `ok` only. The view-model line is a one-line change, but note this is the only place where "presentation-only" needs a tiny model touch (or derive the class from `row.chip`/state in the template). The spec at spec lines ~844-905 only covers ok/near/limit/unknown, so it would not catch this.

### Moderate

**M1. Compact reason `<p>` has no grid area** — PAC:545-555. The windows branch uses `.mid` (grid-area `mid`), but `data-testid="compact-reason"` has only `min-w-0 text-xs ...`. It is auto-placed into the first free cell: narrow/medium that is row 2 column 1 only (does not span `mid mid`); wide it lands in the empty `mid` cell by coincidence. Works today, but depends on auto-placement and on an empty named area. Add `class="mid ..."`.

**M2. Warning-tone notice flattened on compact rows** — PAC:545-555 vs `statusNotice()` PAC:946-955. A `stale` owner with no windows (tone `warning`, "Showing cached account data; refresh failed...") is now plain muted text; the old bordered `noticeBorder(tone)` box (still used in `.below` for owners with windows, PAC:~600-608) is gone for this case. The "Cached data" badge still shows, so information survives, but severity styling is dropped. Apply `noticeBorder(notice.tone)` or a left border to the compact reason.

**M3. File growth without split** — PAC is now 1166 lines (was 943; the implementation report's "1119" is stale), +223 lines of inline CSS/template in one file with the view model. Lane report says no split needed; given `styles` (~190 lines) and a ~230-line template, extracting the row template/CSS (or at least the accent table + `providerAccent` into a small helper file) would keep it reviewable. Not a defect, but flag for the humanize rule.

**M4. Specs do not pin key behaviours of the redesign** — spec ~844-905 / accent test ~909. Missing: (a) near-limit boundary exactly at 90 vs 89 (only 94 tested); (b) aged/estimate/not-confirmed bar tone (S1); (c) stale+no windows compact notice; (d) wide/medium CSS can't be tested in jsdom, so the container-query rules and the `.mid` omission (M1) are unguarded. The 16b rewrite asserts DOM-sibling structure, which does pin "stat outside identity" reasonably. The `--accent` test pins hex strings that the user already approved.

### Minor

- Accent fallback coverage: ids with real plan-limit reads that fall to the grey fallback: `z-ai` (spec itself uses it; backend `provider:getAccountUsage` tests use `z-ai`), `moonshot`, `openrouter`, `grok`. `gemini` has an accent but no evidence in the provider mark/brand tables that `gemini` is an owner id (`libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts` lists claude, copilot, codex, antigravity, opencode only for CLI ids) — harmless dead entry. Keys by `section.providerId` (PAC:387 -> owner.providerId), same id ProviderMarkComponent uses; consistent. Real ids confirmed: `anthropic`, `openai-codex`, `opencode`, `opencode-go`, `ollama-cloud`, `github-copilot`, `antigravity`, `claude-cli`.
- Hard-coded hex accents (PAC:158-170) are decorative and user-approved; `#9ca3af` (ollama) on anubis-light is ~2.5:1 as a 4px border — not text, so acceptable. Fallback `oklch(var(--bcm, var(--bc)))` matches `change-set-card` (`neutral: 'oklch(var(--bcm, var(--bc)))'`, change-set-card.component.ts:40) and the tailwind `--bcm` is defined per theme (tailwind.config.js:105,174); `color-mix(in oklab, oklch(var(--bcm...)) 22%, transparent)` is valid. Retro uses DaisyUI defaults without `--bcm`, so falls back to `--bc` (full contrast) - fine.
- Mark box is 2rem with border (PAC:~245-252) but `ptah-provider-mark` renders a fixed `h-8 w-8` (32px) span (provider-mark.component.ts:71) inside a 30px content box: ~1px overflow each side, centred; cosmetic.
- Heading semantics: the new block heading is `h4` (analytics html:80) and each row title is also `h4` (PAC:~396); rows should be one level lower (h5) under the block heading. Each row `section` has `aria-label` so there are N landmark regions (pre-existing pattern).
- Copy in analytics html (lines 82-85) hard-codes "90%" while the tick is bound to `NEAR_LIMIT_PERCENT`; will drift if the constant changes. Also `sr-only valueText` + visible value + `aria-valuetext` read the value up to three times (pre-existing sr-only; preserved).
- Wide layout: `.local` is `max-content` (PAC:~331); with a long local-usage label the windows column (`minmax(0,1fr)`) shrinks, but at >=1101px it still has roughly 400px. OK. Empty named grid rows (`local`, `below`) still add `gap` (0.5rem each) in narrow/medium when absent, so rows carry up to ~1rem of extra bottom whitespace; cosmetic.

## Checks that passed

- State colour mapping uses `classifyWindow` output (PAC:1033-1040): limit-reached/cooldown -> `bg-error` + "Limit reached" chip; near-limit (>= `NEAR_LIMIT_PERCENT`=90) -> `bg-warning` + "Near limit"; ok -> success; usage-unknown/reset-usage-unknown (`percent === null`) -> hatched `aria-hidden` track, **no progressbar and no 0% bar** (PAC:494-500). Chips carry glyph + word (PAC:126-136). Tick left bound to `nearLimitPercent` (PAC:491).
- Progressbar aria: `aria-valuenow = round(percent)`, min 0 / max 100, `aria-valuetext`, `aria-label` retained (PAC:470-478). `aria-valuenow` is not clamped (pre-existing).
- Ordering: selected-provider-first unchanged (view model untouched); `@for` over `ul.rows > li.row` (PAC:381-383); `@empty` placeholder moved out of the `ul` (PAC:353-380).
- Container-query CSS: each `li` is `container-type: inline-size` (named `row`); narrow default stacks identity/actions, mid, local, below; identity is `minmax(0,1fr)` with `overflow-wrap:anywhere` and 14-19rem at wide; local usage is a sibling grid area, never inside identity (fixes the prototype's OpenCode defect). No-CQ browsers fall back to the stacked narrow layout. Theme colours use `oklch(var(--bc))`/DaisyUI tokens (no hard-coded text colours).
- Refresh: single shared `load({providerId, refresh:true})` unchanged; button attributes unchanged.
- Playwright `plan-limits-visual.e2e.spec.ts` (webview-e2e-harness, lines 208-226) only uses `ptah-provider-account-card`, `provider-account-section` count, `cooldown`, `refresh-failed`, and a button named `/^Refresh /` — all preserved. No other consumer of removed classes found (`bg-base-content` fill, `sm:grid-cols` header).
- analytics-card.component.html change is additive (heading + sub copy); spec pins the heading text.

## Five logic questions (short)

1. Silent failure: S1 (stale/estimated high-percent shown green); M2 (stale severity styling dropped on compact rows).
2. Unexpected user action: none found; Refresh from any row triggers the same global reload (pre-existing).
3. Wrong-answer inputs: aged/estimate-only/not-confirmed with percent >= 90 (S1).
4. Dependency failure: store/notice paths untouched; `refresh-failed` notice still precedes the list.
5. Missing: tests for boundary 89/90 and non-ok-known-percent tone; `.mid` for compact reason.

## Verdict

- Recommendation: REVISE (small) — fix S1 and M1, optionally M2/M3.
- Confidence: HIGH on logic/structure (read in full); MEDIUM on visual outcome, which jsdom cannot verify and which I did not render.
- Top risk: a 97% stale or estimated window shows a green bar.

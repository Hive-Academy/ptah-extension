# Revise 2 Report — TASK_2026_631_7a3e (provider analytics list)

Fixes for the visual review (`visual-review.md`, verdict PASS WITH NOTES).
Scope held to `libs/frontend/dashboard/src/lib/components/provider-account-card/`
plus this report; no other files touched. No commit/push/stash.

**Files changed (3):**
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-row.component.ts` (row presentation: fills, badge, layout, action button)
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (view model: glyphs, actions, range label)
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts` (updated + 2 new tests)

No files added; no files removed. All `data-testid`s kept (`provider-account-section`, `window-progress`, `state-chip`, `status-chip`, `compact-reason`, `local-usage-stat`, …) and new ones added (`compact-action`, `local-usage-range`).

## Per-item table

| Item | Fix | Where (file:line) |
|---|---|---|
| M1 — neutral fill heaviest | Neutral (aged / estimate-only / not-confirmed) bar fill is now the muted `bg-base-content/45` tier instead of full-strength `bg-base-content`, via a new `barFillClass()` helper; success/warning/error keep their utility classes. Spec pins `bg-base-content/45` present AND the full-strength class absent. | `provider-account-row.component.ts:558-570` (`barFillClass`), `:318-321` (fill binding); `provider-account-card.component.spec.ts` (test "keeps a neutral fill for aged, estimate-only and not-confirmed…", ~:1120-1140) |
| M2 — fills < 3:1 in light themes | On the root's `data-theme-mode='light'` marker, every fill is re-tinted darker with `color-mix(in oklab, oklch(var(--su)\|--wa) 60%, black)` and error 75%, scoped through a `bar-fill` marker class on the fill div. Dark themes keep the plain semantic fills. | `provider-account-row.component.ts:174-182` (re-tints), `:163-173` (marker comment), `:318` (`class="bar-fill h-full rounded"`) |
| M3 — bare status badge in dark; misaligned at 420 | `statusChipClass()` appends `badge-outline` to every tone (error/warning/ghost), so the badge is a visible pill in every theme; every status now leads with a glyph (○ not configured/unread, ◷ cached, – no plan limits (API key), ! CLI trouble) rendered like the state chips. The badge stays in the flex-wrap meta row, so when it wraps at 420 it starts flush-left, aligned with the subtitle's edge — with a border + glyph it no longer reads as indented bare text. | `provider-account-row.component.ts:544-553` (`statusChipClass`), `:252-263` (glyph span in the badge); glyphs in `provider-account-card.component.ts` `statusChip()` (~:538-596); spec pins glyphed texts (tests 5, 11, 15, 16, 16c, stale-compact) |
| Minor 4 — identity caps at 19rem | Wide-row identity column is `minmax(14rem, max-content)`: grows to its content when space is free (long names no longer wrap at 1800px), never below 14rem so the name is never squeezed; windows column takes the rest. | `provider-account-row.component.ts:207` (wide grid columns; comment :200-206) |
| Minor 5 — "100%" wraps under a long chip | The value span is an inflexible flex item (`.win-value { flex: none }`, plus the existing `whitespace-nowrap` for percent values) so it stays on the chip's line; the name/chip span takes the remaining space (`.win-name { flex: 1 1 0; min-width: 0 }`) and wraps inside itself instead. | `provider-account-row.component.ts:135-141` (CSS), `:294` (`win-name` class), `:306` (`win-value` class) |
| Minor 6 — raw ISO range | Local usage shows "Range: last N days", derived from the CLI's own "start - end" ISO range by `localRangeLabel()` (day count = rounded span; falls back to the raw string when the range does not parse, e.g. "since install"); the exact range string stays in the stat's `title` tooltip. | `provider-account-card.component.ts:499-513` (`localRangeLabel`), `:490` (view field); `provider-account-row.component.ts:413-420` (label + title); spec `:415-433` |
| Item 7 — inline actions (approved) | Compact rows end with the prototype's inline actions, wired ONLY to existing webview navigation: "Open session" (no-open-session reason) → `AppStateManager.setCurrentView('chat')` — the same call `DashboardGridComponent` uses; "Add key" (Ollama Cloud missing key) → `AppStateManager.openSettingsTab('providers', providerId)` — the existing Settings deep-link (SettingsTabId 'providers', optional providerId). Buttons are `btn btn-ghost btn-xs` (24px tall target, label = accessible name) inside the compact reason line, emitting through a new `actionClick` output handled by the card. No new RPC methods or backend code. "How to refresh" skipped — see Clarifications. | `provider-account-card.component.ts:131-141` (`RowActionView`), `:151` (view field), `:456-486` (`compactRowAction`), `:253` + `:340-347` (inject + `onRowAction`), `:264` (template wiring); `provider-account-row.component.ts:388-399` (button), `:522` (output); spec `:445-471` |

## Contrast reasoning (M1 / M2)

**M1 (neutral ≥ 3:1, muted):** the visual review measured full-strength `bg-base-content` at 13.89 (anubis) / 14.21 (anubis-light) / 10.79 (retro) against the row background, and proposed "e.g. `bg-base-content/45` that still meets 3:1". A 45% alpha of base-content composited over the row's own background lands mid-grey in every theme: in the light themes base-content is near-black, so 45% over a near-white row is ≈ #8a8a8a → relative luminance ≈ 0.26 → ≈ 3.2-3.7:1; in anubis base-content is near-white, so 45% over a near-black row is a mid-grey ≈ 4-5:1. Both hold ≥ 3:1 while reading as a muted, secondary tier — the green/red bars now outweigh it, so a stale 97% no longer reads as the heaviest (healthiest-looking) element.

**M2 (success/warning/error ≥ 3:1 in light themes):** measured failures were 2.12-2.32:1 (success/warning in anubis-light + retro) and 2.42:1 (retro error). The re-tint hooks the root's `data-theme-mode='light'` attribute — which `ThemeService` sets explicitly "so … tokens can adapt to ANY selected daisyUI theme without per-theme CSS" — so the fix covers the three audited themes plus every other light theme, with three small rules contained in the row's own styles. `color-mix(in oklab, oklch(var(--su)) 60%, black)` halves oklab lightness; in the 0.4-0.8 lightness band, WCAG relative luminance falls faster than oklab L (roughly quadratically), so halving oklab L cuts sRGB luminance to well under half → contrast roughly doubles from ~2.1-2.3 to ≈ 4:1. Error (already 3.19 in anubis-light, 2.42 in retro) uses a 75% mix → ≈ 3.5-4.5:1. Dark themes are untouched and already measure ≥ 3.5:1 (success 5.25, warning 6.18, error 3.59). The override wins on specificity over the `bg-*` utility (host-context + marker + tone classes), so the utility classes remain the source of truth the specs pin.

## Jest result

`npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=2`
→ **Test Suites: 1 passed, 1 total. Tests: 50 passed, 50 total. Exit code 0.** (48 existing tests updated where behaviour changed; 2 new tests: the "last N days" range label and the inline actions.)

Typecheck/lint/build/e2e intentionally not run — the orchestrator runs them, per the round rules.

## Decisions

- **`data-theme-mode='light'` over a theme-name list**: one marker covers all 16 light DaisyUI themes instead of naming anubis-light/retro (and silently missing cupcake/lofi/…); it is the exact mechanism the codebase documents for cross-theme tokens.
- **Utility fill classes kept + `bar-fill` marker**: the M2 override needs only a scoping hook; keeping `bg-success`/`bg-warning`/`bg-error` (and `bg-base-content/45`) means the existing class-based spec assertions stay valid and the change stays minimal.
- **Status glyph vocabulary** (prototype used ○ / – / ▲): ○ = not configured / unread / unavailable, ◷ = cached, – = no plan limits (API key), ! = CLI unavailable / CLI update needed. `available` still renders no badge at all.
- **Inline action wiring** (existing handlers only, both verified in the webview code): `setCurrentView('chat')` is the same navigation `DashboardGridComponent` performs; `openSettingsTab('providers', providerId)` is the existing Settings deep-link (`SettingsTabId: 'providers' | 'claude-auth' | …`). The row stays presentational — it emits `actionClick`; the card owns the navigation. The card's spec now provides an `AppStateManager` double (both "through the real store" configs included).
- **Badge-outline class is not separately spec-asserted**: the glyphed badge texts are pinned in 7 assertions; `badge-outline` is a class-list change covered by those tests' mounting but has no dedicated `toContain('badge-outline')` assertion (kept the spec change surface minimal).
- **Refresh target stays 24x24** (the review's separate minor note vs the prototype's ~36px): not in the fix list, left as is (meets WCAG 2.5.8 minimum).
- **The 0.5px subtitle overflow at 420** (real OpenCode row, "not visibly clipped"): not in the fix list, left as is.

## Clarifications Needed

- **"How to refresh" (Antigravity's "Open Antigravity to read local quota") was skipped.** No existing webview action, route or frontend-callable RPC opens an external app, opens provider docs, or shows refresh instructions: `openExternal` exists only as a backend `IUserInteraction` implementation (not reachable from the webview without new RPC wiring), and no Settings tab owns Antigravity refresh instructions. Implementing it needs an orchestrator decision (docs link via a new RPC, a Settings deep-link, or a static tooltip) — all out of this round's "existing actions only" rule.
- The **`--su-t/--wa-t/--er-t` text-safe tint tokens the design notes mention do not exist in the app's themes** (confirmed in round 1's implementation report), so M2 derives the darker tints locally with `color-mix` instead of adding theme tokens (which would have escaped the component-scope rule).

# Visual re-check - TASK_2026_658 (commit f77aa430c)

Narrow re-check of visual-review "Serious 1" and "Moderate 3". Not a full review.

## Environment

- Worktree `D:\projects\ptah-extension\.claude-worktrees\feat-advanced-settings-ui`, head `f77aa430c`. No checkout, commit or source edit was made.
- Served with `npx nx serve ptah-extension-webview --parallel=1 --port=4377 --prebundle=false` (dev server on the working tree, so it runs the committed fix).
- `marked-katex-extension` did not resolve, so the 2-line stub went into the git-ignored `.angular/node_modules/`. It has been removed.
- Rendering: Playwright chromium headless with the `webview-e2e-harness` helpers (`bootSettings`, vscode host, theme via `localStorage ptah-theme`). `settings:get` and `settings:set` use the same overrides as the first review. The scratch spec is `_capture/recheck.spec.ts`; raw numbers are in `_capture/metrics-recheck-dark.json` and `metrics-recheck-light.json`.
- Themes: `anubis` (dark), `anubis-light` (light). Widths: 360 and 1000 px. Colours were resolved by the browser and composited over the ancestor backgrounds. Contrast is the WCAG relative-luminance ratio. Criteria: 4.5:1 for text (WCAG 1.4.3), 3:1 for a UI-component border (WCAG 1.4.11).
- Cleanup: dev server stopped, nothing listens on 4377, stub removed, `git status` clean.

## State 1: number-field error (`internalQuery.maxConcurrent`, typed `0`, then blur)

Screenshots: `screenshots/recheck-number-error-<theme>-<width>.png`.

| Theme | Width | Error text colour on surface | Text contrast | Input border after error | Border vs input fill | Border vs surface | Announced | Result |
|---|---|---|---|---|---|---|---|---|
| dark | 360 | `#f87171` on `#19191f` | 6.33:1 | `#f87171`, 1px solid | 6.70:1 | 6.33:1 | `role="alert"` on the error `<p>`; `aria-invalid="true"`; `aria-describedby` lists the `-help` and `-error` ids | PASS |
| dark | 1000 | `#f87171` on `#19191f` | 6.33:1 | `#f87171`, 1px solid | 6.70:1 | 6.33:1 | same | PASS |
| light | 360 | `#af0019` on `#f0ece8` | 6.30:1 | `#af0019`, 1px solid | 6.94:1 | 6.30:1 | same | PASS |
| light | 1000 | `#af0019` on `#f0ece8` | 6.30:1 | `#af0019`, 1px solid | 6.94:1 | 6.30:1 | same | PASS |

- The error text is `Use a whole number from 1 to 16 queries.`, 12px, class `text-error`. It is the only `role="alert"` on the page. The group `role="status"` lines stay empty for a client validation error, as the fix report states.
- Input classes include `input-error` and the forced `!border-[color:var(--ptah-error-ink,oklch(var(--er)))]`. The light border was `#e6e2df` (1.10:1 on the surface, 1.21:1 on the fill) before the error and is `#af0019` after it. This confirms the specificity fix reasoned about in `visual-fix-report.md`.
- Focus had moved to the next field when measured (`focused: false`), so the red border is the error state and not a focus ring.
- No horizontal document overflow at either width (`docOverflowX = 0`).

## State 2: boolean toggle state text (`memory.symbolInjectionEnabled`, default on)

Screenshots: `screenshots/recheck-toggle-<theme>-<width>.png` (Enabled) and `recheck-toggle-disabled-<theme>-<width>.png` (Disabled, after a click that the host confirmed).

| Theme | Width | Toggle | Text beside toggle | Colour on surface | Contrast | Wrap / clip | Result |
|---|---|---|---|---|---|---|---|
| dark | 360 | checked | `Enabled` | `#e8e6e1` on `#19191f` | 14.03:1 | 1 line box, 46x16 px, scrollW 46 = clientW 46 | PASS |
| dark | 360 | unchecked after write | `Disabled` | `#e8e6e1` on `#19191f` | 14.03:1 | 1 line box, 49x16 px, scrollW 49 = clientW 49 | PASS |
| dark | 1000 | checked | `Enabled` | `#e8e6e1` on `#19191f` | 14.03:1 | 1 line, 46x16 | PASS |
| dark | 1000 | unchecked after write | `Disabled` | `#e8e6e1` on `#19191f` | 14.03:1 | 1 line, 49x16 | PASS |
| light | 360 | checked | `Enabled` | `#291334` on `#f0ece8` | 14.44:1 | 1 line, 46x16, scrollW = clientW | PASS |
| light | 360 | unchecked after write | `Disabled` | `#291334` on `#f0ece8` | 14.44:1 | 1 line, 49x16, scrollW = clientW | PASS |
| light | 1000 | checked | `Enabled` | `#291334` on `#f0ece8` | 14.44:1 | 1 line, 46x16 | PASS |
| light | 1000 | unchecked after write | `Disabled` | `#291334` on `#f0ece8` | 14.44:1 | 1 line, 49x16 | PASS |

- The text matches the toggle in every case (`isChecked()` true with `Enabled`, false with `Disabled`). The text changes after the confirmed write, which is the intended read-back behaviour. The section status line then reads `Saved Add code symbols to prompts.`
- At 360 px the label spans x 46 to 314 inside a 360 px viewport. The text is 12px, `line-height` 16px, and never wraps or clips (the 49 px `Disabled` text is the widest case).

## New defects

None found in these two states. Observation only, outside this re-check's scope: in the light theme the idle (no error) input border is `#e6e2df`, 1.10:1 on the surface and 1.21:1 on the input fill. That is the existing theme rule at `apps/ptah-extension-webview/src/styles.css:2130-2136` and affects every `.input` in the app, not this change. The fix report already traces it.

Verdict: PASS

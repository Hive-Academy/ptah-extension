# Visual Review - TASK_2026_692_f748 (Phase 3)

## Summary

| Metric            | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Overall score     | 7.5/10                                                                 |
| Assessment        | APPROVED                                                               |
| Visual breaking   | 0                                                                      |
| Serious           | 0                                                                      |
| Moderate          | 3                                                                      |
| Minor             | 1                                                                      |
| Viewports tested  | 2 widths (1365x983 wide, 640x800 narrow), each in 2 themes, before and after |
| Screenshots taken | 38 saved under `visual/` (plus scratch captures in D:\tmp, not kept)   |
| Components tested | 2 (compaction marker chip; two new Context budgets settings rows)      |

Score rationale: the new copy and rows render correctly, are readable in both themes (label contrast
5.8:1 light, 5.9:1 dark) and have a visible 2px focus ring. 7.5 rather than 9 because the long idle
sentence makes the chip a 4-line pill at tile width and pushes the token line into an unreadable
ellipsis. That is a legibility cost, not a break, so it does not reach the 5-6 band.

## Environment

- Method: the Electron app was built (`nx build-dev` then `nx copy-renderer-dev`, `--parallel=1 --skip-nx-cache`) and launched one at a time. This was allowed by decisions.md row 15.
  - After: worktree `idle-compaction`, HEAD 2fd53158e (dev build, `dist/apps/ptah-electron`).
  - Before: detached worktree at 7bdc6eed4 (`idle-compaction-base`) with a node_modules junction. It was built the same way, and the worktree and junction were removed afterwards. `git worktree list` shows only `idle-compaction`.
- Both apps ran with `NODE_ENV=development`, CDP on port 9335 only (port 9334 untouched), and the workspace `D:\tmp\ptah-visual-ws` passed as the CLI argument.
- Isolation: I patched `app.setPath("userData", ...)` in the untracked build output `dist/apps/ptah-electron/main.mjs` (not source) to read `PTAH_VISUAL_USERDATA`. Each app used a throwaway profile (`D:\tmp\ptah-visual-after`, `...-base`). This avoids the single-instance lock held by the other session's "Ptah Dev" profile and avoids touching its data.
- Driver: Playwright `connectOverCDP` scripts in `%TEMP%\drv` (outside the repo). No source file edited, nothing committed, no tests run.
- Both apps were stopped when finished; no process with 9335 remains.
- Viewports: wide = 1365x983 and narrow = 640x800, applied with `Emulation.setDeviceMetricsOverride`. At 640 the chat tile is about 260 px wide. This is an audit selection, not a support contract (the repo documents no web viewport policy for the Electron shell).
- Themes: `anubis` (dark, default) and `anubis-light`, switched by setting `data-theme` on `<html>`, the same attribute the theme toggle sets.
- Expectation sources: WCAG 2.2 AA (4.5:1 normal text, 3:1 UI components, 24x24 target) because the repo declares no other standard; DESIGN.md/PRODUCT.md were not consulted for tokens beyond the shared theme.

### How the marker state was produced (screen 1)

A real idle compaction needs a 1-hour-idle session with a live Claude provider, so I drove the real
component state instead. I created a session from the UI (New Session, then Create). Through the
Angular debug API (`ng.getComponent(<ptah-chat-view>)`) I took the component's own
`ConversationRegistry` and `TabSessionBinding`, bound a conversation to the tab, and called the
production methods `setCompactionMarkerTokens(...)` and `setCompactionMarkerSummary(...)`. The
fixture was: `boundaryId` unique per run, `measurement {sdk-compact-metadata, preTokens 250000,
postTokens 31000}`, `durationMs 12400`, `completedAt = now`, plus `idleCompaction: { preTokens: 250000 }`
for the idle variant. `ChatViewComponent.visibleCompactionMarker` then renders the real
`<ptah-compaction-marker>` with real CSS. The "no notice" variant used the same call without
`idleCompaction`. On the base build the same call was made, and the old registry ignores
`idleCompaction`, so only the plain state exists there. This exercises the component, registry and
template. It does not exercise the backend stamp or the stream forwarding (those are covered by
the other batches' tests).

### How the settings were reached (screen 2)

Settings, then **Agent Orchestration** tab. The Context budgets group is rendered by
`orchestration-settings.component.ts` through `ptah-advanced-settings-group`, not on the **Advanced**
tab. The Advanced tab has only Memory, Skill, Scheduled jobs and Workspace harness groups, so the
brief's "Settings > Advanced > Context budgets" path is slightly off. The rows are where the code
puts them. Not a defect.

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate and minor

#### M1. Idle sentence forces a 4-line pill at tile width (Moderate)

- File: `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:24` (chip `rounded-full ... max-w-full`), `:28-37` (label span).
- Viewports: 640 (chip 260x86), both themes.
- Screenshots: `after-marker-idle-dark-narrow.png`, `after-marker-idle-light-narrow.png`, `after-marker-idle-dark-narrow-chip.png`; compare `before-marker-dark-narrow.png` (chip 260x38, label already wraps to 2 lines).
- Problem: "Compacted while idle to save usage before the prompt cache expired (was 250,000 tokens)." wraps to 4 lines inside a `rounded-full` pill. The pill reads as a rounded block, and the text is centred vertically against the icon, the ellipsis and the View button.
- Impact: no clipping and no horizontal overflow (`scrollWidth == clientWidth`, document has no horizontal scroll), so the user can still read the sentence. The chip looks heavy and tall next to the old single-line chip.
- Fix: use `rounded-2xl` (or `rounded-full` only on wide), and/or put the token line on its own row when the label wraps.

#### M2. Token line becomes unreadable behind the longer label (Moderate)

- File: same, `:39` (`<span class="opacity-60 truncate">`).
- Viewports: 640 and 1365, both themes.
- Screenshots: narrow shows "· shran…" (`after-marker-idle-light-narrow.png`); wide shows "· shrank 250,000 → 31,000 token…" (`after-marker-idle-light.png`). The wide chip wraps the label to 2 lines and still truncates.
- Problem: the label span is not shrinkable (`flex-shrink` default 1 but it wraps first), so `truncate` on the token span takes all the squeeze. Measured: token span scrollWidth 239 px vs clientWidth 55 px at narrow. The "before" chip also truncates the token line at narrow ("· shrank 250,000 …"), so this is an existing weakness the longer sentence makes worse, and it now also truncates at wide width.
- Impact: the "250,000 → 31,000 tokens in 12.4s" detail is not visible; it is available only in the View modal (`:84` shows `tokenLine` there, so no information is lost).
- Fix: allow the token line to wrap (`whitespace-normal`) or move it below the label with `basis-full`; or add a `title` with the full line.

#### M3. Token line contrast below 4.5:1 (Moderate, pre-existing)

- File: same, `:39` `opacity-60` on `text-base-content-muted`.
- Measured: the label itself passes (dark `rgb(152,146,145)` on `rgb(21,21,26)` = 5.94:1; light `rgb(116,86,101)` on `rgb(246,242,239)` = 5.78:1). The `opacity-60` token line works out to about 3.0:1 dark and about 2.6:1 light (hand-calculated from the opacity; the rest are measured).
- Screenshots: `after-marker-idle-dark.png`, `after-marker-idle-light.png`; the same style exists in `before-marker-*.png`.
- Impact: unchanged by this task (base has the identical class). Reported for completeness; do not block on it.
- Fix: drop `opacity-60`, or use a token with 4.5:1.

#### m1. New toggle track is 32x20 px (Minor, pre-existing pattern)

- File: `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts:153` (`toggle toggle-sm`).
- The checkbox measures 32x20 px, under the 24 px WCAG 2.5.8 height. The whole "Enabled" row is the bordered control (row 32 px tall) and the existing Codex web search row is identical, so this is the existing design, not a regression.

## Prototype fidelity

- Approved prototype: None found in the task folder (`prototype/` absent); no prototype is required because no new surface was added.
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (dark and light, wide and narrow), all under `.ptah/specs/TASK_2026_692_f748/visual/`:
  - Marker, before: `before-marker-dark.png`, `before-marker-light.png`, `before-marker-dark-narrow.png`, `before-marker-light-narrow.png` (plus `-chip` crops). It reads "Context compacted" plus the token line. Result: baseline.
  - Marker, after, with idle notice: `after-marker-idle-dark.png`, `after-marker-idle-light.png`, `after-marker-idle-dark-narrow.png`, `after-marker-idle-light-narrow.png` (plus `-chip` crops). The label is exactly "Compacted while idle to save usage before the prompt cache expired (was 250,000 tokens)." followed by the token line. Result: copy correct; see M1 and M2.
  - Marker, after, without notice: `after-marker-plain-dark.png`, `after-marker-plain-light.png`, `after-marker-plain-dark-narrow.png`, `after-marker-plain-light-narrow.png` (plus `-chip` crops). It reads "Context compacted" and is geometrically identical to before (436x26 wide, 260x38 narrow). Result: no regression.
  - Settings, before: `before-settings-context-budgets-dark.png`, `-light.png`, `-dark-narrow.png`, `-light-narrow.png`. Four rows only; DOM has 4 `advanced-setting-compaction.*` inputs, no idle row.
  - Settings, after: `after-settings-context-budgets-dark.png`, `-light.png`, `-dark-narrow.png`, `-light-narrow.png`. Two new rows are present (6 inputs); toggle shows Enabled (default on), number shows 200000 (default). Result: matches the descriptors in `advanced-settings.types.ts:178-199`.
  - Focus: `after-settings-focus-toggle-dark.png`, `after-settings-focus-toggle-light.png`, `after-settings-focus-toggle-light-narrow.png`, `after-settings-focus-number-dark.png`, `after-settings-focus-number-light.png`, `after-settings-focus-number-light-narrow.png`.

## Viewport results

| Screen | Width | Elements checked | Status | Screenshot |
| ------ | ----- | ---------------- | ------ | ---------- |
| Chat marker, idle | 1365 | wrap, truncation, overflow, contrast | Pass with M2 | `after-marker-idle-{dark,light}.png` |
| Chat marker, idle | 640 | same | Pass with M1, M2; no horizontal scroll | `after-marker-idle-{dark,light}-narrow.png` |
| Chat marker, plain | 1365 / 640 | unchanged vs before | Pass | `after-marker-plain-*.png` |
| Settings, Context budgets | 1365 | 3-column grid, 6 rows | Pass (new toggle and number fill cells 5 and 6; the grid stays aligned) | `after-settings-context-budgets-{dark,light}.png` |
| Settings, Context budgets | 640 | 1-column stack | Pass; the page-level horizontal scrollbar visible at this width is also present in the before build (`before-settings-context-budgets-dark-narrow.png`), so it is not introduced here | `after-settings-context-budgets-{dark,light}-narrow.png` |

## Component and interaction results

| Component | States tested | Status | Screenshot |
| --------- | ------------- | ------ | ---------- |
| Marker chip | idle label, plain label, token line, View button visible | Pass with M1-M3 | marker files above |
| Compact idle chats toggle | default (on), keyboard focus, focus in both themes | Pass | `after-settings-focus-toggle-*.png` |
| Compact idle chats from input | default 200000, keyboard focus, text selected on focus | Pass | `after-settings-focus-number-*.png` |

Not exercised: hover, disabled and error states of the two new rows, and the View modal. The
validation message path was not entered (range checks for the 100,000-5,000,000 limit were not
tested in the UI).

## Design system compliance

- The new rows reuse the existing `ptah-advanced-settings-group` markup and daisyUI `toggle toggle-sm toggle-primary`, so they look identical to the neighbouring rows and to the Codex web search toggle. No token deviations seen.
- The marker keeps the same utility classes as before; the only change is the label text and the added `data-testid`.

## Accessibility audit

- Marker label contrast: dark 5.94:1, light 5.78:1 (pass, 4.5:1). The token line is lower (M3, pre-existing).
- Focus: toggle and number input both show a 2px solid outline when reached with Tab (`:focus-visible` true). Dark ring `oklch(0.925 0.007 88.6)` on the dark surface; light ring `oklch(0.236 0.066 313)` on the light surface. Both are clearly visible in the screenshots. Tab order: Subagent stop size, then Compact idle chats, then Compact idle chats from, which follows the visual order.
- Names: the toggle has `aria-label="Compact idle chats"`; `getByRole('textbox', {name: /Compact idle chats from/})` resolves to exactly one element. The marker label has a stable `data-testid`.
- Target size: see m1.
- Not done: screen-reader pass; heading order outside the two screens.

## Visual performance

- No layout shift observed when the marker appeared or the settings rows rendered (nothing moved after load in successive captures). This was not measured with a performance trace, so it is an observation only.
- No loading skeleton states exist for these two items; none were assessed.

## Residual uncertainty

- The marker was rendered from injected state, not from a real idle compaction.
- The settings values on screen (for example Subagent stop size 10000000) appear in the before build too, so they come from the environment's shared config and are not related to this change.
- Only the dev (development) builds were reviewed, not a packaged production build.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH
- Key concern: the new idle sentence makes the chip a 4-line pill and truncates the token line to an unreadable ellipsis at tile width (M1, M2). It is worth a follow-up but does not break the layout.

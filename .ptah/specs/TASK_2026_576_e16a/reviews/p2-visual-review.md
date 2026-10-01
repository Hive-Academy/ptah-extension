# P2 Phase-End Visual Review - TASK_2026_576_e16a

Verdict: **APPROVED WITH FIXES** (score 6/10). Visual breaking 0, Serious 3, Moderate 2, Minor 1.

## Method and environment

- AFTER: `feat/task-2026-576-p2` @ `d83b3fbb1`, built with `npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron` (succeeded).
- BEFORE: throwaway worktree `D:/ptah-p2-before` at `origin/main` (`a4a3f8212`), `node_modules` junctioned (package.json / package-lock.json identical between the two, confirmed with `git diff`), same build targets (succeeded). Worktree and junction removed afterwards (`rmdir` on the junction, then `git worktree remove --force`); `git worktree list` no longer shows it.
- Capture: throwaway Playwright specs (`_p2-visual-capture.spec.ts`, `_p2-badges.spec.ts`) reusing `UiDriver` (`installFakeRpcListener`, `mockRpc`, `prepare`, `goto('git')`), one Electron launch per spec, `git:info` / `git:branches` / `git:checkout` mocked, entry override for BEFORE. Both specs deleted; `git status` shows only the new `screenshots/p2/` folder untracked.
- Themes: `data-theme` set on `documentElement` to `anubis` (dark) and `anubis-light` (light). Window 1200x800 (Electron default), single wide viewport. The P1-documented narrow-rail artifact was not revisited; there is no documented narrow-width support contract, so this is an audit selection, not a support contract.
- Contrast: computed from `getComputedStyle` colour, composited through each ancestor's background and the cumulative `opacity`, converted to sRGB via canvas; WCAG 2.x ratio. Criterion: WCAG AA, 4.5:1 for normal text (all text here is 10-12 px, so no large-text relief), 3:1 for UI components. The repository declares no stricter standard.
- Local launches succeeded first time (no ERR_FAILED). One harness retry was needed only because my first spec forgot the fixture's default RPC mocks and `prepare()` (harness mistake, not a product issue).
- Disclosure: while cleaning up I accidentally deleted `before-dark-badges.png` and `before-dark-badges-page.png` with an over-broad `rm` glob after the BEFORE worktree was gone. The BEFORE dark badge measurements survive in `before-badges-measurements.json` (identical to light apart from colours) and the BEFORE light screenshots survive. The BEFORE-dark badge image is the one missing capture.

Screenshots: `.ptah/specs/TASK_2026_576_e16a/screenshots/p2/` (`before-|after-` x `dark|light` x state). Raw measurements: `after-measurements.json`, `before-measurements.json`, `after-badges-measurements.json`, `before-badges-measurements.json`.

## Surface 1: branch picker

| State | Before | After | Notes |
| --- | --- | --- | --- |
| List | before-{dark,light}-picker-list.png | after-{dark,light}-picker-list.png | Unchanged structure. |
| Blocked switch | before-*-picker-blocked.png (old "Force checkout will discard..." with orange "Discard changes and checkout" as the only action) | after-*-picker-blocked.png | New: "Stash & switch" is the single primary (btn-primary, focused: activeElement = `stash-switch`), Cancel ghost, "Discard & switch..." ghost red text behind confirmation, conflicting paths listed in mono, truncated with title. Hierarchy is clearly better than before. |
| Discard confirmation | n/a | after-*-picker-discard-confirm.png | Copy "Discard all uncommitted changes? This cannot be undone.", btn-error "Discard changes" focused, "Back" ghost. |
| Discard refused (untracked) | n/a | after-*-picker-discard-refusal.png | `data-testid="discard-refusal"` shown above the path list, "Discard & switch..." absent, only Stash & switch / Cancel. Reads correctly in both themes. |
| Stash notice | n/a | after-*-picker-stash-notice.png (+ `after-dark-picker-stash-notice-page.png`) | Short SHA `0123456` in mono with full SHA in `title`, "find them in Stashes", Dismiss focused (activeElement = `dismiss-stash-notice`). Info-tint band, copy reads at 12.4:1 / 12.9:1. Picker stays open on the notice as designed. No visible focus ring on Dismiss after a mouse-initiated flow (see Moderate 1). |
| Create-branch error | before-*-picker-create-error.png | after-*-picker-create-error.png | New copy "Could not create branch X: <reason>" replaces generic text; shows git's reason. Layout fine, text contrast fails (Serious 1). |

Focus (activeElement, measured): blocked -> Stash & switch; confirm -> Discard changes; refusal -> Stash & switch; notice -> Dismiss. All correct.

### Contrast measurements (picker, AFTER)

| Element | Dark | Light |
| --- | --- | --- |
| Warning copy (`text-warning` on `bg-warning/10`, 12px) | 5.38 pass | **2.02 FAIL** |
| Conflicting paths (10px mono, opacity-80) | 8.26 pass | 7.64 pass |
| Stash & switch (btn-primary text on fill, 11px) | 4.82 pass | 5.20 pass |
| Discard & switch... (ghost, `text-error`) | **3.12 FAIL** | 13.07 (rendered dark, NOT red; see Serious 2) |
| Confirm copy (`text-error` on warning tint, 12px) | **3.12 FAIL** | **2.93 FAIL** |
| Discard changes (btn-error text on fill, 11px) | **3.87 FAIL** | **4.12 FAIL** |
| Discard-refusal copy (`text-error` on warning tint) | **3.12 FAIL** | **2.93 FAIL** |
| Stash notice copy / SHA / Dismiss (on `bg-info/10`) | 12.35 pass | 12.87 pass |
| Create-error copy (`text-error` on `bg-base-200`) | **3.59 FAIL** | **3.19 FAIL** |
| Branch row ghost text | 13.89 pass | 14.21 pass |
| Current branch (disabled) | 1.76 (disabled, exempt) | 9.72 |

Context: the warning-tint copy and the "text-error on base" failures already existed before P2 (BEFORE panel used `text-warning` on the same tint, orange "Discard changes and checkout" button, and `text-error` create error). P2 adds new error-coloured copy on the tint (confirm, refusal) and keeps the failing pattern. The source-control row error in this same task already switched to `text-base-content` on the error tint because "text-error on base fails AA in both themes" (`source-control-file.component.ts:189-191` comment), so the fix is known and local.

## Surface 2: source-control status badges

Rows captured: M, A, D, R, ?, conflicted U, T, ignored. Files: before-light-badges.png, after-{dark,light}-badges.png (before-dark image lost, see disclosure).

| Status | Letter before | Letter after | Aria label / title before | Aria label / title after |
| --- | --- | --- | --- | --- |
| M / A / D / R | M / A / D / R | same | Modified / Added / Deleted / Renamed | same |
| `??` | U | U | Untracked | Untracked |
| Conflicted (`U`) | U (collides with untracked) | `!` | `U` (no label) | Conflicted |
| Type changed (`T`) | T | T | `T` (no label) | Type changed |
| Ignored (`!`) | `!` | `I` | `!` (no label) | Ignored |

Semantics improvement is confirmed: conflicted no longer collides with untracked, and every badge now carries a full-word accessible name and tooltip. Icons also distinguish T (warning colour, FileType) and U (error colour, FileWarning) from the grey generic icon used by ignored/renamed.

Contrast (badge letter, all statuses identical because the badge ignores status colour and uses `opacity-40`, 10px mono, 6x16 px):

| Theme | Effective fg | bg | Ratio | AA 4.5 |
| --- | --- | --- | --- | --- |
| anubis | rgb(104,103,104) | rgb(19,19,23) | **3.31** | FAIL |
| anubis-light | rgb(166,156,168) | rgb(250,247,245) | **2.48** | FAIL |

BEFORE measured 3.31 in dark as well, so the failure is inherited (class `opacity-40` unchanged at `source-control-file.component.ts:162-ish`, now `:174-178`), but this phase's goal is that the badge names the status "in text, never colour alone" (component doc comment), which makes the text the carrier. Legibility: at 10 px with 40% opacity the letters are visibly faint in the light screenshot, I (ignored) and ! (conflicted) are barely distinguishable from `T`/`R` without the icon. Target size 6x16 is non-interactive (no target-size criterion).

## Findings

### Serious

1. **Error-coloured copy fails AA in both themes (new states).** `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:98-100` (discard refusal, `text-error` on `bg-warning/10`: 3.12 dark / 2.93 light), `:121-123` (confirm copy, same pair), `:189` (create error `text-error` on base-200: 3.59 / 3.19), `:127-135` (btn-error "Discard changes" label: 3.87 / 4.12). Screenshots: `after-*-picker-discard-refusal.png`, `after-*-picker-discard-confirm.png`, `after-*-picker-create-error.png`. Impact: the very messages that explain why a destructive action was refused or failed are the hardest to read; light theme is worst. Fix: use `text-base-content` with an error-tinted band/leading icon or border (as the row error already does), and a btn-error variant with enough label contrast, or an outline error button.
2. **"Discard & switch..." loses its destructive cue in the light theme and is low-contrast in dark.** `branch-picker-dropdown.component.ts:171-178` (`btn btn-ghost btn-xs text-error`). In `anubis-light` the label renders in the default dark ink (13.07:1, not red; `after-light-picker-blocked.png`), so the secondary destructive action looks identical to Cancel; in dark it is red at 3.12:1 (`after-dark-picker-blocked.png`). Impact: inconsistent affordance for the one irreversible path, and fails AA in dark. Fix: style via a token that wins over `btn-ghost` in both themes (e.g. `btn-outline btn-error` or an explicit error text utility with `!`), and verify 4.5:1 in both themes.
3. **Status badge letters fail AA and are faint in both themes.** `libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts` badge span (`opacity-40`, 10px; the span following the comment "Keep the status badge as the final child"): 3.31 dark / 2.48 light (measurements above; `after-light-badges.png`). Inherited from base but now the sole textual carrier of the status. Fix: drop `opacity-40` for a solid text colour with at least 4.5:1 (for example `text-base-content/70` verified, or the status colour classes already computed by `statusColor`), keep 10px or move to 11px.

### Moderate

1. No visible focus ring on the programmatically focused primary actions (Stash & switch, Discard changes, Dismiss) in the screenshots (`after-dark-picker-blocked-focus-page.png`, `after-dark-picker-stash-notice-page.png`): focus is placed correctly (verified via `document.activeElement`) but `btn-ghost` Dismiss shows no ring after mouse-initiated flows. Browsers suppress `:focus-visible` for script focus after pointer input; consider an explicit focus style. `branch-picker-dropdown.component.ts:152-159`.
2. Warning copy at the top of the blocked panel (`text-warning` on `bg-warning/10`) is 2.02:1 in light (`:77-80`). Inherited from the old panel but it is the lead sentence of the flow.

### Minor

1. Stash notice keeps "Recent" and "Local" lists below it with the current branch re-listed; the notice is easy to miss if the user glances at the list. No change required.

## Prototype fidelity

Approved prototype: `.ptah/specs/TASK_2026_576_e16a/prototype/` exists for the task; this review did not diff the branch picker against it because the P2 brief scoped the comparison to before/after. Before/after comparison: dark and light pairs listed above for list, blocked, create-error, badges (before-dark badge image lost, measurement retained). No unapproved component substitution observed: single primary action (Stash & switch), destructive action secondary behind confirmation, discard hidden when refused.

## Verdict

- Recommendation: APPROVE WITH FIXES (merge after Serious 1-3 are addressed or explicitly deferred as a token-level follow-up, since 3 of the 4 measured failures pre-date P2 in pattern).
- Confidence: HIGH on measurements (computed, both themes), MEDIUM on completeness (single 1200x800 viewport, mocked RPC, BEFORE-dark badge image lost).
- Key concern: error and destructive copy in the new blocked-switch flow does not reach 4.5:1 in either theme, and the destructive secondary action loses its red cue in the light theme.

## Revise round 1

Verdict: **APPROVED** (score 8/10). Visual breaking 0, Serious 0, Moderate 0 open, Minor 2 (both non-text cues, deferred to P3 Batch 24).

### Environment

- AFTER only, HEAD `3c2d3c51e`. Rebuilt with `npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron` (succeeded, 4m52s, 0/2 cache hit, so the bundle is fresh).
- Throwaway spec `_p2-visual-capture.spec.ts` recreated (UiDriver, mocked `git:info` / `git:branches` / `git:checkout`), run directly via `npx playwright test` in `apps/ptah-electron-e2e`, then deleted. `git status` shows only the new `screenshots/p2/round1/` folder. The user's Ptah desktop app was not touched.
- anubis (dark) and anubis-light, 1200x800, same states as round 0. All pickers were opened and driven with real mouse clicks, then the pointer parked at (5,5) with a 600 ms settle before measuring, so the focus state is the mouse-triggered one and no hover transition skews the numbers. (My first pass measured Stash & switch mid-hover-transition at 4.19 in light; the settled re-run gives 5.20, matching round 0.)
- Method as round 0: computed colour composited through ancestor backgrounds and cumulative opacity, canvas-converted to sRGB, WCAG 2.x ratio. Criteria: 4.5:1 text, 3:1 non-text UI.
- Raw data: `screenshots/p2/round1/r1-measurements.json`. Screenshots: `screenshots/p2/round1/r1-{dark,light}-{picker-list,picker-blocked,picker-discard-confirm,picker-discard-refusal,picker-create-error,picker-stash-notice,badges}.png` plus `-page.png` full-window variants.

### Per-finding results

| Round-0 finding | Result | Measurements (dark / light) |
| --- | --- | --- |
| Serious 1: error-coloured copy fails AA (refusal, confirm, create-error, Discard changes label) | **RESOLVED** | Refusal copy 3.12 / 2.93 -> **11.24 / 11.41**. Confirm copy 3.12 / 2.93 -> **11.24 / 11.41**. Create-error copy 3.59 / 3.19 -> **13.00 / 12.32**. Discard changes label (outline, error border) 3.87 / 4.12 -> **11.24 / 11.41**. |
| Serious 2: "Discard & switch..." loses red cue in light, 3.12 in dark | **RESOLVED** | Label 12.10 / 13.07 (text-base-content). Error border now renders in both themes (dark `rgb(220,38,38)`, light `rgb(254,28,85)`, 1px / 2px solid), so the destructive cue is back in light (`r1-light-picker-blocked.png`: red-outlined pill, visually secondary to the filled Stash & switch). Absent when discard is refused (count 0). |
| Serious 3: badge letters faint, 3.31 / 2.48 | **RESOLVED** | M/A/D/R letters at 10px: **14.86 / 15.92**, opacity 1. All badges share one class string with no status-conditional opacity (source `source-control-file.component.ts` badge span), so U / ! / T / I inherit the same value; the 8-row screenshot (`r1-light-badges-page.png`) shows M A D R U ! T I legible. Aria labels unchanged: Modified, Added, Deleted, Renamed, Untracked, Conflicted, Type changed, Ignored. Limitation: my per-badge measurement loop indexed change-count spans too, so only M/A/D/R were numerically sampled. |
| Moderate 1: no visible focus ring after mouse-triggered flow | **RESOLVED** | activeElement correct in every state (stash-switch / confirm-discard / stash-switch on refusal / dismiss-stash-notice). Computed outline on each: `solid 2px`, offset 2px, dark `oklch(0.77 0.14 91)` amber, light `oklch(0.58 0.13 75)` dark amber. Visible in `r1-light-picker-blocked.png`, `r1-light-picker-discard-confirm.png`, `r1-dark-picker-stash-notice.png`, and the -page variants. |
| Moderate 2: lead sentence 2.02 in light | **RESOLVED** | Lead sentence 12.10 / 13.07, with the warning icon carrying the hue (icon 5.38 dark, 2.02 light, non-text). |
| Other rows unchanged | Pass | Stash & switch label 4.82 / 5.20; conflicting paths 8.26 / 7.64; stash notice copy 12.35 / 12.87; Dismiss 12.35 / 12.87. |

### New findings

None at Moderate or above. Two Minor notes, same bucket as the accepted deferral (P3 Batch 24, styles.css tokens):

1. Focus ring against the adjacent panel in anubis-light is about 2.9 to 3.3:1 (2.94 Stash & switch, 2.95 Discard changes, 3.33 Dismiss) versus the 3:1 non-text criterion, so two of three are marginally short. Dark ring is well above 3:1 against the panel (the 2.46 / 2.90 figures in the JSON are measured against the button fill, not the surface the offset ring sits on). The ring is clearly visible in every screenshot.
2. Error cues (known/accepted): error icon 2.90 dark / 2.56 light, error border on the outline buttons 2.90 dark / 2.93 and 2.56 light, all non-text and redundant with the base-content copy and the label text.

### Prototype fidelity and before/after

Unchanged from round 0: single filled primary (Stash & switch), secondary actions outlined / ghost, destructive path behind confirmation and hidden when refused, no component substitutions. Before/after pairs are the round-0 `before-*` / `after-*` images plus the round-1 `r1-*` set.

### Final verdict

APPROVED. All three round-0 Serious findings and both Moderate findings are resolved with measurements; nothing unresolved apart from the two accepted non-text Minor items deferred to P3 Batch 24. Confidence HIGH on measurements, MEDIUM on completeness (single 1200x800 viewport, mocked RPC, numeric badge sampling limited to M/A/D/R with the rest confirmed by shared class and screenshot).

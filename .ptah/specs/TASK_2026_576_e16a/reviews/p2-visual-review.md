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

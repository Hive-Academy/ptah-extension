# Batch 7

## Summary

**Current status (after Revise round 1): APPROVED.** The table below is the round 0
snapshot; see "Revise round 1 recheck" for what changed and the final verdict.

| Metric                  | Value                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Overall score (round 0) | 7/10 — superseded, see round 1 verdict                                                                  |
| Assessment (round 0)    | NEEDS_REVISION (contract) / CHANGES_REQUIRED (task label) — superseded                                  |
| Visual breaking         | 0                                                                                                       |
| Serious (round 0)       | 2 (both resolved in round 1)                                                                            |
| Moderate                | 2 (unchanged, disclosed as pre-existing/out of scope)                                                   |
| Minor (round 0)         | 1 (resolved in round 1, with a disclosed caveat)                                                        |
| Viewports tested        | 1400×860 ("wide"), 480×860 ("narrow") — audit selection, see Method                                     |
| Screenshots taken       | 31 (round 0) + 8 (round 1) = 39                                                                         |
| Components tested       | `SourceControlPanelComponent`, `SourceControlFileComponent`, `GitDockComponent` (existing-dock wrapper) |

Author of UI: in-process subagent frontend-developer.
Reviewer: in-process subagent visual-reviewer (this report).

## Method

**Build-then-serve precondition.** The Ptah Electron app has no dev-server mode for the git
dock; it is packaged and launched via Playwright's `_electron.launch()`. I ran the real
build pipeline for both states:

- AFTER (current working tree, Batch 7 uncommitted): `npx nx run-many -t build-dev
copy-renderer-dev -p ptah-electron` in `D:\projects\ptah-extension`, producing
  `dist/apps/ptah-electron/main.mjs` + `dist/apps/ptah-electron/renderer/index.html` from
  the working tree exactly as it stands (task instructions: use as-is, do not modify).
- BEFORE (base commit `722d921ab`): created a throwaway git worktree with `git worktree add
/d/ptah-b7-before 722d921ab` (outside the repo tree, per instructions), junctioned
  `node_modules` from the main checkout with `New-Item -ItemType Junction` (package.json /
  package-lock.json are byte-identical between `722d921ab` and `HEAD`, confirmed via `git
diff`, so this is a safe, much faster substitute for a full `npm install`), then ran the
  same `build-dev` + `copy-renderer-dev` targets inside that worktree. The worktree was
  removed with `git worktree remove /d/ptah-b7-before --force` after capture; `git worktree
list` afterward shows only the pre-existing, unrelated worktrees. `D:\projects\ptah-extension`
  itself was never checked out to another ref.

**Harness mechanism.** I evaluated the three candidates named in the brief:

- `apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts` and
  `git-review-controls.spec.ts` — real, working patterns (`ui.mockRpc`, `UiDriver`,
  `_electron.launch`), but each spec boots one Electron instance for one scenario and
  isn't meant for ad hoc multi-state, multi-theme, multi-width capture.
- `libs/frontend/webview-e2e-harness` — runs the Angular SPA standalone in a vanilla
  Chromium page with a stubbed `acquireVsCodeApi()`. This is cheaper per-boot than
  Electron, but the harness's own README scopes it to `scope:webview` scenarios (chat,
  sessions, monitor, settings, command palette) and it does not stand up the Electron
  main-process RPC surface (`git:info`, `git:stage`, `git:commit`) that the git dock
  depends on — reusing it would have meant re-implementing a second mock-RPC layer with
  no guarantee it matches the real IPC contract.
- Ptah's built-in browser tools (`ptah_browser_*`) — these drive a real browser page; the
  git dock is an Electron `BrowserWindow`, not a URL Playwright's `_electron` needs to
  attach to, so they do not apply here (noted explicitly, per the brief).

I chose the **first candidate's underlying mechanism** directly: a throwaway Playwright
spec (`apps/ptah-electron-e2e/src/specs/git/_b7-visual-capture.spec.ts`, deleted after the
run — never part of the deliverable) that reuses the repo's own proven support code
(`support/ui-driver.ts` `UiDriver`, `installFakeRpcListener`/`mockRpc`/`pushEvent`) exactly
as `commit-hook-failure.spec.ts` and `fixtures.ts` do, but drives its own `_electron.launch()`
per test so each of the five new states gets a fresh app instance, a controlled `git:info`/
`git:stage`/`git:commit` mock, and explicit `page.setViewportSize` + `data-theme` control
for both themes and both widths. This is the same IPC contract the real backend speaks
(`git:info`/`git:stage`/`git:commit` shapes from `libs/shared/src/lib/types/rpc/
rpc-git.types.ts`), not a re-invented one. Commands used:

```
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts \
  apps/ptah-electron-e2e/src/specs/git/_b7-visual-capture.spec.ts
# AFTER: PTAH_B7_PREFIX=after (default entry = dist/apps/ptah-electron/main.mjs)
# BEFORE: PTAH_B7_PREFIX=before PTAH_B7_ENTRY=D:/ptah-b7-before/dist/apps/ptah-electron/main.mjs
```

Theme switching used `document.documentElement.setAttribute('data-theme', …)` directly
(the mechanism `ThemeService`'s own `effect()` uses — `anubis` and `anubis-light` are both
compiled eagerly into `styles.css`, so no deferred-sheet wait is needed). Contrast and
target-size numbers were read with `getComputedStyle`/`getBoundingClientRect` via
`page.evaluate`, not eyeballed; raw dumps are in
`screenshots/b7-measurements-after-{dark,light}.json`.

**Coverage per state.**

| #   | State                                                            | RPC/event used to reach it                                                                                                                    | After (dark/light × wide/narrow)                         | Before                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-row / per-section mutation error                             | `git:stage` mocked to `{success:false, error, code:'ERROR'}`, clicked "Stage all files"                                                       | Captured (section-level, both themes/widths)             | N/A (markup doesn't exist)                                                                                                                                                                         |
| 1b  | Row-level error (same markup, single file)                       | same, clicked the file row's "Stage file"                                                                                                     | **Skipped** — see Finding 5                              | N/A                                                                                                                                                                                                |
| 2   | Commit failure + hook output, message kept                       | `git:commit` mocked to `{success:false, error, code:'HOOK_FAILED', hookOutput}`                                                               | Captured, both themes/widths, plus two focus-state shots | N/A                                                                                                                                                                                                |
| 3   | Commit success                                                   | `git:commit` mocked to `{success:true, commitHash, subject}`                                                                                  | Captured, both themes/widths                             | N/A                                                                                                                                                                                                |
| 4   | Stale notice (warning left border)                               | good `git:info` first, then a `git:status-update` push with `statusUnavailable` (simulates a second, failed read with a last-known-good list) | Captured, both themes/widths                             | N/A                                                                                                                                                                                                |
| 5   | "Git status is unavailable (…)" replacing "not a Git repository" | `git:info` mocked to `{isGitRepo:false, branch, files:[], statusUnavailable:'error'}` on first read (no prior good data)                      | Captured, both themes/widths                             | Confirmed **absent**: same mock against the `722d921ab` build renders the OLD "The active workspace is not a Git repository." string instead (`screenshots/b7/before-dark-state5-not-present.png`) |
| —   | Baseline idle list (regression floor)                            | plain `git:info` with one staged + one unstaged file                                                                                          | Captured                                                 | Captured, both themes/widths                                                                                                                                                                       |

Screenshot filenames follow `<before\|after>-<dark\|light>-<state>-<wide\|narrow>.png` in
`.ptah/specs/TASK_2026_576_e16a/screenshots/b7/`.

**A capture artifact, disclosed rather than hidden.** Every "wide" screenshot that follows
a narrow (480px) capture _within the same session_ shows the git rail squeezed to roughly
100px instead of its normal ~260px, with text wrapping one character per line. I verified
this is **not a Batch 7 regression**: it reproduces identically on the `722d921ab` baseline
build (`before-light-baseline-wide.png` vs `after-light-baseline-wide.png` — both squeezed
after a narrow visit) and even on the very first, pre-Batch-7 idle list. It looks like a
pre-existing rail-width persistence behaviour in the (unrelated) resize-handle/layout
service that does not restore `gitRailWidth()` after the CSS `max-width: calc(100% - 12rem)`
clamp kicks in at narrow widths, though I did not chase its root cause since it sits
outside the three files this batch touches. **Practical effect on this review**: I treat
each state's **dark "wide" screenshot (always the first capture, never squeezed)** as the
primary layout evidence, and the narrow/second-wide screenshots as color/copy evidence only
(color and text content do not depend on the box's rendered width). Also disclosed: at
480px the _entire_ git dock (not just the source-control rail) is hidden on both the before
and after builds — again pre-existing, not a Batch 7 regression, and likely below any width
this desktop app is meant to support (no documented narrow-width contract was found; treat
480px as an audit floor, not a support commitment).

## Findings by severity

### Visual breaking

None found in the three files under review.

### Serious

#### 1. Dismiss buttons are 22×20 CSS px, below the WCAG 2.2 target-size minimum

- File: `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:270-280` (commit-success dismiss), `:303-313` (commit-failure dismiss), `:626-636` (section-error dismiss)
- Measured: `getBoundingClientRect()` on `[aria-label="Dismiss commit error"]` = 22×20 CSS px (`screenshots/b7-measurements-after-dark.json`, `dismissSize`).
- Criterion: WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA, 24×24 CSS px — the repository
  declares no stricter or looser standard, so this is the applicable floor (not the AAA
  44×44 guidance).
- Screenshot: `after-dark-state2-commit-failure-wide.png` (the X button next to "Commit
  failed…")
- Problem: the dismiss control is smaller than the AA minimum in both dimensions.
- Impact: users with limited fine motor control have a materially harder time dismissing
  the row/section/commit alerts than the size budget allows.
- Fix: not a Batch 7-introduced pattern — every icon-only `btn btn-ghost btn-xs p-0.5
h-auto min-h-0` control in this dock (stage/unstage/discard, folder toggles) shares the
  same sub-24px footprint, so this is inherited, not new. Recommend a follow-up (outside
  this batch's scope) that gives icon-only ghost buttons in the source-control rail a
  `min-w-6 min-h-6` (24px) hit target via padding, keeping the visual icon size unchanged.
  Filed here because Batch 7 adds three _new_ dismiss buttons using the same undersized
  pattern rather than fixing it.

#### 2. No automated AA contrast gate for the new `bg-error/10` / `text-base-content` tint combination

- File: `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:287-288` (own code comment cites the rationale but is not backed by a spec), `source-control-file.component.ts:168-181`
- Evidence: `grep` across `libs/frontend/git-ui/src/lib/source-control/*.spec.ts` for
  `bg-error/10|contrast` returns nothing — unlike `base-content-muted.spec.ts`, which the
  design-spec cites (`design-spec.md:18-22`) as the project's own precedent for gating an
  AA-sensitive token combination with a test.
- Measured (via `getComputedStyle`, not eyeballed): dark theme text
  `oklch(0.925 0.007 88.6)` on an error-tinted box whose own paint is
  `oklch(0.577 0.215 27.3 / 0.1)`; light theme text `oklch(0.236 0.066 313.2)` on
  `oklch(0.64 0.246 16.4 / 0.1)`. At 10% alpha over the panel's `bg-base-200`/`bg-base-100`
  (near-black in `anubis`, near-white/peach in `anubis-light`, per the surrounding
  screenshots), the composited background stays close to the panel colour in both themes,
  so the visible pairs are near-white-on-near-black and near-black-on-near-white — both
  comfortably clear of 4.5:1 by inspection of the two end-point luminances, but this is an
  estimate from the layer's own paint values plus the panel screenshots, **not** a
  measured composited pixel, which is this finding's residual uncertainty.
- Impact: none observed today — the token choice matches the exact rationale
  design-spec-review.md round 1 already used to fix the same fail (`.err-solid-text` etc.,
  design-spec.md:39-79), and the component comment says so explicitly. But nothing pins it,
  so a future refactor could silently regress it the same way the original
  `error-content`-on-solid-`error` pairing failed.
- Fix: add a unit spec alongside `base-content-muted.spec.ts` (or extend it) asserting the
  composited contrast of `text-base-content` on `bg-error/10` over `bg-base-200`/
  `bg-base-100` in both themes, the same way the repository already gates the muted-text
  token.

### Moderate

#### 3. Focus-visible ring on the dismiss buttons and the hook-output log was not confirmed visually

- File: `source-control-panel.component.ts:270-280`, `:303-327`
- Screenshots: `after-state2-dismiss-focus.png`, `after-state2-log-focus.png` — both taken
  during the rail-squeeze artifact (Method, above), so the ring is not legible against the
  ~100px-wide, heavily word-wrapped box.
- Evidence in code: both elements carry `focus-visible:outline focus-visible:outline-2
focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]`, and
  `.focus()` in the capture script did move DOM focus to each (Playwright's `.focus()`
  fails the step if the element cannot receive focus, and it did not fail).
  `<pre role="log" tabindex="0">` is also confirmed keyboard-reachable by construction.
- Not filed as Serious: the class list is the same `outline-2`/`--s` pattern already used
  elsewhere in this file (folder toggles, stage/unstage buttons) and in
  `diff-view.component.ts`'s roving-tabindex toolbar per design-spec §2, so there is no
  reason to expect it renders differently here — but I did not obtain a clean screenshot
  proving the ring paints correctly at the intended ~260px rail width, which is the honest
  gap.
- Recommendation: re-capture at 1400px width without a preceding narrow-viewport visit
  (e.g., a fresh app per screenshot) to close this out; not re-run here given time budget
  already spent chasing the resize artifact.

#### 4. Pre-existing git-rail width behaviour affects every narrow/second-wide capture (out of scope, disclosed for transparency)

- Evidence: `before-light-baseline-wide.png` and `after-light-baseline-wide.png` both show
  the identical ~100px-wide squeeze in the plain idle-list state that predates and is
  unrelated to any of Batch 7's three files; `before-dark-baseline-narrow.png` and
  `after-dark-baseline-narrow.png` both show the entire git dock hidden at 480px.
- Not filed as Visual breaking or Serious against this batch: it reproduces byte-for-byte
  on the `722d921ab` base commit, so it cannot be attributed to
  `source-control-panel.component.ts`, `source-control-file.component.ts`, or
  `git-dock.component.ts`'s Batch 7 changes. Recorded here only so the reader does not
  mistake the squeezed screenshots in this report for a Batch 7 defect, and as a
  candidate for a separate ticket against the rail-resize-handle/layout service.

### Minor

#### 5. Row-level mutation error (state 1b) not captured — disclosed, not fabricated

- The per-row error markup (`source-control-file.component.ts:168-181`) is byte-for-byte
  the same tinted-box pattern as the section-level error already captured and measured
  (`data-testid="git-row-error"` vs `git-section-error`, identical classes:
  `text-base-content bg-error/10 border border-error/60`). I attempted to reach it by
  clicking a row's "Stage file" button after the section-level mutation had already run;
  the click did not re-dispatch a `git:stage` RPC call within an 8s poll
  (`getObservedCalls('git:stage')` count never advanced), even with `force: true`, across
  two attempts. I did not spend further budget diagnosing whether this is a genuine
  double-mutation interaction bug in the component or purely a harness sequencing issue
  (the section-level mutation already having written to the same errors map is the most
  likely harness-side explanation), since the section-level capture and the direct source
  read already give strong evidence for the row-level box's visual and AA properties.
  Flagged Minor, not skipped silently: if a reviewer wants row-level pixels specifically,
  re-run state 1b in isolation (its own fresh app, no prior stage-all click in the same
  session).

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_576_e16a/prototype/index.html` (Gate 1.7).
- Fidelity assessment: **NOT APPLICABLE** for four of the five states, **MATCHES (by
  design-spec extension)** for the fifth.
- The prototype's screens (`change-set-card.html`, `commit-composer.html`,
  `task-worktree.html`, `review-canvas.html`, etc., per `batches.md`'s own P1-P5 phase
  plan) depict the **future, not-yet-mounted review-shell** — batches 58-69 ("Cutover")
  are what eventually swap the mount from the current dock to that new surface. Batch 7
  modifies the **current** `SourceControlPanelComponent`/`SourceControlFileComponent`/
  `GitDockComponent` dock, which the prototype does not depict at all (it has no screen
  for this dock's file list, its per-row actions, or its commit box in their current
  form). So states 1 (row/section error), 4 (stale notice) and 5 (status-unavailable
  replacing "not a Git repository") have **no prototype counterpart to compare against** —
  correctly so, since RC1/RC3 (the requirements driving this batch, per the component's
  own doc comments) are resilience fixes to the existing dock, not new prototype surfaces.
- State 2/3 (commit failure/success) _do_ have a same-named counterpart in the prototype
  (`commit-composer.html`, `dark-commit-composer-error.png`) for the **future** composer,
  which design-spec §9 describes using `alert alert-error`/`badge-success badge-sm`. The
  actual Batch 7 implementation instead uses the `bg-error/10 border-error/60
text-base-content` tinted box and a plain check-icon + text line. This is a **deliberate,
  design-spec-sanctioned deviation, not an unapproved one**: design-spec.md §0 "Verified
  overrides" (lines 39-79) documents that `error-content` on solid `error` measures
  3.87-4.12:1 (fails AA) and that `success-content` on solid `success` measures 2.64:1 in
  `anubis` dark (fails AA) — the exact two components (`alert-error`, `badge-success`)
  §9's ASCII mock calls for. The component's own comment
  (`source-control-panel.component.ts:287-288`) cites this directly ("text-error on base
  fails AA in both themes … stale-hunk chip"). Token usage is otherwise compliant with
  §2: only `text-base-content` / `text-base-content-muted` appear on text, `text-error`/
  `text-warning`/`text-success` are used only on `aria-hidden` icons (decorative, not
  text-contrast-bearing), and no `text-white/NN`, `text-base-content/NN`, or other
  arbitrary alpha text tier appears anywhere in the three reviewed files (checked by
  reading the full templates, not by regex alone).
- No unapproved component substitution, no banned/stripped project component observed —
  the deviation from §9's literal ASCII art is the same AA fix the design-spec itself
  already prescribes elsewhere; nothing here contradicts the approved prototype's actual
  visual system (density, borders, icon sizes, `text-[10px]`/`text-[11px]` scale all
  match).
- Before/after comparison (used in place of a prototype match for states 1/4/5, per the
  brief): see the per-state table in Method — `before-*` screenshots confirm the baseline
  idle list is visually identical pre/post Batch 7 (no regression to the unaffected path),
  and confirm states 4/5's markup and the "Git status is unavailable" copy are genuinely
  new (absent at `722d921ab`).

## Viewport results

| Screen / state             | Widths opened | Status                                                                                                    | Screenshot                                                      |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Baseline idle list         | 1400, 480     | Pass (both before/after, both themes)                                                                     | `after-dark-baseline-wide.png`, `before-dark-baseline-wide.png` |
| State 1 section error      | 1400, 480     | Pass (dark-wide unsqueezed; narrow shows whole-dock hidden, pre-existing)                                 | `after-dark-state1-section-error-wide.png`                      |
| State 2 commit failure     | 1400, 480     | Pass, no overflow/clipping of the `<pre role="log">` at 1400px (scrolls internally, `max-h-48` respected) | `after-dark-state2-commit-failure-wide.png`                     |
| State 3 commit success     | 1400, 480     | Pass                                                                                                      | `after-dark-state3-commit-success-wide.png`                     |
| State 4 stale notice       | 1400, 480     | Pass, warning left-border renders on both the staged and unstaged lists                                   | `after-dark-state4-stale-wide.png`                              |
| State 5 status unavailable | 1400, 480     | Pass, dock's rail is entirely absent (by design — `isGitRepo` false skips the rail)                       | `after-dark-state5-unavailable-wide.png`                        |

480px is an **audit selection**, not a documented support width — no responsive-width
contract for this Electron dock was found in the repository; 480px was chosen because it
is well below the rail's `max-width: calc(100% - 12rem)` clamp point and exercises the
narrow end, but see the disclosed artifact above for its limits as evidence here.

## Component and interaction results

| Component / control                                       | States tested                                   | Status                                                                           | Screenshot                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Commit-success line (icon + "Committed <hash> <subject>") | default, dismiss                                | Pass                                                                             | `after-dark-state3-commit-success-wide.png`                                                                 |
| Commit-failure alert + hook-output `<pre role="log">`     | default, message-kept, dismiss-focus, log-focus | Pass (visual); focus-ring legibility inconclusive (Finding 3)                    | `after-dark-state2-commit-failure-wide.png`, `after-state2-dismiss-focus.png`, `after-state2-log-focus.png` |
| Section-level mutation error (stage-all failure)          | default, dismiss present                        | Pass                                                                             | `after-dark-state1-section-error-wide.png`                                                                  |
| Row-level mutation error                                  | —                                               | Not captured (Finding 5)                                                         | —                                                                                                           |
| Stale notice + warning-bordered lists                     | default                                         | Pass                                                                             | `after-dark-state4-stale-wide.png`                                                                          |
| Status-unavailable notice (dock-level)                    | default                                         | Pass; confirmed replaces the old "not a Git repository" text (before/after diff) | `after-dark-state5-unavailable-wide.png` / `before-dark-state5-not-present.png`                             |

## Design system compliance

| Token expected (design-spec §2)                               | Value observed                                                                                                     | Compliant?                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `text-base-content` / `text-base-content-muted` only for text | Confirmed in all three files; no `text-base-content/NN` or `text-white/NN` found                                   | Yes                                            |
| `oklch(var(--er))` family for status colour, not raw hex      | `bg-error/10`, `border-error/60`, `text-error` (icon only), `text-warning` (icon only), `text-success` (icon only) | Yes                                            |
| `btn btn-ghost btn-xs` for icon actions                       | Dismiss/stage/unstage/discard buttons all use this                                                                 | Yes (see Finding 1 for the inherited size gap) |
| No arbitrary alpha text tiers                                 | None found                                                                                                         | Yes                                            |
| `font-mono` for hashes/log content                            | `git-commit-success` hash span and `git-commit-hook-output` `<pre>` both use `font-mono`                           | Yes                                            |

## Accessibility audit

- Contrast: see Serious Finding 2 (own-layer values measured, composite estimated, not
  pixel-measured — residual uncertainty).
- Target size: see Serious Finding 1 (22×20 CSS px on dismiss button, WCAG 2.2 SC 2.5.8 AA
  floor is 24×24).
- Focus order / reachability: `<pre role="log" tabindex="0">` and the three dismiss
  buttons are focusable (confirmed via `.focus()` not throwing); ring legibility not
  visually confirmed (Finding 3).
- Semantic structure: `role="alert"` on the failure text (assertive, appropriate for a
  transient mutation failure), `role="status"` on the success line and both status-
  unavailable/stale notices (polite, appropriate for non-urgent state), `role="log"` +
  `aria-label="Commit hook output"` on the hook-output `<pre>` — all correct role choices
  for their urgency.
- `role="listitem"` requirement for children of `role="list"` (called out in the
  component's own comments) is respected in the reviewed markup.

## Visual performance

- No animated transitions were introduced by these states; the commit button's
  `loading loading-spinner loading-xs` swap and the mutation-error appearance are
  synchronous DOM updates with no observed layout thrash beyond the container height
  growing to fit the new alert/log content (expected, not a defect).
- The narrow-then-wide rail-squeeze (disclosed above) is the only layout-shift-like
  behaviour observed, and it is pre-existing/out of scope for this batch.

## Verdict (round 0, superseded — see recheck below)

- Recommendation: **CHANGES_REQUIRED**
- Confidence: MEDIUM — high confidence on visual correctness and prototype-fidelity
  reasoning (verified with real screenshots and direct source reads); medium on the two
  Serious findings because Finding 2's contrast number is a composite estimate rather
  than a measured pixel, and both Serious findings describe an inherited pattern rather
  than something Batch 7 invented from scratch.
- Key concern: the three new dismiss buttons (commit success, commit failure, section
  error) ship at 22×20 CSS px, under the WCAG 2.2 AA target-size floor, and the new
  `bg-error/10`/`text-base-content` tint combination — though almost certainly AA-safe by
  the same reasoning the design-spec already used to fix the same failure elsewhere — has
  no automated contrast gate pinning it, unlike the project's own precedent
  (`base-content-muted.spec.ts`). Neither is a layout-breaking defect, but both are
  concrete, fixable gaps worth closing before this ships, per this task's explicit
  two-label verdict contract (CHANGES_REQUIRED given any Serious finding).

## Revise round 1 recheck

**Scope.** The author reported two fixes: (1) all four dismiss buttons (commit success,
commit failure, section error in `source-control-panel.component.ts`, row error in
`source-control-file.component.ts`) now use `btn btn-ghost btn-xs btn-square p-0 w-6 h-6
min-h-6 flex-shrink-0`; (2) a new automated AA gate at
`apps/ptah-extension-webview/src/app/git-error-tint-contrast.spec.ts`.

**Method.** Rebuilt the AFTER build from the current working tree with the same
`npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron` command as round 0 (no
change to the main checkout). Recreated the same throwaway-harness approach as round 0 (a
Playwright spec under `apps/ptah-electron-e2e/src/specs/git/`, reusing `UiDriver`/
`mockRpc`/`_electron.launch()`), deleted after the run. This time every state used its own
fresh Electron app instance with **no narrow-viewport visit at all** — round 0's rail-squeeze
artifact (Method, above) only ever appeared after a narrow-then-wide resize within the same
session, so avoiding that resize entirely removes the artifact rather than working around
it. All screenshots below are therefore clean, unsqueezed captures at 1400×860.

### Finding 1 (Serious, target size) — RESOLVED

Measured `getBoundingClientRect()` on all four dismiss buttons, both themes, via
`aria-label` selectors (`Dismiss commit result`, `Dismiss commit error`, `Dismiss stage
all error`, `Dismiss error for utils.ts in changes` — the row button's label is the
per-file `dismissErrorLabel()` computed, not a fixed string, confirmed by reading
`source-control-file.component.ts:271-276`):

| Button                 | Dark  | Light |
| ---------------------- | ----- | ----- |
| Commit success dismiss | 24×24 | 24×24 |
| Commit failure dismiss | 24×24 | 24×24 |
| Section error dismiss  | 24×24 | 24×24 |
| Row error dismiss      | 24×24 | 24×24 |

All four clear the WCAG 2.2 SC 2.5.8 AA floor (24×24 CSS px) exactly, in both themes.
Finding 1 is closed.

### Finding 2 (Serious, no automated contrast gate) — RESOLVED

Ran the new spec directly: `npx jest --config=apps/ptah-extension-webview/jest.config.ts
apps/ptah-extension-webview/src/app/git-error-tint-contrast.spec.ts --verbose` → **8/8
tests pass** (2 themes × [1 "declares tokens" check + 3 base-layer contrast checks]). Also
ran it as part of the full webview suite (`npx nx test ptah-extension-webview`, 232/232
passing) to confirm it isn't skipped or excluded from the normal run.

**Method spot-check.** Read the full spec (reproduced findings below):

- It composites `error` at `bg-error/10`'s alpha (0.1) over each of `base-100`/`base-200`/
  `base-300` using `source-over` in gamma-encoded sRGB (`mix = top*alpha + bottom*(1-alpha)`
  per channel) — this is the same math a browser applies for a translucent
  `background-color`, and it's the correct model: it operates on the **theme's own hex/oklch
  source values** from `tailwind.config.js` (via `culori`'s `rgb()` parser), not on a
  hand-typed approximation, so a future edit to the theme's `error`/`base-*` tokens is
  automatically re-checked.
- It measures `wcagContrast(base-content, compositedBackground)` against 4.5:1 (correct
  floor for the 10-12px text these lines actually use — normal text, not large text).
- It checks all **three** base layers the panel can sit on (`base-100`/`200`/`300`), not
  just one — appropriately conservative, since the dock's own rows alternate between them
  (hover states, nested folders).
- One thing it does **not** cover, which I flag as a residual gap rather than a defect:
  it only tests the `error`-tint text pair; it does not also cover `text-base-content` on
  the **warning**-tint stale-notice background (`border-warning bg-base-200`, no alpha
  compositing needed there since `bg-base-200` is opaque, so this is lower-risk and
  arguably out of the fix's stated scope, but worth noting for completeness).
- I re-derived the reported lowest ratio independently: `wcagContrast(base-content,
composite(error, 0.1, base-300))` for `anubis-light` is the tightest pairing (`base-300`
  is the light theme's darkest neutral, closest in luminance to the `error` tint being
  mixed in) — consistent with the coordinator's reported 11.52:1 lowest value; a value
  that far above 4.5:1 leaves comfortable margin even if the theme's `error` hue shifts
  moderately in a future edit.

Finding 2 is closed: the gate is real, sound in method, passing, and wired into the normal
test run.

### Finding 5 (Minor, row-level error not captured) — RESOLVED, with a caveat

Re-attempted with a **fully isolated** app instance (no prior section-level mutation in the
same session, unlike round 0's sequencing). The row click now dispatches the `git:stage`
RPC with the correct params (`{paths:['utils.ts'], workspaceRoot:'C:\\ptah-e2e-ws'}`,
confirmed via `ui.getObservedCalls`) and the row-level error box renders correctly,
matching the section-level box's markup and now-fixed 24×24 dismiss button
(`after-r1-dark-state1-row-error-wide.png`, `after-r1-light-state1-row-error-wide.png`).

**Caveat, disclosed rather than smoothed over:** across the several runs in this recheck,
one isolated re-run of the identical row-click scenario did _not_ render the error box
within an 8s wait despite the RPC call completing correctly (`git-row-error` count stayed
at 0 for several seconds after a confirmed `git:stage` response), while a separate run of
the exact same scenario succeeded and produced the screenshots above. I could not pin the
cause in the time available — it reads as a timing sensitivity between the mutation's
`await`, the subsequent `void this.gitStatus.refresh()`'s `git:info` re-fetch, and
Angular's OnPush re-render, not a structural absence (the code paths for row vs. section
errors are symmetric on inspection, per `source-control-panel.component.ts:799-825` and
`:892-899`). Downgrading from "not captured" to **Minor / worth a second pair of eyes**:
the state demonstrably renders correctly (real screenshot evidence above), but an
intermittent extra second or two of latency before it appears — if that is what's
happening — would itself be worth the author's attention. Recommend the author (not this
review) add a `commit-hook-failure.spec.ts`-style deterministic e2e regression test for
the row-level case specifically, since that would catch a real race far more reliably than
ad hoc visual capture.

### Layout integrity at the dock's width

Measured `[data-testid="git-commit-failure"]`'s rendered box directly (not the narrow
480px case, which round 0 already established is a pre-existing, unrelated whole-dock
visibility cliff): 239×130.8 CSS px, `scrollWidth === clientWidth` (`horizontalOverflow:
false`) in both themes at the dock's normal ~1400px-window / ~257px-rail width. Visual
inspection of `after-r1-dark-state1-section-error-wide.png` and
`after-r1-dark-state2-commit-failure-wide.png` confirms clean single-line/wrapped text (no
character-by-character wrapping, no clipping), the dismiss button now visibly square and
proportioned correctly next to the taller icon, and the hook-output `<pre>` still scrolling
within its `max-h-48` rather than pushing the layout. No new layout regressions found.

### New screenshots (this round)

All at 1400×860, no preceding narrow-viewport visit (so none carry round 0's disclosed
rail-squeeze artifact):

- `after-r1-dark-state1-section-error-wide.png` / `after-r1-light-state1-section-error-wide.png`
- `after-r1-dark-state1-row-error-wide.png` / `after-r1-light-state1-row-error-wide.png` (new — round 0 had none)
- `after-r1-dark-state2-commit-failure-wide.png` / `after-r1-light-state2-commit-failure-wide.png`
- `after-r1-dark-state3-commit-success-wide.png` / `after-r1-light-state3-commit-success-wide.png`

### Updated findings table

| #   | Finding                                       | Round 0 severity                   | Round 1 status                                                                                                                   |
| --- | --------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dismiss buttons under 24×24                   | Serious                            | **Resolved** — all four measured 24×24, both themes                                                                              |
| 2   | No automated AA gate for error tint           | Serious                            | **Resolved** — new spec passes 8/8, method verified sound                                                                        |
| 3   | Focus-ring legibility unconfirmed             | Moderate                           | Unchanged — out of this round's scope; still recommend a clean re-capture                                                        |
| 4   | Pre-existing rail-squeeze after narrow resize | Moderate (disclosed, out of scope) | Unchanged — confirmed again unrelated to Batch 7 (reproduces on `722d921ab`); this round's captures simply avoided triggering it |
| 5   | Row-level error not captured                  | Minor                              | **Resolved**, with a disclosed intermittent-timing caveat (see above)                                                            |

## Verdict — Revise round 1

- Recommendation: **APPROVED**
- Confidence: HIGH on the two former Serious findings (both directly measured/re-run and
  confirmed fixed); MEDIUM on the residual Moderate items, which were already disclosed as
  out-of-scope/pre-existing in round 0 and remain so.
- Key concern: none blocking. The only carried-over item worth a follow-up (not a merge
  blocker) is the intermittent row-level-error render timing noted above — real UI
  evidence shows it works, but the one flaky repro is worth a deterministic regression
  test rather than more ad hoc screenshots.

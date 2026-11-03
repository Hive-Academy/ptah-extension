# Visual review B4b: onboarding proposal pages

Method: screenshot and axe-JSON review only (no browser, build, e2e or verify run). Source: `screenshots/proposal/` (76 PNG + 76 axe JSON). Every PNG is a viewport-only capture (1280x800 or 464x800), not full page. I opened about 20 PNGs across all four themes (ptah-glass, ptah-glass-light, anubis, anubis-light), wide and narrow, covering every state; the rest are covered by the identical axe results. Source cited: `libs/frontend/onboarding/src/lib/proposal/*.ts`.

## Verdict

**REVISE.** 0 blocking, 3 major, 6 minor. No horizontal overflow, clipping or overlap at 464 px in any opened capture. The answer sheet is a correct modal. Axe has one rule (color-contrast) in anubis dark and anubis-light only. The major findings are a visible duplicate-option defect on the intake page, missing evidence for the apply result, and a contrast failure.

## Findings

### Major

1. **Stack group renders duplicate chips: two "Recommend for me" (both shown selected) and two "Other".**
   Evidence: `new-project-intake-ptah-glass-1280x800.png`, `new-project-intake-errors-anubis-light-1280x800.png`, `narrow-new-project-intake-errors-ptah-glass-464x800.png` (all 4 themes).
   Source: `new-project-intake.page.ts:149-176`. The template adds hard-coded "Recommend for me" and "Other" buttons around `@for (option of stackOptions())` (`:157`, `:270-274`). `STACK_PROFILES[].stackOptions` already contains both entries (the setup hub uses the same list without extra buttons, `setup-hub.component.ts:1143`). Two buttons are `aria-pressed` at once and share the same label.
   Fix: render only `stackOptions()` and drop the two hard-coded buttons, or filter the `recommend` and `other` values out of `stackOptions()`.

2. **Apply result and the pinned-review/current-review actions are not visible in any capture, so the apply result is unverified.**
   Evidence: `apply-result-anubis-1280x800.png` and `narrow-apply-result-ptah-glass-light-464x800.png` show only the top of the review page ("Changes since applied revision 2 . Apply again", Name Changed). The "Applied revision" card (paths, "Copy paths", Warnings, Done) is below the fold. `review-current-*` likewise never shows the Apply to Workspace button. The capture report asserts them but never scrolls them into frame.
   Source: capture spec (`onboarding-proposal-visual.e2e.spec.ts`), not product code. Related: `apply-result.component.ts:22-70`.
   Fix: scroll the asserted element into view (or use `fullPage: true`) before `captureOnboarding`, and re-capture `apply-result`, `review-current` and `review-pinned` (Update review / Apply states). Visual approval of the apply result is withheld until then.

3. **Axe color-contrast on the "New" and "Changed" badges in anubis dark and anubis-light.**
   Evidence: `review-current-anubis-1280x800.axe.json`, `review-current-anubis-light-1280x800.axe.json`, `apply-result-anubis-1280x800.axe.json`, `apply-result-anubis-light-1280x800.axe.json` (2 nodes each: `ptah-proposal-item` children 1 and 3; the 4 narrow files have 1 node each); `narrow-review-current-anubis-464x800`, `narrow-review-current-anubis-light-464x800`, `narrow-apply-result-anubis-464x800`, `narrow-apply-result-anubis-light-464x800` (1 node each). Visible in `review-current-anubis-1280x800` as the small blue "Changed" pill on a dark tile.
   Source: `proposal-item.component.ts:22` (`badge badge-outline badge-sm border-primary text-primary` at small text size on the glass tile).
   Fix: use a text colour with 4.5:1 contrast against the tile (for example `text-base-content` with a `border-primary` outline, or a primary-content-on-primary badge). Confirm in anubis and anubis-light.

### Minor

4. **Answer dock bar spans the whole viewport, over the Workspaces/Git side rails, and the "Reply" pill touches the right edge.** `narrow-workspace-first-revision-anubis-464x800.png`, `narrow-workspace-second-revision-ptah-glass-464x800.png`. `answer-dock.component.ts:66` (`fixed inset-x-0 bottom-0`). The pill is cramped to the edge and the bar looks disconnected from the rounded glass shell. Fix: inset the bar to the content column (match the shell margins) and add `pr` to the label area.
5. **Narrow answer sheet:** works (dialog, textarea focused with visible ring, background dimmed, Close and Send reply reachable, `narrow-workspace-answer-sheet-*`), but the sheet is edge-to-edge across the rails and the dimming is weak in the light themes, so the background still reads as active (`narrow-workspace-answer-sheet-anubis-light-464x800.png`). `answer-dock.component.ts:87` (`bg-base-300/70`). Fix: stronger scrim in light themes (for example `bg-black/40`) and match shell insets.
6. **Disabled controls on `workspace-unavailable`** (Review, Send reply) are pale grey on pale grey in anubis-light (`workspace-unavailable-anubis-light-1280x800.png`). Disabled controls are exempt from WCAG contrast, but the state is hard to read. Fix: slightly darker disabled text, and a one-line reason ("Needs a proposal"). Source: `proposal-workspace.page.ts` action row.
7. **Heading focus box, 3-step stepper and the broken shell logo** are visible on every page. These are the known deferred items 11, 12 and 14. They are not worse on B4b, with one exception: the box is wider on the intake and review pages (spans the content column, `new-project-intake-ptah-glass-1280x800.png`). No new action.
8. **Narrow stepper collapses to icons** (only the current step has a label), and the first step check plus the trailing circle can sit very close to the page edge (`narrow-workspace-first-revision-anubis-464x800.png`: trailing circle at x~390 beside the pill). Reads as stray marks. Fix: keep a short label or hide non-current steps consistently.
9. **Review banner and revision-history Restore buttons.** The "Revision 2 is available" banner (`review-pinned-ptah-glass-1280x800.png`) is clear and has a good amber border; "Update review" is the only action, correct. Revision history lists "Revision 1 . In progress / Revision 2 . Complete" with the Restore button always shown, including on the current revision (`workspace-second-revision-ptah-glass-1280x800.png`). Fix: hide or disable Restore for the current revision (`revision-history.component.ts`).

## What passed

- 464 px: no horizontal scroll, long `break-all` paths and JSON blocks wrap inside tiles in every narrow capture opened.
- Validation state: summary alert plus inline error with `aria-describedby` renders in all themes (`new-project-intake-errors-*`); red error text is readable in dark and light.
- New/Changed tags and the glass tile hierarchy are consistent with the generate/analyze pages (Name tile with primary outline, Prompt tile "New").
- Focus: heading and answer-sheet textarea show a visible ring. Tab order was not exercised (static captures).
- Themes: ptah-glass-light and anubis-light render without background bleed or unreadable text.

## Axe totals

- 8 of 76 files have violations: 12 nodes, 1 rule (`color-contrast`), all the New/Changed badge (finding 3).
  - Wide: `apply-result-anubis` 2, `apply-result-anubis-light` 2, `review-current-anubis` 2, `review-current-anubis-light` 2.
  - Narrow: `narrow-apply-result-anubis` 1, `narrow-apply-result-anubis-light` 1, `narrow-review-current-anubis` 1, `narrow-review-current-anubis-light` 1.
- ptah-glass and ptah-glass-light: zero violations. All other states: zero violations.

## Second pass

Method: re-opened the overwritten captures in `screenshots/proposal/` (about 13 PNGs across ptah-glass, ptah-glass-light, anubis and anubis-light, wide and narrow) and re-counted all 76 axe files. No app, build or verify was run. Fix report: `b4b-visual-fix-report.md`.

### Per-finding status

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Duplicate Stack chips | Fixed | `new-project-intake-errors-anubis-light-1280x800.png` and `narrow-new-project-intake-ptah-glass-464x800.png` show one "Recommend for me" (selected), Angular + NestJS, React + NestJS, one "Other". |
| 2 | Apply result not visible | Fixed | `apply-result-anubis-1280x800.png`, `narrow-apply-result-anubis-464x800.png`, `narrow-apply-result-ptah-glass-light-464x800.png` now show "Applied revision", "2 files written", both paths (wrapping at 464, no overflow), Copy paths, Warnings list, harness health line, Open chat / Open health dashboard / primary Done. `review-current-ptah-glass-1280x800.png` and `review-current-anubis-light-1280x800.png` show the Apply to Workspace button. `review-pinned` narrow shows the banner and Update review. Not verified: full-page review of the lower part of review-pinned (the banner is in frame, which is what was asked). |
| 3 | Badge contrast (axe) | Fixed | Axe re-count below is zero. Badge text is now base-content with a primary outline (`workspace-second-revision-*`, `narrow-workspace-answer-sheet-anubis-light-464x800.png` "Changed" tag readable). |
| 4 | Dock bar over rails, cramped Reply | Fixed | `narrow-workspace-second-revision-anubis-464x800.png` and `narrow-workspace-unavailable-ptah-glass-464x800.png`: the bar is inset to the shell with rounded corners, and the Reply pill has clear padding. |
| 5 | Answer sheet / light scrim | Fixed | `narrow-workspace-answer-sheet-anubis-light-464x800.png`: sheet inset to the shell, stronger neutral scrim, textarea focused with visible ring, Close and Send reply reachable. The Git rail strip stays lighter than the scrim (right edge, x>432); cosmetic. |
| 6 | Disabled actions on unavailable | Partial | Anubis-light (`workspace-unavailable-anubis-light-1280x800.png`) is fixed: "Review is available after a proposal is ready." appears and the disabled buttons are readable. In ptah-glass narrow (`narrow-workspace-unavailable-ptah-glass-464x800.png`) the disabled Review pill still has the yellow primary fill with grey text, so it reads as active but washed out. See new finding N1. |
| 7 | Heading focus box, stepper, logo | Unchanged (deferred) | Known items 11, 12, 14. |
| 8 | Narrow stepper stray circles | Open (deferred by fixer) | `narrow-new-project-intake-ptah-glass-464x800.png` still shows Brief plus two bare circles. Shared component `shared/onboarding-stepper.component.ts`, out of B4b scope. Stays minor. |
| 9 | Restore on current revision | Fixed | `narrow-workspace-second-revision-anubis-464x800.png` and `workspace-second-revision-anubis-light-1280x800.png`: Restore only on Revision 1, none on Revision 2. |

### New findings

- N1 (minor): on `workspace-unavailable` in ptah-glass dark (wide and narrow) the disabled Review button keeps the primary yellow fill. Fix: apply the same `base-200` disabled fill used for the other themes to the primary variant (`proposal-workspace.page.ts:246-260`). Axe reports no violation, so it is cosmetic.
- N2 (minor): the "Applied revision" card sits against the Apply card with about 2 px between them (`apply-result-anubis-1280x800.png`, `narrow-apply-result-anubis-464x800.png`). The rest of the page uses roughly 20 px between cards. Fix: add the same vertical gap (for example `mt-5` or `space-y-5` on the parent in `review-apply.page.ts`).
- Fix report notes `ptah-extension-webview:lint` failed (accepted circular dependency in `app.routes.ts`, outside B4b). Not a visual finding.

No regressions found in the other states opened (intake, intake errors, team builder, first/second revision, review-current, review-pinned, answer sheet, unavailable).

### Axe re-count

- 76 of 76 axe files are clean: **0 violations, 0 nodes**, no rule ids. Before: 12 nodes of `color-contrast` in 8 files.

### Verdict

**APPROVE.** The 3 major findings and findings 1-5 and 9 are fixed. Findings 6, 8 and new items N1 and N2 are minor and non-blocking (8 deferred); 7 remains deferred as before. Open items: 0 blocking, 0 major, 4 minor (6/N1, 8, N2, plus deferred 7).

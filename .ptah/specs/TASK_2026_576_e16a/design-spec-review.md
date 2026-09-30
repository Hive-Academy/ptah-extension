# Design Specification Review — TASK_2026_576_e16a: Advanced Git Review UI

- **Artifact**: `design-spec.md` + `prototype/`
- **Reviewed revision**: 2026-09-29T00:04:37Z (`design-spec.md`) / 2026-09-29T00:07:43Z (`prototype/`)
- **Author**: in-process subagent: ui-ux-designer
- **Reviewer**: CLI lane: antigravity
- **Execution sides**: author in-process / reviewer CLI lane
- **Round**: 1
- **Verdict**: APPROVED

> [!NOTE]
> An earlier Glm review attempt failed (model has no image input) and produced no review.

---

## Round 1 recheck

### Finding Status Matrix

| ID            | Origin           | Description                                                                                           | Severity | Status       | File : Line References                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finding 1** | Round 0 Reviewer | Severe WCAG AA contrast failure on conflict banner in light theme                                     | Major    | **Resolved** | [`design-spec.md` §11 lines 564–647](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L564-L647); [`conflict-banner.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/conflict-banner.html); [`light-conflict-banner-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-wide.png), [`light-conflict-banner-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-sidebar.png)                                                                                                                                 |
| **Finding 2** | Round 0 Reviewer | Responsive layout failure & button clipping at sidebar dock width                                     | Major    | **Resolved** | [`design-spec.md` §6.1a lines 364–390](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L364-L390); [`review-canvas.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html); [`app.js:199-270`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/assets/app.js#L199-L270); [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png), [`light-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-sidebar.png)              |
| **Finding 3** | Round 0 Reviewer | Incomplete keyboard a11y & focus restoration for modal alertdialogs                                   | Minor    | **Resolved** | [`design-spec.md` §2 line 115](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L115); [`app.js:118-184`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/assets/app.js#L118-L184)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Finding 4** | Round 0 Reviewer | Inconsistent token citation for `text-base-content/70`                                                | Minor    | **Resolved** | [`design-spec.md` §2 line 104](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L104)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Finding 5** | Round 0 Reviewer | Diff addition text contrast on cream background in `anubis-light`                                     | Minor    | **Resolved** | [`input.css:21-26`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/assets/input.css#L21-L26); [`design-spec.md` §0 lines 54-57](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L54-L57); [`light-review-canvas-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-wide.png)                                                                                                                                                                                                                                                                                                             |
| **Finding 6** | Orchestrator     | Light-theme contrast of "Stale" hunk badge and "Send to agent"                                        | Minor    | **Resolved** | [`design-spec.md` §6.1 lines 338–344, 350–352](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L338-L352); [`review-canvas.html:135-136`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html#L135-L136); [`light-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-sidebar.png)                                                                                                                                                                                                                                                                         |
| **Finding 7** | Orchestrator     | Visual polish: line gutters, syntax tokens, word highlights, sticky headers, in-flow slotted controls | Minor    | **Resolved** | [`design-spec.md` §0 lines 27–38](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L27-L38); [`input.css:68–83`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/assets/input.css#L68-L83); [`review-canvas.html:105-139`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html#L105-L139); [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png), [`light-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-sidebar.png) |
| **Finding 8** | Orchestrator     | Realistic overview proportions in `index.html` (dock at ~420px in 1280px window)                      | Minor    | **Resolved** | [`prototype/index.html:41-65`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/index.html#L41-L65); [`dark-overview-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-overview-wide.png), [`light-overview-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-overview-wide.png)                                                                                                                                                                                                                                                                                                   |

---

### Detailed Recheck & Verification

1. **Conflict Banner Contrast (Finding 1 — Major)**:
   - **Verification**: The banner container was redesigned from solid orange fill to a bordered card (`bg-base-200 border-l-4 border-warning rounded-box`).
   - The "Abort" button now uses solid `btn btn-error btn-xs` with `.err-solid-text` (`#131317` in light theme, `#ffffff` in dark theme), achieving **5.51:1** in light and **4.83:1** in dark mode (both clear WCAG AA 4.5:1).
   - "Open in editor" uses colorless `btn-outline` (`base-content` text, 14.2:1 light / 13.9:1 dark).
   - "Ask agent to resolve" uses `btn-primary` (5.18:1 light / 4.82:1 dark).
   - Muted descriptions use `text-base-content-muted` on `bg-base-200`, clearing AA at 5.01:1 light / 5.29:1 dark.
   - Screen inspection of [`light-conflict-banner-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-wide.png) and [`light-conflict-banner-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-sidebar.png) confirms clean, legible rendering with no clipped actions.

2. **Sidebar Width Layout & Action Clipping (Finding 2 — Major)**:
   - **Verification**: `design-spec.md` §6.1a explicitly documents container-driven layout over viewport media queries. `prototype/assets/app.js:199-270` implements `initResponsiveGrids` using `ResizeObserver` on `[data-responsive-grid]`, setting inline single-column grid properties below 520px rendered container width.
   - All interactive button bars (comparison bar, hunk action headers, conflict banner action list) now use `flex flex-wrap gap-1.5`.
   - Screen inspection of [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png) and [`light-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-sidebar.png) confirms that at 380px–420px dock width, the file tree stacks cleanly above the diff list, all hunk headers and buttons ("Accept", "Reject") remain completely visible, and the comparison bar controls fit without truncation.

3. **Dialog Keyboard Accessibility (Finding 3 — Minor)**:
   - **Verification**: `prototype/assets/app.js:118-184` now captures `lastTrigger` on open, implements Tab key focus trapping across focusable elements, handles Escape key dismissal, and returns focus to `lastTrigger` upon closing. `design-spec.md` §2 explicitly specifies Angular CDK Dialog / FocusTrap for the implementation phase.

4. **Token Citation Correction (Finding 4 — Minor)**:
   - **Verification**: `design-spec.md` §2 line 104 explicitly notes the removal of the invalid `text-base-content/70` citation and reaffirms `--bcm` as the sole vetted muted text tier.

5. **Diff Addition / Deletion Contrast (Finding 5 — Minor)**:
   - **Verification**: Measured classes `.diff-add-text` (`oklch(45% 0.17 162.48)` in light, 5.90:1 on `base-100`) and `.diff-del-text` (`oklch(45% 0.22 20)` in light, 6.94:1 on `base-100`; `#f87171` in dark, 6.70:1 on `base-100`) were defined in `input.css` and compiled into `app.css`. Visual inspection of diff lines in [`light-review-canvas-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-wide.png) confirms distinct, high-contrast syntax and gutter display.

6. **Stale Badge & Send to Agent Contrast (Finding 6 — Orchestrator)**:
   - **Verification**: The stale hunk indicator was redesigned from a solid red badge to a bordered chip (`border border-error/40 bg-error/10 text-xs px-2 py-0.5 rounded`) with text in `text-base-content` (13.4:1 light / 13.1:1 dark), avoiding the unvetted `error-content`-on-`error` failure. "Send to agent" in the draft bar uses `btn-primary btn-xs` (5.18:1 light / 4.82:1 dark), fully compliant.

7. **Visual Polish & In-flow Controls (Finding 7 — Orchestrator)**:
   - **Verification**: Old/new line number gutters (`.diff-line`), syntax tokens (`.tok-kw`, `.tok-fn`, `.tok-str`), word-level intraline change highlights (`.word-add`, `.word-del`), and sticky per-file headers are demonstrated in `review-canvas.html` and verified in screenshots. Slotted in-flow hunk header rendering for `@pierre/diffs` is specified in `design-spec.md` §0 lines 27–38.

8. **Realistic Overview Proportions (Finding 8 — Orchestrator)**:
   - **Verification**: `prototype/index.html` showcases a realistic 1280px Electron window structure with simulated window chrome, muted chat transcript placeholder on the left, and the Review shell dock hosted at its default ~420px width on the right (verified in [`dark-overview-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-overview-wide.png) and [`light-overview-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-overview-wide.png)).

---

### Assessment of §13a Deferral (Single-Letter Status Badges)

In `design-spec.md` §13a, the designer discloses that stock daisyUI pairings for single-letter status badges (`badge-success` "A", `badge-info` "M", and `badge-secondary` "R") exhibit sub-4.5:1 contrast in either dark or light theme (2.64:1 to 4.13:1). The designer proposes deferring the correction of these badges to implementation rather than modifying markup across all eight static prototype HTML pages.

**Verdict on Deferral: ACCEPTABLE**

- **Rationale**:
  1. The designer identified, measured, and documented the exact contrast ratios using CSS Color 4 OKLCH formulas.
  2. The remediation pattern (`.err-solid-text` and `.ok-solid-text`) is already fully designed, validated, and established in §0.
  3. In the production Angular application, status badges are rendered by a single shared component (or template pipe); fixing the token override once in the shared component or theme stylesheet is vastly superior to repeating static inline utility classes across 8 prototype files.
  4. The letters "A", "M", "D", "R" are secondary status indicators consistently accompanied by full file paths, line change statistics (`+N / -N`), and status text, posing no barrier to user comprehension.
  5. The software-architect can incorporate this single shared-component fix directly into the implementation plan.

---

### Regression Check

- **Scope boundaries**: No regression. General workspace file trees, multi-tab editors, terminals, LSP, or in-app 3-way merge editors remain strictly excluded.
- **Parity mapping**: No regression. All 17 spot-checked capabilities remain present; the 4 approved removals remain excluded.
- **Component contracts**: Transitioning the conflict banner to a bordered card and implementing container-aware stacking preserved all interactive workflows (Ask agent, Open in editor, Abort, Continue, delete/modify handling).

---

### Round 1 Verdict

**APPROVED**. All Round 0 major and minor findings and all orchestrator review items have been resolved. The design specification and prototype are structurally sound, accessible, feasible, and ready for software architecture implementation planning.

---

## Round 0 Review (Archived)

## Requirement trace

| Requirement | Description                                                     | Design Spec Section                                                                                                                                                                                           | Prototype File(s)                                                                                                                                                                                                                  | Screenshot(s) Viewed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Req 4**   | Change-set card in chat transcript (both hosts)                 | [§4.1–4.2](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L137-L193), [§3.4](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L128-L136)    | [`change-set-card.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/change-set-card.html)                                                                                                         | [`dark-change-set-card-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-change-set-card-wide.png), [`dark-change-set-card-unavailable.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-change-set-card-unavailable.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Traced |
| **Req 5**   | VS Code native review path (card variant)                       | [§5](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L194-L208), [§4.1](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L162-L164)          | [`change-set-card.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/change-set-card.html)                                                                                                         | [`dark-change-set-card-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-change-set-card-wide.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Traced |
| **Req 6**   | Electron review canvas (virtualized diff, hunks, line comments) | [§6.1–6.4](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L209-L307), [§3.1–3.2](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L67-L115) | [`review-canvas.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html)                                                                                                             | [`dark-review-canvas-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-wide.png), [`light-review-canvas-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-review-canvas-wide.png), [`dark-review-canvas-narrow.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-narrow.png), [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png), [`dark-review-canvas-reject-dialog.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-reject-dialog.png) | Traced |
| **Req 7**   | Single-file spot editor (Electron)                              | [§7](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L308-L344), [§3.3](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L116-L127)          | [`spot-editor.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/spot-editor.html)                                                                                                                 | [`dark-spot-editor-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-spot-editor-wide.png), [`dark-spot-editor-conflict.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-spot-editor-conflict.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Traced |
| **Req 9**   | Commit composer (Electron)                                      | [§9](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L353-L394), [§3.1](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L67-L99)            | [`commit-composer.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/commit-composer.html)                                                                                                         | [`dark-commit-composer-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-commit-composer-wide.png), [`dark-commit-composer-error.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-commit-composer-error.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Traced |
| **Req 10**  | Task / worktree view (Electron)                                 | [§10](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L395-L441), [§3.1](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L67-L99)           | [`task-worktree.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/task-worktree.html)                                                                                                             | [`dark-task-worktree-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-task-worktree-wide.png), [`dark-task-worktree-gh-unavailable.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-task-worktree-gh-unavailable.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Traced |
| **Req 11**  | Conflict banner (Electron)                                      | [§11](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L442-L485), [§3.1](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L76-L84)           | [`conflict-banner.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/conflict-banner.html), [`index.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/index.html) | [`dark-conflict-banner-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-conflict-banner-wide.png), [`light-conflict-banner-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-wide.png), [`dark-overview-sidebar-conflict.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-overview-sidebar-conflict.png)                                                                                                                                                                                                                                                                                                                   | Traced |
| **Req 12**  | Per-task history timeline (Electron)                            | [§12](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L486-L517), [§3.1](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L67-L99)           | [`history-timeline.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/history-timeline.html)                                                                                                       | [`dark-history-timeline-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-history-timeline-wide.png), [`dark-history-timeline-empty.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-history-timeline-empty.png)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Traced |
| **Req 13**  | Parity of redesigned Electron surface                           | [§13](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L518-L543)                                                                                                             | [`README.md` §Parity Mapping](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/README.md#L120-L150)                                                                                                     | All prototype screenshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Traced |

---

## Findings (Round 0)

### Finding 1: Severe WCAG AA contrast failure in the conflict banner (Light Theme)

- **Location**: [`design-spec.md` §11 lines 466, 473–477, 482–485](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L466-L485); [`prototype/conflict-banner.html` lines 46, 62, 75, 79, 95](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/conflict-banner.html#L46-L95); screenshot [`light-conflict-banner-wide.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/light-conflict-banner-wide.png).
- **Severity**: **Major**
- **Description**:
  1. The conflict banner container is styled as `.alert.alert-warning`, which sets the background to `warning` (`oklch(72% 0.18 55)` in `anubis-light` / `#f97316` in `anubis`).
  2. The "Abort" button is specified and rendered as `btn btn-error btn-outline btn-xs`. In daisyUI, `.btn-outline.btn-error` renders with an uncolored background and text/border in semantic `error` (`oklch(64% 0.246 16.439)` in `anubis-light`). Placing 64% lightness red text on 72% lightness orange produces a contrast ratio of **~1.5:1** (and ~1.91:1 in dark mode). This drastically fails WCAG 2.2 AA (requires 4.5:1 for regular text). In `light-conflict-banner-wide.png`, the "Abort" button label is virtually illegible.
  3. The conflict explanation text in line 75 uses `text-base-content-muted` inside `.alert-warning`. `--bcm` in `anubis-light` is `oklch(53.2596% 0.0412 354.4634)` (purplish dark gray) on orange `oklch(72% 0.18 55)`, yielding only **~2.0:1** contrast, also failing AA.
  4. The primary action button `btn-primary btn-xs` ("Ask agent to resolve") in `anubis-light` is light cupcake teal `oklch(85% 0.138 181.071)` on orange `oklch(72% 0.18 55)`, producing insufficient component boundary contrast (~1.4:1).
  5. The design spec claimed contrast passes (line 483: "`warning-content` on `warning`: 6.1:1 light"), but that measurement only checked plain text in `warning-content`, completely ignoring the outline buttons and muted text placed inside the alert.
- **Remediation**:
  - Re-skin the conflict banner container to avoid solid bright orange fill across the entire banner width. Use the project's standard panel pattern: `bg-base-200 border-l-4 border-warning` (mirroring `permission-request-card.component.ts`), with standard `text-base-content` body, `btn-primary`, and `btn-error btn-outline`.
  - Alternatively, if solid `alert-warning` fill is retained, all buttons and text inside it must use solid contrast tokens: solid `btn-neutral btn-xs` or solid `btn-error` with `error-content` text, and all descriptive text must use `warning-content` with an explicit opacity or tone, never `text-base-content-muted`.

---

### Finding 2: Critical responsive layout failure and button clipping at Electron sidebar width

- **Location**: [`design-spec.md` §3.1 lines 69–85](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L69-L85), [§6.1 lines 211–248](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L211-L248); [`prototype/review-canvas.html` line 63](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html#L63); [`prototype/index.html`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/index.html); screenshots [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png), [`dark-overview-sidebar-conflict.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-overview-sidebar-conflict.png).
- **Severity**: **Major**
- **Description**:
  1. The target environment for the review canvas is Ptah's Electron right dock (`GitDockComponent`), which has a rail width range of 160px–480px (default ~380px–400px), hosted inside a wider application window (e.g. 1440px wide).
  2. In `review-canvas.html:63`, column reflow is controlled via viewport media queries:
     `<div class="grid grid-cols-1 max-[520px]:grid-cols-1 min-[521px]:grid-cols-[220px_1fr]">`.
     Because the browser/window viewport is desktop width (> 520px), `min-[521px]` is active even when the review surface container is embedded in a 380px–400px sidebar.
  3. As captured in [`dark-review-canvas-sidebar.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-review-canvas-sidebar.png):
     - The file tree consumes 220px, leaving only ~160px–180px for the diff view.
     - The "Reject" button is pushed completely outside the visible viewport and clipped.
     - Hunk headers wrap onto three vertical lines ("Hunk \n 1 of \n 2").
     - The refused hunk banner badge wraps into an unreadable 4-line squished block.
     - Comparison bar controls (`Filter files...`, `Split`, `Unified`, file count) overflow the header and are cut off.
     - Multiple conflicting horizontal and vertical scrollbars appear simultaneously.
  4. In [`dark-overview-sidebar-conflict.png`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/screenshots/dark-overview-sidebar-conflict.png), the conflict banner action buttons at ~400px container width overflow the container right edge, clipping "Ask agent to resolve", "Open in editor", and hiding "Abort".
- **Remediation**:
  - Replace viewport-based media queries (`max-[520px]`/`min-[521px]`) with CSS container queries (`@container (min-width: 520px)`) or responsive layout integration with `ElectronLayoutService`.
  - When the dock container is under ~500px, provide a single-column layout with a collapsible file tree toggle (preserving the existing rail collapse behavior from `rail-resize-handle.component.ts`), or stack the file tree above the diff.
  - In the conflict banner, ensure the button row uses `flex-wrap gap-1.5` and stacks cleanly rather than clipping off-screen when the dock is narrow.

---

### Finding 3: Incomplete keyboard accessibility and focus restoration for modal dialogs

- **Location**: [`design-spec.md` §2 line 64](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L64); [`prototype/assets/app.js` lines 113–128](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/assets/app.js#L113-L128).
- **Severity**: **Minor**
- **Description**:
  - `design-spec.md` line 64 specifies: "`alertdialog` top-layer modal, focus-on-Cancel, Escape-cancels (`diff-view.component.ts:482-567` pattern (kept))".
  - In `prototype/assets/app.js:113-128`, while opening the dialog properly focuses `[data-default-focus]` (the safe choice), there is no `keydown` handler for the Escape key, no focus trap (tab navigation leaks to underlying content), and focus is not restored to the invoking element when the dialog closes.
- **Remediation**:
  - Ensure the software architect notes that Angular implementation must leverage Angular CDK Dialog / A11y or native `<dialog>` to guarantee Escape key dismissal, active focus trapping, and focus return to trigger.

---

### Finding 4: Inconsistent token citation for `text-base-content/70`

- **Location**: [`design-spec.md` §2 line 53](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L53).
- **Severity**: **Minor**
- **Description**:
  - The token table cites `text-base-content/70` to `tailwind.config.js:13-31` for "tertiary hints".
  - However, `tailwind.config.js:16-20` and [`base-content-muted.spec.ts`](file:///D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/base-content-muted.spec.ts) document that arbitrary alpha levels (`text-base-content/40|50|60|80`) were explicitly purged from the design system in TASK_2026_183 because alphas fail WCAG AA across disparate themes, creating `--bcm` (`text-base-content-muted`) as the sole vetted secondary/tertiary token.
  - While `text-base-content/70` is not used in the prototype markup, citing it as an approved token could lead downstream implementers to reintroduce unvetted alpha tiers.
- **Remediation**:
  - Remove `text-base-content/70` from `design-spec.md` §2 and standardize all subdued text on `text-base-content-muted`.

---

### Finding 5: Diff addition text contrast on cream background in `anubis-light`

- **Location**: [`prototype/review-canvas.html` line 121](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/review-canvas.html#L121); [`design-spec.md` §4.2 line 189](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/design-spec.md#L189).
- **Severity**: **Minor**
- **Description**:
  - In `review-canvas.html:121`, diff added lines use `<span class="text-success bg-success/10">+ const y = 2;</span>`.
  - In `anubis-light`, `text-success` is `oklch(69% 0.17 162.48)`. On a cream background (`bg-base-100` / `bg-base-300/30`, lightness ~92–98%), this bright green text achieves a contrast ratio of ~3.7:1. While the spec noted 4.8:1 for summary badges on `bg-base-300`, 11px normal text (`text-[11px]`) in diff code requires 4.5:1 under WCAG AA.
- **Remediation**:
  - For light theme diff syntax highlighting, specify a deeper green grammar token (e.g. `oklch(50% 0.17 162.48)` or Shiki light syntax theme) that ensures >= 4.5:1 contrast against light cream backgrounds.

---

## Parity check

Every `keep` and `move` row from [`parity-inventory.md`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/parity-inventory.md) has a visible, documented home in the design. None of the four user-approved removals (`remove-proposed`: multiple file-view tabs, `SourceControlService.getOriginalContent`, `GitBranchesService.refreshTags`, and `MonacoLoaderService`/`monaco-theme.ts`) reappear.

Spot-check of 17 capability rows across all inventory sections:

1. **§1 Dock shell — Loading repository state**: [`git-dock.component.ts:104-105`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts#L104-L105) (`keep`) → Review shell loading state (`design-spec.md` §13, `prototype/README.md`).
2. **§1 Dock shell — Not a Git repo state**: [`git-dock.component.ts:106-107`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts#L106-L107) (`keep`) → Review shell not-a-repo state (`design-spec.md` §13).
3. **§1 Dock shell — Rail collapse toggle**: [`git-dock-header.component.ts:57-83`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L57-L83) (`move`) → Review shell header ☰ toggle / changed-file tree toggle (`index.html`, `design-spec.md` §3.1).
4. **§1 Dock shell — Rail resize handle (160–480px, keyboard)**: [`rail-resize-handle.component.ts:21-28`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.ts#L21-L28) (`move`) → Review canvas changed-file tree resizable column (`design-spec.md` §6.1).
5. **§2 Header — Current branch button**: [`git-dock-header.component.ts:84-97`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L84-L97) (`keep`) → Review shell header branch button (`design-spec.md` §3.1).
6. **§2 Header — Branch details popover**: [`git-dock-header.component.ts:98-114`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L98-L114) (`move`) → Task/worktree view Branch panel (`design-spec.md` §10).
7. **§2 Header — Stash button with count & popover**: [`git-dock-header.component.ts:119-138`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L119-L138) (`keep`) → Kept in header popover and expanded in History tab (`design-spec.md` §3.1, §12).
8. **§2 Header — Workspace Open-in**: [`git-dock-header.component.ts:140-144`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L140-L144) (`keep`) → Review shell header Open-in menu (`design-spec.md` §3.1).
9. **§2 Header — Fetch/Pull/Push controls & spinners**: [`git-dock-header.component.ts:145-200`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L145-L200) (`keep`) → Review shell header right group (`design-spec.md` §3.1).
10. **§3 Source-control — Staged Changes section**: [`source-control-panel.component.ts:153-232`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts#L153-L232) (`move`) → Review canvas changed-file tree Staged group (`design-spec.md` §6.1).
11. **§3 Source-control — Commit message textarea**: [`source-control-panel.component.ts:116-124`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts#L116-L124) (`move`) → Commit composer message textarea (`design-spec.md` §9).
12. **§3 Source-control — Commit button with staged count**: [`source-control-panel.component.ts:125-136`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts#L125-L136) (`move`) → Commit composer primary button (`design-spec.md` §9).
13. **§4 Worktree — Worktree list, switch, add, remove**: [`worktrees-section.component.ts:17-104`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/worktrees/worktrees-section.component.ts#L17-L104) (`keep`) → Task/worktree view Worktrees panel with nested-button fix (`design-spec.md` §10).
14. **§5 Stash — Stash apply/pop/drop with confirmation**: [`stash-popover.component.ts:60-120`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L60-L120) (`keep`) → History timeline Stashes section (`design-spec.md` §12).
15. **§7 Diff view — Split/Unified layout toggle**: [`diff-view.component.ts:352-370`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts#L352-L370) (`keep`) → Review canvas comparison bar (`design-spec.md` §6.1).
16. **§7 Diff view — Hunk reject alertdialog focusing Cancel**: [`diff-view.component.ts:482-567`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts#L482-L567) (`keep`) → Review canvas reject dialog (`design-spec.md` §6.1, `review-canvas.html:212-221`).
17. **§8 File view — Markdown preview toggle with 512KB limit**: [`file-view.component.ts:32, 102-192`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/file-view/file-view.component.ts#L32) (`keep`) → Spot editor preview toggle and size guard (`design-spec.md` §7).

---

## Token check

Spot-check of 8+ tokens cited in `design-spec.md` against [`apps/ptah-extension-webview/tailwind.config.js`](file:///D:/projects/ptah-extension/apps/ptah-extension-webview/tailwind.config.js):

1. **Theme definitions**: `anubis` and `anubis-light` cited at lines 51, 70, 128 match `tailwind.config.js:70` and `tailwind.config.js:128`.
2. **Animation**: `animate-glow-urgent` cited at lines 61, 260 matches `tailwind.config.js:40, 53-62` (`glow-urgent 1s ease-in-out infinite`).
3. **Monospace typography**: `font-mono` (JetBrains Mono) cited at line 62 matches `tailwind.config.js:35` (`['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace']`).
4. **Box radius**: `--rounded-box` cited at line 63 matches `tailwind.config.js:118` (`0.75rem` dark) and `tailwind.config.js:180` (`1rem` light).
5. **Muted text tier**: `text-base-content-muted` / `--bcm` cited at lines 53, 191 matches `tailwind.config.js:31, 98, 161` (5.29:1 dark, 5.01:1 light).
6. **Warning token**: `warning` / `--wa` (`#f97316` dark / `oklch(72% 0.18 55)` light) cited at lines 111, 454–455, 483–484 matches `tailwind.config.js:111, 173`.
7. **Error token**: `error` / `--er` (`#dc2626` dark / `oklch(64% 0.246 16.439)` light) cited at line 305 matches `tailwind.config.js:114, 176`.
8. **Success token**: `success` / `--su` (`#16a34a` dark / `oklch(69% 0.17 162.48)` light) cited at line 189 matches `tailwind.config.js:104, 167`.
9. **Discrepancy reported**: `text-base-content/70` in `design-spec.md:53` cited to `tailwind.config.js:13-31` was a mismatch in Round 0, corrected in Round 1 (Finding 4).

---

## Accessibility

1. **Keyboard navigation**:
   - The review canvas specifies roving tabindex for hunk toolbars and changed-file tree items (`design-spec.md` §2 line 65, §6.1 line 251), preserving current patterns from `diff-view.component.ts`.
   - Tab switching in `NativeTabGroupComponent` preserves roving `aria-selected` and arrow-key cycling.
2. **Focus order & safe defaults**:
   - Destructive dialogs (reject hunk, disk conflict, abort operation, drop stash, remove worktree) consistently set `data-default-focus` on the safe choice (`Cancel` or `Reload`), verified in `prototype/review-canvas.html:217`, `conflict-banner.html:107`, and `spot-editor.html:94`.
3. **Accessible names**:
   - Icon-only navigation buttons in the review canvas hunk toolbar have explicit `aria-label="Previous hunk"` and `aria-label="Next hunk"` (`review-canvas.html:113-114`).
   - Purely decorative Unicode glyphs carry `aria-hidden="true"` throughout (`review-canvas.html:144, 152, 160, 168`).
4. **Contrast**:
   - In `anubis` dark mode, contrast across cards, tabs, and diff rows passes WCAG AA (>= 4.5:1) for the pairs that passed verification; the single-letter status badges remain documented exceptions ("A" and "M" fail in dark mode, "R" fails in light mode) — see `design-spec.md` §13a and "Unresolved items" below.
   - In `anubis-light`, previously failing pairs in the conflict banner and diff addition texts were remediated in Round 1 using verified color substitutes (`.err-solid-text`, `.diff-add-text`, `.diff-del-text`, bordered chip for stale warning).

---

## Lane-introduced constraints

- **Verification**: None found.
- The design strictly adheres to the approved requirements in `task-description.md` and user direction in `context.md`. The design synthesizes the requested surfaces into four logical dock tabs (`Changes`, `Commit`, `Task`, `History`) plus an in-place spot editor mode and top-level conflict banner.
- Open questions flagged in `task-description.md` (draft-batch line comments vs immediate send, and read-only default for chat file links) were resolved with sound domain rationale and no artificial restrictions.

---

## Unresolved items

1. **Single-letter status badges (`badge-success` "A", `badge-info` "M", `badge-secondary` "R")**: Disclosed in `design-spec.md` §13a as stock daisyUI token contrast limits. Documented as a targeted follow-up batch for the software-architect / implementation team to address uniformly in the shared Angular badge component.

---

## Review limits

- Review completed in 13 tool calls in Round 1 without running state-changing git commands or modifying project sources.
- Visual validation performed across revised prototype screenshots covering dark and light themes, realistic desktop dock proportion (`index.html`), and narrow sidebar views.
- Size gates for `@pierre/diffs` vs `@codemirror/merge` remain an implementation gate (Requirement 3.2).

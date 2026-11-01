# Code Logic Review — TASK_2026_ONBOARDING batch B2

## Verdict
REVISE (minor) — 7.5/10. No critical or high findings. The medium items below should be fixed or explicitly accepted before B3 consumes the components.

## Review family
Reviewer: Claude (in-process). Implementers: Codex (part A), Grok (part B).

## Findings

1. **Medium (A)** — `shared/run-panel.component.ts:20-35` (with `run-status-chip.component.ts:7-19`). `stop-unconfirmed` and `stop-unknown` map to the chip state `cancelling`. RunPanel renders no action button for `cancelling`. A run whose stop could not be confirmed or is unknown therefore shows "Stopping" with no Stop, Retry or Start-over action. Scenario: the backend never confirms the stop, and the user is stuck on a spinner-less "Stopping" panel with nothing to click. Either map those two states to a state that offers an action, or add an input so B3 can opt in to a recovery action. The chip-mapping test (`run-status-chip.component.spec.ts:7-13`) locks in the current mapping without questioning it.

2. **Medium (A)** — `shared/run-panel.component.ts:44,17`. `error` is a free `string` input that is rendered verbatim inside `role="alert"`. The B2 rule is that raw backend text never reaches the DOM, but this component does not enforce it through `safeFailureCopy` or through its type. The doc comment doesn't say that callers must pre-sanitise. Scenario: B3b passes `store.error()` and leaks a path or URL. Add a doc comment or apply `safeFailureCopy` internally.

3. **Medium (A)** — Glyph and label divergence between sibling components. The same "Interrupted" or `resumable` concept uses `Pause` in `run-status-chip.component.ts:30` but `Loader` in `home/resume-banner.component.ts:15`. The resume banner hand-rolls its own pill instead of reusing `ptah-run-status-chip [state]="'resumable'"`. `ItemStatusCard` also has its own pill markup (`item-status-card.component.ts:121-135`), and uses `Clock` for pending where the chip uses `CircleDashed` for idle. Scenario: the same state looks different on two screens. Reuse the chip in the banner and share the presentation constants.

4. **Low (A)** — `shared/recovery-screen.component.ts:21,24`. Hard-coded `id="recovery-title"` with `aria-labelledby`. If two instances render (for example, a nested page), the ids collide and the accessible name resolves to the wrong heading. Use `aria-label` or a generated id.

5. **Low (A)** — `shared/onboarding-stepper.component.ts:42-43`. A non-link completed step appends `, completed` inside a span that is `sr-only` in the narrow strip. The wrapper has the sr-only class while the nested comma span is a child, so this works. The link and non-link paths use different mechanisms (`aria-label` against nested text), so the accessible-name convention is inconsistent. A `completed` step without a `link` can't occur under the `OnboardingStep` type, so the fallback branch is only partly reachable. The stepper test never exercises it.

6. **Low (B)** — `shared/item-status-card.component.ts:130-131`. `[class.motion-reduce:animate-none]` is bound only while status is `running`, whereas `run-status-chip` uses the static `motion-reduce:animate-none` class. This is functionally equivalent. However, a class binding whose name contains a colon relies on Tailwind scanning the template for the literal string. It is brittle. Use the static class as the chip does.

7. **Low (B)** — `shared/item-status-card.component.ts:204-212`. The `running` detail line prints `Tailoring N sections` even when N is 0 or one ("1 sections"). Pending shows "Queued", which duplicates the "Waiting" label. Pluralisation and a zero case are unhandled.

8. **Low (B)** — `shared/details-log.component.ts:47,99-102`. Open state comes only from the native `toggle` event. If the parent swaps `mode` or `tabId` while the disclosure is open, the embed rebinds in place with no remount, so a stale tab id never clears. Tab mode with `tabId` null while open renders an empty body with no message. A native `<details>` also keeps its open state across `@if` parents only if the host element persists. Acceptable for B2, but note it for B3.

9. **Low (A)** — `shared/run-panel.component.spec.ts` and `shared/owner-conflict-banner.component.spec.ts` cover one path each. RunPanel's failed, resumable and done button sets, and the `error` alert, are untested. The tests assert behaviour that exists but leave most branches uncovered.

## Checks passed
- All components are standalone, OnPush, signal `input()` and `output()`, with `@if` and `@for`. No services, RPC or constructor subscriptions are used.
- `chipStateFor` is a `Record<GenerationViewState, …>`, so a new member fails typecheck. All 11 states are mapped (checked against `generation-workflow.store.ts:15-26`).
- `ITEM_STATUS_LABELS` is a `Record` over all seven statuses with the exact C-B2 labels. Raw `error` goes only through `safeFailureCopy`. A failed agent with no error shows the label only, as C-B2 specifies. "Attempt a of b" requires both values to be set. The card spec has a raw-error test (`item-status-card.component.spec.ts:65`).
- StepMeter has a progressbar with min, max, now and label, clamps values, and handles NaN. It has `motion-reduce:transition-none`.
- Stepper completed steps are `<a>` elements with `aria-label` "<Step>, completed", `aria-current="step"` on the current step, and a narrow strip that collapses labels. It takes link commands and queryParams from `OnboardingStepLink`.
- DetailsLog mounts the embed and transcript only while open and imports `BuilderSessionSectionComponent` via `@ptah-extension/harness-builder`. There are no relative cross-lib imports in the files I read. The additive index exports match the plan.
- 32px targets: all buttons and links carry `min-h-8`. Status glyphs are always paired with text and marked `aria-hidden`.

## Limitations
Read-only review: I ran no tests, typecheck or lint. I read the spec files for the stepper, chip, panel, meter, recovery screen and DetailsLog (grep only) but not every spec line. I did not verify visual styling or design-spec token names such as `text-state-run`, `data-glass-surface` and `border-state-need/70`. I did not verify that `AnalysisTranscriptComponent` and `SessionEmbedComponent` take the inputs bound in DetailsLog, beyond what the lane's spec stubs show.


## Re-review (revision 1)

Reviewer: Claude (read-only; no tests, typecheck or lint run by me). Read the revised sources, not only the lane reports.

### Per-finding status

| # | Status | Evidence |
| - | ------ | -------- |
| 1 | FIXED | `run-panel.component.ts:25,51-54` adds optional `viewState` input (`:43`). `stop-unconfirmed` and `stop-unknown` show Retry and Start over; plain `cancelling` stays actionless (correct, a stop is in flight). Chip mapping unchanged (`run-status-chip.component.ts:76-77`). |
| 2 | FIXED | `run-panel.component.ts:47-50,18` passes `error` through `safeFailureCopy` with a fixed fallback. Raw text never reaches the DOM. |
| 3 | PARTIAL | Glyph now shared: `INTERRUPTED_RUN_ICON` (`run-status-chip.component.ts:68,93`) used by `resume-banner.component.ts:119,147`. Not fully addressed: the banner still hand-rolls the pill (`resume-banner.component.ts:130-133`) instead of reusing `ptah-run-status-chip [state]="'resumable'"`, and it omits the chip's `text-state-need` colour (`run-status-chip.component.ts:93`), so the two surfaces still differ in colour. `ItemStatusCard` pending still uses `Clock` (`item-status-card.component.ts:52`) against the chip's idle `CircleDashed` (`run-status-chip.component.ts:89`). That one is arguably a different concept (item queued, not run idle) and no longer worth a revision. Residual severity: Low. |
| 4 | FIXED | `recovery-screen.component.ts:14,39,23,26` gives each instance a unique heading id. |
| 5 | FIXED | `onboarding-stepper.component.ts:11-14` type allows a completed step without a link. Both completed branches (`:28-33` and `:34-39`) use the same text-based accessible name. |
| 6 | FIXED | `item-status-card.component.ts:129-130` uses a static `motion-reduce:animate-none` class plus `[class.animate-spin]`, the same pattern as the chip. |
| 7 | FIXED | `item-status-card.component.ts:203-215` pluralises the running line. Pending returns `null`, so there is no "Queued" duplicate. |
| 8 | FIXED | `details-log.component.ts:65,113-122` remounts through `@for ... track key` when the tab id or mode changes. A null tab id shows "Session is not available." rather than an empty body. |
| 9 | FIXED (per lane reports) | The run-panel, stepper, recovery and owner-conflict specs were extended. I did not read every spec line. |

### New findings

1. **Low** — `run-panel.component.ts:51-54`. The recovery actions depend on the caller passing `viewState`. If B3 binds only `state` (the chip state), `stop-unconfirmed` and `stop-unknown` revert to the original stuck "Stopping" panel with no silent warning. Mitigation: B3b must pass `viewState`; record this as a B3 acceptance check. A `stop-unconfirmed` run may still be live, so Retry from that state should be gated on the store's own retry semantics, which is a B3 concern.
2. **Low** — `details-log.component.ts:113-122`. The mount key is the raw `tabId`. A tab id equal to the literal `'analysis'` or `'unavailable'` would pick the wrong branch at `:66-68`. Tab ids are generated, so this is unlikely. A prefixed key (`tab:${id}`) would remove the risk.
3. **Low** — `resume-banner.component.ts:130-133`. Same residual as finding 3: no `text-state-need` colour on the Interrupted pill.

No Blocking, Serious or Medium defects were found. Checked and clean: `safeFailureCopy` and `GenerationViewState` export from `setup-wizard/src/index.ts` (additive); the stepper's nested `@if` narrowing is sound after the TS2367 fix; the recovery id counter is module-local and per instance; the `@for` details-log remount is correct. The `harness-builder` index export is additive.

### Score and verdict

Score: 8.5/10.

Verdict: **APPROVED**. The only open item is the Low residual of finding 3 (hand-rolled banner pill and colour); fold it into B3 or the polish pass.

## Coordinator correction review

Verdict: **APPROVED**. No defects.

- `resume-banner.component.ts:14`: `state="resumable"` is a static string attribute bound to the required signal input `state` of `RunStatusChipComponent`. Angular accepts this, and the literal is a member of `OnboardingRunChipState`. The component imports the chip (line 8). The chip renders the "Interrupted" label with the Pause icon and the `text-state-need` class (`run-status-chip.component.ts:32`). The banner passes no `class`, so there is no class merging to worry about. The chip host's `inline-flex` and the span's `[class]` binding coexist with its static classes. `resume-banner.component.spec.ts:15` asserts `textContent` contains "Interrupted". That still holds because the chip renders inside the banner.
- `details-log.component.ts:121` and `:82`: the key is `tab:${tabId}`, and `'tab:'.length === 4`, so `key.slice(4)` returns the original tabId. A tabId of 'analysis' or 'unavailable' now yields `tab:analysis` or `tab:unavailable`, which never matches the literal branches. The `@for` tracks by key, so remounting on tabId change is preserved. The specs at `details-log.component.spec.ts:110, 153, 160` assert the embed `tabId()` equals 'tab-1' or 'tab-2', which `slice(4)` returns. The remount, null and mode-switch specs are unaffected.
- Residual: no spec covers a tabId literally named 'analysis' or 'unavailable'. This is Minor and optional.
- I did not run the specs.

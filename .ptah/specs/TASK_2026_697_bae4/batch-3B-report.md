# Batch 3B report — V17 and V18

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-start.component.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` and `.spec.ts`

## Acceptance evidence

- V17: The page selects the tab whose id matches `coordinator.currentTabId()` and passes only its `sessionStats` snapshot (`command-center-page.component.ts:267,453-459`). The current row displays cost and tokens only when that snapshot exists (`command-center-start.component.ts:81-85`). It reuses the chat stats formatters and known subtotal semantics, preserves provisional `~`, and renders unknown values as `—` (`command-center-start.component.ts:203-216`). The existing muted text token supplies readable text in both themes; no alpha text class was added.
- V18: The page binds the store's existing `outputLevel()` signal to the directly rendered HUD (`command-center-page.component.ts:367-375`). A five-bar `Speaker` meter exists only while speaking, with 0–100 ARIA bounds and a finite, clamped current value (`command-voice-hud.component.ts:64-83,160-175`). No timer or poll was added.
- Specs: Current row null, provisional, unavailable, and no recent-card spillover (`command-center-start.component.spec.ts:164-187`); selected current-tab snapshot and HUD signal binding (`command-center-page.component.spec.ts:338-368`); speaking-only Speaker meter, five bars and clamping (`command-voice-hud.component.spec.ts:17-36`).

## Verification

No Nx, Jest, TypeScript, lint, or build command was run, as requested. Scoped `ptah_get_diagnostics` found no diagnostics in the six changed files after the edits. Its project check still reported 29 errors in sibling integration/model specs outside this batch's ownership.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Bind the HUD in the page dock | The page directly renders `ptah-command-voice-hud` at `command-center-page.component.ts:367`; the scene has a separate existing output-level binding at `:303`. The HUD gets the same store signal. | Yes |
| Hide current figures when the snapshot is null | The plan requires no fake zero. For a present but partial snapshot, the Phase 2 stats component uses `formatCost`, `formatTokens`, `knownSubtotalOf`, `~`, and `—`; the current row follows those rules. | Yes |
| Clamp only the new output meter at the display boundary | The store already clamps sampled levels, while the HUD's new public input can receive arbitrary values. A finite 0–100 ARIA value keeps it valid. | Yes |

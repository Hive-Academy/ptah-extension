# Batch A1 fix round 1

## Changes

- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:144-148`: Added empty `@placeholder` and `@loading` elements with `panelId()` so the open button's `aria-controls` target exists while the deferred activity panel loads. The panel component remains only inside `@defer`.
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.spec.ts:169-258`: Updated the three existing activity panel specs to await `fixture.whenStable()` and run change detection before reading panel content; retained their assertions. Added an immediate post click `aria-controls` target spec.

## Specs

- `keeps tokens and cost in the activity panel, closed by default (B-8, B-11)` — pass.
- `keeps the aria-controls target mounted while the activity panel loads` — pass.
- `omits the cost item when usage has no known price` — pass.
- `renders a genuinely known zero cost as $0.0000 in the activity panel` — pass.
- Permitted Jest command on `message-bubble.component.spec.ts`: 1 suite passed, 18 tests passed, 0 failed.

## Decisions

- The placeholder alone did not preserve the target after the defer trigger fired. Angular showed a loading phase before mounting the panel, so the same ID is rendered in `@loading` too.
- Both interim elements are visually empty and have no reserved height, matching the panel's prior unloaded state. The panel content still determines its final height when ready.
- The source review's unrelated findings are outside this fix round's file scope.

## Not done

- Bundle size was not measured; the orchestrator handles that check. No Nx target or build was run.

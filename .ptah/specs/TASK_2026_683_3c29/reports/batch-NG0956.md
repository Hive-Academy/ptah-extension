# NG0956 canvas lane fix

## Change

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:68` tracks the one-item lane block by `block.key` instead of item identity.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:189` computes the block from `tabId` and `laneKey`. Its object remains stable across unrelated changes and changes when either key input changes, preserving subtree replacement and the entrance animation.

## Spec

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:188` asserts the `.rail-lane-enter` element is the same node after `paneFocused` changes and a different node after `laneKey` changes.
- Tests, typecheck, lint, build, and diagnostics were not run, as instructed.

## Decisions

- Used the requested computed one-item object with `track block.key`. The alternative identity tracking causes NG0956; tracking the stable key keeps the intended replacement behavior. This change is reversible.

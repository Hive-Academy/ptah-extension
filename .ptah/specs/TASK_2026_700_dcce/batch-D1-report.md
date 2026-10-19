# Batch D1 report

## Files changed

- `libs/frontend/command-center/src/lib/scene/scene-layout.ts`
- `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts`

## Exported contract for D2/D3

- `SceneViewport` gains optional `sceneRect?: SceneRect`; callers without it retain the prior viewport geometry and return shape.
- New `SceneTether` interface has `fromId`, `toId`, `fromX`, `fromY`, `toX`, `toY`. Coordinates are sphere centres, with `fromId` the owned work and `toId` its nearest owning child.
- `SceneLayout` gains optional `tethers?: readonly SceneTether[]`. Rect layouts return this array; no-rect layouts omit it so existing component literals remain valid.
- Existing `SceneRect`, `SceneNode`, `MeasureSceneLabel`, `SCENE_LABEL_CANDIDATE_LIMIT`, and `layoutScene` names remain unchanged.

## Acceptance work

- Rect layouts centre Ptah in the supplied rectangle, constrain orbit axes and packing to its measured bounds, and leave the stage foot outside the scene rectangle. The page supplies the band reservation in D2; layout does not infer or subtract it again.
- The 23-delegate priority and ancestor budget and completed/other overflow counts remain in place.
- Child-owned work is placed after the owning child core. Grandchildren orbit their immediate parent child recursively; directly owned lanes, agents, and Tribunal cores use the child orbit. Tribunal lanes still orbit their Tribunal core. Child ownership tethers expose the final endpoints.
- Rect plate placement tries below the owning sphere first (radius plus 8px), then sides before above; it checks every sphere and placed plate, uses 12px between plates, a scene-top floor of `sceneRect.y + 6`, and 8px horizontal canvas clearance. Root, selected, failed, and awaiting plates are considered before ordinary plates. Dense ordinary plates may be omitted.
- The rect path uses each child node's own label, including a projected unknown child's fallback. The no-rect path retains its previous parent-provider child label and viewport placement.

## Verification

- Added layout tests for 1440, 900, 720, 480 widths; 900px Crucible plate/sphere clearance; grandchild orbit; child-owned tether coordinates and lane plate anchoring; unknown child; 24-node priority and overflow; no-rect behavior remains covered by existing deterministic tests.
- `nx typecheck command-center`: passed.
- `nx lint command-center`: passed with no warnings.
- `nx test command-center`: 45 suites, 516 tests passed. Jest reported a worker teardown warning after the run; no suite failed.
- After the final test-only assertion: targeted `scene-layout.spec.ts`: 22 tests passed. `ptah_get_diagnostics` reported no diagnostics in either changed file. It also reported 29 errors in sibling specs outside this batch; scoped Nx typecheck passed.

## Decisions

- Used an optional `SceneLayout.tethers` field because the current scene component constructs a layout literal and D1 cannot edit that component. D2 can consume the returned endpoints without breaking the current caller. Reversible when D2 updates that literal.
- Kept the legacy no-rect path intact while using the explicit rect for new bounds and child ownership. Evidence: D1 requires current callers and specs to keep compiling and a no-rect fallback unchanged. Reversible when all callers supply the measured rect.
- Prioritized a side candidate over an above candidate in rect layouts when below fails. Evidence: D4 M3 and the 900px Crucible requirement. Reversible if a later approved design changes plate order.

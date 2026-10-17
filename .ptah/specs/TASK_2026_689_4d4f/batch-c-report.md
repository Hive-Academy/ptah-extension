# Batch C report

## Files created

- `libs/frontend/command-center/src/lib/scene/connector-geometry.ts`
- `libs/frontend/command-center/src/lib/scene/connector-geometry.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-connectors.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-connectors.component.css`
- `libs/frontend/command-center/src/lib/scene/command-connectors.component.spec.ts`

## Acceptance evidence

- The fixed snapshot contract is in `connector-geometry.ts:2-20`: stage, stream viewport and content boxes, keyed visible rows, dial, root button, and four keyed cards, all using stage-local `Rect` values.
- `connector-geometry.ts:104-137` clears paths for absent geometry and widths below 340px, omits rows outside the measured viewport/content box, routes wide gold curves and compact gutter curves, and creates four card-aware ribbon paths. `connector-geometry.ts:58-102` finds an unobstructed route around foreign card rectangles and rounds its corners.
- `connector-geometry.spec.ts:41-63` covers 1440/1100/900/400/340px snapshots, distinct ribbon starts, no foreign-card segment intersections, clipped row omission, and the below-340px fallback.
- `command-connectors.component.ts:5-49` is standalone and OnPush, computes paths from an input snapshot, and renders one `aria-hidden`, nonfocusable SVG with static gradients. It owns no observer or scheduler. `command-connectors.component.css:1-32` makes the SVG pointer-inert and assigns the connector layer `z-index: 0`; the consuming facade must place cards on a higher layer. `command-connectors.component.spec.ts:21-37` checks the supplied snapshot's path count, no focusable element, pointer behavior, and stacking value.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Represent keyed rows as `Readonly<Record<string, Rect>>` and cards as a four-key record. | Arrays of entries or keyed records. | The plan requires visible keyed row rectangles and four keyed card rectangles, with IDs read from DOM attributes. Records preserve those keys without selector interpolation. | Yes, before D1 uses the type. |
| Route ribbons on a small visibility grid when a direct path would intersect another card. | Prototype's fixed Bezier offsets or card-aware rectilinear paths with rounded corners. | Mandatory fix M-R4 requires geometrically clear paths, including compact and stacked layouts; prototype offsets can cross adjacent cards. | Yes. |

## Not done

- Did not run Nx, Jest, TypeScript CLI, build, or visual checks as instructed. Scoped `ptah_get_diagnostics` found no diagnostics in the four new TypeScript files; it reported 29 errors in unrelated sibling spec files, which this batch does not own.
- Did not wire the component into the scene. Batch D2 must set the status-card layer above the connector host's `z-index: 0` in every container mode and consume the `SceneGeometry` property names listed above.

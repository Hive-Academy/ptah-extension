# Batch D1 report

## Files created

- `libs/frontend/command-center/src/lib/scene/scene-measurement.ts`
- `libs/frontend/command-center/src/lib/scene/scene-measurement.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay-placement.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay-placement.spec.ts`

## Exported API for D2

- `buildSceneGeometry(measurement: SceneMeasurement): SceneGeometry` converts supplied client rectangles into a stage-local snapshot. `SceneMeasurement` includes `streamClientWidth` and both horizontal padding values.
- `EMPTY_PLATE_RESERVATION: PlateReservation` is the zero reservation for preview and all close paths.
- `choosePlateMode(availableHeight: number, previous?: PlateMode | null): PlateMode` chooses or latches the inline/external mode.
- `placePinnedPlate(geometry: SceneGeometry, pinnedId: string, anchorKind: 'stream' | 'root', naturalPlateHeight: number, previousMode?: PlateMode | null): PinnedPlatePlacement | null` returns plate rectangle, internal-scroll flag and reservation. Pass the unreserved geometry and the previous mode only on a real resize.
- `findHoverPreviewPlacement(geometry: SceneGeometry, anchorId: string, previewHeight: number, rail?: Rect | null, anchorKind?: 'stream' | 'root'): Rect | null` returns a safe preview rectangle or suppresses it.
- Types: `PlateReservation`, `PlateMode`, `PinnedPlatePlacement`, `SceneMeasurement`.

## Acceptance evidence

- Content widths 241/248/315/255px: `scene-measurement.ts:29-35`, `scene-measurement.spec.ts:25-32`. Client width already excludes the scrollbar; only horizontal padding is subtracted.
- Plate width never exceeds `min(256, contentWidth)` and stream attachment gap is 8px: `command-overlay-placement.ts:45-47,67-72`; `command-overlay-placement.spec.ts:22-28`.
- Four-row 153px inline cap and internal scroll; three-row 109px external mode with `plateHeight + 56` reserve: `command-overlay-placement.ts:61-81`; `command-overlay-placement.spec.ts:30-40`.
- Root pin uses a bounded slot directly below the dial in every layout: `command-overlay-placement.ts:48-58`; `command-overlay-placement.spec.ts:42-49`.
- Hover preview has zero reservation, rejects any row/dial/card/rail intersection, changes anchor with the next row, and tries the 93px candidate at 1440: `command-overlay-placement.ts:85-100`; `command-overlay-placement.spec.ts:61-77`. D2 owns the 150ms timer and next-row state switch.
- Stacked widths below 960px suppress visual preview: `command-overlay-placement.ts:88`; `command-overlay-placement.spec.ts:79-81`.
- 16px mode hysteresis: `command-overlay-placement.ts:27-31`; `command-overlay-placement.spec.ts:51-58`.
- Close/Escape/outside click/selection change can synchronously emit `EMPTY_PLATE_RESERVATION`; the interaction wiring belongs to D2: `command-overlay-placement.ts:21-23`.

## Decisions

- Measurement accepts client rectangles, client width and computed horizontal padding. This keeps the helper pure while letting D2 perform the single DOM read. Alternative: accept elements and call DOM APIs here. Evidence: fixed `SceneGeometry` contract and plan section 5. Reversible: yes.
- For a root pin, clamp the plate within the dial width and the stage height while keeping its top 8px below the dial. Alternative: use unbounded natural height. Evidence: plan section 4 requires a bounded below-dial slot. Reversible: yes.
- The preview tries above the stream section, then the measured stream-to-dial side gap, then below; every candidate must clear all supplied obstacles. Alternative: clamp an overlapping rectangle. Evidence: plan section 4 explicitly rejects overlapping candidates. Reversible: yes.

## Verification and limits

No Nx, Jest, TypeScript CLI, build or git command was run, as instructed. `ptah_get_diagnostics` scoped to the four new files reported no diagnostics in those files and 29 sibling-file errors outside D1 ownership. The orchestrator owns the scoped checks. D2 still must wire close paths, timers, selection changes and rendering to these pure functions.

## Fix round 1

- Cause: the 40px preview fit safely above the stream section at `y=26`; the test expected the side candidate at `y=80`, although the approved plan says to prefer above.
- Wrong side: the test fixture, not `findHoverPreviewPlacement`.
- Change: `components/command-overlay-placement.spec.ts:68-73` now supplies a rail rectangle blocking the above candidate so the side candidate proves that first-row and second-row anchors yield `y=80` and `y=130`. The same test still rejects a fully blocked placement and a missing row.
- Test result: the single permitted Jest command was attempted, but PowerShell could not resolve `tail`; the pipeline exited before returning Jest output. No second run was made. The orchestrator must rerun the scoped spec.

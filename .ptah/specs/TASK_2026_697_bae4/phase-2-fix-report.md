# Phase 2 fix report

| Finding | Result and source | Regression test |
| --- | --- | --- |
| 1. Root leader inherits link stroke | Fixed: `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:371` sets theme stroke and line width for the leader. | `scene/command-scene-renderer.spec.ts:165` |
| 2. Zero-size backdrop | Fixed: `scene/command-scene-renderer.ts:220,309` skips creation and blit for an empty backdrop. | `scene/command-scene-renderer.spec.ts:196` |
| 3. Raw child stats and lost estimate | Fixed: `components/command-center-page.component.ts:468-480` carries provisional state, omits provisional zero messages and nonfinite figures; `components/command-node-detail.component.ts:101-122` formats tokens and cost with chat-ui helpers and marks estimates. | `components/command-center-page.component.spec.ts:255`; `components/command-node-detail.component.spec.ts:45` |
| 4. Old DPR halo entries | Fixed: `scene/sprite-cache.ts:258-264` releases the previous halo before caching a new key. | `scene/sprite-cache.spec.ts:33` |
| 5. Retained offscreen backing stores | Fixed: `scene/command-scene-renderer.ts:182-186,214-219` releases discarded backdrops; `scene/sprite-cache.ts:60-84,258-264` releases pruned sprites and replaced halos. | Covered by renderer zero-size test and halo DPR test above. |
| 6. Duplicate phase count | Fixed: `components/command-node-detail.component.ts:23` owns `phaseCountOf`; page `:489` and overlay `:210` call it. | Existing page and overlay specs; project test suite passed. |
| 7. Invalid time and ring tone | Fixed invalid time: `components/command-center-start.component.ts:146,252` says “No recent activity” in visible and accessible names. Kept ring warning tone intentionally; decision below. | `components/command-center-start.component.spec.ts:110-112`; existing `chat-ui/src/lib/atoms/context-ring.component.spec.ts` covers semantic tone. |

## Checks

- Focused changed command-center specs: **5 suites, 62 tests passed**.
- ESLint on all 11 changed source/spec files: **passed**.
- Requested `nx run-many -t typecheck,test -p command-center chat-ui --parallel=1 --output-style=static -- --maxWorkers=2`: tests passed (**command-center 45 suites/485 tests; chat-ui 76 suites/1437 tests**); combined command exited 1 because Nx forwarded `--maxWorkers=2` to both `ngc` typecheck targets, which reject it with **TS5023**.
- Separate `nx typecheck command-center --parallel=1` and `nx typecheck chat-ui --parallel=1`: **both passed**. The command-center typecheck emitted pre-existing NG8107 warnings in unrelated files.
- `ptah_get_diagnostics` was unavailable after its 45-second timeout; the successful Nx typechecks supply compiler verification.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep the ring’s explicit warning tone at 95% and above | Could add an error tone, but the command-center chip uses the same warning threshold from 70% upward (`command-center-page.component.ts:496-499`), and the review explicitly accepts documenting this consistency. The ring’s legacy 80/95 thresholds remain for callers without a tone. | Yes; add an error tone and update the chip together if the product severity rule changes. |
| Use one cached voice halo for the current key | Retain entries per DPR or replace on key change; a scene uses one theme, palette and DPR at a time, so replacement bounds retained backing stores. | Yes. |

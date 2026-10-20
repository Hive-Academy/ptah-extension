# Batch 1 fix report

| Finding | Status | Location | Why |
| --- | --- | --- | --- |
| 1 | Fixed | `command-scene-renderer.spec.ts:930`, `:964` | Reduced motion now receives a live transition after an idle seed; the false-to-true case resumes non-reduced rendering at 1048 and checks that no pulse survived. |
| 2 | Fixed | `command-scene-renderer.spec.ts:1007` | A pulse is verified live before hiding, then checked absent after resume at 1100. |
| 3 | Fixed | `command-scene-pulses.ts:28`, `:93` | Tethers are grouped by `fromId` once per observation and supplied to `linkFor`; owner matching and missing-link behavior remain the same. |
| 4 | Accepted, unchanged | `command-scene-pulses.ts` | The approved plan permits a queued pulse after the worker returns idle or re-enters the layout. |
| 5 | Fixed | `command-scene-pulses.ts:176` | Draw statements are on separate lines. Prettier ran on exactly the seven requested scene files; its formatting of untouched renderer and renderer-spec lines was reversed by hand. |
| 6 | Fixed | `command-scene-pulses.spec.ts:116` | The midpoint test asserts the head arc at `(60, 50)` at 360 ms, halfway between owner and worker on the bezier. |

## Decisions

- Kept the original hidden-delegation test and added a separate in-flight clear test so both paths stay covered.
- Retained the review's accepted behavior for finding 4.
- No tests, builds, type checks, or lint commands were run, as instructed. Verification was static inspection and read-only Git diff/status.

## Left undone

None within this fix round. The orchestrator will run checks.

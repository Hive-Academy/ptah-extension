# M1 fix review round 1

## Changes by finding

4. `libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts:233` adds a regression test that queues `afterTransition()`, dispatches `pointerdown` to trigger the input skip, then verifies the callback runs exactly once after `finished` settles.
5. `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:39,343-373,421-437,741-743` records why attribution is unknown, writes each new unknown task over 50 ms when M0 max is at most 50 ms to top-level `longTaskNeedsReview` with `name`, `maxMs`, `m0MaxMs`, and `reason`, and emits the specified soft-assert failure per row. Motion tasks retain their existing gate; render tasks remain report-only under U2.
6. `nav-session-motion.perf.spec.ts:368-370` expands motion matching to all requested view/component symbols and source file names using both function name and URL. Empty and anonymous function names cannot establish `render` attribution.
7. `nav-session-motion.perf.spec.ts:732-751` aligns the edited assertion block with surrounding indentation.

## Checks

| Check | Result |
| --- | --- |
| Targeted `surface-view-transitions.spec.ts` Jest command | PASS: 1 suite, 21 tests |
| `npx nx typecheck ptah-electron-e2e --parallel=1` | PASS |
| `npx nx lint ptah-electron-e2e --parallel=1` | PASS: 0 errors, 17 warnings |
| `npx nx lint core --parallel=1` | PASS: 0 errors, 14 warnings |
| Scoped `ptah_get_diagnostics` after edits | No diagnostics in changed files; compiler reported errors in sibling `core` specs outside this batch |

Nx Cloud reported disabled organization code 401 after successful local targets. No Electron, Playwright, build, serve, or e2e run was made. Runtime trace classification and click delivery remain for the separate Electron re-run; product findings 1-3 were untouched.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat a task as `render` only with a meaningful named function frame unless a function name or URL matches a motion symbol. | Count any frame as render; require a named frame. | Review finding 5 identifies empty-frame attribution as a silent gate; finding 6 requires URL matching. | Yes |
| Fail softly and report unknown tasks only when their duration exceeds 50 ms and the matched M0 row has max at most 50 ms. | Apply the motion threshold to unknown tasks; use the specified M0 condition. | User's exact criterion for a NEW task and U2's render report-only decision. | Yes |

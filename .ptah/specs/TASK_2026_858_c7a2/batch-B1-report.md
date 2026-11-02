# Batch B1 report

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts` — replaced the unused viewport selector with `planEntrance`, `ENTRANCE_CAP = 6`, and exported `isStrictHeadPrepend`. The planner follows the approved suppression, prepend, replay, pinning, and mounted-tail ordering rules.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts` — covers the open batch cap, append, unchanged streaming ids, prepend, unpinned append, replay open/later batches, suppression and replay hold, replacement, custom cap, empty input, and strict prepend cases.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-prepend-anchor.directive.ts` — imports the shared strict prepend helper and removes its local copy; no other behavior changed.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.ts` — adds the standalone signal-input directive. `ngOnChanges` diffs ids before Angular reconciles children, preserves existing entrance indexes, evicts removed ids, marks old DOM inert/hidden/leaving, and cuts replacement, suppressed, oversized, and offscreen leaves. No timers, observers, or listeners. 84 lines.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.spec.ts` — exercises directive output, stable indexes, activation, replay, hold, leave marks, and each leave-cut case with mocked rects. It checks directive output rather than Angular's enter class, which jsdom cannot apply.

## Verification

- Header: `npm run verify -- -p @ptah-extension/chat` (`lint,test,typecheck`, project `@ptah-extension/chat`).
- First run: `NX 3 tasks: 2 succeeded, 1 failed`; the directive test queried an attribute that Angular does not place in the DOM for the property binding. Changed the test host to use a static `data-testid` selector.
- Rerun summary: `NX 3 tasks: 3 succeeded` (exit code 0).
- `ptah_get_diagnostics` after the fix: no diagnostics in the five requested files. Its broader sibling scan reported 274 errors outside B1; the scoped verify passed.
- Repository TypeScript search: no remaining `selectVisibleEntrance` consumer.

## Decisions

- **Shared prepend input:** Accept string ids and `{ id }` identities in `isStrictHeadPrepend`. Options were to map ids into objects for the planner or to accept both shapes. The anchor already passes objects, while the approved planner passes string arrays. The same strict suffix comparison remains in one helper. Reversible.
- **Replacement leaves:** Treat a no-overlap pass with a nonempty next list as replacement. Options were to also classify clearing to an empty list as replacement or let ordinary removal rules govern it. The plan defines replacement as a new batch, and an empty transcript is a clear rather than a batch. Reversible.
- **Test host selector:** Use a static `data-testid` on the host. Angular does not retain the directive's bound attribute in the rendered DOM; the first verify run exposed that. Reversible.

## Not done

- B2 wiring, CSS, and B3 e2e files are outside this batch. A rendered visual check needs that wiring and is scheduled by the approved plan after B1-B3.
- The host listed no skill-loading tool, so `angular-frontend-patterns` could not be loaded. Implementation follows the explicit Angular guidance and nearby directive pattern.

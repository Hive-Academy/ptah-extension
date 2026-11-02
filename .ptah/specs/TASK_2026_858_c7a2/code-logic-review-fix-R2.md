# Code Logic Review, fix R2

Review family: claude vs codex

Verdict: APPROVED
Score: 8/10

Scope read: the full diff of the 6 files, `transcript-entrance.ts`, `transcript-motion.directive.ts`, the replay-hold effect (`chat-transcript.component.ts:1218-1239`), `motionSuppressed` (:449-453), the render-window effect (:1296-1320), and the new component spec. Verification was not re-run.

## Trace of the change

- `planEntrance` early return (`transcript-entrance.ts:56`): `!openBatch && (replaying || replayMotionHold || !pinned)`. Suppression is unchanged for non-open rows. Open batches now pass during the hold.
- `isFinalizingTransition()` still feeds `suppressed` (html:9), so the finalize burst is still cut unconditionally. The directive also forces `cutAll` on `suppressed` for leavers (directive:77), as before.
- Tail swap, strict head prepend and "no added rows" all return before the open-batch check (`transcript-entrance.ts:47-54`). A stream-to-final swap or an older-history prepend therefore cannot reach the new path.
- Reduced motion is not in this path. It is handled in CSS or by the cap, and this diff does not touch it.
- Cap 6 is applied by `nextIds.slice(-cap)` (:60). Step and max delay are not modified.

## Findings

1. Minor, `transcript-entrance.ts:55`: during the hold, the open-batch test is purely structural (`previousIds` empty, or no id shared). The cases you asked about:
   - A session switch or sub-agent view change inside the same component, with a disjoint id set, staggers. That is a legitimate open and matches the intent.
   - A reset to `[]` followed by a refill within 300 ms makes `previousIds` empty again. Rows that already animated re-animate, because the directive drops entries for ids that left (`directive.ts:56-58`). This is the only double-animation path I found. It needs a clear-and-reload of the same session within the hold. I did not find a code path that does this on open or replay, so it is theoretical. The rule is also unchanged outside the hold.
   - A full replace with a partial overlap is not open, so it stays suppressed. Good.
   - The render window works on the same stable slot ids, so a window shift does not make ids disjoint.
2. Minor, coverage: nothing covers a disjoint-id switch during the hold, or a clear-and-refill during the hold. The component spec covers the 30-row open batch followed by a suppressed append (`chat-transcript.stagger.spec.ts:185-207`). The planner and directive specs cover the first-batch and later-row split during the hold. Add one case for each of the two gaps above.
3. Minor, `chat-transcript.component.ts:449-453`: `motionSuppressed` still ORs `replayMotionHold`. It feeds the bubbles' own keyframe suppression, not row entrance, so it is correct. Keep it from being "simplified" later, because it is what holds nested keyframes inside the freshly entered rows.

No Blocking, Serious or Moderate findings.

## Regression checklist

| Item | Result |
| --- | --- |
| Every session open or history load staggers its first rows | Fixed. The open batch is exempt from the hold. |
| Finalize burst suppression | Unchanged. `suppressed` input is intact. |
| Streaming chunks never re-animate | Unchanged. Existing ids are not in `added`. |
| Stream-to-final tail swap | Unchanged. `isTailSwap` returns first. |
| Older-history prepend | Unchanged. `isStrictHeadPrepend` returns first. |
| Return to an already-loaded tab | Unchanged. The activation catch-up check happens in the directive before `planEntrance`. |
| Replay hold's purpose (non-open rows in the replay-to-loaded gap) | Preserved. Non-open rows are still suppressed during the hold. |

Residual uncertainty: the runtime behaviour of the `ptah-pane-switch-pending` pause was taken from the report and the new spec, not observed. The visual-reviewer can confirm it on the 18/30-row session.

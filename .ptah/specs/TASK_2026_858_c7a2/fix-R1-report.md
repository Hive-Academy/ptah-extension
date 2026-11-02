# Fix R1 report

## Root cause

Defect 1: the streaming assistant slot is keyed from `tree.id` in `chat-transcript.component.ts:529` and `stream-presentation-store.service.ts:273`, but finalized slots are keyed from the finalized `message.id` (`chat-transcript.component.ts:608`, `stream-presentation-store.service.ts:199`). The store creates slots under each observed message ID. When these IDs differ, Angular removes the streaming wrapper and creates a finalized wrapper in the same pass. The old planner treated the latter as an append, so it entered again while the old wrapper ran a timed leave.

Defect 2: `chat-transcript.component.html` suppressed all rows while `paneSwitching()` or `entering()` was true, and `TranscriptMotionDirective` also suppressed the first active pass. This covered the first history batch on a tab edge.

## Fixes

- `isTailSwap` recognizes a contiguous, equal-count replacement of tail IDs after a shared prefix. Such added rows receive no enter entry; the directive cuts the removed rows immediately. Rewind-only removals and ordinary appends keep their existing behavior.
- Open batches can now stagger during a tab edge, including the first replay batch. Activation catch-up remains suppressed when rows already exist. The pending scroller class pauses the row animation until the entering phase begins.
- Incoming pane motion is an opacity-only crossfade. Row motion retains the active preset and six-row, 180 ms stagger cap. The existing glass row enter, cut leave, reduced-motion near-zero duration, and class-based leave remain intact.
- Unit coverage checks swap planning and cut leave, open batches on activation and tab edges, pending state, loaded-tab reuse, replay and prepend behavior, and the pane CSS contract.

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.stagger.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts`

## Verification

First `npm run verify -- -p @ptah-extension/chat`: lint and typecheck passed; 2 of 5,749 tests failed on outdated assertions. The assertions were corrected.

Final permitted rerun: lint and typecheck passed; 1 of 5,749 tests failed. The failing loaded-tab test queried `data-tab-id` on its stub, which did not render that attribute. After the run, the test was corrected to query the stub directly and to retain rows across tab switches. The final test-only correction was **not rerun** because the task permits at most two verify runs. Overall verification is therefore **not green**.

`ptah_get_diagnostics` was attempted after edits, including the last test correction; its TypeScript check exceeded the tool's 45-second window and returned unchecked. The verify typecheck supplied type evidence for the code before the last test correction. The Angular skill loader was unavailable; its optional skill search returned no matching skill.

## Decisions

- Tail swap versus changing the ID in the presentation store: kept the upstream IDs because `tree.id` and finalized `message.id` come from different records and have no proven safe one-to-one identity mapping. The local swap rule is reversible and follows the requested same-position tail condition.
- Pending animation timing: paused with the scroller's pending class. This preserves the entrance plan made before Angular reconciles the rows and resumes the same animation when `entering` begins; it avoids replaying or scheduling a second batch.
- Loaded-tab return: reuse the existing row node and show the pane crossfade. The directive's stored index is not a new enter; Angular's enter binding runs only on creation.

## Not done

No fresh Electron visual run: the task prohibits build, serve and e2e, and the reviewed bundle predates these edits. The real-Electron visual reviewer should check the two repaired flows against the prior captures. The final test-only change also needs a future chat verify run.

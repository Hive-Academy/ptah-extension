# Chat transcript stagger: round 2 fix

## Root cause

The 300 ms `replayMotionHold` starts when `historyReplaying` falls in `chat-transcript.component.ts:1218-1239`. The transcript template previously combined it with `isFinalizingTransition()` in `[suppressed]`. `TranscriptMotionDirective.ngOnChanges` passed that boolean to `planEntrance`, which returns before its open-batch check when suppressed. For long history replays whose first rows reconcile in the replay-to-loaded gap, all rows therefore missed the entrance. Short sessions that arrived while `historyReplaying` was still true escaped the hold. The raw `historyReplaying` planner input already permits the first batch and suppresses later replay pages. A pane pending class pauses planned row animations until the pane entrance starts.

## Fix

Pass the replay hold separately to the directive and planner. The hold now suppresses rows only when they are not the open batch (prior ids empty or no ids shared). Keep `isFinalizingTransition()` as unconditional suppression. A 30-row after-replay test checks six tail indexes, the pending pane class, and a later suppressed append. Pure-planner and directive tests cover first-batch and later-row behavior during the hold.

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.stagger.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts`

## Verification

`npm run verify -- -p @ptah-extension/chat` passed on the first run (exit code 0): Nx reported 3/3 tasks succeeded (lint, test, typecheck). The run took 7m 58s, including 127s waiting for a verification slot. Ptah scoped diagnostics separately timed out after 45 seconds and reported five TypeScript files unchecked; the completed chat typecheck covers them.

## Decisions

- **Narrow the replay hold inside the planner.** Options were dropping the hold or separating it from finalization suppression. The review and existing planner semantics show that the hold protects non-open rows in the replay-to-loaded gap. Separating the inputs preserves that protection and the finalization guard. Reversible.
- **Retain the pending pane pause.** The existing `.ptah-pane-switch-pending` rule pauses row keyframes until the incoming pane starts, while its crossfade stays opacity only. No CSS change needed. Reversible.

## Not done

No real Electron visual review in this lane; the supplied round 2 review is the visual evidence for the defect. The Angular skill loader was unavailable in this host; implementation followed the repository's supplied Angular rules and nearby patterns.

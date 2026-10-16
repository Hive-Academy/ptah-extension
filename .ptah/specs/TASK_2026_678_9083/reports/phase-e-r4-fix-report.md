# Phase E round 4 fix report

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` — made the bounded rail the single two-column scroller and scrolls a newly identified pending card into view after render.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` — verifies the CSS source and the one-time pending-card scroll.
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts` — sets playback-end HUD state based on pending input and active turn state.
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts` — covers pending prompt, status speech, and barge-in states, and completes the existing store fakes.

## CSS before and after

Before, `.rail` had `max-height: clamp(420px, calc(100vh - 280px), 620px); overflow: hidden;`. `.work-list-region` had `min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;`.

After, `.rail` has `max-height: clamp(420px, calc(100vh - 280px), 620px); overflow-y: auto; overscroll-behavior: contain;`. `.work-list-region` has `min-height: 0; flex: none;` with no own scrolling. The stacked layout override remains `max-height: none; overflow: visible;` for the rail and `flex: none; max-height: 24rem;` for the work list.

## Voice-loop rule before and after

Before, playback ending set `listening` and reset levels only when `!playback.hasPending && !busy && !awaitingBoundary`; otherwise it left the current state unchanged.

After, playback ending does nothing when clips remain. With no clips, it sets `listening` and resets levels if `pendingInput() !== null` or the turn is neither busy nor awaiting a boundary. Otherwise it sets `thinking`. The inactive or muted early return remains.

## Tests and verification

- Added a CSS test that reads the component's source style text because jsdom did not expose the component CSS through the rendered `<style>` query. It asserts the rail cap and scrolling and the work list's lack of its own scroller.
- Added a pending-card test that waits for Angular render completion and checks one `scrollIntoView({ block: 'nearest' })` call for a new id, with no repeat for the same id.
- Added playback tests for a pending prompt while awaiting a boundary (`listening`), status speech during an active turn without pending input (`thinking`), and barge-in during a busy turn with pending input (`listening`). The existing completed-reply test still verifies `listening`.
- Scoped Jest result: **Tests: 43 passed, 43 total**; **Test Suites: 2 passed, 2 total**. `git diff --check` found no whitespace errors in the changed code.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Scroll the whole bounded rail and keep the work list unbounded within it. | Scroll the rail or add separate card/reply scrollers. | The pending action row and latest reply were clipped by rail `overflow: hidden`; the cap still protects the dock position. | Yes, CSS-only. |
| Track the pending input id together with the roster proposal id and scroll after render. | Track one id or both ids. | Either change can reveal new actions while the other id remains stable; the pending host is always in the template. | Yes. |
| Read CSS from the component source in the spec. | Read rendered style tags or computed styles. | jsdom did not expose the component CSS in the rendered `<style>` query; container-query computation is not reliable there. | Yes. |
| Use pending input to choose `listening` when speech stops mid-turn. | Preserve the prior state or set `thinking` for every busy turn. | A pending card requires an answer and no clip remains; active turns without pending input still indicate thinking. | Yes. |

## Anything not done

- Did not run the full command-center test, typecheck, lint, build, or e2e; the orchestrator owns those checks.
- The requested `tail -40` pipe was unavailable in PowerShell, so the same Jest invocation used `Select-Object -Last 40` for filtered output.
- Existing unrelated workspace changes in `batches.md` and `HANDOFF.md` were not made or altered by this fix.

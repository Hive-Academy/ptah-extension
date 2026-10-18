# Phase D style fix, lane B

## Findings

| Finding | Change | Verification case |
| --- | --- | --- |
| S1 | Wired HUD error, abortability, interrupt, and settings navigation; passed question choices and roster timeout to the card in `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:119-131`. Removed the unavailable Resume control in `command-session-controls.component.ts:24` and unused overlay pin outputs in `command-overlay.component.ts:129`. | Existing page wiring cases in `command-center-page.component.spec.ts:110`; approval and roster display in `command-center-page.controller.spec.ts:537`. |
| S2 | Controller now feeds the store from core `ThemeService.isDarkMode` and the OS motion query in `command-center-page.controller.ts:183-192`. | Broad Command Center Jest suite passed; no dedicated theme assertion added. |
| M2 | Work list owns focus in `command-work-list.component.ts:84`; overlay exposes readonly IDs and `closeCard()` in `command-overlay.component.ts:130,274`; page measures after render in `command-center-page.component.ts:179` and calls `focusRow()` at line 203. | Existing overlay and page focus cases in `command-overlay.component.spec.ts:126` and `command-center-page.component.spec.ts:131`. |
| M4 | Shared request tag in `libs/frontend/chat-state/src/lib/command-center-persona.ts:4`, exported at `libs/frontend/chat-state/src/index.ts:75`, and used by the controller at `command-center-page.controller.ts:402`. Roster tag in `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts:12,108`, also used by the controller at lines 93 and 218. | Existing roster parser and controller cases in `tribunal-roster-proposal.spec.ts:1` and `command-center-page.controller.spec.ts:537`. |
| M5 | Playback failure carries `action: 'retry-speech'` in `command-voice-loop.ts:141`; page button reads the action in `command-center-page.component.ts:103`. | Broad Jest suite passed. |
| M9 | `sendTranscript` is required in `command-voice-loop.ts:21`; `beginAwaitingTurn()` is shared at line 424; `onTurnBoundary` requires a token and has the correct JSDoc at line 431. | Token cases in `command-voice-loop.spec.ts:9,24,43`; all constructors updated. |
| F1 | Mute, stop, and exit clear controller FIFO in `command-center-page.controller.ts:335,342,439`; loop shutdown callback and typed queue reset in `command-voice-loop.ts:529-574`; failed or empty terminal pulses abandon the head in `command-center-page.controller.ts:285-298`. | `clears armed turns on %s` in `command-center-page.controller.spec.ts:155`; `abandons a failed pulse so the next typed reply uses its own token` at line 256; `clears a queued typed turn on mute and does not arm it on restart` in `command-voice-loop.spec.ts:86`. |
| F2 | Roster timeout runs only while its card is shown in `command-center-page.controller.ts:255-263`; timeout reports a toast at line 426. | `keeps approval shown when a roster arrives and shows roster after permission resolves` in `command-center-page.controller.spec.ts:537`, with timer checks at lines 557 and 567. |
| F3 | Typed turns queue while the voice loop is busy in `command-voice-loop.ts:416-421`. | `queues typed input during transcription and arms it after the voice reply` in `command-voice-loop.spec.ts:64`. |
| F4 | Display effect sets pending roster only when the roster is shown in `command-center-page.controller.ts:255-257`; loop setter at `command-voice-loop.ts:480`. | `only guards speech as a roster while the roster card is shown` in `command-voice-loop.spec.ts:102`; approval overlay assertion in controller spec at line 558. |

## Verification

- Command Center Jest final run: `Test Suites: 31 passed, 31 total`; `Tests: 217 passed, 217 total`.
- Chat State Jest was not run because the five-run Jest ceiling was reached.
- `npx eslint` on all changed source and specs: exit 0.
- `npx prettier --write` and `--check` on changed files: check reported `All matched files use Prettier code style!`. The final one-file adjustment was formatted and linted afterward.
- The one permitted `tsc --noEmit` run produced `command-work-list.component.ts(88,7): error TS2347: Untyped function calls may not accept type arguments.` The `ElementRef` declaration was corrected to `ElementRef<HTMLElement>` afterward at `command-work-list.component.ts:79`. A second type check was prohibited, so compile success remains unverified.

## Degradation audit

No catch block was changed. Existing catches in the touched files are: voice loop lines 102 and 116 rethrow; line 190 reports voice start failure; line 235 reports capture failure; line 403 reports transcription failure; controller line 325 reports provider unavailability; parser line 114 rejects invalid JSON for caller reporting. All remain classified as rethrow or reported degradation.

## Decisions

- Removed Resume because the coordinator exposes no resumable-record signal to the page; its `openOrResume()` already handles a saved session on entry.
- Kept store `reducedMotion` and fed it from the same OS media query used by the scene. The scene still registers its own listener; both use the same source value.
- Required `sendTranscript` so every loop has an explicit send path. Test loops provide their own send callbacks.
- The controller is now about 455 lines. Extracting the roster flow into a separate provider remains undone. This exceeds the requested size guideline.
- The queued typed-turn fix covers the transcription window at the loop boundary. There is no pulse-to-send identifier in the terminal pulse, so an independently completed typed pulse before the voice pulse cannot be proven to correlate correctly. This ordering risk remains.

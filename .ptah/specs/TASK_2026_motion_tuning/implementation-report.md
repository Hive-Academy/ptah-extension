# Motion tuning implementation report

## Changes

- `apps/ptah-extension-webview/src/styles.css:43-46,816-827`: tuned the four shared motion tokens and gave the root view-transition snapshot an 18 px rise during its 380 ms crossfade.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1-30`: raised pane entrance from 12 to 18 px and tied the outgoing fade to `--ptah-motion-out`. The outgoing pane remains above the incoming pane during the overlap.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:156-162`: lengthened the entrance and leave cleanup windows to cover the CSS durations with margin.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.css:104-134`: moved banner and fade animations to the existing in/out tokens; the inspector row stagger continues using the existing step token.
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:169-257`: updated window assertions for the new timing.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts:78-113,122-128,229-259` and `session-inspector.component.html:162-182`: kept prior stats mounted during a session-ID change, animated a rise on the stats component and faded only metric cells that contain no glass surface. The old copy is inert and hidden from assistive technology. The 420 ms cleanup timer is cleared on destroy. Same-session stats updates and a tab change retaining the same session ID do not restart the animation. Reduced motion hides the old copy and removes the animations.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.spec.ts:249`: added regression coverage for initial render, same-session stats updates, same-session tab change, session-ID switch, overlap, and cleanup.

## Timing constants

| Location | Old | New |
| --- | ---: | ---: |
| `--ptah-motion-out` | 120 ms | 180 ms |
| `--ptah-motion-in` | 200 ms | 320 ms |
| `--ptah-motion-switch` | 260 ms | 380 ms |
| `--ptah-stagger-step` | 28 ms | 36 ms |
| transcript leave fade | 160 ms | `--ptah-motion-out` (180 ms) |
| chat banner entrance | 260 ms | `--ptah-motion-in` (320 ms) |
| chat banner leave | 180 ms | `--ptah-motion-out` (180 ms) |
| chat generic fade entrance | 240 ms | `--ptah-motion-in` (320 ms) |
| chat generic fade leave | 160 ms | `--ptah-motion-out` (180 ms) |
| `ENTER_WINDOW_MS` | 480 ms | 640 ms (last row ends at 596 ms) |
| `LEAVE_WINDOW_MS` | 200 ms | 220 ms (180 ms fade plus 40 ms) |
| entrance spec endpoint | 480 ms / 479 ms | 640 ms / 639 ms |
| entrance spec remaining segment | 280 ms | 440 ms |
| leave spec endpoint | 200 ms | 220 ms |
| stats switch cleanup | absent | 420 ms (380 ms entrance plus 40 ms) |

## Decisions

- Animate the existing inspector stats section, where the Electron dock renders session statistics. The outer Electron dock has `data-glass-surface`, so its opacity must remain stable. The stats component can rise with transform; only the plain metrics grid cells receive opacity animation. This is reversible within the inspector component.
- Key the stats transition on non-null session IDs. A refreshed stats object and a tab reference that still resolves to the same session ID keep the mounted metrics stable. This is reversible and follows the requested session-only trigger.
- Keep the existing timing token names and eases for the later presets work. The fixed 60 ms stagger lead is unchanged; the last row now ends at `60 + 6 × 36 + 320 = 596` ms, inside the 640 ms cleanup window.

## Verification

- `npm run verify -- -p ptah-extension-webview @ptah-extension/chat`: rejected by the wrapper because project names must be comma-separated; no Nx tasks ran.
- `npm run verify -- -p ptah-extension-webview,@ptah-extension/chat`: initial run **Nx 6 tasks: 5 succeeded, 1 failed**. The only failing test asserted the old 200 ms leave window; 309 suites and 5482 tests passed.
- Same scoped command after updating that assertion: **Nx 6 tasks: 6 succeeded, 2 cached**; exit code 0, run duration 8m 42s.
- Final full scoped rerun after narrowing the stats trigger: **Nx 6 tasks: 5 succeeded, 1 failed**. The sole failure was `chat-transcript.display.spec.ts`, where an existing Electron turn-summary-chip test exceeded Jest's 5 second timeout under the full 310-suite load. The run reported 309 suites and 5482 tests passed; typecheck and lint succeeded. This file is outside the allowed edit scope and was unchanged.
- `npm run verify -- -t test -p @ptah-extension/chat -- '--testPathPatterns=chat-view.session-enter|session-inspector.component'`: **Nx 1 task: 1 succeeded**, exit code 0, 0/1 cached, 12.7 second run. This exercised the changed motion specs against the final code.
- `ptah_get_diagnostics` was requested after both source edit phases. Its TypeScript compiler timed out after 45 seconds and marked TS files unchecked; CSS/HTML are unrecognised by this tool. The full scoped Nx runs completed the compiler target successfully.

## Not done

- A visual screenshot of the final Angular surface has not been captured. The provided browser tool cannot navigate the running Electron instance, and this task forbids launching or building a host.
- A clean final full-suite summary is unavailable because one unrelated existing transcript display test timed out in the final run. The changed specs passed in the focused verify command above.

## Revise round 1

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1-63`: changed transcript entrance and leave to transform-only on the scroller and host. Opacity now animates only direct message-content children with no `[data-glass-surface]` descendant; old glass-bearing children become hidden when overlap starts. The old pane remains visible during a slow history load. The reduced-motion rules disable the added animations without adding `!important`.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:295-359` and `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:63`: bound the overlap class only when the incoming transcript begins its entrance.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:157-162,1093-1130`: replaced the fixed **640 ms** enter window with `max(60 + 6 × stagger step + motion in, motion switch) + 44 ms`, and the fixed **220 ms** leave window with `motion out + 40 ms`. Each reads the current CSS tokens on switch, with 36/320/380/180 ms fallbacks for jsdom. Leave cleanup starts with the incoming entrance, preserving the prior pane while history loads.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts:43-50,238-266`: cleared the saved stats and active transition when stats become null. Replaced the fixed **420 ms** cleanup with `motion switch + 40 ms`, read from computed style with a 380 ms fallback.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.spec.ts:291-331`, `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:259-301`, and `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts:119-123`: covered null stats, dynamic token timing, delayed history overlap, glass-safe selectors and keyframes, and the revised reduced-motion CSS.

### Verification for revision

- First focused command: `npm run verify -- -t test -p @ptah-extension/chat -- '--testPathPatterns=chat-view.session-enter|session-inspector.component'` — **Nx 1 task: 0 succeeded, 1 failed** (2 tests failed because the test stub omitted production leave/overlap bindings; fixed in the stub).
- First full command: `npm run verify -- -p @ptah-extension/chat` — **Nx 3 tasks: 1 succeeded, 2 failed**. The failing test task contained an assertion for the old reduced-motion CSS (updated) and the pre-existing 5-second `chat-transcript.display.spec.ts` timeout. Typecheck failed on concurrent edits to `settings.component.html:105` (`settingsTabIndex` missing and `motionIndex` unknown); that file is outside this lane's scope.
- Corrected focused command: `npm run verify -- -t test -p @ptah-extension/chat -- '--testPathPatterns=chat-view.session-enter|session-inspector.component|chat-transcript.session-enter'` — **Nx 1 task: 1 succeeded**, exit code 0; 0/1 cached, 29.1-second run.
- Final command: `npm run verify -- -p @ptah-extension/chat` — **Nx 3 tasks: 3 succeeded**, exit code 0; 0/3 cached, 8m 38s. This supersedes the earlier round-one Not done note about lacking a clean final full-suite result. No screenshot was captured because this lane was forbidden to build, serve, or launch Electron and had no attached running Electron browser target.

## Revise round 2

- The inspector keeps the last non-null stats snapshot across a null gap. A new session ID starts the switch animation from that snapshot. A return to the same session ID does not start it.
- The chat view starts a token-based safety timer when an old transcript becomes the leaving pane. The timer releases that pane within 1 to 2 seconds if the new tab does not become ready. A null tab ID clears the pending leave at once. The timer is cleared on the next switch and on destroy.
- The session transcript uses the approved preset keyframes. Glass content enters with transform only and exits with a cut. The transcript host has the motion panel marker. Message rows have no new motion classes or wrappers.
- The glass downgrade now runs only under `data-glass='on'`. The markers also exist in other themes. Angular `:host-context` scopes the transform-only entrance, cut exit, and glass fade and scale offsets, so other themes keep the normal preset fade. The CSS spec checks this scope.
- Focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-view|chat-transcript|session-inspector"`: 1 of 1 Nx task passed after the final spec edit.
- Full `npm run verify -- -p @ptah-extension/chat`, first run: 2 of 3 Nx tasks passed. Only an out-of-scope `stdout-visibility.spec.ts` assertion failed; lint and typecheck passed.
- Full command, second run: 2 of 3 Nx tasks passed. Lint and test passed. Typecheck failed on three missing members in B5-owned `provider-setup-wizard.component.ts`. That file is outside this lane's scope. A clean full result needs B5 to finish those members and the full command to run again.
- After the glass scope change, the final focused command passed 1 of 1 Nx task. The final full `npm run verify -- -p @ptah-extension/chat` passed 3 of 3 Nx tasks, exit code 0. This supersedes the prior full run failures.

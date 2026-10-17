# O22 pane motion

## Changes

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:3` binds one entrance class to the transcript scroller for the existing `entering` window while active. The header, composer, tab bar, and rail remain outside this animation.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1` defines the 12px rise and opacity entrance at `var(--ptah-motion-switch)` with backwards fill; line 10 disables it for reduced motion.
- `apps/ptah-extension-webview/src/styles.css:45` sets `--ptah-motion-switch: 260ms` beside the shared motion tokens.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:1045` retains the existing first-frame scroll restore effect. The old `TranscriptSessionEntrance` instance and its lifecycle calls were removed, so streaming updates cannot select or remark message slots or restart the pane class.
- `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:165` probes `ptahPaneSwitchEnter` on the scroller; lines 753-762 check reduced motion and one visible pane entrance in place of the old slot animation assertions.

## Removed and remaining motion

- Removed the switch-time per-message `--i` stagger, `data-enter-i` marks, `ptahTurnEnter` CSS, and the restored-offset `ptahFadeIn` class. The shared `ptahFadeIn` keyframes remain for other native enter animations.
- Remaining active `ptahTurnEnter` uses: none. `transcript-session-entrance.ts` still contains its former marking implementation but has no active caller; that file is outside this batch's edit scope.
- `ChatViewComponent` and its template keep their existing tab-edge `entering` binding and `is-entering` host class. The existing first-session and view-mode exclusions remain unchanged.

## Specs and verification

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts:78` checks pane marking on a switch, stable class and scroller through a streamed message, removal and rearming on return, absence of slot marks, and the reduced-motion CSS rule.
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:169` checks a streamed message does not rearm the 400ms entrance timer; its existing view-mode and first-session test remains at line 159.
- AST parsing of the four edited TypeScript files reported zero syntax errors. Tests, typecheck, lint, build, and diagnostics were not run, as instructed.

## Decisions

- Used the existing `entering` edge as the sole pane-class trigger; this preserves ChatView's tab-switch semantics and avoids a new timer or observer. Reversible.
- Kept the orphaned entrance helper source because it is outside the permitted file scope. It is no longer imported or instantiated, so it cannot apply the old cascade. Reversible cleanup for a later scoped change.
- Used a CSS source assertion for reduced motion because this Jest DOM setup does not expose reliable media-query animation computation. Reversible.

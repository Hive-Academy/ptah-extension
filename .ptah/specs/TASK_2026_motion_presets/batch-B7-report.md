# Batch B7: Session tabs

## Changed files

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css`: use the B1 preset keyframes for the session panel. Keep glass content on a transform-only entrance and a cut exit.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`: mark the transcript host as a motion panel.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`: end an old panel after a token-based safety window if the next tab stays unready; clear it when the tab ID is null.
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts`: cover an unready tab, a null tab ID, and preset CSS.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts` and `.spec.ts`: keep one stats snapshot through a null gap and test the next session switch.

## Design

The session content uses the selected preset without a new stage. The tab has no direction index, so it uses the preset's forward sign. The pane class stays on the transcript scroller. The old transcript starts its exit when the new transcript is ready. A capped safety timer releases it after 1 to 2 seconds if readiness does not arrive. This shows the new tab's loading state. The motion CSS adds no padding to the stage.

## Decisions

- Keep the last inspector stats snapshot through a null interval. A new session can animate from it. The same session does not animate. This is reversible and follows the session ID rule in the tuning code.
- Keep the existing `overlapping` state for the leave animation. It starts the exit when the new pane starts its entrance. This is reversible and keeps the history load behavior.
- Use the B1 `ptahMotionEnter`, `ptahMotionEnterGlass`, and `ptahMotionLeave` keyframes with the existing switch and out duration tokens. This is reversible and follows component 8 of the approved plan.
- Apply the glass downgrade only under `data-glass='on'`. Glass markers stay in the DOM in every theme, so an unscoped selector would remove the normal fade in themes without glass. The transcript CSS uses Angular `:host-context` to read the root state. This is reversible and matches the B1 global rule.

## Needs from B1

None. The approved keyframes and motion variables are present in `apps/ptah-extension-webview/src/styles.css`.

## Verification

- The session CSS spec now checks that the glass entrance, cut exit, and fade and scale glass offsets each require `data-glass='on'`.
- Focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-view|chat-transcript|session-inspector"`: 1 of 1 Nx task passed.
- Full `npm run verify -- -p @ptah-extension/chat`, first run: 2 of 3 Nx tasks passed. Lint and typecheck passed. The test task failed in the out-of-scope `stdout-visibility.spec.ts` (one assertion); 309 of 310 suites and 5,491 tests passed.
- Full command, second run after the final spec edit: 2 of 3 Nx tasks passed. Lint and test passed. Typecheck failed only in B5-owned `provider-setup-wizard.component.ts`, where `leaveSensitivePanel`, `authModeIndex`, and `credentialModeSwitch` are used but not defined. That file is outside this lane's scope and was still being edited by B5.
- Final focused command after the glass scope change: 1 of 1 Nx task passed, exit code 0.
- Final full command after B5 completed its file: 3 of 3 Nx tasks passed, exit code 0, 0 of 3 cached. This supersedes the prior full run failures.

## Limitations

- The Ptah diagnostics service timed out after 45 seconds and marked the changed TypeScript files unchecked. The full verify includes typecheck.
- No skill-loading tool is available in this lane, so the named Angular skill could not be loaded.
- A rendered screenshot is not available. The task forbids build, serve, dev, and Electron launch, and no running UI target was supplied.
- The Ptah diagnostics service reported no error in the changed spec, but it does not inspect CSS. It also reported errors in sibling test files outside this lane's scope. The final full project verify passed.

## Revise round 1

- **Glass cut exit (moderate):** `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:30` now separates `:host-context([data-glass='on'])` from `:host(.ptah-pane-switch-overlap)`. This makes the root glass attribute an ancestor condition while the pane class remains on the transcript host. `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:316` compiles the CSS with Angular `encapsulateStyle` and checks the ancestor-host selector.
- **Inspector preset (minor):** `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts:87-115` now uses shared `ptahMotionEnter` / `ptahMotionLeave` keyframes, inheriting the root preset variables for Fade, Rise, Slide Left, Slide Right, Scale, and Directional. In glass mode it uses `ptahMotionEnterGlass`, adjusts Fade/Scale offsets, and cuts the exit. Reduced motion still disables entrance and hides the leaving stats. `session-inspector.component.spec.ts:69-88` tests shared keyframe use and compiled glass scoping.
- **Compiled selectors asserted:** `[data-glass='on'] .ptah-pane-switch-overlap[_nghost-test]` for the cut exit; `[data-glass='on'] [_nghost-test] .ptah-pane-switch-enter` for glass entry; `[data-glass='on'][data-motion-style='fade'|'scale'] [_nghost-test] .ptah-pane-switch-enter` for glass offsets. Inspector tests assert the same root-ancestor form with `.inspector-stats-enter` and `.inspector-stats-leave`.
- **Verification:** focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-view|chat-transcript|session-inspector"` passed (1/1 Nx task). Full `npm run verify -- -p @ptah-extension/chat` passed (3/3 Nx tasks: lint, test, typecheck). No provider setup exception was needed.
- **Visual check:** no rendered screenshot; the task forbids build, serve, dev, and e2e, and no running UI target was supplied. Angular compiled selector checks cover the encapsulation defect.

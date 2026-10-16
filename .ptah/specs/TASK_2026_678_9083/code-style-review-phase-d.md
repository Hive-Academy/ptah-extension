# Code Style Review, Phase D, TASK_2026_678_9083

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 9 |
| Minor | 10 |
| Reviewer family | Anthropic (in-process) |
| Implementer family | codex |
| Range | `4b7455a36^..59f366c50` (batches 11-17 plus fix commit `dc2751082`), libs, apps, `tsconfig.base.json` |
| Files reviewed | 64 changed files in the diff stat. Read in full or in the relevant region: the three page files at `59f366c50` (via `git show`), `command-center-tribunal.transport.ts`, `command-center-projection.source.ts`, `command-overlay.component.ts` (outline plus ranges), `command-pending-input`, `command-voice-hud`, `command-session-controls`, `command-work-list`, `command-scene.component.ts`, `work-projection.ts`, `discovery.ts` and its spec, the shared-file diffs, and the routing spec diff. |

Reading note: `command-center-page.controller.ts`, `command-center-page.component.ts` and `voice/command-voice-loop.ts` were read at commit `59f366c50`. All other files were read from the worktree. I did not run nx, jest or tsc.

Overall: the boundaries, public API shape and Angular conventions are sound. Barrels, aliases, route guard, DI style, signals, OnPush and explicit modifiers all follow the repo. Production code has no `any`, `as unknown as`, non-null assertions or `text-base-content/NN`. The problems are structural: parts of the page API are wired to nothing and leave dead controls on screen, node identity is carried in string prefixes with no typed contract, and one controller owns too many responsibilities. Three Serious items open, so the verdict is NEEDS_REVISION.

## Five style questions

1. What breaks in six months?
   - Adding a node kind in `work-projection.ts` (for example a new `reviewer:` node) is silently misclassified. Fourteen `startsWith('<kind>:')` sites in scene, sprite and narrator decode the id format (S3).
   - A light DaisyUI theme gets the dark sprite palette because nothing calls `store.setTheme` (S2).
   - A fourth status vocabulary entry will have to be added in three hand-written mappings that already disagree (M3).

2. What would a new team member misread?
   - `CommandVoiceHudComponent` and `CommandSessionControlsComponent` look complete, with "Interrupt speech", "Open Voice settings" and "Resume latest session" buttons. The page binds none of those inputs or outputs (S1).
   - `command-voice-loop.ts:413` carries the JSDoc "Called by the page after the assistant stream and its tool calls settle" on `armTypedTurn`. `onTurnBoundary` lost its doc in the same edit.
   - `discovery.ts` says it keeps the Angular panel out, but it imports `TribunalStateService`'s module for a constant (M7).

3. What does this cost to maintain?
   - `CommandCenterPageController` is 368 lines, with 8 injected collaborators, 2 hand-built objects, 5 effects and the roster state machine (M1).
   - The page reaches into three children (M2), so every child template change is a page change.
   - Each pulse consumer re-implements the `lastTerminalPulseByTab().get(tabId)` plus sequence-number bookkeeping (controller `minPulseSeq`/`deliveredPulseSeq`, transport `boundarySeq`).

4. Where is this inconsistent with how the repo solves the same problem?
   - Non-component injectables (`*.controller.ts`, `*.transport.ts`, `*.source.ts`) sit in `components/`, while the lib's other page-scoped injectables (`command-center.store.ts`, `session-coordinator.ts`) sit in `model/` (m1).
   - `ChatInputComponent` uses `Injector.get(AppStateManager)` where every other dependency in the file is an `inject()` field (M8).
   - The page uses `ngAfterViewChecked` where the lib's own scene uses `afterNextRender` (M2).
   - `integration-harness.ts` is a test helper in the lib compile. Other libs use `*.testing.ts` or a `testing/` folder that `tsconfig.lib.json` excludes (M6).

5. What would I have done differently?
   - Give `CommandWorkNode` a `kind` discriminant, set once in `projectOwnedWork`, and let every consumer switch on it.
   - Split the roster proposal and pulse handling out of the controller into a `CommandCenterRosterFlow` (an injectable beside the transport), and keep the controller as the template-facing facade.
   - Expose `focusRow(index)` on the work list and `closeCard()` on the overlay instead of `document.querySelectorAll` and writable child signals.
   - Wire or delete every input and output the page does not use.

## Blocking issues

None.

## Serious issues

### S1. Half-wired child components leave dead controls on screen

- Files: `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:115-122,146-152` (template, at `59f366c50`), `command-voice-hud.component.ts:17-90,98-106`, `command-session-controls.component.ts:76`, `command-pending-input.component.ts:161-162`, `command-overlay.component.ts:128-129`.
- Problem: the page template binds only `voiceState`, `provider` and `muted` on the HUD, and only `sessionStatus` on session controls. Nothing in `libs/frontend/command-center/src` outside those components and specs binds the following:
  - HUD `errorKind`, `turnAbortable`, `(interrupt)`, `(openVoiceSettings)`
  - session controls `canResume`
  - pending input `choices`, `timedOut`
  - overlay `pinNode`, `unpinNode`
- Impact (user visible): the HUD renders "Open Voice settings" whenever `!provider().transcription || !provider().synthesis`, which is the common missing-provider state, and the button emits to nothing. "Interrupt speech" enables when the state is `speaking` and does nothing. "Resume latest session" is permanently hidden because `canResume` defaults to `false`, although the page binds `(resumeSession)`. `errorKind` is never set, so the mic-denied, transcription, playback and chat-failure messages can never show. `timedOut` is never set, so the card cannot show the roster timeout the controller enforces at `command-center-page.controller.ts:166-168`. This is wiring drift: a unit made reachable without the integration step its siblings completed.
- Fix: for each one, either wire it in the page or delete it from the component and its spec.
  - `interrupt` wires to a new `CommandCenterPageController.interruptSpeech()` that calls the voice loop's existing barge-in.
  - `openVoiceSettings` wires to the settings surface navigation.
  - `errorKind` is derived from store state or the voice loop and passed down.
  - `timedOut` is bound to a controller signal set by `timeoutProposal`.
  - `pinNode` and `unpinNode` are removed (the page does not consume them; only a spec subscribes).
  - `canResume` is bound to `coordinator`'s resumable-record state, or the button is removed.

### S2. `CommandCenterStore.theme` and `reducedMotion` have no producer, so the page ignores the app theme

- Files: `libs/frontend/command-center/src/lib/model/command-center.store.ts:107-111,213-218`, `command-center-page.component.ts:78,91`, `scene/command-scene.component.ts:29-48,152-155`.
- Problem: `setTheme` and `setReducedMotion` have no production caller (the grep over non-spec sources returns only the store itself). The store defaults to `'dark'` and `false`. The page passes `store.theme()` to the scene and `store.reducedMotion()` to the overlay. The core `ThemeService` (`libs/frontend/core/src/lib/services/theme.service.ts`, with `isDark`) is already a dependency of the lib via `@ptah-extension/core`.
- Impact:
  - On a light DaisyUI theme the canvas keeps the dark sprite palette on a light `bg-base-100` surface.
  - The overlay's `reducedMotion` is always `false`, so its `transition-opacity` ignores the OS setting.
  - The scene detects reduced motion itself through `matchMedia` (`command-scene.component.ts:152-155`), so there are two sources of truth, one of them dead.
- Fix: feed the store from the existing source in the controller constructor, with one `effect` that calls `store.setTheme(themeService.isDark() ? 'dark' : 'light')`. Drop `reducedMotion` from the store and the overlay input, and have the overlay read `matchMedia` through one small shared signal (or accept the scene's value through an output). Alternatively delete both store members and let the scene own both.

### S3. Node kind is encoded in id prefixes and decoded by string matching in four files

- Files: producer `libs/frontend/command-center/src/lib/model/work-projection.ts:~97,111,123,141,146,176` (ids `root:`, `child:`, `tribunal:`, `lane:`, `phase:`, `cli:`, `sdk:`). Consumers: `scene/scene-layout.ts:71,96,127,131,181,192,214,274`, `scene/sprite-cache.ts:82,84`, `scene/command-scene.component.ts:56`, `voice/status-narrator.ts:46-49`.
- Problem: `CommandWorkNode` (`command-center.store.ts:24-32`) has no `kind`. The only way to learn what a node is, is to parse its id with 14 `startsWith` calls across three subsystems. The id format is an implicit cross-file contract with no type, no shared helper and no spec that links producer and consumers.
- Impact: this is contract looseness, the worst kind. A renamed prefix, or a new node type, compiles clean and silently falls through to the default branch (`paletteName` returns `'blue'`, the narrator says nothing, the layout treats it as an orbit node). Also `status-narrator.ts:46-49` mixes two meaning lists (`['running','completed','failed']` vs `['starting', ...]`) keyed off the same string test.
- Fix: add `readonly kind: 'root' | 'child' | 'agent' | 'tribunal' | 'lane' | 'phase'` to `CommandWorkNode`, set it where `projectOwnedWork` pushes each node, and replace every `startsWith` with a `kind` comparison (a `switch` with an exhaustive `never` guard where it picks behaviour). Keep ids opaque.

## Moderate issues

### M1. `CommandCenterPageController` accumulates unrelated responsibilities

- File: `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts` (`59f366c50`), lines 17-368.
- Problem: one injectable holds the projection computed (`:80-88`), voice-loop construction and its callbacks (`:89-109`), voice-turn pulse correlation (`:100-106,211-228`, plain `minPulseSeq`/`deliveredPulseSeq` fields beside signals), pending question/permission derivation (`:40-79,183-210`), the Tribunal roster proposal flow including nonce issuing, the 120 s timeout and the invalid-proposal path (`:125-182,331-358`), provider readiness (`:231-259`), and the Tribunal request regex (`:330-343`). It has 8 injected collaborators plus 2 objects built with `new` in field initializers. It is the largest page-side file and the one most likely to be edited next (a codex lane has it open now).
- Fix: extract the roster flow (proposal effect, `expectedRequest`, `handledRosterQuestionId`, `rosterTimeout`, `confirm`/`decline`/`timeout`) into `CommandCenterRosterFlow` in the same page `providers`, and the pulse correlation into a small helper that the controller and the transport share (`lastTerminalPulseByTab` lookup plus a sequence cursor). The controller stays the template-facing facade. Replace the literal `120_000` with a named constant and build the move regex once.

### M2. The page reaches into child internals and uses an older lifecycle hook

- File: `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:157-203` (`59f366c50`).
- Problem:
  - `focusWorkRow` does `document.querySelectorAll('[aria-label="All session work"] button')[index]` (`:199-201`), a global query keyed on a literal label that lives in another component's template, and writes `list.activeIndex.set(index)` on a child's public signal (`:198`).
  - The destroy callback writes `overlay().pinnedNodeId.set(null)` and `activeNodeId.set(null)` (`:171-172`) on the child's writable signals, which does nothing useful when the view is being destroyed.
  - Scene and overlay are synchronised through `ngAfterViewChecked` (`:177-191`), which runs on every change-detection pass and diffs two member fields by identity. The sibling `command-scene.component.ts:141` uses `afterNextRender` (the current API).
- Fix: add `focusRow(index)` to `CommandWorkListComponent` (it already owns the roving index and `querySelectorAll` at `command-work-list.component.ts:141`) and call it from the page. Make `pinnedNodeId`/`activeNodeId` `asReadonly()` and expose a `closeCard()` method. Replace the hook with `afterEveryRender` (or `afterRenderEffect`) so it is declared the same way as the scene and cannot be mistaken for a per-CD hot path.

### M3. Status-to-work-state mapping is written three times and the copies disagree

- Files: `command-center-projection.source.ts:20-47` (`state()`), `:193-212` (run state, a 4-level nested ternary), `model/work-projection.ts:152-162` (lane state, a 4-level nested ternary).
- Problem (duplication with drift): the same monitored-agent statuses map differently by site. `stopped` is `'cancelled'` in `state()` and as a lane, but a run whose agents are all `stopped` or `completed` becomes `'completed'` (`:206-210`). `paused` is `'awaiting input'` in `state()` and `'queued'` (default) as a lane. Agents with `pending`, `draft` and `background` each take the default branch in some copies and not in others.
- Fix: one `workStateForStatus(status): CommandWorkState` in `model/` (a table or `switch`), used by all three. Keep the run roll-up as a named function (`runState(agents)`) instead of an inline nested ternary. Add a spec row per status.

### M4. Cross-lib protocol literals are copied instead of shared

- Files: `libs/frontend/chat-state/src/lib/command-center-persona.ts:7` (names `<COMMAND_CENTER_TRIBUNAL_REQUEST>` inside the persona text), `command-center-page.controller.ts:344` (builds the block), `:63,174` and `model/tribunal-roster-proposal.ts:107` (`<TRIBUNAL_ROSTER_PROPOSAL>`, three copies).
- Problem: the persona text (chat-state) and the sender (command-center) must agree on a tag name, with nothing but a spec to catch a divergence. The proposal tag is spelled out three times in two files.
- Fix: export `COMMAND_CENTER_TRIBUNAL_REQUEST_TAG` from chat-state beside the persona and interpolate it into both. Export `TRIBUNAL_ROSTER_PROPOSAL_TAG` from `tribunal-roster-proposal.ts` and use it in the controller and the parser's regex.

### M5. Control flow keyed on a toast's display text

- Files: `command-center-page.component.ts:105`, `voice/command-voice-loop.ts:136-138`, `model/command-center.store.ts:51-54`.
- Problem: the page decides to show "Retry speech" with `toast.message.includes('Speech playback failed')`, matching the literal text another class produced. Rewording the toast removes the retry button with no compiler or spec signal (the spec would have to repeat the literal).
- Fix: add `readonly action?: 'retry-speech'` to `CommandToast`, set it in the voice loop, and switch on it in the template.

### M6. Test harness compiled as library source

- File: `libs/frontend/command-center/src/lib/integration/integration-harness.ts:1-30` (197 lines), `libs/frontend/command-center/tsconfig.lib.json`.
- Problem: it imports `@angular/core/testing` and `@jest/globals`, declares stub components (`SceneStubComponent` with the production selector `ptah-command-scene`), and is not matched by the `tsconfig.lib.json` excludes (`*.spec.ts`, `test-setup.ts`, `*.test.ts`). So the `typecheck` target (`ngc --project tsconfig.lib.json`) compiles it as production code. Other libs name such helpers `*.testing.ts` (`busy-disabled.testing.ts`, `session-analytics-state.testing.ts`) or keep them under `testing/`, which `chat/tsconfig.lib.json` excludes.
- Fix: rename to `integration-harness.testing.ts` (or move to `src/testing/`) and add the matching exclude to `tsconfig.lib.json` and `tsconfig.spec.json` includes as needed.

### M7. The narrow discovery entry drags the Tribunal state service, and its guard cannot see it

- Files: `libs/frontend/tribunal-panel/src/discovery.ts:1-9`, `lib/services/tribunal-discovery.service.ts:11` (value import `TRIBUNAL_MAX_VENDOR_TILES` from `./tribunal-state.service`), `tribunal-state.service.ts:9-19,28`, `discovery.spec.ts:10-48`.
- Problem: the header says the entry keeps "the Angular panel, pages, components, and gridstack" out. `phase.ts` promises no `TribunalStateService`. But `tribunal-discovery.service.ts` imports one constant from `tribunal-state.service.ts`, whose module graph includes `AgentMonitorStore`, `chat-state`, `chat-routing` and `canvas`. The lazy chunk therefore carries the whole state service for `= 8`. The spec follows only relative specifiers and only fails on two path names (`tribunal-page.component|gridstack`), so it passes while this graph is pulled in. It also reads source with `readFileSync`, a second source-text spec beyond the one accepted.
- Fix: move `TRIBUNAL_MAX_VENDOR_TILES` into `../types/tribunal-ui.types` (already imported by the discovery service) and re-export it from the state service for existing callers. Tighten the guard to forbid `tribunal-state.service`, `tribunal-page` and `gridstack`, so it states the contract in `discovery.ts`'s header.

### M8. Service locator in `ChatInputComponent`

- File: `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:488-489,636-638`.
- Problem: the new code adds `Injector` and calls `this.injector.get(AppStateManager)` inside `openCommandCenter()`, although the same file declares all its other dependencies as `inject()` fields and already imports from `@ptah-extension/core`. The service locator hides the dependency from the constructor surface and bypasses DI lint. It looks like a way to avoid updating existing specs that do not provide `AppStateManager`.
- Fix: `private readonly appState = inject(AppStateManager);` and provide it in the affected specs. `Injectable` roots resolve it anyway if `AppStateManager` is `providedIn: 'root'`, so check first whether this is needed at all.

### M9. Voice loop contract is looser than its only caller needs

- File: `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:21,414-424` (`59f366c50`; the three line numbers below refer to the same commit).
- Problem:
  - `onTurnBoundary(assistantText, turnToken?)` makes the stale-boundary guard optional. The only production caller always passes a token (`controller:227`), so the optionality exists only for old specs, and omitting it re-opens the exact race D36 closed.
  - `VoiceLoopOptions.sendTranscript` adds a second send path that bypasses the `coordinator` the loop already holds (`sendCommand`, `:107`). The loop now has two ways to send, and the page wraps `coordinator.send` in a different method with Tribunal rules.
  - `armTypedTurn` and the voice branch of `sendTurn` duplicate the three arming assignments.
  - The JSDoc "Called by the page after the assistant stream and its tool calls settle" is attached to `armTypedTurn`, and `onTurnBoundary` has none.
- Fix: make `turnToken` required and update the specs. Make `sendTranscript` required (so the loop no longer needs the coordinator for sending) or remove it. Extract `beginAwaitingTurn()` for the shared arming. Move the JSDoc back to `onTurnBoundary` and describe `armTypedTurn` separately.

## Minor issues

- m1. `libs/frontend/command-center/src/lib/components/` now holds three non-component injectables (`command-center-page.controller.ts`, `command-center-tribunal.transport.ts`, `command-center-projection.source.ts`), while the page-scoped `command-center.store.ts` and `session-coordinator.ts` live in `model/`. `.source` has precedent in chat-ui; `.controller` and `.transport` have none. Cost: a new contributor looks in `model/` for injectables and finds them split. Fix: group them in a `page/` folder or move to `model/`, and keep `.controller` as the only new suffix, documented in the lib README.
- m2. `libs/frontend/ui/src/provider-brand-art.ts` has no header comment, whereas its sibling `brand-mark.ts:1-22` explains the lazy-chunk contract. The one-line guard in `brand-mark-barrels.spec.ts` asserts the export names, but a reader of the entry cannot tell why it is separate.
- m3. `electron-shell.component.ts:147-156`: the Command Center tab is the only tab without a `lucide-angular` icon, unlike Chat, Apps, Tasks, Tribunal and Analytics. `openCommandCenter()` (`:529`) matches the neighbours.
- m4. `chat-input.component.ts:152-161`: the new `@if (commandCenterHeld())` banner is inserted between the comment `<!-- Image attachment validation error ... -->` and the element it documents. Also the `attachedReadOnly() || commandCenterHeld()` test is now repeated at four sites (`:418`, `:1496`, `:1508` and the placeholder). A `sendBlocked` computed removes the repetition, and the bare `this.commandCenterSendLock.state();` read at `:631` is redundant because `isHeld` reads the signal itself.
- m5. `chat-view.component.ts` and `chat-input.component.ts` diffs include unrelated reformatting (`shouldOverlayDock`, `railMinContentWidth`, the `dockWidth` ternary, the `existing` filter, a trailing newline, the `!text && files.length === 0` condition). Prettier via lint-staged probably caused it, but it adds blame noise to files of 1,900+ lines. Prefer `git add -p`/format-only commits for such churn next time.
- m6. `command-pending-input.component.ts:167-169`: `confirmedId`, `respondedIds`, `declinedIds` are public writable signals. They are private bookkeeping and should be `private` (the specs can assert through outputs).
- m7. `command-overlay-positioner.ts:15-20`: a constructor with six positional callbacks (`activeId`, `labels`, `sphereAnchor`, `card`, `bridge`, `floating`). An options object would name them. This also avoids the arrow-wrapper block at `command-overlay.component.ts:151-158`.
- m8. `command-center-page.controller.ts:25-27,157-158` and `command-center-tribunal.transport.ts:161-170`: sentinel empty strings (`rootSessionId ?? ''`, `workspace ?? ''`, `nonce: ''`) are passed into `tribunal.receive` instead of typed absence. `createTask` calls `reportFailure('Could not create the Tribunal task.')` in two places, in the catch and after the `if`; one exit would do. `toggleMuteVoice(): Promise<void | boolean>` (`:302`) is an imprecise union; return `Promise<void>`.
- m9. `scene/command-scene.component.ts:29-63` holds 28 literal hex colours and the provider-to-palette substring mapping (`'grok'`, `'opencode'`, `'antigravity'`, `'glm'`). The colours are canvas art and cannot be Tailwind classes, but they belong in `sprite-cache.ts` or a `scene-palette.ts`, and the provider mapping should reuse `PROVIDER_BRAND_SLUGS` keys instead of substring tests, so a new provider does not silently become `'blue'`.
- m10. `command-center-page.component.ts:50,68` couples `calc(100% - 72px)` to `h-[72px]` through a duplicated literal, and `336px` is an unexplained constant. `core/claude-rpc.service.ts:353-368` grows `rewindFiles` to five positional parameters, with `systemPrompt` after an optional boolean and an optional hint; an options object is the usual shape for new parameters here.

## File-by-file

### `libs/frontend/command-center/src/index.ts`
Score 9/10. One named export (`CommandCenterPageComponent`) with a comment that models stay internal. This is the narrowest barrel in the repo's feature libs. Removing `export *` of the store and coordinator is correct since the page provides them.

### `command-center-page.controller.ts`
Score 5/10. 0 Blocking, 0 Serious, 1 Moderate (M1), plus M4, m8 touches. Standard page-scoped provider disable is precedented (`marketplace` stores use the same). Good use of `inject()`, `computed`, `effect`. Too much in one class.

### `command-center-page.component.ts`
Score 6/10. Standalone, OnPush, `viewChild`, `inject`. M2, M5, S1 (unwired bindings), m10 apply.

### `components/command-voice-hud`, `command-session-controls`, `command-pending-input`
Score 6/10. Clean `input()/output()` APIs, `type="button"`, 44 px targets. S1 applies (inputs and outputs the page never binds); m6.

### `components/command-overlay.component.ts` and `command-overlay-positioner.ts`
Score 7/10. Timers have a release path (`clearTimers`, `positioner.destroy`), the positioner runs outside the zone, and the shared card reuses `FloatingUIService`. S1 (`pinNode`/`unpinNode` unbound), M2 (public writable signals), m7.

### `components/command-center-tribunal.transport.ts` and `command-center-projection.source.ts`
Score 6/10. The transport implements the port defined in `model/tribunal-run-coordinator.ts`, which is the right direction. M3 (nested ternaries and duplicate mapping), m1, m8.

### `scene/*`
Score 6/10. `afterNextRender`, `runOutsideAngular`, listeners all removed in `teardown`. S2 (no theme feed), S3 (prefix decoding in `scene-layout.ts`, `sprite-cache.ts`), m9.

### `voice/command-voice-loop.ts`
Score 7/10. At 551 lines it is under the 700 limit. M5 and M9 apply. Phase C internals not re-reviewed.

### `model/work-projection.ts`
Score 6/10. Pure function, typed inputs, no casts. A single 190-line function with two nested ternary ladders (`:152-162`, `:170-176`) and the prefix id scheme (S3), M3.

### `integration/*`
Score 6/10. Specs are behaviour-level and avoid `as any`/`as unknown as`. The harness lives in the lib compile (M6).

### Shared-file edits
- `tab-manager.service.ts` (+13): minimal and symmetric (set on pulse, delete on tab close). Score 8/10.
- `claude-rpc.service.ts` (+9/-2): minimal; m10.
- `chat-view.component.ts` (+29/-10, mostly formatting): the functional edit is 4 lines in `attemptRewindV2`; m5.
- `electron-shell.component.ts` (+14): m3.
- `chat-input.component.ts` (+49/-12): M8, m4, m5.
- `app.routes.ts` (+15): matches the `apps` route exactly (`canMatch: [electronOnlySurface]`, `SURFACE_ACTIVE` provider, `loadComponent`). Score 10/10.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Secondary entry points mapped in `tsconfig.base.json` | PASS | `tsconfig.base.json:36-38` (`tribunal-panel/discovery`), `:227-229` (`ui/provider-brand-art`), before the main alias like `/phase` |
| Barrel exports only the public surface | PASS | `libs/frontend/command-center/src/index.ts` (one export) |
| New entry has a guard spec | PASS (weak, see M7) | `discovery.spec.ts`, `brand-mark-barrels.spec.ts:71-81` |
| chat / tribunal-panel / ui / core never import command-center | PASS | grep over `libs/frontend/{chat,chat-state,core,tribunal-panel,ui}/src`: no import. The only importer outside the lib is `apps/ptah-extension-webview/src/app/app.routes.ts` (a lazy `import()`). Enforced by `enforce-module-boundaries` circularity as well |
| core does not import chat-state | PASS | no match under `libs/frontend/core/src` |
| Cross-lib imports use barrels or declared entries | PASS | every non-relative import in command-center is `@ptah-extension/*`; none is a deep relative path |
| Command-center imports only narrow tribunal entries | PASS | 7 `/phase`, 2 `/discovery`, 0 main barrel |
| Standalone, OnPush, signals, `input()`/`output()` | PASS | no `@Input`, `@Output`, `@ViewChild`, `*ngIf`; all components OnPush |
| Constructor injection avoided | PASS | `inject()` throughout. The `new` classes (`CommandVoiceLoop`, `TribunalRunCoordinator`, `CommandOverlayPositioner`) are plain objects, not DI participants |
| Explicit member accessibility | PASS | no member without a modifier in production files |
| Type precision (`any`, `as unknown as`, `!`) in production | PASS | zero matches in `libs/frontend/command-center/src` outside specs |
| Design tokens, no `text-base-content/NN` | PASS | zero matches in command-center. `text-base-content-muted` is used |
| Lint 700-line limit | PASS | largest new file `command-voice-loop.ts` 551 lines, `command-scene-renderer.ts` 452 |
| Page-scoped `@Injectable()` disables `use-injectable-provided-in` with a reason | PASS | `-- page-scoped provider` on all five (precedent: marketplace stores) |
| Route wiring follows `apps` | PASS | `app.routes.ts:190-204` |
| Test helpers excluded from the lib compile | FAIL | M6 |
| Component API fully wired by its host | FAIL | S1 |
| Typed discriminant instead of string-encoded identity | FAIL | S3 |
| Source-text specs only for `chat-view.rewind-persona.spec.ts` | PARTIAL | `discovery.spec.ts` also reads source; `brand-mark-barrels.spec.ts` and `webview-routing.spec.ts:1013` read source but predate this phase (M7) |

## Maintenance debt

- Introduced: a 368-line controller, three status-mapping copies, a 14-site prefix decoder, five unwired component APIs, and a test harness in the lib compile.
- Retired: the open `export *` of internal model classes from the lib barrel, and the page-injection items D35 and D36 carried forward.
- Net: the feature is assembled correctly at the boundaries. The debt sits in the middle of the page, and it is cheap to pay now, before more batches build on the controller and the id scheme.

## Checked and not filed

- Zoom and pan are out of scope (D31). No B0 numbers (D34). Not re-filed.
- Boundary direction: no import of command-center from chat, chat-state, core, tribunal-panel or ui. The project tags `scope:webview`, `type:feature`, `platform:angular` are unchanged and allowed by the feature constraints (`eslint.config.mjs:407-413`).
- Direct `document` and `window` use in the scene and overlay: the repo does the same in 28 other files (only 5 use `inject(DOCUMENT)`), so I do not file it.
- Page-scoped `@Injectable()` plus the eslint-disable comment: precedented (`marketplace` stores, `skill-synthesis-ui/agent-models.store.ts`).
- `standalone: true` written explicitly: tribunal-panel components do the same.
- Specs: no `as any`, `as unknown as` or non-null in the command-center specs. `readFileSync` appears only in the accepted `chat-view.rewind-persona.spec.ts` (weaker evidence, recorded as accepted), the new `discovery.spec.ts` (M7), and two pre-existing source-text guards. The `as unknown as HostWindow` in `webview-routing.spec.ts` predates this phase and is a typed test seam.
- `TabManagerService` is far over 700 lines, but the 13 added lines are small and symmetric; I did not ask for a split of the file in this phase.
- `ViewType` and `SURFACE_ROUTE_IDS` additions: matched by `webview-surface.types.spec.ts` and the routing spec; no other exhaustive consumer of the union was found in non-spec sources.
- The persona text change in chat-state is consistent with the controller (the content duplication is M4).
- Runtime behaviour (races, stale pulses, nonce handling) is for the logic review, not repeated here.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Rate unwired component APIs (S1) and the unfed store theme (S2) as Serious, not Moderate. | Moderate; Serious | Both leave visible dead controls or a wrong theme for real users (the missing-provider state shows an inert "Open Voice settings"), and both are cheap to fix. The instruction is to take the higher level when undecided. | Yes |
| Treat prettier-driven churn in chat-view and chat-input as Minor (m5), not a defect. | Skip; Minor | The repo's formatter owns formatting. I raise only the diff-surgery cost that the task asked me to check. | Yes |
| Keep the `.controller`/`.transport`/`.source` suffixes as a Minor (m1) rather than a rename demand. | Rename all; file as Minor | `.source` has precedent in chat-ui. The cost named in m1 is placement, not the suffix. | Yes |
| Score 6/10, NEEDS_REVISION. | 7 APPROVED if S1-S3 were Moderate | APPROVED needs no open Serious. Three open Serious items cap the score at 6. A fix round limited to S1, S2 and S3 would lift it to 8. | Yes |

Verdict: NEEDS_REVISION

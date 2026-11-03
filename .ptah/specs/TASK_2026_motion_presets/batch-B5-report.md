# Batch B5 — Settings and wizard

## Changes

- `libs/frontend/chat/src/lib/settings/settings.component.html:105` and `settings.component.ts:209`: stage the four Settings tabs by visible order. Their outer wrappers leave across the incoming tab; deferred content and the Providers security line enter from inner wrappers when rendered.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:438`: stage five wizard steps by `stepIndex()`; `:648` stages all six credential modes. Every branch owns the B1 panel and B2 enter/leave classes.
- `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:83`: wrap all five tab bodies beneath the existing native tab stage. Each panel carries its own `px-2 pt-4`; the projected body has no padding or positioning, so absolute leave panels retain their origin.
- `libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:60`: wrap both direction panels under the native tab stage, with padding on each panel instead of the projected body.
- `libs/frontend/chat/src/lib/settings/output-style/output-style-instructions-field.component.ts:83`: stage Edit and Preview with ordered indices and panel wrappers.
- Specs: `settings.component.spec.ts:813`, `provider-setup-wizard.component.spec.ts:211`, `connection-detail-drawer.component.spec.ts:100`, `voice-details-drawer.component.spec.ts:104`, and `output-style-editor.component.spec.ts:165` cover direction from real switches, single-panel presence after each switch, deferred rendering, and branch wrappers. Drawer specs also check panel padding. Settings test fixtures now import the stage directive.

## Surfaces covered

- Settings tabs: Providers (`claude-auth`), Context Management (`orchestration`), Advanced (`pro-features`), Search & Voice (`tools`). There are no Settings child routes; the Settings route itself is covered by the top-level root transition from B1.
- Connection detail drawer tabs: Accounts, Overview & Used By, Credentials, Models & Tiers, Advanced.
- Voice details drawer tabs: Speech-to-text, Text-to-speech.
- Output style instructions: Edit, Preview.
- Provider setup wizard: Provider, Credential, Verify, Models, Scope; credential modes: API key, OAuth, CLI, local native, local proxy, custom.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the native tab group's existing stage for the two drawers. | Add a nested stage or use the existing one. | B2's public API gives `ptah-native-tab-group` a stage and ordered index; component 6 says that group owns direction. | Yes. |
| Keep the Settings security line and deferred body in separate inner enter wrappers. | Enter the outer wrapper or enter when each body appears. | Component 6's deferred-content rule prevents a first-visit placeholder flash; the body can resolve after the tab shell. | Yes. |
| Place drawer spacing on each panel wrapper. | Pad and position the projected body, or pad each panel. | B1 makes leave panels absolute with `inset: 0`; padding and positioning on the projected body shifts a leaving panel on the first frame. The coordinator confirmed this in B6. | Yes. |
| Use B1 CSS to handle glass and reduced motion. | Add local opacity or animation rules. | The B1 contract supplies transform-only glass entrance and cut exit. The CLI matrix glass selector only changes fill and shadow; it adds no blur. | Yes. |

## Verification

- Focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="settings|provider-setup-wizard|connection-detail-drawer|voice-details-drawer|output-style"`: **NX 1 task: 1 succeeded**, run duration **2m 33s**, cache **0/1 hit** (final run after the padding and spec changes; 73 suites and 1,917 tests passed). An earlier focused run failed only because the new output-style test selected the tab group's stage instead of the panel stage; the selector was corrected and the final run passed.
- Full `npm run verify -- -p @ptah-extension/chat`: **NX 3 tasks: 3 succeeded**, run duration **6m 30s**, cache **0/3 hit**. This includes the Chat lint, test, and typecheck targets.
- `ptah_get_diagnostics` was called after the component and spec edits, but the TypeScript service timed out after 45 seconds; the full project verify supplies the typecheck gate.

## Not done / Clarifications Needed

- A rendered Electron screenshot was unavailable within this lane's allowed commands: the task prohibits build, serve, and Electron launch. Layout and animation were checked against the B1 CSS contract and B2 stage API in source and focused component tests; actual glass-frame and scroll behavior still needs the plan's Electron visual matrix.
- The `angular-frontend-patterns` skill was assigned, but this host exposes no skill-loading tool. Repository patterns and the approved plan were applied directly.

## Revise round 1

- **Nested credential entrance:** `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:650,653-961,1571,1608,2055,2193` gives the credential-mode stage an ordered `motionIndex`. The six mode panels bind their enter class to `credentialModeEnterClass()`, which is empty when the Credential step first renders and becomes `ptah-motion-enter` only after an actual mode switch. Returning to the step resets the flag. The outer step keeps its own entrance. `provider-setup-wizard.component.spec.ts:245` checks the binding value on first entry, on OAuth/API-key switches in both directions, and after returning to the step.
- **Rapid reversal:** `settings.component.spec.ts:836` and `provider-setup-wizard.component.spec.ts:233` exercise immediate A→B→A switches and assert one settled panel and the backward stage direction. jsdom removes leaving views before CSS animation runs, so these tests cannot observe `ptah-motion-leave` on a retained DOM node; the credential enter binding is asserted through the component signal instead of source text.
- **Leaving controls and duplicate IDs:** the B2 `MotionStageDirective` sets direction and handles replay; it does not mark ordinary leaving panels inert. `provider-setup-wizard.component.ts:641,653-961,1611` now uses a leave callback on the Credential step and its six modes; `output-style-instructions-field.component.ts:99,137` uses one on the Edit panel. Each callback sets `inert` and `aria-hidden="true"` before applying the B1 leave class, then completes when its animations settle. This covers rapid reversal of `wizard-base-url-label`, API-key fields, and `output-style-body`. Callback behavior is checked in `provider-setup-wizard.component.spec.ts:269` and `output-style-editor.component.spec.ts:196`.

### Decisions

- Credential mode direction follows the displayed case order: API key, OAuth, CLI, local native, local proxy, custom. Thus OAuth → API key is backward and the reverse is forward. The new review instruction overrides component 6's earlier unindexed W2 stage.
- Keep the B1 class and duration for sensitive leaves; the callback adds accessibility attributes without adding opacity rules. When reduced motion yields no animation, it completes immediately.

### Verification

- Focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="settings|provider-setup-wizard|connection-detail-drawer|voice-details-drawer|output-style"`: **NX 1 task: 1 succeeded**, duration **54.8s**, cache **0/1 hit**; **73 suites and 1,922 tests passed**. Two earlier focused attempts found a reversed test expectation and jsdom's missing leave/inert behavior; both test assumptions were corrected before the passing run.
- Full `npm run verify -- -p @ptah-extension/chat`: **NX 3 tasks: 3 succeeded**, duration **7m 12s**, cache **0/3 hit** (lint, test, typecheck).

### Not done / Clarifications Needed

- No Electron visual run was permitted. Browser animation retention, the rapid reversal's mid-leave sign, and the Providers first-visit stagger remain for the approved Electron visual matrix.
- This lane exposed no invokable `angular-frontend-patterns` skill. The repository's Angular guidance and the approved B1/B2 contracts were applied directly.

## Revise round 2

### Changes

- **Nested credential leave (moderate):** The six inner mode panels now call `leaveCredentialModePanel` (`libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:653,739,799,837,900,963,1630`). It completes immediately without adding a leave class when the mode-switch gate is off, so the outer Credential step alone animates on Continue or Back. A real mode switch delegates to `leaveSensitivePanel`, preserving the inner leave and its inert/hidden handling. `provider-setup-wizard.component.spec.ts:280-342` checks Continue, Back, a mode switch, and a step exit after a mode switch resets the gate.
- **Focus recovery (minor):** The mode toggle buttons have view queries and the existing focus effect now tracks mode changes, focusing the matching toggle in the entering panel or the step heading when that toggle is absent (`provider-setup-wizard.component.ts:730,789,1558-1559,2033-2047`). `provider-setup-wizard.component.spec.ts:345` checks focus in both switch directions.
- **Animation completion (minor):** `provider-setup-wizard.component.spec.ts:360` and `output-style-editor.component.spec.ts:206` stub two `getAnimations()` results and prove `animationComplete` waits for both `finished` promises, including a rejection. This exercises the existing `Promise.allSettled` paths without changing their implementation.
- **Drawer tab leave layout (coordinator addition):** Removed each rendered `[data-tab-body]` wrapper and projected the tab cases through a nonrendering `ng-container`, following the B4 server-detail pattern. All five connection panels are now direct children of the NativeTabGroup stage (`libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:83-129`), as are both voice direction panels (`libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:60-86`). `px-2 pt-4` remains on each panel, with no padding added to the stage. `connection-detail-drawer.component.spec.ts:100-135` checks the direct parent and padding across the available Claude CLI and custom endpoint tabs; `voice-details-drawer.component.spec.ts:101-131` checks both directions.

### Verification

- Final focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="provider-setup-wizard|output-style"`: **Nx 1 task: 1 succeeded**, 9.0s, 0/1 cache hits, exit 0.
- Full `npm run verify -- -p @ptah-extension/chat` before the final output-style spec edit: **Nx 3 tasks: 3 succeeded**, 7m 1s, 0/3 cache hits, exit 0.
- First full run after the final edit: **Nx 3 tasks: 2 succeeded, 1 failed** (`@ptah-extension/chat:test`), 3m 46s, exit 1. Its task log reports **309 suites passed, 1 failed; 5,502 tests passed, 1 failed, 2 skipped**. The only failure was `components/molecules/agent-card/stdout-visibility.spec.ts:194`, outside this lane's allowed files.
- Full rerun on the same files: **Nx 3 tasks: 3 succeeded, 2 cached**, 3m 22s, 2/3 cache hits, exit 0. Nx identified `@ptah-extension/chat:test` as flaky. No files changed between the failed run and the successful rerun.
- After the coordinator's drawer addition, focused `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="provider-setup-wizard|output-style|connection-detail-drawer|voice-details-drawer"`: **Nx 1 task: 1 succeeded**, 16.1s, 0/1 cache hits, exit 0.
- Final full `npm run verify -- -p @ptah-extension/chat`: **Nx 3 tasks: 3 succeeded**, 6m 4s, 0/3 cache hits, exit 0.

### Not done / Clarifications Needed

- No Electron/browser visual inspection was permitted by this lane's verification restrictions. The callback tests use jsdom and do not observe actual CSS animation frames.
- The lane had no skill invocation mechanism. Ptah's local inventory listed `impeccable`, and its instructions were readable from disk; the repository's Angular guidance and approved motion contract governed this scoped fix.

## Revise round 3 (user-approved, D1)

### Root cause and evidence

The outer Credential step was the only wizard step whose leave class and completion depended on a function-valued `[animate.leave]` callback. On Back, `goToStep` cleared `_credentialModeSwitch`, so each nested credential-mode callback completed immediately without adding a leave class. The Electron visual trace (`visual-review.md`, D1) shows that the outer callback did not run on this removal path: the old Credential node had no `ptah-motion-leave`, `inert`, or `aria-hidden` even four seconds later, while the Provider step's class-based leave worked. This left the outer step in Angular's retained DOM and made the next Continue stack panels. The existing specs invoked callbacks directly and therefore did not cover this outer `@switch` removal path.

### Changes

- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:641`: use the same Angular-managed `animate.leave="ptah-motion-leave"` as the other outer steps. Angular now owns completion for animated, zero-duration, reduced-motion, and interrupted step leaves; the nested mode callback still calls `animationComplete()` on every branch, including an empty `getAnimations()` result.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:2070`: mark the outgoing Credential step inert and hidden before changing the step signal, so stale credential controls cannot be used during the overlap. The selector skips an already leaving panel on a rapid reversal.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts:280,304`: exercise Continue → Back → Continue, assert Back direction and exactly one step panel after each transition, and assert callback completion when `getAnimations()` returns `[]`.

## Decisions

- Keep the nested credential-mode callback for API-key/sign-in changes. Only the outer Credential step uses Angular's class-based leave, matching the other four steps and avoiding competing function callbacks on step removal.
- Keep the existing `ptah-motion-leave` CSS and reverse direction supplied by `ptahMotionStage`; no preset or duration changes were needed.

### Verification

- `npm run verify -- -p @ptah-extension/chat`: **NX   3 tasks: 3 succeeded**; exit 0, 0/3 cache hits. This covered chat lint, test, and typecheck.
- Checked the available renderer file with `ptah_browser_navigate` and a screenshot. The Settings shell rendered, but the provider catalog remained in its loading state without Electron RPC, so the wizard could not be opened there.

### Could not check

- The changed source was not built or run in Electron because this lane's verification contract forbids build/serve/dev/e2e targets. The browser screenshot was of the existing bundle, so it does not prove the new Back animation frames or the final Electron layout. The regression spec checks DOM cleanup and reverse direction; jsdom does not render CSS motion frames.
- No CLI skill invocation mechanism was exposed. I read the on-disk `angular-frontend-patterns` skill and applied its Angular guidance directly.


## Revise round 4 (user-approved, D1)

### Root cause and evidence

The round-2 Electron trace records a Credential step still attached five seconds after Back, despite a completed visible leave and `inert`/`aria-hidden`; another Continue created a second Credential panel and duplicate ids. The same happened after a direct step click and close/reopen. The remaining six inner mode panels used function-valued `[animate.leave]` callbacks inside the class-based outer step. That nesting is the likely removal blocker: the outer leave can finish while Angular is still waiting on an inner callback's completion. This is an inference from the Electron DOM trace and the template structure, not a new Electron measurement. Angular's installed contract defines `AnimationCallbackEvent.animationComplete: VoidFunction` and `AnimationFunction = (event: AnimationCallbackEvent) => void` in `node_modules/@angular/core/types/_debug_node-chunk.d.ts:52-75`; the adjacent `MAX_ANIMATION_TIMEOUT` comment says its timeout protects against a callback forgetting the removal function (lines 57-66).

### Changes

- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:652,738,798,836,899,962`: replace all six nested function-valued leaves with `animate.leave="ptah-motion-leave"`. Angular now owns their completion, including zero-duration, reduced-motion, glass cut, and interrupted exits. The outer Credential step keeps its class-based leave at line 640.
- `provider-setup-wizard.component.ts:1614,2208`: before an API-key/sign-in mode switch, mark the outgoing inner panel inert and `aria-hidden` so overlapping controls and duplicate form ids are inaccessible. The existing conditional mode enter class and focus effect remain. `goToStep` still marks the outgoing outer panel inert, and `resetDraft` still clears `_credentialModeSwitch` at line 2481.
- `provider-setup-wizard.component.spec.ts:269,276,300,319`: add a structural guard for the removed callbacks (it fails with the old code), retain Back/Continue DOM cleanup coverage, assert inert mode-switch controls and one mode panel, and cover close/reopen immediately after a mode switch. Remove tests that invoked the deleted callback directly.

### Verification

- Focused command `npm run verify -- -p @ptah-extension/chat -- --testPathPatterns=provider-setup-wizard`: **3 tasks, 0 succeeded, 3 failed**. The verifier forwards `--testPathPatterns` to lint and typecheck, where it is invalid; Jest found one obsolete callback test, which was then removed. This is a command-routing limitation, not the final verification result.
- Full command `npm run verify -- -p @ptah-extension/chat`: **3 tasks, 3 succeeded**, exit 0, 0/3 cache hits. It covered chat lint, test, and typecheck. `git diff --check` passed. A separate scoped `ptah_get_diagnostics` request timed out after 45 seconds, so the successful typecheck is the error evidence.

## Decisions

- Keep both outer and inner leaves class-based. Keep the mode-switch enter, directional stage, focus behavior, and explicit outgoing-control inert state. No timeout or fallback timer was added.
- Keep the fix within the two authorized wizard files. The Angular frontend skill was found at `.claude/skills/angular-frontend-patterns/SKILL.md` and read; no CLI skill invocation mechanism was exposed.

### Not done

- This lane did not rebuild or run the changed source in Electron, as the strict verification scope permits only the chat verifier. jsdom removes class-based leaves synchronously and does not prove real CSS timing, Back entrance frames, or the final live Electron layout. A real Electron repeat of Back, Continue, direct step click, close during leave, reopen, reduced motion, and glass theme remains necessary.


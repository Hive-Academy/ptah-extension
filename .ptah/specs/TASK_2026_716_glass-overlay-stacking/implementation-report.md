# TASK_2026_716 implementation report

Implemented both glass overlay stacking fixes. Changed only the four assigned source/spec files plus this required report. No Git operations performed.

## Files changed

- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts:97`: manual popover shell around the existing listbox; UA resets at line 166 preserve fixed Floating UI coordinates and allow panel pointer interaction without a full-screen click blocker.
- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts:389`: promote before measuring; bound initial placement to 1000 ms with input-anchored fallback on rejection or timeout; generation checks reject stale work. `showLayer` at line 441 preserves in-page visibility when promotion is missing/refused; `hideLayer` at line 459 and teardown at line 642 clear shell state, timers and service positioning. All intentional catches carry degradation-audit comments.
- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.spec.ts:150`: promotion, close/destroy, missing/throwing API fallback, click containment and keyboard selection, focus/active descendant, pre-microtask close, rejected/stalled positioning and late completion regressions. Replaced existing double casts of computePosition with typed jest.mocked calls.
- `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts:102`: document capture-phase toggle listener with DestroyRef removal; handler at line 108 coalesces opens into a microtask, ignores the toast itself and non-overlay elements, and rechecks visibility, identity, connection and destruction. `raiseRegion` at line 128 retains the existing fallback and promotes above later popovers/dialogs.
- `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.spec.ts:220`: non-bubbling open capture, hide/show order, coalescing, self/closed/non-overlay events, hidden/inline states, dismissal before queued work, dialog focus, listener removal and queued-work cancellation.

## Decisions

1. Reuse an in-place manual popover shell, not a portal or shared overlay abstraction. Options were a shell, moving the panel DOM, or redesigning stacking. Evidence: native-dropdown.component.ts and native-popover.component.ts already implement the shell/fallback pattern; the assignment explicitly selects it. DOM containment and existing ARIA IDs remain intact. Reversible within the autocomplete component.
2. Bound autocomplete positioning at 1000 ms, matching the dropdown convention, with generation guards and FloatingUIService.cleanup request cancellation. Options were unbounded placement or an immediately visible unpositioned panel. Evidence: dropdown timeout pattern and FloatingUIService request-token cancellation. Reversible local implementation.
3. Re-raise above modal dialogs as well as popovers. Options were excluding dialogs or allowing the toast above them; chose the latter as explicitly permitted. No autofocus attribute is added and no focus() call is made. The HTML Standard popover focusing steps return without a focus target; manual mode alone is not what guarantees this. Source: https://html.spec.whatwg.org/multipage/popover.html#popover-focusing-steps. The page toast can remain visually above a modal while the existing inline variant remains the intended accessible interaction surface inside a focus trap. Reversible event filtering.
4. Filter toggle targets to popover-bearing elements and dialogs, so details toggles do not cause restacking. Coalesce multiple events per microtask and check live state again before promotion. The listener is removed on destroy and inert without a visible page toast. Reversible local event handling.
5. Preserve the two named consumers. provider-model-search-field.component.ts:74 and :345 already cancel row mousedown to retain field focus; event propagation and panel containment are unchanged by top-layer promotion. selection/autocomplete/autocomplete.component.ts:21 is a separate deprecated CDK implementation, not a NativeAutocomplete wrapper. Neither requires an edit.

## Repository evidence

Workspace analysis confirmed an Nx Angular frontend. CLAUDE.md and CONTRIBUTING.md supply standalone/signal conventions and memory-safe checks; the explicit assignment restricts checks further. Applied `.claude/skills/angular-frontend-patterns/SKILL.md`. Existing components use OnPush, inject(), signal inputs and view queries; these conventions remain. No task/batch/design documents were present in the supplied existing task directory, so the explicit assignment and reference implementations define the scope.

## Verification

- PASS: `npx jest -c libs/frontend/ui/jest.config.ts libs/frontend/ui/src/lib/native/autocomplete --coverage=false --maxWorkers=2` ? 1 suite, 42 tests passed (3.07 s).
- PASS: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/feedback --coverage=false --maxWorkers=2` ? 3 suites, 55 tests passed (10.645 s).
- Runs were sequential with output filtered. PowerShell displayed NativeCommandError wrappers for Jest stderr despite both runs returning exit code 0 and all tests passing.
- Role-required ptah_get_diagnostics was scoped to the two component files: no diagnostics in requested files. Its backend reported source `typescript-compiler` and 256 errors in sibling files, including unrelated chat specs. These were not fixed; this is not a clean project-wide typecheck claim. No separate tsc/Nx/build/lint command was run.
- No newly added any types, suppression directives, double-unknown casts or console calls. Existing public inputs/outputs, listbox structure and keyboard APIs remain unchanged.

## Not done / limits

No Electron visual run, Playwright, e2e, build, lint or host-wide verification was run, per task restrictions. jsdom Popover API stubs verify lifecycle and event behavior, not browser painting or real modal focus/inertness; focus behavior is supported by the HTML Standard and the unchanged no-autofocus markup. Source review covered both named consumers; their separate suites were outside the allowed commands. No changes outside the assigned files were needed.

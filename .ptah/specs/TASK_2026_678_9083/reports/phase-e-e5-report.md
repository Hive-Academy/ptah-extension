# Phase E · E5 implementation report

## Changes

- M4: Rebuilt the page header with the Ptah eyebrow, title, store-backed session chip and Voice settings action in `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:98`. Added a bordered stage with status header and interaction hints at `:111-137`. Moved the existing HUD and session controls into a wrapping dock below it at `:140-154`. Added a selected-node card, defaulting to the Ptah root, above the work list at `:174-181,213-217`. The rail now reserves scrolling for the work-list region at `:64-72,190-198`.
- M2: Rendered the store toast in an absolute DaisyUI alert with tone classes, icon, retry-speech action and dismiss control at `command-center-page.component.ts:162-172`; non-error alerts expire after five seconds with cleanup at `:219-221,240-247`. Error alerts persist.
- S8: Set the stage to the specified 600 px desktop minimum, 460 px under 720 px container width and 360 px under 480 px at `command-center-page.component.ts:57-61,76-93`.
- M3/S3/S4: Capped the pending card at 260 px with internal scrolling, used opaque `border-state-need` and `text-state-need`, and gave the answer input an opaque border, two-pixel focus outline and choice-derived or generic placeholder in `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:21-24,114-115`.
- S2: Applied `text-base-content` to both Voice settings recovery buttons in `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts:55,60`.
- S6 projection: Added optional root tab status and pending-question context to `libs/frontend/command-center/src/lib/model/work-projection.ts:55-56`, deriving root `idle`, `running` or `awaiting input` at `:82-84`. Added `idle` to the work-state union in `libs/frontend/command-center/src/lib/model/command-center.store.ts:15-17`.
- Page specs: Updated the pin-selection expectation and removed the assumption that a card always has a collision-free position in `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:177,294`.

## Preserve list check

- Kept the scene, overlay, their bindings, selection and work-list focus output.
- Kept Start voice, Stop listening, Stop, Mute/Unmute, Interrupt speech and Open Voice settings in the HUD; the header adds another route to the same settings controller method.
- Kept Send command, Start new and Status in session controls, now placed in the dock.
- Kept the pending input and roster confirmation/decline card, latest reply, work list, record-write notice and the toast retry-speech action.
- Kept list-only mode controls when canvas is unavailable.

## Specs added or changed

- `command-center-page.component.spec.ts:132-175`: dock/selected card/settings and toast overlay, expiry, retry and dismiss checks. At `:177,294`, adapted two assertions to E3 overlay semantics.
- `command-pending-input.component.spec.ts:77`: compact card, answer example and input boundary/focus checks.
- `command-voice-hud.component.spec.ts:41`: recovery link content-token check.
- `work-projection.spec.ts:33`: idle/streaming/awaiting root state cases.
- No tests were run, as required. Scoped `ptah_get_diagnostics` reported no errors in requested edited files; it reported 17 errors in sibling files outside E5 ownership, including integration specs.

## Decisions

- The selected card uses the currently selected node, then the root when no selection exists. Options were a static Ptah card or one following selection; the prototype names it “Selected”, and the store already exposes selection. Reversible.
- The toast is absolutely positioned in the rail. Options were rail flow or overlay; visual finding M2 explicitly requires no layout shift. Reversible.
- The pending card scrolls internally at 260 px. Options were a taller flow card or capped card; M3 requires that it not displace the work list by roughly 330 px. Reversible.
- Updated the page specs because E3 intentionally makes `pin()` select through the store, and collision avoidance can hide a pinned card. The page wiring still preserves selection and closes the overlay on destroy. Reversible if E3 behavior changes.

## Needed outside scope

- The scene does not expose FPS or p95 draw metrics through an input/output/API, so only stage interaction hints are shown. DPR exists internally in `scene/command-scene.component.ts` but is not exposed to the page. Scene files are owned by the parallel lane.
- A shell-level theme switch is not owned by E5. The page uses the existing host theme.

## Not done

- No Nx, Jest, TypeScript command, build, serve, e2e or git command was run.
- No screenshot remeasurement was performed; final contrast and visual comparison await the orchestrator's scoped checks.

## Fix turn

- Wired the actual root tab `status` and matching pending question from `ChatStore` through `components/command-center-projection.source.ts:189-193`. Its spec checks streaming → running and pending → awaiting at `command-center-projection.source.spec.ts:129-137`.
- Added `rootWorkState` in `model/work-projection.ts:72-79` so both normal projection and the pre-session root use the same derivation. The page controller reads the root tab and pending questions at `components/command-center-page.controller.ts:189-209`; its spec checks idle, streaming and pending states at `command-center-page.controller.spec.ts:154-173`.
- The three page failures came from the page spec overriding the controller with a stub store while the overlay injected a different page-provided store. The spec now provides that same store to both at `command-center-page.component.spec.ts:107-113`. The record-write notice assertion targets the rail notice at `:225` because the new header session chip also has `role="status"`. E3 overlay pinning selects the node and may hide its card when no position fits; the existing assertions now follow that behavior.
- Focused Jest run: **3 suites passed, 48 tests passed** (page, projection source and controller specs). Scoped `ptah_get_diagnostics` found no errors in the edited files; 17 errors remain in sibling specs outside this assignment.
- Requested components and integration folder Jest run: **14 suites passed, 1 failed; 113 tests passed, 1 failed**. The remaining failure is `integration/delegation-and-status.spec.ts:63`: its shared fixture in `integration/integration-harness.testing.ts:178-184` creates a root tab without `status`, while the test expects `running`. Per S6, a tab that is not streaming derives `idle`. The fix is to set that test root's status to `streaming` in the integration fixture or adjust the test to expect `idle`; the integration fixture and spec are outside this fix turn's edit scope.
- Previous “No Jest command was run” entry describes the original E5 handoff. This fix turn ran only the focused Jest commands authorized by the orchestrator. No Nx, TypeScript command, build, serve, e2e or git command was run.

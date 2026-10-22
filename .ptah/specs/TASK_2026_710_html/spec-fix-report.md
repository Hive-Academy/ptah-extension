# Spec Fix Report — TASK_2026_710_html

## Scope and changes

- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:26,56-74`: Added an inert `ArtifactStore` and the dock, sheet, and active-tab providers required by the real tool-call item. Its structured tool-output assertions remain intact. Final Jest result: **Tests: 45 passed, 45 total** (four-spec command).
- `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.spec.ts:11-60`: Provided an inert `ArtifactStore` and RPC collaborator for the projected display sheet. Its layout assertions remain intact. Final Jest result: **Tests: 45 passed, 45 total** (four-spec command).
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:94,112-115,257-266,580,623`: Added the artifact store provider and the panel stub's `artifacts`, `open`, `fullscreenArtifactId`, and `fullscreenChange` bindings. Updated two closed-region assertions to require absence of the region, matching the current `@if (state().open)` template. Final Jest result: **Tests: 45 passed, 45 total** (four-spec command).
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:90,291-294,417-426`: Added the artifact store provider and the same four panel stub bindings. Existing assertions remain intact. Final Jest result: **Tests: 45 passed, 45 total** (four-spec command).

## Execution

Command: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.spec.ts --coverage=false --maxWorkers=2`

First run after the artifact stub changes: 35 passed, 10 failed. Eight CLI cases lacked `DisplayDockState`; two dock assertions read `.hidden` from a region removed by the current template. After the final edits, the second run reported **Test Suites: 4 passed, 4 total; Tests: 45 passed, 45 total; exit code 0**. No tests were skipped.

Scoped `ptah_get_diagnostics` found no errors in the four edited specs. It reported 247 pre-existing errors in sibling chat files; those files were outside the spec-only scope.

## Decisions

- **Closed-region check:** Require the region to be absent. Options were to assert its `hidden` property or absence. The production `DisplaySheetComponent` creates the region only under `@if (state().open)`, so absence is the accurate and stronger closed-state check. Reversible.
- **Artifact dependency:** Use inert store providers in these existing component specs. Options were to configure the full `TabManagerService` and RPC chain or stub the newly injected store. These specs exercise CLI output, layout, dock, and keepalive behavior; an empty artifact store preserves those seams. Reversible.

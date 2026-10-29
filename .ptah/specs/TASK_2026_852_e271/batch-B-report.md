## Files

- Edited `libs/frontend/chat-routing/src/lib/stream-router.service.ts` — removed retired conductor ownership examples from routing documentation.
- Edited `libs/frontend/chat-routing/src/lib/stream-router.setup-surfaces.spec.ts` — removed Tribunal routing cases; retained generic surface and chat tab routing cases.
- Edited `libs/frontend/chat-state/src/index.ts` — removed Tribunal persona exports; retained records exports.
- Edited `libs/frontend/chat-state/src/lib/command-center-persona.spec.ts` — removed Tribunal persona assertions.
- Edited `libs/frontend/chat-state/src/lib/command-center-persona.ts` — removed Tribunal persona tags and prompt.
- Edited `libs/frontend/command-center/src/lib/components/command-center-page.component.html` — removed Tribunal confirmation and retry UI.
- Edited `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` — removed Tribunal UI cases and phase fixture.
- Edited `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` — removed Tribunal page bindings.
- Edited `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts` — removed Tribunal orchestration cases; retained generic command and question tests.
- Edited `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts` — removed Tribunal orchestration and delegated ordinary questions to the question provider.
- Edited `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts` — removed Tribunal manifest projection cases.
- Edited `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts` — removed Tribunal record projection; retained live agent projection.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-roster.provider.spec.ts` — retired Tribunal roster provider tests.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-roster.provider.ts` — retired roster proposal provider.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.spec.ts` — retired intent detection tests.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.ts` — retired intent detection.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.spec.ts` — retired Tribunal transport tests.
- Deleted `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts` — retired Tribunal transport.
- Added `libs/frontend/command-center/src/lib/components/command-center-question.provider.spec.ts` — tests ordinary questions, permission priority, and pending request checks.
- Added `libs/frontend/command-center/src/lib/components/command-center-question.provider.ts` — owns generic pending question and permission presentation.
- Edited `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts` — removed Tribunal phase details.
- Edited `libs/frontend/command-center/src/lib/components/command-node-detail.component.spec.ts` — removed retired phase input assertion.
- Edited `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts` — replaced phase fixture with an agent.
- Edited `libs/frontend/command-center/src/lib/components/command-overlay.component.ts` — removed Tribunal phase overlay.
- Edited `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts` — removed confirmation card cases.
- Edited `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts` — removed confirmation card and genericized answer error text.
- Edited `libs/frontend/command-center/src/lib/components/command-session-controls.component.spec.ts` — removed Tribunal hint assertion.
- Edited `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts` — removed Tribunal hint.
- Edited `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts` — removed Tribunal integration cases.
- Edited `libs/frontend/command-center/src/lib/integration/integration-harness.testing.ts` — removed Tribunal transport harness wiring.
- Deleted `libs/frontend/command-center/src/lib/integration/tribunal-confirm-gate.spec.ts` — retired confirmation gate tests.
- Edited `libs/frontend/command-center/src/lib/model/command-center.store.ts` — removed Tribunal-specific state handling.
- Edited `libs/frontend/command-center/src/lib/model/session-coordinator.ts` — removed Tribunal-specific comment.
- Deleted `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.contract.spec.ts` — retired proposal contract test.
- Deleted `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts` — retired proposal tests.
- Deleted `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts` — retired roster proposal model.
- Deleted `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts` — retired run coordinator tests.
- Deleted `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts` — retired run coordinator.
- Edited `libs/frontend/command-center/src/lib/model/work-projection.spec.ts` — removed Tribunal run grouping tests.
- Edited `libs/frontend/command-center/src/lib/model/work-projection.ts` — removed Tribunal run grouping and node kinds.
- Edited `libs/frontend/command-center/src/lib/model/work-state.spec.ts` — removed Tribunal run state test.
- Edited `libs/frontend/command-center/src/lib/model/work-state.ts` — updated monitored work description.
- Edited `libs/frontend/command-center/src/lib/scene/command-scene-pulses.spec.ts` — removed phase geometry fixture.
- Edited `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts` — removed phase geometry fixtures and lane-only kind.
- Edited `libs/frontend/command-center/src/lib/scene/command-scene-status.spec.ts` — removed phase geometry fixture.
- Edited `libs/frontend/command-center/src/lib/scene/command-scene-status.ts` — removed Tribunal phase arc drawing.
- Edited `libs/frontend/command-center/src/lib/scene/command-scene.component.ts` — removed Tribunal phase scene bindings.
- Edited `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts` — removed Tribunal and phase layout cases.
- Edited `libs/frontend/command-center/src/lib/scene/scene-layout.ts` — removed Tribunal satellite and phase geometry.
- Edited `libs/frontend/command-center/src/lib/scene/sprite-cache.ts` — removed Tribunal shield sprite.
- Edited `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts` — removed Tribunal voice prompt tests.
- Edited `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts` — removed Tribunal roster voice prompts.
- Edited `libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts` — removed Tribunal narration test.
- Edited `libs/frontend/command-center/src/lib/voice/status-narrator.ts` — removed Tribunal narration.
- Added `.ptah/specs/TASK_2026_852_e271/batch-B-report.md` — this batch report.

## Kept generic behaviour

Ordinary question selection, answer choices, permission priority, pending input state and one-time voice prompts live in `libs/frontend/command-center/src/lib/components/command-center-question.provider.ts:23`. The controller still sends ordinary answers and permission responses at `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:382`. Live agent projection remains in `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts` and `libs/frontend/command-center/src/lib/model/work-projection.ts`. `CommandCenterRunManifest` and `command-center-records.ts` remain unchanged.

## Verification

Command: `npm run verify -- -t test,typecheck,lint -p @ptah-extension/command-center,@ptah-extension/chat-state,@ptah-extension/chat-routing`

Project set: 3 projects (`@ptah-extension/command-center`, `@ptah-extension/chat-state`, `@ptah-extension/chat-routing`); the Nx run record contains nine tasks across exactly these three projects.

First run: `NX   9 tasks: 6 succeeded, 3 failed`. Command Center had one nullable type error, three unused imports and two stale phase UI assertions. All were fixed within this batch.

Final run: `NX   9 tasks: 9 succeeded, 6 cached`; `VERIFY_EXIT=0`.

Static search: no `@ptah-extension/tribunal-panel` imports or Tribunal references in the three scoped libraries. `git diff --check` passed.

## Decisions

Applied Amendment 1: extracted a question-only provider and retained generic question, permission and voice behavior. Historical manifest storage and records exports were preserved. Deleted Tribunal-only models, transport and tests without compatibility shims.

## Open issues

None.

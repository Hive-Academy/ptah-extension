# Batch 13 report

## Implementation

- **13.1:** `command-pending-input.component.ts:153` renders the full request, ordinary choices and typed answer, permission actions, and a Tribunal roster with mode, rounds, and lanes. `:160` rejects a non-Decline-first proposal; `:167` guards duplicate confirmation; `:179` accepts a focused Enter or Space activation. Timeout disables actions and is shown in text. No voice confirmation input exists. The parent owns coordinator calls and timeout handling.
- **13.2:** `command-work-list.component.ts:72` renders every projected node, including provider, parent, and text state. `:31` has one polite state-change live region; `:99` uses the public provider slug map to choose `ProviderMarkComponent` or `MonogramTileComponent`; `:112` supports arrow navigation and Enter selection.
- **13.3:** `command-voice-hud.component.ts:94` exposes start, stop, mute, interrupt, and voice-settings intents. `:107` keeps Stop available whenever `turnAbortable` is true. The template presents safe fixed recovery text and a settings action for microphone denial or provider absence.
- **13.4:** `command-session-controls.component.ts:74` provides text command submission, resume offer, new session, and on-demand status outputs. `:68` discloses the five explicit Tribunal move words from `TRIBUNAL_MOVES`.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-session-controls.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-13-report.md`

## Specs and verification

- `command-pending-input.component.spec.ts:35` asserts click confirmation, roster details, and duplicate suppression; `:53` focused Enter confirmation; `:69` an ordinary or spoken-style answer cannot confirm; `:77` full ordinary choice; `:99` Decline and timeout state; `:118` invalid proposal has no Confirm.
- `command-work-list.component.spec.ts:22` asserts 30 listed nodes with provider, parent, and unknown state; `:33` arrow and Enter selection; `:51` one polite live region updates on state change; `:67` unknown provider renders a monogram.
- No Jest, Nx, build, or lint command was run, per the lane rules. The orchestrator owns the scoped run. `ptah_get_diagnostics` reported zero errors in the six requested files. Seven sibling errors were reported in `tribunal-run-coordinator.spec.ts` (five mock signature errors) and `capability-id-codec.ts` (two BigInt target errors); these were outside this batch.
- `npx prettier --check` output: **All matched files use Prettier code style!**
- Catch sites in new non-spec code: **none**. Degradation-audit classification: no new catch or `.catch` path.

## Needed changes outside the batch

- Batch 14 page wiring must connect these presentational outputs to the coordinator, voice loop, settings navigation, and timeout response. The parent must pass the ordinary question's choices and the voice loop's abortable-turn state. Existing sibling diagnostics named above need their owning batch to resolve them.

## Decisions

- **Settings recovery:** Emit `openVoiceSettings` rather than navigate from this component. Options: direct route navigation or parent intent. Evidence: settings is a separate chat route and the component has no host navigation contract. Reversible: yes, when Batch 14 wires the intent.
- **Unknown provider:** Use the public `PROVIDER_BRAND_SLUGS` map to choose the mark; all other IDs use the monogram. Options: hardcoded provider names or the public map. Evidence: `@ptah-extension/ui` exports the map and both components. Reversible: yes.
- **Tribunal confirmation:** Emit the proposal once from button activation; leave launch and timeout response with the page/coordinator. Options: component RPC or parent output. Evidence: Amendment A1 makes the page responsible for registration and launch, and Batch 13 assigns presentational components only. Reversible: yes.

## Remaining

The scoped Jest/Nx verification is pending the orchestrator's run, as required by the lane rules.

# Batch 7 implementation report

Status: partial. Turn 2 completed the monitored CLI lane composer. SDK subagent and background strip messaging still use their existing tray path. The A4 transcript thread was explicitly assigned to a separate task.

## Turn 1 — push and policy surface

- AgentMonitorMessageHandler routes message receipt and parent delivery pushes through validated schemas into the Batch 6 store. The handler specs now use valid UUID lane IDs.
- The agent card header shows live Messaging, Permission, Network, and Limit badges, with a pending label for potential-only capabilities and the parent-spawn policy tooltip.

## Turn 2 — composer

### Per surface

- chat-ui: Added LaneComposerComponent and exported it publicly. Full uses a textarea; compact uses a single-line input beside a split Send / Send now button. Both consume AgentMonitorStore composerState, previewMessage, sendMessage, cancelMessage, receipts, and receiptLabel. They show queued receipts and a Cancel button only while a receipt is accepted and queued; the summary is absent when the queue is empty.
- AgentContinueInput: Replaced the old renderer follow-up path with a thin monitored-lane wrapper. It supplies lane identity, CLI, variant, stopped state, and the available warm/CLI/fresh resume facts. The backend preview's usesResume value gates the displayed resume path. The 14 obsolete continue/resume assertions were replaced with tests of the new contract.
- AgentCard, AgentLaneGrid, and AgentMonitorPanel: The card now hosts one continue input in its body; flat lane presentation receives the full variant, and the card/tile receives compact. The panel's duplicate input was removed. Existing Stop, Resume, output, permission, account, expansion, close, and detail flows remain in their original components. Resume is a visible primary action on stopped card headers.
- InspectorAgentsSection: Rows with a monitored lane UUID use the compact composer. Rows without one retain AgentSteerInput so their existing SDK action remains available. The actions menu still opens the inspector composer.
- AgentSteerInput, BackgroundAgentStrip, SubagentLaneComposer, and SubagentLane: Their SDK tray-based steer/follow-up flow remains. The strip ID is a toolCallId, and SubagentRecord uses parentToolUseId/SDK agentId, whereas AgentMonitorStore.sendMessage requires a monitored AgentId UUID. A safe mapping or backend adapter is needed before these surfaces can use the Batch 6 receipt contract. No user action was removed to hide this gap.
- Removed the unused followUpResumesInstead helper after moving its only component caller.

### Copy and interaction

- Running hints: “Send: queued for next turn · Send now: steers into the running turn”, “Send: queued for next turn · Send now: interrupts and restarts the turn”, or “Send now: not supported by {CLI}”, according to the backend preview. While loading, the hint says “Checking message options…”.
- Stopped hint: “Resume with message will {resume path}”; paths use “Continue warm session”, “Resume CLI session {short id}”, or “Start fresh handoff”. The stopped composer has Resume with message and no Send now.
- Interrupt confirmation: “Partial work in this turn will be discarded.” Confirm sends allowPartialTurnLoss: true; Escape and the secondary button close the confirmation.
- Draft stays until an accepted/started receipt. Unsupported responses and transport errors keep the text and show an error. Enter sends queued; Ctrl/Cmd+Enter requests Send now; Shift+Enter inserts a newline in full mode; Escape closes menu/confirmation.
- The text field has a label; menu and confirmation use semantic roles and button names. Hint and receipt updates have aria-live text, Lucide icons are hidden from assistive technology, and the hint line reserves height. The confirmation overlays the composer rather than shifting the lane.

## Preserved actions checklist

- Stop: retained on flat and card headers.
- Resume: retained existing agent:resumeCliSession action, now styled primary; Resume with message uses store sendMessage.
- Permission response: existing card flow retained.
- Output view, details, expansion, close: retained.
- Account controls: retained.
- Codex Send now: available through the store-driven split action when the preview supports it.
- SDK steer and follow-up: retained in the subagent lane, background strip, and inspector fallback.

## Proposed Removals

None. The unused followUpResumesInstead helper was removed after its last caller migrated; no user-facing action was removed.

## Tests and verification

- npx ngc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit: PASS, exit 0. Existing unrelated Angular template warnings only.
- npx ngc -p libs/frontend/chat/tsconfig.lib.json --noEmit: PASS, exit 0. Existing unrelated Angular template warnings only.
- Focused chat-ui Jest through verify lock: PASS, 2 suites / 32 tests (AgentSteerInput and BackgroundAgentStrip). No direct LaneComposer spec yet; its behavior is exercised through AgentContinueInput.
- Focused chat Jest for card, continue input, inspector, and agent monitor: PASS, 20 suites / 284 tests. After the final keyboard fix, isolated AgentContinueInput spec: PASS, 1 suite / 8 tests.
- Requested broad focused chat Jest: 21 suites passed, 1 failed; 294 tests passed, 29 failed. The failure is in SubagentLaneComponent specs, which now instantiate the separately implemented A4 LaneTranscriptComponent with an older store mock lacking agentsById. It is outside this turn's composer scope and is being worked on concurrently.
- Scoped ptah_get_diagnostics was called after edits but timed out at 45 seconds with files unchecked. Both Angular compiler runs passed.
- The prototype was inspected in dark theme in Turn 1. The implemented Electron renderer was not rendered; no visual screenshot of the changed UI was possible under the no build/serve rule.

## Decisions

- Use one chat-ui composer backed by AgentMonitorStore for monitored CLI lanes, instead of extending the legacy AgentSteerInput transport path. Evidence: Batch 6 exposes preview, receipt, send, and cancel on the monitored lane store; the implementation plan names chat-ui presentational pieces. Reversible: yes.
- Keep SDK subagent and background strip actions on their existing tray RPC until IDs and receipt semantics can be mapped. Evidence: BackgroundAgentStripEntry.id is documented as toolCallId, SubagentLaneComposer steers through SessionAgentTrayService, and AgentMonitorStore validates AgentId as a UUID. Routing those IDs to agent:sendMessage would fail or target the wrong lane. Reversible: yes, once an adapter exists.
- Let backend preview usesResume choose fresh versus saved-session copy, then use live MonitoredAgent continuation and CLI-session fields to name the saved path. Evidence: AgentMessagePreview has usesResume; the agent model carries supportsContinuation, continuationExpired, and cliSessionId. Reversible: yes.

## Unmet requirements

- Shared Batch 6 composer behavior on SDK SubagentLane and BackgroundAgentStrip remains unavailable without an identity/transport adapter. Their original actions are preserved.
- A4 parent↔lane transcript is outside Turn 2 and is being handled separately.
- No implemented Electron visual review was run.

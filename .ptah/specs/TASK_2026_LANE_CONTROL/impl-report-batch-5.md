# Batch 5 implementation report

## Files and implementation

- RPC handlers: libs/backend/rpc-handlers/src/lib/handlers/agent-message-rpc.handlers.ts (new), agent-message-rpc.handlers.spec.ts (new), agent-rpc.handlers.ts, handlers/index.ts, src/index.ts, host-profile/manifest.ts, host-profile/register-rpc-surface.ts.
- Runtime wiring and parent delivery: libs/backend/cli-agent-runtime/src/index.ts; src/lib/cli-agents/agent-events.ts, agent-events.spec.ts, agent-process-manager.service.ts, agent-lane-resume.service.ts, agent-lane-resume.service.spec.ts; src/lib/cli-agents/messaging/parent-envelope-store.service.ts, parent-delivery-drainer.service.ts, parent-delivery-drainer.service.spec.ts.
- MCP: libs/backend/vscode-lm-tools/src/lib/mcp-core/agent-spawn-args.schema.ts, agent-spawn-args.schema.spec.ts, tool-description.builder.ts, protocol-dispatcher.ts, mcp-response-formatter.ts; src/lib/mcp-stdio/agent-tool.dispatcher.ts; src/lib/code-execution/types.ts; src/lib/namespace-builders/agent-namespace.builder.ts; src/lib/ptah-api-builder.service.ts.
- Electron DI guards: apps/ptah-electron/src/di/expected-resolvable.ts, container.smoke.spec.ts, rpc-surface.spec.ts.
- No cli-engine container change was needed: its existing runtime registration resolves the new coordinator and resume service through the runtime composition.

## RPC and MCP surface

| Surface | Input | Result |
| --- | --- | --- |
| agent:previewMessage | AgentMessagePreviewRequest | AgentMessagePreview |
| agent:sendMessage | AgentMessageRequest | AgentMessageOutcome |
| agent:getMessageReceipt | agentId and messageId | AgentDeliveryReceipt |
| agent:cancelMessage | agentId and messageId | AgentDeliveryReceipt |
| agent:detectClis | existing request | existing CLI rows, with CliAdapterManifest on each supported row |
| agent:continue | existing request | thin delegate to AgentMessageCoordinator |
| agent:resumeCliSession | existing request | shared AgentLaneResumeService path |
| ptah_agent_message | agentId, message, delivery queue / now / steer, optional allowPartialTurnLoss | coordinator outcome with receipt |
| ptah_agent_message_status | agentId and messageId | receipt with accepted / started / settled / failed / expired / interrupted-undelivered state |
| ptah_agent_spawn | existing args plus optional permission and network | structured UNSUPPORTED_LANE_POLICY refusal for unsupported policy |
| MCP response formatter | existing response | start-turn label included |

The new RPC and MCP boundaries parse input with Zod. The message handler is separate from the existing agent RPC file. The MCP protocol dispatcher delegates the new behavior.

## Push events and delivery

- agent-monitor:message-receipt carries AgentMonitorMessageReceiptPayload: a receipt field containing AgentDeliveryReceipt.
- agent-monitor:parent-delivery carries AgentMonitorParentDeliveryPayload: agentId, kind completion or report, state pending or delivered, optional deliveryId.
- Event sinks are installed before RPC handlers are resolved, so startup events reach agent-monitor. Sink registration is idempotent.
- AgentProcessManager resolves a provisional parent tab ID to the real session ID and then asks ParentDeliveryDrainer to drain pending envelopes. The envelope store moves pending entries during that resolution. Drain errors are reported through the injected logger.
- Electron DI guards include the new services and message RPC methods. The shared host manifest owns the RPC method list.

## Tests and verification

- Focused Jest passed: agent-events 31/31; parent-delivery-drainer 3/3; agent-lane-resume 3/3; agent-message-rpc 2/2; agent-spawn-args.schema 78/78.
- The requested four-project verify confirmed “for 4 projects.” Shared and runtime lint/typecheck passed; lm-tools and rpc-handlers initially exposed type errors, which were fixed. Its test phase then stopped because an Nx Jest project-graph worker exited unexpectedly.
- A later targeted changed-library lint/typecheck verify passed 6/6 for rpc-handlers, vscode-lm-tools and cli-agent-runtime, with zero lint errors.
- The requested ptah-electron, cli-engine and platform-cli lint/typecheck verify passed 6/6.
- The final repeated changed-library verify stopped before lint/typecheck because the Nx ESLint project-graph worker exited unexpectedly. This is an environment/tooling failure, not a reported source diagnostic; the preceding successful run and focused tests provide the source evidence. The scoped Ptah diagnostics request remained unavailable after 45 seconds, with three files unchecked.
- The Electron Nx test target unexpectedly launched six build dependencies. It was stopped immediately to honor the explicit no-build limit. A direct focused Jest command for the two Electron guard specs also produced no result after more than a minute on this congested machine and was stopped. The changed Electron guard specs were not executed to completion.
- The known machine failures listed in the assignment were not observed in the focused tests.

## Needs for Batches 6/7/9

- Batch 6 CLI tools view: consume agent:detectClis result clis: CliDetectionResult[]. Each supported row now carries manifest?: CliAdapterManifest, including capability and policy information.
- Batch 7 agent monitor store: call agent:previewMessage with AgentMessagePreviewRequest and render AgentMessagePreview (mode, supported, reason, usesResume, lossDisclosure, effectiveCapabilities); call agent:sendMessage with AgentMessageRequest and handle AgentMessageOutcome; poll agent:getMessageReceipt or use agent-monitor:message-receipt with AgentMonitorMessageReceiptPayload. agent:cancelMessage takes agentId and messageId and returns AgentDeliveryReceipt. Preserve typed message text on failed/unsupported sends.
- Batch 9 parent status: subscribe to agent-monitor:parent-delivery with AgentMonitorParentDeliveryPayload and render pending/delivered for completion/report envelopes; keep agent-monitor:message-receipt wired to receipt state updates.
- AgentDeliveryReceipt states are accepted, started, settled, failed, expired and interrupted-undelivered. The receipt ID is the messageId used for status and cancel.

## Decisions

- Install push sinks before handler resolution. Options were early host registration or registration inside the handler factory. The host resolves handlers after the first events can occur; early registration preserves those events. Reversible.
- Keep the specialized Ptah CLI SDK resume preparation while routing the common resume behavior through AgentLaneResumeService. Options were replacing the entire path or sharing the ordinary resume implementation. Existing session IDs, MCP URL and child metadata require the specialized preparation. Reversible.
- Keep cli-engine composition unchanged. Options were adding another registration or using the existing runtime registration. The current container already resolves the new services. Reversible.
- Use the runtime LaneSpawnPolicyError for MCP policy refusal. Options were duplicating policy checks in the MCP dispatcher or formatting the runtime refusal. The runtime owns policy support and provides the structured UNSUPPORTED_LANE_POLICY code. Reversible.

## Limitations

- No skill-loading tool was available in this lane, so no optional matching skill could be loaded.
- No git command was run. No frontend library was changed.

/**
 * @ptah-extension/deep-agent-sdk — Multi-provider agent runtime based on
 * LangChain's deepagents package. Runs alongside agent-sdk; a runtime
 * selector picks which one handles each session.
 *
 * The end-to-end path (createDeepAgent → graph.stream(streamMode:'messages')
 * → FlatStreamEventUnion) is live. The runtime selector picks deep-agent
 * when the user sets `ptah.runtime` = "deep-agent", or (in auto mode) when
 * the active provider is not Claude-native.
 */

export { DEEP_AGENT_TOKENS, type DeepAgentDIToken } from './lib/di/tokens';
export { registerDeepAgentServices } from './lib/di/register';

export { ModelFactoryService } from './lib/model-factory/model-factory.service';
export {
  SessionRegistry,
  type DeepAgentSession,
} from './lib/session-registry/session-registry.service';
export { DeepAgentAdapter } from './lib/deep-agent-adapter/deep-agent-adapter';
export {
  AgentRuntimeSelector,
  type RuntimeChoice,
  type RuntimeConfigValue,
} from './lib/runtime-selector/agent-runtime-selector';
export {
  StreamAdapterService,
  type StreamAdapterInput,
  type StreamResultCallback,
} from './lib/stream-adapter/stream-adapter.service';
export {
  ToolBridgeService,
  type BridgedTool,
} from './lib/tool-bridge/tool-bridge.service';
export { JsonFileCheckpointer } from './lib/checkpointer/json-file-checkpointer';
export { DeepAgentInternalQueryAdapter } from './lib/internal-query/deep-agent-internal-query.adapter';

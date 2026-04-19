/**
 * DI Token Registry — Deep Agent SDK
 *
 * See agent-sdk/di/tokens.ts for the canonical convention.
 * All tokens use Symbol.for() so cross-library resolution works even when
 * imported through different transpile paths.
 */
export const DEEP_AGENT_TOKENS = {
  /** Main deep-agent adapter (alternative runtime to SdkAgentAdapter). */
  DEEP_AGENT_ADAPTER: Symbol.for('DeepAgentAdapter'),

  /** Runtime selector — the facade TOKENS.AGENT_ADAPTER should resolve to. */
  AGENT_RUNTIME_SELECTOR: Symbol.for('AgentRuntimeSelector'),

  /** OpenAI-compat ChatModel factory, keyed by AnthropicProviderId. */
  MODEL_FACTORY: Symbol.for('DeepAgentModelFactory'),

  /** Bridges IToolRegistry → LangChain DynamicStructuredTool[]. */
  TOOL_BRIDGE: Symbol.for('DeepAgentToolBridge'),

  /** Maps LangGraph stream events → FlatStreamEventUnion. */
  STREAM_ADAPTER: Symbol.for('DeepAgentStreamAdapter'),

  /** Per-tab session store for deep-agent graphs. */
  SESSION_REGISTRY: Symbol.for('DeepAgentSessionRegistry'),

  /** IToolRegistry implementation — registered by the app layer. */
  TOOL_REGISTRY: Symbol.for('PtahToolRegistry'),
} as const;

export type DeepAgentDIToken = keyof typeof DEEP_AGENT_TOKENS;

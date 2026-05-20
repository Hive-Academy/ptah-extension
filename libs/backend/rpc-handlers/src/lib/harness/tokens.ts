/**
 * Harness sub-service DI tokens.
 *
 * These Symbol-based tokens are used by `HarnessRpcHandlers` (and the harness
 * sub-services themselves, for service-to-service injection) to resolve the
 * extracted harness services from the tsyringe container.
 *
 * Registered via `registerHarnessServices(container)` — see `./di.ts`.
 */
export const HARNESS_TOKENS = {
  WORKSPACE_CONTEXT: Symbol.for('HarnessWorkspaceContextService'),
  SUGGESTION: Symbol.for('HarnessSuggestionService'),
  SUBAGENT_DESIGN: Symbol.for('HarnessSubagentDesignService'),
  SKILL_GENERATION: Symbol.for('HarnessSkillGenerationService'),
  DOCUMENT_GENERATION: Symbol.for('HarnessDocumentGenerationService'),
  PROMPT_BUILDER: Symbol.for('HarnessPromptBuilderService'),
  CONFIG_STORE: Symbol.for('HarnessConfigStore'),
  CHAT: Symbol.for('HarnessChatService'),
  STREAM_BROADCASTER: Symbol.for('HarnessStreamBroadcaster'),
  IO_FS: Symbol.for('HarnessIoFs'),
  LLM_RUNNER: Symbol.for('HarnessLlmRunner'),
} as const;

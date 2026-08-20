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
  AGENT_FILE_WRITER: Symbol.for('HarnessAgentFileWriterService'),
  WORKFLOW_PROMPT: Symbol.for('HarnessWorkflowPromptService'),
  STREAM_BROADCASTER: Symbol.for('HarnessStreamBroadcaster'),
  IO_FS: Symbol.for('HarnessIoFs'),
  MCP_INSTALL: Symbol.for('HarnessMcpInstall'),
  SKILL_INSTALL: Symbol.for('HarnessSkillInstall'),
  LLM_RUNNER: Symbol.for('HarnessLlmRunner'),
  /**
   * `HarnessHealthRpcService` — the reconciler surface (`harness:health`,
   * `harness:reconcile`, `harness:remove`) and the `harness:healthChanged`
   * push. Separate from the wizard services above: those AUTHOR a harness,
   * this one reports whether it reached disk.
   */
  HEALTH: Symbol.for('HarnessHealthRpcService'),
} as const;

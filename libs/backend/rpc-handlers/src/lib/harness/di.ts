/**
 * Harness sub-service DI registration.
 *
 * Registers all extracted harness services + the stream broadcaster as
 * tsyringe singletons bound to the tokens in `./tokens.ts`.
 *
 * Must be invoked once during app bootstrap, BEFORE
 * `registerAllRpcHandlers(container)` resolves `HarnessRpcHandlers`.
 *
 * The registration order matches the service-to-service dependency DAG so
 * transitive resolutions succeed regardless of tsyringe's lazy behaviour:
 *
 *   workspaceContext ← suggestion, fs-io
 *   streamBroadcaster, workspaceContext ← subagent-design, skill-generation,
 *                                         document-generation, workflow-prompt,
 *                                         suggestion, llm-runner
 *   promptBuilder ← config-store
 *
 * Re-exports `HARNESS_TOKENS` for ergonomic import at call sites.
 */

import type { DependencyContainer } from 'tsyringe';

import { HARNESS_TOKENS } from './tokens';
import { HarnessStreamBroadcaster } from './streaming/harness-stream-broadcaster.service';
import { HarnessWorkspaceContextService } from './workspace/harness-workspace-context.service';
import { HarnessPromptBuilderService } from './config/harness-prompt-builder.service';
import { HarnessConfigStore } from './config/harness-config-store.service';
import { HarnessAgentFileWriterService } from './config/harness-agent-file-writer.service';
import { HarnessFsService } from './io/harness-fs.service';
import { HarnessMcpInstallService } from './io/harness-mcp-install.service';
import { HarnessSkillInstallService } from './io/harness-skill-install.service';
import { HarnessLlmRunner } from './ai/harness-llm-runner.service';
import { HarnessSuggestionService } from './ai/harness-suggestion.service';
import { HarnessSubagentDesignService } from './ai/harness-subagent-design.service';
import { HarnessSkillGenerationService } from './ai/harness-skill-generation.service';
import { HarnessDocumentGenerationService } from './ai/harness-document-generation.service';
import { HarnessWorkflowPromptService } from './ai/harness-workflow-prompt.service';
import { HarnessHealthRpcService } from './health/harness-health-rpc.service';
import { HarnessSkillSelectionRpcService } from './selection/harness-skill-selection-rpc.service';

export { HARNESS_TOKENS } from './tokens';

export function registerHarnessServices(container: DependencyContainer): void {
  container.registerSingleton(
    HARNESS_TOKENS.STREAM_BROADCASTER,
    HarnessStreamBroadcaster,
  );
  container.registerSingleton(
    HARNESS_TOKENS.WORKSPACE_CONTEXT,
    HarnessWorkspaceContextService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.PROMPT_BUILDER,
    HarnessPromptBuilderService,
  );
  container.registerSingleton(HARNESS_TOKENS.CONFIG_STORE, HarnessConfigStore);
  container.registerSingleton(
    HARNESS_TOKENS.AGENT_FILE_WRITER,
    HarnessAgentFileWriterService,
  );
  container.registerSingleton(HARNESS_TOKENS.IO_FS, HarnessFsService);
  container.registerSingleton(
    HARNESS_TOKENS.MCP_INSTALL,
    HarnessMcpInstallService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.SKILL_INSTALL,
    HarnessSkillInstallService,
  );
  container.registerSingleton(HARNESS_TOKENS.LLM_RUNNER, HarnessLlmRunner);
  container.registerSingleton(
    HARNESS_TOKENS.SUGGESTION,
    HarnessSuggestionService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.SUBAGENT_DESIGN,
    HarnessSubagentDesignService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.SKILL_GENERATION,
    HarnessSkillGenerationService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.DOCUMENT_GENERATION,
    HarnessDocumentGenerationService,
  );
  container.registerSingleton(
    HARNESS_TOKENS.WORKFLOW_PROMPT,
    HarnessWorkflowPromptService,
  );
  // Last, and a singleton for a reason beyond cost: its constructor subscribes
  // to the reconciler's health stream to drive the `harness:healthChanged`
  // push. A transient would add a listener per resolve and push N copies.
  container.registerSingleton(HARNESS_TOKENS.HEALTH, HarnessHealthRpcService);
  // Holds no subscription and no state of its own — every answer is read off
  // disk per call — so the singleton here is cost, not correctness.
  container.registerSingleton(
    HARNESS_TOKENS.SKILL_SELECTION,
    HarnessSkillSelectionRpcService,
  );
}

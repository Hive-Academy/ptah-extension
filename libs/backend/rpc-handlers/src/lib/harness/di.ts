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
 *                                         document-generation, chat,
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
import { HarnessFsService } from './io/harness-fs.service';
import { HarnessLlmRunner } from './ai/harness-llm-runner.service';
import { HarnessSuggestionService } from './ai/harness-suggestion.service';
import { HarnessSubagentDesignService } from './ai/harness-subagent-design.service';
import { HarnessSkillGenerationService } from './ai/harness-skill-generation.service';
import { HarnessDocumentGenerationService } from './ai/harness-document-generation.service';
import { HarnessChatService } from './ai/harness-chat.service';

export { HARNESS_TOKENS } from './tokens';

export function registerHarnessServices(container: DependencyContainer): void {
  // Leaf-level services (no sibling harness deps) first.
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

  // Services that depend on the leaf trio above.
  container.registerSingleton(HARNESS_TOKENS.CONFIG_STORE, HarnessConfigStore);
  container.registerSingleton(HARNESS_TOKENS.IO_FS, HarnessFsService);
  container.registerSingleton(HARNESS_TOKENS.LLM_RUNNER, HarnessLlmRunner);

  // AI services depend on stream broadcaster + workspace context + llm runner.
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
  container.registerSingleton(HARNESS_TOKENS.CHAT, HarnessChatService);
}

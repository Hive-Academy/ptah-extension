/**
 * Chat sub-service DI registration.
 *
 * Registers the extracted chat services as tsyringe singletons bound
 * to the tokens in `./tokens.ts`.
 *
 * Must be invoked once during app bootstrap, BEFORE
 * `registerAllRpcHandlers(container)` resolves `ChatRpcHandlers`.
 *
 * Registration order matches the service-to-service dependency DAG so
 * transitive resolutions succeed regardless of tsyringe's lazy behaviour:
 *
 *   PREMIUM_CONTEXT           ← (no chat deps)
 *   PTAH_CLI                  ← PREMIUM_CONTEXT
 *   STREAM_BROADCASTER        ← PTAH_CLI
 *   SUBAGENT_CONTEXT_INJECTOR ← PTAH_CLI
 *   SLASH_COMMAND_ROUTER      ← PREMIUM_CONTEXT, STREAM_BROADCASTER
 *   SESSION                   ← all of the above
 *
 * Re-exports `CHAT_TOKENS` for ergonomic import at call sites.
 */

import type { DependencyContainer } from 'tsyringe';

import { CHAT_TOKENS } from './tokens';
import { ChatPremiumContextService } from './session/chat-premium-context.service';
import { ChatPtahCliService } from './ptah-cli/chat-ptah-cli.service';
import { ChatStreamBroadcaster } from './streaming/chat-stream-broadcaster.service';
import { ChatSubagentContextInjectorService } from './session/chat-subagent-context-injector.service';
import { ChatSlashCommandRouterService } from './session/chat-slash-command-router.service';
import { ChatSessionService } from './session/chat-session.service';

export { CHAT_TOKENS } from './tokens';

export function registerChatServices(container: DependencyContainer): void {
  // Leaf-level service — depends only on framework collaborators.
  container.registerSingleton(
    CHAT_TOKENS.PREMIUM_CONTEXT,
    ChatPremiumContextService,
  );

  // Depends on PREMIUM_CONTEXT.
  container.registerSingleton(CHAT_TOKENS.PTAH_CLI, ChatPtahCliService);

  // Depends on PTAH_CLI.
  container.registerSingleton(
    CHAT_TOKENS.STREAM_BROADCASTER,
    ChatStreamBroadcaster,
  );

  // Depends on PTAH_CLI (for transcript existence checks).
  container.registerSingleton(
    CHAT_TOKENS.SUBAGENT_CONTEXT_INJECTOR,
    ChatSubagentContextInjectorService,
  );

  // Depends on PREMIUM_CONTEXT, STREAM_BROADCASTER.
  container.registerSingleton(
    CHAT_TOKENS.SLASH_COMMAND_ROUTER,
    ChatSlashCommandRouterService,
  );

  // Depends on PREMIUM_CONTEXT, PTAH_CLI, STREAM_BROADCASTER,
  // SUBAGENT_CONTEXT_INJECTOR, SLASH_COMMAND_ROUTER.
  container.registerSingleton(CHAT_TOKENS.SESSION, ChatSessionService);
}

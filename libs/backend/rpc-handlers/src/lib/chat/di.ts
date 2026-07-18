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
 *   SDK_CONTEXT               ← (no chat deps)
 *   PTAH_CLI                  ← SDK_CONTEXT
 *   STREAM_BROADCASTER        ← PTAH_CLI
 *   SUBAGENT_CONTEXT_INJECTOR ← PTAH_CLI
 *   SLASH_COMMAND_ROUTER      ← SDK_CONTEXT, STREAM_BROADCASTER
 *   SESSION                   ← all of the above
 *
 * Re-exports `CHAT_TOKENS` for ergonomic import at call sites.
 */

import type { DependencyContainer } from 'tsyringe';

import { CHAT_TOKENS } from './tokens';
import { ChatSdkContextService } from './session/chat-sdk-context.service';
import { ChatPtahCliService } from './ptah-cli/chat-ptah-cli.service';
import { ChatStreamBroadcaster } from './streaming/chat-stream-broadcaster.service';
import { ChatSubagentContextInjectorService } from './session/chat-subagent-context-injector.service';
import { ChatSlashCommandRouterService } from './session/chat-slash-command-router.service';
import { ChatSessionService } from './session/chat-session.service';

export { CHAT_TOKENS } from './tokens';

export function registerChatServices(container: DependencyContainer): void {
  container.registerSingleton(CHAT_TOKENS.SDK_CONTEXT, ChatSdkContextService);
  container.registerSingleton(CHAT_TOKENS.PTAH_CLI, ChatPtahCliService);
  container.registerSingleton(
    CHAT_TOKENS.STREAM_BROADCASTER,
    ChatStreamBroadcaster,
  );
  container.registerSingleton(
    CHAT_TOKENS.SUBAGENT_CONTEXT_INJECTOR,
    ChatSubagentContextInjectorService,
  );
  container.registerSingleton(
    CHAT_TOKENS.SLASH_COMMAND_ROUTER,
    ChatSlashCommandRouterService,
  );
  container.registerSingleton(CHAT_TOKENS.SESSION, ChatSessionService);
}

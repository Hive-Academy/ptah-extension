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
 * `SESSION` also resolves `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION`, which is
 * NOT registered here — `registerOutputStyleServices` owns it, because the
 * CLI-agent spawn path in `cli-agent-runtime` needs the same composition and
 * cannot import this lib. Every host already calls both.
 *
 * Re-exports `CHAT_TOKENS` for ergonomic import at call sites.
 */

import type { DependencyContainer } from 'tsyringe';

import { OUTPUT_STYLE_TOKENS } from '@ptah-extension/output-styles';

import { CHAT_TOKENS } from './tokens';
import { ChatSdkContextService } from './session/chat-sdk-context.service';
import { ChatPtahCliService } from './ptah-cli/chat-ptah-cli.service';
import { ChatStreamBroadcaster } from './streaming/chat-stream-broadcaster.service';
import { ChatSubagentContextInjectorService } from './session/chat-subagent-context-injector.service';
import { ChatSlashCommandRouterService } from './session/chat-slash-command-router.service';
import { ChatSessionService } from './session/chat-session.service';

export { CHAT_TOKENS } from './tokens';

export function registerChatServices(container: DependencyContainer): void {
  assertOutputStyleServicesRegistered(container);
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
  // No output-style registration here. `OutputStyleSessionActivationService`
  // moved to `output-styles` when the CLI-agent spawn path started needing the
  // same composition, and `registerOutputStyleServices` — which every host
  // already calls — binds it under `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION`.
  container.registerSingleton(CHAT_TOKENS.SESSION, ChatSessionService);
}

/**
 * Fail at BOOTSTRAP, not at the first message the user sends.
 *
 * `ChatSessionService` injects `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION`, which
 * lives in `output-styles` rather than here because the CLI-agent spawn path
 * needs the same composition and cannot import this lib. That turned a
 * within-lib registration into a CROSS-lib precondition: a host that calls
 * `registerChatServices` without `registerOutputStyleServices` still boots
 * cleanly and then throws on the first session start, in a stack that names
 * neither function.
 *
 * Every host already satisfies this, and by phase ordering rather than luck —
 * output-styles registers in phase 2 (`phase-2-libraries.ts`) or at
 * `container.ts:526`, chat in phase 3/4 or at `container.ts:684`. The check
 * exists so a FOURTH host, or a reordering, says so immediately.
 *
 * `isRegistered(token, true)` recurses to parent containers, so a child
 * container that inherits the registration passes.
 */
function assertOutputStyleServicesRegistered(
  container: DependencyContainer,
): void {
  if (container.isRegistered(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, true)) {
    return;
  }
  throw new Error(
    'registerChatServices(): registerOutputStyleServices(container, logger) ' +
      'must run first — ChatSessionService injects ' +
      'OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, which output-styles owns. ' +
      'Call it during library registration (phase 2), before chat services.',
  );
}

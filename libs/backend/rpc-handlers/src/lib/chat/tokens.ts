/**
 * Chat sub-service DI tokens.
 *
 * Symbol-based tokens used by `ChatRpcHandlers` (and the chat sub-services
 * themselves, for service-to-service injection) to resolve the extracted
 * chat services from the tsyringe container.
 *
 * Registered via `registerChatServices(container)` — see `./di.ts`.
 */
export const CHAT_TOKENS = {
  SDK_CONTEXT: Symbol.for('ChatSdkContextService'),
  PTAH_CLI: Symbol.for('ChatPtahCliService'),
  SESSION: Symbol.for('ChatSessionService'),
  STREAM_BROADCASTER: Symbol.for('ChatStreamBroadcaster'),
  SUBAGENT_CONTEXT_INJECTOR: Symbol.for('ChatSubagentContextInjectorService'),
  SLASH_COMMAND_ROUTER: Symbol.for('ChatSlashCommandRouterService'),
} as const;

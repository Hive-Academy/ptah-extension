/**
 * Chat Library Services - Barrel Export
 *
 * ARCHITECTURE: Chat-specific orchestration and UI state management
 *
 * SERVICES:
 * - ChatService: Main orchestrator for chat operations
 * - ChatStateManagerService: UI state management (sessions, agents, input)
 *
 * DEPENDENCIES:
 * - Core Services: ChatStateService, MessageProcessingService, ChatValidationService, etc.
 * - Shared Types: From @ptah-extension/shared
 */

// Main chat orchestration
export * from './chat.service';
export * from './chat-state-manager.service';

// Re-export types for convenience
export type { StreamConsumptionState } from './chat.service';
export type { AgentOption } from './chat-state-manager.service';

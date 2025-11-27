/**
 * Chat Library - Main Entry Point
 *
 * ARCHITECTURE: Chat feature library for Ptah Extension
 *
 * EXPORTS:
 * - Components: ChatComponent and related UI components
 * - Services: Chat-specific services (ChatStateManagerService, FilePickerService)
 * - Types: AgentOption, ChatFile, FileSuggestion
 */

export * from './lib/components';
// Containers removed (TASK_2025_023) - use ChatViewComponent from components
export * from './lib/services';

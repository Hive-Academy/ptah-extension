/**
 * Chat Library - Main Entry Point
 *
 * ARCHITECTURE: Chat feature library for Ptah Extension
 *
 * EXPORTS:
 * - Components: ChatComponent and related UI components
 * - Settings: SettingsComponent and AuthConfigComponent
 * - Services: Chat-specific services (ChatStateManagerService, FilePickerService)
 * - Types: AgentOption, ChatFile, FileSuggestion
 */

export * from './lib/components';
export * from './lib/settings';
export * from './lib/services';
export * from './lib/directives';

export { UpdateDialogService } from './lib/update-dialog/update-dialog.service';
export { UpdateDialogComponent } from './lib/update-dialog/update-dialog.component';

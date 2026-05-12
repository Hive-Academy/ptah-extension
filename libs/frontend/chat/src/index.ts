/**
 * Chat Library - Main Entry Point
 *
 * ARCHITECTURE: Chat feature library for Ptah Extension
 *
 * EXPORTS:
 * - Components: ChatComponent and related UI components
 * - Settings: SettingsComponent and AuthConfigComponent (TASK_2025_057)
 * - Services: Chat-specific services (ChatStateManagerService, FilePickerService)
 * - Types: AgentOption, ChatFile, FileSuggestion
 */

export * from './lib/components';
// Containers removed (TASK_2025_023) - use ChatViewComponent from components
export * from './lib/settings';
export * from './lib/services';
export * from './lib/directives';

// === TASK_2026_117_UPDATE_UX_BEGIN ===
export { UpdateBannerService } from './lib/update-banner/update-banner.service';
export { UpdateBannerComponent } from './lib/update-banner/update-banner.component';
// === TASK_2026_117_UPDATE_UX_END ===

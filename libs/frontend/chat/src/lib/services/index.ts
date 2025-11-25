// Chat-specific services (moved from core for better library boundaries)
export {
  ChatStateManagerService,
  type AgentOption,
} from './chat-state-manager.service';
export {
  FilePickerService,
  type ChatFile,
  type FileSuggestion,
} from './file-picker.service';

// LEGACY: ChatStoreService (will be removed in integration phase)
export { ChatStoreService } from './chat-store.service';

// NEW: ChatStore - Signal-based reactive store (TASK_2025_023)
export { ChatStore } from './chat.store';

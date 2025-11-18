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

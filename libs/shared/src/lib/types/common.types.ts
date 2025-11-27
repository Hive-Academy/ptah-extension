import { StrictChatMessage, StrictChatSession } from './message.types';

/**
 * @deprecated Use StrictChatMessage from message.types.ts for type safety
 * This interface is kept for backward compatibility only
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tokenCount?: number;
  files?: string[];
  streaming?: boolean;
  isError?: boolean;
}

/**
 * Strict replacement for ChatMessage - use this for new code
 */
export type { StrictChatMessage };

/**
 * @deprecated Use StrictChatSession from message.types.ts for type safety
 * This interface is kept for backward compatibility only
 */
export interface ChatSession {
  id: string;
  name: string;
  workspaceId?: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastActiveAt: Date;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Strict replacement for ChatSession - use this for new code
 */
export type { StrictChatSession };

export interface ContextInfo {
  includedFiles: string[];
  excludedFiles: string[];
  tokenEstimate: number;
  optimizations: OptimizationSuggestion[];
}

export interface OptimizationSuggestion {
  type: 'exclude_pattern' | 'include_only' | 'summarize';
  description: string;
  estimatedSavings: number;
  autoApplicable: boolean;
  files?: string[];
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  type: string;
}

export interface TokenUsage {
  used: number;
  max: number;
  cost?: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
}

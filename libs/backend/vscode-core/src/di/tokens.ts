/**
 * DI Token Symbols - Type-safe dependency injection tokens
 * Eliminates string-based tokens to prevent typos and improve type safety
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 176-194
 */

// VS Code API tokens
export const EXTENSION_CONTEXT = Symbol('ExtensionContext');
export const WEBVIEW_PROVIDER = Symbol('WebviewProvider');
export const COMMAND_REGISTRY = Symbol('CommandRegistry');

// Messaging system tokens
export const EVENT_BUS = Symbol('EventBus');
export const MESSAGE_ROUTER = Symbol('MessageRouter');

// Provider system tokens
export const AI_PROVIDER_FACTORY = Symbol('AIProviderFactory');
export const AI_PROVIDER_MANAGER = Symbol('AIProviderManager');

// Business logic service tokens
export const CLAUDE_SERVICE = Symbol('ClaudeService');
export const SESSION_MANAGER = Symbol('SessionManager');
export const WORKSPACE_ANALYZER = Symbol('WorkspaceAnalyzer');

/**
 * TOKENS constant for convenient access to all DI tokens
 * Provides a single source of truth for all dependency injection symbols
 */
export const TOKENS = {
  // VS Code APIs
  EXTENSION_CONTEXT,
  WEBVIEW_PROVIDER,
  COMMAND_REGISTRY,
  
  // Messaging
  EVENT_BUS,
  MESSAGE_ROUTER,
  
  // Providers
  AI_PROVIDER_FACTORY,
  AI_PROVIDER_MANAGER,
  
  // Business Logic
  CLAUDE_SERVICE,
  SESSION_MANAGER,
  WORKSPACE_ANALYZER
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
/**
 * Message Registry - Dynamic Message Type Management
 *
 * **PURPOSE**: Single source of truth for message type categorization and iteration.
 * Replaces hardcoded string arrays in MessageHandlerService with compile-time safe, DRY approach.
 *
 * **USAGE**:
 * - Backend: Loop through MESSAGE_REGISTRY.getAllTypes() for dynamic subscriptions
 * - Frontend: Use MESSAGE_REGISTRY.getCategory() to subscribe to specific message groups
 * - Testing: Validate message types against registry
 *
 * **BENEFITS**:
 * - No string duplication (DRY principle)
 * - Compile-time safety through constant references
 * - Automatic sync with MESSAGE_TYPES
 * - Easy categorization and filtering
 */

import {
  CHAT_MESSAGE_TYPES,
  CHAT_RESPONSE_TYPES,
  PROVIDER_MESSAGE_TYPES,
  PROVIDER_RESPONSE_TYPES,
  CONTEXT_MESSAGE_TYPES,
  CONTEXT_RESPONSE_TYPES,
  COMMAND_MESSAGE_TYPES,
  COMMAND_RESPONSE_TYPES,
  ANALYTICS_MESSAGE_TYPES,
  ANALYTICS_RESPONSE_TYPES,
  CONFIG_MESSAGE_TYPES,
  CONFIG_RESPONSE_TYPES,
  STATE_MESSAGE_TYPES,
  STATE_RESPONSE_TYPES,
  VIEW_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
} from './message-types';

/**
 * Message Categories - Organized by domain
 */
export const MESSAGE_CATEGORIES = {
  CHAT: Object.values(CHAT_MESSAGE_TYPES),
  CHAT_RESPONSE: Object.values(CHAT_RESPONSE_TYPES),
  PROVIDER: Object.values(PROVIDER_MESSAGE_TYPES),
  PROVIDER_RESPONSE: Object.values(PROVIDER_RESPONSE_TYPES),
  CONTEXT: Object.values(CONTEXT_MESSAGE_TYPES),
  CONTEXT_RESPONSE: Object.values(CONTEXT_RESPONSE_TYPES),
  COMMAND: Object.values(COMMAND_MESSAGE_TYPES),
  COMMAND_RESPONSE: Object.values(COMMAND_RESPONSE_TYPES),
  ANALYTICS: Object.values(ANALYTICS_MESSAGE_TYPES),
  ANALYTICS_RESPONSE: Object.values(ANALYTICS_RESPONSE_TYPES),
  CONFIG: Object.values(CONFIG_MESSAGE_TYPES),
  CONFIG_RESPONSE: Object.values(CONFIG_RESPONSE_TYPES),
  STATE: Object.values(STATE_MESSAGE_TYPES),
  STATE_RESPONSE: Object.values(STATE_RESPONSE_TYPES),
  VIEW: Object.values(VIEW_MESSAGE_TYPES),
  SYSTEM: Object.values(SYSTEM_MESSAGE_TYPES),
} as const;

/**
 * Category names for type-safe access
 */
export type MessageCategory = keyof typeof MESSAGE_CATEGORIES;

/**
 * Message Registry API - Helper functions for working with message types
 */
export const MESSAGE_REGISTRY = {
  /**
   * Get all message types across all categories
   * @returns Flat array of all message type strings
   */
  getAllTypes(): readonly string[] {
    return Object.values(MESSAGE_CATEGORIES).flat();
  },

  /**
   * Get message types for a specific category
   * @param category - The category to retrieve
   * @returns Array of message types in that category
   */
  getCategory(category: MessageCategory): readonly string[] {
    return MESSAGE_CATEGORIES[category];
  },

  /**
   * Get all request message types (excludes responses)
   * @returns Array of non-response message types
   */
  getRequestTypes(): readonly string[] {
    return [
      ...MESSAGE_CATEGORIES.CHAT,
      ...MESSAGE_CATEGORIES.PROVIDER,
      ...MESSAGE_CATEGORIES.CONTEXT,
      ...MESSAGE_CATEGORIES.COMMAND,
      ...MESSAGE_CATEGORIES.ANALYTICS,
      ...MESSAGE_CATEGORIES.CONFIG,
      ...MESSAGE_CATEGORIES.STATE,
      ...MESSAGE_CATEGORIES.VIEW,
      ...MESSAGE_CATEGORIES.SYSTEM,
    ];
  },

  /**
   * Get all response message types
   * @returns Array of response message types (ending in :response)
   */
  getResponseTypes(): readonly string[] {
    return [
      ...MESSAGE_CATEGORIES.CHAT_RESPONSE,
      ...MESSAGE_CATEGORIES.PROVIDER_RESPONSE,
      ...MESSAGE_CATEGORIES.CONTEXT_RESPONSE,
      ...MESSAGE_CATEGORIES.COMMAND_RESPONSE,
      ...MESSAGE_CATEGORIES.ANALYTICS_RESPONSE,
      ...MESSAGE_CATEGORIES.CONFIG_RESPONSE,
      ...MESSAGE_CATEGORIES.STATE_RESPONSE,
    ];
  },

  /**
   * Get combined categories (e.g., all CHAT types including responses)
   * @param baseCategory - The base category name (without _RESPONSE suffix)
   * @returns Array combining both request and response types
   */
  getCombinedCategory(
    baseCategory: Exclude<MessageCategory, `${string}_RESPONSE`>
  ): readonly string[] {
    const responseCategory = `${baseCategory}_RESPONSE` as MessageCategory;
    return [
      ...MESSAGE_CATEGORIES[baseCategory],
      ...(this.hasCategory(responseCategory)
        ? MESSAGE_CATEGORIES[responseCategory]
        : []),
    ];
  },

  /**
   * Check if a category exists
   * @param category - Category name to check
   * @returns True if category exists in registry
   */
  hasCategory(category: string): category is MessageCategory {
    return category in MESSAGE_CATEGORIES;
  },

  /**
   * Get categories by domain prefix (e.g., "chat" returns CHAT and CHAT_RESPONSE)
   * @param prefix - Domain prefix to search for
   * @returns Array of category names matching the prefix
   */
  getCategoriesByPrefix(prefix: string): MessageCategory[] {
    const upperPrefix = prefix.toUpperCase();
    return Object.keys(MESSAGE_CATEGORIES).filter((cat) =>
      cat.startsWith(upperPrefix)
    ) as MessageCategory[];
  },

  /**
   * Get total message type count
   * @returns Number of unique message types
   */
  getCount(): number {
    return this.getAllTypes().length;
  },

  /**
   * Export raw categories object for advanced usage
   */
  categories: MESSAGE_CATEGORIES,
} as const;

/**
 * Usage Examples:
 *
 * // Backend: Subscribe to all message types dynamically
 * MESSAGE_REGISTRY.getAllTypes().forEach(type => {
 *   eventBus.subscribe(type, handler);
 * });
 *
 * // Frontend: Subscribe to specific category
 * MESSAGE_REGISTRY.getCategory('CHAT').forEach(type => {
 *   vscodeService.onMessageType(type).subscribe(handler);
 * });
 *
 * // Get all chat-related types (requests + responses)
 * const chatTypes = MESSAGE_REGISTRY.getCombinedCategory('CHAT');
 *
 * // Filter to only response types
 * const responses = MESSAGE_REGISTRY.getResponseTypes();
 */

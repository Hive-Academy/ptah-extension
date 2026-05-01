/**
 * AI Provider Type System - Unified interface for multiple AI providers
 * Supports Claude CLI and VS Code LM API with consistent interfaces
 */

import { SessionId, CorrelationId } from './branded.types';
import type { FlatStreamEventUnion } from './execution';

/**
 * Supported AI Provider IDs
 */
export type ProviderId = 'claude-cli' | 'vscode-lm' | 'ptah-cli';

/**
 * Provider Status Types
 */
export type ProviderStatus =
  | 'available'
  | 'unavailable'
  | 'error'
  | 'initializing'
  | 'disabled';

/**
 * Provider Capability Flags
 */
export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly fileAttachments: boolean;
  readonly contextManagement: boolean;
  readonly sessionPersistence: boolean;
  readonly multiTurn: boolean;
  readonly codeGeneration: boolean;
  readonly imageAnalysis: boolean;
  readonly functionCalling: boolean;
}

/**
 * Provider Information
 */
export interface ProviderInfo {
  readonly id: ProviderId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly vendor: string;
  readonly capabilities: ProviderCapabilities;
  readonly maxContextTokens?: number;
  readonly supportedModels?: readonly string[];
}

/**
 * Provider Health Information
 */
export interface ProviderHealth {
  readonly status: ProviderStatus;
  readonly lastCheck: number;
  readonly errorMessage?: string;
  readonly responseTime?: number;
  readonly uptime?: number;
}

/**
 * AI Message Options
 */
export interface AIMessageOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly files?: string[];
  readonly images?: ReadonlyArray<{ data: string; mediaType: string }>;
  readonly correlationId?: CorrelationId;
  readonly timeout?: number;
  readonly streaming?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * TASK_2025_184: Thinking/reasoning mode configuration for Claude SDK.
 * Controls how Claude uses extended thinking.
 * - adaptive: Claude decides when/how much to think (default for Opus 4.6+)
 * - enabled: Fixed thinking token budget
 * - disabled: No extended thinking
 *
 * Must be serializable (no functions) since it crosses the RPC boundary.
 */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

/**
 * TASK_2025_184: Effort level for Claude's reasoning depth.
 * Works with adaptive thinking to guide thinking depth.
 * - low: Minimal thinking, fastest responses
 * - medium: Moderate thinking
 * - high: Deep reasoning (SDK default)
 * - xhigh: Extra-deep reasoning (Opus tier)
 * - max: Maximum effort (Opus tier)
 *
 * When undefined, SDK defaults to 'high'.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * AI Session Configuration
 */
export interface AISessionConfig {
  readonly projectPath?: string;
  readonly workspaceId?: string;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly temperature?: number;
  /**
   * TASK_2025_095: Frontend tab ID for direct event routing.
   * Used to route session:id-resolved events directly to the correct tab
   * without needing temp session ID lookup.
   */
  readonly tabId?: string;
  /**
   * System prompt preset selection.
   * - 'claude_code': Use default preset with minimal customization
   * - 'enhanced': Use AI-generated project-specific guidance from setup wizard
   *
   * If not specified, defaults to 'enhanced' if enhanced prompts are generated,
   * otherwise falls back to 'claude_code'.
   *
   * For premium users, PTAH_SYSTEM_PROMPT (MCP documentation) is always injected
   * regardless of preset selection when MCP server is running.
   */
  readonly preset?: 'claude_code' | 'enhanced';
  /**
   * TASK_2025_184: Thinking/reasoning configuration for Claude SDK.
   * Controls how Claude uses extended thinking.
   * - adaptive: Claude decides when/how much to think (default for Opus 4.6+)
   * - enabled: Fixed thinking token budget
   * - disabled: No extended thinking
   *
   * When undefined, SDK applies its own default (adaptive for supported models).
   */
  readonly thinking?: ThinkingConfig;
  /**
   * TASK_2025_184: Effort level for Claude's reasoning depth.
   * Works with adaptive thinking to guide thinking depth.
   * - low: Minimal thinking, fastest responses
   * - medium: Moderate thinking
   * - high: Deep reasoning (SDK default)
   * - max: Maximum effort (Opus 4.6 only)
   *
   * When undefined, SDK defaults to 'high'.
   */
  readonly effort?: EffortLevel;
}

/**
 * Provider Error Types
 */
export enum ProviderErrorType {
  INSTALLATION_NOT_FOUND = 'INSTALLATION_NOT_FOUND',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_ALREADY_EXISTS = 'SESSION_ALREADY_EXISTS',
  SESSION_START_FAILED = 'SESSION_START_FAILED',
  STREAMING_ERROR = 'STREAMING_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Provider-specific Error Interface
 */
export interface ProviderError extends Error {
  readonly type: ProviderErrorType;
  readonly providerId: ProviderId;
  readonly recoverable: boolean;
  readonly suggestedAction: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Core AI Provider Interface
 * All AI providers must implement this interface
 */
export interface IAIProvider {
  /**
   * Provider identification
   */
  readonly providerId: ProviderId;
  readonly info: ProviderInfo;

  /**
   * Lifecycle Management
   */
  initialize(): Promise<boolean>;
  dispose(): void;

  /**
   * Health Monitoring
   */
  verifyInstallation(): Promise<boolean>;
  getHealth(): ProviderHealth;
  reset(): Promise<void>;

  /**
   * Start a NEW chat session with streaming support
   *
   * TASK_2025_093: Uses tabId as the primary tracking key for session lifecycle.
   * The real SDK UUID is resolved later via session:id-resolved event.
   *
   * @param config - Session configuration with REQUIRED tabId for multi-tab isolation
   */
  startChatSession(
    config: AISessionConfig & {
      /** REQUIRED: Frontend tab identifier for routing and multi-tab isolation */
      tabId: string;
      /** Session name (optional) */
      name?: string;
      /** Initial prompt to send (optional) */
      prompt?: string;
      /** Files to attach (optional) */
      files?: readonly string[];
      /** Inline images (pasted/dropped) to include with the initial message */
      images?: ReadonlyArray<{ data: string; mediaType: string }>;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>>;
  endSession(sessionId: SessionId): void;
  sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions,
  ): Promise<void>;

  /**
   * Provider-specific Operations
   */
  getAvailableModels?(): Promise<readonly string[]>;
  attemptRecovery?(sessionId?: SessionId): Promise<boolean>;

  /**
   * Event Handling
   */
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Provider Factory Interface
 */
export interface IProviderFactory {
  createProvider(providerId: ProviderId): Promise<IAIProvider>;
  getAvailableProviders(): Promise<readonly ProviderId[]>;
  getProviderInfo(providerId: ProviderId): ProviderInfo | undefined;
}

/**
 * Provider Manager Interface
 */
export interface IProviderManager {
  /**
   * Provider Management
   */
  getProvider(providerId: ProviderId): IAIProvider | undefined;
  getCurrentProvider(): IAIProvider | undefined;
  switchProvider(providerId: ProviderId): Promise<boolean>;
  getAvailableProviders(): readonly IAIProvider[];

  /**
   * Health Monitoring
   */
  getProviderHealth(providerId: ProviderId): ProviderHealth | undefined;
  getAllProviderHealth(): Record<ProviderId, ProviderHealth>;

  /**
   * Configuration
   */
  setDefaultProvider(providerId: ProviderId): Promise<void>;
  enableFallback(enabled: boolean): void;
  setAutoSwitchOnFailure(enabled: boolean): void;

  /**
   * Event Handling
   */
  on(
    event: 'provider-switched' | 'provider-error' | 'provider-health-changed',
    listener: (data: unknown) => void,
  ): void;
  off(event: string, listener: (data: unknown) => void): void;
}

/**
 * Provider Switch Event Data
 */
export interface ProviderSwitchEvent {
  readonly from: ProviderId | null;
  readonly to: ProviderId;
  readonly reason: 'user-request' | 'auto-fallback' | 'error-recovery';
  readonly timestamp: number;
}

/**
 * Provider Error Event Data
 */
export interface ProviderErrorEvent {
  readonly providerId: ProviderId;
  readonly error: ProviderError;
  readonly timestamp: number;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Provider Health Change Event Data
 */
export interface ProviderHealthChangeEvent {
  readonly providerId: ProviderId;
  readonly previousHealth: ProviderHealth;
  readonly currentHealth: ProviderHealth;
  readonly timestamp: number;
}

/**
 * Type guards
 */
export function isProviderError(error: unknown): error is ProviderError {
  return (
    error instanceof Error &&
    'type' in error &&
    'providerId' in error &&
    'recoverable' in error &&
    'suggestedAction' in error
  );
}

export function isValidProviderId(id: string): id is ProviderId {
  return id === 'claude-cli' || id === 'vscode-lm' || id === 'ptah-cli';
}

/**
 * Provider Constants
 */
export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude-cli',
  'vscode-lm',
  'ptah-cli',
] as const;

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: true,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: false,
  functionCalling: false,
};

export const DEFAULT_AI_MESSAGE_OPTIONS: Partial<AIMessageOptions> = {
  streaming: true,
  timeout: 30000,
  temperature: 0.7,
};

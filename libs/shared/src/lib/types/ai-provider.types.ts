/**
 * AI Provider Type System - Unified interface for multiple AI providers
 * Supports Claude CLI and VS Code LM API with consistent interfaces
 */

// Browser-compatible stream type
type Readable = any; // In browser context, will be replaced with appropriate stream type
import { SessionId, MessageId, CorrelationId } from './branded.types';
import { StrictChatMessage, MessageResponse } from './message.types';

/**
 * Supported AI Provider IDs
 */
export type ProviderId = 'claude-cli' | 'vscode-lm';

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
  readonly files?: readonly string[];
  readonly correlationId?: CorrelationId;
  readonly timeout?: number;
  readonly streaming?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

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
   * Session Management
   */
  startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<Readable>;
  endSession(sessionId: SessionId): void;
  sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
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
    listener: (data: unknown) => void
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
  return id === 'claude-cli' || id === 'vscode-lm';
}

/**
 * Provider Constants
 */
export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude-cli',
  'vscode-lm',
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

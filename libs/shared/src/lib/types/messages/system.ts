/**
 * System / provider / config / state / command / view / initial-data payloads
 * and system message discriminated union.
 */

import type { CommandTemplate } from '../command-builder.types';
import type { WebviewConfiguration } from '../webview-ui.types';

import type { MessagePayloadMap } from './payload-map';
import type { StrictChatSession } from './session';

// ============================================================================
// View Payloads
// ============================================================================

export interface ViewChangedPayload {
  readonly view: string;
  readonly timestamp?: number;
}

export interface ViewRouteChangedPayload {
  readonly route: string;
  readonly previousRoute?: string;
}

export interface ViewGenericPayload {
  readonly data: unknown;
}

// ============================================================================
// Command Payloads
// ============================================================================

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface CommandsGetTemplatesPayload {
  // No payload needed for get templates request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface CommandsExecuteCommandPayload {
  readonly templateId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface CommandsSelectFilePayload {
  readonly multiple?: boolean;
}

export interface CommandsSaveTemplatePayload {
  readonly template: CommandTemplate;
}

// ============================================================================
// Analytics / Config / State Payloads
// ============================================================================

export interface AnalyticsGetDataPayload {
  readonly timestamp?: number;
}

export interface ConfigGetPayload {
  readonly timestamp: number;
}

export interface ConfigUpdatePayload {
  readonly updates: Partial<WebviewConfiguration>;
}

export interface ConfigRefreshPayload {
  readonly timestamp: number;
}

export interface StateSavePayload {
  readonly state: unknown;
}

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface StateLoadPayload {
  // No payload needed for load state request
}

export interface StateClearPayload {
  // No payload needed for clear state request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

// ============================================================================
// Provider Management Payloads
// ============================================================================

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface ProvidersGetAvailablePayload {
  // No payload needed for get available providers request
}

export interface ProvidersGetCurrentPayload {
  // No payload needed for get current provider request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface ProvidersSwitchPayload {
  readonly providerId: string; // ProviderId
  readonly reason?: 'user-request' | 'auto-fallback' | 'error-recovery';
}

export interface ProvidersGetHealthPayload {
  readonly providerId?: string; // ProviderId - optional, if not provided, get current provider health
}

/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface ProvidersGetAllHealthPayload {
  // No payload needed for get all providers health request
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

export interface ProvidersSetDefaultPayload {
  readonly providerId: string; // ProviderId
}

export interface ProvidersEnableFallbackPayload {
  readonly enabled: boolean;
}

export interface ProvidersSetAutoSwitchPayload {
  readonly enabled: boolean;
}

export interface ProvidersSelectModelPayload {
  readonly modelId: string;
  readonly providerId?: string; // Optional - use current provider if omitted
}

export interface ProvidersCurrentChangedPayload {
  readonly from: string | null; // ProviderId | null
  readonly to: string; // ProviderId
  readonly reason: 'user-request' | 'auto-fallback' | 'error-recovery';
  readonly timestamp: number;
}

export interface ProvidersModelChangedPayload {
  readonly modelId: string;
  readonly providerId: string;
  readonly timestamp: number;
}

export interface ProvidersHealthChangedPayload {
  readonly providerId: string; // ProviderId
  readonly health: {
    readonly status:
      | 'available'
      | 'unavailable'
      | 'error'
      | 'initializing'
      | 'disabled';
    readonly lastCheck: number;
    readonly errorMessage?: string;
    readonly responseTime?: number;
    readonly uptime?: number;
  };
}

export interface ProvidersErrorPayload {
  readonly providerId: string; // ProviderId
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly recoverable: boolean;
    readonly suggestedAction: string;
    readonly context?: Readonly<Record<string, unknown>>;
  };
  readonly timestamp: number;
}

export interface ProvidersAvailableUpdatedPayload {
  readonly availableProviders: readonly {
    readonly id: string; // ProviderId
    readonly name: string;
    readonly status:
      | 'available'
      | 'unavailable'
      | 'error'
      | 'initializing'
      | 'disabled';
  }[];
}

// ============================================================================
// Error / Theme / Initial Data Payloads
// ============================================================================

/**
 * Generic error payload for error messages
 */
export interface ErrorPayload {
  readonly code?: string;
  readonly message: string;
  readonly source?: string;
  readonly data?: unknown;
  readonly timestamp?: number;
}

/**
 * Theme changed payload
 */
export interface ThemeChangedPayload {
  readonly theme: 'light' | 'dark' | 'high-contrast';
}

/**
 * Provider information for initial data
 * Subset of ProviderInfo for webview initialization
 */
export interface InitialDataProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly capabilities: Readonly<{
    streaming: boolean;
    fileAttachments: boolean;
    contextManagement: boolean;
    sessionPersistence: boolean;
    multiTurn: boolean;
    codeGeneration: boolean;
    imageAnalysis: boolean;
    functionCalling: boolean;
  }>;
}

/**
 * Provider health for initial data
 */
export interface InitialDataProviderHealth {
  readonly status:
    | 'available'
    | 'unavailable'
    | 'error'
    | 'initializing'
    | 'disabled';
  readonly lastCheck: number;
  readonly errorMessage?: string;
  readonly responseTime?: number;
  readonly uptime?: number;
}

/**
 * Context information for initial data
 */
export interface InitialDataContextInfo {
  readonly includedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  readonly tokenEstimate: number;
  readonly optimizations?: readonly {
    readonly type: 'exclude_pattern' | 'include_only' | 'summarize';
    readonly description: string;
    readonly estimatedSavings: number;
    readonly autoApplicable: boolean;
    readonly files?: readonly string[];
  }[];
}

/**
 * Workspace information for initial data
 */
export interface InitialDataWorkspaceInfo {
  readonly name: string;
  readonly path: string;
  readonly projectType: string;
}

/**
 * Initial data payload for webview initialization
 * Sent by AngularWebviewProvider on webview load
 *
 * CRITICAL: This must match the structure sent in angular-webview.provider.ts sendInitialData()
 */
export interface InitialDataPayload {
  readonly success: boolean;
  readonly data: {
    readonly sessions: readonly StrictChatSession[];
    readonly currentSession: StrictChatSession | null;
    // Provider state (added for type safety)
    readonly providers: {
      readonly current: InitialDataProviderInfo | null;
      readonly available: readonly InitialDataProviderInfo[];
      readonly health: Readonly<Record<string, InitialDataProviderHealth>>;
    };
  };
  readonly config: {
    readonly context: InitialDataContextInfo;
    readonly workspaceInfo: InitialDataWorkspaceInfo | null;
    readonly theme: number; // vscode.ColorThemeKind enum
    readonly isVSCode: boolean;
    readonly extensionVersion: string;
  };
  readonly timestamp: number;
}

// ============================================================================
// System Message / Routable Message / Webview Union
// ============================================================================

/**
 * System Message Payloads - For webview lifecycle messages
 */
/* eslint-disable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */
export interface SystemReadyPayload {
  // No payload needed - just lifecycle notification
}

export interface SystemWebviewReadyPayload {
  // No payload needed - just lifecycle notification
}

export interface SystemRequestInitialDataPayload {
  // No payload needed - just lifecycle notification
}
/* eslint-enable @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type */

/**
 * System Message Payload Map
 */
export interface SystemMessagePayloadMap {
  ready: SystemReadyPayload;
  'webview-ready': SystemWebviewReadyPayload;
  requestInitialData: SystemRequestInitialDataPayload;
}

/**
 * System Message Interface
 */
export interface SystemMessage<
  T extends keyof SystemMessagePayloadMap = keyof SystemMessagePayloadMap,
> {
  readonly type: T;
  readonly payload?: SystemMessagePayloadMap[T];
}

/**
 * Regular routable message interface
 */
export interface RoutableMessage<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap,
> {
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
}

/**
 * Union type for all webview messages (system + routable)
 * This eliminates the 'any' type in handleWebviewMessage
 */
export type WebviewMessage =
  | SystemMessage<keyof SystemMessagePayloadMap>
  | RoutableMessage<keyof MessagePayloadMap>;

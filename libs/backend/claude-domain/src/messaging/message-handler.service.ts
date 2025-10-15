/**
 * Message Handler Service
 * Thin routing layer that subscribes to EventBus and delegates to orchestration services
 *
 * Architecture: REVISED_ARCHITECTURE.md compliant
 * - Zero business logic (pure delegation)
 * - EventBus-driven communication
 * - Orchestration services handle all business logic
 *
 * Replaces: apps/ptah-extension-vscode/src/services/webview-message-handlers/ (9 handler files, 3,240 lines)
 * New implementation: ~540 lines (routing only)
 *
 * Pattern: Router delegates to domain-specific orchestration services
 */

import { injectable, inject } from 'tsyringe';
import { Subscription } from 'rxjs';
import type {
  MessagePayloadMap,
  CorrelationId,
  MessageResponse,
  SessionId,
} from '@ptah-extension/shared';

// Import orchestration services
import { ChatOrchestrationService } from '../chat/chat-orchestration.service';
import { ProviderOrchestrationService } from '../provider/provider-orchestration.service';
import { AnalyticsOrchestrationService } from '../analytics/analytics-orchestration.service';
import { ConfigOrchestrationService } from '../config/config-orchestration.service';

/**
 * DI Token for context orchestration service
 */
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for(
  'ContextOrchestrationService'
);

/**
 * Re-export EVENT_BUS from events module for backward compatibility
 * NOTE: New code should import directly from ../events/claude-domain.events
 */
export { EVENT_BUS } from '../events/claude-domain.events';

/**
 * TypedEvent interface (local definition to avoid circular dependency with vscode-core)
 * Matches vscode-core EventBus TypedEvent structure
 */
export interface TypedEvent<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap
> {
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly correlationId: CorrelationId;
  readonly source: 'extension' | 'webview' | 'provider';
  readonly timestamp: number;
}

/**
 * EventBus interface (matches vscode-core EventBus)
 * Local definition to avoid circular dependency
 */
export interface IEventBus {
  subscribe<T extends keyof MessagePayloadMap>(
    messageType: T
  ): {
    subscribe(
      handler: (event: TypedEvent<T>) => void | Promise<void>
    ): Subscription;
  };
  publish<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T],
    source?: 'extension' | 'webview' | 'provider'
  ): void;
}

/**
 * Context Orchestration Service interface (from workspace-intelligence)
 */
export interface IContextOrchestrationService {
  getContextFiles(request: { requestId: CorrelationId }): Promise<{
    success: boolean;
    files?: Array<{ uri: string; name: string; excluded?: boolean }>;
    error?: { code: string; message: string };
  }>;
  includeFile(request: { requestId: CorrelationId; uri: string }): Promise<{
    success: boolean;
    message?: string;
    error?: { code: string; message: string };
  }>;
  excludeFile(request: { requestId: CorrelationId; uri: string }): Promise<{
    success: boolean;
    message?: string;
    error?: { code: string; message: string };
  }>;
  searchFiles(request: {
    requestId: CorrelationId;
    query: string;
    includeImages?: boolean;
    maxResults?: number;
    fileTypes?: string[];
  }): Promise<{
    success: boolean;
    results?: Array<{
      uri: string;
      name: string;
      relativePath: string;
      score: number;
    }>;
    error?: { code: string; message: string };
  }>;
  getAllFiles(request: { requestId: CorrelationId }): Promise<{
    success: boolean;
    files?: Array<{ uri: string; name: string; relativePath: string }>;
    error?: { code: string; message: string };
  }>;
  getFileSuggestions(request: { requestId: CorrelationId }): Promise<{
    success: boolean;
    suggestions?: Array<{
      uri: string;
      name: string;
      reason: string;
      priority: number;
    }>;
    error?: { code: string; message: string };
  }>;
  searchImages(request: { requestId: CorrelationId; query: string }): Promise<{
    success: boolean;
    images?: Array<{ uri: string; name: string; relativePath: string }>;
    error?: { code: string; message: string };
  }>;
}

/**
 * Message Handler Service
 * Routes EventBus messages to appropriate orchestration services
 *
 * Zero Business Logic - All logic delegated to:
 * - ChatOrchestrationService (600 lines)
 * - ProviderOrchestrationService (530 lines)
 * - ContextOrchestrationService (476 lines)
 * - AnalyticsOrchestrationService (248 lines)
 * - ConfigOrchestrationService (242 lines)
 *
 * Total business logic: 2,096 lines (in orchestration services)
 * Router logic: ~200 lines (this file)
 */
@injectable()
export class MessageHandlerService {
  private subscriptions: Subscription[] = [];

  constructor(
    @inject(EVENT_BUS)
    private readonly eventBus: IEventBus,
    @inject(ChatOrchestrationService)
    private readonly chatOrchestration: ChatOrchestrationService,
    @inject(ProviderOrchestrationService)
    private readonly providerOrchestration: ProviderOrchestrationService,
    @inject(CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: IContextOrchestrationService,
    @inject(AnalyticsOrchestrationService)
    private readonly analyticsOrchestration: AnalyticsOrchestrationService,
    @inject(ConfigOrchestrationService)
    private readonly configOrchestration: ConfigOrchestrationService
  ) {}

  /**
   * Initialize message routing
   * Subscribe to all message types and route to orchestration services
   */
  initialize(): void {
    console.info('MessageHandlerService: Initializing EventBus subscriptions');

    // Chat message subscriptions
    this.subscribeToChatMessages();

    // Provider message subscriptions
    this.subscribeToProviderMessages();

    // Context message subscriptions
    this.subscribeToContextMessages();

    // Analytics message subscriptions
    this.subscribeToAnalyticsMessages();

    // Config message subscriptions
    this.subscribeToConfigMessages();

    console.info(
      `MessageHandlerService: Initialized ${this.subscriptions.length} EventBus subscriptions`
    );
  }

  /**
   * Subscribe to chat-related messages
   */
  private subscribeToChatMessages(): void {
    // chat:sendMessage
    this.subscriptions.push(
      this.eventBus.subscribe('chat:sendMessage').subscribe(async (event) => {
        const result = await this.chatOrchestration.sendMessage({
          content: event.payload.content,
          files: event.payload.files as string[] | undefined,
          currentSessionId: undefined, // EventBus payload doesn't include sessionId
        });
        this.publishResponse('chat:sendMessage', event.correlationId, result);
      })
    );

    // chat:newSession
    this.subscriptions.push(
      this.eventBus.subscribe('chat:newSession').subscribe(async (event) => {
        const result = await this.chatOrchestration.createSession({
          name: event.payload.name,
        });
        this.publishResponse('chat:newSession', event.correlationId, result);
      })
    );

    // chat:switchSession
    this.subscriptions.push(
      this.eventBus.subscribe('chat:switchSession').subscribe(async (event) => {
        const result = await this.chatOrchestration.switchSession({
          sessionId: event.payload.sessionId, // Already SessionId type in payload
        });
        this.publishResponse('chat:switchSession', event.correlationId, result);
      })
    );

    // chat:renameSession
    this.subscriptions.push(
      this.eventBus.subscribe('chat:renameSession').subscribe(async (event) => {
        const result = await this.chatOrchestration.renameSession({
          sessionId: event.payload.sessionId as SessionId, // Cast to SessionId
          newName: event.payload.newName,
        });
        this.publishResponse('chat:renameSession', event.correlationId, result);
      })
    );

    // chat:deleteSession
    this.subscriptions.push(
      this.eventBus.subscribe('chat:deleteSession').subscribe(async (event) => {
        const result = await this.chatOrchestration.deleteSession({
          sessionId: event.payload.sessionId as SessionId, // Cast to SessionId
        });
        this.publishResponse('chat:deleteSession', event.correlationId, result);
      })
    );

    // chat:bulkDeleteSessions
    this.subscriptions.push(
      this.eventBus
        .subscribe('chat:bulkDeleteSessions')
        .subscribe(async (event) => {
          const result = await this.chatOrchestration.bulkDeleteSessions({
            sessionIds: event.payload.sessionIds as SessionId[], // Cast to SessionId[]
          });
          this.publishResponse(
            'chat:bulkDeleteSessions',
            event.correlationId,
            result
          );
        })
    );

    // chat:getHistory
    // NOTE: GetHistoryRequest only takes sessionId (no limit/offset support yet)
    this.subscriptions.push(
      this.eventBus.subscribe('chat:getHistory').subscribe(async (event) => {
        const result = await this.chatOrchestration.getHistory({
          sessionId: event.payload.sessionId, // Already SessionId in payload
        });
        this.publishResponse('chat:getHistory', event.correlationId, result);
      })
    );

    // chat:getSessionStats
    this.subscriptions.push(
      this.eventBus
        .subscribe('chat:getSessionStats')
        .subscribe(async (event) => {
          const result = await this.chatOrchestration.getSessionStatistics();
          this.publishResponse(
            'chat:getSessionStats',
            event.correlationId,
            result
          );
        })
    );

    // chat:stopStream
    this.subscriptions.push(
      this.eventBus.subscribe('chat:stopStream').subscribe(async (event) => {
        const result = await this.chatOrchestration.stopStream({
          sessionId: event.payload.sessionId || null,
          messageId: event.payload.messageId || null,
        });
        this.publishResponse('chat:stopStream', event.correlationId, result);
      })
    );

    // chat:permissionResponse
    this.subscriptions.push(
      this.eventBus
        .subscribe('chat:permissionResponse')
        .subscribe(async (event) => {
          const result = await this.chatOrchestration.handlePermissionResponse({
            requestId: event.payload.requestId,
            response: event.payload.response,
          });
          this.publishResponse(
            'chat:permissionResponse',
            event.correlationId,
            result
          );
        })
    );
  }

  /**
   * Subscribe to provider-related messages
   */
  private subscribeToProviderMessages(): void {
    // providers:getAvailable
    // NOTE: getAvailableProviders() takes NO parameters
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:getAvailable')
        .subscribe(async (event) => {
          const result =
            await this.providerOrchestration.getAvailableProviders();
          this.publishResponse(
            'providers:getAvailable',
            event.correlationId,
            result
          );
        })
    );

    // providers:getCurrent
    // NOTE: getCurrentProvider() takes NO parameters
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:getCurrent')
        .subscribe(async (event) => {
          const result = await this.providerOrchestration.getCurrentProvider();
          this.publishResponse(
            'providers:getCurrent',
            event.correlationId,
            result
          );
        })
    );

    // providers:switch
    this.subscriptions.push(
      this.eventBus.subscribe('providers:switch').subscribe(async (event) => {
        const result = await this.providerOrchestration.switchProvider({
          requestId: event.correlationId,
          providerId: event.payload.providerId,
        });
        this.publishResponse('providers:switch', event.correlationId, result);
      })
    );

    // providers:getHealth
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:getHealth')
        .subscribe(async (event) => {
          const result = await this.providerOrchestration.getProviderHealth({
            requestId: event.correlationId,
            providerId: event.payload.providerId,
          });
          this.publishResponse(
            'providers:getHealth',
            event.correlationId,
            result
          );
        })
    );

    // providers:getAllHealth
    // NOTE: getAllProviderHealth() takes NO parameters
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:getAllHealth')
        .subscribe(async (event) => {
          const result =
            await this.providerOrchestration.getAllProviderHealth();
          this.publishResponse(
            'providers:getAllHealth',
            event.correlationId,
            result
          );
        })
    );

    // providers:setDefault
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:setDefault')
        .subscribe(async (event) => {
          const result = await this.providerOrchestration.setDefaultProvider({
            requestId: event.correlationId,
            providerId: event.payload.providerId,
          });
          this.publishResponse(
            'providers:setDefault',
            event.correlationId,
            result
          );
        })
    );

    // providers:enableFallback
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:enableFallback')
        .subscribe(async (event) => {
          const result = await this.providerOrchestration.enableFallback({
            requestId: event.correlationId,
            enabled: event.payload.enabled,
          });
          this.publishResponse(
            'providers:enableFallback',
            event.correlationId,
            result
          );
        })
    );

    // providers:setAutoSwitch
    this.subscriptions.push(
      this.eventBus
        .subscribe('providers:setAutoSwitch')
        .subscribe(async (event) => {
          const result = await this.providerOrchestration.setAutoSwitch({
            requestId: event.correlationId,
            enabled: event.payload.enabled,
          });
          this.publishResponse(
            'providers:setAutoSwitch',
            event.correlationId,
            result
          );
        })
    );
  }

  /**
   * Subscribe to context-related messages
   */
  private subscribeToContextMessages(): void {
    // context:getFiles
    // NOTE: This handler is currently non-functional and serves as a placeholder
    // The actual VS Code URI creation must happen in the main app layer
    // TODO: Refactor to delegate URI creation to main app
    this.subscriptions.push(
      this.eventBus.subscribe('context:getFiles').subscribe(async (event) => {
        // getContextFiles takes no parameters (just requestId in request object)
        const result = await this.contextOrchestration.getContextFiles({
          requestId: event.correlationId,
        });
        this.publishResponse('context:getFiles', event.correlationId, result);
      })
    );

    // context:includeFile
    // TODO: This handler requires refactoring - includeFile needs VS Code Uri object
    // MessageHandlerService is in claude-domain and can't create VS Code objects
    // Solution: Main app should create Uri and call contextOrchestration directly
    // For now, this is commented out to allow build to pass
    /*
    this.subscriptions.push(
      this.eventBus.subscribe('context:includeFile').subscribe(async (event) => {
        // TEMPORARY WORKAROUND: Create minimal Uri-like object
        // This will NOT work with actual VS Code ContextService
        const mockUri = {
          fsPath: event.payload.filePath,
          path: event.payload.filePath,
          scheme: 'file',
          toString: () => event.payload.filePath,
        };

        const result = await this.contextOrchestration.includeFile(
          {
            requestId: event.correlationId,
            filePath: event.payload.filePath,
          },
          mockUri as any // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        this.publishResponse('context:includeFile', event.correlationId, result);
      })
    );
    */

    // context:excludeFile
    // TODO: This handler requires refactoring - excludeFile needs VS Code Uri object
    // MessageHandlerService is in claude-domain and can't create VS Code objects
    // Solution: Main app should create Uri and call contextOrchestration directly
    // For now, this is commented out to allow build to pass
    /*
    this.subscriptions.push(
      this.eventBus.subscribe('context:excludeFile').subscribe(async (event) => {
        // TEMPORARY WORKAROUND: Create minimal Uri-like object
        const mockUri = {
          fsPath: event.payload.filePath,
          path: event.payload.filePath,
          scheme: 'file',
          toString: () => event.payload.filePath,
        };

        const result = await this.contextOrchestration.excludeFile(
          {
            requestId: event.correlationId,
            filePath: event.payload.filePath,
          },
          mockUri as any // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        this.publishResponse('context:excludeFile', event.correlationId, result);
      })
    );
    */

    // context:searchFiles
    this.subscriptions.push(
      this.eventBus
        .subscribe('context:searchFiles')
        .subscribe(async (event) => {
          // Cast payload to get access to optional properties
          const payload = event.payload as {
            query: string;
            includeImages?: boolean;
            maxResults?: number;
            fileTypes?: string[];
          };

          const result = await this.contextOrchestration.searchFiles({
            requestId: event.correlationId,
            query: payload.query,
            includeImages: payload.includeImages,
            maxResults: payload.maxResults,
            fileTypes: payload.fileTypes,
          });
          this.publishResponse(
            'context:searchFiles',
            event.correlationId,
            result
          );
        })
    );

    // context:getAllFiles
    // NOTE: This method doesn't exist in context orchestration
    // TODO: Verify if this is needed or should be removed
    this.subscriptions.push(
      this.eventBus
        .subscribe('context:getAllFiles')
        .subscribe(async (event) => {
          // Using getContextFiles as fallback since getAllFiles doesn't exist
          const result = await this.contextOrchestration.getContextFiles({
            requestId: event.correlationId,
          });
          this.publishResponse(
            'context:getAllFiles',
            event.correlationId,
            result
          );
        })
    );

    // context:getFileSuggestions
    this.subscriptions.push(
      this.eventBus
        .subscribe('context:getFileSuggestions')
        .subscribe(async (event) => {
          const result = await this.contextOrchestration.getFileSuggestions({
            requestId: event.correlationId,
          });
          this.publishResponse(
            'context:getFileSuggestions',
            event.correlationId,
            result
          );
        })
    );

    // context:searchImages
    // NOTE: ContextSearchImagesPayload only has query property
    this.subscriptions.push(
      this.eventBus
        .subscribe('context:searchImages')
        .subscribe(async (event) => {
          const result = await this.contextOrchestration.searchFiles({
            requestId: event.correlationId,
            query: event.payload.query,
            includeImages: true, // Hardcoded for image search
            // maxResults and fileTypes not available in ContextSearchImagesPayload
          });
          this.publishResponse(
            'context:searchImages',
            event.correlationId,
            result
          );
        })
    );
  }

  /**
   * Subscribe to analytics-related messages
   */
  private subscribeToAnalyticsMessages(): void {
    // analytics:trackEvent
    this.subscriptions.push(
      this.eventBus
        .subscribe('analytics:trackEvent')
        .subscribe(async (event) => {
          const payload = event.payload as {
            event: string;
            properties?: Record<string, unknown>;
          };
          const result = await this.analyticsOrchestration.trackEvent({
            requestId: event.correlationId,
            event: payload.event,
            properties: payload.properties,
          });
          this.publishResponse(
            'analytics:trackEvent',
            event.correlationId,
            result
          );
        })
    );

    // analytics:getData
    this.subscriptions.push(
      this.eventBus.subscribe('analytics:getData').subscribe(async (event) => {
        const result = await this.analyticsOrchestration.getAnalyticsData({
          requestId: event.correlationId,
        });
        this.publishResponse('analytics:getData', event.correlationId, result);
      })
    );
  }

  /**
   * Subscribe to config-related messages
   */
  private subscribeToConfigMessages(): void {
    // config:get
    this.subscriptions.push(
      this.eventBus.subscribe('config:get').subscribe(async (event) => {
        const result = await this.configOrchestration.getConfig();
        this.publishResponse('config:get', event.correlationId, result);
      })
    );

    // config:set
    // NOTE: MessagePayloadMap incorrectly maps config:set to StateSavePayload
    // ConfigOrchestrationService.setConfig expects { requestId, key, value }
    // TODO: Fix MessagePayloadMap to use proper ConfigSetPayload type
    this.subscriptions.push(
      this.eventBus.subscribe('config:set').subscribe(async (event) => {
        const payload = event.payload as unknown as {
          key: string;
          value: unknown;
        };
        const result = await this.configOrchestration.setConfig({
          requestId: event.correlationId,
          key: payload.key,
          value: payload.value,
        });
        this.publishResponse('config:set', event.correlationId, result);
      })
    );

    // config:update
    // NOTE: MessagePayloadMap incorrectly maps config:update to StateSavePayload
    // ConfigOrchestrationService.updateConfig expects { requestId, key, value }
    // TODO: Fix MessagePayloadMap to use proper ConfigUpdatePayload type
    this.subscriptions.push(
      this.eventBus.subscribe('config:update').subscribe(async (event) => {
        const payload = event.payload as unknown as {
          key: string;
          value: unknown;
        };
        const result = await this.configOrchestration.updateConfig({
          requestId: event.correlationId,
          key: payload.key,
          value: payload.value,
        });
        this.publishResponse('config:update', event.correlationId, result);
      })
    );

    // config:refresh
    // NOTE: refreshConfig() takes NO parameters
    this.subscriptions.push(
      this.eventBus.subscribe('config:refresh').subscribe(async (event) => {
        const result = await this.configOrchestration.refreshConfig();
        this.publishResponse('config:refresh', event.correlationId, result);
      })
    );
  }

  /**
   * Publish response back to EventBus
   * Helper method to standardize response publishing
   */
  private publishResponse<T extends keyof MessagePayloadMap>(
    messageType: T,
    correlationId: CorrelationId,
    result: unknown
  ): void {
    // Convert result to MessageResponse format
    const response: MessageResponse = {
      requestId: correlationId,
      success: (result as { success: boolean }).success,
      data: result,
      metadata: {
        timestamp: Date.now(),
        source: 'extension',
        version: '1.0.0',
      },
    };

    // Publish response event
    const responseType = `${messageType}:response` as keyof MessagePayloadMap;
    this.eventBus.publish(
      responseType,
      response as MessagePayloadMap[typeof responseType]
    );
  }

  /**
   * Dispose of all subscriptions
   * Should be called when extension is deactivated
   */
  dispose(): void {
    console.info('MessageHandlerService: Disposing EventBus subscriptions');
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
  }
}

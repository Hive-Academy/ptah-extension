/**
 * WebviewMessageBridge - EventBus to Webview Communication Bridge
 *
 * Purpose: Subscribes to EventBus events and forwards them to active webviews
 * Solves: Response messages published to EventBus never reach Angular webview
 * Pattern: Observer pattern - listens to EventBus, notifies WebviewManager
 *
 * Architecture:
 * EventBus.publish() → WebviewMessageBridge.forwardToWebview() → WebviewManager.sendMessage() → webview.postMessage()
 *
 * Based on: WEBVIEW_MESSAGING_WIRING_ANALYSIS.md
 * Integration Test: libs/backend/vscode-core/src/integration/week2-integration.spec.ts:314-322
 */

import { injectable, inject } from 'tsyringe';
import { Subscription } from 'rxjs';
import { EventBus, TypedEvent } from './event-bus';
import { WebviewManager } from '../api-wrappers/webview-manager';
import { TOKENS } from '../di/tokens';
import {
  CHAT_MESSAGE_TYPES,
  PROVIDER_MESSAGE_TYPES,
  CONTEXT_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
} from '@ptah-extension/shared';

/**
 * Event categories for selective forwarding
 */
interface EventForwardingRules {
  /** Events that should always be forwarded to webview */
  readonly alwaysForward: readonly string[];
  /** Event patterns that should be forwarded (e.g., ends with ':response') */
  readonly patterns: readonly ((type: string) => boolean)[];
  /** Events that should never be forwarded (internal only) */
  readonly neverForward: readonly string[];
}

/**
 * WebviewMessageBridge
 *
 * Subscribes to EventBus events and forwards relevant messages to active webviews.
 * Completes the bidirectional communication cycle: Angular → Extension → EventBus → Webview → Angular
 *
 * @example
 * ```typescript
 * // In PtahExtension.initialize()
 * const bridge = container.resolve<WebviewMessageBridge>(TOKENS.WEBVIEW_MESSAGE_BRIDGE);
 * bridge.initialize();
 *
 * // Now all response events automatically reach the webview:
 * eventBus.publish('chat:sendMessage:response', { success: true });
 * // → WebviewManager.sendMessage('ptah.main', 'chat:sendMessage:response', { success: true })
 * // → webview.postMessage({ type: 'chat:sendMessage:response', payload: { success: true } })
 * // → Angular VSCodeService.onMessageType('chat:sendMessage:response').subscribe(...)
 * ```
 */
@injectable()
export class WebviewMessageBridge {
  private subscriptions: Subscription[] = [];
  private forwardingRules: EventForwardingRules;
  private isInitialized = false;
  private forwardedMessageCount = 0;
  private failedForwardCount = 0;

  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
  ) {
    // Define forwarding rules (MUST match MessagePayloadMap event types)
    this.forwardingRules = {
      // Always forward these specific event types
      alwaysForward: [
        // Chat streaming events
        CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
        CHAT_MESSAGE_TYPES.MESSAGE_ADDED,
        CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE,
        CHAT_MESSAGE_TYPES.STREAM_STOPPED,

        // Session lifecycle events
        CHAT_MESSAGE_TYPES.SESSION_CREATED,
        CHAT_MESSAGE_TYPES.SESSION_SWITCHED,
        CHAT_MESSAGE_TYPES.SESSION_DELETED,
        CHAT_MESSAGE_TYPES.SESSION_RENAMED,
        CHAT_MESSAGE_TYPES.SESSION_UPDATED,
        CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED,
        CHAT_MESSAGE_TYPES.SESSIONS_UPDATED,

        // Provider events
        PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED,
        PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED,
        PROVIDER_MESSAGE_TYPES.ERROR,
        PROVIDER_MESSAGE_TYPES.AVAILABLE_UPDATED,

        // Context events
        CONTEXT_MESSAGE_TYPES.UPDATE_FILES,

        // System events
        SYSTEM_MESSAGE_TYPES.THEME_CHANGED,
        SYSTEM_MESSAGE_TYPES.ERROR,
        SYSTEM_MESSAGE_TYPES.INITIAL_DATA,

        // Permission events
        CHAT_MESSAGE_TYPES.PERMISSION_REQUEST,
      ],

      // Forward events matching these patterns
      patterns: [
        // All response events (e.g., 'chat:sendMessage:response')
        (type: string) => type.endsWith(':response'),

        // All data events (e.g., 'analytics:data')
        (type: string) => type.endsWith(':data'),
      ],

      // Never forward these internal events
      neverForward: [
        'commands:executeCommand', // Internal command execution
        'analytics:trackEvent', // Internal analytics tracking (request)
        'analytics:trackEvent:response', // Internal analytics tracking (response)
        'analytics:getData', // Internal analytics data request
        'analytics:getData:response', // Internal analytics data response
      ],
    };
  }

  /**
   * Initialize bridge - subscribe to EventBus and start forwarding
   *
   * MUST be called AFTER:
   * - DIContainer.setup() completes
   * - WebviewManager is registered
   * - EventBus is registered
   *
   * @throws Error if already initialized
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Subscribe to all events from EventBus
    this.subscriptions.push(
      this.eventBus.subscribeToAll().subscribe({
        next: (event) => this.handleEvent(event),
        error: (error) => {
          console.error(
            'WebviewMessageBridge: Error in event subscription:',
            error
          );
          this.failedForwardCount++;
        },
      })
    );

    this.isInitialized = true;
  }

  /**
   * Handle incoming event from EventBus
   * Applies forwarding rules and forwards to webview if appropriate
   */
  private handleEvent(event: TypedEvent): void {
    // Check if event should be forwarded
    if (!this.shouldForwardEvent(event.type)) {
      return;
    }

    // Forward to webview
    this.forwardToWebview(event).catch((error) => {
      console.error(
        `WebviewMessageBridge: Failed to forward event '${event.type}':`,
        error
      );
      this.failedForwardCount++;
    });
  }

  /**
   * Determine if an event should be forwarded to webview
   *
   * @param type - Event type to check
   * @returns True if event should be forwarded
   */
  private shouldForwardEvent(type: string): boolean {
    // Never forward blacklisted events
    if (this.forwardingRules.neverForward.includes(type)) {
      return false;
    }

    // Always forward whitelisted events
    if (this.forwardingRules.alwaysForward.includes(type)) {
      return true;
    }

    // Check pattern matchers
    return this.forwardingRules.patterns.some((pattern) => pattern(type));
  }

  /**
   * Forward event to all active webviews
   *
   * @param event - Event to forward
   */
  private async forwardToWebview(event: TypedEvent): Promise<void> {
    const activeWebviews = this.webviewManager.getActiveWebviews();

    if (activeWebviews.length === 0) {
      // No active webviews to forward to - this is normal when webview isn't open
      return;
    }

    // Forward to all active webviews
    const forwardPromises = activeWebviews.map((viewType) => {
      return this.webviewManager
        .sendMessage(viewType, event.type, event.payload)
        .then((success) => {
          if (success) {
            this.forwardedMessageCount++;
          } else {
            this.failedForwardCount++;
          }
          return success;
        });
    });

    // Wait for all forwards to complete
    await Promise.allSettled(forwardPromises);
  }

  /**
   * Get bridge metrics for monitoring and debugging
   *
   * @returns Metrics object with forwarding statistics
   */
  getMetrics() {
    return {
      isInitialized: this.isInitialized,
      forwardedMessageCount: this.forwardedMessageCount,
      failedForwardCount: this.failedForwardCount,
      activeSubscriptions: this.subscriptions.length,
      activeWebviews: this.webviewManager.getActiveWebviews().length,
      forwardingRules: {
        alwaysForwardCount: this.forwardingRules.alwaysForward.length,
        neverForwardCount: this.forwardingRules.neverForward.length,
        patternCount: this.forwardingRules.patterns.length,
      },
    };
  }

  /**
   * Dispose of all subscriptions and clean up resources
   * Should be called during extension deactivation
   */
  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
    this.isInitialized = false;
  }
}

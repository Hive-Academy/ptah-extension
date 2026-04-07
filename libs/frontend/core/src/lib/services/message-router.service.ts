/**
 * Message Router Service - Centralized message dispatch for VS Code webview messages
 *
 * Replaces the fragile lazy-setter routing in VSCodeService with a clean
 * handler registration pattern using Angular's multi-provider InjectionToken.
 *
 * Architecture:
 * - Collects all MessageHandler instances via MESSAGE_HANDLERS token at bootstrap
 * - Builds a Map<string, MessageHandler[]> for O(1) dispatch
 * - Sets up window.addEventListener('message') listener
 * - Zero lazy setters, zero `any` types, zero circular deps
 */

import { Injectable, inject, APP_INITIALIZER } from '@angular/core';
import { MESSAGE_HANDLERS, MessageHandler } from './message-router.types';

@Injectable()
export class MessageRouterService {
  private readonly handlers = inject(MESSAGE_HANDLERS);
  private readonly handlerMap = new Map<string, MessageHandler[]>();

  constructor() {
    this.buildHandlerMap();
    this.setupMessageListener();
  }

  /**
   * Build the dispatch map from all registered handlers.
   * Each message type maps to an array of handlers (usually 1, but supports multiple).
   */
  private buildHandlerMap(): void {
    for (const handler of this.handlers) {
      for (const messageType of handler.handledMessageTypes) {
        const existing = this.handlerMap.get(messageType);
        if (existing) {
          existing.push(handler);
        } else {
          this.handlerMap.set(messageType, [handler]);
        }
      }
    }
  }

  /**
   * Set up the global message listener for VS Code webview messages.
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data;
      if (!message || !message.type) return;

      const handlers = this.handlerMap.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          handler.handleMessage(message);
        }
      }
    });
  }
}

/**
 * Factory function for APP_INITIALIZER.
 * Ensures MessageRouterService is eagerly instantiated at bootstrap
 * so the message listener is active before any components render.
 */
export function initializeMessageRouter(
  _router: MessageRouterService,
): () => void {
  return () => {
    // Service is already initialized in constructor
  };
}

/**
 * Provider function for MessageRouterService with APP_INITIALIZER.
 * Add this to app.config.ts providers to enable message routing.
 */
export function provideMessageRouter() {
  return [
    MessageRouterService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeMessageRouter,
      deps: [MessageRouterService],
      multi: true,
    },
  ];
}

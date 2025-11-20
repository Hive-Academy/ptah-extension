/**
 * Mock VS Code API
 *
 * Provides a complete mock implementation of the VS Code API that exactly
 * mirrors the message protocol used by the extension host.
 *
 * This allows the Angular webview to run standalone in a browser for development.
 */

import {
  StrictMessage,
  MessagePayloadMap,
  StrictChatSession,
  StrictChatMessage,
  SessionId,
  MessageId,
  CorrelationId,
} from '@ptah-extension/shared';
import { MockDataGenerator } from './mock-data-generator';
import { environment } from '../environments/environment';

/**
 * Mock VS Code API Interface
 * Matches the exact interface that VS Code provides
 */
export interface MockVSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Mock VS Code API Implementation
 */
export class MockVSCodeApiImpl implements MockVSCodeApi {
  private state: unknown = {};
  private readonly dataGenerator: MockDataGenerator;
  private readonly messageListeners: Array<(event: MessageEvent) => void> = [];

  // Simulated state
  private sessions: StrictChatSession[] = [];
  private currentSessionId: SessionId | null = null;
  private providers = MockDataGenerator.getMockProviders();
  private currentProviderId = 'claude-cli';

  // Deduplication for preventing duplicate responses
  private lastWebviewReadyTime = 0;
  private readonly WEBVIEW_READY_DEBOUNCE = 1000; // 1 second

  public constructor() {
    this.dataGenerator = new MockDataGenerator();
    this.sessions = this.dataGenerator.getMockSessions();
    this.currentSessionId = this.sessions[0]?.id ?? null;

    console.log('[Mock VSCode API] Initialized with:', {
      sessions: this.sessions.length,
      providers: this.providers.length,
      currentSession: this.currentSessionId,
    });
  }

  /**
   * Post message to webview (simulates extension -> webview)
   */
  public postMessage(message: unknown): void {
    const msg = message as StrictMessage;
    console.log('[Mock VSCode API] Received message:', msg.type, msg.payload);

    // Route message to appropriate handler
    this.handleMessage(msg);
  }

  /**
   * Get saved state
   */
  public getState(): unknown {
    return this.state;
  }

  /**
   * Set saved state
   */
  public setState(state: unknown): void {
    this.state = state;
    console.log('[Mock VSCode API] State updated:', state);
  }

  /**
   * Handle messages from webview and simulate extension responses
   */
  private handleMessage(msg: StrictMessage): void {
    const { type, payload } = msg;

    // Simulate async response with realistic delay
    const respondWith = <T extends keyof MessagePayloadMap>(
      responseType: T,
      responsePayload: MessagePayloadMap[T],
      delay: number = environment.mockDelay
    ) => {
      setTimeout(() => {
        this.simulateExtensionMessage(responseType, responsePayload);
      }, delay);
    };

    // Route based on message type (exactly as extension does)
    switch (type) {
      // ===== Webview Lifecycle =====
      case 'webview-ready': {
        // CRITICAL: Debounce webview-ready to prevent duplicate initialData
        const now = Date.now();
        if (now - this.lastWebviewReadyTime < this.WEBVIEW_READY_DEBOUNCE) {
          console.warn(
            '[Mock VSCode API] Ignoring duplicate webview-ready within debounce window'
          );
          return;
        }
        this.lastWebviewReadyTime = now;

        respondWith('initialData', {
          success: true,
          data: {
            sessions: this.sessions,
            currentSession: this.currentSessionId
              ? this.sessions.find((s) => s.id === this.currentSessionId) ??
                null
              : null,
            providers: {
              current: {
                id: 'claude-cli',
                name: 'Claude CLI',
                status: 'available' as const,
                capabilities: {
                  streaming: true,
                  fileAttachments: true,
                  contextManagement: true,
                  sessionPersistence: true,
                  multiTurn: true,
                  codeGeneration: true,
                  imageAnalysis: false,
                  functionCalling: false,
                },
              },
              available: [
                {
                  id: 'claude-cli',
                  name: 'Claude CLI',
                  status: 'available' as const,
                  capabilities: {
                    streaming: true,
                    fileAttachments: true,
                    contextManagement: true,
                    sessionPersistence: true,
                    multiTurn: true,
                    codeGeneration: true,
                    imageAnalysis: false,
                    functionCalling: false,
                  },
                },
                {
                  id: 'vscode-lm',
                  name: 'VS Code LM',
                  status: 'unavailable' as const,
                  capabilities: {
                    streaming: true,
                    fileAttachments: false,
                    contextManagement: false,
                    sessionPersistence: false,
                    multiTurn: true,
                    codeGeneration: true,
                    imageAnalysis: false,
                    functionCalling: false,
                  },
                },
              ],
              health: {
                'claude-cli': {
                  status: 'available' as const,
                  lastCheck: Date.now(),
                  responseTime: 150,
                  uptime: 3600000,
                },
                'vscode-lm': {
                  status: 'unavailable' as const,
                  lastCheck: Date.now(),
                  errorMessage: 'Not available in browser mode',
                },
              },
            },
          },
          config: {
            context: {
              includedFiles: [],
              excludedFiles: [],
              tokenEstimate: 0,
            },
            workspaceInfo: {
              name: 'Mock Project',
              path: '/mock/workspace',
              projectType: 'mock',
            },
            theme: 2, // Dark theme
            isVSCode: false,
            extensionVersion: '1.0.0-mock',
          },
          timestamp: Date.now(),
        });
        break;
      }

      // ===== Chat Messages =====
      case 'chat:sendMessage': {
        const { content, correlationId } =
          payload as MessagePayloadMap['chat:sendMessage'];

        // Add user message to current session
        if (this.currentSessionId) {
          const userMessageId = crypto.randomUUID() as MessageId;
          const userMessage: StrictChatMessage = {
            id: userMessageId,
            sessionId: this.currentSessionId,
            type: 'user',
            contentBlocks: [{ type: 'text', text: content }],
            timestamp: Date.now(),
          };

          // Update session with user message
          this.sessions = this.sessions.map((s) =>
            s.id === this.currentSessionId
              ? {
                  ...s,
                  messages: [...s.messages, userMessage],
                  messageCount: s.messages.length + 1,
                }
              : s
          );

          // Notify webview of message added
          respondWith('chat:messageAdded', { message: userMessage }, 50);

          // Simulate streaming assistant response
          this.simulateStreamingResponse(
            this.currentSessionId,
            content,
            correlationId
          );
        }
        break;
      }

      case 'chat:newSession': {
        const { name } = payload as MessagePayloadMap['chat:newSession'];
        const newSession = this.dataGenerator.createNewSession(name);
        this.sessions = [newSession, ...this.sessions];
        this.currentSessionId = newSession.id;

        respondWith('chat:sessionCreated', { session: newSession });
        respondWith('chat:switchSession', { sessionId: newSession.id }, 100);
        break;
      }

      case 'chat:switchSession': {
        const { sessionId } =
          payload as MessagePayloadMap['chat:switchSession'];
        const session = this.sessions.find((s) => s.id === sessionId);

        if (session) {
          this.currentSessionId = sessionId;
          respondWith('chat:sessionSwitched', { session });

          // Send history for the switched session
          respondWith(
            'chat:getHistory:response',
            {
              requestId: msg.id,
              success: true,
              data: { messages: session.messages },
              metadata: {
                timestamp: Date.now(),
                source: 'extension',
                version: '1.0.0',
              },
            },
            200
          );
        }
        break;
      }

      case 'chat:getHistory': {
        const { sessionId } = payload as MessagePayloadMap['chat:getHistory'];
        const session = this.sessions.find((s) => s.id === sessionId);

        if (session) {
          respondWith('chat:getHistory:response', {
            requestId: msg.id,
            success: true,
            data: { messages: session.messages },
            metadata: {
              timestamp: Date.now(),
              source: 'extension',
              version: '1.0.0',
            },
          });
        }
        break;
      }

      case 'chat:requestSessions':
        respondWith('chat:sessionsUpdated', { sessions: this.sessions });
        break;

      case 'chat:renameSession': {
        const { sessionId, newName } =
          payload as MessagePayloadMap['chat:renameSession'];
        this.sessions = this.sessions.map((s) =>
          s.id === sessionId ? { ...s, name: newName } : s
        );
        respondWith('chat:sessionRenamed', { sessionId, newName });
        respondWith('chat:sessionsUpdated', { sessions: this.sessions }, 100);
        break;
      }

      case 'chat:deleteSession': {
        const { sessionId } =
          payload as MessagePayloadMap['chat:deleteSession'];
        this.sessions = this.sessions.filter((s) => s.id !== sessionId);

        // Switch to another session if current was deleted
        if (this.currentSessionId === sessionId) {
          this.currentSessionId = this.sessions[0]?.id ?? null;
        }

        respondWith('chat:sessionDeleted', { sessionId });
        respondWith('chat:sessionsUpdated', { sessions: this.sessions }, 100);
        break;
      }

      // ===== Provider Management =====
      case 'providers:getAvailable':
        // Send full response format (matches extension behavior)
        respondWith('providers:getAvailable:response', {
          requestId: 'mock-correlation-id' as CorrelationId,
          success: true,
          data: {
            success: true,
            providers: this.providers.map((p) => ({
              id: p.id,
              name: p.name,
              description: `Mock ${p.name} provider for development`,
              vendor: p.id === 'claude-cli' ? 'Anthropic' : 'Microsoft',
              capabilities: {
                streaming: true,
                functionCalling: true,
                vision: p.id === 'claude-cli',
                maxTokens: 200000,
              },
              health: {
                status: p.status,
                lastCheck: Date.now(),
                responseTime: 120,
                uptime: 3600000,
                errorCount: 0,
                successRate: 0.98,
              },
            })),
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension' as const,
            version: '1.0.0',
          },
        });
        break;

      case 'providers:getCurrent': {
        const currentProvider = this.providers.find(
          (p) => p.id === this.currentProviderId
        );
        respondWith('providers:getCurrent:response', {
          requestId: 'mock-correlation-id' as CorrelationId,
          success: true,
          data: {
            success: true,
            provider: currentProvider
              ? {
                  id: currentProvider.id,
                  name: currentProvider.name,
                  description: `Mock ${currentProvider.name} provider for development`,
                  vendor:
                    currentProvider.id === 'claude-cli'
                      ? 'Anthropic'
                      : 'Microsoft',
                  capabilities: {
                    streaming: true,
                    functionCalling: true,
                    vision: currentProvider.id === 'claude-cli',
                    maxTokens: 200000,
                  },
                  health: {
                    status: currentProvider.status,
                    lastCheck: Date.now(),
                    responseTime: 120,
                    uptime: 3600000,
                    errorCount: 0,
                    successRate: 0.98,
                  },
                }
              : null,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension' as const,
            version: '1.0.0',
          },
        });
        break;
      }

      case 'providers:switch': {
        const { providerId } = payload as MessagePayloadMap['providers:switch'];
        const oldProviderId = this.currentProviderId;
        this.currentProviderId = providerId;

        respondWith('providers:currentChanged', {
          from: oldProviderId,
          to: providerId,
          reason: 'user-request',
          timestamp: Date.now(),
        });
        break;
      }

      case 'providers:getAllHealth': {
        const healthMap: Record<
          string,
          {
            status: string;
            lastCheck: number;
            responseTime: number;
            uptime: number;
            errorCount: number;
            successRate: number;
          }
        > = {};
        this.providers.forEach((provider) => {
          healthMap[provider.id] = {
            status: provider.status,
            lastCheck: Date.now(),
            responseTime: 120,
            uptime: 3600000,
            errorCount: 0,
            successRate: 0.98,
          };
        });

        respondWith('providers:getAllHealth:response', {
          requestId: 'mock-correlation-id' as CorrelationId,
          success: true,
          data: {
            success: true,
            healthMap,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension' as const,
            version: '1.0.0',
          },
        });
        break;
      }

      // ===== Analytics =====
      case 'analytics:trackEvent': {
        const { event, properties } =
          payload as MessagePayloadMap['analytics:trackEvent'];
        console.log('[Mock Analytics]', event, properties);

        // Analytics responses don't need to be forwarded to webview
        // Just log them for debugging
        break;
      }

      // ===== State Management =====
      case 'state:save':
        this.setState((payload as MessagePayloadMap['state:save']).state);
        respondWith('state:saved', {});
        break;

      case 'state:load':
        respondWith('state:loaded', {
          success: true,
          data: {
            sessions: this.sessions,
            currentSession: this.currentSessionId
              ? this.sessions.find((s) => s.id === this.currentSessionId) ??
                null
              : null,
            providers: {
              current: {
                id: 'claude-cli',
                name: 'Claude CLI',
                status: 'available' as const,
                capabilities: {
                  streaming: true,
                  fileAttachments: true,
                  contextManagement: true,
                  sessionPersistence: true,
                  multiTurn: true,
                  codeGeneration: true,
                  imageAnalysis: false,
                  functionCalling: false,
                },
              },
              available: [
                {
                  id: 'claude-cli',
                  name: 'Claude CLI',
                  status: 'available' as const,
                  capabilities: {
                    streaming: true,
                    fileAttachments: true,
                    contextManagement: true,
                    sessionPersistence: true,
                    multiTurn: true,
                    codeGeneration: true,
                    imageAnalysis: false,
                    functionCalling: false,
                  },
                },
              ],
              health: {
                'claude-cli': {
                  status: 'available' as const,
                  lastCheck: Date.now(),
                  responseTime: 150,
                },
              },
            },
          },
          config: {
            context: {
              includedFiles: [],
              excludedFiles: [],
              tokenEstimate: 0,
            },
            workspaceInfo: {
              name: 'Mock Project',
              path: '/mock/workspace',
              projectType: 'mock',
            },
            theme: 2,
            isVSCode: false,
            extensionVersion: '1.0.0-mock',
          },
          timestamp: Date.now(),
        });
        break;

      // ===== View Management =====
      case 'view:changed':
        console.log(
          '[Mock VSCode] View changed to:',
          (payload as MessagePayloadMap['view:changed']).view
        );
        break;

      default:
        console.warn('[Mock VSCode API] Unhandled message type:', type);
    }
  }

  /**
   * Simulate streaming response from AI
   */
  private simulateStreamingResponse(
    sessionId: SessionId,
    userMessage: string,
    _correlationId?: CorrelationId
  ): void {
    const messageId = crypto.randomUUID() as MessageId;
    const response = MockDataGenerator.generateMockResponse(userMessage);
    const chunks = this.splitIntoChunks(response, 20);

    chunks.forEach((chunk, index) => {
      setTimeout(() => {
        const isComplete = index === chunks.length - 1;

        this.simulateExtensionMessage('chat:messageChunk', {
          sessionId,
          messageId,
          contentBlocks: [{ type: 'text', text: chunk }],
          isComplete,
          streaming: true,
        });

        // Send messageComplete event after last chunk
        if (isComplete) {
          setTimeout(() => {
            const completeMessage: StrictChatMessage = {
              id: messageId,
              sessionId,
              type: 'assistant',
              contentBlocks: [{ type: 'text', text: response }],
              timestamp: Date.now(),
              isComplete: true,
              streaming: false,
            };

            // Update session with assistant message
            this.sessions = this.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    messages: [...s.messages, completeMessage],
                    messageCount: s.messages.length + 1,
                  }
                : s
            );

            this.simulateExtensionMessage('chat:messageComplete', {
              message: completeMessage,
            });
          }, 100);
        }
      }, index * environment.mockDelay);
    });
  }

  /**
   * Split text into chunks for streaming simulation
   */
  private splitIntoChunks(text: string, wordsPerChunk: number): string[] {
    const words = text.split(' ');
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = words.slice(i, i + wordsPerChunk).join(' ');
      chunks.push(i === 0 ? chunk : ' ' + chunk);
    }

    return chunks;
  }

  /**
   * Simulate message from extension to webview
   */
  private simulateExtensionMessage<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T]
  ): void {
    const event = new MessageEvent('message', {
      data: {
        type,
        payload,
        id: crypto.randomUUID(),
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      },
      origin: window.location.origin,
    });

    console.log('[Mock VSCode API] Sending to webview:', type, payload);
    window.dispatchEvent(event);
  }
}

/**
 * Create and initialize mock VS Code API
 */
export function createMockVSCodeApi(): MockVSCodeApi {
  return new MockVSCodeApiImpl();
}

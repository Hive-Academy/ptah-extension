/**
 * Mock Data Generator
 *
 * Generates realistic mock data for testing the webview in browser mode.
 * All data structures match the exact types used by the extension.
 */

import {
  StrictChatSession,
  StrictChatMessage,
  SessionId,
  MessageId,
} from '@ptah-extension/shared';

export class MockDataGenerator {
  /**
   * Generate mock chat sessions
   */
  public getMockSessions(): StrictChatSession[] {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;
    const oneWeekAgo = now - 604800000;

    return [
      {
        id: 'session-current' as SessionId,
        name: 'Current Development Session',
        messages: this.generateMockMessages('session-current' as SessionId, 8),
        createdAt: oneHourAgo,
        lastActiveAt: now,
        updatedAt: now,
        messageCount: 8,
        tokenUsage: {
          input: 1250,
          output: 3420,
          total: 4670,
          percentage: 38.9,
          maxTokens: 12000,
        },
      },
      {
        id: 'session-feature' as SessionId,
        name: 'Feature Implementation Planning',
        messages: this.generateMockMessages('session-feature' as SessionId, 15),
        createdAt: oneDayAgo,
        lastActiveAt: oneHourAgo,
        updatedAt: oneHourAgo,
        messageCount: 15,
        tokenUsage: {
          input: 2100,
          output: 5680,
          total: 7780,
          percentage: 64.8,
          maxTokens: 12000,
        },
      },
      {
        id: 'session-debugging' as SessionId,
        name: 'Bug Investigation',
        messages: this.generateMockMessages(
          'session-debugging' as SessionId,
          6
        ),
        createdAt: oneWeekAgo,
        lastActiveAt: oneDayAgo,
        updatedAt: oneDayAgo,
        messageCount: 6,
        tokenUsage: {
          input: 890,
          output: 2340,
          total: 3230,
          percentage: 26.9,
          maxTokens: 12000,
        },
      },
    ];
  }

  /**
   * Generate mock messages for a session
   */
  private generateMockMessages(
    sessionId: SessionId,
    count: number
  ): StrictChatMessage[] {
    const messages: StrictChatMessage[] = [];
    const baseTime = Date.now() - count * 300000; // 5 minutes apart

    const conversationPairs: Array<[string, string]> = [
      [
        'Can you help me understand how the ProviderService initialization works?',
        'Of course! The ProviderService uses an explicit initialization pattern. Let me break it down:\n\n1. The service is injected in the App component constructor\n2. In ngOnInit(), `providerService.initialize()` is called\n3. This sets up all the message listeners and subscriptions\n\nThe key thing to note is that `initialize()` is called outside the injection context, which is why we need to use `takeUntil()` with a manual Subject instead of `takeUntilDestroyed()`.',
      ],
      [
        'What are the main message types I should handle?',
        'The main message types for provider management are:\n\n- `providers:getAvailable` - Request list of available providers\n- `providers:getCurrent` - Get current active provider\n- `providers:switch` - Switch to a different provider\n- `providers:availableUpdated` - Notification when providers change\n- `providers:currentChanged` - Notification when current provider changes\n\nAll these use the MessagePayloadMap for type safety.',
      ],
      [
        'How do I test the webview in a browser?',
        'Great question! The hybrid approach allows you to:\n\n1. Use the mock VS Code API when running `ng serve`\n2. The mock API exactly mirrors the extension message protocol\n3. Environment detection automatically switches between mock and real API\n4. No code changes needed in your components\n\nJust run `npm run serve` and open http://localhost:4200!',
      ],
      [
        'Show me how to implement a new message handler',
        "Here's the pattern:\n\n```typescript\n// In your service\nthis.vscode.onMessageType('your:messageType')\n  .pipe(takeUntil(this.destroy$))\n  .subscribe(payload => {\n    // Handle the message\n    this.someSignal.set(payload.data);\n  });\n```\n\nKey points:\n- Use `onMessageType()` for type-safe subscriptions\n- Always use `takeUntil()` for cleanup\n- Update signals for reactive UI updates",
      ],
    ];

    for (let i = 0; i < Math.min(count, conversationPairs.length * 2); i++) {
      const pairIndex = Math.floor(i / 2);
      const isUser = i % 2 === 0;
      const [userMsg, assistantMsg] = conversationPairs[pairIndex] || [
        'Generic question?',
        'Generic response.',
      ];

      messages.push({
        id: `msg-${sessionId}-${i}` as MessageId,
        sessionId,
        type: isUser ? 'user' : 'assistant',
        contentBlocks: [
          { type: 'text', text: isUser ? userMsg : assistantMsg },
        ],
        timestamp: baseTime + i * 300000,
        isComplete: !isUser ? true : undefined,
      });
    }

    return messages;
  }

  /**
   * Create a new empty session
   */
  public createNewSession(name?: string): StrictChatSession {
    const now = Date.now();
    return {
      id: `session-${crypto.randomUUID()}` as SessionId,
      name: name || `New Session ${new Date().toLocaleTimeString()}`,
      messages: [],
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        percentage: 0,
        maxTokens: 12000,
      },
    };
  }

  /**
   * Generate mock providers list
   * TODO: Phase 2 RPC - Remove mock provider data (provider UI removed in Phase 0)
   */
  public static getMockProviders() {
    return [
      {
        id: 'claude-cli',
        name: 'Claude CLI',
        status: 'available' as const,
        isHealthy: true,
        isDefault: true,
      },
      {
        id: 'vscode-lm',
        name: 'VS Code Language Model',
        status: 'available' as const,
        isHealthy: true,
        isDefault: false,
      },
    ];
  }

  /**
   * Generate a mock AI response based on user message
   */
  public static generateMockResponse(userMessage: string): string {
    const lowerMessage = userMessage.toLowerCase();

    // Context-aware responses
    if (lowerMessage.includes('error') || lowerMessage.includes('fix')) {
      return "I can help you debug that error. Based on the context, it looks like an injection context issue. The `takeUntilDestroyed()` operator requires Angular's injection context, which is only available in constructors, field initializers, or factory functions. Since you're calling it from `initialize()`, you need to use `takeUntil()` with a manual Subject instead.";
    }

    if (lowerMessage.includes('test') || lowerMessage.includes('mock')) {
      return "For testing the webview in a browser, we've set up a comprehensive mock system that exactly mirrors the VS Code message protocol. The mock API responds to all the same message types with realistic data and simulated delays. This allows you to develop and test the UI without needing to run the full extension.";
    }

    // TODO: Phase 2 RPC - Remove provider-related mock responses (provider UI removed in Phase 0)
    if (lowerMessage.includes('provider') || lowerMessage.includes('switch')) {
      return 'The provider system uses a centralized ProviderService that manages multiple AI providers. Each provider implements the same interface but may have different capabilities. The webview communicates with providers through message passing, and the service handles provider switching, health checking, and fallback logic automatically.';
    }

    if (
      lowerMessage.includes('message') ||
      lowerMessage.includes('communication')
    ) {
      return 'The message system uses strict typing with MessagePayloadMap. Every message type has a corresponding payload interface, ensuring type safety across the webview-extension boundary. Messages are routed through the VSCodeService, which provides RxJS observables for reactive subscriptions.';
    }

    // Default response
    return `I understand you're asking about "${userMessage}". Let me help you with that. The Ptah extension uses a modern Angular architecture with signal-based reactivity and strict TypeScript typing. All communication between the webview and extension happens through a well-defined message protocol. Is there a specific aspect you'd like me to explain in more detail?`;
  }
}

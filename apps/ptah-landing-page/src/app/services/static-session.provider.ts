import { Injectable, signal } from '@angular/core';
import {
  ExecutionChatMessage,
  ExecutionNode,
  createExecutionNode,
  createExecutionChatMessage,
} from '@ptah-extension/shared';

/**
 * StaticSessionProvider - Provides pre-built demo session data for the landing page
 *
 * Single Responsibility: Provide static demo ExecutionChatMessage data
 *
 * Key Features:
 * - Signal-based state management for reactive UI updates
 * - Directly creates ExecutionChatMessage objects (bypasses JSONL parsing)
 * - Showcases tool calls, agent execution, and nested content
 * - Decouples landing page demo from VS Code dependencies
 *
 * Complexity Level: 2 (Medium - state management, structured data creation)
 *
 * IMPORTANT: This service creates demo data inline to avoid complex JSONL parsing
 * that SessionReplayService does. The demo showcases the visual appearance of
 * the chat UI without requiring actual Claude CLI session files.
 */
@Injectable({ providedIn: 'root' })
export class StaticSessionProvider {
  // ============================================================================
  // PRIVATE STATE SIGNALS
  // ============================================================================

  private readonly _messages = signal<readonly ExecutionChatMessage[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly messages = this._messages.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Load the demo session (creates static demo data)
   * The assetPath parameter is kept for API compatibility but not used.
   */
  async loadSession(_assetPath?: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      // Simulate network delay for realistic UX
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Create demo messages directly
      const demoMessages = this.createDemoMessages();
      this._messages.set(demoMessages);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to load demo session. Please refresh the page.';
      this._error.set(errorMessage);
      console.error('[StaticSessionProvider] Load session failed:', err);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Reset service state
   */
  reset(): void {
    this._messages.set([]);
    this._isLoading.set(false);
    this._error.set(null);
  }

  // ============================================================================
  // PRIVATE HELPERS - Demo Data Creation
  // ============================================================================

  /**
   * Create demo ExecutionChatMessage array showcasing Ptah features
   */
  private createDemoMessages(): ExecutionChatMessage[] {
    return [
      // User message 1
      createExecutionChatMessage({
        id: 'demo_msg_001',
        role: 'user',
        rawContent:
          'Help me create a TypeScript authentication service with JWT tokens.',
      }),

      // Assistant message 1 with tool calls
      createExecutionChatMessage({
        id: 'demo_msg_002',
        role: 'assistant',
        streamingState: this.createAssistantTree1(),
      }),

      // User message 2
      createExecutionChatMessage({
        id: 'demo_msg_003',
        role: 'user',
        rawContent: 'Can you add unit tests for the AuthService?',
      }),

      // Assistant message 2 with agent spawn
      createExecutionChatMessage({
        id: 'demo_msg_004',
        role: 'assistant',
        streamingState: this.createAssistantTree2(),
      }),
    ];
  }

  /**
   * Create first assistant execution tree with text and tool calls
   */
  private createAssistantTree1(): ExecutionNode {
    return createExecutionNode({
      id: 'exec_001',
      type: 'message',
      status: 'complete',
      children: [
        // Initial text response
        createExecutionNode({
          id: 'text_001',
          type: 'text',
          status: 'complete',
          content:
            "I'll help you create a robust JWT-based authentication service. Let me first check your project structure.",
        }),

        // Read tool call
        createExecutionNode({
          id: 'tool_001',
          type: 'tool',
          status: 'complete',
          toolName: 'Read',
          toolInput: { file_path: '/src/services/auth.service.ts' },
          toolOutput: 'File not found: /src/services/auth.service.ts',
          toolCallId: 'toolu_read_001',
          isCollapsed: true,
        }),

        // Follow-up text
        createExecutionNode({
          id: 'text_002',
          type: 'text',
          status: 'complete',
          content:
            "The auth service doesn't exist yet. Let me create a comprehensive implementation.",
        }),

        // Write tool call
        createExecutionNode({
          id: 'tool_002',
          type: 'tool',
          status: 'complete',
          toolName: 'Write',
          toolInput: {
            file_path: '/src/services/auth.service.ts',
            content: `import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface UserPayload {
  id: string;
  email: string;
  role: string;
}

export class AuthService {
  constructor(
    private readonly secretKey: string,
    private readonly tokenExpiry = '24h'
  ) {}

  async generateToken(payload: UserPayload): Promise<string> {
    return jwt.sign(payload, this.secretKey, {
      expiresIn: this.tokenExpiry,
    });
  }

  async verifyToken(token: string): Promise<UserPayload> {
    return jwt.verify(token, this.secretKey) as UserPayload;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}`,
          },
          toolOutput:
            'Successfully wrote 634 bytes to /src/services/auth.service.ts',
          toolCallId: 'toolu_write_001',
          isCollapsed: true,
        }),

        // Final summary text
        createExecutionNode({
          id: 'text_003',
          type: 'text',
          status: 'complete',
          content: `I've created a comprehensive **AuthService** with:

- **JWT Token Generation** - \`generateToken()\` creates signed tokens with configurable expiry
- **Token Verification** - \`verifyToken()\` validates and decodes tokens
- **Password Hashing** - \`hashPassword()\` uses bcrypt with 10 salt rounds

Would you like me to add middleware integration or unit tests?`,
        }),
      ],
    });
  }

  /**
   * Create second assistant execution tree with agent spawn
   */
  private createAssistantTree2(): ExecutionNode {
    return createExecutionNode({
      id: 'exec_002',
      type: 'message',
      status: 'complete',
      children: [
        // Initial response
        createExecutionNode({
          id: 'text_004',
          type: 'text',
          status: 'complete',
          content:
            "I'll invoke the testing specialist to create comprehensive unit tests.",
        }),

        // Agent spawn (Task tool)
        createExecutionNode({
          id: 'agent_001',
          type: 'agent',
          status: 'complete',
          agentType: 'senior-tester',
          agentModel: 'claude-sonnet-4',
          agentDescription: 'Create unit tests for AuthService',
          toolCallId: 'toolu_task_001',
          children: [
            // Agent's text
            createExecutionNode({
              id: 'agent_text_001',
              type: 'text',
              status: 'complete',
              content:
                'Creating comprehensive test suite using Jest. Let me read the auth service first.',
            }),

            // Agent's tool call
            createExecutionNode({
              id: 'agent_tool_001',
              type: 'tool',
              status: 'complete',
              toolName: 'Read',
              toolInput: { file_path: '/src/services/auth.service.ts' },
              toolOutput: `import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
// ... (AuthService implementation)`,
              toolCallId: 'toolu_agent_read_001',
              isCollapsed: true,
            }),

            // Agent writes tests
            createExecutionNode({
              id: 'agent_tool_002',
              type: 'tool',
              status: 'complete',
              toolName: 'Write',
              toolInput: {
                file_path: '/src/services/__tests__/auth.service.spec.ts',
                content: `import { AuthService } from '../auth.service';
jest.mock('jsonwebtoken');
jest.mock('bcryptjs');

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService('test-secret');
  });

  describe('generateToken', () => {
    it('should generate valid JWT token', async () => {
      // Test implementation
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode token', async () => {
      // Test implementation
    });
  });
});`,
              },
              toolOutput: 'Successfully wrote test file',
              toolCallId: 'toolu_agent_write_001',
              isCollapsed: true,
            }),

            // Agent runs tests
            createExecutionNode({
              id: 'agent_tool_003',
              type: 'tool',
              status: 'complete',
              toolName: 'Bash',
              toolInput: { command: 'npm test -- auth.service.spec.ts' },
              toolOutput: `PASS  src/services/__tests__/auth.service.spec.ts
  AuthService
    generateToken
      ✓ should generate valid JWT token (5ms)
    verifyToken
      ✓ should verify and decode token (3ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total`,
              toolCallId: 'toolu_agent_bash_001',
              isCollapsed: true,
            }),

            // Agent summary
            createExecutionNode({
              id: 'agent_text_002',
              type: 'text',
              status: 'complete',
              content:
                'Test suite created with 2 passing tests covering token generation and verification.',
            }),
          ],
        }),

        // Final text after agent
        createExecutionNode({
          id: 'text_005',
          type: 'text',
          status: 'complete',
          content: `The testing specialist created a comprehensive test suite:

**Test Coverage:**
- Token Generation (1 test)
- Token Verification (1 test)

All tests pass. Your authentication system is now production-ready!`,
        }),
      ],
    });
  }
}

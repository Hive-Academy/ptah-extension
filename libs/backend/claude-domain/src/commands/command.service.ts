/**
 * CommandService - Command execution orchestration for Ptah extension
 *
 * Migrated from apps/ptah-extension-vscode/src/handlers/command-handlers.ts
 * This service provides complete business logic for command execution workflows.
 *
 * Verification trail:
 * - Pattern source: Similar to workspace.service.ts (Phase 6.2)
 * - Uses @injectable() and @inject() decorators from tsyringe
 * - Implements command orchestration (review, test generation, session management)
 * - Delegates to ContextService, SessionManager, ClaudeCliLauncher
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import type { SessionManager } from '../session/session-manager';
import type { SessionId } from '@ptah-extension/shared';
import {
  CONTEXT_SERVICE,
  SESSION_MANAGER,
  CLAUDE_CLI_LAUNCHER,
} from '../di/tokens';

/**
 * ContextService interface (from workspace-intelligence)
 * Minimal interface to avoid circular dependency
 */
export interface IContextService {
  includeFile(fileUri: vscode.Uri): Promise<void>;
  excludeFile(fileUri: vscode.Uri): Promise<void>;
  getOptimizationSuggestions(): Promise<
    Array<{
      type: string;
      description: string;
      estimatedSavings: number;
    }>
  >;
}

/**
 * ClaudeCliLauncher interface (from claude-domain)
 * For executing Claude CLI commands
 */
export interface IClaudeCliLauncher {
  executeCommand(options: {
    message: string;
    sessionId?: SessionId;
    cwd?: string;
  }): Promise<{ sessionId: SessionId }>;
}

/**
 * Command execution result
 */
export interface CommandExecutionResult {
  success: boolean;
  message?: string;
  error?: Error;
}

/**
 * Code review request parameters
 */
export interface CodeReviewRequest {
  fileUri: vscode.Uri;
  fileContent: string;
  fileName: string;
}

/**
 * Test generation request parameters
 */
export interface TestGenerationRequest {
  fileUri: vscode.Uri;
  fileContent: string;
  fileName: string;
}

/**
 * File context operation parameters
 */
export interface FileContextOperation {
  fileUri: vscode.Uri;
  fileName: string;
}

/**
 * Context optimization suggestion
 */
export interface OptimizationSuggestion {
  type: string;
  description: string;
  estimatedSavings: number;
  displayLabel: string;
  displayDetail: string;
}

/**
 * CommandService - Command execution and orchestration
 *
 * Complete business logic implementation for:
 * - Code review workflows
 * - Test generation workflows
 * - Session management
 * - Context optimization
 * - File inclusion/exclusion in context
 *
 * Pattern: Uses ContextService and SessionManager internally
 * No direct VS Code API calls (except for getting active editor info)
 *
 * @example
 * ```typescript
 * const commandService = container.resolve<CommandService>(TOKENS.COMMAND_SERVICE);
 *
 * // Execute code review
 * const editor = vscode.window.activeTextEditor;
 * if (editor) {
 *   const result = await commandService.executeCodeReview({
 *     fileUri: editor.document.uri,
 *     fileContent: editor.document.getText(),
 *     fileName: editor.document.fileName
 *   });
 * }
 *
 * // Generate tests
 * const testResult = await commandService.executeTestGeneration({
 *   fileUri: editor.document.uri,
 *   fileContent: editor.document.getText(),
 *   fileName: editor.document.fileName
 *   });
 * ```
 */
@injectable()
export class CommandService {
  constructor(
    @inject(CONTEXT_SERVICE) private readonly contextService: IContextService,
    @inject(SESSION_MANAGER) private readonly sessionManager: SessionManager,
    @inject(CLAUDE_CLI_LAUNCHER)
    private readonly claudeLauncher: IClaudeCliLauncher
  ) {}

  /**
   * Execute code review for a file
   *
   * Workflow:
   * 1. Include file in context
   * 2. Ensure session exists (create if needed)
   * 3. Add user message with review request
   * 4. Execute Claude CLI command to get response
   *
   * @param request - Code review request parameters
   * @returns Execution result with success status
   */
  async executeCodeReview(
    request: CodeReviewRequest
  ): Promise<CommandExecutionResult> {
    try {
      console.info(`Executing code review for: ${request.fileName}`);

      // Step 1: Add file to context
      await this.contextService.includeFile(request.fileUri);

      // Step 2: Ensure we have a session for the review
      let currentSession = this.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.sessionManager.createSession({
          name: 'Code Review',
        });
      }

      // Step 3: Add user message to session
      const reviewMessage = this.buildCodeReviewMessage(
        request.fileContent,
        request.fileName
      );
      await this.sessionManager.addUserMessage({
        sessionId: currentSession.id,
        content: reviewMessage,
        files: [request.fileUri.fsPath],
      });

      // Step 4: Execute Claude CLI to get response
      await this.claudeLauncher.executeCommand({
        message: reviewMessage,
        sessionId: currentSession.id,
      });

      return {
        success: true,
        message: 'Code review request sent to Claude',
      };
    } catch (error) {
      console.error('Failed to execute code review:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Execute test generation for a file
   *
   * Workflow:
   * 1. Include file in context
   * 2. Ensure session exists (create if needed)
   * 3. Add user message with test generation request
   * 4. Execute Claude CLI command to get response
   *
   * @param request - Test generation request parameters
   * @returns Execution result with success status
   */
  async executeTestGeneration(
    request: TestGenerationRequest
  ): Promise<CommandExecutionResult> {
    try {
      console.info(`Generating tests for: ${request.fileName}`);

      // Step 1: Add file to context
      await this.contextService.includeFile(request.fileUri);

      // Step 2: Ensure we have a session for test generation
      let currentSession = this.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.sessionManager.createSession({
          name: 'Test Generation',
        });
      }

      // Step 3: Add user message to session
      const testMessage = this.buildTestGenerationMessage(
        request.fileContent,
        request.fileName
      );
      await this.sessionManager.addUserMessage({
        sessionId: currentSession.id,
        content: testMessage,
        files: [request.fileUri.fsPath],
      });

      // Step 4: Execute Claude CLI to get response
      await this.claudeLauncher.executeCommand({
        message: testMessage,
        sessionId: currentSession.id,
      });

      return {
        success: true,
        message: 'Test generation request sent to Claude',
      };
    } catch (error) {
      console.error('Failed to execute test generation:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Create a new chat session
   *
   * @param sessionName - Optional session name (defaults to generated name)
   * @returns Execution result with session info
   */
  async createNewSession(
    sessionName?: string
  ): Promise<CommandExecutionResult> {
    try {
      console.info('Creating new session');

      const session = await this.sessionManager.createSession({
        name: sessionName,
      });

      return {
        success: true,
        message: `New session created: ${session.name}`,
      };
    } catch (error) {
      console.error('Failed to create new session:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Include file in context
   *
   * @param operation - File context operation parameters
   * @returns Execution result
   */
  async includeFileInContext(
    operation: FileContextOperation
  ): Promise<CommandExecutionResult> {
    try {
      await this.contextService.includeFile(operation.fileUri);

      console.info(`File included in context: ${operation.fileUri.fsPath}`);

      return {
        success: true,
        message: `Added ${operation.fileName} to context`,
      };
    } catch (error) {
      console.error('Failed to include file:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Exclude file from context
   *
   * @param operation - File context operation parameters
   * @returns Execution result
   */
  async excludeFileFromContext(
    operation: FileContextOperation
  ): Promise<CommandExecutionResult> {
    try {
      await this.contextService.excludeFile(operation.fileUri);

      console.info(`File excluded from context: ${operation.fileUri.fsPath}`);

      return {
        success: true,
        message: `Removed ${operation.fileName} from context`,
      };
    } catch (error) {
      console.error('Failed to exclude file:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Get context optimization suggestions
   *
   * Retrieves optimization suggestions from ContextService and formats them
   * for UI display.
   *
   * @returns Array of formatted optimization suggestions
   */
  async getOptimizationSuggestions(): Promise<OptimizationSuggestion[]> {
    try {
      console.info('Fetching context optimization suggestions');

      const suggestions =
        await this.contextService.getOptimizationSuggestions();

      // Transform suggestions into display-friendly format
      return suggestions.map((suggestion) => ({
        type: suggestion.type,
        description: suggestion.description,
        estimatedSavings: suggestion.estimatedSavings,
        displayLabel: suggestion.type.replace(/_/g, ' ').toUpperCase(),
        displayDetail: `Potential savings: ${suggestion.estimatedSavings} tokens`,
      }));
    } catch (error) {
      console.error('Failed to get optimization suggestions:', error);
      return [];
    }
  }

  /**
   * Build code review message for Claude
   *
   * Creates a comprehensive code review prompt with the file content.
   *
   * @param fileContent - Content of the file to review
   * @param fileName - Name of the file
   * @returns Formatted review message
   */
  private buildCodeReviewMessage(
    fileContent: string,
    fileName: string
  ): string {
    return `Please review this code for bugs, security issues, and improvements:

**File**: ${fileName}

\`\`\`
${fileContent}
\`\`\`

**Review Focus**:
1. **Bugs**: Identify potential bugs, edge cases, and error handling issues
2. **Security**: Check for security vulnerabilities and best practices
3. **Performance**: Suggest performance improvements
4. **Code Quality**: Recommend improvements for readability, maintainability, and adherence to best practices
5. **Testing**: Suggest areas that need better test coverage

Please provide specific, actionable feedback with code examples where applicable.`;
  }

  /**
   * Build test generation message for Claude
   *
   * Creates a comprehensive test generation prompt with the file content.
   *
   * @param fileContent - Content of the file to generate tests for
   * @param fileName - Name of the file
   * @returns Formatted test generation message
   */
  private buildTestGenerationMessage(
    fileContent: string,
    fileName: string
  ): string {
    return `Generate comprehensive unit tests for this code:

**File**: ${fileName}

\`\`\`
${fileContent}
\`\`\`

**Test Requirements**:
1. **Coverage**: Test all public methods and functions
2. **Edge Cases**: Include tests for edge cases and error conditions
3. **Mocking**: Use appropriate mocking strategies for dependencies
4. **Assertions**: Use clear, descriptive assertions
5. **Structure**: Follow testing best practices for the detected framework/language

Please generate complete, runnable test code with proper setup and teardown where needed.`;
  }
}

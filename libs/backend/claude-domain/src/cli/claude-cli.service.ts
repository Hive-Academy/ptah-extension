/**
 * Claude CLI Service - High-level service wrapping ClaudeCliLauncher
 *
 * This service implements IClaudeCliService interface and provides
 * a clean DI-friendly wrapper around ClaudeCliLauncher.
 *
 * Architecture:
 * - Detects CLI installation on-demand
 * - Creates ClaudeCliLauncher instances with proper dependencies
 * - Implements the interface expected by ChatOrchestrationService
 *
 * SOLID Principles:
 * - Single Responsibility: CLI service facade
 * - Dependency Inversion: Depends on abstractions via DI
 */

import { injectable, inject } from 'tsyringe';
import { Readable } from 'stream';
import { workspace } from 'vscode';
import { SessionId, PermissionDecision } from '@ptah-extension/shared';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from '../detector/claude-cli-detector';
import { ClaudeCliLauncher, LauncherDependencies } from './claude-cli-launcher';
import { SessionManager } from '../session/session-manager';
import { PermissionService } from '../permissions/permission-service';
import { ProcessManager } from './process-manager';
import { ClaudeDomainEventPublisher } from '../events/claude-domain.events';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * ClaudeCliService - DI-friendly facade for Claude CLI operations
 *
 * Implements IClaudeCliService interface from chat-orchestration.service.ts
 */
@injectable()
export class ClaudeCliService {
  private cachedInstallation: ClaudeInstallation | null = null;
  private launcher: ClaudeCliLauncher | null = null;

  constructor(
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly detector: ClaudeCliDetector,
    @inject(TOKENS.SESSION_MANAGER)
    private readonly sessionManager: SessionManager,
    @inject(TOKENS.PERMISSION_SERVICE)
    private readonly permissionService: PermissionService,
    @inject(TOKENS.PROCESS_MANAGER)
    private readonly processManager: ProcessManager,
    @inject(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER)
    private readonly eventPublisher: ClaudeDomainEventPublisher
  ) {}

  /**
   * Verify Claude CLI installation is available
   */
  async verifyInstallation(): Promise<boolean> {
    try {
      const installation = await this.ensureInstallation();
      return !!installation;
    } catch {
      return false;
    }
  }

  /**
   * Send message to Claude CLI with streaming response
   *
   * @param message - Message content to send
   * @param sessionId - Ptah session ID
   * @param resumeSessionId - Optional Claude session ID to resume
   * @param sessionManager - Session manager (compatibility parameter, ignored - uses injected one)
   * @returns Readable stream of Claude CLI responses
   */
  async sendMessage(
    message: string,
    sessionId: SessionId,
    resumeSessionId?: string,
    _sessionManager?: SessionManager
  ): Promise<Readable> {
    const launcher = await this.ensureLauncher();

    // Get workspace root for CLI execution context (use first workspace folder)
    const workspaceFolders = workspace.workspaceFolders;
    const workspaceRoot =
      workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : process.cwd();

    console.log('[ClaudeCliService] Workspace root determined:', workspaceRoot);
    console.log(
      '[ClaudeCliService] Workspace folders available:',
      workspaceFolders?.length || 0
    );

    // Spawn Claude CLI turn and return stream
    return launcher.spawnTurn(message, {
      sessionId,
      resumeSessionId,
      workspaceRoot,
      verbose: false, // TODO: Get from configuration
    });
  }

  /**
   * Respond to permission request
   *
   * @param sessionId - Session requesting permission
   * @param response - User's permission decision
   */
  async respondToPermission(
    sessionId: SessionId,
    response: 'allow' | 'always_allow' | 'deny'
  ): Promise<void> {
    // Permission responses are handled through the permission request flow
    // This method exists for IClaudeCliService interface compatibility

    // The actual permission flow in claude-domain:
    // 1. Permission request detected in JSONL stream (JSONLStreamParser)
    // 2. Launcher emits permission event via eventPublisher
    // 3. UI shows permission popup (handled by webview)
    // 4. User responds via webview message to MessageHandlerService
    // 5. MessageHandlerService calls PermissionService.processUserDecision()

    // For direct API compatibility, we convert the response
    const decision: PermissionDecision =
      response === 'allow'
        ? 'allow'
        : response === 'always_allow'
        ? 'always_allow'
        : 'deny';

    // Note: We don't have the toolCallId here, so this is a simplified implementation
    // In practice, permission responses should go through the proper flow above
    // TODO: Enhance this if direct permission responses are needed
    console.warn(
      `respondToPermission called for session ${sessionId} with ${decision} - consider using PermissionService.processUserDecision() instead`
    );
  }

  /**
   * Ensure CLI installation is detected and cached
   */
  private async ensureInstallation(): Promise<ClaudeInstallation> {
    if (this.cachedInstallation) {
      return this.cachedInstallation;
    }

    const installation = await this.detector.findExecutable();

    if (!installation) {
      throw new Error(
        'Claude CLI not found. Please install Claude Code CLI: https://docs.anthropic.com/claude-code'
      );
    }

    this.cachedInstallation = installation;
    return installation;
  }

  /**
   * Ensure launcher is created with proper dependencies
   */
  private async ensureLauncher(): Promise<ClaudeCliLauncher> {
    if (this.launcher) {
      return this.launcher;
    }

    const installation = await this.ensureInstallation();

    const deps: LauncherDependencies = {
      sessionManager: this.sessionManager,
      permissionService: this.permissionService,
      processManager: this.processManager,
      eventPublisher: this.eventPublisher,
    };

    this.launcher = new ClaudeCliLauncher(installation, deps);
    return this.launcher;
  }

  /**
   * Clear cached installation and launcher
   * Useful for testing or when CLI path changes
   */
  clearCache(): void {
    this.cachedInstallation = null;
    this.launcher = null;
    this.detector.clearCache();
  }
}

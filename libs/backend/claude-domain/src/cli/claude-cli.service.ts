/**
 * Claude CLI Service - Simplified facade for Claude CLI operations
 *
 * TASK_2025_023: Purged complex session management
 * Now provides simple CLI verification and process utilities.
 * Chat operations will be handled by new ClaudeProcess class.
 */

import { SessionId } from '@ptah-extension/shared';
import { inject, injectable } from 'tsyringe';
import type { ExtensionContext } from 'vscode';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from '../detector/claude-cli-detector';
import { ClaudeCliLauncher } from './claude-cli-launcher';
import { TOKENS, WebviewManager } from '@ptah-extension/vscode-core';
import { PermissionService } from '../permissions/permission-service';
import { ProcessManager } from './process-manager';

/**
 * ClaudeCliService - Simplified DI facade for Claude CLI operations
 *
 * TASK_2025_023: Removed broken methods:
 * - sendMessage() - was using print mode, killed sessions
 * - spawnInteractiveSession() - complex state machine didn't work
 * - respondToPermission() - will rebuild with new architecture
 *
 * Keeping:
 * - verifyInstallation() - checks CLI is available
 * - killProcess() - cleanup utility
 * - clearCache() - cache management
 */
@injectable()
export class ClaudeCliService {
  private cachedInstallation: ClaudeInstallation | null = null;
  private launcher: ClaudeCliLauncher | null = null;

  constructor(
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly detector: ClaudeCliDetector,
    @inject(TOKENS.PERMISSION_SERVICE)
    private readonly permissionService: PermissionService,
    @inject(TOKENS.PROCESS_MANAGER)
    private readonly processManager: ProcessManager,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: ExtensionContext,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
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
   * Get CLI installation details
   */
  async getInstallation(): Promise<ClaudeInstallation | null> {
    try {
      return await this.ensureInstallation();
    } catch {
      return null;
    }
  }

  /**
   * Kill active CLI process for a session
   */
  async killProcess(sessionId: SessionId): Promise<boolean> {
    if (!sessionId || !this.launcher) {
      return false;
    }
    return this.launcher.killSession(sessionId);
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
   * Clear cached installation and launcher
   */
  clearCache(): void {
    this.cachedInstallation = null;
    this.launcher = null;
    this.detector.clearCache();
  }
}

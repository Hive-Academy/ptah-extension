/**
 * Claude CLI Service - Simplified facade for Claude CLI operations
 *
 * TASK_2025_023: Purged complex session management
 * Now provides simple CLI verification and process utilities.
 * Chat operations will be handled by new ClaudeProcess class.
 */

import { inject, injectable } from 'tsyringe';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from '../detector/claude-cli-detector';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * ClaudeCliService - Simplified DI facade for Claude CLI operations
 *
 * TASK_2025_023 CLEANUP: Fully simplified to essential operations only.
 *
 * Removed:
 * - sendMessage() - was using print mode, killed sessions
 * - spawnInteractiveSession() - complex state machine didn't work
 * - respondToPermission() - will rebuild with new architecture
 * - killProcess() - was broken (used uninitialized this.launcher)
 *
 * Keeping:
 * - verifyInstallation() - checks CLI is available
 * - getInstallation() - retrieves CLI installation details
 * - clearCache() - cache management
 *
 * Process management now handled by ProcessManager directly
 * (accessed via DI container, not through this service).
 */
@injectable()
export class ClaudeCliService {
  private cachedInstallation: ClaudeInstallation | null = null;

  constructor(
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly detector: ClaudeCliDetector
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
   * Clear cached installation
   */
  clearCache(): void {
    this.cachedInstallation = null;
    this.detector.clearCache();
  }
}

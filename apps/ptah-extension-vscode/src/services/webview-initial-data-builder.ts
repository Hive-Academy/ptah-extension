/**
 * Webview Initial Data Builder Service
 *
 * Single Responsibility: Build type-safe initialData payload for webview
 *
 * SOLID Compliance:
 * - S: Only builds initial data (not sending or lifecycle management)
 * - O: Can extend with new data sources without modifying existing code
 * - L: Substitutable (could implement IInitialDataBuilder interface)
 * - I: Focused interface (single build() method)
 * - D: Depends on abstraction interfaces (SessionManager, ProviderManager, etc.)
 *
 * Extracted from AngularWebviewProvider for better type safety and testability
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SessionManager } from '@ptah-extension/claude-domain';
import type {
  InitialDataPayload,
  InitialDataProviderInfo,
  InitialDataProviderHealth,
  InitialDataContextInfo,
  InitialDataWorkspaceInfo,
} from '@ptah-extension/shared';

/**
 * Webview Initial Data Builder
 *
 * Builds type-safe initialData payload with proper validation
 *
 * Benefits:
 * - Type-safe construction (no inline object literals)
 * - Centralized data building logic
 * - Easier testing (mock dependencies)
 * - Clear separation of concerns
 *
 * Usage:
 * ```typescript
 * const initialData = builder.build();
 * webview.postMessage({ type: 'initialData', payload: initialData });
 * ```
 */
@injectable()
export class WebviewInitialDataBuilder {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SESSION_MANAGER)
    private readonly sessionManager: SessionManager,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly extensionContext: vscode.ExtensionContext
  ) {
    this.logger.info('WebviewInitialDataBuilder initialized');
  }

  /**
   * Build complete initial data payload
   * All data is type-safe and validated at compile time
   */
  async build(): Promise<InitialDataPayload> {
    this.logger.debug('Building initial data payload');

    try {
      const [sessions, currentSession] = await Promise.all([
        this.buildSessionData(),
        this.buildCurrentSession(),
      ]);

      const context = this.buildContextInfo();
      const providers = this.buildProviderData();

      const workspaceInfo = this.buildWorkspaceInfo();

      const payload: InitialDataPayload = {
        success: true,
        data: {
          sessions,
          currentSession,
          providers,
        },
        config: {
          context,
          workspaceInfo,
          theme: vscode.window.activeColorTheme.kind,
          isVSCode: true,
          extensionVersion: this.extensionContext.extension.packageJSON.version,
        },
        timestamp: Date.now(),
      };

      this.logger.info('Initial data payload built successfully', {
        sessionCount: sessions.length,
        providerCount: providers.available.length,
        workspaceName: workspaceInfo?.name,
      });

      return payload;
    } catch (error) {
      this.logger.error('Failed to build initial data payload', { error });

      // Return minimal valid payload on error
      return this.buildErrorPayload();
    }
  }

  /**
   * Build session data
   */
  private async buildSessionData() {
    try {
      return this.sessionManager.getAllSessions();
    } catch (error) {
      this.logger.error('Failed to get all sessions', { error });
      return [];
    }
  }

  /**
   * Build current session
   */
  private async buildCurrentSession() {
    try {
      return this.sessionManager.getCurrentSession();
    } catch (error) {
      this.logger.error('Failed to get current session', { error });
      return null;
    }
  }

  /**
   * Build context information (STUB - provider infrastructure removed)
   */
  private buildContextInfo(): InitialDataContextInfo {
    return {
      includedFiles: [],
      excludedFiles: [],
      tokenEstimate: 0,
    };
  }

  /**
   * Build provider data (STUB - provider infrastructure removed)
   */
  private buildProviderData(): InitialDataPayload['data']['providers'] {
    return {
      current: null,
      available: [],
      health: {},
    };
  }

  /**
   * Build workspace information
   */
  private buildWorkspaceInfo(): InitialDataWorkspaceInfo | null {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      const workspaceFolder = workspaceFolders[0];

      return {
        name: workspaceFolder.name,
        path: workspaceFolder.uri.fsPath,
        projectType: this.detectProjectType(workspaceFolder.uri.fsPath),
      };
    } catch (error) {
      this.logger.error('Failed to get workspace info', { error });
      return null;
    }
  }

  /**
   * Detect project type based on files
   * Extracted from AngularWebviewProvider for reuse
   */
  private detectProjectType(workspacePath: string): string {
    const fs = require('fs');
    const path = require('path');

    try {
      // Check for package.json first
      const packageJsonPath = path.join(workspacePath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8')
        );

        // Check for specific framework indicators
        if (packageJson.dependencies || packageJson.devDependencies) {
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          if (allDeps['@angular/core']) return 'angular';
          if (allDeps['react']) return 'react';
          if (allDeps['vue']) return 'vue';
          if (allDeps['@nestjs/core']) return 'nestjs';
          if (allDeps['express']) return 'express';
          if (allDeps['next']) return 'nextjs';
          if (allDeps['nuxt']) return 'nuxt';
          if (allDeps['svelte']) return 'svelte';
          if (allDeps['typescript']) return 'typescript';
        }

        return 'nodejs';
      }

      // Check for other project indicators
      if (fs.existsSync(path.join(workspacePath, 'angular.json')))
        return 'angular';
      if (fs.existsSync(path.join(workspacePath, 'nx.json'))) return 'nx';
      if (fs.existsSync(path.join(workspacePath, 'pom.xml')))
        return 'java-maven';
      if (fs.existsSync(path.join(workspacePath, 'build.gradle')))
        return 'java-gradle';
      if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) return 'rust';
      if (fs.existsSync(path.join(workspacePath, 'go.mod'))) return 'go';
      if (
        fs.existsSync(path.join(workspacePath, 'requirements.txt')) ||
        fs.existsSync(path.join(workspacePath, 'pyproject.toml'))
      )
        return 'python';
      if (fs.existsSync(path.join(workspacePath, 'Gemfile'))) return 'ruby';
      if (fs.existsSync(path.join(workspacePath, 'composer.json')))
        return 'php';
      if (
        fs.existsSync(path.join(workspacePath, '.csproj')) ||
        fs.existsSync(path.join(workspacePath, '*.sln'))
      )
        return 'csharp';

      return 'generic';
    } catch (error) {
      this.logger.warn('Error detecting project type', { error });
      return 'unknown';
    }
  }

  /**
   * Build minimal error payload
   */
  private buildErrorPayload(): InitialDataPayload {
    return {
      success: false,
      data: {
        sessions: [],
        currentSession: null,
        providers: {
          current: null,
          available: [],
          health: {},
        },
      },
      config: {
        context: {
          includedFiles: [],
          excludedFiles: [],
          tokenEstimate: 0,
        },
        workspaceInfo: null,
        theme: vscode.window.activeColorTheme.kind,
        isVSCode: true,
        extensionVersion: this.extensionContext.extension.packageJSON.version,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Dispose resources (currently no resources to clean up)
   */
  dispose(): void {
    this.logger.info('WebviewInitialDataBuilder disposed');
  }
}

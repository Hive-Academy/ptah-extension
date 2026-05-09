import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * Options for generating webview HTML content
 */
export interface WebviewHtmlOptions {
  workspaceInfo?: Record<string, unknown>;
  /** Initial view to navigate to (e.g., 'chat', 'setup-wizard') */
  initialView?: string;
  /** Whether the user has a valid license (default: true for licensed activation) */
  isLicensed?: boolean;
  /** Unique panel identifier for multi-webview support (TASK_2025_117) */
  panelId?: string;
}

/**
 * WebviewHtmlGenerator - Single Responsibility: Generate HTML content for Angular webviews
 * IMPROVED based on 4gray/vscode-webview-angular research findings
 * Follows SOLID principles by focusing only on HTML generation logic
 */
export class WebviewHtmlGenerator {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Generate HTML content for Angular SPA application - IMPROVED METHOD
   * Based on research: Read actual index.html and modify it rather than recreating
   * Optimized for Angular 20+ with proper CSP and modern asset handling
   *
   * @param webview - VS Code webview instance
   * @param options - Options object with workspaceInfo and/or initialView, or legacy Record<string, unknown>
   */
  generateAngularWebviewContent(
    webview: vscode.Webview,
    options?:
      | {
          workspaceInfo?: Record<string, unknown>;
          initialView?: string;
          isLicensed?: boolean;
          panelId?: string;
          initialSessionId?: string;
          initialSessionName?: string;
        }
      | Record<string, unknown>,
  ): string {
    try {
      // Support both new options object and legacy workspaceInfo object
      let workspaceInfo: Record<string, unknown> | undefined;
      let initialView: string | undefined;
      let isLicensed = true; // Default to licensed for normal activation
      let panelId: string | undefined;
      let initialSessionId: string | undefined;
      let initialSessionName: string | undefined;

      if (options) {
        if (
          'initialView' in options ||
          'workspaceInfo' in options ||
          'isLicensed' in options ||
          'panelId' in options ||
          'initialSessionId' in options
        ) {
          // New format with explicit options
          workspaceInfo = (
            options as { workspaceInfo?: Record<string, unknown> }
          ).workspaceInfo;
          initialView = (options as { initialView?: string }).initialView;
          isLicensed = (options as { isLicensed?: boolean }).isLicensed ?? true;
          panelId = (options as { panelId?: string }).panelId;
          initialSessionId = (options as { initialSessionId?: string })
            .initialSessionId;
          initialSessionName = (options as { initialSessionName?: string })
            .initialSessionName;
        } else {
          // Legacy format - treat as workspaceInfo directly
          workspaceInfo = options as Record<string, unknown>;
        }
      }

      const htmlContent = this._getHtmlForWebview(
        webview,
        workspaceInfo,
        initialView,
        isLicensed,
        panelId,
        initialSessionId,
        initialSessionName,
      );
      return htmlContent;
    } catch (error) {
      console.error('Error generating webview content:', error);
      // Fallback to basic HTML
      return this.generateFallbackHtml(
        webview,
        options as Record<string, unknown>,
      );
    }
  }

  /**
   * RESEARCH-BASED IMPLEMENTATION: Read and modify actual Angular index.html
   * This follows the proven pattern from 4gray/vscode-webview-angular
   */
  private _getHtmlForWebview(
    webview: vscode.Webview,
    workspaceInfo?: Record<string, unknown>,
    initialView?: string,
    isLicensed = true,
    panelId?: string,
    initialSessionId?: string,
    initialSessionName?: string,
  ): string {
    // CRITICAL: Validate initialView to prevent invalid views from crashing navigation
    const VALID_VIEWS = [
      'chat',
      'command-builder',
      'analytics',
      'context-tree',
      'settings',
      'setup-wizard',
      'welcome', // TASK_2025_126: Welcome view for unlicensed users
    ];

    if (initialView && !VALID_VIEWS.includes(initialView)) {
      throw new Error(
        `Invalid initialView: "${initialView}". Valid values are: ${VALID_VIEWS.join(
          ', ',
        )}`,
      );
    }
    // Path to Angular dist folder (browser build output)
    // FIXED: context.extensionPath already points to dist/apps/ptah-extension-vscode
    const appDistPath = path.join(
      this.context.extensionPath,
      'webview',
      'browser',
    );
    const appDistPathUri = vscode.Uri.file(appDistPath);

    // Read the actual Angular-generated index.html
    const indexPath = path.join(appDistPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      throw new Error(`Angular index.html not found at ${indexPath}`);
    }

    let indexHtml = fs.readFileSync(indexPath, { encoding: 'utf8' });

    // CRITICAL: DO NOT modify the base href - VS Code webviews don't support it
    // We will transform individual asset URIs instead
    // Keep base href as "/" to avoid confusing VS Code's webview URI resolution

    // IMPROVED CSP: Fix Google Fonts and add proper nonce support
    const nonce = this.generateNonce();
    const cspContent = this.getImprovedCSP(webview, nonce);

    // Add CSP meta tag after charset
    indexHtml = indexHtml.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="${cspContent}">`,
    );

    // Add VS Code integration and theme support
    const theme = vscode.window.activeColorTheme.kind;
    const integrationScript = this.getVSCodeIntegrationScript(
      theme,
      workspaceInfo,
      webview,
      initialView,
      isLicensed,
      panelId,
      initialSessionId,
      initialSessionName,
    );
    const themeStyles = this.getThemeStyles();

    // Inject theme styles in head
    indexHtml = indexHtml.replace(
      '</head>',
      `  <style nonce="${nonce}">
          ${themeStyles}
        </style>
      </head>`,
    );

    // Add VS Code theme class to body
    indexHtml = indexHtml.replace(
      '<body>',
      `<body class="vscode-body ${this.getThemeClass(theme)}">`,
    );

    // Inject VS Code integration script before closing body
    indexHtml = indexHtml.replace(
      '</body>',
      `  <script nonce="${nonce}">
          ${integrationScript}
        </script>
        <script nonce="${nonce}">
          ${this.getStartupScript()}
        </script>
      </body>`,
    );

    // Transform all asset URIs (styles.css, main.js, polyfills.js) to webview URIs
    // This is REQUIRED for VS Code webviews - base href alone doesn't work
    indexHtml = indexHtml.replace(
      /(src|href)="([^"]+)"/g,
      (match, attribute, uri) => {
        // CRITICAL: Skip base href (/) - it's a special HTML tag
        if (uri === '/') {
          return match;
        }

        // Skip external resources, data URIs, and already-transformed URIs
        if (
          uri.startsWith('http') ||
          uri.startsWith('data:') ||
          uri.startsWith('vscode-webview:') ||
          uri.startsWith('https://file+.vscode-resource') ||
          uri.startsWith('//') ||
          uri === '' ||
          uri === '#'
        ) {
          return match;
        }

        // Transform relative URIs to webview URIs
        const fullUri = webview.asWebviewUri(
          vscode.Uri.joinPath(appDistPathUri, uri),
        );
        return `${attribute}="${fullUri}"`;
      },
    );

    // Add nonce to inline styles (Angular critical CSS)
    indexHtml = indexHtml.replace(/<style>/g, `<style nonce="${nonce}">`);

    // Add nonces to script and link tags
    indexHtml = indexHtml
      .replace(/<script([^>]*?)>/g, (match, attributes) => {
        if (!attributes.includes('nonce=')) {
          return `<script${attributes} nonce="${nonce}">`;
        }
        return match;
      })
      .replace(/<link([^>]*?)>/g, (match, attributes) => {
        if (
          !attributes.includes('nonce=') &&
          attributes.includes('stylesheet')
        ) {
          return `<link${attributes} nonce="${nonce}">`;
        }
        return match;
      });

    return indexHtml;
  }

  /**
   * Enhanced URI transformation method - transforms all src and href attributes
   * Implements the specific requirements for VS Code webview URI handling
   * Uses regex pattern: /(src|href)="([^"]+)"/g for asset transformation
   */
  private transformResourceUris(
    html: string,
    webview: vscode.Webview,
    baseUri: vscode.Uri,
    nonce: string,
  ): string {
    // Transform all src and href attributes using the specified regex pattern
    const transformedHtml = html.replace(
      /(src|href)="([^"]+)"/g,
      (match, attribute, uri) => {
        // Skip already transformed URIs and external resources
        if (
          uri.startsWith('http') ||
          uri.startsWith('data:') ||
          uri.startsWith('vscode-webview:') ||
          uri.startsWith('vscode-resource:') || // Skip webview resource URIs
          uri.startsWith('//') ||
          uri === '' ||
          uri === '#'
        ) {
          return match;
        }

        // Transform relative URIs to webview URIs
        const fullUri = webview.asWebviewUri(vscode.Uri.joinPath(baseUri, uri));
        return `${attribute}="${fullUri}"`;
      },
    );

    // Add nonce to script and link tags that don't have it
    return transformedHtml
      .replace(/<script([^>]*src="[^"]*"[^>]*?)>/g, (match, attributes) => {
        if (!attributes.includes('nonce=')) {
          return `<script${attributes} nonce="${nonce}">`;
        }
        return match;
      })
      .replace(/<link([^>]*href="[^"]*"[^>]*?)>/g, (match, attributes) => {
        if (
          !attributes.includes('nonce=') &&
          attributes.includes('stylesheet')
        ) {
          return `<link${attributes} nonce="${nonce}">`;
        }
        return match;
      });
  }

  /**
   * IMPROVED CSP based on research findings - secure policy without unsafe-inline
   * FIXED: Proper CSP for Angular with inlineCritical: false configuration
   */
  private getImprovedCSP(webview: vscode.Webview, nonce: string): string {
    return `default-src 'none';
            img-src ${webview.cspSource} https: data: blob:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com;
            font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
            connect-src 'self' ${webview.cspSource};
            frame-src 'none';
            object-src 'none';
            base-uri 'self' ${webview.cspSource};`;
  }

  /**
   * Fallback HTML generation if reading index.html fails
   * FIXED: Remove polyfills.js reference as Angular 20+ doesn't generate it
   */
  private generateFallbackHtml(
    webview: vscode.Webview,
    workspaceInfo?: Record<string, unknown>,
  ): string {
    const { scriptUri, stylesUri } = this.getAssetUris(webview);
    const nonce = this.generateNonce();
    const theme = vscode.window.activeColorTheme.kind;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Ptah - AI Coding Orchestra</title>
        <base href="${webview.asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'browser'),
        )}/">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="${this.getImprovedCSP(
          webview,
          nonce,
        )}">

        <!-- Angular Styles -->
        <link rel="stylesheet" href="${stylesUri}" nonce="${nonce}">

        <!-- VS Code Theme Integration -->
        <style nonce="${nonce}">
          ${this.getThemeStyles()}
        </style>
      </head>
      <body class="vscode-body ${this.getThemeClass(theme)}">
        <!-- Angular App Root -->
        <app-root></app-root>

        <!-- VS Code Integration Script
        <script nonce="${nonce}">
          ${this.getVSCodeIntegrationScript(theme, workspaceInfo, webview)}
        </script>  -->

        <!-- Angular Main Bundle (ES Module) -->
        <script src="${scriptUri}" type="module" nonce="${nonce}" onerror="console.error('Failed to load main Angular bundle')"></script>

        <!-- Startup Script -->
        <script nonce="${nonce}">
          ${this.getStartupScript()}
        </script>
      </body>
      </html>
    `;
  }

  private getAssetUris(webview: vscode.Webview) {
    // FIXED: context.extensionUri already points to dist/apps/ptah-extension-vscode
    const angularDistPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'webview',
      'browser',
    );

    return {
      scriptUri: webview.asWebviewUri(
        vscode.Uri.joinPath(angularDistPath, 'main.js'),
      ),
      stylesUri: webview.asWebviewUri(
        vscode.Uri.joinPath(angularDistPath, 'styles.css'),
      ),
    };
  }

  private getThemeStyles(): string {
    return `
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }

      /* Color scheme for native browser controls (scrollbars, inputs) */
      body.vscode-dark { color-scheme: dark; }
      body.vscode-light { color-scheme: light; }
      body.vscode-high-contrast { color-scheme: dark; }
    `;
  }

  private getVSCodeIntegrationScript(
    theme: vscode.ColorThemeKind,
    workspaceInfo?: Record<string, unknown>,
    webview?: vscode.Webview,
    initialView?: string,
    isLicensed = true,
    panelId?: string,
    initialSessionId?: string,
    initialSessionName?: string,
  ): string {
    // Generate proper webview URIs for assets
    const appDistPath = path.join(
      this.context.extensionPath,
      'webview',
      'browser',
    );
    const appDistPathUri = vscode.Uri.file(appDistPath);
    const baseUri = webview?.asWebviewUri(appDistPathUri).toString() || '';
    const iconUri =
      webview
        ?.asWebviewUri(
          vscode.Uri.joinPath(appDistPathUri, 'images', 'ptah-icon.png'),
        )
        .toString() || '';
    const userIconUri =
      webview
        ?.asWebviewUri(
          vscode.Uri.joinPath(appDistPathUri, 'images', 'user-icon.png'),
        )
        .toString() || '';

    return `
      // Acquire VS Code API
      const vscode = acquireVsCodeApi();

      // Global configuration for Angular app
      window.vscode = vscode;
      window.ptahConfig = {
        isVSCode: true,
        isLicensed: ${isLicensed},
        theme: '${this.getThemeString(theme)}',
        workspaceRoot: '${this.escapeJsString(
          String(workspaceInfo?.['path'] || ''),
        )}',
        workspaceName: '${this.escapeJsString(
          String(workspaceInfo?.['name'] || ''),
        )}',
        extensionUri: '${this.context.extensionUri.toString()}',
        baseUri: '${baseUri}',
        iconUri: '${iconUri}',
        userIconUri: '${userIconUri}',
        initialView: ${
          initialView ? `'${this.escapeJsString(initialView)}'` : 'null'
        },
        panelId: '${this.escapeJsString(panelId || '')}',
        initialSessionId: ${
          initialSessionId
            ? `'${this.escapeJsString(initialSessionId)}'`
            : 'null'
        },
        initialSessionName: ${
          initialSessionName
            ? `'${this.escapeJsString(initialSessionName)}'`
            : 'null'
        }
      };



      // Restore previous state
      const previousState = vscode.getState();
      if (previousState) {
        window.ptahPreviousState = previousState;
      }

      // Handle theme changes
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'themeChanged') {
          document.body.className = 'vscode-body ' + message.themeClass;
          window.ptahConfig.theme = message.theme;

          // Notify Angular about theme change
          window.dispatchEvent(new CustomEvent('vscode-theme-changed', {
            detail: { theme: message.theme, themeClass: message.themeClass }
          }));
        }
      });

    `;
  }

  private getStartupScript(): string {
    return `
      // Notify extension that webview is ready
      setTimeout(() => {
        if (window.vscode) {
          window.vscode.postMessage({ type: '${MESSAGE_TYPES.WEBVIEW_READY}' });
        } else {
          console.error('CRITICAL: window.vscode is not available!');
        }
      }, 100);
    `;
  }

  private getThemeClass(theme: vscode.ColorThemeKind): string {
    switch (theme) {
      case vscode.ColorThemeKind.Light:
        return 'vscode-light';
      case vscode.ColorThemeKind.HighContrast:
        return 'vscode-high-contrast';
      case vscode.ColorThemeKind.Dark:
      default:
        return 'vscode-dark';
    }
  }

  private getThemeString(theme: vscode.ColorThemeKind): string {
    switch (theme) {
      case vscode.ColorThemeKind.Light:
        return 'light';
      case vscode.ColorThemeKind.HighContrast:
        return 'high-contrast';
      case vscode.ColorThemeKind.Dark:
      default:
        return 'dark';
    }
  }

  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Escape a string for safe inclusion in JavaScript template literal
   * Handles backslashes (Windows paths), quotes, and special characters
   */
  private escapeJsString(str: string): string {
    return str
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/'/g, "\\'") // Escape single quotes
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\n/g, '\\n') // Escape newlines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/`/g, '\\`') // Escape backticks (template literal injection)
      .replace(/\$\{/g, '\\${') // Escape template expressions
      .replace(/<\//g, '<\\/') // Prevent script context breakout
      .replace(/\u2028/g, '\\u2028') // Escape Unicode line separator
      .replace(/\u2029/g, '\\u2029'); // Escape Unicode paragraph separator
  }

  public buildWorkspaceInfo(): Record<string, unknown> | null {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      const workspaceFolder = workspaceFolders[0];

      return {
        name: workspaceFolder.name,
        path: workspaceFolder.uri.fsPath,
        type: 'workspace',
      };
    } catch {
      return null;
    }
  }
}

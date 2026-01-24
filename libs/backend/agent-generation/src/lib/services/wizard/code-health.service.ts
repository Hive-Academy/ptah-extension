/**
 * CodeHealthAnalysisService - Code Health Metrics Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Summarize VS Code diagnostics (errors, warnings, info counts)
 * - Detect code conventions from config files (Prettier, ESLint, etc.)
 * - Estimate test coverage from file patterns
 *
 * Pattern Source: setup-wizard.service.ts:1252-1555
 * Extracted from: SetupWizardService code health analysis methods
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type * as vscode from 'vscode';
import type {
  DiagnosticSummary,
  CodeConventions,
  TestCoverageEstimate,
} from '@ptah-extension/shared';

/**
 * Service responsible for analyzing code health metrics.
 *
 * This service provides:
 * - Diagnostic summarization (aggregate errors, warnings, info)
 * - Code convention detection from config files
 * - Test coverage estimation from file patterns
 *
 * All methods skip node_modules in file searches to focus on project code.
 *
 * @injectable
 */
@injectable()
export class CodeHealthAnalysisService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('[CodeHealthAnalysis] Service initialized');
  }

  /**
   * Summarize VS Code diagnostics into aggregate counts.
   *
   * Processes diagnostic tuples from VS Code's getDiagnostics() API and
   * aggregates them by severity and source type.
   *
   * **Processing Rules:**
   * - Skips diagnostics from node_modules paths
   * - Groups by severity: Error (0), Warning (1), Information (2), Hint (3)
   * - Tracks top 5 most common error messages
   *
   * @param diagnostics - Array of [URI, Diagnostic[]] tuples from getDiagnostics
   * @returns Summarized diagnostic information
   *
   * @example
   * ```typescript
   * const diagnostics = vscode.languages.getDiagnostics();
   * const summary = codeHealth.summarizeDiagnostics(diagnostics);
   * // Returns: { errorCount: 5, warningCount: 23, infoCount: 8, ... }
   * ```
   */
  summarizeDiagnostics(
    diagnostics: [vscode.Uri, vscode.Diagnostic[]][]
  ): DiagnosticSummary {
    this.logger.debug('[CodeHealthAnalysis] Summarizing diagnostics', {
      diagnosticCount: diagnostics.length,
    });

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    const errorsByType: Record<string, number> = {};
    const warningsByType: Record<string, number> = {};
    const errorMessages: Map<string, number> = new Map();

    // VS Code DiagnosticSeverity enum values
    const DiagnosticSeverity = {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    };

    for (const [uri, fileDiagnostics] of diagnostics) {
      // Skip node_modules
      if (uri.fsPath.includes('node_modules')) {
        continue;
      }

      for (const diag of fileDiagnostics) {
        const source = diag.source || 'unknown';

        switch (diag.severity) {
          case DiagnosticSeverity.Error: {
            errorCount++;
            errorsByType[source] = (errorsByType[source] || 0) + 1;
            // Track error messages (truncated to 100 chars)
            const errorMsg = diag.message.substring(0, 100);
            errorMessages.set(errorMsg, (errorMessages.get(errorMsg) || 0) + 1);
            break;
          }
          case DiagnosticSeverity.Warning: {
            warningCount++;
            warningsByType[source] = (warningsByType[source] || 0) + 1;
            break;
          }
          case DiagnosticSeverity.Information:
          case DiagnosticSeverity.Hint:
            infoCount++;
            break;
        }
      }
    }

    // Get top 5 most common errors
    const topErrors = Array.from(errorMessages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({
        message,
        count,
        source: Object.keys(errorsByType)[0] || 'unknown',
      }));

    const summary: DiagnosticSummary = {
      errorCount,
      warningCount,
      infoCount,
      errorsByType,
      warningsByType,
      topErrors: topErrors.length > 0 ? topErrors : undefined,
    };

    this.logger.debug('[CodeHealthAnalysis] Diagnostics summarized', {
      errorCount,
      warningCount,
      infoCount,
      uniqueErrorTypes: Object.keys(errorsByType).length,
    });

    return summary;
  }

  /**
   * Detect code conventions from project configuration files.
   *
   * Reads configuration from:
   * - Prettier (.prettierrc, prettier.config.js)
   * - ESLint (.eslintrc, eslint.config.js)
   * - Stylelint (.stylelintrc*)
   * - Biome (biome.json)
   *
   * Falls back to sensible defaults if no configuration is found.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscodeApi - VS Code API module
   * @returns Detected code conventions
   *
   * @example
   * ```typescript
   * const conventions = await codeHealth.detectCodeConventions(workspaceUri, vscode);
   * // Returns: { indentation: 'spaces', indentSize: 2, quoteStyle: 'single', ... }
   * ```
   */
  async detectCodeConventions(
    workspaceUri: vscode.Uri,
    vscodeApi: typeof import('vscode')
  ): Promise<CodeConventions> {
    this.logger.debug('[CodeHealthAnalysis] Detecting code conventions', {
      workspaceRoot: workspaceUri.fsPath,
    });

    // Default conventions
    const conventions: CodeConventions = {
      indentation: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      trailingComma: 'es5',
    };

    try {
      // Try to read Prettier config
      const prettierConfigs = await vscodeApi.workspace.findFiles(
        '{.prettierrc,.prettierrc.json,.prettierrc.js,prettier.config.js}',
        '**/node_modules/**',
        1
      );

      if (prettierConfigs.length > 0) {
        conventions.usePrettier = true;
        try {
          const content = await vscodeApi.workspace.fs.readFile(
            prettierConfigs[0]
          );
          const configText = Buffer.from(content).toString('utf8');

          // Parse JSON config
          if (
            prettierConfigs[0].fsPath.endsWith('.json') ||
            prettierConfigs[0].fsPath.endsWith('.prettierrc')
          ) {
            try {
              const config = JSON.parse(configText);
              if (config.tabWidth) conventions.indentSize = config.tabWidth;
              if (config.useTabs) conventions.indentation = 'tabs';
              if (config.singleQuote !== undefined)
                conventions.quoteStyle = config.singleQuote
                  ? 'single'
                  : 'double';
              if (config.semi !== undefined)
                conventions.semicolons = config.semi;
              if (config.trailingComma)
                conventions.trailingComma = config.trailingComma;
              if (config.printWidth)
                conventions.maxLineLength = config.printWidth;

              this.logger.debug(
                '[CodeHealthAnalysis] Parsed Prettier config',
                config
              );
            } catch {
              // Not valid JSON, skip
            }
          }
        } catch {
          // Could not read file, continue with defaults
        }
      }

      // Check for ESLint
      const eslintConfigs = await vscodeApi.workspace.findFiles(
        '{.eslintrc,.eslintrc.json,.eslintrc.js,eslint.config.js}',
        '**/node_modules/**',
        1
      );
      if (eslintConfigs.length > 0) {
        conventions.useEslint = true;
        this.logger.debug('[CodeHealthAnalysis] ESLint config found');
      }

      // Check for additional tools
      const additionalTools: string[] = [];

      const stylelintConfig = await vscodeApi.workspace.findFiles(
        '.stylelintrc*',
        '**/node_modules/**',
        1
      );
      if (stylelintConfig.length > 0) {
        additionalTools.push('stylelint');
      }

      const biomeConfig = await vscodeApi.workspace.findFiles(
        'biome.json',
        '**/node_modules/**',
        1
      );
      if (biomeConfig.length > 0) {
        additionalTools.push('biome');
      }

      if (additionalTools.length > 0) {
        conventions.additionalTools = additionalTools;
        this.logger.debug(
          '[CodeHealthAnalysis] Additional tools detected',
          additionalTools
        );
      }
    } catch (error) {
      this.logger.warn(
        '[CodeHealthAnalysis] Error detecting code conventions',
        error as Error
      );
    }

    this.logger.debug('[CodeHealthAnalysis] Code conventions detected', {
      usePrettier: conventions.usePrettier,
      useEslint: conventions.useEslint,
      indentation: conventions.indentation,
      indentSize: conventions.indentSize,
    });

    return conventions;
  }

  /**
   * Estimate test coverage based on file analysis.
   *
   * Provides an estimated coverage percentage based on the ratio of test files
   * to source files. This is a heuristic estimate, not actual code coverage.
   *
   * **Detection Logic:**
   * - Counts source files (*.ts, *.tsx, *.js, *.jsx) excluding tests
   * - Counts test files (*.spec.*, *.test.*, __tests__/*)
   * - Detects test framework from config files (Jest, Vitest, Mocha)
   * - Checks for E2E tests (Cypress, Playwright)
   * - Checks for integration tests (*.integration.*)
   *
   * **Coverage Estimation:**
   * A test-to-source ratio of 0.4 (40% as many test files as source files)
   * is considered 100% estimated coverage.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscodeApi - VS Code API module
   * @returns Test coverage estimation
   *
   * @example
   * ```typescript
   * const coverage = await codeHealth.estimateTestCoverage(workspaceUri, vscode);
   * // Returns: { percentage: 65, hasTests: true, testFramework: 'jest', ... }
   * ```
   */
  async estimateTestCoverage(
    workspaceUri: vscode.Uri,
    vscodeApi: typeof import('vscode')
  ): Promise<TestCoverageEstimate> {
    this.logger.debug('[CodeHealthAnalysis] Estimating test coverage', {
      workspaceRoot: workspaceUri.fsPath,
    });

    // Count source files (non-test)
    const sourceFiles = await vscodeApi.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx}',
      '{**/node_modules/**,**/*.spec.*,**/*.test.*,**/__tests__/**,**/test/**}',
      2000
    );

    // Count test files
    const specFiles = await vscodeApi.workspace.findFiles(
      '**/*.spec.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );
    const testFiles = await vscodeApi.workspace.findFiles(
      '**/*.test.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );
    const testDirFiles = await vscodeApi.workspace.findFiles(
      '**/__tests__/**/*.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );

    const totalTestFiles =
      specFiles.length + testFiles.length + testDirFiles.length;
    const hasTests = totalTestFiles > 0;

    // Detect test framework from config or dependencies
    let testFramework: string | undefined;

    // Check for Jest
    const jestConfig = await vscodeApi.workspace.findFiles(
      '{jest.config.*,jest.preset.js}',
      '**/node_modules/**',
      1
    );
    if (jestConfig.length > 0) {
      testFramework = 'jest';
    }

    // Check for Vitest
    const vitestConfig = await vscodeApi.workspace.findFiles(
      'vitest.config.*',
      '**/node_modules/**',
      1
    );
    if (vitestConfig.length > 0) {
      testFramework = 'vitest';
    }

    // Check for Mocha
    const mochaConfig = await vscodeApi.workspace.findFiles(
      '.mocharc*',
      '**/node_modules/**',
      1
    );
    if (mochaConfig.length > 0) {
      testFramework = 'mocha';
    }

    // Check for E2E tests
    const cypressFiles = await vscodeApi.workspace.findFiles(
      '{cypress/**/*.{ts,js},cypress.config.*}',
      '**/node_modules/**',
      5
    );
    const playwrightFiles = await vscodeApi.workspace.findFiles(
      '{playwright/**/*.{ts,js},playwright.config.*}',
      '**/node_modules/**',
      5
    );
    const e2eFiles = await vscodeApi.workspace.findFiles(
      '**/e2e/**/*.{ts,js}',
      '**/node_modules/**',
      10
    );

    const hasE2eTests =
      cypressFiles.length > 0 ||
      playwrightFiles.length > 0 ||
      e2eFiles.length > 0;

    // Check for integration tests
    const integrationFiles = await vscodeApi.workspace.findFiles(
      '**/*.integration.{ts,js,spec.ts,test.ts}',
      '**/node_modules/**',
      10
    );
    const hasIntegrationTests = integrationFiles.length > 0;

    // Calculate estimated coverage
    const sourceFileCount = sourceFiles.length;
    const testFileCount = totalTestFiles;
    const testToSourceRatio =
      sourceFileCount > 0 ? testFileCount / sourceFileCount : 0;

    // Estimate percentage (heuristic: good ratio is ~0.3-0.4)
    // Cap at 100%, scale non-linearly
    const percentage = Math.min(
      100,
      Math.round(testToSourceRatio * 250) // 0.4 ratio = 100%
    );

    const coverage: TestCoverageEstimate = {
      percentage,
      hasTests,
      testFramework,
      hasUnitTests: hasTests,
      hasIntegrationTests,
      hasE2eTests,
      testFileCount,
      sourceFileCount,
      testToSourceRatio: Math.round(testToSourceRatio * 100) / 100,
    };

    this.logger.debug('[CodeHealthAnalysis] Test coverage estimated', {
      percentage,
      hasTests,
      testFramework,
      testFileCount,
      sourceFileCount,
      testToSourceRatio: coverage.testToSourceRatio,
    });

    return coverage;
  }

  /**
   * Get an empty diagnostic summary.
   *
   * Utility method for cases when diagnostics are not available.
   *
   * @returns Empty diagnostic summary with zero counts
   */
  getEmptyDiagnosticSummary(): DiagnosticSummary {
    return {
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      errorsByType: {},
      warningsByType: {},
    };
  }

  /**
   * Get default code conventions.
   *
   * Utility method for cases when convention detection fails.
   *
   * @returns Default code conventions
   */
  getDefaultConventions(): CodeConventions {
    return {
      indentation: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      trailingComma: 'es5',
    };
  }
}

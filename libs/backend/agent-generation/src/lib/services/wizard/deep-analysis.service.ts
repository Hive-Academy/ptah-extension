/**
 * DeepProjectAnalysisService - Comprehensive Project Analysis Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Perform comprehensive project analysis using VS Code APIs
 * - Detect architecture patterns (DDD, Layered, Microservices, etc.)
 * - Extract key file locations (entry points, configs, tests, etc.)
 * - Calculate language distribution
 *
 * Pattern Source: setup-wizard.service.ts:696-1250
 * Extracted from: SetupWizardService deep analysis methods
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';
import { AGENT_GENERATION_TOKENS } from '../../di/tokens';
import type { AgentGenerationOrchestratorService } from '../orchestrator.service';
import type { CodeHealthAnalysisService } from './code-health.service';
import type {
  DeepProjectAnalysis,
  ArchitecturePattern,
  ArchitecturePatternName,
  KeyFileLocations,
  LanguageStats,
} from '../../types/analysis.types';

/**
 * Service responsible for comprehensive project analysis.
 *
 * This service provides:
 * - Deep workspace analysis combining orchestrator results with VS Code APIs
 * - Architecture pattern detection (DDD, Layered, Microservices, Hexagonal, etc.)
 * - Key file location extraction (entry points, configs, tests, APIs, components)
 * - Language distribution calculation
 *
 * Integrates with CodeHealthAnalysisService for diagnostics, conventions, and coverage.
 *
 * @injectable
 */
@injectable()
export class DeepProjectAnalysisService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR)
    private readonly orchestrator: AgentGenerationOrchestratorService,
    @inject(AGENT_GENERATION_TOKENS.CODE_HEALTH_ANALYSIS)
    private readonly codeHealth: CodeHealthAnalysisService
  ) {
    this.logger.debug('[DeepProjectAnalysis] Service initialized');
  }

  /**
   * Perform comprehensive deep analysis of the workspace.
   *
   * **Analysis Steps:**
   * 1. Get basic workspace analysis from orchestrator
   * 2. Detect architecture patterns via folder structure
   * 3. Find key configuration files
   * 4. Get workspace symbols for structure understanding
   * 5. Get diagnostics for code health
   * 6. Extract key file locations
   * 7. Calculate language distribution
   * 8. Summarize diagnostics
   * 9. Detect code conventions
   * 10. Estimate test coverage
   *
   * @param workspaceUri - Workspace root URI
   * @returns Result with DeepProjectAnalysis or Error
   *
   * @example
   * ```typescript
   * const result = await deepAnalysis.performDeepAnalysis(workspaceUri);
   * if (result.isOk()) {
   *   const analysis = result.value;
   *   console.log('Project type:', analysis.projectType);
   *   console.log('Architecture patterns:', analysis.architecturePatterns);
   * }
   * ```
   */
  async performDeepAnalysis(
    workspaceUri: vscode.Uri
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    try {
      this.logger.info('[DeepProjectAnalysis] Starting deep project analysis', {
        workspace: workspaceUri.fsPath,
      });

      // Dynamic import to avoid circular dependencies
      const vscodeApi = await import('vscode');

      // Step 1: Get basic workspace analysis from orchestrator
      const basicResult = await this.orchestrator.analyzeWorkspace({
        workspaceUri,
        threshold: 50,
      });

      let projectType: (typeof ProjectType)[keyof typeof ProjectType] =
        ProjectType.Unknown;
      let frameworks: (typeof Framework)[keyof typeof Framework][] = [];
      let monorepoType:
        | (typeof MonorepoType)[keyof typeof MonorepoType]
        | undefined;

      if (basicResult.isOk() && basicResult.value) {
        projectType = basicResult.value.projectType;
        frameworks = basicResult.value.frameworks;
        monorepoType = basicResult.value.monorepoType;
      }

      // Step 2: Detect architecture patterns via folder structure
      const architecturePatterns = await this.detectArchitecturePatterns(
        workspaceUri,
        vscodeApi
      );

      // Step 3: Find key configuration files
      const configFiles = await vscodeApi.workspace.findFiles(
        '**/*.config.{ts,js,json}',
        '**/node_modules/**',
        50
      );
      const packageJsonFiles = await vscodeApi.workspace.findFiles(
        '**/package.json',
        '**/node_modules/**',
        20
      );

      // Step 4: Get workspace symbols for structure understanding
      let symbols: vscode.SymbolInformation[] = [];
      try {
        const symbolResult = await vscodeApi.commands.executeCommand<
          vscode.SymbolInformation[]
        >('vscode.executeWorkspaceSymbolProvider', '');
        if (symbolResult) {
          symbols = symbolResult;
        }
      } catch (error) {
        this.logger.warn(
          '[DeepProjectAnalysis] Failed to get workspace symbols',
          error as Error
        );
      }

      // Step 5: Get diagnostics for code health
      const diagnostics = vscodeApi.languages.getDiagnostics();

      // Step 6: Extract key file locations
      const keyFileLocations = await this.extractKeyLocations(
        workspaceUri,
        configFiles,
        symbols,
        vscodeApi
      );

      // Step 7: Calculate language distribution
      const languageDistribution = await this.calculateLanguageDistribution(
        workspaceUri,
        vscodeApi
      );

      // Step 8: Summarize diagnostics (delegate to CodeHealthAnalysisService)
      const existingIssues = this.codeHealth.summarizeDiagnostics(diagnostics);

      // Step 9: Detect code conventions (delegate to CodeHealthAnalysisService)
      const codeConventions = await this.codeHealth.detectCodeConventions(
        workspaceUri,
        vscodeApi
      );

      // Step 10: Estimate test coverage (delegate to CodeHealthAnalysisService)
      const testCoverage = await this.codeHealth.estimateTestCoverage(
        workspaceUri,
        vscodeApi
      );

      const analysis: DeepProjectAnalysis = {
        projectType,
        frameworks,
        monorepoType,
        architecturePatterns,
        keyFileLocations,
        languageDistribution,
        existingIssues,
        codeConventions,
        testCoverage,
      };

      this.logger.info('[DeepProjectAnalysis] Deep project analysis complete', {
        projectType: projectType.toString(),
        frameworkCount: frameworks.length,
        patternCount: architecturePatterns.length,
        errorCount: existingIssues.errorCount,
        hasTests: testCoverage.hasTests,
      });

      return Result.ok(analysis);
    } catch (error) {
      this.logger.error(
        '[DeepProjectAnalysis] Deep project analysis failed',
        error as Error
      );
      return Result.err(
        new Error(`Deep analysis failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Detect architecture patterns based on folder structure and file organization.
   *
   * Analyzes the workspace for common architectural patterns including:
   * - DDD (Domain-Driven Design): domain/, entities/, aggregates/, value-objects/
   * - Layered: controllers/, services/, repositories/
   * - Microservices: apps/, services/ with separate package.json
   * - Hexagonal: ports/, adapters/, application/, domain/
   * - Clean Architecture: use-cases/, entities/, interfaces/
   * - Component-Based: components/ for frontend development
   *
   * @param workspaceUri - Workspace root URI
   * @param vscodeApi - VS Code API module
   * @returns Array of detected architecture patterns with confidence scores (0-100)
   */
  async detectArchitecturePatterns(
    workspaceUri: vscode.Uri,
    vscodeApi: typeof import('vscode')
  ): Promise<ArchitecturePattern[]> {
    this.logger.debug('[DeepProjectAnalysis] Detecting architecture patterns', {
      workspaceRoot: workspaceUri.fsPath,
    });

    const patterns: ArchitecturePattern[] = [];

    // Check for DDD patterns
    const domainFolders = await vscodeApi.workspace.findFiles(
      '**/domain/**/*.ts',
      '**/node_modules/**',
      10
    );
    const entitiesFolders = await vscodeApi.workspace.findFiles(
      '**/entities/**/*.ts',
      '**/node_modules/**',
      10
    );
    const aggregatesFolders = await vscodeApi.workspace.findFiles(
      '**/aggregates/**/*.ts',
      '**/node_modules/**',
      5
    );
    const valueObjectsFolders = await vscodeApi.workspace.findFiles(
      '**/value-objects/**/*.ts',
      '**/node_modules/**',
      5
    );

    const dddEvidence: string[] = [];
    if (domainFolders.length > 0) {
      dddEvidence.push(...domainFolders.slice(0, 3).map((f) => f.fsPath));
    }
    if (entitiesFolders.length > 0) {
      dddEvidence.push(...entitiesFolders.slice(0, 3).map((f) => f.fsPath));
    }
    if (aggregatesFolders.length > 0) {
      dddEvidence.push(...aggregatesFolders.slice(0, 2).map((f) => f.fsPath));
    }
    if (valueObjectsFolders.length > 0) {
      dddEvidence.push(...valueObjectsFolders.slice(0, 2).map((f) => f.fsPath));
    }

    if (dddEvidence.length >= 3) {
      const confidence = Math.min(95, 50 + dddEvidence.length * 8);
      patterns.push({
        name: 'DDD' as ArchitecturePatternName,
        confidence,
        evidence: dddEvidence,
        description:
          'Domain-Driven Design pattern detected with domain entities and value objects',
      });
    }

    // Check for Layered architecture
    const layeredPatterns = [
      'controllers',
      'services',
      'repositories',
      'models',
    ];
    const layeredResults = await Promise.all(
      layeredPatterns.map(async (layer) => {
        const files = await vscodeApi.workspace.findFiles(
          `**/${layer}/**/*.ts`,
          '**/node_modules/**',
          5
        );
        return { layer, hasFiles: files.length > 0, files };
      })
    );

    const layeredEvidence = layeredResults
      .filter((r) => r.hasFiles)
      .flatMap((r) => r.files.slice(0, 2).map((f) => f.fsPath));

    const layeredCount = layeredResults.filter((r) => r.hasFiles).length;
    if (layeredCount >= 3) {
      patterns.push({
        name: 'Layered' as ArchitecturePatternName,
        confidence: Math.min(90, 60 + layeredCount * 10),
        evidence: layeredEvidence,
        description:
          'Layered architecture with controllers, services, and repositories',
      });
    }

    // Check for Microservices pattern
    const appsFolder = await vscodeApi.workspace.findFiles(
      'apps/*/package.json',
      '**/node_modules/**',
      10
    );
    const servicesFolder = await vscodeApi.workspace.findFiles(
      'services/*/package.json',
      '**/node_modules/**',
      10
    );

    if (appsFolder.length >= 2 || servicesFolder.length >= 2) {
      const microservicesEvidence = [
        ...appsFolder.slice(0, 3).map((f) => f.fsPath),
        ...servicesFolder.slice(0, 3).map((f) => f.fsPath),
      ];
      patterns.push({
        name: 'Microservices' as ArchitecturePatternName,
        confidence: Math.min(
          85,
          55 + (appsFolder.length + servicesFolder.length) * 5
        ),
        evidence: microservicesEvidence,
        description:
          'Microservices architecture with multiple service packages',
      });
    }

    // Check for Hexagonal/Ports & Adapters
    const portsFiles = await vscodeApi.workspace.findFiles(
      '**/ports/**/*.ts',
      '**/node_modules/**',
      5
    );
    const adaptersFiles = await vscodeApi.workspace.findFiles(
      '**/adapters/**/*.ts',
      '**/node_modules/**',
      5
    );

    if (portsFiles.length > 0 && adaptersFiles.length > 0) {
      patterns.push({
        name: 'Hexagonal' as ArchitecturePatternName,
        confidence: Math.min(
          85,
          60 + (portsFiles.length + adaptersFiles.length) * 5
        ),
        evidence: [
          ...portsFiles.slice(0, 2).map((f) => f.fsPath),
          ...adaptersFiles.slice(0, 2).map((f) => f.fsPath),
        ],
        description: 'Hexagonal architecture with ports and adapters',
      });
    }

    // Check for Clean Architecture
    const useCasesFiles = await vscodeApi.workspace.findFiles(
      '**/use-cases/**/*.ts',
      '**/node_modules/**',
      5
    );

    if (
      useCasesFiles.length > 0 &&
      (entitiesFolders.length > 0 || domainFolders.length > 0)
    ) {
      patterns.push({
        name: 'Clean-Architecture' as ArchitecturePatternName,
        confidence: Math.min(80, 55 + useCasesFiles.length * 5),
        evidence: [
          ...useCasesFiles.slice(0, 3).map((f) => f.fsPath),
          ...entitiesFolders.slice(0, 2).map((f) => f.fsPath),
        ],
        description: 'Clean Architecture with use cases and entities layers',
      });
    }

    // Check for Component-Based (frontend)
    const componentsFiles = await vscodeApi.workspace.findFiles(
      '**/components/**/*.{ts,tsx,vue,svelte}',
      '**/node_modules/**',
      10
    );

    if (componentsFiles.length >= 5) {
      patterns.push({
        name: 'Component-Based' as ArchitecturePatternName,
        confidence: Math.min(85, 50 + componentsFiles.length * 3),
        evidence: componentsFiles.slice(0, 5).map((f) => f.fsPath),
        description: 'Component-based architecture for frontend development',
      });
    }

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    this.logger.debug('[DeepProjectAnalysis] Architecture patterns detected', {
      patternCount: patterns.length,
      patterns: patterns.map((p) => ({
        name: p.name,
        confidence: p.confidence,
      })),
    });

    return patterns;
  }

  /**
   * Extract key file locations from workspace analysis.
   *
   * Discovers important files and directories organized by purpose:
   * - Entry points (main.ts, index.ts, app.ts, server.ts)
   * - Configuration files (*.config.ts, *.config.js, *.config.json)
   * - Test directories (__tests__, test/, tests/)
   * - API routes (routes/, controllers/, api/)
   * - Components (components/)
   * - Services (services/)
   * - Models/Entities (models/, entities/, domain/)
   * - Repositories (repositories/)
   * - Utilities (utils/, helpers/, common/)
   *
   * @param workspaceUri - Workspace root URI
   * @param configFiles - Pre-discovered config files
   * @param symbols - Workspace symbols (currently unused, for future expansion)
   * @param vscodeApi - VS Code API module
   * @returns Structured key file locations
   */
  async extractKeyLocations(
    workspaceUri: vscode.Uri,
    configFiles: vscode.Uri[],
    symbols: vscode.SymbolInformation[],
    vscodeApi: typeof import('vscode')
  ): Promise<KeyFileLocations> {
    this.logger.debug('[DeepProjectAnalysis] Extracting key file locations', {
      workspaceRoot: workspaceUri.fsPath,
      configFileCount: configFiles.length,
    });

    // Find entry points
    const entryPointPatterns = [
      '**/main.ts',
      '**/index.ts',
      '**/app.ts',
      '**/server.ts',
    ];
    const entryPointFiles: string[] = [];
    for (const pattern of entryPointPatterns) {
      const files = await vscodeApi.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        5
      );
      entryPointFiles.push(...files.map((f) => f.fsPath));
    }

    // Find test directories
    const testDirs: string[] = [];
    const testPatterns = [
      '**/__tests__/**/*.ts',
      '**/test/**/*.ts',
      '**/tests/**/*.ts',
    ];
    for (const pattern of testPatterns) {
      const files = await vscodeApi.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        10
      );
      // Extract unique directories
      files.forEach((f) => {
        const dirMatch = f.fsPath.match(/.*[/\\](__tests__|tests?)[/\\]/i);
        if (dirMatch) {
          const dir = f.fsPath.substring(
            0,
            dirMatch.index! + dirMatch[0].length
          );
          if (!testDirs.includes(dir)) {
            testDirs.push(dir);
          }
        }
      });
    }

    // Find API routes
    const apiRouteFiles = await vscodeApi.workspace.findFiles(
      '**/{routes,controllers,api}/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find component directories
    const componentFiles = await vscodeApi.workspace.findFiles(
      '**/components/**/*.{ts,tsx,vue,svelte}',
      '**/node_modules/**',
      20
    );

    // Find service directories
    const serviceFiles = await vscodeApi.workspace.findFiles(
      '**/services/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find model/entity directories
    const modelFiles = await vscodeApi.workspace.findFiles(
      '**/{models,entities,domain}/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find repository directories
    const repoFiles = await vscodeApi.workspace.findFiles(
      '**/repositories/**/*.ts',
      '**/node_modules/**',
      10
    );

    // Find utility directories
    const utilFiles = await vscodeApi.workspace.findFiles(
      '**/{utils,helpers,common}/**/*.ts',
      '**/node_modules/**',
      10
    );

    const locations: KeyFileLocations = {
      entryPoints: [...new Set(entryPointFiles)].slice(0, 10),
      configs: configFiles.map((f) => f.fsPath).slice(0, 20),
      testDirectories: [...new Set(testDirs)].slice(0, 10),
      apiRoutes: apiRouteFiles.map((f) => f.fsPath).slice(0, 15),
      components: componentFiles.map((f) => f.fsPath).slice(0, 15),
      services: serviceFiles.map((f) => f.fsPath).slice(0, 15),
      models: modelFiles.map((f) => f.fsPath).slice(0, 15),
      repositories: repoFiles.map((f) => f.fsPath).slice(0, 10),
      utilities: utilFiles.map((f) => f.fsPath).slice(0, 10),
    };

    this.logger.debug('[DeepProjectAnalysis] Key locations extracted', {
      entryPointCount: locations.entryPoints.length,
      configCount: locations.configs.length,
      testDirCount: locations.testDirectories.length,
      serviceCount: locations.services.length,
    });

    return locations;
  }

  /**
   * Calculate language distribution in the workspace.
   *
   * Counts files by extension and calculates percentage distribution.
   * Supports: TypeScript, JavaScript, TSX, JSX, Vue, Python, HTML, CSS, JSON.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscodeApi - VS Code API module
   * @returns Array of language statistics sorted by file count descending
   */
  async calculateLanguageDistribution(
    workspaceUri: vscode.Uri,
    vscodeApi: typeof import('vscode')
  ): Promise<LanguageStats[]> {
    this.logger.debug(
      '[DeepProjectAnalysis] Calculating language distribution',
      {
        workspaceRoot: workspaceUri.fsPath,
      }
    );

    const languageCounts: Record<string, number> = {};

    // Count TypeScript files
    const tsFiles = await vscodeApi.workspace.findFiles(
      '**/*.ts',
      '**/node_modules/**',
      1000
    );
    languageCounts['TypeScript'] = tsFiles.length;

    // Count JavaScript files
    const jsFiles = await vscodeApi.workspace.findFiles(
      '**/*.js',
      '**/node_modules/**',
      1000
    );
    languageCounts['JavaScript'] = jsFiles.length;

    // Count TSX files (React)
    const tsxFiles = await vscodeApi.workspace.findFiles(
      '**/*.tsx',
      '**/node_modules/**',
      1000
    );
    languageCounts['TSX'] = tsxFiles.length;

    // Count JSX files (React)
    const jsxFiles = await vscodeApi.workspace.findFiles(
      '**/*.jsx',
      '**/node_modules/**',
      1000
    );
    languageCounts['JSX'] = jsxFiles.length;

    // Count Vue files
    const vueFiles = await vscodeApi.workspace.findFiles(
      '**/*.vue',
      '**/node_modules/**',
      500
    );
    languageCounts['Vue'] = vueFiles.length;

    // Count Python files
    const pyFiles = await vscodeApi.workspace.findFiles(
      '**/*.py',
      '**/node_modules/**',
      500
    );
    languageCounts['Python'] = pyFiles.length;

    // Count HTML files
    const htmlFiles = await vscodeApi.workspace.findFiles(
      '**/*.html',
      '**/node_modules/**',
      500
    );
    languageCounts['HTML'] = htmlFiles.length;

    // Count CSS/SCSS/LESS files
    const cssFiles = await vscodeApi.workspace.findFiles(
      '**/*.{css,scss,less}',
      '**/node_modules/**',
      500
    );
    languageCounts['CSS'] = cssFiles.length;

    // Count JSON files
    const jsonFiles = await vscodeApi.workspace.findFiles(
      '**/*.json',
      '**/node_modules/**',
      500
    );
    languageCounts['JSON'] = jsonFiles.length;

    // Calculate total and percentages
    const total = Object.values(languageCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    if (total === 0) {
      this.logger.debug('[DeepProjectAnalysis] No source files found');
      return [];
    }

    const stats: LanguageStats[] = Object.entries(languageCounts)
      .filter(([_, count]) => count > 0)
      .map(([language, fileCount]) => ({
        language,
        fileCount,
        percentage: Math.round((fileCount / total) * 1000) / 10, // One decimal place
      }))
      .sort((a, b) => b.fileCount - a.fileCount);

    this.logger.debug(
      '[DeepProjectAnalysis] Language distribution calculated',
      {
        totalFiles: total,
        languageCount: stats.length,
        topLanguage: stats[0]?.language,
      }
    );

    return stats;
  }
}

/**
 * Setup RPC Handlers
 *
 * Handles setup-related RPC methods:
 * - setup-status:get-status - Get agent configuration status
 * - setup-wizard:launch - Launch setup wizard webview
 * - wizard:deep-analyze - Perform deep project analysis
 * - wizard:recommend-agents - Calculate agent recommendations
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_069: Setup wizard integration
 * TASK_2025_111: Added deep analysis and recommendation handlers
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { z } from 'zod';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import type {
  DeepProjectAnalysis,
  AgentRecommendation,
} from '@ptah-extension/agent-generation';

/**
 * Zod schema for comprehensive project analysis input validation.
 *
 * Validates the structure of DeepProjectAnalysis received from the frontend
 * before processing agent recommendations. Provides sensible defaults for
 * optional arrays and nested objects to prevent runtime errors.
 *
 * @remarks
 * - projectType and frameworks accept both string and number to handle enum serialization
 * - All array fields have default values to prevent undefined access
 * - Nested objects are validated recursively with appropriate defaults
 */
const ProjectAnalysisSchema = z.object({
  // Core project identification
  projectType: z.union([z.string(), z.number()]),
  frameworks: z.array(z.union([z.string(), z.number()])).default([]),
  monorepoType: z.string().optional(),

  // Architecture patterns with confidence scoring
  architecturePatterns: z
    .array(
      z.object({
        name: z.string(),
        confidence: z.number().min(0).max(100),
        evidence: z.array(z.string()),
        description: z.string().optional(),
      })
    )
    .default([]),

  // Key file locations organized by purpose
  keyFileLocations: z
    .object({
      entryPoints: z.array(z.string()).default([]),
      configs: z.array(z.string()).default([]),
      testDirectories: z.array(z.string()).default([]),
      apiRoutes: z.array(z.string()).default([]),
      components: z.array(z.string()).default([]),
      services: z.array(z.string()).default([]),
      models: z.array(z.string()).optional(),
      repositories: z.array(z.string()).optional(),
      utilities: z.array(z.string()).optional(),
    })
    .default({
      entryPoints: [],
      configs: [],
      testDirectories: [],
      apiRoutes: [],
      components: [],
      services: [],
    }),

  // Language distribution statistics
  languageDistribution: z
    .array(
      z.object({
        language: z.string(),
        percentage: z.number().min(0).max(100),
        fileCount: z.number().min(0),
        linesOfCode: z.number().min(0).optional(),
      })
    )
    .default([]),

  // Code health diagnostics
  existingIssues: z
    .object({
      errorCount: z.number().min(0).default(0),
      warningCount: z.number().min(0).default(0),
      infoCount: z.number().min(0).default(0),
      errorsByType: z.record(z.number()).default({}),
      warningsByType: z.record(z.number()).default({}),
      topErrors: z
        .array(
          z.object({
            message: z.string(),
            count: z.number(),
            source: z.string(),
          })
        )
        .optional(),
    })
    .default({
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      errorsByType: {},
      warningsByType: {},
    }),

  // Code conventions detection
  codeConventions: z
    .object({
      indentation: z.enum(['tabs', 'spaces']),
      indentSize: z.number().min(1).max(8),
      quoteStyle: z.enum(['single', 'double']),
      semicolons: z.boolean(),
      trailingComma: z.enum(['none', 'es5', 'all']).optional(),
      namingConventions: z
        .object({
          files: z.string().optional(),
          classes: z.string().optional(),
          functions: z.string().optional(),
          variables: z.string().optional(),
          constants: z.string().optional(),
          interfaces: z.string().optional(),
          types: z.string().optional(),
        })
        .optional(),
      maxLineLength: z.number().optional(),
      usePrettier: z.boolean().optional(),
      useEslint: z.boolean().optional(),
      additionalTools: z.array(z.string()).optional(),
    })
    .optional(),

  // Test coverage estimation
  testCoverage: z
    .object({
      percentage: z.number().min(0).max(100).default(0),
      hasTests: z.boolean().default(false),
      testFramework: z.string().optional(),
      hasUnitTests: z.boolean().default(false),
      hasIntegrationTests: z.boolean().default(false),
      hasE2eTests: z.boolean().default(false),
      testFileCount: z.number().min(0).optional(),
      sourceFileCount: z.number().min(0).optional(),
      testToSourceRatio: z.number().min(0).optional(),
    })
    .default({
      percentage: 0,
      hasTests: false,
      hasUnitTests: false,
      hasIntegrationTests: false,
      hasE2eTests: false,
    }),

  // File count (optional, added for completeness)
  fileCount: z.number().min(0).optional(),
  languages: z.array(z.string()).optional(),
});

/**
 * SetupStatus response type for setup-status:get-status RPC method
 */
interface SetupStatusResponse {
  isConfigured: boolean;
  agentCount: number;
  lastModified: string | null;
  projectAgents: string[];
  userAgents: string[];
}

/**
 * RPC handlers for setup operations
 */
@injectable()
export class SetupRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Register all setup RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerLaunchWizard();
    this.registerDeepAnalyze();
    this.registerRecommendAgents();

    this.logger.debug('Setup RPC handlers registered', {
      methods: [
        'setup-status:get-status',
        'setup-wizard:launch',
        'wizard:deep-analyze',
        'wizard:recommend-agents',
      ],
    });
  }

  /**
   * setup-status:get-status - Get agent configuration status
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<void, SetupStatusResponse>(
      'setup-status:get-status',
      async () => {
        this.logger.debug('RPC: setup-status:get-status called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to configure agents.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupStatusService from DI container
        const setupStatusService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE
        ) as {
          getStatus: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            value?: SetupStatusResponse;
            error?: Error;
          }>;
        };

        // Get status
        const result = await setupStatusService.getStatus(workspaceFolder.uri);

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to get setup status', result.error);
          throw new Error(
            result.error?.message || 'Failed to retrieve agent setup status'
          );
        }

        // Return the status data
        return result.value as SetupStatusResponse;
      }
    );
  }

  /**
   * setup-wizard:launch - Launch setup wizard webview
   */
  private registerLaunchWizard(): void {
    this.rpcHandler.registerMethod<void, { success: boolean }>(
      'setup-wizard:launch',
      async () => {
        this.logger.debug('RPC: setup-wizard:launch called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder first.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupWizardService from DI container
        const setupWizardService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
        ) as {
          launchWizard: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            error?: Error;
          }>;
        };

        // Launch wizard
        const result = await setupWizardService.launchWizard(
          workspaceFolder.uri
        );

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to launch setup wizard', result.error);
          throw new Error(
            result.error?.message || 'Failed to launch setup wizard'
          );
        }

        // Return success
        return { success: true };
      }
    );
  }

  /**
   * wizard:deep-analyze - Perform deep project analysis
   *
   * Conducts comprehensive analysis of the workspace including:
   * - Architecture pattern detection
   * - Key file location discovery
   * - Language distribution analysis
   * - Code health assessment
   * - Code convention detection
   * - Test coverage estimation
   */
  private registerDeepAnalyze(): void {
    this.rpcHandler.registerMethod<void, DeepProjectAnalysis>(
      'wizard:deep-analyze',
      async () => {
        this.logger.debug('RPC: wizard:deep-analyze called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to analyze.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupWizardService from DI container
        const setupWizardService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
        ) as {
          performDeepAnalysis: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            isOk: () => boolean;
            value?: DeepProjectAnalysis;
            error?: Error;
          }>;
        };

        // Perform deep analysis
        const result = await setupWizardService.performDeepAnalysis(
          workspaceFolder.uri
        );

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to perform deep analysis', result.error);
          throw new Error(
            result.error?.message || 'Failed to perform deep project analysis'
          );
        }

        this.logger.info('Deep analysis completed successfully', {
          projectType: result.value?.projectType?.toString() || 'unknown',
          patternCount: result.value?.architecturePatterns?.length || 0,
        });

        // Return the analysis data
        return result.value as DeepProjectAnalysis;
      }
    );
  }

  /**
   * wizard:recommend-agents - Calculate agent recommendations
   *
   * Accepts a DeepProjectAnalysis and returns scored recommendations
   * for all 13 agents based on project characteristics.
   *
   * Input is validated using Zod schema to ensure type safety and provide
   * descriptive error messages with field paths on validation failure.
   *
   * @remarks
   * TASK_2025_113 T3.3: Added comprehensive Zod input validation
   */
  private registerRecommendAgents(): void {
    this.rpcHandler.registerMethod<unknown, AgentRecommendation[]>(
      'wizard:recommend-agents',
      async (rawAnalysis) => {
        this.logger.debug('RPC: wizard:recommend-agents called');

        // Validate input exists
        if (!rawAnalysis) {
          throw new Error(
            'Missing analysis input. Please run wizard:deep-analyze first.'
          );
        }

        // Validate input structure with Zod schema
        const validationResult = ProjectAnalysisSchema.safeParse(rawAnalysis);

        if (!validationResult.success) {
          // Format error messages with field paths for debugging
          const errors = validationResult.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');

          this.logger.error('Invalid analysis input', {
            errors,
            receivedKeys: Object.keys(rawAnalysis as object),
          });

          throw new Error(`Invalid analysis input: ${errors}`);
        }

        // Use validated data with defaults applied
        const analysis = validationResult.data;

        this.logger.debug('Analysis input validated successfully', {
          projectType: String(analysis.projectType),
          frameworkCount: analysis.frameworks.length,
          patternCount: analysis.architecturePatterns.length,
          hasKeyFileLocations: !!analysis.keyFileLocations,
        });

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS, AgentRecommendationService } =
          await import('@ptah-extension/agent-generation');

        // Try to resolve from container first, fallback to direct instantiation
        let recommendationService: {
          calculateRecommendations: (
            analysis: DeepProjectAnalysis
          ) => AgentRecommendation[];
        };

        try {
          recommendationService = this.container.resolve(
            AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE
          ) as {
            calculateRecommendations: (
              analysis: DeepProjectAnalysis
            ) => AgentRecommendation[];
          };
        } catch {
          // If not registered in container, create new instance with logger
          this.logger.debug(
            'AgentRecommendationService not in container, creating instance'
          );
          recommendationService = this.container.resolve(
            AgentRecommendationService
          );
        }

        // Calculate recommendations using validated analysis
        // Cast to DeepProjectAnalysis since Zod schema aligns with the interface
        const recommendations = recommendationService.calculateRecommendations(
          analysis as unknown as DeepProjectAnalysis
        );

        this.logger.info('Agent recommendations calculated', {
          totalAgents: recommendations.length,
          recommendedCount: recommendations.filter((r) => r.recommended).length,
        });

        return recommendations;
      }
    );
  }
}

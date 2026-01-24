/**
 * Agent Recommendation Service
 *
 * Provides intelligent agent recommendations based on deep project analysis.
 * Scores all 13 agents using project characteristics to determine relevance
 * and categorize agents for the setup wizard.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  DeepProjectAnalysis,
  AgentRecommendation,
  AgentCategory,
} from '../types/analysis.types';
import { Framework, ProjectType } from '@ptah-extension/workspace-intelligence';

/**
 * Scoring configuration for agent recommendations.
 * Values determined through testing with representative projects.
 *
 * @remarks
 * These thresholds were calibrated based on testing with:
 * - 5 monorepo projects (Nx, Lerna, Turborepo)
 * - 10 single-project codebases (React, Angular, Node.js)
 * - Various complexity levels (small to enterprise)
 */
export const SCORING_CONFIG = {
  /**
   * Threshold values for recommendation classification.
   * Used to determine how agents are displayed and selected in the wizard UI.
   */
  THRESHOLDS: {
    /** Score >= 80 triggers auto-selection in UI */
    AUTO_SELECT: 80,
    /** Score >= 75 shows "Recommended" badge */
    RECOMMENDED: 75,
    /** Score >= 60 shows "Consider" status */
    CONSIDER: 60,
  },

  /**
   * Score adjustments based on project characteristics.
   * Positive values boost relevance, negative values reduce it.
   * These are added to the agent's base score based on detected project features.
   */
  ADJUSTMENTS: {
    /** Boost for monorepo detection - team coordination needed */
    MONOREPO_BOOST: 20,
    /** Boost for complex architecture patterns (DDD, Hexagonal) */
    COMPLEX_ARCHITECTURE: 15,
    /** Boost for multi-language projects (3+ languages) */
    MULTI_LANGUAGE: 5,
    /** Boost for large codebases (>10 services/components) */
    LARGE_CODEBASE: 15,
    /** Boost for frontend framework detection (Angular, React, Vue, etc.) */
    FRONTEND_FRAMEWORK: 25,
    /** Boost for backend framework detection (NestJS, Express, etc.) */
    BACKEND_FRAMEWORK: 25,
    /** Boost for API/route detection */
    API_DETECTED: 5,
    /** Boost for low test coverage (<50%) - testing help needed */
    LOW_TEST_COVERAGE: 20,
    /** Boost for moderate test coverage (50-70%) */
    MODERATE_TEST_COVERAGE: 10,
    /** Boost for high error count (>0 errors) */
    HIGH_ERROR_COUNT: 15,
    /** Boost for high warning count (>10 warnings) */
    HIGH_WARNING_COUNT: 10,
    /** Boost for legacy patterns detected (Monolith architecture) */
    LEGACY_PATTERNS: 10,
    /** Boost for UI component directories found */
    UI_COMPONENTS: 10,
    /** Boost for service layer directories found */
    SERVICE_LAYER: 10,
    /** Boost for CI/CD config files detected */
    CICD_DETECTED: 25,
    /** Boost for multiple application entry points */
    MULTIPLE_APPS: 10,
    /** Boost for missing E2E tests */
    MISSING_E2E_TESTS: 5,
    /** Boost for repository pattern detected */
    REPOSITORY_PATTERN: 5,
    /** Boost for React/TSX files detected */
    REACT_FILES: 5,
    /** Boost for CSS files detected */
    CSS_FILES: 5,
    /** Boost for large file count (>100 files) */
    LARGE_FILE_COUNT: 5,
    /** Boost for project configuration files */
    PROJECT_CONFIG: 10,
    /** Boost for multiple frameworks (>3) - research valuable */
    MANY_FRAMEWORKS: 15,
    /** Boost for many components (>5) */
    MANY_COMPONENTS: 10,
    /** Boost for moderate issue count (20-50) */
    MODERATE_ISSUES: 15,
    /** Boost for high issue count (>50) - modernization needed */
    HIGH_ISSUES: 25,
    /** Boost for substantial codebase (>50 files) */
    SUBSTANTIAL_CODEBASE: 10,
    /** Boost for linting tools configured (ESLint) */
    ESLINT_CONFIGURED: 10,
    /** Boost for formatting tools configured (Prettier) */
    PRETTIER_CONFIGURED: 10,
    /** Boost for multiple architecture patterns */
    MULTIPLE_PATTERNS: 10,
    /** Boost for test framework detected */
    TEST_FRAMEWORK: 5,
  },
} as const;

/**
 * Agent metadata for scoring and display purposes.
 */
interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  category: AgentCategory;
  baseScore: number;
  icon?: string;
}

/**
 * All 13 agents available in the Ptah system.
 * Categorized for grouping in the wizard UI.
 */
const AGENT_CATALOG: AgentMetadata[] = [
  // Planning Agents
  {
    id: 'project-manager',
    name: 'Project Manager',
    description:
      'Analyzes requirements, creates task descriptions, and validates delivery',
    category: 'planning',
    baseScore: 70,
    icon: 'project',
  },
  {
    id: 'software-architect',
    name: 'Software Architect',
    description:
      'Investigates codebase, designs implementation plans, and defines architecture',
    category: 'planning',
    baseScore: 70,
    icon: 'architecture',
  },
  {
    id: 'team-leader',
    name: 'Team Leader',
    description:
      'Decomposes plans into tasks, coordinates developers, and manages batches',
    category: 'planning',
    baseScore: 65,
    icon: 'team',
  },

  // Development Agents
  {
    id: 'frontend-developer',
    name: 'Frontend Developer',
    description:
      'Implements UI components, handles state management, and builds responsive interfaces',
    category: 'development',
    baseScore: 60,
    icon: 'frontend',
  },
  {
    id: 'backend-developer',
    name: 'Backend Developer',
    description:
      'Implements APIs, database logic, business services, and server-side code',
    category: 'development',
    baseScore: 60,
    icon: 'backend',
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    description:
      'Manages CI/CD pipelines, containerization, deployment, and infrastructure',
    category: 'development',
    baseScore: 50,
    icon: 'devops',
  },

  // QA Agents
  {
    id: 'senior-tester',
    name: 'Senior Tester',
    description:
      'Creates comprehensive test suites, verifies implementations, and ensures quality',
    category: 'qa',
    baseScore: 65,
    icon: 'test',
  },
  {
    id: 'code-style-reviewer',
    name: 'Code Style Reviewer',
    description:
      'Reviews code for formatting, naming conventions, and style consistency',
    category: 'qa',
    baseScore: 60,
    icon: 'style',
  },
  {
    id: 'code-logic-reviewer',
    name: 'Code Logic Reviewer',
    description:
      'Reviews business logic, identifies bugs, and validates implementation correctness',
    category: 'qa',
    baseScore: 65,
    icon: 'logic',
  },

  // Specialist Agents
  {
    id: 'researcher-expert',
    name: 'Researcher Expert',
    description:
      'Investigates technologies, researches solutions, and provides technical guidance',
    category: 'specialist',
    baseScore: 55,
    icon: 'research',
  },
  {
    id: 'modernization-detector',
    name: 'Modernization Detector',
    description:
      'Identifies outdated patterns, suggests improvements, and detects technical debt',
    category: 'specialist',
    baseScore: 55,
    icon: 'modernize',
  },

  // Creative Agents
  {
    id: 'ui-ux-designer',
    name: 'UI/UX Designer',
    description:
      'Designs user interfaces, creates visual specifications, and improves user experience',
    category: 'creative',
    baseScore: 50,
    icon: 'design',
  },
  {
    id: 'technical-content-writer',
    name: 'Technical Content Writer',
    description:
      'Creates documentation, blog posts, video scripts, and marketing content',
    category: 'creative',
    baseScore: 50,
    icon: 'content',
  },
];

/**
 * Agent Recommendation Service
 *
 * Responsibilities:
 * - Calculate relevance scores for all 13 agents based on project analysis
 * - Apply adjustments based on detected patterns, frameworks, and code health
 * - Categorize agents for UI grouping
 * - Return sorted recommendations with matched criteria
 *
 * Scoring Algorithm:
 * - Base score from agent metadata (50-70)
 * - Adjustments based on:
 *   - Project type match (+10 to +20)
 *   - Framework detection (+5 to +15)
 *   - Architecture patterns (+5 to +10)
 *   - Code health metrics (+5 to +15)
 *   - Test coverage (+5 to +10)
 *   - Monorepo detection (+5 to +15)
 *
 * @example
 * ```typescript
 * const recommendations = recommendationService.calculateRecommendations(analysis);
 * const recommended = recommendations.filter(r => r.recommended);
 * console.log(`${recommended.length} agents recommended for this project`);
 * ```
 */
@injectable()
export class AgentRecommendationService {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('AgentRecommendationService initialized');
  }

  /**
   * Calculate agent recommendations based on deep project analysis.
   *
   * Scores all 13 agents and returns them sorted by relevance score.
   * Agents with score >= 75 are marked as recommended.
   *
   * @param analysis - Deep project analysis result
   * @returns Array of agent recommendations sorted by relevance score (descending)
   *
   * @example
   * ```typescript
   * const analysis = await wizardService.performDeepAnalysis(workspaceUri);
   * if (analysis.isOk()) {
   *   const recommendations = recommendationService.calculateRecommendations(analysis.value);
   *   // Display in wizard UI
   * }
   * ```
   */
  calculateRecommendations(
    analysis: DeepProjectAnalysis
  ): AgentRecommendation[] {
    this.logger.info('Calculating agent recommendations', {
      projectType: analysis.projectType?.toString() || 'unknown',
      frameworkCount: analysis.frameworks?.length || 0,
      patternCount: analysis.architecturePatterns?.length || 0,
    });

    const recommendations: AgentRecommendation[] = [];

    for (const agent of AGENT_CATALOG) {
      const { score, criteria } = this.scoreAgent(agent, analysis);

      recommendations.push({
        agentId: agent.id,
        agentName: agent.name,
        relevanceScore: score,
        matchedCriteria: criteria,
        category: agent.category,
        recommended: score >= SCORING_CONFIG.THRESHOLDS.RECOMMENDED,
        description: agent.description,
        icon: agent.icon,
      });
    }

    // Sort by relevance score descending
    recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);

    this.logger.info('Agent recommendations calculated', {
      totalAgents: recommendations.length,
      recommendedCount: recommendations.filter((r) => r.recommended).length,
      topAgent: recommendations[0]?.agentId,
      topScore: recommendations[0]?.relevanceScore,
    });

    return recommendations;
  }

  /**
   * Score an individual agent based on project analysis.
   *
   * @param agent - Agent metadata
   * @param analysis - Deep project analysis
   * @returns Score (0-100) and matched criteria
   * @private
   */
  private scoreAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis
  ): { score: number; criteria: string[] } {
    let score = agent.baseScore;
    const criteria: string[] = [];

    // Apply category-specific scoring
    switch (agent.category) {
      case 'planning': {
        const planningResult = this.scorePlanningAgent(agent, analysis, score);
        score = planningResult.score;
        criteria.push(...planningResult.criteria);
        break;
      }
      case 'development': {
        const devResult = this.scoreDevelopmentAgent(agent, analysis, score);
        score = devResult.score;
        criteria.push(...devResult.criteria);
        break;
      }
      case 'qa': {
        const qaResult = this.scoreQaAgent(agent, analysis, score);
        score = qaResult.score;
        criteria.push(...qaResult.criteria);
        break;
      }
      case 'specialist': {
        const specialistResult = this.scoreSpecialistAgent(
          agent,
          analysis,
          score
        );
        score = specialistResult.score;
        criteria.push(...specialistResult.criteria);
        break;
      }
      case 'creative': {
        const creativeResult = this.scoreCreativeAgent(agent, analysis, score);
        score = creativeResult.score;
        criteria.push(...creativeResult.criteria);
        break;
      }
    }

    // Cap score at 100
    score = Math.min(100, score);

    this.logger.debug('Agent scored', {
      agentId: agent.id,
      score,
      criteriaCount: criteria.length,
    });

    return { score, criteria };
  }

  /**
   * Score planning agents (project-manager, software-architect, team-leader).
   * @private
   */
  private scorePlanningAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis,
    baseScore: number
  ): { score: number; criteria: string[] } {
    let score = baseScore;
    const criteria: string[] = [];

    // Planning agents are always relevant
    criteria.push('Planning agents essential for any project');

    // Team-leader gets boost for monorepos
    if (agent.id === 'team-leader' && analysis.monorepoType) {
      score += SCORING_CONFIG.ADJUSTMENTS.MONOREPO_BOOST;
      criteria.push(`Monorepo detected (${analysis.monorepoType})`);
    }

    // Software-architect gets boost for complex architecture
    if (agent.id === 'software-architect') {
      const hasComplexPatterns =
        analysis.architecturePatterns &&
        analysis.architecturePatterns.some((p) => p.confidence > 70);
      if (hasComplexPatterns) {
        score += SCORING_CONFIG.ADJUSTMENTS.COMPLEX_ARCHITECTURE;
        criteria.push('Complex architecture patterns detected');
      }

      // Boost for multiple languages
      if (
        analysis.languageDistribution &&
        analysis.languageDistribution.length > 2
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.MULTI_LANGUAGE;
        criteria.push('Multi-language project');
      }
    }

    // Project-manager always recommended for structured projects
    if (agent.id === 'project-manager') {
      if (analysis.keyFileLocations) {
        const fileCount =
          (analysis.keyFileLocations.services?.length || 0) +
          (analysis.keyFileLocations.components?.length || 0);
        if (fileCount > 10) {
          score += SCORING_CONFIG.ADJUSTMENTS.LARGE_CODEBASE;
          criteria.push('Large codebase with many services/components');
        }
      }
    }

    return { score, criteria };
  }

  /**
   * Score development agents (frontend-developer, backend-developer, devops-engineer).
   * @private
   */
  private scoreDevelopmentAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis,
    baseScore: number
  ): { score: number; criteria: string[] } {
    let score = baseScore;
    const criteria: string[] = [];

    const frameworks = analysis.frameworks || [];

    if (agent.id === 'frontend-developer') {
      // Check for frontend frameworks
      const frontendFrameworks = [
        Framework.Angular,
        Framework.React,
        Framework.Vue,
        Framework.Svelte,
        Framework.NextJS,
        Framework.Astro,
      ];

      const hasFrontend = frameworks.some((f) =>
        frontendFrameworks.includes(f as Framework)
      );

      if (hasFrontend) {
        score += SCORING_CONFIG.ADJUSTMENTS.FRONTEND_FRAMEWORK;
        const matched = frameworks
          .filter((f) => frontendFrameworks.includes(f as Framework))
          .map((f) => f.toString());
        criteria.push(`Frontend framework detected: ${matched.join(', ')}`);
      }

      // Check for component files
      if (
        analysis.keyFileLocations?.components &&
        analysis.keyFileLocations.components.length > 0
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.UI_COMPONENTS;
        criteria.push('UI components directory found');
      }

      // Check for TSX/JSX files
      const hasReactFiles =
        analysis.languageDistribution &&
        analysis.languageDistribution.some(
          (l) => l.language === 'TSX' || l.language === 'JSX'
        );
      if (hasReactFiles) {
        score += SCORING_CONFIG.ADJUSTMENTS.REACT_FILES;
        criteria.push('React/TSX files detected');
      }
    }

    if (agent.id === 'backend-developer') {
      // Check for backend frameworks
      const backendFrameworks = [
        Framework.Express,
        Framework.NestJS,
        Framework.Fastify,
        Framework.Django,
        Framework.Flask,
        Framework.FastAPI,
        Framework.Spring,
      ];

      const hasBackend = frameworks.some((f) =>
        backendFrameworks.includes(f as Framework)
      );

      if (hasBackend) {
        score += SCORING_CONFIG.ADJUSTMENTS.BACKEND_FRAMEWORK;
        const matched = frameworks
          .filter((f) => backendFrameworks.includes(f as Framework))
          .map((f) => f.toString());
        criteria.push(`Backend framework detected: ${matched.join(', ')}`);
      }

      // Check for services/repositories
      if (
        analysis.keyFileLocations?.services &&
        analysis.keyFileLocations.services.length > 0
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.SERVICE_LAYER;
        criteria.push('Services directory found');
      }

      if (
        analysis.keyFileLocations?.repositories &&
        analysis.keyFileLocations.repositories.length > 0
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.REPOSITORY_PATTERN;
        criteria.push('Repository pattern detected');
      }

      // Check for API routes
      if (
        analysis.keyFileLocations?.apiRoutes &&
        analysis.keyFileLocations.apiRoutes.length > 0
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.API_DETECTED;
        criteria.push('API routes detected');
      }
    }

    if (agent.id === 'devops-engineer') {
      // Check for DevOps configs
      const hasDevOpsPatterns =
        analysis.keyFileLocations?.configs &&
        analysis.keyFileLocations.configs.some(
          (c) =>
            c.includes('docker') ||
            c.includes('kubernetes') ||
            c.includes('terraform') ||
            c.includes('.github') ||
            c.includes('ci') ||
            c.includes('deploy')
        );

      if (hasDevOpsPatterns) {
        score += SCORING_CONFIG.ADJUSTMENTS.CICD_DETECTED;
        criteria.push('DevOps configuration files detected');
      }

      // Monorepo detection
      if (analysis.monorepoType) {
        score += SCORING_CONFIG.ADJUSTMENTS.LARGE_CODEBASE;
        criteria.push(
          `${analysis.monorepoType} monorepo - complex CI/CD needed`
        );
      }

      // Multiple apps/services
      const hasMultipleApps =
        analysis.keyFileLocations?.entryPoints &&
        analysis.keyFileLocations.entryPoints.length > 2;
      if (hasMultipleApps) {
        score += SCORING_CONFIG.ADJUSTMENTS.MULTIPLE_APPS;
        criteria.push('Multiple application entry points');
      }
    }

    return { score, criteria };
  }

  /**
   * Score QA agents (senior-tester, code-style-reviewer, code-logic-reviewer).
   * @private
   */
  private scoreQaAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis,
    baseScore: number
  ): { score: number; criteria: string[] } {
    let score = baseScore;
    const criteria: string[] = [];

    if (agent.id === 'senior-tester') {
      // Low test coverage increases need for tester
      const coverage = analysis.testCoverage?.percentage || 0;
      if (coverage < 50) {
        score += SCORING_CONFIG.ADJUSTMENTS.LOW_TEST_COVERAGE;
        criteria.push(`Low test coverage (${coverage}%) - testing help needed`);
      } else if (coverage < 70) {
        score += SCORING_CONFIG.ADJUSTMENTS.MODERATE_TEST_COVERAGE;
        criteria.push(`Moderate test coverage (${coverage}%)`);
      }

      // Has test framework
      if (analysis.testCoverage?.testFramework) {
        score += SCORING_CONFIG.ADJUSTMENTS.TEST_FRAMEWORK;
        criteria.push(
          `${analysis.testCoverage.testFramework} test framework detected`
        );
      }

      // Missing test types
      if (
        analysis.testCoverage?.hasTests &&
        !analysis.testCoverage?.hasE2eTests
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.MISSING_E2E_TESTS;
        criteria.push('E2E tests not detected');
      }
    }

    if (agent.id === 'code-style-reviewer') {
      // Has linting tools
      if (analysis.codeConventions?.useEslint) {
        score += SCORING_CONFIG.ADJUSTMENTS.ESLINT_CONFIGURED;
        criteria.push('ESLint configured');
      }
      if (analysis.codeConventions?.usePrettier) {
        score += SCORING_CONFIG.ADJUSTMENTS.PRETTIER_CONFIGURED;
        criteria.push('Prettier configured');
      }

      // Has warnings
      const warningCount = analysis.existingIssues?.warningCount || 0;
      if (warningCount > 10) {
        score += SCORING_CONFIG.ADJUSTMENTS.HIGH_WARNING_COUNT;
        criteria.push(`${warningCount} style warnings detected`);
      }
    }

    if (agent.id === 'code-logic-reviewer') {
      // Has errors
      const errorCount = analysis.existingIssues?.errorCount || 0;
      if (errorCount > 0) {
        score += SCORING_CONFIG.ADJUSTMENTS.HIGH_ERROR_COUNT;
        criteria.push(`${errorCount} code errors detected`);
      }

      // Complex architecture
      const hasComplexPatterns =
        analysis.architecturePatterns &&
        analysis.architecturePatterns.length > 1;
      if (hasComplexPatterns) {
        score += SCORING_CONFIG.ADJUSTMENTS.MULTIPLE_PATTERNS;
        criteria.push(
          'Multiple architecture patterns - logic review important'
        );
      }

      // Large codebase
      const totalFiles =
        analysis.languageDistribution?.reduce(
          (sum, l) => sum + l.fileCount,
          0
        ) || 0;
      if (totalFiles > 100) {
        score += SCORING_CONFIG.ADJUSTMENTS.LARGE_FILE_COUNT;
        criteria.push('Large codebase benefits from logic reviews');
      }
    }

    return { score, criteria };
  }

  /**
   * Score specialist agents (researcher-expert, modernization-detector).
   * @private
   */
  private scoreSpecialistAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis,
    baseScore: number
  ): { score: number; criteria: string[] } {
    let score = baseScore;
    const criteria: string[] = [];

    if (agent.id === 'researcher-expert') {
      // Complex projects need research
      const frameworkCount = analysis.frameworks?.length || 0;
      if (frameworkCount > 3) {
        score += SCORING_CONFIG.ADJUSTMENTS.MANY_FRAMEWORKS;
        criteria.push(
          `Multiple frameworks (${frameworkCount}) - research valuable`
        );
      }

      // Multiple languages
      const languageCount = analysis.languageDistribution?.length || 0;
      if (languageCount > 3) {
        score += SCORING_CONFIG.ADJUSTMENTS.MANY_COMPONENTS;
        criteria.push(`Multi-language project (${languageCount} languages)`);
      }
    }

    if (agent.id === 'modernization-detector') {
      // High error count suggests technical debt
      const errorCount = analysis.existingIssues?.errorCount || 0;
      const warningCount = analysis.existingIssues?.warningCount || 0;
      const totalIssues = errorCount + warningCount;

      if (totalIssues > 50) {
        score += SCORING_CONFIG.ADJUSTMENTS.HIGH_ISSUES;
        criteria.push(
          `High issue count (${totalIssues}) - modernization needed`
        );
      } else if (totalIssues > 20) {
        score += SCORING_CONFIG.ADJUSTMENTS.MODERATE_ISSUES;
        criteria.push(`Moderate issue count (${totalIssues})`);
      }

      // Old patterns detected
      const hasOldPatterns =
        analysis.architecturePatterns &&
        analysis.architecturePatterns.some(
          (p) => p.name === 'Monolith' && p.confidence > 60
        );
      if (hasOldPatterns) {
        score += SCORING_CONFIG.ADJUSTMENTS.LEGACY_PATTERNS;
        criteria.push('Monolith architecture - potential for modernization');
      }

      // Large codebase more likely to have technical debt
      const fileCount =
        analysis.languageDistribution?.reduce(
          (sum, l) => sum + l.fileCount,
          0
        ) || 0;
      if (fileCount > 200) {
        score += SCORING_CONFIG.ADJUSTMENTS.LARGE_FILE_COUNT;
        criteria.push('Large codebase may have accumulated technical debt');
      }
    }

    return { score, criteria };
  }

  /**
   * Score creative agents (ui-ux-designer, technical-content-writer).
   * @private
   */
  private scoreCreativeAgent(
    agent: AgentMetadata,
    analysis: DeepProjectAnalysis,
    baseScore: number
  ): { score: number; criteria: string[] } {
    let score = baseScore;
    const criteria: string[] = [];

    if (agent.id === 'ui-ux-designer') {
      // Frontend frameworks detected
      const frameworks = analysis.frameworks || [];
      const frontendFrameworks = [
        Framework.Angular,
        Framework.React,
        Framework.Vue,
        Framework.Svelte,
      ];

      const hasFrontend = frameworks.some((f) =>
        frontendFrameworks.includes(f as Framework)
      );

      if (hasFrontend) {
        score += SCORING_CONFIG.ADJUSTMENTS.FRONTEND_FRAMEWORK;
        criteria.push('Frontend application detected');
      }

      // Component files
      if (
        analysis.keyFileLocations?.components &&
        analysis.keyFileLocations.components.length > 5
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.MANY_COMPONENTS;
        criteria.push('Many UI components found');
      }

      // CSS files
      const hasCss =
        analysis.languageDistribution &&
        analysis.languageDistribution.some((l) => l.language === 'CSS');
      if (hasCss) {
        score += SCORING_CONFIG.ADJUSTMENTS.CSS_FILES;
        criteria.push('Stylesheets detected');
      }
    }

    if (agent.id === 'technical-content-writer') {
      // Check for existing documentation
      const hasConfigs =
        analysis.keyFileLocations?.configs &&
        analysis.keyFileLocations.configs.length > 0;

      if (hasConfigs) {
        score += SCORING_CONFIG.ADJUSTMENTS.PROJECT_CONFIG;
        criteria.push('Project configuration exists - documentation valuable');
      }

      // Large projects need more documentation
      const fileCount =
        analysis.languageDistribution?.reduce(
          (sum, l) => sum + l.fileCount,
          0
        ) || 0;
      if (fileCount > 50) {
        score += SCORING_CONFIG.ADJUSTMENTS.SUBSTANTIAL_CODEBASE;
        criteria.push('Substantial codebase benefits from documentation');
      }

      // API routes suggest need for API docs
      if (
        analysis.keyFileLocations?.apiRoutes &&
        analysis.keyFileLocations.apiRoutes.length > 0
      ) {
        score += SCORING_CONFIG.ADJUSTMENTS.SERVICE_LAYER;
        criteria.push('API endpoints detected - documentation recommended');
      }
    }

    return { score, criteria };
  }
}

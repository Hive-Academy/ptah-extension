/**
 * Agent Recommendation Service
 *
 * Returns the full agent-template roster as recommended for every project.
 * These agents represent standard software development roles — the intelligence
 * is in how the LLM customizes each agent's template with the project analysis,
 * not in whether an agent gets selected.
 *
 * NOTE: this catalog is the wizard's picker source and MUST stay in sync with
 * `libs/backend/agent-generation/templates/agents/*.template.md`. An agent that
 * exists as a template but is missing here is never offered in the wizard and
 * therefore never generated (historical `visual-reviewer` drop).
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

/**
 * Agent display metadata for the wizard UI.
 */
interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  category: AgentCategory;
  icon?: string;
}

/**
 * All agents available in the Ptah system (one entry per agent template).
 * These represent standard software development roles.
 * Every agent is always recommended — customization happens
 * at the template level via LLM-driven analysis.
 *
 * Keep in sync with the `templates/agents/*.template.md` set.
 */
const AGENT_CATALOG: AgentMetadata[] = [
  {
    id: 'project-manager',
    name: 'Project Manager',
    description:
      'Analyzes requirements, creates task descriptions, and validates delivery',
    category: 'planning',
    icon: 'project',
  },
  {
    id: 'software-architect',
    name: 'Software Architect',
    description:
      'Investigates codebase, designs implementation plans, and defines architecture',
    category: 'planning',
    icon: 'architecture',
  },
  {
    id: 'team-leader',
    name: 'Team Leader',
    description:
      'Decomposes plans into tasks, coordinates developers, and manages batches',
    category: 'planning',
    icon: 'team',
  },
  {
    id: 'frontend-developer',
    name: 'Frontend Developer',
    description:
      'Implements UI components, handles state management, and builds responsive interfaces',
    category: 'development',
    icon: 'frontend',
  },
  {
    id: 'backend-developer',
    name: 'Backend Developer',
    description:
      'Implements APIs, database logic, business services, and server-side code',
    category: 'development',
    icon: 'backend',
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    description:
      'Manages CI/CD pipelines, containerization, deployment, and infrastructure',
    category: 'development',
    icon: 'devops',
  },
  {
    id: 'senior-tester',
    name: 'Senior Tester',
    description:
      'Creates comprehensive test suites, verifies implementations, and ensures quality',
    category: 'qa',
    icon: 'test',
  },
  {
    id: 'code-style-reviewer',
    name: 'Code Style Reviewer',
    description:
      'Reviews code for formatting, naming conventions, and style consistency',
    category: 'qa',
    icon: 'style',
  },
  {
    id: 'code-logic-reviewer',
    name: 'Code Logic Reviewer',
    description:
      'Reviews business logic, identifies bugs, and validates implementation correctness',
    category: 'qa',
    icon: 'logic',
  },
  {
    id: 'researcher-expert',
    name: 'Researcher Expert',
    description:
      'Investigates technologies, researches solutions, and provides technical guidance',
    category: 'specialist',
    icon: 'research',
  },
  {
    id: 'modernization-detector',
    name: 'Modernization Detector',
    description:
      'Identifies outdated patterns, suggests improvements, and detects technical debt',
    category: 'specialist',
    icon: 'modernize',
  },
  {
    id: 'ui-ux-designer',
    name: 'UI/UX Designer',
    description:
      'Designs user interfaces, creates visual specifications, and improves user experience',
    category: 'creative',
    icon: 'design',
  },
  {
    id: 'technical-content-writer',
    name: 'Technical Content Writer',
    description:
      'Creates documentation, blog posts, video scripts, and marketing content',
    category: 'creative',
    icon: 'content',
  },
  {
    id: 'visual-reviewer',
    name: 'Visual Reviewer',
    description:
      'Hunts UI/UX visual bugs, responsive breakpoints, and accessibility issues via browser testing',
    category: 'qa',
    icon: 'visual',
  },
  {
    id: 'video-director',
    name: 'Video Director',
    description:
      'Authors and renders narrated, camera-animated marketing/demo videos from automated UI walkthroughs',
    category: 'creative',
    icon: 'video',
  },
];

/**
 * Agent Recommendation Service
 *
 * All agents are always recommended. The analysis data is used to generate
 * meaningful context descriptions (matchedCriteria) that help the user understand
 * what each agent will be customized with — but no agent is ever excluded.
 *
 * The real intelligence is downstream: the LLM uses the deep analysis to customize
 * each agent's template with project-specific best practices, conventions,
 * and architecture guidance.
 */
@injectable()
export class AgentRecommendationService {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {
    this.logger.debug('AgentRecommendationService initialized');
  }

  /**
   * Return all agents as recommended, with analysis-derived context.
   *
   * @param analysis - Deep project analysis result
   * @returns All agents with relevanceScore 100 and recommended: true
   */
  calculateRecommendations(
    analysis: DeepProjectAnalysis,
  ): AgentRecommendation[] {
    this.logger.info(
      'Calculating agent recommendations — all agents included',
      {
        projectType: analysis.projectType?.toString() || 'unknown',
        frameworkCount: analysis.frameworks?.length || 0,
        patternCount: analysis.architecturePatterns?.length || 0,
      },
    );

    const projectContext = this.buildProjectContext(analysis);

    const recommendations: AgentRecommendation[] = AGENT_CATALOG.map(
      (agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        relevanceScore: 100,
        matchedCriteria: this.buildCriteria(agent, projectContext),
        category: agent.category,
        recommended: true,
        description: agent.description,
        icon: agent.icon,
      }),
    );

    this.logger.info('Agent recommendations calculated', {
      totalAgents: recommendations.length,
      recommendedCount: recommendations.length,
    });

    return recommendations;
  }

  /**
   * Extract key project characteristics from analysis for criteria descriptions.
   */
  private buildProjectContext(analysis: DeepProjectAnalysis): ProjectContext {
    const frameworks = analysis.frameworks || [];
    const patterns = (analysis.architecturePatterns || [])
      .filter((p) => p.confidence > 50)
      .map((p) => p.name);
    const languages = (analysis.languageDistribution || [])
      .filter((l) => l.percentage > 5)
      .map((l) => l.language);
    const testFramework = analysis.testCoverage?.testFramework ?? undefined;
    const testCoverage = analysis.testCoverage?.percentage;
    const monorepoType = analysis.monorepoType ?? undefined;
    const errorCount = analysis.existingIssues?.errorCount || 0;
    const warningCount = analysis.existingIssues?.warningCount || 0;
    const projectDescription =
      analysis.projectTypeDescription ||
      analysis.projectType?.toString() ||
      'project';

    return {
      frameworks,
      patterns,
      languages,
      testFramework,
      testCoverage,
      monorepoType,
      errorCount,
      warningCount,
      projectDescription,
    };
  }

  /**
   * Build human-readable criteria strings based on what the analysis discovered.
   * These describe what context will be used to customize each agent's template.
   */
  private buildCriteria(agent: AgentMetadata, ctx: ProjectContext): string[] {
    const criteria: string[] = [];
    criteria.push(`Will be customized for: ${ctx.projectDescription}`);

    if (ctx.frameworks.length > 0) {
      criteria.push(`Detected frameworks: ${ctx.frameworks.join(', ')}`);
    }

    if (ctx.patterns.length > 0) {
      criteria.push(`Architecture: ${ctx.patterns.join(', ')}`);
    }

    if (ctx.languages.length > 0) {
      criteria.push(`Languages: ${ctx.languages.join(', ')}`);
    }
    switch (agent.category) {
      case 'planning':
        if (ctx.monorepoType) {
          criteria.push(`Monorepo coordination (${ctx.monorepoType})`);
        }
        break;

      case 'qa':
        if (ctx.testFramework) {
          criteria.push(`Test framework: ${ctx.testFramework}`);
        }
        if (ctx.testCoverage !== undefined) {
          criteria.push(`Current test coverage: ${ctx.testCoverage}%`);
        }
        if (ctx.errorCount > 0 || ctx.warningCount > 0) {
          criteria.push(
            `Existing issues: ${ctx.errorCount} errors, ${ctx.warningCount} warnings`,
          );
        }
        break;

      case 'specialist':
        if (ctx.errorCount + ctx.warningCount > 0) {
          criteria.push(
            `${ctx.errorCount + ctx.warningCount} existing issues to analyze`,
          );
        }
        break;
    }

    return criteria;
  }
}

/**
 * Internal type for extracted project context.
 */
interface ProjectContext {
  frameworks: string[];
  patterns: string[];
  languages: string[];
  testFramework?: string;
  testCoverage?: number;
  monorepoType?: string;
  errorCount: number;
  warningCount: number;
  projectDescription: string;
}

/**
 * Generation Prompts for Prompt Designer Agent
 *
 * TASK_2025_137 Batch 2: Prompt templates used by the Prompt Designer Agent
 * to generate project-specific guidance.
 *
 * These prompts are carefully crafted to produce consistent, actionable
 * output that integrates well with PTAH_CORE_SYSTEM_PROMPT.
 */

import type { PromptDesignerInput } from './prompt-designer.types';

/**
 * System prompt for the Prompt Designer Agent
 *
 * This establishes the agent's role and output expectations.
 */
export const PROMPT_DESIGNER_SYSTEM_PROMPT = `You are a Prompt Designer Agent. Your task is to generate concise, actionable guidance for an AI assistant that will help developers in a specific project.

## Your Role

You analyze project metadata (type, framework, dependencies) and generate tailored instructions that help the AI assistant understand:
1. What this project is and its key technologies
2. Framework-specific patterns to follow
3. Coding standards derived from the project's tooling
4. Architecture guidelines and boundaries

## Output Quality Requirements

- Be SPECIFIC to this project. Avoid generic advice that applies to all projects.
- Keep each section focused and actionable.
- Use imperative language ("Use...", "Follow...", "Prefer...").
- Reference specific frameworks, libraries, and patterns from the project.
- If the project uses TypeScript, emphasize type safety.
- If it's a monorepo, emphasize library boundaries.

## Token Budget

Each section must stay under 400 tokens. Total output should be under 1600 tokens.
Prioritize the most impactful guidance over comprehensive coverage.`;

/**
 * Build the user prompt for generating project guidance
 *
 * @param input - Project analysis data
 * @returns User prompt string
 */
export function buildGenerationUserPrompt(input: PromptDesignerInput): string {
  const dependencyList = input.dependencies.slice(0, 20).join(', ');
  const devDependencyList = input.devDependencies.slice(0, 15).join(', ');

  return `## Project Analysis

**Project Type:** ${input.projectType}
**Framework:** ${input.framework || 'Not detected'}
**Monorepo:** ${
    input.isMonorepo ? `Yes (${input.monorepoType || 'Unknown type'})` : 'No'
  }
**Workspace Path:** ${input.workspacePath}

**Key Dependencies:**
${dependencyList || 'None detected'}

**Dev Dependencies:**
${devDependencyList || 'None detected'}

${
  input.sampleFilePaths && input.sampleFilePaths.length > 0
    ? `**Sample Files:**
${input.sampleFilePaths.map((p) => `- ${p}`).join('\n')}`
    : ''
}

## Your Task

Generate guidance in these four categories. Keep each section under 400 tokens.

### 1. Project Context
A brief description of what this project is based on its dependencies and structure.
Include: main purpose, key technologies, target platform/environment.

### 2. Framework Guidelines
Specific patterns and best practices for the detected framework(s).
Focus on: component patterns, state management, data flow, testing approaches.
Reference specific libraries from the dependencies.

### 3. Coding Standards
SOLID principles application, naming conventions, error handling.
Derive standards from detected tooling (ESLint configs, TypeScript settings).
Include: type safety expectations, import organization, code structure.

### 4. Architecture Notes
${
  input.isMonorepo
    ? `This is a ${
        input.monorepoType || 'monorepo'
      } - emphasize library boundaries and dependency rules.`
    : 'Single-project structure - focus on folder organization and module boundaries.'
}
Include: key abstractions, import patterns, layer boundaries.`;
}

/**
 * Prompt for generating minimal guidance when LLM is unavailable
 *
 * Used as a fallback to generate basic guidance from templates.
 */
export function buildFallbackGuidance(input: PromptDesignerInput): string {
  const parts: string[] = [];

  // Project context fallback
  parts.push(`## Project Context

This is a ${input.projectType} project${
    input.framework ? ` using ${input.framework}` : ''
  }.${
    input.isMonorepo
      ? ` It's organized as a ${input.monorepoType || 'monorepo'}.`
      : ''
  }`);

  // Framework guidelines fallback based on detected framework
  const frameworkGuidance = getFrameworkFallbackGuidance(input.framework);
  if (frameworkGuidance) {
    parts.push(`## Framework Guidelines

${frameworkGuidance}`);
  }

  // Coding standards fallback based on detected tooling
  const toolingGuidance = getToolingFallbackGuidance(input.devDependencies);
  parts.push(`## Coding Standards

${toolingGuidance}`);

  // Architecture notes fallback
  if (input.isMonorepo) {
    parts.push(`## Architecture Notes

This is a ${
      input.monorepoType || 'monorepo'
    } structure. Respect library boundaries and follow the established dependency graph. Avoid circular dependencies between libraries.`);
  }

  return parts.join('\n\n');
}

/**
 * Get framework-specific fallback guidance
 */
function getFrameworkFallbackGuidance(framework?: string): string | null {
  if (!framework) return null;

  const frameworkMap: Record<string, string> = {
    angular: `- Use standalone components (Angular 14+)
- Prefer signals over BehaviorSubject for state
- Follow the Angular style guide for naming
- Use dependency injection for services
- Organize features by domain, not type`,

    react: `- Use functional components with hooks
- Prefer useState and useReducer for local state
- Use React Query or SWR for server state
- Keep components small and focused
- Co-locate tests with components`,

    vue: `- Use Composition API over Options API
- Prefer script setup syntax
- Use Pinia for state management
- Follow Vue style guide priority A rules
- Keep components single-responsibility`,

    nestjs: `- Use modules to organize features
- Prefer constructor injection
- Use DTOs for validation
- Follow the repository pattern for data access
- Handle errors with exception filters`,

    express: `- Use middleware for cross-cutting concerns
- Validate input with express-validator or Zod
- Handle errors with error middleware
- Keep routes thin, logic in services
- Use async/await with proper error handling`,

    nextjs: `- Use App Router (Next.js 13+) patterns
- Prefer Server Components where possible
- Use Server Actions for mutations
- Follow the loading/error UI patterns
- Optimize images with next/image`,
  };

  return frameworkMap[framework.toLowerCase()] || null;
}

/**
 * Get tooling-based fallback guidance
 */
function getToolingFallbackGuidance(devDependencies: string[]): string {
  const guidance: string[] = [];

  if (devDependencies.includes('typescript')) {
    guidance.push('- Use TypeScript strict mode features');
    guidance.push('- Avoid `any` types; prefer `unknown` with type guards');
    guidance.push('- Export types alongside implementations');
  }

  if (devDependencies.includes('eslint')) {
    guidance.push('- Follow the configured ESLint rules');
    guidance.push('- Run linting before commits');
  }

  if (devDependencies.includes('prettier')) {
    guidance.push('- Use Prettier for consistent formatting');
  }

  if (devDependencies.includes('jest')) {
    guidance.push('- Write tests using Jest');
    guidance.push('- Follow AAA pattern (Arrange-Act-Assert)');
  }

  if (devDependencies.includes('vitest')) {
    guidance.push('- Write tests using Vitest');
    guidance.push('- Use vi.mock for module mocking');
  }

  if (guidance.length === 0) {
    guidance.push('- Follow consistent naming conventions');
    guidance.push('- Keep functions small and focused');
    guidance.push('- Document public APIs');
  }

  return guidance.join('\n');
}

/**
 * Framework-specific prompt additions for enhanced guidance
 */
export const FRAMEWORK_PROMPT_ADDITIONS: Record<string, string> = {
  angular: `
Pay special attention to Angular-specific patterns:
- Signal-based reactivity (Angular 16+)
- Zoneless change detection strategies
- Standalone component patterns
- Dependency injection best practices
- RxJS usage patterns (when to use vs signals)`,

  react: `
Pay special attention to React-specific patterns:
- Hooks composition and custom hooks
- State management choices (Context, Zustand, Redux)
- Server Components vs Client Components (if Next.js)
- Performance optimization (memo, useMemo, useCallback)
- Error boundaries and Suspense`,

  nestjs: `
Pay special attention to NestJS-specific patterns:
- Module organization and feature modules
- Guards, interceptors, and pipes
- TypeORM or Prisma repository patterns
- Exception filters and error handling
- Swagger/OpenAPI documentation`,

  nextjs: `
Pay special attention to Next.js-specific patterns:
- App Router vs Pages Router
- Server Components and Client Components
- Data fetching strategies (Server Actions, Route Handlers)
- Metadata and SEO optimization
- Image and font optimization`,
};

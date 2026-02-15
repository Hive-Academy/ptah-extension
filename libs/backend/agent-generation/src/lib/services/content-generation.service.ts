/**
 * Content Generation Service
 *
 * LLM-driven agent template processing via Agent SDK (InternalQueryService).
 * Templates serve as blueprints:
 * - STATIC sections are preserved verbatim (hardcoded sections)
 * - LLM sections are filled intelligently by the LLM using analysis data
 * - VAR sections are filled by the LLM with project-specific values
 * - Remaining {{VARS}} outside sections are substituted from analysis context
 *
 * LLM Pipeline Migration:
 * Previously: VsCodeLmService → VsCodeLmProvider (required Copilot)
 * Now: InternalQueryService → Agent SDK (uses API key directly)
 *
 * Makes ONE SDK call per template with structured output to fill ALL dynamic
 * sections at once, instead of N separate calls per section.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import type { GenerationStreamPayload } from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type ConfigManager,
} from '@ptah-extension/vscode-core';
import * as path from 'path';
import { readFileSync } from 'fs';
import {
  IContentGenerationService,
  type ContentGenerationSdkConfig,
} from '../interfaces/content-generation.interface';
import {
  AgentTemplate,
  AgentProjectContext,
  LlmCustomization,
} from '../types/core.types';
import { ContentGenerationError } from '../errors/generation.error';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
import type {
  SDKMessage,
  StreamEventEmitter,
  StreamEvent,
} from '@ptah-extension/agent-sdk';

/**
 * Represents a dynamic section extracted from a template.
 */
interface DynamicSection {
  /** Section type: 'llm' for LLM-generated, 'var' for variable data */
  type: 'llm' | 'var';
  /** Section identifier (e.g., 'FRAMEWORK_SPECIFICS', 'PROJECT_CONTEXT') */
  id: string;
  /** Template content inside the section markers (used as guidance for LLM) */
  content: string;
  /** Full regex match including markers (for replacement) */
  fullMatch: string;
}

/**
 * LLM-driven content generation service.
 *
 * Philosophy: Templates are blueprints, not mechanical templates.
 * The LLM reads the blueprint structure, understands the intent of each section,
 * and generates intelligent, project-specific content based on analysis data.
 *
 * Processing flow:
 * 1. Extract dynamic sections (LLM + VAR markers) from template content
 * 2. Make ONE SDK call with structured output to fill ALL sections at once
 * 3. Replace section markers with LLM-generated content
 * 4. Substitute remaining {{VARS}} outside sections with analysis values
 * 5. STATIC sections are never touched — they stay exactly as authored
 */
@injectable()
export class ContentGenerationService implements IContentGenerationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly config: ConfigManager
  ) {}

  /**
   * Generate content for an agent template using LLM-driven intelligence.
   *
   * STATIC sections stay verbatim. LLM and VAR sections are filled by the LLM
   * using the analysis data. Remaining {{VARS}} are substituted from context.
   *
   * @param template - Agent template blueprint
   * @param context - Project context from wizard analysis
   * @param sdkConfig - Optional SDK configuration for InternalQueryService
   * @returns Result containing final generated content, or Error
   */
  async generateContent(
    template: AgentTemplate,
    context: AgentProjectContext,
    sdkConfig?: ContentGenerationSdkConfig
  ): Promise<Result<string, Error>> {
    try {
      this.logger.info('Starting LLM-driven content generation', {
        templateId: template.id,
        templateVersion: template.version,
      });

      let content = template.content;

      // 1. Extract dynamic sections (LLM and VAR markers)
      const dynamicSections = this.extractDynamicSections(content);

      this.logger.debug('Dynamic sections identified', {
        templateId: template.id,
        sectionCount: dynamicSections.length,
        sections: dynamicSections.map((s) => `${s.type}:${s.id}`),
      });

      // 2. Generate content for dynamic sections via SDK
      if (dynamicSections.length > 0) {
        content = await this.fillDynamicSections(
          content,
          dynamicSections,
          context,
          template.name,
          sdkConfig
        );
      }

      // 3. Final pass: substitute remaining {{VARS}} outside section markers
      // Values come from analysis context, not hardcoded defaults.
      content = this.substituteRemainingVars(content, context);

      this.logger.info('Content generation complete', {
        templateId: template.id,
        contentLength: content.length,
        dynamicSectionsProcessed: dynamicSections.length,
      });

      return Result.ok(content);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Content generation failed', {
        templateId: template.id,
        error: errorMessage,
      });
      return Result.err(
        new ContentGenerationError(
          `Failed to generate content: ${errorMessage}`,
          'content',
          template.name,
          {
            templateId: template.id,
            context: { projectType: context.projectType },
          }
        )
      );
    }
  }

  /**
   * Generate LLM customizations for template sections.
   *
   * LLM sections are now generated inline within generateContent().
   * This method exists for interface compatibility and returns empty.
   */
  async generateLlmSections(
    template: AgentTemplate,
    context: AgentProjectContext
  ): Promise<Result<LlmCustomization[], Error>> {
    // LLM sections are handled directly in generateContent() via fillDynamicSections().
    // This method is retained for interface compatibility.
    this.logger.debug(
      'generateLlmSections called — sections are handled inline in generateContent()',
      { templateId: template.id }
    );
    return Result.ok([]);
  }

  /**
   * Fill all dynamic sections via a single SDK call with structured output.
   *
   * Makes ONE InternalQueryService call per template that fills ALL dynamic
   * sections at once. The SDK's structured output constrains the response
   * to a JSON object with one key per section ID.
   *
   * Falls back to original template content on failure.
   */
  private async fillDynamicSections(
    content: string,
    sections: DynamicSection[],
    context: AgentProjectContext,
    templateName: string,
    sdkConfig?: ContentGenerationSdkConfig
  ): Promise<string> {
    try {
      // Build the prompt describing all sections to fill
      const prompt = this.buildAllSectionsPrompt(
        sections,
        context,
        templateName
      );

      // Build JSON Schema for structured output: { sections: { [sectionId]: string } }
      const sectionIds = sections.map((s) => s.id);
      const sectionProperties: Record<string, unknown> = {};
      for (const section of sections) {
        sectionProperties[section.id] = {
          type: 'string',
          description: `Content for ${this.sectionIdToTopic(
            section.id,
            section.type
          )} section`,
        };
      }

      const outputSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
          sections: {
            type: 'object',
            properties: sectionProperties,
            required: sectionIds,
          },
        },
        required: ['sections'],
      };

      // Resolve model from config
      const model =
        sdkConfig?.model ??
        this.config.getWithDefault<string>(
          'model.selected',
          'claude-sonnet-4-5-20250929'
        );

      // Build system prompt with optional enhanced prompt content
      let systemPrompt = `You are a content generation specialist for developer tooling configuration files.

CRITICAL CONSTRAINTS:
- You have NO tools available. Do NOT attempt to call any tools or explore the filesystem.
- ALL project information you need is provided in the PROJECT ANALYSIS DATA below.
- Base every piece of generated content EXCLUSIVELY on the provided analysis data.
- Do NOT fabricate, guess, or assume any project details not present in the analysis data.
- If the analysis data lacks information for a section, generate sensible defaults based on the project type and frameworks listed.

OUTPUT FORMAT:
- Return a JSON object with a "sections" property containing each section ID mapped to its content.
- Each section value must be pure markdown (no wrapping markers, code fences, or section headers).
- Do NOT include any {{VARIABLE}}, {{GENERATED_*}}, or template markers in your output.`;

      if (sdkConfig?.enhancedPromptContent) {
        systemPrompt += `\n\n--- Enhanced Project Guidance ---\n${sdkConfig.enhancedPromptContent}`;
      }

      // Execute SDK call with structured output.
      // MCP is explicitly DISABLED here — the analysis data is already embedded
      // in the prompt, so the LLM should NOT re-explore the workspace via MCP tools.
      // Allowing MCP access wastes tokens/time and can produce inconsistent results.
      const handle = await this.internalQueryService.execute({
        cwd: context.rootPath,
        model,
        prompt,
        systemPromptAppend: systemPrompt,
        isPremium: sdkConfig?.isPremium ?? false,
        mcpServerRunning: false,
        maxTurns: 25,
        outputFormat: { type: 'json_schema', schema: outputSchema },
      });

      let structuredOutput: unknown | null;
      try {
        // Process stream to extract structured output
        structuredOutput = await this.processGenerationStream(
          handle.stream,
          sdkConfig?.onStreamEvent,
          templateName
        );
      } finally {
        handle.close();
      }

      if (
        structuredOutput &&
        typeof structuredOutput === 'object' &&
        'sections' in structuredOutput
      ) {
        const generatedSections = (
          structuredOutput as { sections: Record<string, string> }
        ).sections;

        // Inject results into template content
        let processed = content;
        for (const section of sections) {
          const generated = generatedSections[section.id];
          let replacement: string;

          if (generated && typeof generated === 'string' && generated.trim()) {
            replacement = generated;
            this.logger.debug(`Section ${section.id}: SDK content generated`, {
              contentLength: replacement.length,
            });
          } else {
            // Fallback: use original template content (without markers)
            replacement = section.content;
            this.logger.warn(
              `Section ${section.id}: SDK returned empty, using template fallback`
            );
          }

          processed = processed.replace(section.fullMatch, replacement);
        }

        return processed;
      }

      // Structured output not available — fall through to fallback
      this.logger.warn(
        'SDK did not return structured output, using template fallback for all sections'
      );
    } catch (error) {
      this.logger.warn(
        'SDK content generation failed, using template fallback for all sections',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Fallback: strip section markers but keep original template content
    let processed = content;
    for (const section of sections) {
      processed = processed.replace(section.fullMatch, section.content);
    }
    return processed;
  }

  /**
   * Build a single prompt that describes ALL dynamic sections to fill at once.
   */
  private buildAllSectionsPrompt(
    sections: DynamicSection[],
    context: AgentProjectContext,
    templateName: string
  ): string {
    // Use multi-phase analysis if available, otherwise fall back to formatAnalysisData
    let analysisData: string;
    if (context.analysisDir) {
      const roleSpecificContext = this.readRoleSpecificContext(
        context.analysisDir,
        templateName
      );
      analysisData = roleSpecificContext || this.formatAnalysisData(context);
    } else {
      analysisData = this.formatAnalysisData(context);
    }

    const sectionDescriptions = sections
      .map((section) => {
        const topic = this.sectionIdToTopic(section.id, section.type);
        const typeLabel = section.type === 'var' ? 'DATA' : 'GUIDANCE';

        return `### Section "${section.id}" (${typeLabel}: ${topic})
TEMPLATE BLUEPRINT:
${section.content}`;
      })
      .join('\n\n');

    return `Generate project-specific content for the "${templateName}" agent configuration file.

ALL project information is provided below. Use ONLY this data — do not attempt to explore, search, or analyze the project yourself.

## PROJECT ANALYSIS DATA (source of truth)
${analysisData}

## SECTIONS TO FILL
${sectionDescriptions}

## INSTRUCTIONS
1. For each section, generate content that is specific to THIS project based on the analysis data above.
2. DATA sections: replace all {{VARIABLE}} placeholders with actual values extracted from the analysis data.
3. GUIDANCE sections: generate actionable, project-specific guidance referencing the exact frameworks, languages, and patterns from the analysis data — no generic advice.
4. Use the template blueprint as guidance for the KIND and STRUCTURE of content expected, but tailor all details to the analysis data.
5. Reference concrete details from the analysis: specific framework names, file paths, architecture patterns, testing frameworks, and conventions.
6. Keep each section under 500 words.

Return a JSON object: { "sections": { "<sectionId>": "<markdown content>", ... } }`;
  }

  /**
   * Process SDK message stream to extract structured output.
   *
   * Delegates to SdkStreamProcessor for stream iteration, throttling,
   * and event emission. Optionally broadcasts stream events for live
   * UI updates when an onStreamEvent callback is provided.
   *
   * @param stream - SDK message async iterable
   * @param onStreamEvent - Optional callback for real-time stream events
   * @param agentId - Optional agent template name for event attribution
   */
  private async processGenerationStream(
    stream: AsyncIterable<SDKMessage>,
    onStreamEvent?: (event: GenerationStreamPayload) => void,
    agentId?: string
  ): Promise<unknown | null> {
    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        if (onStreamEvent) {
          onStreamEvent({ ...event, agentId });
        }
      },
    };

    const processor = new SdkStreamProcessor({
      emitter,
      toolCallIdFactory: (_name, index) =>
        `gen-${agentId || 'unknown'}-${index}-${Date.now()}`,
      logger: this.logger,
      serviceTag: 'ContentGenerationService',
    });

    try {
      const result = await processor.process(stream);
      return result.structuredOutput;
    } catch (error) {
      this.logger.warn('ContentGenerationService: Stream processing error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Extract dynamic sections (LLM and VAR) from template content.
   *
   * Matches the actual template format:
   * - LLM sections: <!-- LLM:ID -->...<!-- /LLM:ID -->
   * - VAR sections: <!-- VAR:ID -->...<!-- /VAR:ID -->
   *
   * STATIC sections are NOT extracted — they are left untouched.
   */
  private extractDynamicSections(content: string): DynamicSection[] {
    const sections: DynamicSection[] = [];

    // LLM sections: <!-- LLM:ID -->...<!-- /LLM:ID -->
    const llmRegex = /<!-- LLM:(\w+) -->([\s\S]*?)<!-- \/LLM:\1 -->/g;
    for (const match of content.matchAll(llmRegex)) {
      sections.push({
        type: 'llm',
        id: match[1],
        content: match[2].trim(),
        fullMatch: match[0],
      });
    }

    // VAR sections: <!-- VAR:ID -->...<!-- /VAR:ID -->
    const varRegex = /<!-- VAR:(\w+) -->([\s\S]*?)<!-- \/VAR:\1 -->/g;
    for (const match of content.matchAll(varRegex)) {
      sections.push({
        type: 'var',
        id: match[1],
        content: match[2].trim(),
        fullMatch: match[0],
      });
    }

    return sections;
  }

  /**
   * Convert section ID to human-readable topic for the LLM prompt.
   */
  private sectionIdToTopic(id: string, type: string): string {
    const humanName = id
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ');
    return type === 'var' ? `Project ${humanName}` : humanName;
  }

  /**
   * Format the project context as a readable analysis summary for the LLM.
   */
  private formatAnalysisData(context: AgentProjectContext): string {
    const parts = [
      `Project Type: ${context.projectType}`,
      `Frameworks: ${context.frameworks.join(', ') || 'None detected'}`,
      `Languages: ${context.techStack.languages.join(', ')}`,
      `Build Tools: ${
        context.techStack.buildTools.join(', ') || 'None detected'
      }`,
      `Testing: ${
        context.techStack.testingFrameworks.join(', ') || 'None detected'
      }`,
      `Package Manager: ${context.techStack.packageManager}`,
    ];

    if (context.monorepoType) {
      parts.push(`Monorepo Type: ${context.monorepoType}`);
    }

    parts.push(
      `Code Conventions:`,
      `  Indentation: ${context.codeConventions.indentation} (size: ${context.codeConventions.indentSize})`,
      `  Quotes: ${context.codeConventions.quoteStyle}`,
      `  Semicolons: ${context.codeConventions.semicolons}`,
      `  Trailing Comma: ${context.codeConventions.trailingComma}`
    );

    if (context.relevantFiles.length > 0) {
      parts.push(
        `Key Files: ${context.relevantFiles
          .slice(0, 10)
          .map((f) => f.relativePath)
          .join(', ')}`
      );
    }

    // Include full analysis data when available (from wizard deep analysis)
    const analysis = context.fullAnalysis;
    if (analysis) {
      if (analysis.projectTypeDescription) {
        parts.push(`Project Description: ${analysis.projectTypeDescription}`);
      }

      if (analysis.architecturePatterns?.length > 0) {
        parts.push(
          `Architecture Patterns: ${analysis.architecturePatterns
            .map((p) => `${p.name} (${p.confidence}% confidence)`)
            .join(', ')}`
        );
      }

      if (analysis.languageDistribution?.length) {
        parts.push(
          `Language Distribution: ${analysis.languageDistribution
            .map((l) => `${l.language} ${l.percentage}%`)
            .join(', ')}`
        );
      }

      if (analysis.testCoverage) {
        parts.push(
          `Test Coverage: ${
            analysis.testCoverage.percentage
          }% estimated (framework: ${
            analysis.testCoverage.testFramework || 'unknown'
          }, unit: ${analysis.testCoverage.hasUnitTests}, integration: ${
            analysis.testCoverage.hasIntegrationTests
          })`
        );
      }

      if (analysis.existingIssues) {
        parts.push(
          `Code Issues: ${analysis.existingIssues.errorCount} errors, ${analysis.existingIssues.warningCount} warnings`
        );
      }

      if (analysis.keyFileLocations) {
        const locations = analysis.keyFileLocations;
        const keyFiles = [
          ...locations.entryPoints.slice(0, 3),
          ...locations.configs.slice(0, 3),
          ...locations.apiRoutes.slice(0, 2),
          ...locations.components.slice(0, 2),
          ...locations.services.slice(0, 2),
        ].slice(0, 10);
        if (keyFiles.length > 0) {
          parts.push(`Key File Locations: ${keyFiles.join(', ')}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Final pass: substitute remaining {{VARIABLE}} placeholders outside section markers.
   *
   * These appear in the template title, description frontmatter, and intro text.
   * Values are derived from the analysis context — not hardcoded defaults.
   */
  private substituteRemainingVars(
    content: string,
    context: AgentProjectContext
  ): string {
    // Build variable values from analysis context
    const varMap: Record<string, string> = {
      PROJECT_TYPE: context.projectType.toString(),
      PROJECT_NAME: path.basename(context.rootPath),
      FRAMEWORK_NAME:
        context.frameworks[0]?.toString() || context.projectType.toString(),
      FRAMEWORK_VERSION: '',
      PRIMARY_LANGUAGE: context.techStack.languages[0] || 'Unknown',
      TECH_STACK:
        context.techStack.frameworks.join(', ') ||
        context.projectType.toString(),
      TIMESTAMP: new Date().toISOString(),
      IS_MONOREPO: context.monorepoType ? 'true' : 'false',
      MONOREPO_TYPE: context.monorepoType?.toString() || '',
      PACKAGE_MANAGER: context.techStack.packageManager,
      ARCHITECTURE_PATTERN:
        context.frameworks.length > 0
          ? context.frameworks.join(' + ')
          : context.projectType.toString(),
    };

    let result = content;
    for (const [key, value] of Object.entries(varMap)) {
      // Match {{KEY}} with optional whitespace: {{ KEY }}
      result = result.replace(
        new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'),
        value
      );
    }

    // Process simple conditionals that may remain outside sections
    result = this.processSimpleConditionals(result, varMap);

    // Log any remaining unsubstituted variables (debug, not error)
    const remaining = result.match(/\{\{\s*[A-Z_]+\s*\}\}/g);
    if (remaining && remaining.length > 0) {
      this.logger.debug('Remaining unsubstituted variables (non-critical)', {
        variables: [...new Set(remaining)],
      });
    }

    return result;
  }

  /**
   * Process simple {{#if VAR}}...{{/if}} conditionals outside section markers.
   */
  private processSimpleConditionals(
    content: string,
    vars: Record<string, string>
  ): string {
    const conditionalRegex = /\{\{#if\s+(!?)(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    return content.replace(
      conditionalRegex,
      (_fullMatch, negation, varName, conditionalContent) => {
        const value = vars[varName];
        const isTruthy =
          !!value && value !== 'false' && value !== '0' && value !== '';
        const condition = negation === '!' ? !isTruthy : isTruthy;
        return condition ? conditionalContent : '';
      }
    );
  }

  // ==========================================================================
  // Multi-Phase Analysis Integration (TASK_2025_154)
  // ==========================================================================

  /**
   * Read role-specific context from 05-agent-context.md.
   *
   * Extracts the "For All Agents" section (always included) and the role-specific
   * section based on the template name. Falls back to empty string if the file
   * is missing or unreadable, allowing the caller to use formatAnalysisData().
   *
   * Caches the file content per analysisDir so it's only read once even when
   * called 13 times for 13 agent templates.
   *
   * @param analysisDir - Path to the multi-phase analysis slug directory
   * @param templateName - Template name used to determine role-specific section
   * @returns Combined analysis context, or empty string if unavailable
   */
  private analysisContextCache: { dir: string; content: string } | null = null;

  private readRoleSpecificContext(
    analysisDir: string,
    templateName: string
  ): string {
    try {
      let content: string;
      if (this.analysisContextCache?.dir === analysisDir) {
        content = this.analysisContextCache.content;
      } else {
        const contextFile = path.join(analysisDir, '05-agent-context.md');
        content = readFileSync(contextFile, 'utf-8');
        this.analysisContextCache = { dir: analysisDir, content };
      }

      const allAgentsContent = this.extractAnalysisSection(
        content,
        'For All Agents'
      );
      const roleSection = this.getRoleSectionForTemplate(templateName);
      const roleContent = roleSection
        ? this.extractAnalysisSection(content, roleSection)
        : '';

      const combined = [allAgentsContent, roleContent]
        .filter(Boolean)
        .join('\n\n');

      // Token budget: if too large, truncate "For All Agents" content first
      if (combined.length > 50_000) {
        return this.truncateForTokenBudget(allAgentsContent, roleContent);
      }

      return combined;
    } catch {
      // File not available - caller falls back to formatAnalysisData()
      return '';
    }
  }

  /**
   * Map template name to the corresponding role section in 05-agent-context.md.
   *
   * @param templateName - Agent template name (e.g., 'backend-developer', 'frontend-architect')
   * @returns Section heading name, or null for "For All Agents" only
   */
  private getRoleSectionForTemplate(templateName: string): string | null {
    const name = templateName.toLowerCase();
    if (name.includes('backend')) return 'For Backend Agents';
    if (name.includes('frontend')) return 'For Frontend Agents';
    if (name.includes('tester') || name.includes('qa')) return 'For QA Agents';
    if (name.includes('architect')) return 'For Architecture Agents';
    return null;
  }

  /**
   * Extract a named section from the agent context markdown.
   *
   * Matches `## Section Name` headers and extracts content until the next
   * `## ` header or end of file.
   *
   * @param content - Full markdown content
   * @param sectionName - Section heading to extract (without ## prefix)
   * @returns Extracted section content trimmed, or empty string
   */
  private extractAnalysisSection(content: string, sectionName: string): string {
    const regex = new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Truncate content to fit within a ~50,000 character token budget.
   *
   * Prioritizes role-specific content over "For All Agents" content.
   * Role-specific content is preserved in full; "For All Agents" is truncated
   * to fill the remaining budget.
   *
   * @param allAgentsContent - "For All Agents" section content
   * @param roleContent - Role-specific section content
   * @returns Combined content within token budget
   */
  private truncateForTokenBudget(
    allAgentsContent: string,
    roleContent: string
  ): string {
    // Prioritize role-specific content, truncate "For All Agents"
    const maxAllAgents = Math.max(10_000, 50_000 - roleContent.length);
    const truncatedAll =
      allAgentsContent.length > maxAllAgents
        ? allAgentsContent.substring(0, maxAllAgents) +
          '\n\n...(truncated for token budget)'
        : allAgentsContent;
    return [truncatedAll, roleContent].filter(Boolean).join('\n\n');
  }
}

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
import type {
  GenerationStreamPayload,
  FlatStreamEventUnion,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  MessageStartEvent,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
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
import {
  SDK_TOKENS,
  SdkStreamProcessor,
  discoverPluginSkills,
  formatSkillsForPrompt,
} from '@ptah-extension/agent-sdk';
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
    private readonly config: ConfigManager,
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
    sdkConfig?: ContentGenerationSdkConfig,
  ): Promise<Result<{ content: string; description: string }, Error>> {
    try {
      this.logger.info('Starting LLM-driven content generation', {
        templateId: template.id,
        templateVersion: template.version,
      });

      let content = template.content;
      let description = '';

      // 1. Extract dynamic sections (LLM and VAR markers)
      const dynamicSections = this.extractDynamicSections(content);

      this.logger.debug('Dynamic sections identified', {
        templateId: template.id,
        sectionCount: dynamicSections.length,
        sections: dynamicSections.map((s) => `${s.type}:${s.id}`),
      });

      // 2. Generate content for dynamic sections via SDK
      if (dynamicSections.length > 0) {
        const fillResult = await this.fillDynamicSections(
          content,
          dynamicSections,
          context,
          template.name,
          sdkConfig,
        );
        content = fillResult.content;
        description = fillResult.description;
      }

      // 3. Final pass: substitute remaining {{VARS}} outside section markers
      // Values come from analysis context, not hardcoded defaults.
      content = this.substituteRemainingVars(content, context);

      this.logger.info('Content generation complete', {
        templateId: template.id,
        contentLength: content.length,
        dynamicSectionsProcessed: dynamicSections.length,
        hasLlmDescription: description.length > 0,
      });

      return Result.ok({ content, description });
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
          },
        ),
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
    context: AgentProjectContext,
  ): Promise<Result<LlmCustomization[], Error>> {
    // LLM sections are handled directly in generateContent() via fillDynamicSections().
    // This method is retained for interface compatibility.
    this.logger.debug(
      'generateLlmSections called — sections are handled inline in generateContent()',
      { templateId: template.id },
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
    sdkConfig?: ContentGenerationSdkConfig,
  ): Promise<{ content: string; description: string }> {
    try {
      // Build the prompt describing all sections to fill
      const prompt = this.buildAllSectionsPrompt(
        sections,
        context,
        templateName,
      );

      // Build JSON Schema for structured output: { description: string, sections: { [sectionId]: string } }
      const sectionIds = sections.map((s) => s.id);
      const sectionProperties: Record<string, unknown> = {};
      for (const section of sections) {
        sectionProperties[section.id] = {
          type: 'string',
          description: `Content for ${this.sectionIdToTopic(
            section.id,
            section.type,
          )} section`,
        };
      }

      const outputSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'A concise 1-sentence agent description (max 120 chars) specific to this project. Example: "Backend developer specializing in NestJS microservices with PostgreSQL and Redis"',
          },
          sections: {
            type: 'object',
            properties: sectionProperties,
            required: sectionIds,
          },
        },
        required: ['description', 'sections'],
      };

      // Resolve model from config
      const model =
        sdkConfig?.model ??
        (this.config.get<string>('model.selected') || 'default');

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

      // Add plugin skill context when available
      if (sdkConfig?.pluginPaths && sdkConfig.pluginPaths.length > 0) {
        const skills = discoverPluginSkills(sdkConfig.pluginPaths);
        if (skills.length > 0) {
          systemPrompt += `\n\n## Available Plugin Skills\nThe generated agent rules should reference these skills where relevant:\n${formatSkillsForPrompt(
            skills,
          )}`;
        }
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
        pluginPaths: sdkConfig?.pluginPaths,
      });

      let structuredOutput: unknown | null;
      try {
        // Process stream to extract structured output
        structuredOutput = await this.processGenerationStream(
          handle.stream,
          sdkConfig?.onStreamEvent,
          templateName,
        );
      } finally {
        handle.close();
      }

      if (
        structuredOutput &&
        typeof structuredOutput === 'object' &&
        'sections' in structuredOutput
      ) {
        const typedOutput = structuredOutput as {
          description?: string;
          sections: Record<string, string>;
        };
        const generatedSections = typedOutput.sections;
        const llmDescription =
          typeof typedOutput.description === 'string'
            ? typedOutput.description.trim()
            : '';

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
              `Section ${section.id}: SDK returned empty, using template fallback`,
            );
          }

          processed = processed.replace(section.fullMatch, () => replacement);
        }

        return { content: processed, description: llmDescription };
      }

      // Structured output not available — fall through to fallback
      this.logger.warn(
        'SDK did not return structured output, using template fallback for all sections',
      );
    } catch (error) {
      this.logger.warn(
        'SDK content generation failed, using template fallback for all sections',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    // Fallback: strip section markers but keep original template content.
    // Return empty description so the orchestrator uses its own fallback chain.
    let processed = content;
    for (const section of sections) {
      processed = processed.replace(section.fullMatch, section.content);
    }
    return { content: processed, description: '' };
  }

  /**
   * Build a single prompt that describes ALL dynamic sections to fill at once.
   */
  private buildAllSectionsPrompt(
    sections: DynamicSection[],
    context: AgentProjectContext,
    templateName: string,
  ): string {
    // Use multi-phase analysis if available, otherwise fall back to formatAnalysisData
    let analysisData: string;
    if (context.analysisDir) {
      const phaseContext = this.readPhaseContextForRole(
        context.analysisDir,
        templateName,
      );
      analysisData = phaseContext || this.formatAnalysisData(context);
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
7. Also generate a "description" field: a concise 1-sentence agent description (max 120 chars) specific to THIS project. Do NOT include the agent name. Focus on what this agent does for this specific project.

Return a JSON object: { "description": "<concise description>", "sections": { "<sectionId>": "<markdown content>", ... } }`;
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
    agentId?: string,
  ): Promise<unknown | null> {
    // Conversion context for FlatStreamEventUnion generation
    const sessionId = `gen-${agentId || 'unknown'}`;
    const messageId = sessionId;
    let counter = 0;
    let textBlockIndex = 0;
    let thinkingBlockIndex = 0;
    let activeToolCallId: string | null = null;

    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        if (onStreamEvent) {
          const flatEvent = this.convertStreamEventToFlatEvent(event, {
            sessionId,
            messageId,
            counter: counter++,
            textBlockIndex,
            thinkingBlockIndex,
            activeToolCallId,
          });
          // Update mutable context after conversion
          if (event.kind === 'tool_start') {
            textBlockIndex++;
            thinkingBlockIndex++;
            activeToolCallId =
              event.toolCallId ?? `${sessionId}-tool-${counter}`;
          }
          onStreamEvent({
            ...event,
            agentId,
            flatEvent: flatEvent ?? undefined,
          });
        }
      },
    };

    // Emit message_start so the frontend can create the execution tree root
    if (onStreamEvent) {
      onStreamEvent({
        kind: 'status',
        content: `Generating ${agentId}...`,
        timestamp: Date.now(),
        agentId,
        flatEvent: {
          id: `${sessionId}-msg-start`,
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId,
          messageId,
          role: 'assistant',
        } as MessageStartEvent,
      });
    }

    const processor = new SdkStreamProcessor({
      emitter,
      toolCallIdFactory: (_name, index) =>
        `gen-${agentId || 'unknown'}-${index}-${Date.now()}`,
      logger: this.logger,
      serviceTag: 'ContentGenerationService',
    });

    try {
      const result = await processor.process(stream);

      // Emit message_complete so the frontend knows the tree is done
      if (onStreamEvent) {
        onStreamEvent({
          kind: 'status',
          content: `${agentId} generation complete`,
          timestamp: Date.now(),
          agentId,
          flatEvent: {
            id: `${sessionId}-msg-complete`,
            eventType: 'message_complete',
            timestamp: Date.now(),
            sessionId,
            messageId,
          } as MessageCompleteEvent,
        });
      }

      return result.structuredOutput;
    } catch (error) {
      this.logger.warn('ContentGenerationService: Stream processing error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Convert a StreamEvent to a FlatStreamEventUnion for ExecutionNode rendering.
   * Used by the generation stream to provide flat events to the wizard transcript.
   */
  private convertStreamEventToFlatEvent(
    event: StreamEvent,
    ctx: {
      sessionId: string;
      messageId: string;
      counter: number;
      textBlockIndex: number;
      thinkingBlockIndex: number;
      activeToolCallId: string | null;
    },
  ): FlatStreamEventUnion | null {
    const baseFields = {
      id: `${ctx.sessionId}-${ctx.counter}`,
      timestamp: event.timestamp,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
    };

    switch (event.kind) {
      case 'text':
        return {
          ...baseFields,
          eventType: 'text_delta',
          delta: event.content,
          blockIndex: ctx.textBlockIndex,
        } as TextDeltaEvent;

      case 'thinking':
        return {
          ...baseFields,
          eventType: 'thinking_delta',
          delta: event.content,
          blockIndex: ctx.thinkingBlockIndex,
        } as ThinkingDeltaEvent;

      case 'tool_start': {
        const toolCallId =
          event.toolCallId ?? `${ctx.sessionId}-tool-${ctx.counter}`;
        return {
          ...baseFields,
          eventType: 'tool_start',
          toolCallId,
          toolName: event.toolName ?? 'unknown',
          isTaskTool: false,
        } as ToolStartEvent;
      }

      case 'tool_input':
        return {
          ...baseFields,
          eventType: 'tool_delta',
          toolCallId:
            event.toolCallId ??
            ctx.activeToolCallId ??
            `${ctx.sessionId}-tool-unk`,
          delta: event.content,
        } as ToolDeltaEvent;

      case 'tool_result':
        return {
          ...baseFields,
          eventType: 'tool_result',
          toolCallId:
            event.toolCallId ??
            ctx.activeToolCallId ??
            `${ctx.sessionId}-tool-unk`,
          output: event.content,
          isError: event.isError ?? false,
        } as ToolResultEvent;

      case 'error':
      case 'status':
        return null;

      default:
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
      `  Trailing Comma: ${context.codeConventions.trailingComma}`,
    );

    if (context.relevantFiles.length > 0) {
      parts.push(
        `Key Files: ${context.relevantFiles
          .slice(0, 10)
          .map((f) => f.relativePath)
          .join(', ')}`,
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
            .join(', ')}`,
        );
      }

      if (analysis.languageDistribution?.length) {
        parts.push(
          `Language Distribution: ${analysis.languageDistribution
            .map((l) => `${l.language} ${l.percentage}%`)
            .join(', ')}`,
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
          })`,
        );
      }

      if (analysis.existingIssues) {
        parts.push(
          `Code Issues: ${analysis.existingIssues.errorCount} errors, ${analysis.existingIssues.warningCount} warnings`,
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
    context: AgentProjectContext,
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
        value,
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
    vars: Record<string, string>,
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
      },
    );
  }

  // ==========================================================================
  // Multi-Phase Analysis Integration (TASK_2025_154)
  // ==========================================================================

  /**
   * Cache for raw phase file reads per analysisDir.
   * Files are read once and reused across 13 agent template calls.
   */
  private phaseFileCache: {
    dir: string;
    files: Record<string, string>;
  } | null = null;

  /**
   * Read phase-specific context directly from analysis phase files.
   *
   * Reads phase files from the analysis directory and selects which phases
   * to include based on the agent role (derived from templateName).
   * Each phase is truncated to a per-phase token budget.
   *
   * Role-based phase selection:
   * - All agents: Phase 1 (project profile, 8K limit)
   * - Backend agents: + Phase 3 (quality audit, 8K)
   * - Frontend agents: + Phase 3 (quality audit, 8K)
   * - QA/Tester agents: + Phase 3 (quality audit, 10K)
   * - Architect agents: + Phase 2 (architecture assessment, 8K) + Phase 4 (elevation plan, 5K)
   * - All others: Phase 1 only
   *
   * @param analysisDir - Path to the multi-phase analysis slug directory
   * @param templateName - Template name used to determine role-specific phases
   * @returns Combined analysis context, or empty string if unavailable
   */
  private readPhaseContextForRole(
    analysisDir: string,
    templateName: string,
  ): string {
    try {
      // Read and cache all phase files
      let files: Record<string, string>;
      if (this.phaseFileCache?.dir === analysisDir) {
        files = this.phaseFileCache.files;
      } else {
        files = {};
        const phaseFiles = [
          {
            key: 'profile',
            file: '01-project-profile.md',
            label: 'Project Profile',
          },
          {
            key: 'architecture',
            file: '02-architecture-assessment.md',
            label: 'Architecture Assessment',
          },
          {
            key: 'quality',
            file: '03-quality-audit.md',
            label: 'Quality Audit',
          },
          {
            key: 'elevation',
            file: '04-elevation-plan.md',
            label: 'Elevation Plan',
          },
        ];
        for (const pf of phaseFiles) {
          try {
            files[pf.key] = readFileSync(
              path.join(analysisDir, pf.file),
              'utf-8',
            );
          } catch {
            // Phase file not available - skip
          }
        }
        this.phaseFileCache = { dir: analysisDir, files };
      }

      // Determine which phases to include based on role
      const name = templateName.toLowerCase();
      const phasesToInclude: Array<{
        key: string;
        label: string;
        budget: number;
      }> = [{ key: 'profile', label: 'Project Profile', budget: 8_000 }];

      if (name.includes('backend') || name.includes('frontend')) {
        phasesToInclude.push({
          key: 'quality',
          label: 'Quality Audit',
          budget: 8_000,
        });
      } else if (name.includes('tester') || name.includes('qa')) {
        phasesToInclude.push({
          key: 'quality',
          label: 'Quality Audit',
          budget: 10_000,
        });
      } else if (name.includes('architect')) {
        phasesToInclude.push({
          key: 'architecture',
          label: 'Architecture Assessment',
          budget: 8_000,
        });
        phasesToInclude.push({
          key: 'elevation',
          label: 'Elevation Plan',
          budget: 5_000,
        });
      }

      // Build combined context with per-phase truncation
      const sections: string[] = [];
      for (const phase of phasesToInclude) {
        const content = files[phase.key];
        if (!content) continue;

        const truncated =
          content.length > phase.budget
            ? content.substring(0, phase.budget) +
              '\n\n...(truncated for token budget)'
            : content;
        sections.push(`## ${phase.label}\n\n${truncated}`);
      }

      return sections.join('\n\n');
    } catch {
      // Directory not available - caller falls back to formatAnalysisData()
      return '';
    }
  }
}

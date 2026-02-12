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
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  SDK_TOKENS,
  isContentBlockDelta,
  isContentBlockStart,
  isContentBlockStop,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
} from '@ptah-extension/agent-sdk';
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { SDKMessage } from '@ptah-extension/agent-sdk';

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

      // Execute SDK call with structured output
      const handle = await this.internalQueryService.execute({
        cwd: context.rootPath,
        model,
        prompt,
        isPremium: sdkConfig?.isPremium ?? false,
        mcpServerRunning: sdkConfig?.mcpServerRunning ?? false,
        mcpPort: sdkConfig?.mcpPort,
        maxTurns: 5,
        outputFormat: { type: 'json_schema', schema: outputSchema },
      });

      // Process stream to extract structured output
      const structuredOutput = await this.processGenerationStream(
        handle.stream,
        sdkConfig?.onStreamEvent,
        templateName
      );

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
    const analysisData = this.formatAnalysisData(context);

    const sectionDescriptions = sections
      .map((section) => {
        const topic = this.sectionIdToTopic(section.id, section.type);
        const typeLabel = section.type === 'var' ? 'DATA' : 'GUIDANCE';

        return `### Section "${section.id}" (${typeLabel}: ${topic})
TEMPLATE BLUEPRINT:
${section.content}`;
      })
      .join('\n\n');

    return `You are generating project-specific content for the "${templateName}" agent configuration file.

PROJECT ANALYSIS DATA:
${analysisData}

SECTIONS TO FILL:
${sectionDescriptions}

INSTRUCTIONS:
- For each section, generate intelligent, project-specific content
- DATA sections: replace all {{VARIABLE}} placeholders with actual values from the analysis data
- GUIDANCE sections: generate real, specific content based on the project's tech stack — no generic advice
- Use the template blueprint as guidance for the KIND of content expected
- Do NOT include any {{VARIABLE}}, {{GENERATED_*}}, or section markers in your output
- Each section should be pure markdown content (no wrapping markers, section headers, or code fences)
- Keep each section under 500 words

Return a JSON object with a "sections" property containing each section ID mapped to its generated content.`;
  }

  /**
   * Process SDK message stream to extract structured output.
   *
   * Follows the same pattern as AgenticAnalysisService and EnhancedPromptsService.
   * Optionally broadcasts stream events (text, tool calls, thinking) for live
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
    // Throttle state for text and thinking deltas (100ms)
    let lastTextEmit = 0;
    let lastThinkingEmit = 0;
    const THROTTLE_MS = 100;

    // Track active tool blocks for tool call grouping
    const activeToolBlocks = new Map<
      number,
      { name: string; inputBuffer: string; toolCallId: string }
    >();

    try {
      for await (const message of stream) {
        // ==============================================================
        // Stream events -- broadcast for live UI updates
        // ==============================================================
        if (message.type === 'stream_event' && onStreamEvent) {
          const event = message.event;

          // Content block deltas: text, tool input, thinking
          if (isContentBlockDelta(event)) {
            if (isTextDelta(event.delta)) {
              const now = Date.now();
              if (now - lastTextEmit >= THROTTLE_MS) {
                const trimmed = event.delta.text.trim();
                if (trimmed.length > 0) {
                  lastTextEmit = now;
                  try {
                    onStreamEvent({
                      kind: 'text',
                      content: event.delta.text,
                      agentId,
                      timestamp: now,
                    });
                  } catch {
                    // Fire-and-forget: swallow callback errors
                  }
                }
              }
            }

            if (isInputJsonDelta(event.delta)) {
              const activeBlock = activeToolBlocks.get(event.index);
              if (activeBlock) {
                activeBlock.inputBuffer += event.delta.partial_json;
              }
            }

            if (isThinkingDelta(event.delta)) {
              const now = Date.now();
              if (now - lastThinkingEmit >= THROTTLE_MS) {
                lastThinkingEmit = now;
                try {
                  onStreamEvent({
                    kind: 'thinking',
                    content: event.delta.thinking,
                    agentId,
                    timestamp: now,
                  });
                } catch {
                  // Fire-and-forget: swallow callback errors
                }
              }
            }
          }

          // Tool use start -- track active tool blocks
          if (
            isContentBlockStart(event) &&
            event.content_block.type === 'tool_use'
          ) {
            const toolCallId = `gen-${agentId || 'unknown'}-${
              event.index
            }-${Date.now()}`;
            activeToolBlocks.set(event.index, {
              name: event.content_block.name,
              inputBuffer: '',
              toolCallId,
            });

            try {
              onStreamEvent({
                kind: 'tool_start',
                content: `Calling ${event.content_block.name}`,
                toolName: event.content_block.name,
                toolCallId,
                agentId,
                timestamp: Date.now(),
              });
            } catch {
              // Fire-and-forget: swallow callback errors
            }
          }

          // Tool use stop -- emit accumulated tool input
          if (isContentBlockStop(event)) {
            const completedBlock = activeToolBlocks.get(event.index);
            if (completedBlock) {
              try {
                onStreamEvent({
                  kind: 'tool_input',
                  content: completedBlock.inputBuffer.substring(0, 2000),
                  toolName: completedBlock.name,
                  toolCallId: completedBlock.toolCallId,
                  agentId,
                  timestamp: Date.now(),
                });
              } catch {
                // Fire-and-forget: swallow callback errors
              }
              activeToolBlocks.delete(event.index);
            }
          }
        }

        // ==============================================================
        // Result message -- extract structured_output
        // ==============================================================
        if (
          message.type === 'result' &&
          message.subtype === 'success' &&
          'structured_output' in message &&
          message.structured_output
        ) {
          this.logger.debug(
            'ContentGenerationService: Extracted structured output from SDK result'
          );
          return message.structured_output;
        }
      }

      this.logger.warn(
        'ContentGenerationService: No structured output in SDK stream'
      );
      return null;
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
}

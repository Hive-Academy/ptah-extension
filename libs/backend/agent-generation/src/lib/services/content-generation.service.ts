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
 * Uses InternalQueryService → Agent SDK (uses API key directly).
 *
 * Makes ONE SDK call per template with structured output to fill ALL dynamic
 * sections at once, instead of N separate calls per section.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  resolveMcpSessionWiring,
  type IMcpServerStatus,
} from '@ptah-extension/platform-core';
import { Result, WizardPhaseId } from '@ptah-extension/shared';
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
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
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
  GeneratedSectionValidator,
  type AnalysisPathIndex,
} from './generated-section-validator';
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
/**
 * Ceiling on a single content-generation SDK query, covering the queue wait for
 * a concurrency slot AND the stream. Armed before `execute()` so a caller
 * queued behind a long one-shot cannot block indefinitely.
 */
const CONTENT_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;

@injectable()
export class ContentGenerationService implements IContentGenerationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | null = null,
    // Last, and defaulted, so the seventeen existing three-argument
    // constructions in the spec keep compiling. tsyringe still resolves the
    // registered `@injectable()` class from `design:paramtypes`; the default
    // only applies to a hand-rolled `new`.
    private readonly sectionValidator: GeneratedSectionValidator = new GeneratedSectionValidator(),
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
  ): Promise<Result<{ content: string; warnings: string[] }, Error>> {
    try {
      this.logger.info('Starting LLM-driven content generation', {
        templateId: template.id,
        templateVersion: template.version,
      });

      let content = template.content;
      let warnings: string[] = [];
      const dynamicSections = this.extractDynamicSections(content);

      this.logger.debug('Dynamic sections identified', {
        templateId: template.id,
        sectionCount: dynamicSections.length,
        sections: dynamicSections.map((s) => `${s.type}:${s.id}`),
      });
      if (dynamicSections.length > 0) {
        const fillResult = await this.fillDynamicSections(
          content,
          dynamicSections,
          context,
          template.name,
          sdkConfig,
        );
        content = fillResult.content;
        warnings = fillResult.warnings;
      }
      content = this.substituteRemainingVars(content, context);

      this.logger.info('Content generation complete', {
        templateId: template.id,
        contentLength: content.length,
        dynamicSectionsProcessed: dynamicSections.length,
        rejectedSections: warnings.length,
      });

      return Result.ok({ content, warnings });
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
  ): Promise<{ content: string; warnings: string[] }> {
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const warnings: string[] = [];
    // The SAME text the prompt shows the model is what the validator mines for
    // citable paths. Anything else would reject a path the model was handed.
    const analysisData = this.resolveAnalysisData(context, templateName);
    const pathIndex = this.sectionValidator.buildPathIndex(context.rootPath, [
      analysisData,
      ...context.relevantFiles.map((file) => file.relativePath),
    ]);
    try {
      const prompt = this.buildAllSectionsPrompt(
        sections,
        analysisData,
        templateName,
      );
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

      // Sections only. The agent's `description` is authored metadata — the
      // sentence a harness selects on — and the orchestrator now takes it from
      // the template alone, so asking the model for one produced a value
      // nothing read.
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
      const model =
        sdkConfig?.model ??
        (this.modelSettings.selectedModel.get() || 'default');
      let systemPrompt = `You write the repository-specific half of a subagent instruction file. The other half — role, method, output contract — is already authored and stack-agnostic. Your sections tell the agent HOW THIS REPOSITORY DOES THINGS.

WHAT A SECTION IS
- Conventions and patterns only: the rule a contributor must follow, the boundary they must not cross, the file that decides the question.
- Write for a reader six months from now. Every sentence must still be true after someone adds a directory, upgrades a dependency, or fixes the lint backlog.

FORBIDDEN — these make the file wrong the week after it is written:
- Counts of anything. No "15 libs", "22 tokens", "30 handlers", "three adapters".
- Version numbers. Name the framework, never its version.
- Percentages, coverage figures, error or warning tallies.
- Dates, years, or any "as of" clause.
- Inventories: do not list or summarise the directory tree, the lib set, or the dependency list.

REQUIRED
- Every bullet cites at least one concrete path, in backticks: \`path/to/thing.ts\`.
- You MAY read a file to confirm a convention before you state it. Cite only paths you actually opened or that the PROJECT ANALYSIS DATA lists — never a path you inferred, guessed or completed from either.
- 8 to 15 lines per section, bullets preferred.
- Keep the section's "## " heading exactly as the template blueprint spells it, as the first line of your output.
- If the evidence cannot carry the section — fewer than about six distinct claims you can each back with a path — return an empty string for that section. The authored fallback ships instead, which is the right outcome. Do not pad the section with general advice to reach a length.

OUTPUT FORMAT
- Return a JSON object with a "sections" property mapping each section ID to its markdown.
- No wrapping markers and no code fences around the section itself.`;

      if (sdkConfig?.enhancedPromptContent) {
        systemPrompt += `\n\n--- Enhanced Project Guidance ---\n${sdkConfig.enhancedPromptContent}`;
      }
      if (sdkConfig?.pluginPaths && sdkConfig.pluginPaths.length > 0) {
        const skills = discoverPluginSkills(sdkConfig.pluginPaths);
        if (skills.length > 0) {
          systemPrompt += `\n\n## Available Plugin Skills\nThe generated agent rules should reference these skills where relevant:\n${formatSkillsForPrompt(
            skills,
          )}`;
        }
      }
      // Arm the timeout BEFORE execute() so the budget covers the queue wait
      // for a concurrency slot, not just the stream after the handle resolves.
      timeoutHandle = setTimeout(
        () => abortController.abort(),
        CONTENT_GENERATION_TIMEOUT_MS,
      );
      const handle = await this.internalQueryService.execute({
        cwd: context.rootPath,
        model,
        prompt,
        systemPromptAppend: systemPrompt,
        // Was hard-coded false (defect 13); wizard content generation benefits
        // from the workspace-intelligence tools like any other session.
        ...resolveMcpSessionWiring(this.mcpServerStatus),
        maxTurns: 25,
        abortController,
        outputFormat: { type: 'json_schema', schema: outputSchema },
      });

      let structuredOutput: unknown | null;
      try {
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
          sections: Record<string, string>;
        };
        const generatedSections = typedOutput.sections;
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
            // An empty section is the answer the prompt asks for when the
            // evidence cannot carry one — an honest abstention, not a rejected
            // attempt. It costs nothing (the authored fallback is what would
            // have shipped anyway), so it is logged at debug and never becomes
            // a warning in the generation summary, where it would read as a
            // failure the user should act on.
            replacement = section.content;
            this.logger.debug(
              `Section ${section.id}: no generated text, shipping the authored fallback`,
              { templateName },
            );
          }

          // Only LLM sections are gated. A VAR section is DATA — a package
          // manager, a monorepo type — and the rules below exist to keep DATA
          // out of prose, not out of the slot that asked for it.
          if (section.type === 'llm' && replacement !== section.content) {
            const verdict = await this.sectionValidator.validate(
              {
                sectionId: section.id,
                generated: replacement,
                fallback: section.content,
              },
              pathIndex,
            );
            if (!verdict.accepted) {
              const reason = verdict.violations.join('; ');
              replacement = section.content;
              this.logger.warn(
                `Section ${section.id}: generated text rejected, keeping authored fallback`,
                { templateName, reason },
              );
              warnings.push(
                `[${templateName}] LLM section ${section.id} rejected (${reason}) — kept the authored fallback`,
              );
            }
          }

          processed = processed.replace(section.fullMatch, () => replacement);
        }

        return { content: processed, warnings };
      }
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
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
    let processed = content;
    for (const section of sections) {
      processed = processed.replace(section.fullMatch, section.content);
    }
    return { content: processed, warnings };
  }

  /**
   * Build a single prompt that describes ALL dynamic sections to fill at once.
   */
  private buildAllSectionsPrompt(
    sections: DynamicSection[],
    analysisData: string,
    templateName: string,
  ): string {
    const sectionDescriptions = sections
      .map((section) => {
        const topic = this.sectionIdToTopic(section.id, section.type);
        const typeLabel = section.type === 'var' ? 'DATA' : 'CONVENTIONS';

        return `### Section "${section.id}" (${typeLabel})
WRITE ABOUT: ${topic}
TEMPLATE BLUEPRINT — keep its heading, replace its generic body:
${section.content}`;
      })
      .join('\n\n');

    return `Write the repository-specific sections of the "${templateName}" agent instruction file.

## PROJECT ANALYSIS DATA (the only source of truth)
${analysisData}

## SECTIONS TO FILL
${sectionDescriptions}

## INSTRUCTIONS
1. Replace each blueprint's generic body with the conventions THIS repository actually follows, keeping the blueprint's "## " heading verbatim as your first line.
2. Say what a contributor must DO and must NOT do, and name the file that decides it. "Route model output through \`src/markdown/sanitize.ts\`" is a convention; "the project has a markdown lib" is a census.
3. Every bullet carries at least one backticked path taken from the analysis data above. If you cannot cite a path for a claim, drop the claim.
4. No counts, no version numbers, no percentages, no dates, no directory inventories. A section containing any of them is discarded and the generic blueprint text ships instead.
5. 8 to 15 lines per section. Prefer bullets over paragraphs.
6. If a section's evidence supports fewer than about six distinct path-backed claims, return an empty string for that section. The authored blueprint text ships in its place, which is better than a padded section.

Return a JSON object: { "sections": { "<sectionId>": "<markdown or empty string>", ... } }`;
  }

  /**
   * Pick the analysis text the prompt — and therefore the validator — works from.
   *
   * The multi-phase files are richer and already role-filtered; the formatted
   * context summary is the fallback when the wizard did not run them.
   */
  private resolveAnalysisData(
    context: AgentProjectContext,
    templateName: string,
  ): string {
    if (context.analysisDir) {
      const phaseContext = this.readPhaseContextForRole(
        context.analysisDir,
        templateName,
      );
      if (phaseContext) return phaseContext;
    }
    return this.formatAnalysisData(context);
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
    const sessionId = WizardPhaseId.fromAgent(agentId);
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
    const llmRegex = /<!-- LLM:(\w+) -->([\s\S]*?)<!-- \/LLM:\1 -->/g;
    for (const match of content.matchAll(llmRegex)) {
      sections.push({
        type: 'llm',
        id: match[1],
        content: match[2].trim(),
        fullMatch: match[0],
      });
    }
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
   * What each registered section id is FOR, in the words the model needs.
   *
   * The ids are role-assigned — a developer's template carries
   * `FRAMEWORK_CONVENTIONS`, a reviewer's carries `REVIEW_FOCUS` — so the topic
   * is the one place the prompt can say what a section of that name should
   * contain. Left to a de-kebabbed id ("Framework Conventions") the model wrote
   * whatever "conventions" suggested, which is how a lib census ended up under
   * that heading.
   *
   * Not closed on purpose: an id with no entry still generates, from its
   * humanised name. A missing entry should read as a thinner prompt, not a
   * failed wizard.
   */
  private static readonly SECTION_TOPICS: Readonly<Record<string, string>> = {
    FRAMEWORK_CONVENTIONS:
      'how this repository declares and wires the things its framework asks for — modules, components, services, configuration, dependency injection, validation — and which file settles each of those questions',
    ARCHITECTURE_PATTERNS:
      'the boundaries this codebase enforces and the direction dependencies are allowed to point: which layer may import which, what belongs on each side of a boundary, and the shape a new unit of code has to take to fit',
    BUILD_AND_DEPLOY_SURFACE:
      'the build, packaging and release surface: which command builds and tests what, which config files own that behaviour, and what a change to them is expected to keep working',
    TEST_INFRASTRUCTURE:
      'where tests live relative to the code they cover, how they are named and executed, what the harness provides, and the rules a new test has to follow to run at all',
    EXISTING_PATTERNS:
      'the patterns already established here that a new design must extend rather than replace — the established way to add a unit of behaviour, and the seams a change is expected to use',
    REVIEW_FOCUS:
      'what a reviewer of THIS repository looks at first: the conventions most often broken here, the boundaries most often crossed by accident, and the files where a mistake is expensive',
  };

  /**
   * Convert section ID to the topic sentence used in the LLM prompt.
   */
  private sectionIdToTopic(id: string, type: string): string {
    const mapped = ContentGenerationService.SECTION_TOPICS[id];
    if (mapped) return mapped;

    const humanName = id
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ');
    return type === 'var' ? `Project ${humanName}` : humanName;
  }

  /**
   * Format the project context as a readable analysis summary for the LLM.
   *
   * ## What is deliberately NOT here
   *
   * The model reproduces the shape of what it is shown. Every numeric field the
   * analysis carries used to be pasted in — pattern confidence, language
   * distribution, estimated coverage, error and warning tallies — and the
   * generated sections came back reading like a dashboard: "92% confidence
   * layered architecture", "3 errors, 12 warnings", "72% coverage". All four
   * were stale before the wizard finished, and the post-generation validator
   * would now discard the section for saying them.
   *
   * So the numbers are dropped HERE, at the source, rather than left in the
   * prompt for a rule to catch downstream. What survives is the part that stays
   * true: names, paths, and conventions. Pattern names without their confidence,
   * test frameworks without their coverage, file locations verbatim — those
   * paths are also what the validator will accept as citations, so the model is
   * shown exactly the vocabulary it is allowed to use.
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
    const analysis = context.fullAnalysis;
    if (analysis) {
      if (analysis.projectTypeDescription) {
        parts.push(`Project Description: ${analysis.projectTypeDescription}`);
      }

      if (analysis.architecturePatterns?.length > 0) {
        // Names only. The confidence score is a property of the ANALYSER, not of
        // the repository, and it read as a fact about the code once quoted.
        parts.push(
          `Architecture Patterns: ${analysis.architecturePatterns
            .map((p) => p.name)
            .join(', ')}`,
        );
      }

      // `languageDistribution` is intentionally omitted: it is a percentage
      // table and nothing else, and `Languages:` above already carries the same
      // information in the only form that survives a refactor — ordered names.

      if (analysis.testCoverage) {
        const kinds = [
          analysis.testCoverage.hasUnitTests ? 'unit' : null,
          analysis.testCoverage.hasIntegrationTests ? 'integration' : null,
        ].filter((kind): kind is string => kind !== null);
        parts.push(
          `Test Setup: framework ${
            analysis.testCoverage.testFramework || 'unknown'
          }${kinds.length > 0 ? `, ${kinds.join(' and ')} tests present` : ', no test kinds detected'}`,
        );
      }

      // `existingIssues` is intentionally omitted: an error/warning tally is a
      // snapshot of one lint run, and the first thing a section written from it
      // says is how many problems the repository "has".

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
      result = result.replace(
        new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'),
        value,
      );
    }
    result = this.processSimpleConditionals(result, varMap);
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
          files[pf.key] = readFileSync(
            path.join(analysisDir, pf.file),
            'utf-8',
          );
        }
        this.phaseFileCache = { dir: analysisDir, files };
      }
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
      return '';
    }
  }
}

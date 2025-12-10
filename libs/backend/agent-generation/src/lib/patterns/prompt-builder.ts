/**
 * Interface for building LLM prompts from context data.
 *
 * Separates the concerns of system instructions (LLM behavior)
 * from user instructions (task-specific data and requirements).
 *
 * @template TContext - Type of context data used for prompt building
 */
export interface PromptBuilder<TContext> {
  /**
   * Build the system prompt that sets LLM behavior.
   *
   * System prompts define the role, expertise level, and general
   * instructions that apply to all generations of this type.
   *
   * @param context - Context data for this generation
   * @returns System prompt string
   */
  buildSystemPrompt(context: TContext): string;

  /**
   * Build the user prompt with task-specific instructions.
   *
   * User prompts contain the actual task instructions, context data,
   * and optional template to be filled by the LLM.
   *
   * @param context - Context data for this generation
   * @param template - Optional template string to be populated by LLM
   * @returns User prompt string
   */
  buildUserPrompt(context: TContext, template?: string): string;
}

/**
 * Base implementation with common prompt building logic.
 *
 * **Use Case**: Extend this class to create specialized prompt builders
 * for different generation types (agents, memory banks, documentation).
 *
 * **Pattern Origin**: Extracted from roocode-generator's MemoryBankContentGenerator
 * which builds prompts with embedded context data and template instructions.
 *
 * @example
 * ```typescript
 * interface AgentContext {
 *   agentName: string;
 *   role: string;
 *   capabilities: string[];
 *   projectInfo: ProjectInfo;
 * }
 *
 * class AgentPromptBuilder extends BasePromptBuilder<AgentContext> {
 *   buildSystemPrompt(context: AgentContext): string {
 *     return `You are an expert AI agent designer. Your task is to create
 * a comprehensive agent definition based on the provided role and capabilities.
 * Format the output as valid Markdown with YAML frontmatter.`;
 *   }
 *
 *   buildUserPrompt(context: AgentContext, template?: string): string {
 *     const contextData = this.formatContextAsJson(context);
 *
 *     return `Generate an agent definition for: ${context.agentName}
 *
 * Role: ${context.role}
 *
 * ${contextData}
 *
 * ${template ? `TEMPLATE:\n${template}` : ''}`;
 *   }
 * }
 *
 * // Usage
 * const builder = new AgentPromptBuilder();
 * const systemPrompt = builder.buildSystemPrompt(agentContext);
 * const userPrompt = builder.buildUserPrompt(agentContext, templateString);
 * ```
 *
 * @example
 * ```typescript
 * // Real-world usage: Memory bank generation
 * class MemoryBankPromptBuilder extends BasePromptBuilder<ProjectContext> {
 *   buildSystemPrompt(context: ProjectContext): string {
 *     return `You are an expert technical writer specializing in software documentation.
 * Your task is to populate the provided Markdown template using the structured PROJECT
 * CONTEXT data. Follow instructions embedded in HTML comments (<!-- LLM: ... -->).`;
 *   }
 *
 *   buildUserPrompt(context: ProjectContext, template?: string): string {
 *     const instructions = `Generate content for the ${context.fileType} document.
 * Use the PROJECT CONTEXT DATA as directed by <!-- LLM: ... --> instructions in the template.`;
 *
 *     const contextData = this.formatContextAsJson(context);
 *
 *     return `${instructions}\n\n${contextData}\n\nTEMPLATE:\n${template}`;
 *   }
 * }
 * ```
 *
 * @template TContext - Type of context data used for prompt building
 */
export abstract class BasePromptBuilder<TContext>
  implements PromptBuilder<TContext>
{
  abstract buildSystemPrompt(context: TContext): string;
  abstract buildUserPrompt(context: TContext, template?: string): string;

  /**
   * Format context data as JSON for inclusion in prompts.
   *
   * Wraps the JSON in markdown code blocks for better LLM parsing.
   *
   * @param context - Context object to serialize
   * @returns Formatted JSON string wrapped in markdown code block
   *
   * @example
   * ```typescript
   * const formatted = this.formatContextAsJson({ name: 'test', id: 123 });
   * // Returns:
   * // ```json
   * // {
   * //   "name": "test",
   * //   "id": 123
   * // }
   * // ```
   * ```
   */
  protected formatContextAsJson(context: TContext): string {
    return `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  }

  /**
   * Build a combined prompt with system instructions prepended.
   *
   * Useful for LLM APIs that accept a single prompt string rather
   * than separate system/user messages.
   *
   * @param context - Context data for this generation
   * @param template - Optional template string
   * @returns Combined prompt with system + user instructions
   *
   * @example
   * ```typescript
   * const combined = builder.buildCombinedPrompt(context, template);
   * // Returns:
   * // [System prompt]
   * //
   * // ---
   * //
   * // [User prompt with context and template]
   * ```
   */
  buildCombinedPrompt(context: TContext, template?: string): string {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context, template);
    return `${systemPrompt}\n\n---\n\n${userPrompt}`;
  }
}

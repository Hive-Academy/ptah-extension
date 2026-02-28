/**
 * Agent Transform Rules
 * TASK_2025_160: Shared transformation rules and regex patterns
 *
 * Used by both CopilotAgentTransformer and GeminiAgentTransformer.
 * Extracts common rewrite logic to avoid duplication.
 *
 * Design: Pure functions with no I/O or DI dependencies.
 */

import type { CliTarget } from '@ptah-extension/shared';

// ========================================
// Claude-Specific Content Patterns
// ========================================

/**
 * Regex patterns for detecting Claude-specific content in agent markdown.
 * Used by transformers to identify content that needs rewriting.
 */
export const CLAUDE_PATTERNS = {
  /** AskUserQuestion tool references */
  askUserQuestion: /AskUserQuestion\s*(?:tool)?/gi,
  /** Task tool delegation references */
  taskTool: /(?:use\s+the\s+)?Task\s+tool\s+(?:to\s+)?/gi,
  /** Task(subagent_type=... invocation pattern */
  taskToolInvocation:
    /Task\s*\(\s*subagent[_-]?type\s*=\s*['"]([^'"]+)['"]/gi,
  /** Slash command references */
  slashCommand:
    /\/(?:orchestrate|review-code|review-logic|review-security|review-pr)/gi,
  /** Internal import/reference lines */
  internalImport: /^.*@ptah-extension\/.*$/gm,
  /** Claude-specific product references */
  claudeSpecificDirective:
    /Claude Code|Claude Agent SDK|claude_code preset|claude\.ai/gi,
  /** Skill tool references (Skill tool to invoke) */
  skillTool: /Skill\s+tool\s+(?:to\s+)?/gi,
} as const;

// ========================================
// CLI-Specific Tool Mappings
// ========================================

/**
 * Mapping of Claude tools to CLI-specific equivalents.
 */
const CLI_TOOL_MAPPINGS: Record<
  CliTarget,
  {
    askUser: string;
    taskDelegate: string;
    slashPrefix: string;
    productName: string;
  }
> = {
  copilot: {
    askUser: 'ask_followup_question',
    taskDelegate: 'copilot --agent',
    slashPrefix: 'copilot',
    productName: 'GitHub Copilot CLI',
  },
  gemini: {
    askUser: 'ask the user directly in your response',
    taskDelegate: 'gemini --agent',
    slashPrefix: 'gemini',
    productName: 'Gemini CLI',
  },
};

// ========================================
// Transform Functions
// ========================================

/**
 * Strip lines containing @ptah-extension/ internal references.
 * These are TypeScript import paths that have no meaning in CLI agents.
 */
export function stripInternalReferences(content: string): string {
  return content.replace(CLAUDE_PATTERNS.internalImport, '').replace(
    // Clean up consecutive blank lines left by stripping
    /\n{3,}/g,
    '\n\n'
  );
}

/**
 * Rewrite YAML frontmatter for the target CLI.
 *
 * Keeps `name` and `description` fields (used by all CLIs).
 * Removes Claude-specific fields and adds CLI-appropriate fields.
 *
 * Both Copilot and Gemini use the same frontmatter format:
 * ```yaml
 * ---
 * name: agent-name
 * description: Agent description
 * ---
 * ```
 */
export function rewriteFrontmatter(
  content: string,
  _cli: CliTarget,
  agentId: string,
  description: string
): string {
  // Match existing frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    // No frontmatter, add one
    return `---\nname: ${agentId}\ndescription: ${description}\n---\n\n${content}`;
  }

  // Rebuild frontmatter with only name and description
  const newFrontmatter = `---\nname: ${agentId}\ndescription: ${description}\n---`;
  return content.replace(frontmatterMatch[0], newFrontmatter);
}

/**
 * Rewrite tool references for the target CLI.
 *
 * Replaces Claude-specific tool references with CLI equivalents:
 * - AskUserQuestion -> CLI-specific questioning pattern
 * - Task tool -> CLI subagent invocation
 * - Skill tool -> CLI skill invocation
 */
export function rewriteToolReferences(
  content: string,
  cli: CliTarget
): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  let result = content;

  // Replace AskUserQuestion references
  result = result.replace(
    CLAUDE_PATTERNS.askUserQuestion,
    mapping.askUser
  );

  // Replace Task(subagent_type='name' ...) invocation pattern
  result = result.replace(
    CLAUDE_PATTERNS.taskToolInvocation,
    `${mapping.taskDelegate} $1`
  );

  // Replace "Task tool to" references
  result = result.replace(
    CLAUDE_PATTERNS.taskTool,
    `${mapping.taskDelegate} `
  );

  // Replace Skill tool references
  result = result.replace(
    CLAUDE_PATTERNS.skillTool,
    `${mapping.slashPrefix} skill `
  );

  return result;
}

/**
 * Rewrite slash command references for the target CLI.
 *
 * Replaces Claude-specific slash commands:
 * - /orchestrate -> copilot orchestrate / gemini orchestrate
 * - /review-code -> copilot review-code / gemini review-code
 */
export function rewriteSlashCommands(
  content: string,
  cli: CliTarget
): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];

  return content.replace(
    CLAUDE_PATTERNS.slashCommand,
    (match) => {
      // Extract command name (strip leading /)
      const commandName = match.substring(1);
      return `${mapping.slashPrefix} ${commandName}`;
    }
  );
}

/**
 * Replace Claude-specific product references with CLI-appropriate ones.
 */
export function rewriteProductReferences(
  content: string,
  cli: CliTarget
): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  return content.replace(
    CLAUDE_PATTERNS.claudeSpecificDirective,
    mapping.productName
  );
}

/**
 * Apply all transformations to agent content for a target CLI.
 *
 * Order matters:
 * 1. Rewrite frontmatter (name/description)
 * 2. Rewrite tool references (AskUserQuestion, Task tool)
 * 3. Rewrite slash commands (/orchestrate, /review-code)
 * 4. Replace product references (Claude Code -> CLI name)
 * 5. Strip internal import references (@ptah-extension/)
 */
export function transformAgentContent(
  content: string,
  cli: CliTarget,
  agentId: string,
  description: string
): string {
  let result = content;

  result = rewriteFrontmatter(result, cli, agentId, description);
  result = rewriteToolReferences(result, cli);
  result = rewriteSlashCommands(result, cli);
  result = rewriteProductReferences(result, cli);
  result = stripInternalReferences(result);

  return result;
}

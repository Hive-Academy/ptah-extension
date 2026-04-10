/**
 * Agent Transform Rules
 * TASK_2025_160: Shared transformation rules and regex patterns
 *
 * Used by both CopilotAgentTransformer and GeminiAgentTransformer.
 * Extracts common rewrite logic to avoid duplication.
 *
 * Design: Pure functions with no I/O or DI dependencies.
 *
 * IMPORTANT: All regex patterns are created inside function calls
 * (not module-level constants) to avoid global regex statefulness issues.
 * Global regexes with /g flag have a mutable `lastIndex` property that
 * can cause intermittent failures when reused across calls.
 */

import { basename, parse } from 'path';
import type { CliTarget } from '@ptah-extension/shared';

// ========================================
// Claude-Specific Content Patterns
// ========================================

/**
 * Factory functions for regex patterns detecting Claude-specific content.
 * Returns fresh regex instances on each call to avoid global regex
 * statefulness issues (lastIndex mutation with /g flag).
 */
function createClaudePatterns() {
  return {
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
    skillTool: /Skill\s+tool\s+(?:to\s+)?invoke/gi,
  };
}

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
  codex: {
    askUser: 'ask the user directly in your response',
    taskDelegate: 'codex exec',
    slashPrefix: 'codex',
    productName: 'Codex CLI',
  },
  cursor: {
    askUser: 'ask the user directly in your response',
    taskDelegate: 'cursor agent --agent',
    slashPrefix: 'cursor',
    productName: 'Cursor Agent CLI',
  },
};

// ========================================
// Shared Utilities
// ========================================

/**
 * Extract agent ID from file path using Node.js path utilities.
 * Cross-platform safe — handles both forward and backslash separators.
 *
 * Examples:
 * - '.claude/agents/backend-developer.md' -> 'backend-developer'
 * - 'D:\\workspace\\.claude\\agents\\backend-developer.md' -> 'backend-developer'
 * - '/path/to/.claude/agents/frontend-developer.md' -> 'frontend-developer'
 */
export function extractAgentId(filePath: string): string {
  return parse(basename(filePath)).name;
}

/**
 * Normalize CRLF line endings to LF for reliable regex matching.
 */
function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

// ========================================
// Transform Functions
// ========================================

/**
 * Strip lines containing @ptah-extension/ internal references.
 * These are TypeScript import paths that have no meaning in CLI agents.
 */
export function stripInternalReferences(content: string): string {
  const patterns = createClaudePatterns();
  return content.replace(patterns.internalImport, '').replace(
    // Clean up consecutive blank lines left by stripping
    /\n{3,}/g,
    '\n\n',
  );
}

/**
 * Rewrite YAML frontmatter for the target CLI.
 *
 * Keeps `name` and `description` fields (used by all CLIs).
 * Both Copilot and Gemini use the same frontmatter format:
 * ```yaml
 * ---
 * name: agent-name
 * description: Agent description
 * ---
 * ```
 *
 * Normalizes CRLF line endings before regex matching for Windows compatibility.
 */
export function rewriteFrontmatter(
  content: string,
  cli: CliTarget,
  agentId: string,
  description: string,
): string {
  // Normalize CRLF for reliable regex on Windows
  const normalized = normalizeCrlf(content);

  // Prefix agent name for cleanup identification
  const prefixedName = `ptah-${agentId}`;

  // Match existing frontmatter
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    // No frontmatter, add one
    return `---\nname: ${prefixedName}\ndescription: ${description}\nsource: ptah\ntarget-cli: ${cli}\n---\n\n${normalized}`;
  }

  // Rebuild frontmatter with name, description, and source tracking
  const newFrontmatter = `---\nname: ${prefixedName}\ndescription: ${description}\nsource: ptah\ntarget-cli: ${cli}\n---`;
  return normalized.replace(frontmatterMatch[0], newFrontmatter);
}

/**
 * Rewrite tool references for the target CLI.
 *
 * Replaces Claude-specific tool references with CLI equivalents:
 * - AskUserQuestion -> CLI-specific questioning pattern
 * - Task tool -> CLI subagent invocation
 * - Skill tool -> CLI skill invocation
 */
export function rewriteToolReferences(content: string, cli: CliTarget): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  const patterns = createClaudePatterns();
  let result = content;

  // Replace AskUserQuestion references
  result = result.replace(patterns.askUserQuestion, mapping.askUser);

  // Replace Task(subagent_type='name' ...) invocation pattern
  result = result.replace(
    patterns.taskToolInvocation,
    `${mapping.taskDelegate} $1`,
  );

  // Replace "Task tool to" references
  result = result.replace(patterns.taskTool, `${mapping.taskDelegate} `);

  // Replace Skill tool references
  result = result.replace(patterns.skillTool, `${mapping.slashPrefix} skill `);

  return result;
}

/**
 * Rewrite slash command references for the target CLI.
 *
 * Replaces Claude-specific slash commands:
 * - /orchestrate -> copilot orchestrate / gemini orchestrate
 * - /review-code -> copilot review-code / gemini review-code
 */
export function rewriteSlashCommands(content: string, cli: CliTarget): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  const patterns = createClaudePatterns();

  return content.replace(patterns.slashCommand, (match) => {
    // Extract command name (strip leading /)
    const commandName = match.substring(1);
    return `${mapping.slashPrefix} ${commandName}`;
  });
}

/**
 * Replace Claude-specific product references with CLI-appropriate ones.
 */
export function rewriteProductReferences(
  content: string,
  cli: CliTarget,
): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  const patterns = createClaudePatterns();
  return content.replace(patterns.claudeSpecificDirective, mapping.productName);
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
  description: string,
): string {
  let result = content;

  result = rewriteFrontmatter(result, cli, agentId, description);
  result = rewriteToolReferences(result, cli);
  result = rewriteSlashCommands(result, cli);
  result = rewriteProductReferences(result, cli);
  result = stripInternalReferences(result);

  return result;
}

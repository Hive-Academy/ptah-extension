/**
 * Agent Transform Rules
 *
 * Shared transformation rules and regex patterns.
 * Used by CopilotAgentTransformer.
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
  // Antigravity (agy) shares Codex's `.agents` root and has no slash-command
  // surface; not a registered MultiCliAgentWriterService transform target, so
  // these values are only exercised if agy is ever wired for agent transforms.
  antigravity: {
    askUser: 'ask the user directly in your response',
    taskDelegate: 'agy exec',
    slashPrefix: 'agy',
    productName: 'Antigravity CLI',
  },
};

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
  // Normalize Windows backslash separators to forward slashes first. On POSIX
  // (CI runners) `basename`/`parse` don't treat `\` as a separator, so a
  // Windows-style path would otherwise return the whole string as the "name".
  const normalized = filePath.replace(/\\/g, '/');
  return parse(basename(normalized)).name;
}

/**
 * Normalize CRLF line endings to LF for reliable regex matching.
 */
function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Strip lines containing @ptah-extension/ internal references.
 * These are TypeScript import paths that have no meaning in CLI agents.
 */
export function stripInternalReferences(content: string): string {
  const patterns = createClaudePatterns();
  return content
    .replace(patterns.internalImport, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Unescape a YAML double-quoted scalar body.
 * Handles the escape sequences the orchestrator can emit (`\"`, `\\`, plus
 * the standard `\n`/`\t`/`\r`/`\/`). Unknown escapes drop the backslash.
 */
function unescapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_match, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      default:
        return ch;
    }
  });
}

/**
 * Unescape a YAML single-quoted scalar body (`''` -> `'`).
 */
function unescapeYamlSingleQuoted(value: string): string {
  return value.replace(/''/g, "'");
}

/**
 * Extract and properly unquote the `description` field from agent frontmatter.
 *
 * The orchestrator writes `description: "..."` as a YAML double-quoted scalar
 * (with inner quotes escaped as `\"`). Reading the raw line value preserves the
 * surrounding quotes and leaks them into downstream formats (e.g. Codex TOML,
 * where `tomlBasicString` then escapes them again into `\"...\"`). This parser
 * strips the YAML quoting and unescapes the body so consumers receive the plain
 * string.
 *
 * Returns `undefined` when no frontmatter or no `description` field is present,
 * so callers can fall back to a default.
 */
export function extractFrontmatterDescription(
  content: string,
): string | undefined {
  const normalized = normalizeCrlf(content);
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return undefined;
  }
  const descriptionMatch = /^description:\s*(.*)$/m.exec(frontmatterMatch[1]);
  if (!descriptionMatch) {
    return undefined;
  }
  const raw = descriptionMatch[1].trim();
  if (raw === '') {
    return undefined;
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return unescapeYamlDoubleQuoted(raw.slice(1, -1)).trim();
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return unescapeYamlSingleQuoted(raw.slice(1, -1)).trim();
  }
  return raw;
}

/**
 * Quote a string as a YAML double-quoted scalar.
 * Escapes backslashes and double-quotes and collapses newlines to spaces so
 * the emitted `description: "..."` is valid YAML regardless of the value's
 * content (colons, quotes, apostrophes, etc. are all safe inside quotes).
 */
export function yamlDoubleQuoted(value: string): string {
  const safe = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ');
  return `"${safe}"`;
}

/**
 * Resolve the description for a CLI-transformed agent.
 *
 * The frontmatter is the source of truth (the orchestrator writes the real
 * description there as a YAML-quoted scalar). Producers may also pass a
 * pre-parsed `variables.description`; we fall back to it, then to a default.
 * Reading from the frontmatter guarantees the unquoted, unescaped value
 * reaches every CLI format (Codex TOML, Copilot/Cursor YAML) and fixes paths
 * where the producer omits `variables.description` entirely.
 */
export function resolveAgentDescription(
  content: string,
  variables: Record<string, string> | undefined,
  agentId: string,
): string {
  return (
    extractFrontmatterDescription(content) ??
    variables?.['description'] ??
    `${agentId} agent`
  );
}

/**
 * Strip the leading YAML frontmatter block from agent content.
 * Returns the body only — used by targets (e.g. Codex TOML) that carry
 * name/description in their own structured format instead of frontmatter.
 */
export function stripFrontmatter(content: string): string {
  const normalized = normalizeCrlf(content);
  const match = normalized.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? normalized.slice(match[0].length) : normalized;
}

/**
 * Rewrite YAML frontmatter for the target CLI.
 *
 * Keeps `name` and `description` fields (used by all CLIs).
 * All target CLIs use the same frontmatter format:
 * ```yaml
 * ---
 * name: agent-name
 * description: "Agent description"
 * ---
 * ```
 *
 * The description is emitted as a YAML double-quoted scalar so values
 * containing colons, apostrophes, or embedded quotes stay valid YAML.
 *
 * Normalizes CRLF line endings before regex matching for Windows compatibility.
 */
export function rewriteFrontmatter(
  content: string,
  cli: CliTarget,
  agentId: string,
  description: string,
): string {
  const quotedDescription = yamlDoubleQuoted(description);
  const normalized = normalizeCrlf(content);
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return `---\nname: ${agentId}\ndescription: ${quotedDescription}\nsource: ptah\ntarget-cli: ${cli}\n---\n\n${normalized}`;
  }
  const newFrontmatter = `---\nname: ${agentId}\ndescription: ${quotedDescription}\nsource: ptah\ntarget-cli: ${cli}\n---`;
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
  result = result.replace(patterns.askUserQuestion, mapping.askUser);
  result = result.replace(
    patterns.taskToolInvocation,
    `${mapping.taskDelegate} $1`,
  );
  result = result.replace(patterns.taskTool, `${mapping.taskDelegate} `);
  result = result.replace(patterns.skillTool, `${mapping.slashPrefix} skill `);

  return result;
}

/**
 * Rewrite slash command references for the target CLI.
 *
 * Replaces Claude-specific slash commands:
 * - /orchestrate -> copilot orchestrate
 * - /review-code -> copilot review-code
 */
export function rewriteSlashCommands(content: string, cli: CliTarget): string {
  const mapping = CLI_TOOL_MAPPINGS[cli];
  const patterns = createClaudePatterns();

  return content.replace(patterns.slashCommand, (match) => {
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

/**
 * Transform an agent's body (no frontmatter) for a target CLI.
 *
 * Same rewrite rules as {@link transformAgentContent} minus the frontmatter
 * step — for targets that store name/description structurally (e.g. Codex
 * subagent TOML `developer_instructions`).
 */
export function transformAgentBody(content: string, cli: CliTarget): string {
  let result = stripFrontmatter(content);
  result = rewriteToolReferences(result, cli);
  result = rewriteSlashCommands(result, cli);
  result = rewriteProductReferences(result, cli);
  result = stripInternalReferences(result);
  return result.trim();
}

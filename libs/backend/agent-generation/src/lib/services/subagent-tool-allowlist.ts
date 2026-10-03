/**
 * Per-agent-type tool deny list written into generated Claude agent frontmatter
 * as `disallowedTools:` (TASK_2026_597 N3).
 *
 * Every tool a subagent can see is paid for in its start prefix, on every
 * spawn. A reviewer or a planner never drives a browser or scrapes the web, so
 * those tool definitions are dead weight in its context.
 *
 * The entry forms are the ones the pinned Claude Code runtime (2.1.278, shipped
 * with `@anthropic-ai/claude-agent-sdk` 0.3.278) matches for filesystem agents:
 *
 * - an exact tool name (`mcp__ptah__ptah_browser_navigate`);
 * - a server-level spec (`mcp__firecrawl`), which removes every tool of that
 *   server.
 *
 * A partial wildcard such as `mcp__ptah__ptah_browser_*` is NOT matched by that
 * runtime (only a bare server or `mcp__server__*` is server-level), so the
 * browser tools are listed one by one. A bare `*` in the list makes the runtime
 * drop the whole list, so it must never appear here.
 *
 * Only Claude agent files carry this line: the Codex / OpenCode / Copilot
 * transforms rebuild frontmatter from `name` and `description` alone, where
 * Claude tool names would not apply.
 */

import { PTAH_MCP_SERVER_NAME } from '@ptah-extension/shared';

const PTAH_TOOL_PREFIX = `mcp__${PTAH_MCP_SERVER_NAME}__`;

/** Every browser tool the Ptah MCP server exposes, by full name. */
export const PTAH_BROWSER_TOOLS: readonly string[] = [
  'ptah_browser_navigate',
  'ptah_browser_screenshot',
  'ptah_browser_evaluate',
  'ptah_browser_click',
  'ptah_browser_type',
  'ptah_browser_content',
  'ptah_browser_network',
  'ptah_browser_close',
  'ptah_browser_status',
  'ptah_browser_record_start',
  'ptah_browser_record_stop',
].map((tool) => `${PTAH_TOOL_PREFIX}${tool}`);

/** Web-scrape MCP servers, denied at server level. */
export const WEB_SCRAPE_SERVERS: readonly string[] = ['mcp__firecrawl'];

/** Web-search tools that are not already covered by a scrape server. */
export const WEB_SEARCH_TOOLS: readonly string[] = [
  `${PTAH_TOOL_PREFIX}ptah_web_search`,
];

const NO_BROWSER_NO_WEB: readonly string[] = [
  ...WEB_SCRAPE_SERVERS,
  ...WEB_SEARCH_TOOLS,
  ...PTAH_BROWSER_TOOLS,
];

const NO_WEB_SCRAPE: readonly string[] = [...WEB_SCRAPE_SERVERS];

/**
 * Deny list per agent type (the template `name`). An empty list means the type
 * keeps every tool: visual-reviewer needs the browser, researcher-expert needs
 * web search and scraping, video-director drives its own capture pipeline.
 */
export const SUBAGENT_DISALLOWED_TOOLS: Readonly<
  Record<string, readonly string[]>
> = {
  'code-logic-reviewer': NO_BROWSER_NO_WEB,
  'code-style-reviewer': NO_BROWSER_NO_WEB,
  'modernization-detector': NO_BROWSER_NO_WEB,
  'project-manager': NO_BROWSER_NO_WEB,
  'software-architect': NO_BROWSER_NO_WEB,
  'team-leader': NO_BROWSER_NO_WEB,
  'backend-developer': NO_WEB_SCRAPE,
  'frontend-developer': NO_WEB_SCRAPE,
  'devops-engineer': NO_WEB_SCRAPE,
  'senior-tester': NO_WEB_SCRAPE,
  'technical-content-writer': NO_WEB_SCRAPE,
  'ui-ux-designer': NO_WEB_SCRAPE,
  'visual-reviewer': [],
  'researcher-expert': [],
  'video-director': [],
};

/**
 * Deny list for one agent type. An unknown type (a custom or user-authored
 * template) gets no restriction.
 */
export function getSubagentDisallowedTools(
  agentType: string,
): readonly string[] {
  return Object.prototype.hasOwnProperty.call(
    SUBAGENT_DISALLOWED_TOOLS,
    agentType,
  )
    ? SUBAGENT_DISALLOWED_TOOLS[agentType]
    : [];
}

/**
 * The `disallowedTools:` frontmatter line for one agent type, or `undefined`
 * when the type keeps every tool. The runtime splits a string value on commas
 * and spaces, so one comma-separated line is enough.
 */
export function formatDisallowedToolsFrontmatter(
  agentType: string,
): string | undefined {
  const tools = getSubagentDisallowedTools(agentType);
  return tools.length > 0 ? `disallowedTools: ${tools.join(', ')}` : undefined;
}

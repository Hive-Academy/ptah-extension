/**
 * Agent, Ptah CLI & Skills RPC Type Definitions
 *
 * Types for agent:*, ptahCli:*, skillsSh:* methods
 */

import { z } from 'zod';
import type { PtahCliSummary } from '../ptah-cli.types';
import type { AgentPermissionDecision } from '../agent-permission.types';

/** A skill entry from skills.sh search/browse results */
export interface SkillShEntry {
  /** Repository source, e.g. "vercel-labs/skills" */
  source: string;
  /** Skill identifier within the repo, e.g. "find-skills" */
  skillId: string;
  /** Human-readable display name */
  name: string;
  /** Short description of what the skill does */
  description: string;
  /** Number of installs (from skills.sh directory) */
  installs: number;
  /** Whether this skill is currently installed locally */
  isInstalled: boolean;
  /** Skills.sh canonical id (only set when fetched from API). */
  id?: string;
  /** Slug as exposed by the API. */
  slug?: string;
  /** Source type, e.g. "github" or "well-known" (API only). */
  sourceType?: string;
  /** Public marketing URL on skills.sh (API only). */
  url?: string;
  /** Direct install URL on skills.sh (API only, may be absent). */
  installUrl?: string;
}

/**
 * An installed skills.sh skill, as reported from its Ptah-owned source root.
 *
 * `SkillAgentTarget` used to live here as the element type of a
 * `skillsSh:install` parameter that nothing ever read. It is deleted rather
 * than wired: see the `skillsSh:install` contract in `rpc.types.ts`.
 */
export interface InstalledSkill {
  /** Directory slug under the source root's `skills/`. */
  name: string;
  /** Skill description from SKILL.md frontmatter */
  description: string;
  /** Repository source (owner/repo) or "local" */
  source: string;
  /** Absolute path to the skill directory INSIDE the source root. */
  path: string;
  /**
   * Always `'global'`, and typed as the literal rather than the old
   * `'project' | 'global'` union.
   *
   * A source root lives in `~/.ptah/plugins`, which is user-global; there is no
   * project-scoped source root in the reconciler's model. The field is kept on
   * the wire because it describes where the skill LIVES, which is a real fact,
   * unlike the install parameter it replaced — but a union whose second member
   * can never be produced is a lie that every consumer has to branch on. The
   * literal is what makes a leftover `scope === 'project'` filter a compile
   * error instead of a section that silently never renders.
   */
  scope: 'global';
  /**
   * Always empty. Which CLIs currently hold a copy is a question about
   * PROPAGATION, and `harness:health` / `ptah harness doctor` is the one
   * surface that answers it — re-deriving the target × facet matrix here would
   * be a second copy of a rule `harness-sync` owns.
   */
  agents: string[];
}

/** Result of workspace skill detection */
export interface SkillDetectionResult {
  /** Technologies detected in the workspace */
  detectedTechnologies: {
    frameworks: string[];
    languages: string[];
    tools: string[];
  };
  /** Recommended skills from skills.sh based on detection */
  recommendedSkills: SkillShEntry[];
}

/**
 * Values of the `agentOrchestration.subagentPromptCacheTtl` setting.
 * `'auto'` = 1h when the session can spawn subagents, otherwise the SDK default (5m).
 */
export const SUBAGENT_PROMPT_CACHE_TTL_SETTINGS = ['auto', '5m', '1h'] as const;

/** A value of the `agentOrchestration.subagentPromptCacheTtl` setting. */
export type SubagentPromptCacheTtlSetting =
  (typeof SUBAGENT_PROMPT_CACHE_TTL_SETTINGS)[number];

/** A concrete prompt-cache TTL, as `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` takes it. */
export type SubagentPromptCacheTtl = '5m' | '1h';

/** What the host env var holds when set: a valid TTL, or `'invalid'` for any other value. */
export type SubagentPromptCacheTtlEnvOverride =
  SubagentPromptCacheTtl | 'invalid';

/** Agent orchestration configuration for settings UI */
export interface AgentOrchestrationConfig {
  /** Detected CLI agents (Codex, Copilot) */
  detectedClis: import('../agent-process.types').CliDetectionResult[];
  /** User's preferred agent order for spawning. First available agent is used. Includes both CLI types and Ptah CLI IDs. */
  preferredAgentOrder: string[];
  /** Maximum concurrent agents (1-10) */
  maxConcurrentAgents: number;
  /** Per-CLI model: Codex model (empty string = CLI default) */
  codexModel: string;
  /** Per-CLI model: Copilot model (empty string = default) */
  copilotModel: string;
  /** Per-CLI model: Cursor model (empty string = SDK default) */
  cursorModel: string;
  /** Per-CLI model: Antigravity model (empty string = SDK default). No reasoning-effort control — effort is baked into agy's model labels. */
  antigravityModel?: string;
  /** Per-CLI model: Grok model (empty string = CLI default). No per-CLI reasoning-effort setting. */
  grokModel?: string;
  /** Per-CLI model: opencode model (empty string = CLI default). Format is `provider/model`, e.g. `anthropic/claude-sonnet-4-5`. */
  opencodeModel?: string;
  /** Per-CLI model: Pi model (empty string = CLI default). Format is `provider/model`, e.g. `openai/gpt-4o`. */
  piModel?: string;
  /** Whether a Cursor API key is configured (CURSOR_API_KEY or secrets store entry ptah.auth.provider.cursor). The raw key is never returned to the UI. */
  cursorApiKeyConfigured: boolean;
  /** Whether a Cursor API key is present in the secrets store (ptah.auth.provider.cursor), regardless of CURSOR_API_KEY. The raw key is never returned to the UI. */
  cursorApiKeyStored: boolean;
  /** Whether the CURSOR_API_KEY environment variable is set to a non-blank value. The env var takes precedence over the stored key at resolution time. */
  cursorApiKeyEnvSet: boolean;
  /** Codex reasoning effort (empty string = SDK default) */
  codexReasoningEffort: string;
  /** Copilot reasoning effort (empty string = SDK default) */
  copilotReasoningEffort: string;
  /** Grok reasoning effort mapped to its `reasoning_effort` session option. */
  grokReasoningEffort?: string;
  /** Antigravity reasoning effort mapped to `agy --effort`. */
  antigravityReasoningEffort?: string;
  /** Pi reasoning effort mapped to `--thinking` (empty string = CLI default). Scale: off|minimal|low|medium|high|xhigh|max. */
  piReasoningEffort?: string;
  /** @deprecated Codex always runs in full-auto headless mode. Kept for backward compat. */
  codexAutoApprove: boolean;
  /** Codex lane `model_auto_compact_token_limit` (integer >= 0; 0 = Codex runtime default). Default: `FILE_BASED_SETTINGS_DEFAULTS`. */
  codexAutoCompactTokens?: number;
  /** Codex lane `tool_output_token_limit` (integer >= 0; 0 = Codex runtime default). Default: `FILE_BASED_SETTINGS_DEFAULTS`. */
  codexToolOutputTokenLimit?: number;
  /** Lane tool-call count at which the lane is steered. Default: `FILE_BASED_SETTINGS_DEFAULTS`. */
  laneToolCallSteerAt?: number;
  /** Lane tool-call count at which the lane is stopped. Default: `FILE_BASED_SETTINGS_DEFAULTS`. */
  laneToolCallStopAt?: number;
  /** Count of identical lane tool calls at which the lane is stopped. Default: `FILE_BASED_SETTINGS_DEFAULTS`. */
  laneRepeatCallStopAt?: number;
  /** Codex lane web search (`web_search` "live" when true, "disabled" when false; default true). */
  codexWebSearch?: boolean;
  /** Subagent prompt-cache TTL setting (default 'auto'). */
  subagentPromptCacheTtl?: SubagentPromptCacheTtlSetting;
  /** Value of the host's `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` env var when set; it overrides the setting. Absent when unset. */
  subagentPromptCacheTtlEnvOverride?: SubagentPromptCacheTtlEnvOverride;
  /** Auto-approve all Copilot tool calls without user prompt (default: true) */
  copilotAutoApprove: boolean;
  /** MCP server port (default: 51820) */
  mcpPort: number;
  /** CLI types that are disabled by the user (e.g., ['copilot']). Empty array means all enabled. */
  disabledClis: string[];
  /** MCP tool namespace groups disabled by the user (e.g., ['browser', 'git']). Empty array means all enabled. */
  disabledMcpNamespaces: string[];
  /** Whether the browser automation tools can navigate to localhost URLs (default: false) */
  browserAllowLocalhost: boolean;
  /** Kill switch for built-in SDK workflows (e.g. ultracode/workflow keywords). Default false = workflows ON. */
  workflowsDisabled: boolean;
}

/** CLI model option for agent:listCliModels */
export interface CliModelOption {
  readonly id: string;
  readonly name: string;
  /** When true, this model came from a hardcoded fallback list (API was unreachable). */
  readonly isFallback?: boolean;
}

/** Response from agent:listCliModels RPC method */
export interface AgentListCliModelsResult {
  codex: CliModelOption[];
  copilot: CliModelOption[];
  cursor: CliModelOption[];
  antigravity: CliModelOption[];
  opencode: CliModelOption[];
  pi: CliModelOption[];
  grok: CliModelOption[];
}

/**
 * Reasoning-effort values `agent:setConfig` accepts for Codex / Copilot
 * (`mapEffortToCli` allowlist in `lane-spawn-policy.ts`). `''` = CLI default.
 * `'inherit'` = use the chat session's effort for the lane. No `'minimal'`:
 * newer OpenAI models reject it (their floor is `'none'`).
 */
export const CLI_REASONING_EFFORT_VALUES = [
  '',
  'inherit',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

/**
 * Reasoning-effort values `agent:setConfig` accepts for Pi. Passed raw to
 * `pi --thinking`, so the host must reject anything else. `''` = CLI default.
 * `'inherit'` = use the chat session's effort; the spawn path must resolve it
 * and never pass it to `--thinking` raw.
 */
export const PI_REASONING_EFFORT_VALUES = [
  '',
  'inherit',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** Parameters for agent:setConfig RPC method */
export interface AgentSetConfigParams {
  /** User's preferred agent order for spawning. First available agent is used. Includes both CLI types and Ptah CLI IDs. */
  preferredAgentOrder?: string[];
  /** Maximum concurrent agents (1-10) */
  maxConcurrentAgents?: number;
  /** Codex model override (empty string = CLI default) */
  codexModel?: string;
  /** Copilot model override (empty string = default) */
  copilotModel?: string;
  /** Cursor model override (empty string = SDK default) */
  cursorModel?: string;
  /** Antigravity model override (empty string = SDK default). No reasoning-effort control — effort is baked into agy's model labels. */
  antigravityModel?: string;
  /** Grok model override (empty string = CLI default). No per-CLI reasoning-effort setting. */
  grokModel?: string;
  /** opencode model override (empty string = CLI default). Format is `provider/model`. */
  opencodeModel?: string;
  /** Pi model override (empty string = CLI default). Format is `provider/model`. */
  piModel?: string;
  /** Cursor API key. Written to the secrets store as ptah.auth.provider.cursor. Empty string clears it. */
  cursorApiKey?: string;
  /** @deprecated Codex always runs in full-auto headless mode. No-op, kept for backward compat. */
  codexAutoApprove?: boolean;
  /** Auto-approve all Copilot tool calls (default: true) */
  copilotAutoApprove?: boolean;
  /** Codex reasoning effort override */
  codexReasoningEffort?: string;
  /** Codex lane `model_auto_compact_token_limit` (integer >= 0; 0 = Codex runtime default). Rejected, never clamped, when invalid. */
  codexAutoCompactTokens?: number;
  /** Codex lane `tool_output_token_limit` (integer >= 0; 0 = Codex runtime default). Rejected, never clamped, when invalid. */
  codexToolOutputTokenLimit?: number;
  /** Lane tool-call count at which the lane is steered. Rejected, never clamped, when invalid. */
  laneToolCallSteerAt?: number;
  /** Lane tool-call count at which the lane is stopped. Rejected, never clamped, when invalid. */
  laneToolCallStopAt?: number;
  /** Count of identical lane tool calls at which the lane is stopped. Rejected, never clamped, when invalid. */
  laneRepeatCallStopAt?: number;
  /** Codex lane web search on/off. */
  codexWebSearch?: boolean;
  /** Subagent prompt-cache TTL setting. Rejected when outside `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS`. */
  subagentPromptCacheTtl?: SubagentPromptCacheTtlSetting;
  /** Copilot reasoning effort override */
  copilotReasoningEffort?: string;
  /** Grok reasoning effort override */
  grokReasoningEffort?: string;
  /** Antigravity reasoning effort override */
  antigravityReasoningEffort?: string;
  /** Pi reasoning effort override, mapped to `--thinking` (off|minimal|low|medium|high|xhigh|max) */
  piReasoningEffort?: string;
  /** MCP server port (1024-65535, default: 51820) */
  mcpPort?: number;
  /** CLI types to disable (e.g., ['copilot']). Empty array enables all. */
  disabledClis?: string[];
  /** MCP tool namespace groups to disable (e.g., ['browser', 'git']). Empty array enables all. */
  disabledMcpNamespaces?: string[];
  /** Whether the browser automation tools can navigate to localhost URLs */
  browserAllowLocalhost?: boolean;
  /** Kill switch for built-in SDK workflows. true disables workflows; false (default) leaves them ON. */
  workflowsDisabled?: boolean;
}

/**
 * Why `agent:continue` refused.
 *
 * The wire copy of `AgentContinueError`'s code in
 * `@ptah-extension/cli-agent-runtime`. Backend libs may not be imported from
 * here (this is the foundation layer), so the two unions are kept in step by
 * intent — a code added there and not here fails `agent-rpc.handlers.ts` at
 * compile time, which is the guard.
 */
export type AgentContinueErrorCode =
  | 'not_found'
  | 'unsupported'
  | 'busy'
  /**
   * The agent record is still live and still readable, but its CLI subprocess
   * was released after idling to free memory. In-process continuation is gone;
   * the conversation is not. Recover by resuming `cliSessionId` — the same
   * fallback `not_found` takes (TASK_2026_323 B11).
   */
  | 'released'
  | 'unknown';

/** Parameters for ptahCli:list RPC method */
export type PtahCliListParams = Record<string, never>;

/** Response from ptahCli:list RPC method */
export interface PtahCliListResult {
  agents: PtahCliSummary[];
}

/** Parameters for ptahCli:create RPC method */
export interface PtahCliCreateParams {
  name: string;
  providerId: string;
  apiKey: string;
}

/** Response from ptahCli:create RPC method */
export interface PtahCliCreateResult {
  success: boolean;
  agent?: PtahCliSummary;
  error?: string;
}

/** Parameters for ptahCli:update RPC method */
export interface PtahCliUpdateParams {
  id: string;
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  tierMappings?: {
    sonnet?: string;
    opus?: string;
    haiku?: string;
  };
  selectedModel?: string;
  reasoningEffort?: '' | PtahCliReasoningEffort;
}

/** The Claude Agent SDK's supported `query()` effort values for Ptah CLI instances. */
export const PtahCliReasoningEffortSchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type PtahCliReasoningEffort = z.infer<
  typeof PtahCliReasoningEffortSchema
>;
export const PtahCliReasoningEffortInputSchema = z.union([
  z.literal(''),
  PtahCliReasoningEffortSchema,
]);

/** Response from ptahCli:update RPC method */
export interface PtahCliUpdateResult {
  success: boolean;
  error?: string;
}

/** Parameters for ptahCli:delete RPC method */
export interface PtahCliDeleteParams {
  id: string;
}

/** Response from ptahCli:delete RPC method */
export interface PtahCliDeleteResult {
  success: boolean;
  error?: string;
}

/** Parameters for ptahCli:testConnection RPC method */
export interface PtahCliTestConnectionParams {
  id: string;
}

/** Response from ptahCli:testConnection RPC method */
export interface PtahCliTestConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/** Parameters for ptahCli:listModels RPC method */
export interface PtahCliListModelsParams {
  id: string;
}

/** Response from ptahCli:listModels RPC method */
export interface PtahCliListModelsResult {
  models: Array<{
    id: string;
    name: string;
    description?: string;
    contextLength?: number;
  }>;
  isStatic: boolean;
  error?: string;
}
export type { AgentPermissionDecision };

/**
 * Agent, Ptah CLI & Skills RPC Type Definitions
 *
 * Types for agent:*, ptahCli:*, skillsSh:* methods
 */

import type { PtahCliSummary } from '../ptah-cli.types';
import type { AgentPermissionDecision } from '../agent-permission.types';

// ============================================================
// Skills.sh Marketplace Types (TASK_2025_204)
// ============================================================

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
}

/** Supported agent targets for skills.sh installation */
export type SkillAgentTarget =
  | 'Claude Code'
  | 'GitHub Copilot'
  | 'OpenAI Codex'
  | 'Gemini CLI';

/** An installed skill detected on disk */
export interface InstalledSkill {
  /** Display name from SKILL.md frontmatter */
  name: string;
  /** Skill description from SKILL.md frontmatter */
  description: string;
  /** Repository source (owner/repo) or "local" */
  source: string;
  /** Absolute path to the skill directory */
  path: string;
  /** Installation scope */
  scope: 'project' | 'global';
  /** Agent names this skill is installed for */
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

// ============================================================
// Agent Orchestration RPC Types (TASK_2025_157)
// ============================================================

/** Agent orchestration configuration for settings UI */
export interface AgentOrchestrationConfig {
  /** Detected CLI agents (Gemini, Codex, Copilot) */
  detectedClis: import('../agent-process.types').CliDetectionResult[];
  /** User's preferred agent order for spawning. First available agent is used. Includes both CLI types and Ptah CLI IDs. */
  preferredAgentOrder: string[];
  /** Maximum concurrent agents (1-10) */
  maxConcurrentAgents: number;
  /** Per-CLI model: Gemini CLI model (empty string = CLI default) */
  geminiModel: string;
  /** Per-CLI model: Codex model (empty string = CLI default) */
  codexModel: string;
  /** Per-CLI model: Copilot model (empty string = default) */
  copilotModel: string;
  /** Codex reasoning effort (empty string = SDK default) */
  codexReasoningEffort: string;
  /** Copilot reasoning effort (empty string = SDK default) */
  copilotReasoningEffort: string;
  /** @deprecated Codex always runs in full-auto headless mode. Kept for backward compat. */
  codexAutoApprove: boolean;
  /** Auto-approve all Copilot tool calls without user prompt (default: true) */
  copilotAutoApprove: boolean;
  /** MCP server port (default: 51820) */
  mcpPort: number;
  /** CLI types that are disabled by the user (e.g., ['gemini', 'copilot']). Empty array means all enabled. */
  disabledClis: string[];
  /** MCP tool namespace groups disabled by the user (e.g., ['browser', 'git']). Empty array means all enabled. */
  disabledMcpNamespaces: string[];
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
  gemini: CliModelOption[];
  codex: CliModelOption[];
  copilot: CliModelOption[];
}

/** Parameters for agent:setConfig RPC method */
export interface AgentSetConfigParams {
  /** User's preferred agent order for spawning. First available agent is used. Includes both CLI types and Ptah CLI IDs. */
  preferredAgentOrder?: string[];
  /** Maximum concurrent agents (1-10) */
  maxConcurrentAgents?: number;
  /** Gemini CLI model override (empty string = CLI default) */
  geminiModel?: string;
  /** Codex model override (empty string = CLI default) */
  codexModel?: string;
  /** Copilot model override (empty string = default) */
  copilotModel?: string;
  /** @deprecated Codex always runs in full-auto headless mode. No-op, kept for backward compat. */
  codexAutoApprove?: boolean;
  /** Auto-approve all Copilot tool calls (default: true) */
  copilotAutoApprove?: boolean;
  /** Codex reasoning effort override */
  codexReasoningEffort?: string;
  /** Copilot reasoning effort override */
  copilotReasoningEffort?: string;
  /** MCP server port (1024-65535, default: 51820) */
  mcpPort?: number;
  /** CLI types to disable (e.g., ['gemini', 'copilot']). Empty array enables all. */
  disabledClis?: string[];
  /** MCP tool namespace groups to disable (e.g., ['browser', 'git']). Empty array enables all. */
  disabledMcpNamespaces?: string[];
}

// ============================================================
// Ptah CLI Agent RPC Types (TASK_2025_167 -> TASK_2025_170)
// ============================================================

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
}

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

// Re-export AgentPermissionDecision so the barrel can reference it
// without needing a separate import in the main rpc.types.ts
export type { AgentPermissionDecision };

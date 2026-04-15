/**
 * Harness Setup Builder RPC Types
 *
 * Defines the data model and RPC contracts for the Harness Setup Builder wizard.
 * The harness builder configures: agents, skills, system prompts, MCP servers, and CLAUDE.md.
 */

// ─── Data Model ──────────────────────────────────────────

/** Top-level harness configuration output */
export interface HarnessConfig {
  name: string;
  persona: PersonaDefinition;
  agents: HarnessAgentConfig;
  skills: HarnessSkillConfig;
  prompt: HarnessPromptConfig;
  mcp: HarnessMcpConfig;
  claudeMd: HarnessClaudeMdConfig;
  createdAt: string;
  updatedAt: string;
}

/** Persona definition describing the user's role and goals */
export interface PersonaDefinition {
  label: string;
  description: string;
  goals: string[];
  templateId?: string;
}

/** Agent configuration: which agents are enabled and their overrides */
export interface HarnessAgentConfig {
  enabledAgents: Record<string, AgentOverride>;
}

/** Per-agent override settings */
export interface AgentOverride {
  enabled: boolean;
  modelTier?: 'opus' | 'sonnet' | 'haiku';
  autoApprove?: boolean;
  customInstructions?: string;
}

/** Skill configuration: selected and newly created skills */
export interface HarnessSkillConfig {
  selectedSkills: string[];
  createdSkills: NewSkillDefinition[];
}

/** Definition for a skill created during the wizard flow */
export interface NewSkillDefinition {
  name: string;
  description: string;
  content: string;
  allowedTools?: string[];
}

/** System prompt configuration */
export interface HarnessPromptConfig {
  systemPrompt: string;
  enhancedSections: Record<string, string>;
}

/** MCP server configuration */
export interface HarnessMcpConfig {
  servers: McpServerEntry[];
  enabledTools: Record<string, string[]>;
}

/** MCP server entry */
export interface McpServerEntry {
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
}

/** CLAUDE.md generation configuration */
export interface HarnessClaudeMdConfig {
  generateProjectClaudeMd: boolean;
  customSections: Record<string, string>;
  previewContent: string;
}

// ─── Wizard Step Types ──────────────────────────────────

export type HarnessWizardStep =
  | 'persona'
  | 'agents'
  | 'skills'
  | 'prompts'
  | 'mcp'
  | 'review';

// ─── Skill Browser Types ────────────────────────────────

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'plugin' | 'custom';
  isActive: boolean;
}

// ─── Available Agent Info ───────────────────────────────

export interface AvailableAgent {
  id: string;
  name: string;
  description: string;
  type: 'cli' | 'subagent';
  available: boolean;
}

// ─── Harness Preset ─────────────────────────────────────

export interface HarnessPreset {
  id: string;
  name: string;
  description: string;
  config: HarnessConfig;
  createdAt: string;
}

// ─── RPC Request/Response Pairs ─────────────────────────

/** harness:initialize — Start a harness builder session */
export type HarnessInitializeParams = Record<string, never>;
export interface HarnessInitializeResponse {
  workspaceContext: {
    projectName: string;
    projectType: string;
    frameworks: string[];
    languages: string[];
  };
  availableAgents: AvailableAgent[];
  availableSkills: SkillSummary[];
  existingPresets: HarnessPreset[];
}

/** harness:suggest-config — AI-generate config from persona description */
export interface HarnessSuggestConfigParams {
  personaDescription: string;
  goals: string[];
}
export interface HarnessSuggestConfigResponse {
  suggestedAgents: Record<string, AgentOverride>;
  suggestedSkills: string[];
  suggestedPrompt: string;
  reasoning: string;
}

/** harness:search-skills — Search available skills */
export interface HarnessSearchSkillsParams {
  query: string;
}
export interface HarnessSearchSkillsResponse {
  results: SkillSummary[];
}

/** harness:create-skill — Create a new skill from wizard */
export interface HarnessCreateSkillParams {
  name: string;
  description: string;
  content: string;
  allowedTools?: string[];
}
export interface HarnessCreateSkillResponse {
  skillId: string;
  skillPath: string;
}

/** harness:discover-mcp — Discover available MCP servers */
export type HarnessDiscoverMcpParams = Record<string, never>;
export interface HarnessDiscoverMcpResponse {
  servers: McpServerEntry[];
}

/** harness:generate-prompt — AI-generate system prompt */
export interface HarnessGeneratePromptParams {
  persona: PersonaDefinition;
  enabledAgents: string[];
  selectedSkills: string[];
}
export interface HarnessGeneratePromptResponse {
  generatedPrompt: string;
  sections: Record<string, string>;
}

/** harness:generate-claude-md — Generate CLAUDE.md preview */
export interface HarnessGenerateClaudeMdParams {
  config: Omit<HarnessConfig, 'claudeMd' | 'createdAt' | 'updatedAt'>;
}
export interface HarnessGenerateClaudeMdResponse {
  content: string;
}

/** harness:apply — Apply the full harness config to workspace */
export interface HarnessApplyParams {
  config: HarnessConfig;
}
export interface HarnessApplyResponse {
  appliedPaths: string[];
  warnings: string[];
}

/** harness:save-preset — Save config as reusable preset */
export interface HarnessSavePresetParams {
  name: string;
  description: string;
  config: HarnessConfig;
}
export interface HarnessSavePresetResponse {
  presetId: string;
  presetPath: string;
}

/** harness:load-presets — List saved presets */
export type HarnessLoadPresetsParams = Record<string, never>;
export interface HarnessLoadPresetsResponse {
  presets: HarnessPreset[];
}

/** harness:chat — Step-contextual AI chat message */
export interface HarnessChatParams {
  step: HarnessWizardStep;
  message: string;
  context: Partial<HarnessConfig>;
}
export interface HarnessChatResponse {
  reply: string;
  suggestedActions?: HarnessChatAction[];
}

/** Action suggested by AI chat in the wizard */
export interface HarnessChatAction {
  type: 'toggle-agent' | 'add-skill' | 'update-prompt' | 'add-mcp-server';
  label: string;
  payload: Record<string, unknown>;
}

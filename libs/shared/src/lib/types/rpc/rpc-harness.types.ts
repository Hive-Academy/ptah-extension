/**
 * Harness Setup Builder RPC Types
 *
 * Defines the data model and RPC contracts for the Harness Setup Builder wizard.
 * The harness builder configures: agents, skills, system prompts, MCP servers, and CLAUDE.md.
 */

// ─── Common Types ────────────────────────────────────────

/** Workspace context describing the current project environment for harness operations */
export interface HarnessWorkspaceContext {
  projectName: string;
  projectType: string;
  frameworks: string[];
  languages: string[];
}

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
  /** Harness subagents designed by AI for the persona's workflow */
  harnessSubagents?: HarnessSubagentDefinition[];
}

/** Per-agent override settings */
export interface AgentOverride {
  enabled: boolean;
  modelTier?: 'opus' | 'sonnet' | 'haiku';
  autoApprove?: boolean;
  customInstructions?: string;
}

/** Harness subagent designed by AI for a specific workflow role */
export interface HarnessSubagentDefinition {
  /** Machine-readable ID (kebab-case) */
  id: string;
  /** Human-readable name (e.g., "Sentiment Watchdog") */
  name: string;
  /** What this subagent does */
  description: string;
  /** The specialized role/persona for this subagent */
  role: string;
  /** Tools this subagent should have access to */
  tools: string[];
  /** Whether this runs in background or on-demand */
  executionMode: 'background' | 'on-demand' | 'scheduled';
  /** Trigger conditions for when this subagent activates */
  triggers?: string[];
  /** Custom instructions for this subagent's behavior */
  instructions: string;
}

/** AI-generated skill specification (before writing to disk) */
export interface GeneratedSkillSpec {
  /** Skill name */
  name: string;
  /** What the skill does */
  description: string;
  /** Full markdown content for SKILL.md */
  content: string;
  /** Tools the skill requires */
  requiredTools?: string[];
  /** Why this skill was suggested for the persona */
  reasoning: string;
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

// ─── MCP Server Suggestion ──────────────────────────────

/** Suggested MCP server from persona-based AI suggestions */
export interface McpServerSuggestion {
  /** Search query to find this server in the MCP Registry */
  query: string;
  /** Human-readable display name */
  displayName: string;
  /** Why this server was suggested for the persona */
  reason: string;
}

// ─── Skill Browser Types ────────────────────────────────

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'plugin' | 'harness';
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
  workspaceContext: HarnessWorkspaceContext;
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
  suggestedMcpServers: McpServerSuggestion[];
  suggestedPrompt: string;
  reasoning: string;
  /** AI-designed harness subagent fleet for the persona */
  suggestedSubagents?: HarnessSubagentDefinition[];
  /** AI-generated skill specifications for the persona */
  suggestedSkillSpecs?: GeneratedSkillSpec[];
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
  outputFormat: string;
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
  type:
    | 'toggle-agent'
    | 'add-skill'
    | 'update-prompt'
    | 'add-mcp-server'
    | 'add-subagent'
    | 'create-skill';
  label: string;
  payload: Record<string, unknown>;
}

// ─── New Collaborative RPC Contracts ──────────────────

/** harness:design-agents — AI designs a custom subagent fleet for the persona */
export interface HarnessDesignAgentsParams {
  persona: PersonaDefinition;
  existingAgents: string[];
  workspaceContext?: HarnessWorkspaceContext;
}
export interface HarnessDesignAgentsResponse {
  subagents: HarnessSubagentDefinition[];
  reasoning: string;
}

/** harness:generate-skills — AI generates specialized skill specs for the persona */
export interface HarnessGenerateSkillsParams {
  persona: PersonaDefinition;
  existingSkills: string[];
  harnessSubagents?: HarnessSubagentDefinition[];
}
export interface HarnessGenerateSkillsResponse {
  skills: GeneratedSkillSpec[];
  reasoning: string;
}

/** harness:generate-document — Generate comprehensive PRD/requirements document */
export interface HarnessGenerateDocumentParams {
  config: HarnessConfig;
  workspaceContext?: HarnessWorkspaceContext;
}
export interface HarnessGenerateDocumentResponse {
  document: string;
  sections: Record<string, string>;
}

/** harness:analyze-intent — AI architects a complete harness from freeform input */
export interface HarnessAnalyzeIntentParams {
  /** Freeform text: a PRD, a simple instruction, a description — anything */
  input: string;
  /** Workspace context from initialization */
  workspaceContext?: HarnessWorkspaceContext;
}
export interface HarnessAnalyzeIntentResponse {
  /** AI-derived persona from the input */
  persona: PersonaDefinition;
  /** Suggested agent configuration */
  suggestedAgents: Record<string, AgentOverride>;
  /** Harness subagent fleet designed for the intent */
  suggestedSubagents: HarnessSubagentDefinition[];
  /** IDs of existing skills to select */
  suggestedSkills: string[];
  /** New skill specs to create */
  suggestedSkillSpecs: GeneratedSkillSpec[];
  /** Generated system prompt */
  suggestedPrompt: string;
  /** MCP server suggestions */
  suggestedMcpServers: McpServerSuggestion[];
  /** High-level summary of what the AI understood */
  summary: string;
  /** Detailed reasoning */
  reasoning: string;
}

// ─── Conversational Harness Types ───────────────────────

export interface HarnessConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** harness:converse — Send a message in the conversational harness builder */
export interface HarnessConverseParams {
  message: string;
  history: HarnessConversationMessage[];
  config: Partial<HarnessConfig>;
  workspaceContext?: HarnessWorkspaceContext;
}

export interface HarnessConverseResponse {
  reply: string;
  configUpdates?: Partial<HarnessConfig>;
  isConfigComplete?: boolean;
}

// ─── Harness Streaming Types ────────────────────────────

/** Operation types that can produce streaming events */
export type HarnessStreamOperation =
  | 'analyze-intent'
  | 'suggest-config'
  | 'design-agents'
  | 'generate-skills'
  | 'generate-document'
  | 'chat'
  | 'converse';

/** Streaming event payload broadcast from backend during harness operations */
export interface HarnessStreamPayload {
  /** Which operation produced this event */
  operation: HarnessStreamOperation;
  /** Unique operation instance ID (for correlating events) */
  operationId: string;
  /** Event kind matching SdkStreamProcessor's StreamEvent kinds */
  kind:
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_input'
    | 'tool_result'
    | 'error'
    | 'status';
  /** Text content (text output, thinking preview, error message, or status) */
  content: string;
  /** Tool name (for tool_start, tool_input, tool_result) */
  toolName?: string;
  /** Tool call ID (for correlating tool_start with tool_result) */
  toolCallId?: string;
  /** Whether this is an error result */
  isError?: boolean;
  /** Timestamp */
  timestamp: number;
}

/** Completion event sent when a harness operation finishes */
export interface HarnessStreamCompletePayload {
  /** Which operation completed */
  operation: HarnessStreamOperation;
  /** The operation instance ID */
  operationId: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: number;
}

/** Discriminated union for all harness streaming messages */
export type HarnessStreamMessage =
  | { type: 'harness:stream'; payload: HarnessStreamPayload }
  | { type: 'harness:stream-complete'; payload: HarnessStreamCompletePayload };

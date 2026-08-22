/**
 * Harness Setup Builder RPC Types
 *
 * Defines the data model and RPC contracts for the Harness Setup Builder wizard.
 * The harness builder configures: agents, skills, system prompts, MCP servers, and CLAUDE.md.
 */

import type { FlatStreamEventUnion } from '../execution';
import type { McpInstallTarget, McpServerConfig } from '../mcp-directory.types';
import type { StackProfileId } from '../stack-profile.types';

/** Workspace context describing the current project environment for harness operations */
export interface HarnessWorkspaceContext {
  projectName: string;
  projectType: string;
  frameworks: string[];
  languages: string[];
}

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
  /**
   * IDs of the skills the design selected. Kept as a plain `string[]` — it is
   * what CLAUDE.md, the system prompt, and the wizard surface render.
   */
  selectedSkills: string[];
  /**
   * Origin metadata for the entries in `selectedSkills`, used to actually
   * install marketplace skills when the harness is applied. Optional on
   * purpose: presets written before install support existed — and every
   * locally-discovered skill — carry only the ID. A selected skill without a
   * ref is still described in the generated CLAUDE.md; it is just never
   * installed from skills.sh.
   */
  selectedSkillRefs?: HarnessSkillRef[];
  createdSkills: NewSkillDefinition[];
}

/**
 * Where a selected skill came from, so `harness:apply` can install it.
 *
 * `installSource` is the `owner/repo` slug the skills.sh CLI needs
 * (`npx skills add <owner/repo> --skill <skillId>`). It is the field that the
 * search result carries and the bare `selectedSkills` ID throws away.
 *
 * `scope` (and its `HARNESS_DEFAULT_SKILL_SCOPE` default) used to live here and
 * is gone with TASK_2026_288. It chose between `{ws}/.claude/skills` and
 * `~/.claude/skills`; a skills.sh skill now lands in a user-global source root
 * under `~/.ptah/plugins` and is propagated from there, so the field named a
 * destination that no longer exists. Leaving it on the type would have kept a
 * knob the designing agent could set and nothing could honour.
 */
export interface HarnessSkillRef {
  /** Matches the corresponding entry in `HarnessSkillConfig.selectedSkills`. */
  skillId: string;
  /** Origin as reported by `ptah.harness.searchSkills`. */
  source: 'local' | 'skills.sh';
  /** `owner/repo` backing a skills.sh skill. Required to install it. */
  installSource?: string;
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
  /**
   * Transport config used to actually install the server when the harness is
   * applied. Optional on purpose: entries discovered from an existing workspace
   * mcp.json, and presets written before install support existed, carry only
   * the descriptive fields. An entry without a config is still described in the
   * generated CLAUDE.md — it is just never installed.
   */
  config?: McpServerConfig;
  /** Config key written into the target mcp.json. Defaults to `name`. */
  serverKey?: string;
  /** Where to install. Defaults to `['claude', 'vscode']`. */
  installTargets?: McpInstallTarget[];
}

/** Default install targets for a harness MCP entry that does not specify any. */
export const HARNESS_DEFAULT_MCP_TARGETS: McpInstallTarget[] = [
  'claude',
  'vscode',
];

/** CLAUDE.md generation configuration */
export interface HarnessClaudeMdConfig {
  generateProjectClaudeMd: boolean;
  customSections: Record<string, string>;
  previewContent: string;
}

/** Suggested MCP server from persona-based AI suggestions */
export interface McpServerSuggestion {
  /** Search query to find this server in the MCP Registry */
  query: string;
  /** Human-readable display name */
  displayName: string;
  /** Why this server was suggested for the persona */
  reason: string;
}

export interface SkillSummary {
  /** Existing bare skill slug, kept for native invocation and legacy consumers. */
  id: string;
  /** Stable source-qualified descriptor identity. */
  descriptorId: string;
  /** Native Skill-tool invocation name; derived from the local folder slug. */
  invocationName: string;
  name: string;
  description: string;
  /** Existing broad UI category, retained for compatibility. */
  source: 'builtin' | 'plugin' | 'harness';
  /** Precise source provenance for descriptor-aware consumers. */
  provenance: 'bundled' | 'harness' | 'external' | 'skillssh';
  /** Stable plugin/source root that supplied the descriptor. */
  sourceId: string;
  /** Whether the descriptor can be invoked in the current workspace. */
  invocability: 'invocable' | 'not-invocable' | 'unknown';
  isActive: boolean;
}

export interface AvailableAgent {
  id: string;
  name: string;
  description: string;
  type: 'cli' | 'subagent';
  available: boolean;
}

export interface HarnessPreset {
  id: string;
  name: string;
  description: string;
  config: HarnessConfig;
  createdAt: string;
}

/** harness:initialize — Start a harness builder session */
export type HarnessInitializeParams = Record<string, never>;
export interface HarnessInitializeResponse {
  workspaceContext: HarnessWorkspaceContext;
  availableAgents: AvailableAgent[];
  availableSkills: SkillSummary[];
  existingPresets: HarnessPreset[];
  /**
   * Absolute path of the workspace the backend resolved at initialize time,
   * or `null` when no workspace folder is open. The frontend PINS this value
   * so that a later `harness:apply` targets the workspace the build started in,
   * even if the user switches the active workspace mid-build (Electron).
   */
  workspaceRoot: string | null;
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
  /**
   * Optional pinned workspace root the config should be written into. When
   * omitted the backend falls back to the currently active workspace. Set by
   * the frontend to the root captured at `harness:initialize`, so file writes
   * land in the workspace the build started in rather than whichever workspace
   * happens to be active at apply time.
   */
  workspaceRoot?: string;
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

export interface HarnessConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Who the new project is being built for. */
export type NewProjectAudience = 'b2b' | 'b2c' | 'internal' | 'unsure';

/**
 * The platform question, asked BEFORE the stack question.
 *
 * Every entry except `other` is a {@link StackProfileId}, and the `satisfies`
 * clause makes that a compile-time fact rather than a comment — a typo here
 * fails the build. The reverse direction (every registered profile is
 * offerable) is a runtime assertion in `stack-profiles.spec.ts`, because a
 * missing member is not a type error.
 *
 * `other` is the escape hatch for a platform Ptah has no profile for. It
 * resolves to no profile at all rather than falling back to `node-ts`:
 * scaffolding an Nx/TypeScript workspace for someone who just said "none of
 * these" is worse than admitting we do not know the stack yet.
 */
export const NEW_PROJECT_PLATFORM_VALUES = [
  'node-ts',
  'dotnet',
  'python',
  'other',
] as const satisfies readonly (StackProfileId | 'other')[];

export type NewProjectPlatform = (typeof NEW_PROJECT_PLATFORM_VALUES)[number];

/**
 * Every stack chip value across every profile's `stackOptions`.
 *
 * Declared as one `as const` tuple rather than a hand-written union so the
 * TypeScript type and the Zod enum at the RPC boundary are literally the same
 * list — `harness-rpc.schema.ts` builds `z.enum` from this array, which is what
 * makes TS/Zod parity structural instead of a promise. `stack-profiles.spec.ts`
 * pins the other half: every value here is used by some profile, and every
 * profile's chips are listed here.
 *
 * `recommend` and `other` are platform-independent: the first defers the choice
 * to the agent, the second opens the free-text field.
 */
export const NEW_PROJECT_STACK_VALUES = [
  'recommend',
  'angular-nestjs',
  'react-nestjs',
  'aspnetcore-blazor',
  'aspnetcore-angular',
  'aspnetcore-api',
  'fastapi',
  'django',
  'flask',
  'other',
] as const;

/** Tech-stack preference expressed up front, before discovery runs. */
export type NewProjectStack = (typeof NEW_PROJECT_STACK_VALUES)[number];

/**
 * Narrow a chip value to the wire union.
 *
 * `StackOption.value` is a plain `string` — the registry is data and does not
 * know about this union — so the intake needs one real check on the way from a
 * rendered chip to a typed answer. This is that check, and it is why the
 * component needs no cast.
 */
export function isNewProjectStack(value: string): value is NewProjectStack {
  return (NEW_PROJECT_STACK_VALUES as readonly string[]).includes(value);
}

/**
 * Answers collected by the Setup Hub intake form BEFORE the agent starts.
 *
 * These become the first real user turn: the backend renders them verbatim
 * into the seed prompt so discovery never re-asks what the user already
 * told us, and the frontend renders a readable summary of the same object
 * as the first transcript bubble.
 */
export interface NewProjectIntake {
  /** "What are you building?" — required, freeform. */
  what: string;
  /** "Who is it for?" */
  audience: NewProjectAudience;
  /** "Must-haves / constraints" — optional, freeform. */
  constraints?: string;
  /**
   * Which platform the project targets, asked before {@link stack} because it
   * decides which stack chips exist.
   *
   * OPTIONAL, and absence means `node-ts`. Two reasons, and they are the same
   * reason: every client that predates this field meant Node/TypeScript, and
   * the intake omits the value when it IS `node-ts` so the payload an existing
   * user produces stays byte-identical to the one they produced before this
   * field existed.
   */
  platform?: NewProjectPlatform;
  /** Stack preference; `recommend` defers the choice to the agent. */
  stack: NewProjectStack;
  /** Free text captured when `stack === 'other'`. */
  stackOther?: string;
}

/** harness:start-new-project — hand the New Project flow off to the chat surface */
export interface HarnessStartNewProjectParams {
  intake: NewProjectIntake;
}
export interface HarnessStartNewProjectResult {
  success: boolean;
  error?: string;
}

/** harness:workflow-prompt — compose the seed prompt for an agent-driven harness workflow */
export interface HarnessWorkflowPromptParams {
  mode: 'configure-harness';
  intent: string;
}
export interface HarnessWorkflowPromptResponse {
  prompt: string;
}

/** Operation types that can produce streaming events */
export type HarnessStreamOperation =
  | 'analyze-intent'
  | 'suggest-config'
  | 'design-agents'
  | 'generate-skills'
  | 'generate-document';

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
export type HarnessStreamMessage = {
  type: 'harness:stream-complete';
  payload: HarnessStreamCompletePayload;
};

/** Flat stream event payload for real-time execution visualization in the harness builder */
export interface HarnessFlatStreamPayload {
  /** Unique operation instance ID (correlates events to a specific converse/analyze call) */
  operationId: string;
  /** The flat stream event for ExecutionNode tree building */
  event: FlatStreamEventUnion;
}

/** Completion event sent by the backend when a flat-stream operation finishes.
 *  Differs from HarnessStreamCompletePayload — no `operation` or `timestamp` fields. */
export interface HarnessFlatStreamCompletePayload {
  /** The operation instance ID that completed */
  operationId: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
}

import type { HarnessConfig } from '@ptah-extension/shared';
import type {
  HarnessHelperKind,
  HarnessHelperResult,
} from '../../services/harness-helper.service';
import {
  HarnessBuilderRecordsService,
  HARNESS_CHOICE_FIELDS,
  canonicalHarnessRoot,
  type HarnessUserSnapshot,
} from '../../services/harness-builder-records.service';
import {
  HarnessProposalHydrationService,
  mergeBuilderUpdates,
} from '../../services/harness-proposal-hydration.service';

export function workspaceName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace';
}

export function builderPreviewSummary(config: Partial<HarnessConfig>): string {
  const agents = Object.values(config.agents?.enabledAgents ?? {}).filter(
    (agent) => agent.enabled,
  ).length;
  const skills =
    (config.skills?.selectedSkills?.length ?? 0) +
    (config.skills?.createdSkills?.length ?? 0);
  return `${agents} agents, ${skills} skills`;
}

export function fullConfig(
  config: Partial<HarnessConfig>,
  root: string,
): HarnessConfig {
  const c = config;
  const now = new Date().toISOString();
  return {
    name: c.name?.trim() || workspaceName(root),
    persona: c.persona ?? { label: '', description: '', goals: [] },
    agents: {
      enabledAgents: c.agents?.enabledAgents ?? {},
      harnessSubagents: c.agents?.harnessSubagents ?? [],
    },
    skills: {
      selectedSkills: c.skills?.selectedSkills ?? [],
      selectedSkillRefs: c.skills?.selectedSkillRefs ?? [],
      createdSkills: c.skills?.createdSkills ?? [],
    },
    prompt: {
      systemPrompt: c.prompt?.systemPrompt ?? '',
      enhancedSections: c.prompt?.enhancedSections ?? {},
    },
    mcp: {
      servers: c.mcp?.servers ?? [],
      enabledTools: c.mcp?.enabledTools ?? {},
    },
    claudeMd: {
      generateProjectClaudeMd: c.claudeMd?.generateProjectClaudeMd ?? true,
      customSections: c.claudeMd?.customSections ?? {},
      previewContent: c.claudeMd?.previewContent ?? '',
    },
    createdAt: c.createdAt ?? now,
    updatedAt: now,
  };
}
export function commitBuilderUpdates(
  records: HarnessBuilderRecordsService,
  hydration: HarnessProposalHydrationService,
  workspaceRoot: string,
  tabId: string,
  preview: Partial<HarnessConfig>,
  updates: Partial<HarnessConfig>,
): void {
  const root = canonicalHarnessRoot(workspaceRoot);
  if (!root || !tabId) throw new Error('Builder session is unavailable');
  const old = records.readSnapshot(root, tabId);
  const merged = mergeBuilderUpdates(preview, updates);
  const at = new Date().toISOString();
  const fields: HarnessUserSnapshot['fields'] = { ...old?.fields };
  for (const field of HARNESS_CHOICE_FIELDS)
    if (updates[field] !== undefined)
      fields[field] = { source: 'user', chosenAt: at, updatedAt: at };
  const selected: Partial<HarnessConfig> = {};
  for (const field of HARNESS_CHOICE_FIELDS)
    if (fields[field] && merged[field] !== undefined)
      Object.assign(selected, { [field]: merged[field] });
  const snapshot: HarnessUserSnapshot = {
    version: 1,
    workspaceRoot: root,
    tabId,
    configUpdates: selected,
    fields,
    ...(old?.lastApplied ? { lastApplied: old.lastApplied } : {}),
  };
  if (!records.writeSnapshot(snapshot))
    throw new Error('Could not save preview choice');
  hydration.setSnapshot(snapshot);
}

export const HELPERS: readonly {
  kind: HarnessHelperKind;
  title: string;
  description: string;
}[] = [
  {
    kind: 'suggest-config',
    title: 'Suggest from persona',
    description: 'Agents, skills, MCP servers and a prompt',
  },
  {
    kind: 'analyze-intent',
    title: 'Analyze intent',
    description: 'Turn a description or PRD into a full blueprint',
  },
  {
    kind: 'design-agents',
    title: 'Design subagents',
    description: 'A custom subagent fleet for the persona',
  },
  {
    kind: 'generate-skills',
    title: 'Generate skill specs',
    description: 'Specialised skills for the persona',
  },
  {
    kind: 'generate-document',
    title: 'Generate document',
    description: 'A requirements document from the preview',
  },
  {
    kind: 'discover-mcp',
    title: 'MCP suggestions',
    description: 'Find MCP servers for this workspace',
  },
  {
    kind: 'generate-prompt',
    title: 'Generate prompt',
    description: 'Draft a system prompt',
  },
  {
    kind: 'generate-claude-md',
    title: 'CLAUDE.md preview',
    description: 'Preview a project instruction file',
  },
];

export function helperResultText(result: HarnessHelperResult | null): string {
  if (!result) return '';
  switch (result.kind) {
    case 'generate-document':
      return result.value.document;
    case 'generate-claude-md':
      return result.value.content;
    case 'generate-prompt':
      return result.value.generatedPrompt;
    case 'design-agents':
      return result.value.subagents.map((item) => item.name).join(', ');
    case 'generate-skills':
      return result.value.skills.map((item) => item.name).join(', ');
    case 'discover-mcp':
      return result.value.servers.map((item) => item.name).join(', ');
    case 'analyze-intent':
      return result.value.persona.label;
    case 'suggest-config':
      return result.value.reasoning;
  }
}

import { inject, injectable } from 'tsyringe';
import type {
  HarnessWorkflowPromptParams,
  HarnessWorkflowPromptResponse,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';

@injectable()
export class HarnessWorkflowPromptService {
  constructor(
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
  ) {}

  async composePrompt(
    params: HarnessWorkflowPromptParams,
  ): Promise<HarnessWorkflowPromptResponse> {
    const workspaceContext =
      await this.workspaceContext.resolveWorkspaceContext();
    const availableAgents = this.workspaceContext.getAvailableAgents();
    const availableSkills = this.workspaceContext.discoverAvailableSkills();

    const agentList = availableAgents
      .map(
        (a) =>
          `- ${a.id}: ${a.name} (${a.type}, ${a.available ? 'available' : 'unavailable'})`,
      )
      .join('\n');

    const skillList =
      availableSkills.length > 0
        ? availableSkills
            .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
            .join('\n')
        : '(none discovered)';

    const isEmptyWorkspace =
      await this.workspaceContext.isWorkspaceEffectivelyEmpty();

    const contextBlock = `Project: ${workspaceContext.projectName} (${workspaceContext.projectType})
Frameworks: ${workspaceContext.frameworks.join(', ') || '(none detected)'}
Languages: ${workspaceContext.languages.join(', ') || '(none detected)'}`;

    const toolsBlock = `## Tools
Use the ptah.harness MCP tools to ground your recommendations:
- searchSkills(query?) — find existing skills relevant to the user's needs.
- searchMcpRegistry(query, limit?) — search the MCP Registry for relevant servers.
- listInstalledMcpServers() — check what MCP servers are already installed in the workspace.
- createSkill(name, description, content, allowedTools?) — author custom skills.
- proposeConfig(configUpdates, isConfigComplete?) — push partial HarnessConfig updates to the configuration surface. Call proposeConfig whenever configuration decisions firm up (persona, agents, skills, system prompt, MCP servers); configUpdates is a partial HarnessConfig — only include fields you are changing. Call it again with isConfigComplete=true once the configuration is ready to apply.`;

    const applyExpectations = `## What Apply Writes
When the user clicks Apply, Ptah materializes the configuration to the workspace:
- \`.claude/CLAUDE.md\` — the project system prompt / guidance.
- \`.claude/agents/*.md\` — one file per designed subagent.
- \`.claude/skills/\` — junctions for every selected or created skill.
Set the user's expectations accordingly as the design firms up.`;

    const planningBlock = `## Project Planning (do this first — the workspace is empty)
This workspace has no project yet. Before designing any AI team, plan the project with the user:
1. Scan the workspace for any seed documents the user dropped in — use your Read, Glob, and Grep tools to find and read README files, PRDs, specs, and anything under docs/.
2. Interview the user about what they want to build: goals, target users, stack preferences, and constraints.
3. Propose an architecture and a plan, and confirm it with the user.
4. Only then design the AI team (agents, skills, MCP servers) that fits the planned project — leverage the available skills and subagent setup below, and call proposeConfig as decisions firm up.`;

    const empty = `You are a harness architect collaborating with a user to plan a brand-new project and build the AI coding assistant configuration that will drive it. Work conversationally.

## Workspace
${contextBlock}

${planningBlock}

## Available Agents
${agentList}

## Available Skills
${skillList}

${toolsBlock}

${applyExpectations}

Ask clarifying questions when intent is unclear, and call proposeConfig once the project plan and the AI team that supports it are firm.

## User's Intent
${params.intent}`;

    const existing = `You are a harness architect collaborating with a user to build their AI coding assistant configuration. Work conversationally and drive the configuration to completion.

## Workspace
${contextBlock}

## Available Agents
${agentList}

## Available Skills
${skillList}

${toolsBlock}

Actively search for and recommend relevant skills and MCP servers beyond what the user explicitly asks for. Ask clarifying questions when intent is unclear, and call proposeConfig early and often so the surface reflects the evolving configuration.

${applyExpectations}

## User's Intent
${params.intent}`;

    return { prompt: isEmptyWorkspace ? empty : existing };
  }
}

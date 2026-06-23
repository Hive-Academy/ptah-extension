export const SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID = 'ptah-nx-saas';

export const NEW_PROJECT_CHAT_SEED_PROMPT =
  "I'm starting a new SaaS project. Use the saas-workspace-initializer skill " +
  'to drive Stage A — discovery, write the roadmap to .ptah/roadmap.md, then ' +
  'scaffold the foundation. Stop after foundation; remaining roadmap items ' +
  'run in separate sessions. Once the foundation is settled, design the ' +
  "project's AI team using the ptah.harness tools (searchSkills, " +
  'searchMcpRegistry, createSkill, proposeConfig): pick the agents, skills, ' +
  'and MCP servers that fit the project, then call proposeConfig with ' +
  'isConfigComplete=true so I can apply it — applying writes .claude/CLAUDE.md, ' +
  '.claude/agents/, and .claude/skills/.';

export const WIZARD_VIEW_TYPE = 'ptah.setupWizard';

# Research Report: Skills.sh, Claude Code Agent/Skill Ecosystem, and Pre-built Agent Patterns

**Date**: 2026-04-04
**Research Classification**: STRATEGIC ANALYSIS
**Confidence Level**: 92% (based on 20+ primary sources including official documentation)
**Key Insight**: The Claude Code ecosystem has matured into a standardized, cross-platform agent skills economy with multiple distribution channels -- skills.sh (Vercel) serves as the universal CLI/directory, while Anthropic's plugin marketplace system provides the native distribution mechanism.

---

## 1. Skills.sh -- The Open Agent Skills Ecosystem

### 1.1 What Is Skills.sh?

Skills.sh is a **directory, leaderboard, and CLI tool** for the open agent skills ecosystem, built and maintained by **Vercel Labs**. It serves as the central hub for discovering, installing, and tracking adoption of reusable AI agent skills that follow the Agent Skills open standard (agentskills.io).

**Repository**: https://github.com/vercel-labs/skills
**Website**: https://skills.sh
**npm package**: `skills` (https://www.npmjs.com/package/skills)

Key characteristics:

- **Not a hosting platform** -- skills live in GitHub repositories; skills.sh is a directory/index
- **Cross-agent compatibility** -- supports 40+ coding agents (Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Cline, Gemini CLI, OpenCode, etc.)
- **Anonymous telemetry-based leaderboard** -- tracks aggregate installation counts (91,457+ total installs at time of research)
- **No formal review/curation process** -- skills surface through user adoption metrics

### 1.2 How Installation Works

The CLI command is `npx skills`:

```bash
# Install skills from a GitHub repository
npx skills add vercel-labs/agent-skills

# Install a specific skill
npx skills add vercel-labs/agent-skills -s find-skills

# Install to a specific agent only
npx skills add owner/repo -a claude-code

# Install globally (user-level)
npx skills add owner/repo -g

# Install all skills to all detected agents
npx skills add owner/repo --all -y

# List installed skills
npx skills list

# Search for skills
npx skills find [query]

# Create a new skill template
npx skills init my-skill

# Update installed skills
npx skills update

# Remove skills
npx skills remove [skill-names]
```

**Installation mechanics**:

- By default, the CLI **symlinks** skills from a canonical copy to each agent's skill directory
- The `--copy` flag creates independent copies instead (useful when symlinks are not supported)
- The CLI auto-detects which coding agents are installed on the system
- Skills are installed to agent-specific paths:
  - Claude Code: `.claude/skills/` (project) or `~/.claude/skills/` (global)
  - Cursor: `.agents/skills/` (project) or `~/.cursor/skills/` (global)
  - Codex: `.agents/skills/` (project) or `~/.codex/skills/` (global)

**Source formats accepted**:

- GitHub shorthand: `owner/repo`
- Full GitHub URLs
- GitLab URLs
- Any git repository URL
- Local filesystem paths

### 1.3 Skill Discovery Mechanism

The CLI searches predefined locations within repositories:

- Root directory (if it contains SKILL.md)
- `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`
- Agent-specific directories (`.claude/skills/`, `.agents/skills/`, `.augment/skills/`)
- Claude plugin marketplace manifests (`.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json`)
- Falls back to recursive search if no skills found in standard locations

### 1.4 API and Programmatic Access

**skills.sh itself does not expose a public REST API.** The leaderboard data is rendered server-side. However:

- The CLI (`npx skills`) can be used programmatically in CI/CD pipelines with the `-y` (non-interactive) flag
- Environment variables control behavior:
  - `INSTALL_INTERNAL_SKILLS=1` -- shows hidden/internal skills
  - `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` -- disables anonymous tracking
- The leaderboard automatically indexes any skill that gets installed through the CLI

**Third-party APIs exist** for programmatic skill access:

- **SkillsMP** (skillsmp.com) -- REST API with keyword and AI semantic search (API docs at skillsmp.com/docs/api)
- **SkillReg** (skillreg.dev) -- Private registry with API token management for enterprise use
- **SkillHub** (iflytek/skillhub on GitHub) -- Self-hosted, open-source registry with REST API + CLI

### 1.5 Publishing to Skills.sh

There is no formal submission process. To appear on skills.sh:

1. Create a GitHub repository with skills following the Agent Skills format
2. Users install your skills via `npx skills add your-org/your-repo`
3. Installation telemetry automatically registers the skill on the leaderboard
4. Popularity (install count) determines ranking position

**Notable publishers on the leaderboard**:

- `vercel-labs/skills` (Vercel's own skills)
- `anthropics/skills` (Anthropic's official skills)
- `microsoft/azure-skills`

---

## 2. The Agent Skills Open Standard (agentskills.io)

### 2.1 Origin and Adoption

The Agent Skills format was developed by **Anthropic** and released as an open standard in late 2025. It has been adopted by:

- **OpenAI** (Codex CLI)
- **Microsoft** (GitHub Copilot, VS Code)
- **Cursor**
- **Atlassian**
- **Figma**
- **Google** (Gemini CLI)
- And 30+ other agent platforms

**Specification**: https://agentskills.io/specification
**GitHub**: https://github.com/agentskills/agentskills
**Anthropic's spec**: https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md

### 2.2 SKILL.md Format (Open Standard)

```
skill-name/
  SKILL.md          # Required: metadata + instructions
  scripts/          # Optional: executable code
  references/       # Optional: documentation
  assets/           # Optional: templates, resources
```

**Required frontmatter fields** (open standard):

| Field           | Required | Constraints                                                |
| --------------- | -------- | ---------------------------------------------------------- |
| `name`          | Yes      | Max 64 chars. Lowercase letters, numbers, hyphens only.    |
| `description`   | Yes      | Max 1024 chars. What the skill does and when to use it.    |
| `license`       | No       | License name or reference to bundled file.                 |
| `compatibility` | No       | Max 500 chars. Environment requirements.                   |
| `metadata`      | No       | Arbitrary key-value mapping.                               |
| `allowed-tools` | No       | Space-delimited list of pre-approved tools. (Experimental) |

**Example SKILL.md**:

```markdown
---
name: code-review
description: Reviews code for bugs, security issues, and performance problems. Use when reviewing pull requests or code changes.
license: MIT
metadata:
  author: example-org
  version: '1.0'
allowed-tools: Read Grep Glob
---

# Code Review

When reviewing code, follow these steps:

1. Check for security vulnerabilities
2. Identify performance bottlenecks
3. Verify error handling
4. Assess code readability

## Common Patterns to Flag

- SQL injection risks
- Unvalidated user input
- Missing error boundaries
```

### 2.3 Claude Code Extensions to the Standard

Claude Code extends the base standard with additional frontmatter fields:

| Field                      | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `disable-model-invocation` | `true` = only user can invoke (not Claude automatically) |
| `user-invocable`           | `false` = only Claude can invoke (hidden from `/` menu)  |
| `context`                  | `fork` = run in isolated subagent context                |
| `agent`                    | Which subagent type to use with `context: fork`          |
| `argument-hint`            | Autocomplete hint for expected arguments                 |
| `model`                    | Model override for this skill                            |
| `effort`                   | Effort level override (low/medium/high/max)              |
| `hooks`                    | Lifecycle hooks scoped to this skill                     |
| `paths`                    | Glob patterns limiting when skill activates              |
| `shell`                    | Shell for inline commands (`bash` or `powershell`)       |

**String substitutions** available in skill content:

- `$ARGUMENTS` -- all arguments passed when invoking
- `$ARGUMENTS[N]` or `$N` -- specific argument by index
- `${CLAUDE_SESSION_ID}` -- current session ID
- `${CLAUDE_SKILL_DIR}` -- directory containing SKILL.md

**Dynamic context injection** via shell commands:

```markdown
## PR Context

- PR diff: !`gh pr diff`
- Changed files: !`gh pr diff --name-only`
```

### 2.4 Progressive Disclosure Model

Skills are designed for efficient context usage:

1. **Metadata** (~100 tokens): `name` and `description` loaded at startup for all skills
2. **Instructions** (< 5000 tokens recommended): Full SKILL.md body loaded on activation
3. **Resources** (as needed): Supporting files loaded only when required

---

## 3. Claude Code Subagent Format (.claude/agents/)

### 3.1 Directory and File Structure

Subagents are Markdown files with YAML frontmatter stored in:

- `~/.claude/agents/` -- personal (all projects)
- `.claude/agents/` -- project-specific
- Plugin `agents/` directory -- via installed plugins
- Managed settings -- organization-wide

### 3.2 Subagent Frontmatter Fields

| Field             | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `description`     | When Claude should delegate to this agent            |
| `model`           | Model to use (sonnet, haiku, opus, etc.)             |
| `tools`           | Allowed tools list                                   |
| `disallowedTools` | Tools to deny                                        |
| `permissionMode`  | Permission behavior (default, permissive, full-auto) |
| `mcpServers`      | MCP server configurations                            |
| `hooks`           | Lifecycle hooks                                      |
| `maxTurns`        | Maximum conversation turns                           |
| `skills`          | Pre-loaded skills                                    |
| `initialPrompt`   | Prompt sent on agent startup                         |
| `memory`          | Persistent memory scope                              |
| `effort`          | Effort level                                         |
| `background`      | Run in background                                    |
| `isolation`       | Context isolation settings                           |
| `color`           | UI color identifier                                  |

**Example agent file** (`.claude/agents/code-reviewer.md`):

```markdown
---
description: 'Expert code reviewer. Delegates when code review is needed.'
model: sonnet
tools:
  - Read
  - Grep
  - Glob
  - Bash
maxTurns: 10
---

You are a senior code reviewer. Focus on:

1. Code quality and readability
2. Security vulnerabilities
3. Performance bottlenecks
4. Best practices adherence

Provide actionable feedback with code examples.
```

### 3.3 Built-in Subagents

Claude Code ships with:

- **Explore** -- Fast, read-only (Haiku model), for codebase search/analysis
- **Plan** -- Research agent for plan mode, read-only
- **General-purpose** -- Full tools, inherits main model, for complex tasks

### 3.4 CLI-defined Agents (Ephemeral)

Agents can be passed as JSON via `--agents` flag for scripting/automation:

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Glob"],
    "model": "sonnet"
  }
}'
```

---

## 4. Plugin Marketplace System (Native Distribution)

### 4.1 How It Works

Claude Code has a built-in plugin marketplace system defined by `.claude-plugin/marketplace.json`:

```json
{
  "name": "my-marketplace",
  "owner": { "name": "Your Name" },
  "plugins": [
    {
      "name": "quality-review-plugin",
      "source": "./plugins/quality-review-plugin",
      "description": "Adds a /quality-review skill"
    }
  ]
}
```

**Plugin structure**:

```
plugin-name/
  .claude-plugin/
    plugin.json          # Plugin metadata (required)
  .mcp.json              # MCP server config (optional)
  commands/              # Slash commands (optional)
  agents/                # Agent definitions (optional)
  skills/                # Skill definitions (optional)
  README.md
```

**Source types supported**: relative paths, GitHub repos, git URLs, git subdirectories, npm packages.

### 4.2 Anthropic's Official Marketplace

- **Repository**: https://github.com/anthropics/claude-plugins-official
- **15.9k stars**, 222 commits, 127 watchers
- Contains internal Anthropic plugins + external/third-party plugins
- **Submission process**: Via plugin directory submission form at clau.de/plugin-directory-submission
- External plugins must meet quality and security standards

### 4.3 Anthropic's Skills Repository

- **Repository**: https://github.com/anthropics/skills
- **110k stars**, 12.4k forks
- Contains official skill examples + the Agent Skills specification
- Categories: Creative & Design, Development & Technical, Enterprise & Communication, Document Skills (PDF, DOCX, PPTX, XLSX)
- Install via: `/plugin marketplace add anthropics/skills`

### 4.4 Key Marketplace Commands

```bash
# Add a marketplace
/plugin marketplace add owner/repo

# List marketplaces
/plugin marketplace list

# Install a plugin
/plugin install plugin-name@marketplace-name

# Browse available plugins
/plugin  (then select Discover)

# Update marketplaces
/plugin marketplace update

# Validate marketplace structure
claude plugin validate .
```

---

## 5. Community Ecosystem -- Curated Agent Collections

### 5.1 Major Repositories

| Repository                                                                                            | Stars | Content                                                 |
| ----------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | --    | 100+ specialized subagents                              |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)                   | --    | 1000+ agent skills from official teams and community    |
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit)       | --    | 135 agents, 35 skills, 42 commands, 150+ plugins        |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)               | --    | Curated skills, hooks, commands, plugins                |
| [rahulvrane/awesome-claude-agents](https://github.com/rahulvrane/awesome-claude-agents)               | --    | Plug-and-play agents, frameworks, orchestration recipes |
| [navin4078/awesome-claude-code-agents](https://github.com/navin4078/awesome-claude-code-agents)       | 1.1k  | Curated subagent list                                   |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)                       | --    | 220+ skills for 8+ coding agents                        |
| [daymade/claude-code-skills](https://github.com/daymade/claude-code-skills)                           | --    | Production-ready skills marketplace                     |

### 5.2 Template/Marketplace Platforms

| Platform            | URL                    | Description                                      |
| ------------------- | ---------------------- | ------------------------------------------------ |
| Claude Marketplaces | claudemarketplaces.com | Directory of plugins, skills, MCP servers        |
| Build with Claude   | buildwithclaude.com    | Plugin marketplace browser                       |
| AI Templates        | aitmpl.com             | 1000+ agents, commands, skills, MCP integrations |
| Claude Code Agents  | claudecodeagents.com   | 60+ prompts, 230+ plugins, 175 skills            |
| SubAgents.cc        | subagents.cc           | Agent discovery and sharing                      |
| SkillHub Club       | skillhub.club          | 7,000+ AI-evaluated skills                       |
| Claude Skills Info  | claudeskills.info      | Claude Skills marketplace                        |

### 5.3 Community Conventions

**Common patterns observed across community repositories**:

- Agents use the standard `.claude/agents/` YAML-frontmatter markdown format
- Skills follow the Agent Skills open standard (SKILL.md)
- Most repositories organize by domain (frontend, backend, devops, security, etc.)
- Copy-paste installation is common (copy the .md file to your `.claude/agents/` directory)
- Some repositories provide install scripts or use the `npx skills` CLI

---

## 6. Integration Opportunities for Ptah

### 6.1 Distribute Ptah Agents as a Plugin Marketplace

Ptah already has 14 agents in `.claude/agents/`. These could be packaged as a **Claude Code plugin marketplace**:

```
ptah-agents-marketplace/
  .claude-plugin/
    marketplace.json
  plugins/
    ptah-orchestra/
      .claude-plugin/
        plugin.json
      agents/
        backend-developer.md
        frontend-developer.md
        software-architect.md
        ...
      skills/
        orchestration/
          SKILL.md
```

Users would install via:

```bash
/plugin marketplace add Hive-Academy/ptah-agents
/plugin install ptah-orchestra@ptah-agents
```

### 6.2 Publish Skills to skills.sh

Ptah's orchestration workflow and specialized agents could be published as skills on skills.sh:

- Convert the orchestration workflow into a SKILL.md
- Package the agent definitions as installable skills
- Users install via `npx skills add Hive-Academy/ptah-skills`
- Automatically appears on the skills.sh leaderboard

### 6.3 Create a Ptah Plugin with Agents + Skills + MCP

A full Ptah plugin could bundle:

- **Agents**: The 14 specialized agents (researcher, architect, developers, etc.)
- **Skills**: Orchestration workflow, code review, deployment
- **MCP Server**: The existing Ptah MCP server for workspace intelligence
- **Hooks**: Pre-commit quality gates, post-tool validation

### 6.4 Risk Assessment

| Approach             | Effort      | Reach                  | Maintenance               |
| -------------------- | ----------- | ---------------------- | ------------------------- |
| Plugin marketplace   | Medium      | Claude Code users only | Plugin updates via git    |
| skills.sh publishing | Low         | 40+ agent platforms    | Universal format          |
| Both                 | Medium-High | Maximum reach          | Two distribution channels |

**Recommendation**: Start with skills.sh publishing (lowest effort, broadest reach), then add a plugin marketplace for deeper Claude Code integration.

---

## 7. Sources

### Primary Sources (Official Documentation)

- [Extend Claude with skills -- Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Create custom subagents -- Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Create and distribute a plugin marketplace -- Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [Agent Skills Specification -- agentskills.io](https://agentskills.io/specification)
- [Agent Skills GitHub -- agentskills/agentskills](https://github.com/agentskills/agentskills)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Anthropic Official Plugins](https://github.com/anthropics/claude-plugins-official)

### Skills.sh and Vercel

- [Vercel Labs Skills CLI -- GitHub](https://github.com/vercel-labs/skills)
- [skills -- npm](https://www.npmjs.com/package/skills)
- [Skills.sh FAQ](https://skills.sh/docs/faq)
- [Introducing skills -- Vercel Changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)
- [Agent Skills Knowledge Base -- Vercel](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context)

### Ecosystem and Community

- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
- [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit)
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)
- [claude-market/marketplace](https://github.com/claude-market/marketplace)
- [OpenAI Agent Skills -- Codex](https://developers.openai.com/codex/skills)
- [VS Code Agent Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

### Third-Party Registries

- [SkillsMP](https://skillsmp.com/) -- REST API with search
- [SkillReg](https://skillreg.dev/) -- Private registry for enterprises
- [SkillHub (iflytek)](https://github.com/iflytek/skillhub) -- Self-hosted open-source registry

### Articles and Analysis

- [Skills.sh: The Missing Package Manager for AI Agent Capabilities](https://johnoct.com/blog/2026/02/12/skills-sh-open-agent-skills-ecosystem/)
- [Anthropic Opens Agent Skills Standard -- Unite.AI](https://www.unite.ai/anthropic-opens-agent-skills-standard-continuing-its-pattern-of-building-industry-infrastructure/)
- [10 Must-Have Skills for Claude in 2026 -- Medium](https://medium.com/@unicodeveloper/10-must-have-skills-for-claude-and-any-coding-agent-in-2026-b5451b013051)
- [Skills-CLI Guide -- Medium](https://medium.com/@jacklandrin/skills-cli-guide-using-npx-skills-to-supercharge-your-ai-agents-38ddf3f0a826)

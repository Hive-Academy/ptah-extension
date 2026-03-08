# Task Context - TASK_2025_058

## User Intent

Design and implement an **Intelligent Project-Adaptive Agent Generation System** that generates personalized agents, commands, and workflows for each user's project instead of shipping hardcoded generic agents.

**Core Vision**: Build a meta-agent system that:

1. Scans user's codebase on first install (Welcome Screen)
2. Detects project type, tech stack, architecture patterns
3. Uses VS Code LM API + template-generation library
4. Generates customized `.claude/` folder with project-specific agents/commands/workflows
5. Smart agent selection (backend API → no UI/UX agents)
6. Preserves general rules, customizes project-specific knowledge

## Conversation Summary

### The Problem with Static Agents

- Generic hardcoded agents don't understand user's specific project
- Backend developers shouldn't see UI/UX agents
- Each tech stack has unique best practices
- Can't adapt to project architecture patterns

### User's Solution: Dynamic Generation

Instead of extension shipping hardcoded agents:

1. Extension bundles **agent templates** (not final agents)
2. On setup, scan workspace using workspace-intelligence
3. VS Code LM analyzes tech stack, architecture, conventions
4. Template system selects relevant templates based on project
5. LLM customizes each template with project knowledge
6. Generates `.claude/agents/`, `.claude/commands/`, `CLAUDE.md`

### Template Structure

Templates have two types of sections:

- **Hardcoded sections**: General orchestration rules, git conventions, best practices
- **Dynamic sections**: Tech stack specifics, architecture patterns, project structure, team conventions

### Scope Differentiation

Four-tier agent system:

1. **Extension Meta-Agents** (hidden): Used for setup process only
2. **Generated Agents** (scope: 'generated'): Created during setup, stored in `.claude/agents/`, marked with `generated: true` in YAML frontmatter
3. **User Custom** (scope: 'user'): `~/.claude/agents/*.md`
4. **Project Custom** (scope: 'project'): `.claude/agents/*.md` (user-added, not generated)

## Technical Context

- **Branch**: feature/TASK_2025_058
- **Created**: 2025-12-08
- **Type**: RESEARCH → FEATURE (starts with strategic planning)
- **Complexity**: Very High (10-14 week project)
- **Phase**: Strategic Planning (Option A chosen)

## Existing Infrastructure

✅ **Available Now**:

- `libs/backend/template-generation/` - Template rendering library
- `libs/backend/workspace-intelligence/` - Project analysis (type detection, tech stack, frameworks, monorepo)
- VS Code LM API integration capability
- Agent discovery system (AgentDiscoveryService, CommandDiscoveryService)

⏳ **Need to Build**:

- Template storage system (agents/commands/workflows as templates)
- Intelligent agent selection logic
- LLM-powered customization service
- Welcome screen setup wizard
- Template variable substitution engine
- Generated agent discovery integration

## Implementation Phases (Overview)

**Phase 1**: Template Foundation (2-3 weeks)

- Convert `.claude/agents/*.md` to templates
- Design template variable syntax
- Build template selection rules

**Phase 2**: Workspace Analysis Enhancement (1-2 weeks)

- Deeper project intelligence extraction
- Architecture pattern detection
- Convention analysis

**Phase 3**: LLM Integration (2-3 weeks)

- AgentCustomizationService using VS Code LM
- Prompt engineering for customization
- Quality validation

**Phase 4**: Setup Wizard UI (2-3 weeks)

- Welcome screen webview
- Multi-step wizard
- Progress tracking

**Phase 5**: Template Rendering Engine (1-2 weeks)

- Variable substitution
- Section assembly (hardcoded + LLM)
- File writing to `.claude/`

**Phase 6**: Discovery Integration (1 week)

- Update AgentDiscoveryService for 'generated' scope
- Regeneration command
- Version management

**Phase 7**: SDK Integration (1 week)

- Load generated agents via settingSources
- Runtime loading
- Agent override support

**Phase 8**: Skills Support (Future, 2-3 weeks)

- Apply same pattern to skills

**Total Estimate**: 10-14 weeks (2.5-3.5 months)

## Execution Strategy

**RESEARCH Strategy** (Option A - Strategic Planning):

1. **Phase 1**: project-manager → Creates strategic planning requirements
2. **USER VALIDATES** ✋
3. **Phase 2**: researcher-expert → Comprehensive design document covering:
   - Detailed template format specification
   - LLM prompt library design
   - Setup wizard UX flows
   - Error handling strategies
   - Migration plan for existing users
   - Risk mitigation
4. **Phase 3**: software-architect → System architecture design
5. **USER VALIDATES** ✋
6. **Decision Point**: After planning approval:
   - Option 1: Build POC first
   - Option 2: Start Phase 1 implementation
   - Option 3: Continue planning with deeper dives

## Key Decisions Needed

1. **Template Variable Syntax**:

   - `{{VAR_NAME}}` for simple substitution?
   - `{{SECTION:NAME}}` for sections?
   - `{{LLM_CUSTOMIZED:TOPIC}}` for AI-generated?

2. **LLM Quality Control**:

   - How to validate AI-generated content?
   - Fallback strategy if LLM fails?
   - How to preserve hardcoded sections?

3. **Template Versioning**:

   - How to update generated agents when templates evolve?
   - Migration strategy for existing `.claude/` folders?
   - User consent for regeneration?

4. **Agent Selection Rules**:

   - Project type → agent mapping
   - Tech stack → pattern mapping
   - Threshold for "relevant" agents?

5. **Error Handling**:
   - LLM API failures
   - Invalid project structure
   - Partial generation failures
   - Rollback strategy

## Success Criteria (for Planning Phase)

### Strategic Planning Document

- ✅ Complete template format specification
- ✅ LLM prompt library with examples
- ✅ Setup wizard UX flows (mockups/wireframes)
- ✅ Error handling strategy document
- ✅ Migration plan for existing users
- ✅ Risk assessment and mitigation strategies

### Architecture Design

- ✅ Component architecture diagram
- ✅ Service interaction flows
- ✅ Data models for templates, metadata, project context
- ✅ API contracts (RPC methods, SDK integration)
- ✅ Testing strategy

### Implementation Roadmap

- ✅ Phased implementation plan with milestones
- ✅ Dependency mapping between phases
- ✅ Resource estimation (time, complexity)
- ✅ Risk areas identified

## Related Tasks

- TASK_2025_044: Claude Agent SDK Integration (current agents/commands discovery)
- TASK_2025_015: Code Migration from RooCode (template-generation library origin)
- TASK_2025_016: Code Execution API (ptah.ai namespace - potential template target)

## Future Enhancements (Post-MVP)

- Skills generation support
- Multi-language agent templates (non-English)
- Community template marketplace
- Agent versioning and updates
- A/B testing for LLM prompts
- Analytics on generated agent quality

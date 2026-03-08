# Requirements Document - TASK_2025_135: Prompt Harness System

## Executive Summary

The Prompt Harness System is a layered architecture for customizing Claude Code's system prompt without losing Anthropic's proven foundation. It introduces user-configurable "power-ups" extracted from the existing `.claude/agents/` patterns, enables premium MCP feature enhancements, and provides a UI for users to toggle and customize prompt layers. This system preserves backward compatibility with Anthropic's base prompt while enabling intelligent enhancement through modular, toggleable components.

## Problem Statement

Currently, the Ptah extension has limited prompt customization capability:

1. **Fixed Enhancement Layer**: The `PTAH_BEHAVIORAL_PROMPT` and `PTAH_SYSTEM_PROMPT` are statically appended without user control
2. **No Power-Up Extraction**: The sophisticated agent prompts in `.claude/agents/` contain valuable patterns (investigation protocols, escalation rules, code quality standards) that are unused in the main chat experience
3. **No User Customization**: Users cannot enable/disable specific prompt enhancements or add their own custom sections
4. **Premium Feature Opacity**: Premium users get MCP capabilities but cannot see or configure what prompt enhancements they receive
5. **Iteration Challenges**: When Anthropic updates their base prompt, there's no clear separation between foundation and customizations

## Business Value

**For Users**:

- Control over AI behavior through toggleable power-ups
- Ability to apply specialized agent behaviors (investigation-first, code quality standards) to regular chat
- Custom prompt sections for personal or team workflows
- Visibility into what prompt enhancements they receive

**For the Product**:

- Differentiated premium offering with configurable AI capabilities
- Foundation for future prompt marketplace or community sharing
- Clear architecture for maintaining prompt updates over time
- Reduced support burden through transparent prompt configuration

**For Development**:

- Clean separation between Anthropic's foundation and Ptah enhancements
- Testable, modular prompt assembly
- Clear upgrade path when Anthropic changes their base prompt

## User Stories

### User Story 1: Power-Up Discovery and Activation

**User Story:** As a Ptah user, I want to browse available prompt power-ups and enable the ones that match my workflow, so that I can customize Claude's behavior without writing complex prompts myself.

#### Acceptance Criteria

1. WHEN user opens prompt settings THEN system SHALL display a categorized list of available power-ups with descriptions
2. WHEN user enables a power-up THEN system SHALL immediately apply it to future conversations
3. WHEN user hovers over a power-up THEN system SHALL display a preview of what prompt text will be added
4. WHEN user disables a power-up THEN system SHALL remove it from prompt assembly without affecting other layers

### User Story 2: Custom Prompt Sections

**User Story:** As a power user, I want to add my own custom prompt sections that persist across sessions, so that I can encode team-specific conventions or personal preferences.

#### Acceptance Criteria

1. WHEN user creates a custom prompt section THEN system SHALL provide a text editor with markdown support
2. WHEN user saves a custom section THEN system SHALL validate it does not exceed 2000 tokens
3. WHEN user assigns priority to custom section THEN system SHALL insert it in the correct position relative to other layers
4. WHEN user edits an existing custom section THEN system SHALL preserve formatting and special characters

### User Story 3: Prompt Assembly Preview

**User Story:** As any user, I want to preview the complete assembled prompt before starting a conversation, so that I can understand exactly what instructions Claude receives.

#### Acceptance Criteria

1. WHEN user clicks "Preview Prompt" THEN system SHALL display the complete assembled prompt with layer annotations
2. WHEN user changes any setting THEN preview SHALL update in real-time to reflect changes
3. WHEN viewing preview THEN system SHALL highlight which sections come from which layer (base, project, agent, user, premium)
4. WHEN copying preview THEN system SHALL allow copying the complete assembled prompt to clipboard

### User Story 4: Premium Power-Up Access

**User Story:** As a premium subscriber, I want access to advanced power-ups including MCP-aware behaviors, so that I can leverage the full capabilities of my subscription.

#### Acceptance Criteria

1. WHEN free user views power-up list THEN system SHALL show premium power-ups as locked with upgrade prompt
2. WHEN premium user enables MCP power-ups THEN system SHALL include MCP server awareness in prompt assembly
3. WHEN subscription lapses THEN system SHALL gracefully degrade premium power-ups to basic equivalents
4. WHEN premium status changes THEN system SHALL notify user which power-ups are affected

### User Story 5: Intelligent Power-Up Recommendations

**User Story:** As a new user, I want the system to recommend power-ups based on my project type, so that I can quickly configure optimal settings without manual research.

#### Acceptance Criteria

1. WHEN user opens prompt settings for first time THEN system SHALL analyze workspace and recommend relevant power-ups
2. WHEN recommendation includes investigation-first power-up AND project is Nx monorepo THEN system SHALL explain why this matches the project structure
3. WHEN user accepts recommendations THEN system SHALL enable suggested power-ups with one click
4. WHEN user dismisses recommendations THEN system SHALL remember preference and not repeat for this workspace

### User Story 6: Configuration Import/Export

**User Story:** As a team lead, I want to export my prompt configuration and share it with my team, so that we can maintain consistent AI behavior across the organization.

#### Acceptance Criteria

1. WHEN user exports configuration THEN system SHALL generate a JSON file with all power-up states and custom sections
2. WHEN user imports configuration THEN system SHALL validate format and apply settings with confirmation
3. WHEN import contains premium power-ups AND user is free tier THEN system SHALL warn and skip premium items
4. WHEN configuration version is newer than installed extension THEN system SHALL provide migration guidance

### User Story 7: Power-Up Conflict Resolution

**User Story:** As a user with multiple power-ups enabled, I want the system to detect and resolve conflicting instructions, so that the prompt remains coherent and effective.

#### Acceptance Criteria

1. WHEN user enables conflicting power-ups THEN system SHALL highlight the conflict with explanation
2. WHEN conflict exists THEN system SHALL suggest resolution (disable one, merge, or priority order)
3. WHEN automatic resolution is possible THEN system SHALL offer one-click fix
4. WHEN user ignores conflict warning THEN system SHALL apply power-ups in priority order with later overriding earlier

## Non-Functional Requirements

### Performance Requirements

- **Prompt Assembly Time**: Complete prompt assembly (all layers) under 50ms
- **Settings UI Responsiveness**: Power-up toggle response under 100ms
- **Preview Generation**: Real-time preview updates under 200ms
- **Configuration Load**: Settings retrieval from storage under 100ms

### Security Requirements

- **Custom Prompt Sanitization**: All user-provided prompt text must be sanitized to prevent injection attacks
- **Configuration Storage**: Settings stored in VS Code SecretStorage for custom prompts containing sensitive patterns
- **Export Security**: Exported configurations must not contain API keys or sensitive credentials

### Scalability Requirements

- **Power-Up Capacity**: Support up to 50 power-ups without performance degradation
- **Custom Section Limit**: Support up to 10 user-defined custom sections
- **Token Budget Management**: Total assembled prompt must not exceed model context limits (reserve 4000 tokens for user query)

### Reliability Requirements

- **Graceful Degradation**: If power-up fails to load, fall back to base prompt without error
- **Configuration Persistence**: Settings survive extension updates and VS Code restarts
- **Version Compatibility**: Configuration format backward compatible for at least 5 minor versions

### Maintainability Requirements

- **Layer Isolation**: Each prompt layer must be independently testable
- **Anthropic Update Path**: Base prompt reference must be updateable without code changes
- **Power-Up Versioning**: Each power-up must have semantic version for tracking changes

## Technical Architecture (Layer Model)

### Layer 1: Anthropic Foundation (Immutable)

The Claude Code `claude_code` preset serves as the immutable foundation. This is referenced, never modified.

**Source**: SDK's built-in preset, documented in `docs/claude-code-system-prompt.md`
**Modification**: NEVER - only append to it

### Layer 2: Project Layer (CLAUDE.md)

Already working via SDK's `settingSources: ['user', 'project', 'local']`.

**Source**: Workspace CLAUDE.md files
**Modification**: User-controlled via file editing

### Layer 3: Agent Layer (Power-Ups)

Extracted patterns from `.claude/agents/` converted into toggleable modules.

**Candidate Power-Ups** (extracted from agent analysis):

| Power-Up ID               | Source Agent        | Description                                                  | Premium |
| ------------------------- | ------------------- | ------------------------------------------------------------ | ------- |
| `investigation-first`     | software-architect  | Systematic codebase investigation before proposing solutions | No      |
| `anti-hallucination`      | software-architect  | Verify all APIs exist before using, cite evidence            | No      |
| `escalation-protocol`     | backend-developer   | Escalate when task differs from plan, never deviate silently | No      |
| `code-quality-paranoid`   | code-logic-reviewer | Hunt for failure modes, never assume happy path              | No      |
| `solid-principles`        | backend-developer   | Apply SOLID, DRY, YAGNI, KISS to every implementation        | No      |
| `complexity-assessment`   | backend-developer   | Assess complexity level before choosing patterns             | No      |
| `evidence-citation`       | software-architect  | Cite file:line for every technical decision                  | No      |
| `task-document-discovery` | all agents          | Discover and read task documents before working              | No      |
| `ui-ux-integration`       | software-architect  | Check for and incorporate UI/UX design documents             | No      |
| `mcp-cost-optimization`   | premium             | Use invokeAgent for routine tasks with cheaper models        | Yes     |
| `mcp-token-intelligence`  | premium             | Check token counts before reading large files                | Yes     |
| `mcp-ide-powers`          | premium             | Use LSP references, organize imports, IDE actions            | Yes     |

### Layer 4: User Layer (Custom Prompts)

User-defined custom sections with priority ordering.

**Structure**:

```typescript
interface UserPromptSection {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  priority: number; // Lower = earlier in assembly
  createdAt: number;
  updatedAt: number;
}
```

### Layer 5: Premium Layer (MCP Enhancements)

Premium-gated enhancements including the existing `PTAH_SYSTEM_PROMPT` and `PTAH_BEHAVIORAL_PROMPT`.

**Components**:

- AskUserQuestion tool guidance (always-on for all tiers)
- Rich formatting guidelines (always-on for all tiers)
- MCP Server awareness (premium only)
- Cost optimization tips (premium only)
- IDE integration guidance (premium only)

## Scope Boundaries

### IN Scope

- Power-up registry and management system
- Power-up extraction from existing `.claude/agents/` patterns
- Settings UI for browsing, enabling, and configuring power-ups
- Custom prompt section editor
- Prompt assembly preview
- Configuration import/export
- Premium tier gating for advanced power-ups
- Token budget management for assembled prompts
- Integration with existing `SdkQueryOptionsBuilder.buildSystemPrompt()`

### OUT of Scope

- Prompt marketplace or community sharing platform
- A/B testing framework for prompt variations
- Multi-language prompt translations
- Voice/speech prompt input
- AI-assisted prompt generation
- Real-time collaborative prompt editing
- Prompt analytics dashboard

## Risk Assessment

### Technical Risks

| Risk                                          | Probability | Impact | Mitigation                                                            |
| --------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------- |
| Token budget overflow                         | Medium      | High   | Implement hard limit with graceful truncation; warn user before limit |
| Power-up conflicts causing incoherent prompts | Medium      | Medium | Conflict detection system; priority-based resolution                  |
| SDK prompt structure changes                  | Low         | High   | Abstract prompt assembly; version detection for SDK updates           |
| Performance degradation with many power-ups   | Low         | Medium | Lazy loading; caching of assembled prompts                            |

### Business Risks

| Risk                                            | Probability | Impact | Mitigation                                                       |
| ----------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------- |
| Users overwhelmed by options                    | Medium      | Medium | Smart defaults; recommendation system; progressive disclosure    |
| Premium power-ups not perceived as valuable     | Medium      | High   | Clear differentiation; trial access; visible premium indicators  |
| Configuration sharing leading to support burden | Low         | Medium | Configuration validation; version checking; clear error messages |

### Dependencies

| Dependency                       | Type     | Risk   | Notes                                     |
| -------------------------------- | -------- | ------ | ----------------------------------------- |
| `@anthropic-ai/claude-agent-sdk` | External | Medium | Base prompt structure may change          |
| `SdkQueryOptionsBuilder`         | Internal | Low    | Well-understood; direct modification path |
| Premium feature infrastructure   | Internal | Low    | Established in TASK_2025_108              |
| VS Code SecretStorage            | External | Low    | Stable API; fallback to globalState       |

## Success Metrics

### Quantitative Metrics

- **Power-Up Adoption**: 40% of active users enable at least one power-up within first week
- **Custom Section Usage**: 15% of power users create at least one custom section
- **Configuration Export**: 5% of users export configuration (indicator of sharing/teams)
- **Premium Conversion**: Power-up feature contributes to 10% lift in premium conversion

### Qualitative Metrics

- **User Satisfaction**: Positive feedback on prompt customization in reviews/support
- **Developer Productivity**: Reduced time debugging "why didn't Claude do X" issues
- **Support Reduction**: Fewer tickets about AI behavior after introducing transparency

## Integration Points

### Existing System Integration

1. **SdkQueryOptionsBuilder** (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`)

   - Current: `buildSystemPrompt()` statically concatenates prompts
   - Change: Call new `PromptHarnessService.assemblePrompt()` for dynamic assembly

2. **Premium Feature Gating** (TASK_2025_108)

   - Use existing `isPremium` flag for premium power-up gating
   - Extend premium check to include power-up-specific features

3. **Settings UI** (`libs/frontend/chat/src/lib/settings/`)

   - Add new "Prompt Power-Ups" section to settings
   - Integrate with existing provider/model selector patterns

4. **VS Code Storage**
   - Use `globalState` for power-up enable/disable states
   - Use `SecretStorage` for user custom prompts (may contain sensitive patterns)

### New Components Required

1. **PromptHarnessService** - Core service for prompt assembly
2. **PowerUpRegistry** - Registry of available power-ups with metadata
3. **PowerUpExtractor** - Tool to extract patterns from agent files
4. **PromptPreviewComponent** - UI for previewing assembled prompts
5. **PowerUpSettingsComponent** - UI for managing power-ups
6. **CustomSectionEditorComponent** - UI for custom prompt sections

## Appendix: Power-Up Content Examples

### Example: `investigation-first` Power-Up

```markdown
## Investigation-First Protocol

**Your superpower is INVESTIGATION, not ASSUMPTION.**

Before proposing any implementation, you systematically explore the codebase to understand:

- What patterns already exist?
- What libraries are available and how do they work?
- What conventions are established?
- What similar problems have been solved?

**You never hallucinate APIs.** Every decorator, class, interface, and pattern you propose exists in the codebase and is verified through investigation.

### Investigation Methodology

1. Question Formulation - Start with specific questions
2. Evidence Discovery - Use Glob, Grep, Read to find answers
3. Pattern Extraction - Analyze 2-3 examples to extract patterns
4. Source Verification - Verify every API you propose exists
5. Evidence Provenance - Cite file:line for every decision
```

### Example: `code-quality-paranoid` Power-Up

```markdown
## Paranoid Code Review Protocol

**Your default stance**: This code has bugs. Your job is to find them.

### The 5 Paranoid Questions

For EVERY implementation, explicitly answer these:

1. **How does this fail silently?** (Hidden failures)
2. **What user action causes unexpected behavior?** (UX failures)
3. **What data makes this produce wrong results?** (Data failures)
4. **What happens when dependencies fail?** (Integration failures)
5. **What's missing that the requirements didn't mention?** (Gap analysis)

If you can't find failure modes, **you haven't looked hard enough**.
```

---

## Document Control

| Version | Date       | Author          | Changes                       |
| ------- | ---------- | --------------- | ----------------------------- |
| 1.0     | 2026-02-03 | Project Manager | Initial requirements document |

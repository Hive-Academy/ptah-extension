# Task Context for TASK_2025_004

## User Intent

Implement Claude Code CLI's agent/task tracking and visualization system in the Ptah VSCode extension, making Ptah the first VS Code extension to provide real-time visibility into Claude's subagent orchestration.

## Conversation Summary

**Research Completed**: Comprehensive analysis documented in AGENT_SYSTEM_RESEARCH.md covering:

- Complete understanding of Claude Code CLI's Task tool and subagent spawning mechanism
- JSONL stream event analysis with parent_tool_use_id tracking for agent correlation
- Identified 16 built-in subagent types (frontend-developer, backend-developer, software-architect, etc.)
- Three implementation strategies analyzed (JSONL Stream Parsing recommended)
- Complete data flow architecture from CLI stdout to Angular UI components
- 4-week implementation plan across 5 phases

**Key Technical Discoveries**:

1. Task tool creates isolated subagent contexts with unique agentId
2. All subagent activity includes `parent_tool_use_id` linking back to Task tool call
3. JSONL stream provides real-time agent events (no polling needed)
4. Existing JSONLStreamParser infrastructure can be enhanced for agent tracking
5. No other VS Code extension has agent visualization (competitive advantage)

**Implementation Approach**:

- Strategy 1 (JSONL Stream Parsing) chosen for real-time tracking with minimal complexity
- Type system enhancements in shared library
- Backend integration via JSONLStreamParser + EventBus
- Frontend visualization with AgentTreeComponent, AgentTimelineComponent, AgentStatusBadge
- Full test coverage with unit/integration/E2E tests

**Scope**:

- Phase 1: Type system (ClaudeAgentEvent types, MESSAGE_TYPES, EventBus events)
- Phase 2: Backend integration (parser enhancement, event emitters, message handlers)
- Phase 3: Frontend components (agent tree, timeline, status badge, state management)
- Phase 4: UI/UX polish (icons, collapsible nodes, duration tracking, detail panels)
- Phase 5: Testing & documentation (unit/integration/E2E tests, user guide)

## Technical Context

- Branch: feature/004
- Created: 2025-11-17
- Task Type: FEATURE (Complex)
- Priority: HIGH (Competitive Differentiator)
- Effort Estimate: 4 weeks (5 phases)
- Complexity: COMPLEX (Multi-layer integration: shared types → backend parsing → event system → frontend visualization)

## Execution Strategy

**FEATURE_COMPREHENSIVE** (with UI/UX focus):

1. project-manager → Requirements definition → USER VALIDATION ✋
2. [SKIP researcher-expert - research already complete in AGENT_SYSTEM_RESEARCH.md]
3. ui-ux-designer → Visual design specs + Canva assets + component specifications
4. software-architect → Architecture plan → USER VALIDATION ✋
5. team-leader MODE 1 → Task decomposition (creates tasks.md)
6. team-leader MODE 2 → Iterative assignment/verification (per-task invocations)
7. team-leader MODE 3 → Final completion verification
8. [USER DECIDES] → senior-tester AND/OR code-reviewer (parallel execution possible)
9. modernization-detector → Future enhancements catalog

## Success Criteria

**Functional Requirements**:

- Real-time agent start/activity/complete events flowing from CLI to UI
- Visual agent tree showing parent-child relationships
- Agent timeline showing temporal execution patterns
- Active agent status badge with live count
- Agent detail panels with prompt/tools/results/duration

**Technical Requirements**:

- Zero impact on existing chat functionality
- <50ms latency for agent event processing
- Support for parallel/nested subagents
- 80%+ test coverage across all layers
- Full TypeScript type safety (zero `any` types)

**Quality Requirements**:

- Follows existing Ptah architecture patterns (DI, EventBus, signal-based state)
- No cross-library pollution (proper import boundaries)
- Comprehensive error handling at all layers
- Performance benchmarks for multi-agent scenarios
- User documentation with screenshots/examples

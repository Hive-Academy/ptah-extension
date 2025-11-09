# Research Report — TASK_PRV_004

Source under review: <https://github.com/andrepimenta/claude-code-chat>

Date: 2025-10-09

## Objective

Evaluate “Claude Code Chat” to identify features, patterns, and implementation ideas we can learn from to enhance our Claude Domain extraction (Week 5 of MONSTER) without copying code. Focus on permissions, session/resume, CLI flags, WSL, tooling, and UI hooks relevant to `libs/backend/claude-domain/` and current extension.

## Licensing Considerations (Critical)

- Repository License: Custom restrictive license (educational viewing only). It explicitly forbids reproduction, distribution, or creating derivative works.
- Implication: We must not copy code, markup, or assets. We can only derive conceptual guidance and implement our own original code.

## High-level Feature Inventory (from README + CHANGELOG)

- Advanced Permissions System (MCP-based + “Always Allow” patterns + YOLO mode)
- MCP Server Management UI (popular servers, custom servers, enable/disable)
- Windows/WSL Integration (detect and adapt paths/commands)
- Slash Commands Modal (23+ commands, session-aware execution)
- Model Selection UI (Opus/Sonnet/Default) and CLI `--model` flag support
- Checkpoints/Restore (safe experimentation), Conversation History
- Image and Clipboard Support (drag/drop, paste), organized storage
- Analytics & Monitoring (cost, tokens, timings, session stats)
- Sidebar integration, smart file “@ mention” referencing

These map closely to our target areas (permissions, CLI integration, session, tool visibility, platform support), though several are out of current Week 5 scope and better suited for future tasks.

## Notable Implementation Patterns (conceptual)

- Permissions via MCP:

  - A dedicated “permissions MCP server” manages workspace-level permission storage and “always allow” rules.
  - Interactive permission dialogs with detailed tool previews, plus YOLO override.
  - Suggestion: Our claude-domain should define a PermissionService abstraction with:
    - Allow/deny decisions with optional persistence (workspace-scoped store).
    - Pattern matching for commands (npm, git, docker) and parameters.
    - YOLO mode toggle surfaced via settings and webview prompt.
    - Optional MCP backend adapter hook (future) to externalize storage or policies.

- WSL Support:

  - Settings for WSL enablement, distro, node path, and Claude path.
  - Command invocation adapts to native vs WSL execution.
  - Suggestion: Incorporate WSL-aware detection & path translation in our detector/launcher, preferably in `vscode-core` utilities (cross-provider reuse), with claude-domain consuming it.

- Session & Resume:

  - Session-aware command execution and automatic resumption.
  - Suggestion: claude-domain SessionManager maintains mapping of sessionId → child process context and supports `--resume` semantics; expose stable API for webview and provider adapters.

- Model Selection:

  - UI dropdown selection with persistence; CLI `--model` passed on invoke.
  - Suggestion: Extend our claude-domain session config to include optional model string; propagate as CLI flag when specified.

- Slash Commands:

  - Rich modal with built-in commands that open VS Code terminal flows and return to chat.
  - Suggestion: Out of Week 5 scope; define a future “CommandRouter” in extension and typed event bus endpoints for invoking CLI subcommands. Keep claude-domain agnostic except for exposing supported flags and contexts.

- Tool Visibility & Results:

  - Nicely formatted tool execution results and progress.
  - Suggestion: In claude-domain, emit structured tool events (start/progress/result) so UI can render consistent statuses. No UI logic in domain layer.

- Analytics:
  - Real-time cost, token, latency, and session stats.
  - Suggestion: Leverage our existing `ai-providers-core` estimation hooks; claude-domain can annotate events with timing and token hints; surface via event bus.

## Mapping to Ptah Architecture

- claude-domain (Week 5 scope):

  - Detector: Platform + WSL-aware CLI detection and version health check.
  - CLI Process Manager/Adapter: Child process lifecycle, JSONL streaming, `--resume`, `--model` support, error handling.
  - Permission Service: Decision engine with YOLO mode and “always allow” patterns; request/response contracts for webview prompts.
  - Tool/Thinking Hooks: Emit typed events for tool execution and thinking content (UI renders).

- vscode-core:

  - Cross-platform utilities (WSL path conversion, process spawning helpers).
  - Event bus channels for permissions, tool events, analytics.

- webview (future):
  - Permission dialogs, settings surfaces (YOLO toggle, pattern lists), tool output components, potential slash commands modal.

## Concrete Recommendations (prioritized)

P0 — Implement within TASK_PRV_004 extraction

1. PermissionService (claude-domain):

   - API: requestPermission(tool: string, args: unknown): Promise<'allow' | 'deny' | 'always_allow'>
   - YOLO toggle support (bypass checks when enabled)
   - “Always allow” rule store (workspace-scoped), pattern matching by command and args
   - Integration: When CLI emits permission requests, translate and call PermissionService; publish typed prompt to webview; accept user response and continue

2. WSL-aware Detector & Launcher:

   - Extend detector to resolve `claude` path considering Windows + WSL settings
   - Provide path translation helpers and environment config for CLI spawn
   - Health check: `claude --version` with timing

3. Session & Resume:

   - Preserve one-process-per-turn; support resume via `--resume <id>`
   - Stable SessionManager API to create/resume/end; maintain process map

4. CLI Options: Model selection passthrough

   - Optional `model?: string` in session/config; append `--model <name>`

5. Event Emission Contracts:
   - Define typed events for: content chunk, thinking, tool:start/progress/result, permission:requested/answered, errors, health

P1 — Adjacent improvements (fast follow or include if trivial)

6. Analytics Hooks:

   - Timestamping, token/cost estimates attached to events; UI can aggregate

7. Test Coverage for domain services:
   - Unit tests for PermissionService patterns and YOLO logic
   - Detector tests with platform/WSL scenarios (mocked)
   - Stream parser robustness tests for JSONL edge cases

P2 — Future tasks (new tickets)

8. Slash Commands Router (extension + webview UI)
9. MCP Permissions Backend (optional adapter)
10. Checkpoints/Restore (git-backed), Conversation History store
11. Image/clipboard attachment flow; workspace image storage conventions
12. Sidebar integration and advanced settings UI

## Risks & Mitigations

- License risk: Do not copy code/markup; write original implementations.
- Platform variance (Windows/WSL/macOS/Linux): Add platform-aware abstraction and targeted tests.
- Stream parsing fragility: Fuzz tests for JSONL parser; graceful fallbacks on parse errors.
- Scope creep: Limit Week 5 to domain extraction + P0 items; defer UI-heavy features.

## References (non-exhaustive)

- Permissions MCP pattern: `claude-code-chat-permissions-mcp/mcp-permissions.ts`
- WSL support: CHANGELOG 0.0.8, README WSL Configuration
- Slash commands & modal: README “Slash Commands Integration”, `src/ui.ts` sections
- Model selection: CHANGELOG 0.0.9; README model selector
- Advanced permissions: CHANGELOG 1.0.0; README “Advanced Permissions System”

## Recommendation

Proceed to software-architect phase for TASK_PRV_004 with P0 scope integrated into the extraction:

- Add PermissionService with YOLO + always-allow rules
- Make detector WSL-aware
- Include session resume and model passthrough in CLI adapter
- Emit typed domain events for tools/thinking/permissions/health/errors

These yield immediate, high-impact enhancements inspired by the reviewed project while staying compliant and within Week 5 boundaries.

# TASK_2025_026: MCP Permission Prompt Tool Integration

## User Intent

Integrate Claude CLI's `--permission-prompt-tool` mechanism with the Ptah extension's MCP server to show permission requests in the VS Code webview UI, allowing users to approve/deny tool executions without terminal interaction.

## Conversation Summary

1. User referenced `task-tracking/permission-handling-mcp-tool.md` documentation
2. User shared screenshot of Claude CLI docs showing `--permission-prompt-tool` flag
3. Requested research on how to integrate permission handling with existing MCP server

## Key Decisions

1. **Architecture**: Extend existing CodeExecutionMCP server (in-process) rather than creating separate MCP server
2. **IPC Method**: Use VS Code postMessage API (not file-based IPC like reference implementation)
3. **Tool Name**: `mcp__ptah__approval_prompt` (follows MCP naming convention)
4. **UI Approach**: Permission requests shown as separate cards in chat UI (not embedded in tool errors)

## Technical Context

- Claude CLI uses `--permission-prompt-tool <mcp_tool_name>` to delegate permission decisions
- MCP tool must return `{ "behavior": "allow"/"deny", ... }` JSON response
- Our MCP server already runs at localhost:51820 with `execute_code` tool
- Frontend already has partial permission UI in ToolCallItemComponent (but post-hoc)

## Files Referenced

- `task-tracking/permission-handling-mcp-tool.md` - Reference architecture
- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- `libs/backend/claude-domain/src/cli/claude-process.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts`

## Research Sources

- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Permission Prompt Tool Playbook](https://www.vibesparking.com/en/blog/ai/claude-code/docs/cli/)
- [GitHub Issue #1175](https://github.com/anthropics/claude-code/issues/1175)

## Status

- [x] Research complete
- [x] Architecture designed
- [x] Implementation plan created
- [ ] Ready for implementation

## Next Steps

1. Create task-description.md (PM deliverable)
2. User approval of requirements
3. Proceed with Phase 1 implementation

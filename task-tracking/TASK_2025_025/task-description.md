# Requirements Document - TASK_2025_025

## Executive Summary

This refactoring task addresses critical issues in the MCP (Model Context Protocol) server registration system introduced in TASK_2025_016. The current implementation has a broken registration mechanism that uses literal strings instead of actual port numbers, and includes 6 unused language model tools that only work with GitHub Copilot, not Claude CLI. This task will fix the registration approach, simplify port management, and remove dead code.

**Business Impact**: Enables Claude CLI to properly discover and connect to Ptah's code execution MCP server, providing full VS Code API access to Claude during conversations.

**Technical Impact**: Reduces codebase complexity by removing 7 unused files and 300+ lines of dead code, while fixing critical registration bug.

**User Impact**: Users will be able to use the `execute_code` tool in Claude CLI without manual configuration.

---

## Functional Requirements

### FR-1: MCP Configuration File Management

**User Story**: As a Ptah extension user, I want the MCP server to be automatically registered with Claude CLI when the extension activates, so that I can use code execution capabilities without manual setup.

#### Acceptance Criteria

1. WHEN extension activates THEN `.mcp.json` file SHALL be created/updated in workspace root
2. WHEN `.mcp.json` already exists with other MCP servers THEN Ptah server configuration SHALL be merged without overwriting existing entries
3. WHEN `.mcp.json` is written THEN actual port number SHALL be used (not environment variable placeholder)
4. WHEN extension deactivates THEN Ptah MCP entry SHALL be removed from `.mcp.json` (optional cleanup)
5. WHEN `.mcp.json` write fails THEN error SHALL be logged with clear user instructions
6. WHEN workspace root cannot be determined THEN registration SHALL be skipped with info-level log

**Technical Details**:

```typescript
// Expected .mcp.json structure
{
  "mcpServers": {
    "ptah": {
      "command": "http",
      "args": ["http://localhost:51820"]  // Actual port number, NOT ${PTAH_MCP_PORT}
    },
    // ... other user-configured MCP servers preserved
  }
}
```

**Files to Modify**:

- CREATE: `libs/backend/claude-domain/src/cli/mcp-config-manager.service.ts`
- DELETE: `libs/backend/claude-domain/src/cli/mcp-registration.service.ts`

---

### FR-2: Fixed Port Configuration

**User Story**: As a Ptah extension user, I want the MCP server to use a predictable port number, so that I can configure firewall rules and troubleshoot connection issues easily.

#### Acceptance Criteria

1. WHEN MCP server starts THEN it SHALL attempt to bind to port 51820 by default
2. WHEN user configures custom port in VS Code settings THEN that port SHALL be used instead
3. WHEN configured port is already in use THEN extension SHALL display error notification with instructions
4. WHEN port binding succeeds THEN port number SHALL be logged at INFO level
5. WHEN port binding fails THEN error SHALL be logged with specific port number and troubleshooting steps

**Configuration Schema**:

```json
// package.json contribution
{
  "configuration": {
    "title": "Ptah",
    "properties": {
      "ptah.mcpPort": {
        "type": "number",
        "default": 51820,
        "minimum": 1024,
        "maximum": 65535,
        "description": "Port number for Ptah MCP server (default: 51820). Change if port conflicts occur."
      }
    }
  }
}
```

**Port Selection Rationale**:

- **51820**: Same as WireGuard VPN default port (unlikely to conflict with typical development tools)
- **Configurable**: Users can override via settings if needed
- **No Random Assignment**: Eliminates discovery complexity

**Files to Modify**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- `apps/ptah-extension-vscode/package.json`

---

### FR-3: Code Cleanup - Remove Unused Language Model Tools

**User Story**: As a Ptah maintainer, I want to remove code that only works with GitHub Copilot, so that the codebase reflects actual functionality supported by Claude CLI.

#### Acceptance Criteria

1. WHEN codebase is built THEN 6 unused language model tool files SHALL NOT be present
2. WHEN codebase is built THEN `LMToolsRegistrationService` SHALL NOT be present
3. WHEN codebase is built THEN tool parameter type definitions SHALL NOT be present (if only used by deleted tools)
4. WHEN package.json is read THEN `languageModelTools` contribution SHALL NOT be present
5. WHEN DI tokens file is read THEN 7 unused tool tokens SHALL NOT be present
6. WHEN DI container is initialized THEN deleted tool registrations SHALL NOT be present
7. WHEN library index file is read THEN deleted tool exports SHALL NOT be present

**Files to DELETE**:

1. `libs/backend/vscode-lm-tools/src/lib/tools/analyze-workspace.tool.ts`
2. `libs/backend/vscode-lm-tools/src/lib/tools/search-files.tool.ts`
3. `libs/backend/vscode-lm-tools/src/lib/tools/get-relevant-files.tool.ts`
4. `libs/backend/vscode-lm-tools/src/lib/tools/get-diagnostics.tool.ts`
5. `libs/backend/vscode-lm-tools/src/lib/tools/find-symbol.tool.ts`
6. `libs/backend/vscode-lm-tools/src/lib/tools/get-git-status.tool.ts`
7. `libs/backend/vscode-lm-tools/src/lib/lm-tools-registration.service.ts`
8. `libs/backend/vscode-lm-tools/src/lib/types/tool-parameters.ts` (verify no other usage first)

**Files to MODIFY** (remove exports/imports):

1. `libs/backend/vscode-lm-tools/src/index.ts` - Remove 6 tool exports + LMToolsRegistrationService export + tool parameter type exports
2. `libs/backend/vscode-core/src/di/tokens.ts` - Remove 7 tokens (6 tool tokens + LM_TOOLS_REGISTRATION_SERVICE)
3. `apps/ptah-extension-vscode/package.json` - Remove `languageModelTools` array (lines 86-182 based on sample)

---

### FR-4: Extension Activation Updates

**User Story**: As a Ptah user, I want the extension to activate cleanly without attempting to register unused tools, so that activation is fast and error-free.

#### Acceptance Criteria

1. WHEN extension activates THEN Step 8 (Language Model Tools registration) SHALL be removed
2. WHEN extension activates THEN Step 9 (MCP server start) SHALL remain unchanged
3. WHEN extension activates THEN Step 10 (MCP registration) SHALL use new MCPConfigManager instead of MCPRegistrationService
4. WHEN MCP config write succeeds THEN success SHALL be logged with actual port number
5. WHEN MCP config write fails THEN warning SHALL be logged (non-blocking, extension continues)
6. WHEN extension deactivates THEN MCP server SHALL be stopped (existing cleanup remains)

**Activation Flow Changes**:

```typescript
// BEFORE (broken)
Step 8: Register Language Model Tools (6 tools) ❌ DELETE
Step 9: Start MCP Server (random port)           ⚠️ MODIFY (use fixed port)
Step 10: Register with `claude mcp add` command  ❌ BROKEN (literal ${PTAH_MCP_PORT})

// AFTER (fixed)
Step 8: [DELETED - no Language Model Tools]
Step 9: Start MCP Server (port 51820)            ✅ FIXED PORT
Step 10: Write .mcp.json with actual port        ✅ WORKING
```

**Files to Modify**:

- `apps/ptah-extension-vscode/src/main.ts` (activate function)
- `apps/ptah-extension-vscode/src/main.ts` (deactivate function - optional cleanup)

---

## Non-Functional Requirements

### NFR-1: Backward Compatibility (DIRECT REPLACEMENT)

**Requirement**: Replace broken MCP registration without maintaining legacy code.

#### Acceptance Criteria

1. WHEN upgrade is performed THEN old `.mcp.json` entries SHALL be overwritten with correct port
2. WHEN upgrade is performed THEN no migration scripts SHALL be required
3. WHEN upgrade is performed THEN users SHALL NOT need to manually reconfigure

**Rationale**: Current implementation is broken, so there's no valid state to preserve. Direct replacement is appropriate.

---

### NFR-2: Error Handling & Logging

**Requirement**: Provide clear error messages and troubleshooting guidance for common failure scenarios.

#### Acceptance Criteria

1. WHEN port binding fails THEN error message SHALL include specific port number and suggestion to change `ptah.mcpPort` setting
2. WHEN `.mcp.json` write fails THEN error message SHALL include file path and permission check instructions
3. WHEN workspace root is missing THEN info-level log SHALL explain why MCP registration was skipped
4. WHEN MCP server starts successfully THEN info log SHALL include URL that Claude CLI will use
5. WHEN any MCP operation fails THEN error SHALL NOT block extension activation (non-critical feature)

**Error Message Examples**:

```typescript
// Port conflict error
`Failed to start MCP server on port ${port}. Port is already in use. Please change 'ptah.mcpPort' setting to use a different port.`// File write error
`Failed to write .mcp.json to ${filePath}. Please check file permissions and try again.`// Success message
`MCP server started at http://localhost:${port}. Claude CLI can now discover Ptah tools.`;
```

---

### NFR-3: User Configuration & Discoverability

**Requirement**: Make MCP port configuration easy to find and understand.

#### Acceptance Criteria

1. WHEN user opens VS Code settings THEN `ptah.mcpPort` setting SHALL be visible under "Ptah" section
2. WHEN user hovers over setting THEN description SHALL explain purpose and default value
3. WHEN user changes port setting THEN extension SHALL NOT require reload (port change only takes effect after restart - document this)
4. WHEN MCP server is running THEN port number SHALL be visible in extension logs

**Documentation Requirements**:

- Setting description must explain: "Port number for Ptah MCP server (default: 51820). Change if port conflicts occur. **Requires extension reload to take effect.**"

---

## Files Affected - Detailed Action Plan

### DELETE (8 files)

| File Path                                                               | Reason                               | Lines Removed  |
| ----------------------------------------------------------------------- | ------------------------------------ | -------------- |
| `libs/backend/vscode-lm-tools/src/lib/tools/analyze-workspace.tool.ts`  | Copilot-only, not used by Claude CLI | ~87            |
| `libs/backend/vscode-lm-tools/src/lib/tools/search-files.tool.ts`       | Copilot-only, not used by Claude CLI | ~70            |
| `libs/backend/vscode-lm-tools/src/lib/tools/get-relevant-files.tool.ts` | Copilot-only, not used by Claude CLI | ~65            |
| `libs/backend/vscode-lm-tools/src/lib/tools/get-diagnostics.tool.ts`    | Copilot-only, not used by Claude CLI | ~75            |
| `libs/backend/vscode-lm-tools/src/lib/tools/find-symbol.tool.ts`        | Copilot-only, not used by Claude CLI | ~80            |
| `libs/backend/vscode-lm-tools/src/lib/tools/get-git-status.tool.ts`     | Copilot-only, not used by Claude CLI | ~60            |
| `libs/backend/vscode-lm-tools/src/lib/lm-tools-registration.service.ts` | Registers deleted tools              | ~70            |
| `libs/backend/vscode-lm-tools/src/lib/types/tool-parameters.ts`         | Type definitions for deleted tools   | ~50            |
| `libs/backend/claude-domain/src/cli/mcp-registration.service.ts`        | Broken registration logic (replaced) | ~115           |
| **TOTAL**                                                               |                                      | **~672 lines** |

### CREATE (1 file)

| File Path                                                          | Purpose                            | Estimated Lines |
| ------------------------------------------------------------------ | ---------------------------------- | --------------- |
| `libs/backend/claude-domain/src/cli/mcp-config-manager.service.ts` | Direct `.mcp.json` file management | ~150            |

### MODIFY (6 files)

| File Path                                                                           | Action                                                                             | Lines Changed           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| `libs/backend/vscode-lm-tools/src/index.ts`                                         | Remove 6 tool exports + LMToolsRegistrationService export + parameter type exports | ~10                     |
| `libs/backend/vscode-core/src/di/tokens.ts`                                         | Remove 7 DI tokens (6 tools + registration service)                                | ~14                     |
| `apps/ptah-extension-vscode/package.json`                                           | Remove `languageModelTools` contribution (~96 lines), add `ptah.mcpPort` setting   | ~96 removed, ~10 added  |
| `apps/ptah-extension-vscode/src/main.ts`                                            | Remove Step 8 (LM tools), update Step 10 (use MCPConfigManager)                    | ~20                     |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` | Use fixed port instead of random port                                              | ~15                     |
| `apps/ptah-extension-vscode/src/di/container.ts`                                    | Remove LM tool DI registrations, update MCP registration service                   | ~20                     |
| **TOTAL**                                                                           |                                                                                    | **~175 lines modified** |

---

## Acceptance Criteria - End-to-End

### AC-1: MCP Server Registration

**Scenario**: User activates Ptah extension with no existing `.mcp.json`

**Given** workspace root is `/Users/user/my-project`
**And** port 51820 is available
**When** extension activates
**Then** `.mcp.json` SHALL be created at `/Users/user/my-project/.mcp.json`
**And** file SHALL contain `{ "mcpServers": { "ptah": { "command": "http", "args": ["http://localhost:51820"] } } }`
**And** MCP server SHALL be running at `http://localhost:51820`
**And** GET request to `http://localhost:51820/health` SHALL return `{"status": "ok", "port": 51820}`

---

### AC-2: MCP Server Port Conflict

**Scenario**: User activates Ptah extension when port 51820 is already in use

**Given** port 51820 is already bound by another process
**When** extension activates
**Then** error notification SHALL be displayed
**And** notification SHALL include message: "Failed to start MCP server on port 51820. Port is already in use. Please change 'ptah.mcpPort' setting to use a different port."
**And** extension activation SHALL NOT fail (other features still work)

---

### AC-3: Custom Port Configuration

**Scenario**: User configures custom MCP port

**Given** user sets `ptah.mcpPort` to `52000` in VS Code settings
**When** extension activates
**Then** MCP server SHALL start on port `52000`
**And** `.mcp.json` SHALL contain `"args": ["http://localhost:52000"]`
**And** logs SHALL show "MCP server started at http://localhost:52000"

---

### AC-4: Code Cleanup Verification

**Scenario**: Verify all unused code is removed

**Given** refactoring is complete
**When** `nx build ptah-extension-vscode` is executed
**Then** build SHALL succeed with no errors
**And** `libs/backend/vscode-lm-tools/src/lib/tools/` directory SHALL NOT exist
**And** `grep -r "AnalyzeWorkspaceTool" --include="*.ts"` SHALL return 0 results
**And** `grep -r "LMToolsRegistrationService" --include="*.ts"` SHALL return 0 results
**And** `package.json` SHALL NOT contain `languageModelTools` key

---

### AC-5: Claude CLI Integration

**Scenario**: Claude CLI discovers and uses Ptah MCP server

**Given** Ptah extension is activated
**And** `.mcp.json` contains Ptah server entry
**When** user runs `claude` in workspace directory
**And** user types message that requires code execution
**Then** Claude CLI SHALL discover Ptah MCP server
**And** `execute_code` tool SHALL be available in Claude's tool list
**And** Claude SHALL be able to execute TypeScript code via Ptah's API

---

## Out of Scope

### Explicitly NOT Included

1. **MCP Server Auto-Restart**: If port configuration changes, user must reload extension manually
2. **Multi-Workspace Support**: If multiple workspaces are open, only active workspace gets `.mcp.json`
3. **MCP Server Authentication**: No authentication mechanism (localhost-only is sufficient)
4. **Dynamic Port Discovery**: No automatic port selection if configured port is in use (user must manually change setting)
5. **Migration of Existing Configurations**: No attempt to detect or migrate old broken configurations (direct replacement)
6. **Backward Compatibility with TASK_2025_016**: Previous implementation was broken, no compatibility needed

---

## Dependencies & Integration Points

### Internal Dependencies

| Dependency                               | Usage                                    | Risk Level                |
| ---------------------------------------- | ---------------------------------------- | ------------------------- |
| `@ptah-extension/vscode-core`            | TOKENS for DI, Logger interface          | Low - stable              |
| `@ptah-extension/workspace-intelligence` | Used by deleted tools (no longer needed) | None - dependency removed |
| Node.js `http` module                    | MCP server (existing, unchanged)         | Low - stable              |
| Node.js `fs/promises`                    | `.mcp.json` file writing                 | Low - standard API        |

### External Dependencies

| Dependency  | Usage                                                  | Risk Level                              |
| ----------- | ------------------------------------------------------ | --------------------------------------- |
| Claude CLI  | Reads `.mcp.json` for MCP server discovery             | Medium - depends on Claude CLI behavior |
| VS Code API | `vscode.workspace.getConfiguration()` for port setting | Low - stable API                        |

### Configuration Files Affected

| File            | Change                                                  | Validation Method                   |
| --------------- | ------------------------------------------------------- | ----------------------------------- |
| `.mcp.json`     | Created/updated at runtime                              | JSON schema validation              |
| `package.json`  | Remove `languageModelTools`, add `ptah.mcpPort` setting | VS Code validates on extension load |
| `tsconfig.json` | No changes                                              | N/A                                 |

---

## Risk Analysis

### Technical Risks

| Risk                                         | Probability | Impact | Mitigation Strategy                                                      |
| -------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------ |
| **Claude CLI .mcp.json format changes**      | Low         | High   | Monitor Anthropic documentation; implement version check                 |
| **Port conflict with other services**        | Medium      | Medium | Clear error messages; user-configurable port                             |
| **File permission errors writing .mcp.json** | Low         | Medium | Comprehensive error handling; fallback to user manual setup instructions |
| **Breaking existing user workflows**         | Low         | Low    | Current implementation is broken, so no valid workflows exist            |
| **DI container resolution failures**         | Low         | High   | Thorough testing; verify all token removals are complete                 |

### Business Risks

| Risk                                     | Probability | Impact   | Mitigation Strategy                                            |
| ---------------------------------------- | ----------- | -------- | -------------------------------------------------------------- |
| **User confusion about missing tools**   | Low         | Low      | Tools were never documented or usable with Claude CLI          |
| **Support requests for port conflicts**  | Medium      | Low      | Detailed error messages with troubleshooting steps             |
| **Loss of GitHub Copilot compatibility** | Low         | Critical | Acknowledge limitation; focus on Claude CLI (primary use case) |

---

## Success Metrics

### Quantitative Metrics

1. **Code Reduction**: 672 lines of unused code removed
2. **Build Time**: No measurable impact (code removal may slightly improve)
3. **Extension Activation Time**: Remove ~50ms (LM tools registration overhead)
4. **MCP Registration Success Rate**: 95% success rate (excluding port conflicts)

### Qualitative Metrics

1. **Code Maintainability**: Codebase reflects actual functionality
2. **User Experience**: Clear error messages for troubleshooting
3. **Developer Experience**: Fewer files to navigate, clearer architecture

---

## Testing Requirements

### Unit Tests

1. **MCPConfigManager**:

   - Test `.mcp.json` creation with empty file
   - Test `.mcp.json` merge with existing servers
   - Test error handling for file write failures
   - Test port number substitution

2. **CodeExecutionMCP**:
   - Test port binding to configured port
   - Test error handling for port conflicts
   - Test health check endpoint with correct port

### Integration Tests

1. **Extension Activation**:

   - Test successful activation with no errors
   - Test MCP server starts on correct port
   - Test `.mcp.json` is written correctly

2. **Configuration Changes**:
   - Test custom port setting is respected
   - Test invalid port values are rejected (< 1024, > 65535)

### Manual Testing Scenarios

1. **First-time Activation**: Install extension, verify `.mcp.json` created
2. **Port Conflict**: Bind port 51820 externally, verify error message
3. **Custom Port**: Set custom port, verify MCP server uses it
4. **Claude CLI Integration**: Run `claude` in workspace, verify `execute_code` tool available

---

## Implementation Phases

### Phase 1: Cleanup (Priority: High)

**Goal**: Remove unused code to simplify codebase

1. Delete 6 tool files
2. Delete `LMToolsRegistrationService`
3. Delete tool parameter types file
4. Remove tool exports from library index
5. Remove DI tokens
6. Remove `languageModelTools` from package.json
7. Remove tool registrations from DI container
8. Remove Step 8 from activation sequence

**Validation**: `nx build ptah-extension-vscode` succeeds

---

### Phase 2: Port Configuration (Priority: High)

**Goal**: Implement fixed port with user override

1. Add `ptah.mcpPort` setting to package.json
2. Modify `CodeExecutionMCP.start()` to use configured port
3. Update error handling for port conflicts
4. Test port configuration changes

**Validation**: Extension activates with correct port

---

### Phase 3: MCP Config Manager (Priority: Critical)

**Goal**: Fix broken MCP registration

1. Create `MCPConfigManager` service
2. Implement `.mcp.json` read/merge/write logic
3. Add error handling for file operations
4. Replace `MCPRegistrationService` in DI container
5. Update activation sequence (Step 10)
6. Update deactivation cleanup (optional)

**Validation**: `.mcp.json` created with correct port

---

### Phase 4: Testing & Validation (Priority: Critical)

**Goal**: Ensure end-to-end functionality

1. Unit test `MCPConfigManager`
2. Unit test port configuration
3. Integration test activation sequence
4. Manual test with Claude CLI
5. Test error scenarios (port conflict, file permissions)

**Validation**: All acceptance criteria pass

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                      | Impact Level | Success Criteria                                |
| -------------------------------- | ------------ | ----------------------------------------------- |
| **End Users (Claude CLI users)** | High         | `execute_code` tool works without manual setup  |
| **Extension Maintainers**        | High         | Codebase is cleaner, no dead code               |
| **Ptah Contributors**            | Medium       | Fewer files to understand, clearer architecture |

### Secondary Stakeholders

| Stakeholder                       | Impact Level | Success Criteria                                                          |
| --------------------------------- | ------------ | ------------------------------------------------------------------------- |
| **GitHub Copilot Users**          | Medium       | Understand tool removal doesn't affect them (different integration point) |
| **VS Code Extension Marketplace** | Low          | Extension metadata accurate (no false tool claims)                        |

---

## Documentation Requirements

### Code Documentation

1. **MCPConfigManager**: JSDoc with examples of `.mcp.json` structure
2. **CodeExecutionMCP**: Update comments to reflect fixed port approach
3. **main.ts**: Update activation step comments

### User Documentation

1. **Settings Documentation**: Add description for `ptah.mcpPort` setting
2. **Troubleshooting Guide**: Document port conflict resolution
3. **Changelog**: Document removal of unused tools and registration fix

### Developer Documentation

1. **Architecture Decision Record**: Document why Language Model Tools were removed
2. **Migration Guide**: Explain changes from TASK_2025_016 to TASK_2025_025

---

## Compliance & Security

### Security Considerations

1. **Localhost-only Binding**: MCP server SHALL only bind to `127.0.0.1` (not `0.0.0.0`)
2. **No Authentication Required**: Localhost binding provides sufficient security boundary
3. **User Code Execution**: Existing AsyncFunction sandboxing remains unchanged

### Compliance Requirements

1. **VS Code Extension Guidelines**: Extension must declare all contributed configuration points
2. **Semantic Versioning**: Changes constitute a patch release (bug fix)

---

## Appendix A: Technical Background

### Why Language Model Tools Don't Work with Claude CLI

**VS Code Language Model Tools** (`vscode.lm.registerTool`) are designed for the **VS Code Language Model API**, which is used by GitHub Copilot and VS Code's built-in chat features.

**Claude CLI** uses the **Model Context Protocol (MCP)**, which is a completely different integration mechanism:

| Feature          | Language Model Tools         | MCP                       |
| ---------------- | ---------------------------- | ------------------------- |
| **Registration** | `vscode.lm.registerTool()`   | HTTP server + `.mcp.json` |
| **Discovery**    | VS Code extension API        | File-based configuration  |
| **Transport**    | In-process function calls    | HTTP JSON-RPC 2.0         |
| **Tool Schema**  | VS Code-specific             | JSON Schema               |
| **Consumers**    | GitHub Copilot, VS Code Chat | Claude CLI                |

**Conclusion**: The 6 deleted tools were created for GitHub Copilot integration but are completely unusable by Claude CLI. The MCP server (`CodeExecutionMCP`) provides equivalent functionality for Claude CLI via a different mechanism.

---

## Appendix B: .mcp.json File Format Reference

### Official Schema (Anthropic)

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "http" | "stdio" | "node",
      "args": ["<arg1>", "<arg2>"],
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### Ptah Configuration

```json
{
  "mcpServers": {
    "ptah": {
      "command": "http",
      "args": ["http://localhost:51820"]
    }
  }
}
```

**Key Points**:

- `command: "http"`: HTTP transport (alternative to stdio)
- `args[0]`: Base URL of HTTP MCP server
- No `env` needed (port is in URL)

---

## Appendix C: Port Selection Rationale

### Why Port 51820?

1. **High Port Number**: Above 1024 (no root required)
2. **Unlikely Conflict**: Same as WireGuard VPN (not commonly used in development)
3. **Memorable**: Easy to remember for troubleshooting
4. **Configurable**: Users can override if needed

### Alternative Ports Considered

| Port       | Reason for Rejection                                |
| ---------- | --------------------------------------------------- |
| **3000**   | Common development port (Create React App, Express) |
| **4200**   | Angular dev server default                          |
| **5173**   | Vite dev server default                             |
| **8080**   | Common HTTP alternative port                        |
| **Random** | Current approach - causes discovery problems        |

**Decision**: 51820 provides best balance of availability and configurability.

---

**Document Version**: 1.0
**Created**: 2025-11-27
**Author**: Project Manager (AI Agent)
**Related Tasks**: TASK_2025_016 (Code Execution API - predecessor task)

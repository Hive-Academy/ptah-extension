# Additional Findings - TASK_2025_107

**Date**: 2026-01-20
**Requested by**: User (follow-up investigation)

---

## 1. Premium Feature Dev/Test Flag

### Finding: NO FLAG EXISTS

**Impact**: CRITICAL for development workflow

**Current State**:

- No environment variable to bypass license checks for local testing
- Searched for: `PTAH_FORCE_PREMIUM`, `DEBUG_PREMIUM`, `DEV_MODE`, `BYPASS_LICENSE`, `TEST_LICENSE`
- Result: No flags found in `apps/ptah-extension-vscode/src/`

**Developer Experience Problem**:

- To test premium features locally, developers must:
  1. Run the license server locally
  2. Create a license in the database
  3. Enter the license key in VS Code
- This is cumbersome for rapid iteration

**Recommendation**: Add `PTAH_FORCE_PREMIUM` environment variable

```typescript
// In main.ts (license verification section)
const FORCE_PREMIUM = process.env['PTAH_FORCE_PREMIUM'] === 'true';

if (FORCE_PREMIUM) {
  logger.warn('⚠️ DEV MODE: Forcing premium features (PTAH_FORCE_PREMIUM=true)');
}

// Modified check
if (FORCE_PREMIUM || (licenseStatus.valid && licenseStatus.tier !== 'free')) {
  // Start MCP server...
}
```

**Launch.json Integration**:

```json
{
  "configurations": [
    {
      "name": "Launch Extension (Premium Mode)",
      "type": "extensionHost",
      "request": "launch",
      "env": {
        "PTAH_FORCE_PREMIUM": "true"
      }
    }
  ]
}
```

---

## 2. MCP Configuration to Claude SDK

### Finding: MCP IS CONFIGURED CORRECTLY

**Location**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**Implementation**:

```typescript
// Line 40
const PTAH_MCP_PORT = 51820;

// Lines 263-272
private buildMcpServers(): Record<string, McpHttpServerConfig> {
  return {
    ptah: {
      type: 'http',
      url: `http://localhost:${PTAH_MCP_PORT}`,
    },
  };
}
```

**Result**:

- MCP server is always configured in SDK options
- If MCP server isn't running (free tier), SDK will fail to connect but won't crash
- Claude sees `ptah` as an available MCP server

---

## 3. System Prompt for Ptah Tools

### Finding: CRITICAL GAP - NOT BEING APPENDED

**Impact**: CRITICAL for premium feature value

**Current State**:

1. **`PTAH_SYSTEM_PROMPT` exists** (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`):

   - Well-crafted prompt describing 13 namespaces
   - Includes cost optimization tips, token intelligence, IDE powers
   - Example usage patterns

2. **Used in MCP Tool Description** (`tool-description.builder.ts:81`):

   - Included in `execute_code` tool description
   - Claude sees this when listing available tools
   - BUT: This is passive - Claude must choose to inspect the tool first

3. **NOT Used in SDK Session System Prompt**:
   - `SdkQueryOptionsBuilder.buildSystemPrompt()` only uses `sessionConfig.systemPrompt` from frontend
   - `PTAH_SYSTEM_PROMPT` is NEVER imported or used in SDK query building
   - Claude starts sessions without knowing about Ptah capabilities

**Why This Matters**:

```
Without System Prompt Append:
┌───────────────────────────────────────────────────────┐
│  Claude Session                                        │
│                                                        │
│  System: "Claude Code preset"                          │
│  MCP Servers: { ptah: http://localhost:51820 }         │
│                                                        │
│  Problem: Claude doesn't know Ptah has IDE powers,     │
│  cost optimization, token management, etc.             │
│  Claude may ignore Ptah tools in favor of built-ins.   │
└───────────────────────────────────────────────────────┘

With System Prompt Append:
┌───────────────────────────────────────────────────────┐
│  Claude Session                                        │
│                                                        │
│  System: "Claude Code preset"                          │
│  + "You have access to Ptah MCP Server with 13        │
│     specialized namespaces... Cost Optimization:       │
│     Use ptah.ai.invokeAgent() for 150x cheaper..."     │
│                                                        │
│  MCP Servers: { ptah: http://localhost:51820 }         │
│                                                        │
│  Result: Claude actively uses Ptah for cost savings,   │
│  LSP operations, token management, etc.                │
└───────────────────────────────────────────────────────┘
```

**Recommendation**: Append `PTAH_SYSTEM_PROMPT` for premium users

```typescript
// In SdkQueryOptionsBuilder.buildSystemPrompt()

import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';

private buildSystemPrompt(
  sessionConfig?: AISessionConfig,
  isPremium: boolean = false  // NEW: Pass premium status
): SdkQueryOptions['systemPrompt'] {
  // Build append content
  const appendParts: string[] = [];

  // Add user's custom system prompt if provided
  if (sessionConfig?.systemPrompt) {
    appendParts.push(sessionConfig.systemPrompt);
  }

  // Add Ptah MCP prompt for premium users
  if (isPremium) {
    appendParts.push(PTAH_SYSTEM_PROMPT);
  }

  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}
```

**Integration Point**: Need to pass `isPremium` flag from:

1. `ChatRpcHandlers` → `SdkAgentAdapter` → `SdkQueryOptionsBuilder`
2. Or inject `LicenseService` into `SdkQueryOptionsBuilder`

---

## 4. Summary of Critical Findings

| Issue                        | Severity     | Impact                        | Priority |
| ---------------------------- | ------------ | ----------------------------- | -------- |
| No dev/test flag for premium | Medium       | Dev workflow friction         | P2       |
| System prompt not appended   | **CRITICAL** | Premium feature underutilized | **P1**   |
| MCP config is correct        | N/A          | Working as designed           | N/A      |

---

## 5. Recommended Implementation Order

### Phase 1: Critical (Before Launch)

1. **Append `PTAH_SYSTEM_PROMPT` for premium users** (P1)
   - Modify `SdkQueryOptionsBuilder`
   - Pass premium status through DI or config
   - Ensure system prompt is only added when MCP server is running

### Phase 2: Developer Experience

2. **Add `PTAH_FORCE_PREMIUM` environment variable** (P2)
   - Modify `main.ts` license check
   - Add VS Code launch configuration
   - Document in README

### Phase 3: Polish

3. **Consider conditional system prompt content**
   - Different prompts for different tiers (future)
   - Namespace-specific instructions based on workspace type

---

## 6. Files to Modify

### For System Prompt Fix (P1)

| File                                                                        | Change                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`       | Import `PTAH_SYSTEM_PROMPT`, modify `buildSystemPrompt()` |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                       | Pass premium status to query builder                      |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | Get premium status from LicenseService                    |

### For Dev Flag (P2)

| File                                     | Change                         |
| ---------------------------------------- | ------------------------------ |
| `apps/ptah-extension-vscode/src/main.ts` | Add `PTAH_FORCE_PREMIUM` check |
| `.vscode/launch.json`                    | Add premium dev configuration  |
| `README.md`                              | Document dev flag              |

---

## 7. Code Snippet: System Prompt Integration

```typescript
// sdk-query-options-builder.ts - Updated build() method

async build(input: QueryOptionsInput): Promise<QueryConfig> {
  const { sessionConfig, isPremium } = input;  // Add isPremium

  // ...existing code...

  // Build system prompt with premium awareness
  const systemPrompt = this.buildSystemPrompt(sessionConfig, isPremium);

  // ...rest of build...
}

private buildSystemPrompt(
  sessionConfig?: AISessionConfig,
  isPremium: boolean = false
): SdkQueryOptions['systemPrompt'] {
  const appendParts: string[] = [];

  if (sessionConfig?.systemPrompt) {
    appendParts.push(sessionConfig.systemPrompt);
  }

  // CRITICAL: Add Ptah MCP tools awareness for premium users
  if (isPremium) {
    appendParts.push(PTAH_SYSTEM_PROMPT);
  }

  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}
```

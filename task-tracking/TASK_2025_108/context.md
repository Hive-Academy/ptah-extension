# Task Context - TASK_2025_108

## User Intent

Fix critical premium feature enforcement issues discovered during TASK_2025_107 audit:

1. **MCP Server Always Configured (BUG)**: `SdkQueryOptionsBuilder.buildMcpServers()` always returns ptah MCP config, even for free tier users. This exposes premium feature configuration to all users.

2. **System Prompt Not Appended (CRITICAL GAP)**: The `PTAH_SYSTEM_PROMPT` exists but is NOT being appended to SDK sessions. Claude doesn't know about Ptah's premium capabilities (cost optimization, IDE powers, token management).

3. **Dev License Script**: Document/script for generating local development licenses using the existing license server admin API (instead of a bypass flag - more secure approach).

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2026-01-20
- Type: BUGFIX (Security + Feature Gap)
- Complexity: Medium
- Parent Task: TASK_2025_107 (License Verification Audit)

## Problem Analysis

### Issue 1: MCP Server Configuration (Security)

**Current Code** (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`):

```typescript
// Line 212 - ALWAYS called regardless of license
mcpServers: this.buildMcpServers(),

// Lines 263-272 - Returns ptah config UNCONDITIONALLY
private buildMcpServers(): Record<string, McpHttpServerConfig> {
  return {
    ptah: {
      type: 'http',
      url: `http://localhost:${PTAH_MCP_PORT}`,
    },
  };
}
```

**Impact**:

- Free tier users have MCP server configured in SDK sessions
- Claude sees `ptah` as available MCP server
- Claude may attempt to use tools that don't exist (server not running)
- Exposes premium feature configuration to non-paying users

**Required Fix**:

- Make `buildMcpServers()` conditional on premium status
- Return empty object `{}` for free tier users
- Pass premium status through the builder

### Issue 2: System Prompt Not Appended (Feature Gap)

**Current Code** (`sdk-query-options-builder.ts`):

```typescript
private buildSystemPrompt(
  sessionConfig?: AISessionConfig
): SdkQueryOptions['systemPrompt'] {
  if (sessionConfig?.systemPrompt) {
    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: sessionConfig.systemPrompt,
    };
  }
  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
  };
}
```

**Impact**:

- `PTAH_SYSTEM_PROMPT` constant exists in `vscode-lm-tools` but is NEVER used
- Claude starts sessions without knowledge of Ptah capabilities
- Premium features underutilized (cost optimization, IDE powers)
- Diminished premium value proposition

**Required Fix**:

- Import `PTAH_SYSTEM_PROMPT` from `@ptah-extension/vscode-lm-tools`
- Append to system prompt ONLY for premium users
- Couple MCP config and system prompt (both or neither)

### Issue 3: Dev License Generation

**Existing Infrastructure**:

- License server: `apps/ptah-license-server/`
- Admin API: `POST /api/v1/admin/licenses`
- Guard: `AdminApiKeyGuard` validates `X-API-Key` header
- DTO: `{ email, plan: 'free' | 'early_adopter', sendEmail?: boolean }`

**Required**:

- Document the dev setup process
- Optional: Create a helper script to generate dev licenses

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  License-Aware SDK Configuration                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SdkQueryOptionsBuilder.build(input)                        │
│    ↓                                                        │
│  Check isPremium flag (passed from RPC handler)             │
│    ↓                                                        │
│  ┌─────────────────┐         ┌─────────────────────────┐   │
│  │ FREE TIER       │         │ PREMIUM TIER            │   │
│  ├─────────────────┤         ├─────────────────────────┤   │
│  │ mcpServers: {}  │         │ mcpServers: { ptah }    │   │
│  │ systemPrompt:   │         │ systemPrompt:           │   │
│  │   preset only   │         │   preset + PTAH_PROMPT  │   │
│  └─────────────────┘         └─────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Files to Modify

### Backend (agent-sdk)

| File                                                                  | Change                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` | Add `isPremium` to input, conditional MCP + system prompt |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                 | Pass `isPremium` to query builder                         |

### Backend (RPC handlers)

| File                                                                        | Change                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | Get premium status from LicenseService, pass to adapter |

### Documentation

| File                              | Change                           |
| --------------------------------- | -------------------------------- |
| `docs/DEV_LICENSE_SETUP.md` (NEW) | Document local dev license setup |

## Acceptance Criteria

1. **Free Tier**: `mcpServers: {}`, no system prompt append
2. **Premium Tier**: `mcpServers: { ptah }`, system prompt includes `PTAH_SYSTEM_PROMPT`
3. **Dev Setup**: Documented process for generating local dev licenses
4. **Tests**: Unit tests for conditional behavior

## Related Tasks

- TASK_2025_107: License Verification Audit (research)
- TASK_2025_075: Simplified License Server (In Progress)
- TASK_2025_079: Settings Conditional Visibility & Premium Gating (Complete)

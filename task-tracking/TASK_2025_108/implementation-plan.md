# Implementation Plan - TASK_2025_108

## Overview

Fix premium feature enforcement by making MCP configuration and system prompt conditional on license status.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Flow: License Status → SDK Configuration                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ChatRpcHandlers                                                │
│       │                                                         │
│       │ 1. Inject LicenseService                                │
│       │ 2. Call licenseService.verifyLicense()                  │
│       │ 3. Extract isPremium from status                        │
│       ▼                                                         │
│  SdkAgentAdapter.startChatSession({ ..., isPremium })           │
│       │                                                         │
│       │ 4. Pass isPremium to query builder                      │
│       ▼                                                         │
│  SdkQueryOptionsBuilder.build({ ..., isPremium })               │
│       │                                                         │
│       ├─── buildMcpServers(isPremium)                           │
│       │         │                                               │
│       │         └─── if (isPremium) return { ptah: {...} }      │
│       │              else return {}                             │
│       │                                                         │
│       └─── buildSystemPrompt(sessionConfig, isPremium)          │
│                 │                                               │
│                 └─── if (isPremium) append PTAH_SYSTEM_PROMPT   │
│                      else return preset only                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Batch 1: SDK Query Options Builder (Core Fix)

### File: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**Changes**:

1. **Add `isPremium` to `QueryOptionsInput` interface**:
```typescript
export interface QueryOptionsInput {
  // ... existing fields
  /** Premium user flag - enables MCP server and Ptah system prompt */
  isPremium?: boolean;
}
```

2. **Import `PTAH_SYSTEM_PROMPT`**:
```typescript
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';
```

3. **Modify `build()` to pass isPremium**:
```typescript
async build(input: QueryOptionsInput): Promise<QueryConfig> {
  const { isPremium = false } = input;
  // ...
  const systemPrompt = this.buildSystemPrompt(sessionConfig, isPremium);
  // ...
  return {
    options: {
      // ...
      mcpServers: this.buildMcpServers(isPremium),
      // ...
    }
  };
}
```

4. **Modify `buildMcpServers()` to be conditional**:
```typescript
private buildMcpServers(isPremium: boolean): Record<string, McpHttpServerConfig> {
  if (!isPremium) {
    this.logger.debug('[SdkQueryOptionsBuilder] Free tier - MCP servers disabled');
    return {};
  }

  // Premium user - enable Ptah MCP server
  return {
    ptah: {
      type: 'http',
      url: `http://localhost:${PTAH_MCP_PORT}`,
    },
  };
}
```

5. **Modify `buildSystemPrompt()` to append PTAH_SYSTEM_PROMPT**:
```typescript
private buildSystemPrompt(
  sessionConfig?: AISessionConfig,
  isPremium: boolean = false
): SdkQueryOptions['systemPrompt'] {
  const appendParts: string[] = [];

  // Add user's custom system prompt if provided
  if (sessionConfig?.systemPrompt) {
    appendParts.push(sessionConfig.systemPrompt);
  }

  // Add Ptah MCP tools awareness for premium users
  if (isPremium) {
    this.logger.debug('[SdkQueryOptionsBuilder] Premium tier - appending Ptah system prompt');
    appendParts.push(PTAH_SYSTEM_PROMPT);
  }

  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}
```

---

## Batch 2: SDK Agent Adapter (Pass isPremium)

### File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

**Changes**:

1. **Update `StartSessionConfig` interface** (or wherever session config is defined):
```typescript
interface StartSessionConfig {
  // ... existing fields
  isPremium?: boolean;
}
```

2. **Pass `isPremium` to query builder in `startChatSession()`**:
```typescript
async startChatSession(config: StartSessionConfig): Promise<AsyncIterable<FlatStreamEventUnion>> {
  const { isPremium = false } = config;

  const queryConfig = await this.queryOptionsBuilder.build({
    // ... existing fields
    isPremium,
  });
  // ...
}
```

3. **Similarly update `resumeSession()` if needed**

---

## Batch 3: Chat RPC Handlers (Get License Status)

### File: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

**Changes**:

1. **Inject `LicenseService`**:
```typescript
import { LicenseService, TOKENS } from '@ptah-extension/vscode-core';

@injectable()
export class ChatRpcHandlers {
  constructor(
    // ... existing injections
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
  ) {}
}
```

2. **Get premium status in `registerChatStart()`**:
```typescript
private registerChatStart(): void {
  this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
    'chat:start',
    async (params) => {
      // Get license status
      const licenseStatus = await this.licenseService.verifyLicense();
      const isPremium = licenseStatus.valid && licenseStatus.tier !== 'free';

      this.logger.debug('RPC: chat:start - license check', {
        tier: licenseStatus.tier,
        isPremium,
      });

      // Pass to adapter
      const stream = await this.sdkAdapter.startChatSession({
        // ... existing fields
        isPremium,
      });
      // ...
    }
  );
}
```

3. **Similarly update `registerChatContinue()` for resume scenarios**

---

## Batch 4: Dev License Documentation

### File: `docs/DEV_LICENSE_SETUP.md` (NEW)

**Content**:

```markdown
# Local Development License Setup

This guide explains how to generate a license key for local development.

## Prerequisites

1. PostgreSQL database running locally
2. Node.js 20+

## Step 1: Start the License Server

```bash
# Navigate to workspace root
cd /path/to/ptah-extension

# Set environment variables
export DATABASE_URL="postgresql://user:password@localhost:5432/ptah_licenses"
export ADMIN_API_KEY="your-dev-admin-key"
export JWT_SECRET="your-dev-jwt-secret"

# Run migrations (first time only)
cd apps/ptah-license-server
npx prisma migrate dev

# Start the server
nx serve ptah-license-server
```

## Step 2: Generate a Dev License

```bash
# Create early_adopter license (skip email)
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-dev-admin-key" \
  -d '{
    "email": "dev@localhost.local",
    "plan": "early_adopter",
    "sendEmail": false
  }'

# Response:
# {
#   "success": true,
#   "license": {
#     "licenseKey": "ptah_lic_a1b2c3...",
#     "plan": "early_adopter",
#     "status": "active",
#     "expiresAt": "2026-03-20T..."
#   }
# }
```

## Step 3: Enter License in VS Code

1. Open VS Code with Ptah extension
2. Run command: `Ptah: Enter License Key`
3. Paste the `licenseKey` from Step 2
4. Reload window

## Troubleshooting

### License server URL

By default, LicenseService connects to `https://api.ptah.dev`. For local development:

```bash
# Set environment variable before launching VS Code
export PTAH_LICENSE_SERVER_URL="http://localhost:3000"
code .
```

### License expires

Dev licenses use the `early_adopter` plan which expires after 60 days.
Generate a new license when needed.

### Database reset

If you need to reset the database:
```bash
npx prisma migrate reset
```
```

---

## Batch 5: Update Logging

### Enhanced logging for premium feature activation

In `sdk-query-options-builder.ts`:
```typescript
this.logger.info('[SdkQueryOptionsBuilder] Building SDK query options', {
  cwd,
  model,
  isResume: !!resumeSessionId,
  isPremium,  // NEW
  mcpEnabled: isPremium,  // NEW
  ptahSystemPromptAppended: isPremium,  // NEW
});
```

---

## Test Cases

### Unit Tests

1. **Free tier user**:
   - `buildMcpServers(false)` returns `{}`
   - `buildSystemPrompt(config, false)` returns preset only

2. **Premium tier user**:
   - `buildMcpServers(true)` returns `{ ptah: {...} }`
   - `buildSystemPrompt(config, true)` includes `PTAH_SYSTEM_PROMPT`

3. **Premium + custom system prompt**:
   - Both custom prompt and PTAH_SYSTEM_PROMPT appended

### Integration Tests

1. Start chat with free tier → verify no MCP in SDK options
2. Start chat with premium tier → verify MCP and system prompt

---

## Rollout Plan

1. **Implement Batch 1-3** (core fix)
2. **Test locally** with dev license
3. **Implement Batch 4** (documentation)
4. **Implement Batch 5** (logging)
5. **Code review** (style + logic)
6. **Merge to feature branch**

---

## Dependencies

- `@ptah-extension/vscode-lm-tools` → `PTAH_SYSTEM_PROMPT` export
- `@ptah-extension/vscode-core` → `LicenseService`, `TOKENS.LICENSE_SERVICE`

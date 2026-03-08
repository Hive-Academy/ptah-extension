# Development Tasks - TASK_2025_108

**Total Tasks**: 9 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- [x] `PTAH_SYSTEM_PROMPT` exists in `@ptah-extension/vscode-lm-tools` and is exported
- [x] `LicenseService` exists with `TOKENS.LICENSE_SERVICE` in `@ptah-extension/vscode-core`
- [x] `LicenseStatus` interface has `tier: 'free' | 'early_adopter'` and `plan?.isPremium: boolean`
- [x] `QueryOptionsInput` interface exists and can be extended
- [x] Data flow: ChatRpcHandlers -> SdkAgentAdapter -> SessionLifecycleManager -> SdkQueryOptionsBuilder

### Risks Identified

| Risk                                                                                                                  | Severity | Mitigation                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| Plan mentions "StartSessionConfig" interface which doesn't exist - `startChatSession()` uses inline intersection type | LOW      | Task 2.2 documents correct modification target                |
| `tier !== 'free'` less robust than `plan?.isPremium` for future tier additions                                        | LOW      | Use `plan?.isPremium === true` with tier fallback in Task 3.2 |

### Edge Cases to Handle

- [x] No license key stored -> Returns free tier -> Handled by LicenseService
- [x] License verification fails (network) -> Returns cached/free tier -> Handled by LicenseService
- [x] License expires mid-session -> OK, check happens at session start
- [x] User upgrades mid-session -> New sessions get premium features

---

## Batch 1: SDK Query Options Builder (Core Logic) - COMPLETE

**Commit**: 237eff8

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add isPremium to QueryOptionsInput Interface - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
**Spec Reference**: implementation-plan.md:49-56
**Pattern to Follow**: Existing optional fields in QueryOptionsInput (lines 44-64)

**Quality Requirements**:

- Add `isPremium?: boolean` field with JSDoc comment
- Place after `onCompactionStart` field for logical grouping
- Default behavior when not provided should be false (free tier)

**Implementation Details**:

- Imports: None required for this task
- Location: `QueryOptionsInput` interface around line 44
- Add:

```typescript
/**
 * Premium user flag - enables MCP server and Ptah system prompt
 * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT
 * Defaults to false (free tier behavior)
 */
isPremium?: boolean;
```

---

### Task 1.2: Implement Conditional MCP and System Prompt Logic - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
**Spec Reference**: implementation-plan.md:58-123
**Pattern to Follow**: Existing buildMcpServers() (lines 263-272), buildSystemPrompt() (lines 243-258)
**Dependencies**: Task 1.1

**Quality Requirements**:

- Import `PTAH_SYSTEM_PROMPT` from `@ptah-extension/vscode-lm-tools`
- Modify `build()` method to extract isPremium and pass to helpers
- Modify `buildMcpServers(isPremium)` to return empty object for free tier
- Modify `buildSystemPrompt(sessionConfig, isPremium)` to append PTAH_SYSTEM_PROMPT for premium

**Validation Notes**:

- For free tier: `mcpServers: {}` and no PTAH_SYSTEM_PROMPT append
- For premium tier: `mcpServers: { ptah: {...} }` and PTAH_SYSTEM_PROMPT appended
- User's custom systemPrompt should still work with both tiers

**Implementation Details**:

- Add import: `import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';`
- In `build()` method (line 153): Extract `isPremium = false` from input
- Pass `isPremium` to `buildMcpServers(isPremium)` call (line 212)
- Pass `isPremium` to `buildSystemPrompt(sessionConfig, isPremium)` call (line 172)
- Update `buildMcpServers()` signature: `private buildMcpServers(isPremium: boolean)`
- Add early return in `buildMcpServers()`: `if (!isPremium) return {};`
- Update `buildSystemPrompt()` signature: `private buildSystemPrompt(sessionConfig?: AISessionConfig, isPremium: boolean = false)`
- Build appendParts array with optional user prompt + optional PTAH_SYSTEM_PROMPT

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- Type check passes: `npx nx run agent-sdk:typecheck`
- No runtime errors in unit tests

---

## Batch 2: SDK Agent Adapter & Session Lifecycle (Pass-Through) - COMPLETE

**Commit**: 237eff8

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Add isPremium to ExecuteQueryConfig Interface - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
**Spec Reference**: implementation-plan.md:127-155
**Pattern to Follow**: Existing ExecuteQueryConfig interface (lines 77-94)

**Quality Requirements**:

- Add `isPremium?: boolean` field with JSDoc comment
- Pass isPremium to queryOptionsBuilder.build() in executeQuery() method

**Implementation Details**:

- Location: `ExecuteQueryConfig` interface around line 77
- Add:

```typescript
/**
 * Premium user flag - enables MCP server and Ptah system prompt
 * Passed through to SdkQueryOptionsBuilder for conditional feature enabling
 */
isPremium?: boolean;
```

- In `executeQuery()` method (line 419), extract isPremium from config
- Pass isPremium to `queryOptionsBuilder.build()` call (lines 473-480)

---

### Task 2.2: Add isPremium to startChatSession Inline Type - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md:131-152
**Pattern to Follow**: Existing inline type at startChatSession() (lines 330-337)
**Dependencies**: Task 2.1

**Quality Requirements**:

- Add `isPremium?: boolean` to the inline intersection type parameter
- Extract isPremium from config and pass to sessionLifecycle.executeQuery()

**Validation Notes**:

- The plan mentions "StartSessionConfig" interface but actual code uses inline type
- Must modify the inline intersection type, not create separate interface

**Implementation Details**:

- Location: `startChatSession()` method signature (lines 330-337)
- Add `isPremium?: boolean;` to the inline type
- Extract isPremium with default: `const { tabId, isPremium = false } = config;`
- Pass to executeQuery: `isPremium,` in the config object (lines 354-363)

---

### Task 2.3: Add isPremium to resumeSession Flow (If Applicable) - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md:154
**Dependencies**: Task 2.1

**Quality Requirements**:

- Review resumeSession() to determine if isPremium is needed
- If resumed sessions should maintain premium features, add isPremium parameter

**Validation Notes**:

- Current resumeSession() signature (line 398): `async resumeSession(sessionId: SessionId, config?: AISessionConfig)`
- AISessionConfig from shared library - would require modifying shared types
- Alternative: Accept isPremium as separate parameter or in extended config

**Implementation Details**:

- Review whether resumed sessions need MCP/system prompt features
- If YES: Modify signature to accept isPremium
- If NO: Document why (sessions resume with original context, MCP already established)
- DECISION POINT: Check if executeQuery call in resumeSession (lines 426-433) needs isPremium

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- Type check passes: `npx nx run agent-sdk:typecheck`
- isPremium flows correctly from startChatSession -> executeQuery -> queryOptionsBuilder

---

## Batch 3: Chat RPC Handlers (License Check) - COMPLETE

**Commit**: 237eff8

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Inject LicenseService in ChatRpcHandlers Constructor - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md:166-176
**Pattern to Follow**: Existing constructor injections (lines 47-59)

**Quality Requirements**:

- Import LicenseService and TOKENS from `@ptah-extension/vscode-core`
- Add `@inject(TOKENS.LICENSE_SERVICE)` injection in constructor
- Maintain existing injection order (add at end)

**Implementation Details**:

- Add import: Update existing import from `@ptah-extension/vscode-core` to include `LicenseService`
- Verify TOKENS import already includes LICENSE_SERVICE (it should from tokens.ts)
- Add constructor parameter:

```typescript
@inject(TOKENS.LICENSE_SERVICE)
private readonly licenseService: LicenseService
```

---

### Task 3.2: Compute isPremium and Pass to Adapter in registerChatStart - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md:178-205
**Pattern to Follow**: Existing registerChatStart() method (lines 79-143)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Call `licenseService.verifyLicense()` at start of handler
- Compute `isPremium` using robust check: `licenseStatus.valid && (licenseStatus.plan?.isPremium === true || licenseStatus.tier === 'early_adopter')`
- Log license check result with tier and isPremium
- Pass isPremium to sdkAdapter.startChatSession()

**Validation Notes**:

- Use plan?.isPremium with tier fallback for future-proofing
- verifyLicense() handles network failures gracefully (returns cached or free tier)

**Implementation Details**:

- At start of registerChatStart handler (after destructuring params):

```typescript
// Get license status for premium feature gating
const licenseStatus = await this.licenseService.verifyLicense();
const isPremium = licenseStatus.valid && (licenseStatus.plan?.isPremium === true || licenseStatus.tier === 'early_adopter');

this.logger.debug('RPC: chat:start - license check', {
  tier: licenseStatus.tier,
  isPremium,
});
```

- Add `isPremium,` to sdkAdapter.startChatSession() config (line 115)

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-extension-vscode`
- Type check passes
- LicenseService properly injected and used

---

## Batch 4: Documentation - COMPLETE

**Commit**: 237eff8

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None (can run in parallel with other batches)

### Task 4.1: Create DEV_LICENSE_SETUP.md Documentation - COMPLETE

**File**: `D:\projects\ptah-extension\docs\DEV_LICENSE_SETUP.md` (NEW)
**Spec Reference**: implementation-plan.md:210-298

**Quality Requirements**:

- Document prerequisites (PostgreSQL, Node.js)
- Step-by-step license server setup
- curl command for generating dev license
- VS Code license entry instructions
- Troubleshooting section

**Implementation Details**:

- Created new file at `D:\projects\ptah-extension\docs\DEV_LICENSE_SETUP.md`
- Content verified against actual license server code:
  - Admin API: `POST /api/v1/admin/licenses`
  - Auth: `X-API-Key` header (AdminApiKeyGuard)
  - Plans: `free` (never expires) or `early_adopter` (60 days, premium)
  - Body: `{ email, plan, sendEmail }` (sendEmail: false skips email)
- Includes:
  - Prerequisites section (PostgreSQL, Node.js 20+)
  - Step 1: Start the License Server (environment variables, migrations, nx serve)
  - Step 2: Generate a Dev License (curl command with JSON body, example response)
  - Step 3: Enter License in VS Code (command palette instructions)
  - Troubleshooting section (server URL, license expires, database reset, API key issues)
  - Quick Reference section for common commands
  - Windows PowerShell alternative for environment variables

---

**Batch 4 Verification**:

- File exists at `D:\projects\ptah-extension\docs\DEV_LICENSE_SETUP.md`
- Markdown renders correctly
- Instructions verified against actual code:
  - `admin.controller.ts` - Verified endpoint and response format
  - `admin-api-key.guard.ts` - Verified X-API-Key header
  - `create-license.dto.ts` - Verified allowed plans: free | early_adopter
  - `plans.config.ts` - Verified 60-day expiration for early_adopter

---

## Status Icons Reference

| Status      | Meaning                         | Who Sets              |
| ----------- | ------------------------------- | --------------------- |
| PENDING     | Not started                     | team-leader (initial) |
| IN PROGRESS | Assigned to developer           | team-leader           |
| IMPLEMENTED | Developer done, awaiting verify | developer             |
| COMPLETE    | Verified and committed          | team-leader           |
| FAILED      | Verification failed             | team-leader           |

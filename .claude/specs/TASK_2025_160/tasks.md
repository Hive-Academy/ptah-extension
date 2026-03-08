# Development Tasks - TASK_2025_160

**Total Tasks**: 16 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- DI registration pattern: Verified in `llm-abstraction/di/register.ts` and `agent-generation/di/register.ts`
- File I/O pattern (`homedir()` + `fs/promises`): Verified in `gemini-cli.adapter.ts:193-229`
- Strategy pattern for CLIs: Verified in `cli-adapters/` directory
- Premium gating via `LicenseService`: Verified in `wizard-generation-rpc.handlers.ts:354-380`
- `AgentFileWriterService` path validation enforces `.claude`: Verified, new service uses `fs.promises` directly
- Plugin paths from `PluginLoaderService.resolvePluginPaths()`: Verified at `plugin-loader.service.ts:102`
- `CliDetectionService.detectAll()` returns `CliDetectionResult[]`: Verified at `cli-detection.service.ts:44`
- `GeneratedAgent` interface has `content`, `sourceTemplateId`, `filePath`: Verified at `core.types.ts:476-518`

### Risks Identified

| Risk                                                        | Severity | Mitigation                                            |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------- |
| CLI directory permissions (user can't write to ~/.copilot/) | LOW      | All ops in try/catch, returns status with error field |
| CLI directory structure changes in future CLI updates       | MEDIUM   | Paths are constants, easy to update                   |
| Agent content incompatibility after transform               | MEDIUM   | Unknown patterns stripped, not incorrectly mapped     |
| Race condition on concurrent activation (multi-workspace)   | LOW      | Atomic hash comparison + writeFile                    |

### Edge Cases to Handle

- [x] Plugin directories that don't exist yet -> mkdir recursive
- [x] Empty enabledPluginIds -> skip sync, return empty results
- [x] CLI not installed -> skip that CLI target entirely
- [x] Premium expired -> cleanupAll removes all synced content
- [x] SKILL.md without allowed-tools frontmatter -> no stripping needed

---

## Batch 1: Foundation Types & Interfaces -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: bc65c33a

### Task 1.1: Create shared CLI skill sync types -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\cli-skill-sync.types.ts` (CREATED)

---

### Task 1.2: Add barrel export for cli-skill-sync types -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\index.ts` (MODIFIED)

---

### Task 1.3: Create ICliSkillInstaller interface -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\cli-skill-installer.interface.ts` (CREATED)

---

### Task 1.4: Create ICliAgentTransformer interface -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\cli-agent-transformer.interface.ts` (CREATED)

---

## Batch 2: CLI Skill Sync Layer -- COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1
**Commit**: 15c4bdcb (combined with Batch 3)

### Task 2.1: Create CopilotSkillInstaller -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\copilot-skill-installer.ts` (CREATED)

---

### Task 2.2: Create GeminiSkillInstaller -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\gemini-skill-installer.ts` (CREATED)

---

### Task 2.3: Create CliSkillManifestTracker -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\cli-skill-manifest-tracker.ts` (CREATED)

---

### Task 2.4: Create CliPluginSyncService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\cli-plugin-sync.service.ts` (CREATED)

---

### Task 2.5: Create barrel exports, DI tokens, and DI registration for skill sync -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-skill-sync\index.ts` (CREATED)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (MODIFIED)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\di\register.ts` (MODIFIED)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts` (MODIFIED)

---

## Batch 3: Agent Transformation Layer -- COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1
**Commit**: 15c4bdcb (combined with Batch 2)

### Task 3.1: Create transform-rules.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\transform-rules.ts` (CREATED)

---

### Task 3.2: Create CopilotAgentTransformer -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\copilot-agent-transformer.ts` (CREATED)

---

### Task 3.3: Create GeminiAgentTransformer -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\gemini-agent-transformer.ts` (CREATED)

---

### Task 3.4: Create MultiCliAgentWriterService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\multi-cli-agent-writer.service.ts` (CREATED)

---

### Task 3.5: Create barrel exports, DI tokens, and DI registration for agent transforms -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\cli-agent-transforms\index.ts` (CREATED)
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts` (MODIFIED)
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFIED)
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts` (MODIFIED)

---

## Batch 4: Integration -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batches 2 & 3
**Commit**: 147076a2

### Task 4.1: Extend orchestrator with Phase 5 and update GenerationSummary -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts` (MODIFIED)
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts` (MODIFIED)

---

### Task 4.2: Wizard RPC integration - pass targetClis to orchestrator -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` (MODIFIED)

---

### Task 4.3: Extension activation CLI skill sync -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (MODIFIED)

---

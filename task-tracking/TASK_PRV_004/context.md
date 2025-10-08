# Task Context - TASK_PRV_004

## Original User Request

Extract Claude Domain Services from `apps/ptah-extension-vscode/src/services/` to `libs/backend/claude-domain/` following MONSTER plan Week 5 specifications and BACKEND_LIBRARY_GAP_ANALYSIS.md recommendations.

## Reference Documents

- **Primary**: `docs/BACKEND_LIBRARY_GAP_ANALYSIS.md` (Option A: Extract → Enhance → Structure)
- **Architecture Plan**: `docs/MONSTER_EXTENSION_REFACTOR_PLAN.md` (Week 5: Claude Domain Separation)
- **Current Implementation**: `apps/ptah-extension-vscode/src/services/claude-cli.service.ts` (690 lines)
- **Supporting Service**: `apps/ptah-extension-vscode/src/services/claude-cli-detector.service.ts` (150 lines)

## Scope

Extract and enhance the following production-tested features into proper library structure:

### Source Files to Extract

1. **`claude-cli.service.ts`** (690 lines)
   - Process spawning with child_process
   - JSONL stream parsing
   - Session management (Map<SessionId, ChildProcess>)
   - Permission request handling with popup integration
   - Tool execution tracking (TodoWrite, Read, Edit, MultiEdit)
   - Thinking content display (💭 prefix)
   - Error handling with graceful fallbacks

2. **`claude-cli-detector.service.ts`** (150 lines)
   - Multi-platform CLI detection (Windows, macOS, Linux)
   - PATH resolution with priority ordering
   - npm global package detection
   - Version verification
   - Installation validation

### Target Library Structure

```
libs/backend/claude-domain/
├── src/
│   ├── cli/
│   │   ├── claude-cli-process-manager.ts     # Extract from claude-cli.service.ts
│   │   ├── jsonl-stream-parser.ts            # Extract from createSimplifiedStreamPipeline()
│   │   ├── claude-cli-detector.ts            # Move claude-cli-detector.service.ts
│   │   └── index.ts
│   ├── permissions/
│   │   ├── permission-handler.ts              # Extract from handlePermissionRequest()
│   │   ├── permission-popup-integration.ts    # Webview integration logic
│   │   └── index.ts
│   ├── tools/
│   │   ├── tool-execution-display.ts          # Extract tool display logic
│   │   ├── thinking-content-handler.ts        # Extract thinking display
│   │   └── index.ts
│   ├── session/
│   │   ├── session-resumption-manager.ts      # Extract --resume logic
│   │   └── index.ts
│   └── index.ts  # Export all domain services
```

## Critical Features to Preserve

From the gap analysis comparison matrix:

| Feature | Current Implementation | Must Preserve |
|---------|----------------------|---------------|
| Permission Handling | ✅ Popup integration | YES - Critical |
| Tool Execution Display | ✅ TodoWrite, Read, Edit | YES - User-facing |
| Thinking Content | ✅ 💭 prefix display | YES - User-facing |
| Session Resumption | ✅ `--resume` flag | YES - Multi-turn |
| JSONL Parsing | ✅ Line-by-line buffer | YES - Production-tested |
| Process Spawning | ✅ `spawn()` with stdio | YES - Core functionality |

## Success Criteria

1. ✅ All 690 lines of `claude-cli.service.ts` extracted to appropriate modules
2. ✅ All 150 lines of `claude-cli-detector.service.ts` moved to library
3. ✅ Zero functionality loss (all features preserved)
4. ✅ Clean module boundaries (following SOLID principles)
5. ✅ Proper TypeScript types (no `any` types)
6. ✅ Unit tests for all extracted modules (≥80% coverage)
7. ✅ Integration tests with existing `ai-providers-core` adapters
8. ✅ Documentation for each module
9. ✅ Update `ai-providers-core` adapters to use `claude-domain` services
10. ✅ Deprecation plan for old `claude-cli.service.ts`

## Dependencies

- **Blocked by**: None (TASK_PRV_001 complete)
- **Blocks**: TASK_PRV_002 (Angular UI should use new architecture)
- **Related**: TASK_PRV_005 (Workspace Intelligence extraction)

## Estimated Timeline

**2-3 days** (per gap analysis recommendation)

- Day 1: Extract CLI process management and JSONL parsing
- Day 2: Extract permissions, tools, and session resumption
- Day 3: Testing, integration, and documentation

## Notes

This task follows **Option A (MONSTER Plan Compliance)** from the gap analysis:
- Extract → Enhance → Structure
- Preserve production-tested code
- Proper separation of concerns
- No technical debt accumulation

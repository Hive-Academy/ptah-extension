# Task Description - TASK_PRV_004

## User Request

Extract Claude Domain Services from apps/ptah-extension-vscode/src/services/ to libs/backend/claude-domain/ following MONSTER plan Week 5 specifications and BACKEND_LIBRARY_GAP_ANALYSIS.md recommendations

## SMART Requirements

- Specific: Extract the existing Claude CLI–related services from `apps/ptah-extension-vscode/src/services/` and relocate them into `libs/backend/claude-domain/` as a properly structured library per MONSTER Week 5. Concretely:
  - Move functionality from `claude-cli.service.ts` into domain-scoped modules (CLI adapter, JSONL parsing, permission handling, session/resume management, tool/thinking display hooks).
  - Move `claude-cli-detector.service.ts` into a detector module within the same library.
  - Provide public exports via `libs/backend/claude-domain/src/index.ts` and sub-index files.
  - Update extension references (adapters/factory/handlers) to consume the new library without behavior change.
- Measurable: Nx build succeeds for the library and extension; TypeScript typecheck passes; all references to old services compile against the new library; smoke test verifies streaming responses and permission prompts still appear.
- Achievable: Based on existing production code (690+ lines in `claude-cli.service.ts` and ~150 lines in detector), the extraction is straightforward with minimal refactoring.
- Relevant: Aligns with MONSTER plan Week 5 “Claude Domain Separation” and closes the gap identified in BACKEND_LIBRARY_GAP_ANALYSIS.md.
- Time-bound: 2–3 working days.

## Acceptance Criteria (BDD Format)

### Scenario 1: Library extraction builds successfully

Given the codebase contains `claude-cli.service.ts` and `claude-cli-detector.service.ts` in the extension services folder
When their functionality is extracted into `libs/backend/claude-domain/` with proper exports
Then `npm run build:extension` and `npm run build:webview` complete without errors
And `npm run typecheck:all` reports no new type errors

### Scenario 2: Streaming response parity

Given a running Extension Development Host with Claude CLI installed
When a chat message is sent via the existing UI
Then the response streams chunk-by-chunk as before (JSONL parsing preserved)
And no regressions are observed in message ordering or content formatting

### Scenario 3: Permission request handling preserved

Given Claude CLI emits a permission request event during a message turn
When the event is processed by the extracted claude-domain library
Then the extension still receives and renders the permission prompt
And user responses (allow, always_allow, deny) are handled correctly

### Scenario 4: Session resumption support

Given a previous session ID exists
When a new message is sent with resume semantics
Then the library invokes Claude CLI with the appropriate resume behavior and the conversation continues

### Scenario 5: CLI detection and health checks

Given Claude CLI is installed
When the detector and health check run
Then version detection succeeds and health status is reported as available with response time

Given Claude CLI is not installed
When the health check runs
Then the status is reported as error with a helpful message

## Risk Assessment

- Technical Risks:
  - Hidden coupling to extension-specific utilities may surface during extraction.
  - Stream parsing edge cases in JSONL handling could regress if code is split incorrectly.
  - Windows vs. macOS/Linux path resolution differences for CLI detection.
- Scope Risks:
  - Over-refactoring beyond extraction could increase timelines; keep behavior identical.
- Dependency Risks:
  - Build and import path updates across `apps/ptah-extension-vscode` to reference the new library.

## Next Phase Recommendation

- [ ] researcher-expert
- [x] software-architect

Rationale: The approach is clear (code extraction and library structuring) with known components and no novel technology research needed. A software architect should define the file/module boundaries and integration points, then proceed to implementation.

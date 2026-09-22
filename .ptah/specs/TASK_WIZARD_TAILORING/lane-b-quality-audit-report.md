# Lane B Deliverable: Quality Audit Turn Cap & Incremental Writing Report

## 1. Per-Phase Turn Cap Map
We chose the following per-phase cap map keyed by `MultiPhaseId` (`PHASE_CONFIGS`):
```typescript
export const DEFAULT_MAX_AGENT_TURNS = 50;
export const PHASE_MAX_AGENT_TURNS: Record<MultiPhaseId, number> = {
  'project-profile': 50,
  'architecture-assessment': 50,
  'quality-audit': 120,
  'elevation-plan': 50,
};
```
### Rationale
- **`quality-audit` at 120 turns**: In large monorepos (e.g. 96 projects), surveying multi-framework conformance, type safety, error boundaries, anti-patterns, security, and tests requires numerous file reads, LSP references, and AST inspections. The 50-turn cap caused the audit agent to exhaust its budget after ~5.75 minutes with `error_max_turns` before saving its findings. 120 turns provides sufficient headroom within the 15-minute `PER_PHASE_TIMEOUT_MS` (900,000 ms).
- **Other phases at 50 turns**: `project-profile`, `architecture-assessment`, and `elevation-plan` have narrower scopes or consume structured inputs from prior phases, operating comfortably within 50 turns.
- **Fallback**: Unknown phase identifiers default to `DEFAULT_MAX_AGENT_TURNS` (50).
- **Logging**: The selected turn cap is logged in `MultiPhaseAnalysisService.executePhase` in the existing `Executing phase` log event:
```typescript
const maxTurns =
  (PHASE_MAX_AGENT_TURNS as Record<string, number>)[phaseConfig.id] ??
  DEFAULT_MAX_AGENT_TURNS;

this.logger.info(
  `${SERVICE_TAG} Executing phase ${phaseIndex + 1}/${LLM_PHASE_COUNT}: ${phaseConfig.id}`,
  {
    phaseId: phaseConfig.id,
    model,
    cwd,
    mcpServerRunning,
    mcpPort,
    maxTurns,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    slugDir,
    pluginPathCount: pluginPaths?.length ?? 0,
  },
);
```

---

## 2. Exact Prompt Wording Added
In `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-prompts.ts`, `buildPhase3Prompts` was updated with explicit incremental writing instructions:

### In `systemPrompt`:
**Under `## Output File`**:
```markdown
## Output File
You MUST write your complete analysis document to this exact file path:
`${outputFile}`

Write incrementally — do NOT wait until the end to write a single final file:
- Create the output file with its heading skeleton FIRST before starting deep inspection.
- append each finding section to the file as soon as it is established (one write per area surveyed), instead of one final write at the end.
- Fill in and refine the Overall Quality Score and Strengths before finishing.
This ensures your findings are preserved on disk even if a turn cap is reached.

Use the Write tool to save the document.
Do NOT just respond with the content — you must write it to the file above.
```

**Under `## Instructions`**:
```markdown
Read both previous phase files first. Create the heading skeleton in `${outputFile}` FIRST, then use the `execute_code` tool with `ptah.*` APIs for deep code examination, appending each finding section as soon as it is established (one write per area surveyed), instead of one final write at the end.
```

**Under `CRITICAL` rules**:
```markdown
CRITICAL: Write incrementally to `${outputFile}`: create the heading skeleton FIRST, then append each finding section as soon as it is established (one write per area surveyed), instead of one final write at the end.
CRITICAL: No conversational text. Only tool calls. Final response: "Done."
```

### In `userPrompt`:
```markdown
Read the previous analysis files at ${slugDir}/01-project-profile.md and ${slugDir}/02-architecture-assessment.md, then perform a quality audit. Write incrementally to `${outputFile}`: create the output file with its heading skeleton FIRST, then append each finding section to the file as soon as it is established (one write per area surveyed), instead of one final write at the end. Use the `execute_code` tool with `ptah.*` APIs to examine the codebase in depth. Do not emit any text — only make tool calls, then respond "Done." when finished.
```

---

## 3. Post-Phase Handling Change
### Location
- File: `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- Lines: 83 (`SUBSTANTIAL_PHASE_FILE_MIN_BYTES = 500`) and 480–505 (`recordPhaseOutcome`)

### Implementation
```typescript
    const currentFileBytes =
      currentFileContent !== null
        ? Buffer.byteLength(currentFileContent, 'utf8')
        : 0;
    const hasSubstantialFile =
      currentFileBytes >= SUBSTANTIAL_PHASE_FILE_MIN_BYTES;
    const isMaxTurns = outcome.error?.includes('error_max_turns') ?? false;

    if (isMaxTurns && fileWrittenThisRun && hasSubstantialFile) {
      this.logger.warn(
        `${SERVICE_TAG} Phase ${phaseId} hit max turns cap but produced a substantial file (${currentFileBytes} bytes); recording as completed with partial document`,
        { phaseId, durationMs, bytes: currentFileBytes },
      );
      await checkpoint.markCompleted(phaseId, durationMs);
      return;
    }

    const error =
      outcome.error ??
      (outcome.timedOut
        ? `analysis_timeout: phase exceeded ${PER_PHASE_TIMEOUT_MS} ms`
        : 'Stream ended without a result');

    if (
      (!fileWrittenThisRun || (isMaxTurns && !hasSubstantialFile)) &&
      outcome.assistantText
    ) {
      this.logger.warn(
        `${SERVICE_TAG} Phase ${phaseId}: keeping captured text as a diagnostic file (phase still failed)`,
      );
      await this.storageService.writePhaseFile(
        checkpoint.slugDir,
        filename,
        outcome.assistantText,
      );
    }
    await this.restorePriorPhaseFileIfMissing(
      checkpoint.slugDir,
      filename,
      priorFileContent,
      staleFileRemoved,
    );
    this.logger.error(
      `${SERVICE_TAG} Phase ${phaseId} failed after ${durationMs}ms: ${error}`,
      { phaseId, durationMs, timedOut: outcome.timedOut },
    );
    await checkpoint.markFailed(phaseId, durationMs, error);
```

---

## 4. Revision 1 (Addressing Independent Review)
Following `code-logic-review.md` (which scored 5/10 with REVISE), the orchestrator directed producer-side fixes:

1. **Producer-Side Completed Status for Capped-but-Substantial Phase (`multi-phase-analysis.service.ts:488-498`)**:
   - **Issue**: Downstream consumers (`enhanced-prompts.service.ts:988`, `analysis-storage.service.ts:501`, `setup-rpc.handlers.ts:465`) inspect manifest status and silently ignore files from phases marked `failed`.
   - **Fix**: In `recordPhaseOutcome`, when `isMaxTurns`, `fileWrittenThisRun` (current-run provenance), and `hasSubstantialFile` all hold, we log a warning and call `checkpoint.markCompleted(phaseId, durationMs)`.
   - **Doc Comment (`multi-phase-analysis.service.ts:419-426`)**: Documented why capped-but-substantial counts as completed (the on-disk file is the deliverable; a resumed run would delete it and start over).
   - Removed the log-only `else if` branch.

2. **UTF-8 Byte Measurement (`multi-phase-analysis.service.ts:481-486`)**:
   - Replaced character `.length` comparison with `Buffer.byteLength(currentFileContent, 'utf8')`.
   - Logged the measured UTF-8 byte count.
   - Prevents multi-byte Unicode content from being misclassified as insubstantial.

3. **Dead Export Removal (`multi-phase-analysis.service.ts:77`)**:
   - Deleted unused `export const MAX_AGENT_TURNS = DEFAULT_MAX_AGENT_TURNS;`.

4. **Updated & Control Specs (`multi-phase-analysis.service.spec.ts:735-829`)**:
   - Replaced the preservation test with a test where `content.length` (453) is strictly below 500 code units, but `Buffer.byteLength` (529 UTF-8 bytes) is >= 500, exercising the exact `Buffer.byteLength` check. Verified `status === 'completed'`, on-disk content unchanged, and `logger.warn` invoked.
   - Added a control test for insubstantial content (< 500 bytes) with `error_max_turns`: verified status is `'failed'`, error is recorded, captured text is written as diagnostic file, and lifecycle is `'failed'`.
   - Retained the existing `maxTurns` cap test.

5. **Prompt/Spec Wording Alignment (`multi-phase-prompts.ts:230,300,322,325` & `multi-phase-prompts.spec.ts:22`)**:
   - Aligned the exact phrase `'append each finding section to the file as soon as it is established (one write per area surveyed)'` consistently.

---

## 5. Files Changed
- `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.ts`
- `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.spec.ts`

---

## 6. Verification Output

### Test Execution
```
$ npx nx run agent-generation:test --testPathPatterns=wizard/multi-phase --skip-nx-cache --output-style=static
PASS agent-generation libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts
PASS agent-generation libs/backend/agent-generation/src/lib/services/wizard/multi-phase-prompts.spec.ts

Test Suites: 2 passed, 2 total
Tests:       28 passed, 28 total
Snapshots:   0 total
Time:        4.307 s
Ran all test suites matching wizard/multi-phase.

 NX   Successfully ran target test for project @ptah-extension/agent-generation
```

### Lint Execution
```
$ npx nx run agent-generation:lint --output-style=static
✖ 431 problems (0 errors, 431 warnings)

 NX   Successfully ran target lint for project @ptah-extension/agent-generation
```
Zero lint errors, zero added production `as any` or `@ts-ignore`.

---

## 7. Blockers / Out-of-Scope
- None. Task folder allocation is owned by the orchestrator.

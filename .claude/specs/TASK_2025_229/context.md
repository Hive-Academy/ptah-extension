# TASK_2025_229: Wire Setup Wizard Transcript to Chat Execution Tree Pipeline

## User Request

Wire setup wizard analysis transcript to use the same ExecutionTreeBuilder and ExecutionNode rendering pipeline as the main chat. Currently the wizard uses a simplified flat `AnalysisStreamPayload[]` with basic text rendering, while the chat has a rich recursive ExecutionNode tree with proper tool call visualization, thinking blocks, delta accumulation, and agent nesting.

## Strategy

- **Type**: REFACTORING
- **Workflow**: Partial (Architect -> Team-Leader -> Developers -> QA)
- **Complexity**: Medium

## Current State (Gap Analysis)

### Wizard Pipeline (simplified, flat)

```
SdkStreamProcessor emitter → flat AnalysisStreamPayload (7 kinds)
  → broadcastMessage(SETUP_WIZARD_ANALYSIS_STREAM)
    → SetupWizardStateService.analysisStream signal
      → AnalysisTranscriptComponent (basic text + collapsed tool groups)
```

### Chat Pipeline (battle-tested, recursive)

```
SDK stream → FlatStreamEventUnion (16 event types, parentToolUseId)
  → ChatStore StreamingState (delta accumulators, event maps)
    → ExecutionTreeBuilderService.buildTree() (memoized recursive tree)
      → ExecutionNodeComponent (recursive: text, thinking, tools, nested agents)
```

### Key Missing Pieces

1. **Backend**: Wizard emits `AnalysisStreamPayload` instead of `FlatStreamEventUnion`
2. **Frontend state**: Wizard uses flat array instead of `StreamingState` with accumulators
3. **Frontend rendering**: Wizard has custom `AnalysisTranscriptComponent` instead of `ExecutionNodeComponent`

## Key Files

### Backend (emission)

- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts` — emits stream events
- `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts` — processes SDK messages

### Frontend (receiving + rendering)

- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts` — stores `analysisStream`
- `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts` — renders transcript
- `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts` — stats

### Chat reference (target architecture)

- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` — builds ExecutionNode tree
- `libs/shared/src/lib/types/execution-node.types.ts` — FlatStreamEventUnion, ExecutionNode types

## Constraints

- Must not break the main chat pipeline
- Setup wizard is used by both VS Code extension and Electron app
- The wizard runs 4 sequential phases — each phase should have its own execution tree

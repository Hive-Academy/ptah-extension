## Batch 5: Frontend-Backend Wiring ⏸️ PENDING

**Type**: INTEGRATION (Sequential)
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 4, Batches 2B-2D
**Can Run In Parallel With**: NOTHING (integration)
**Estimated Complexity**: Medium (2-3 days)

### Task 5.1: Wire wizard components to RPC service ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\*.component.ts
**Dependencies**: Batch 4 (backend RPC handlers)
**Spec Reference**: implementation-plan.md:2476-2583 (Frontend-Backend Integration)

**Quality Requirements**:

- RPC message sending on user actions
- RPC message receiving and state updates
- Error handling for RPC failures

**Implementation Details**:

```typescript
// In WelcomeComponent
startSetup(): void {
  this.wizardRpc.startSetupWizard().then(() => {
    this.wizardState.setCurrentStep('scan');
  }).catch(error => {
    this.errorService.showError('Failed to start setup', error);
  });
}

// In AgentSelectionComponent
generateAgents(): void {
  const selected = this.availableAgents().filter(a => a.selected);
  this.wizardRpc.submitAgentSelection(selected).then(() => {
    this.wizardState.setCurrentStep('generation');
  }).catch(error => {
    this.errorService.showError('Failed to start generation', error);
  });
}
```

---

### Task 5.2: Implement RPC message listeners in state service ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts
**Dependencies**: Task 5.1

**Quality Requirements**:

- Listen for backend progress messages
- Update signals reactively
- Handle error messages from backend

**Implementation Details**:

```typescript
@Injectable({ providedIn: 'root' })
export class SetupWizardStateService {
  // ... existing signals

  constructor(private vscodeService: VSCodeService) {
    this.setupMessageListeners();
  }

  private setupMessageListeners(): void {
    // Listen for workspace scan progress
    this.vscodeService.onMessage<WorkspaceScanProgressMessage>('workspace-scan-progress', (message) => {
      this.generationProgress.update((prev) => ({
        ...prev,
        filesScanned: message.filesScanned,
        totalFiles: message.totalFiles,
        detections: message.detectedCharacteristics,
      }));
    });

    // Listen for generation progress
    this.vscodeService.onMessage<GenerationProgressMessage>('generation-progress', (message) => {
      this.generationProgress.set({
        phase: message.phase,
        percentComplete: message.percentComplete,
        agents: message.agents,
      });
    });

    // Listen for generation complete
    this.vscodeService.onMessage<GenerationCompleteMessage>('generation-complete', (message) => {
      this.generationSummary.set(message.summary);
      this.currentStep.set('complete');
    });

    // Listen for errors
    this.vscodeService.onMessage<GenerationErrorMessage>('generation-error', (message) => {
      this.errorMessage.set(message.error);
    });
  }
}
```

---

### Task 5.3: Add error handling and loading states to components ⏸️ PENDING

**File**: All wizard components
**Dependencies**: Task 5.2

**Quality Requirements**:

- Show loading spinners during RPC calls
- Display error messages clearly
- Disable buttons during operations
- Retry/cancel options on errors

---

**Batch 5 Verification Checklist**:

- [ ] RPC messages send correctly from frontend
- [ ] Backend messages received and update UI
- [ ] Error handling works
- [ ] Loading states display correctly

---

## Batch 6: POC End-to-End Testing & Validation ⏸️ PENDING

**Type**: QUALITY ASSURANCE (Sequential)
**Developer**: senior-tester
**Tasks**: 5 | **Dependencies**: Batches 4, 5
**Can Run In Parallel With**: NOTHING (final validation)
**Estimated Complexity**: High (3-4 days)

### Task 6.1: Test complete wizard flow (3 test projects) ⏸️ PENDING

**Manual Testing**:

- Test Project 1: Angular Nx monorepo
- Test Project 2: Node.js backend API
- Test Project 3: Python app

**Test Scenarios**:

1. Happy path: Complete setup without errors
2. Cancellation: Cancel at step 3, verify progress saved
3. Error recovery: Simulate LLM failure, verify fallback
4. Performance: Measure total setup time (<3 minutes)

---

### Task 6.2: Conduct blind quality test ⏸️ PENDING

**Test Design**:

- Generate 2 agents for 3 test projects (6 total generated agents)
- Mix with 6 hand-written agents (from `.claude/agents/`)
- Ask 5 reviewers to identify which are generated vs hand-written
- Target: 3/5 reviewers can't distinguish (60% accuracy = success)

---

### Task 6.3: Measure POC success criteria ⏸️ PENDING

**Metrics to Collect**:

1. ✅ Generated agent quality score (>80/100 automated scoring)
2. ✅ Setup completion time (<3 minutes)
3. ✅ Agent selection relevance (>85% accuracy)
4. ✅ User satisfaction (>4/5 survey)
5. ✅ Zero critical bugs

---

### Task 6.4: User feedback collection ⏸️ PENDING

**Survey Questions**:

1. How would you rate the setup wizard experience? (1-5)
2. Were the generated agents helpful? (1-5)
3. Did the agent selection match your project? (Yes/No)
4. Would you use this feature again? (Yes/No)
5. What improvements would you suggest? (Open-ended)

---

### Task 6.5: POC decision gate report ⏸️ PENDING

**File**: D:\projects\ptah-extension\task-tracking\TASK_2025_058\poc-validation-report.md

**Report Contents**:

1. Success criteria results (Pass/Fail for each)
2. Quality test results (blind test accuracy)
3. Performance benchmarks
4. User feedback summary
5. Identified issues and blockers
6. Recommendation: Proceed to Phase 1 / Iterate / Pivot

---

**Batch 6 Verification Checklist**:

- [ ] All test scenarios executed
- [ ] Blind quality test completed
- [ ] Metrics collected
- [ ] User feedback analyzed
- [ ] POC decision report written

---

## USER DECISION GATE: Continue to Full Implementation?

**At this point, stop and present POC results to user.**

Options:

1. **PROCEED** → Continue to Batch 7 (Phase 1 implementation)
2. **ITERATE** → Address issues, extend POC by 1 week
3. **PIVOT** → Alternative approach (manual wizard, pre-built agent packs)

---

## POST-POC PHASES (Only if user approves)

---

## Batch 7: Template Library Conversion (Phase 1) ⏸️ PENDING

**Type**: CONTENT (Sequential after POC approval)
**Developer**: backend-developer
**Tasks**: 11 | **Dependencies**: Batch 6 (POC success)
**Can Run In Parallel With**: NOTHING (major content work)
**Estimated Complexity**: High (2-3 weeks)

### Task 7.1-7.11: Convert all agents to templates ⏸️ PENDING

**Templates to Convert**:

1. frontend-developer.template.md
2. team-leader.template.md
3. project-manager.template.md
4. software-architect.template.md
5. senior-tester.template.md
6. code-style-reviewer.template.md
7. code-logic-reviewer.template.md
8. researcher-expert.template.md
9. ui-ux-designer.template.md
10. modernization-detector.template.md
11. All commands (orchestrate, etc.)

**Per-Template Checklist**:

- [ ] Convert to hybrid syntax
- [ ] Define YAML frontmatter with applicability rules
- [ ] Mark STATIC sections
- [ ] Mark LLM sections
- [ ] Validate with TemplateStorageService
- [ ] Test generation with mock data

---

**Batch 7 Verification Checklist**:

- [ ] All 11 agent templates converted
- [ ] All command templates converted
- [ ] Templates load correctly
- [ ] Generated agents match hand-written quality

---

## Batch 8: LLM Enhancement (Phase 2) ⏸️ PENDING

**Type**: BACKEND ENHANCEMENT (Sequential)
**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 7
**Estimated Complexity**: Medium (2-3 weeks)

### Task 8.1: Expand prompt library to 10+ prompts ⏸️ PENDING

**New Prompts to Add**:

- Architecture Detection (detailed)
- Code Convention Analysis (comprehensive)
- Testing Strategy Generation
- Dependency Analysis
- Performance Best Practices
- Security Best Practices

---

### Task 8.2: Enhance OutputValidationService ⏸️ PENDING

**Enhancements**:

- Advanced factual accuracy checking (cross-reference workspace)
- Coherence scoring (readability, flow)
- Hallucination detection (identify fabricated references)

---

### Task 8.3: Implement LLM output caching ⏸️ PENDING

**Caching Strategy**:

- Cache key: projectContext hash + sectionTopic
- TTL: 24 hours
- Storage: In-memory + workspace storage (persistent)

---

### Task 8.4-8.6: Build prompt testing suite, batch processing optimization, fallback framework

---

**Batch 8 Verification Checklist**:

- [ ] 10+ prompts implemented
- [ ] Validation enhancements work
- [ ] Caching reduces redundant LLM calls
- [ ] Prompt tests pass

---

## Batch 9: Full Setup Wizard (Phase 3) ⏸️ PENDING

**Type**: FRONTEND ENHANCEMENT (Sequential)
**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: Batch 8
**Estimated Complexity**: Medium (2-3 weeks)

### Task 9.1: Expand to 6-step wizard ⏸️ PENDING

**Currently POC has 3 steps, expand to 6**:

- Enhance Step 3: Analysis Results with manual adjustment modal
- Add progress tracking with ETA calculation
- Add help documentation to each step
- Implement wizard state persistence (resume support)

---

### Task 9.2-9.6: Build diff preview modal, add contextual help, implement resume, add accessibility, polish UI

---

**Batch 9 Verification Checklist**:

- [ ] All 6 steps complete
- [ ] Help documentation present
- [ ] State persistence works
- [ ] Wizard completion rate >90%

---

## Batch 10: Production Hardening (Phase 4) ⏸️ PENDING

**Type**: QUALITY & PERFORMANCE (Sequential)
**Developer**: backend-developer + senior-tester
**Tasks**: 6 | **Dependencies**: Batch 9
**Estimated Complexity**: Medium (1-2 weeks)

### Task 10.1: Comprehensive error recovery testing ⏸️ PENDING

**Test Scenarios**:

- LLM API failures (timeout, rate limit, service down)
- Workspace scan failures (permission denied, corrupted files)
- File write failures (disk full, permission denied)
- Partial failures (some agents succeed, others fail)

---

### Task 10.2: Performance optimization ⏸️ PENDING

**Optimizations**:

- Workspace scan streaming (async generators)
- Parallel LLM requests (tune concurrency)
- Template caching improvements
- Memory profiling and optimization

---

### Task 10.3-10.6: Testing suite, documentation, telemetry, beta rollout plan

---

**Batch 10 Verification Checklist**:

- [ ] All failure modes tested
- [ ] Performance targets met (<5 min, <200MB)
- [ ] Test coverage >80%
- [ ] Documentation complete

---

## Batch 11: Migration Service (Future Phase - Placeholder) ⏸️ PENDING

**Type**: FUTURE ENHANCEMENT
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 10
**Estimated Complexity**: Medium (2-3 weeks)

### Task 11.1: Implement MigrationService ⏸️ PENDING

**Features**:

- Detect outdated generated agents
- Calculate update impact (breaking vs non-breaking)
- Show diff preview modal
- Regenerate with user consent
- Preserve user customizations

---

**Batch 11 Verification Checklist**:

- [ ] Outdated agent detection works
- [ ] Diff preview shows correctly
- [ ] Regeneration preserves customizations
- [ ] User consent workflow complete

---

## 🎉 PROJECT COMPLETION SUMMARY

**When all batches complete**:

### Deliverables

- ✅ 11 agent templates (customizable)
- ✅ All command templates
- ✅ 6-step setup wizard (production-ready)
- ✅ VS Code LM integration with validation
- ✅ Agent selection algorithm (proven accuracy)
- ✅ Complete test suite (>80% coverage)
- ✅ User documentation
- ✅ Beta rollout plan

### Metrics to Report

- Total development time: X weeks
- Lines of code: ~Y LOC
- Test coverage: Z%
- User satisfaction: W/5

### Next Steps

1. Beta rollout to early adopters
2. Collect feedback and iterate
3. Full release to all Ptah users
4. Plan Phase 5: Skills Support
5. Plan Phase 6: Community Template Marketplace

---

## Notes for Developers

### Critical Success Factors

1. **POC Quality Gate**: POC must pass blind quality test before proceeding
2. **LLM Integration**: VS Code LM API is unproven - extensive testing required
3. **Parallel Execution**: Batches 3A-3E save 4-6 weeks vs sequential
4. **Template Syntax**: Validate early (Batch 2A) to avoid rework
5. **Error Handling**: Graceful degradation is CRITICAL for user trust

### Risk Mitigation

- **LLM Quality**: Three-tier validation + fallback to generic content
- **Performance**: Timeout protection + partial success mode
- **User Trust**: Transparency (diff preview, reasoning logs)

### Communication

- Update user at major milestones (Batch 0, Batch 6 POC gate, Phase completions)
- Report blockers immediately
- Share wins (quality test results, performance benchmarks)

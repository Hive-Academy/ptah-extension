# TASK_2025_141 - Future Enhancements

This document outlines recommended follow-up improvements after the foundation implementation is complete.

---

## Phase C: Enhanced Prompts Integration (Recommended Next)

**Priority**: HIGH
**Estimated Batches**: 2 (Batches 9-10)
**Purpose**: Enable PromptDesignerAgent to leverage ProjectIntelligenceService for quality-aware prompt generation

### Tasks

1. **Modify PromptDesignerAgent**

   - Inject `ProjectIntelligenceService` via constructor
   - Add `qualityContext` to `PromptDesignerContext` interface
   - Include quality gaps and recommendations in prompt generation

2. **Update PromptDesignerOutput**

   - Add `qualityGuidance: PrescriptiveGuidance` section
   - Include codebase-specific warnings/recommendations
   - Token budget allocation for quality guidance

3. **Implement Reliable Workflow**

   - Use `ReliableGenerationConfig` for validation
   - Add retry logic with `DEFAULT_RETRY_CONFIG`
   - Implement `FallbackLevel` progression on failures

4. **Update PromptCacheService**
   - Add source file change detection
   - Invalidate cache when relevant files change
   - Track quality assessment timestamps

### Expected Outcomes

- Enhanced prompts that warn about codebase anti-patterns
- Automatic recommendations for coding standards
- Resilient generation with graceful degradation

---

## Phase D: Agent Generation Integration

**Priority**: MEDIUM
**Estimated Batches**: 2 (Batches 11-12)
**Purpose**: Improve agent selection and generation with quality awareness

### Tasks

1. **Update DeepProjectAnalysisService**

   - Consume `ProjectIntelligenceService` instead of duplicating analysis
   - Leverage quality assessment for agent recommendations
   - Reduce redundant workspace scanning

2. **Enhance ContentGenerationService**

   - Include quality context in agent templates
   - Add project-specific coding guidelines
   - Customize agent behavior based on detected patterns

3. **Improve Agent Recommendation Scoring**
   - Factor quality score into agent suitability
   - Recommend agents based on detected gaps
   - Prioritize agents that address specific anti-patterns

### Expected Outcomes

- More accurate agent recommendations
- Project-tailored agent configurations
- Reduced duplicate analysis across services

---

## Phase E2: Additional Anti-Pattern Rules

**Priority**: MEDIUM
**Estimated Batches**: 1 (Batch 13)
**Purpose**: Expand rule coverage for framework-specific patterns

### Angular-Specific Rules

```typescript
// Proposed rules
- angularImproperChangeDetection: OnPush without proper immutability
- angularSubscriptionLeak: Observables not unsubscribed in ngOnDestroy
- angularCircularDependency: Service circular injections
- angularLargeComponent: Components > 500 lines
- angularMissingTrackBy: *ngFor without trackBy function
```

### NestJS-Specific Rules

```typescript
// Proposed rules
- nestjsMissingDecorator: Injectable without @Injectable()
- nestjsControllerLogic: Business logic in controllers
- nestjsUnsafeRepository: Raw SQL queries without parameterization
- nestjsMissingGuard: Sensitive endpoints without guards
- nestjsCircularModule: Module circular imports
```

### React-Specific Rules (If Applicable)

```typescript
// Proposed rules
- reactMissingKey: List items without key prop
- reactDirectStateUpdate: Direct state mutation
- reactUseEffectDependencies: Missing useEffect dependencies
- reactLargeComponent: Components > 300 lines
```

---

## Phase F: Performance Optimizations

**Priority**: LOW
**Estimated Batches**: 1 (Batch 14)
**Purpose**: Improve analysis speed for large codebases

### Proposed Optimizations

1. **Incremental Analysis**

   - Cache file hashes for change detection
   - Only re-analyze changed files
   - Merge incremental results with cached assessment

2. **Parallel Rule Execution**

   - Run rules in parallel using worker threads
   - Batch file processing for memory efficiency
   - Progress streaming for large workspaces

3. **Smart Sampling Improvements**

   - Learn from historical analysis patterns
   - Prioritize files most likely to have issues
   - Adaptive sample size based on project size

4. **AST-Based Detection (Phase 2 of AST)**
   - Use Tree-sitter for accurate pattern detection
   - Semantic analysis vs. regex matching
   - Type-aware pattern detection

### Performance Targets

- < 3s for workspaces < 1,000 files
- < 10s for workspaces < 10,000 files
- Incremental updates < 1s for file changes

---

## Phase G: Reporting and Visualization

**Priority**: LOW
**Estimated Batches**: 1 (Batch 15)
**Purpose**: Provide actionable insights through reports and dashboards

### Features

1. **Quality Dashboard Component**

   - Angular component for quality visualization
   - Score trends over time
   - Anti-pattern distribution charts

2. **Export Capabilities**

   - Markdown report generation
   - JSON/CSV export for CI integration
   - GitHub PR comment integration

3. **Historical Tracking**
   - Quality score history
   - Trend analysis
   - Improvement recommendations

---

## Implementation Priority

| Phase | Name                          | Priority | Effort    | Impact |
| ----- | ----------------------------- | -------- | --------- | ------ |
| C     | Enhanced Prompts Integration  | HIGH     | 2 batches | HIGH   |
| D     | Agent Generation Integration  | MEDIUM   | 2 batches | MEDIUM |
| E2    | Additional Anti-Pattern Rules | MEDIUM   | 1 batch   | MEDIUM |
| F     | Performance Optimizations     | LOW      | 1 batch   | LOW    |
| G     | Reporting and Visualization   | LOW      | 1 batch   | LOW    |

**Recommended Next Step**: Phase C - Enhanced Prompts Integration

This provides the highest value by making quality awareness immediately visible to users through improved prompt generation.

---

## Integration Points

### Current Integration Status

- [x] `ProjectIntelligenceService` registered in DI container
- [x] Exports available from `@ptah-extension/workspace-intelligence`
- [x] Types available from `@ptah-extension/shared`
- [x] Tokens available from `@ptah-extension/vscode-core`

### Future Integration Requirements

- [ ] PromptDesignerAgent needs `ProjectIntelligenceService` injection
- [ ] DeepProjectAnalysisService should delegate to `ProjectIntelligenceService`
- [ ] Setup wizard could display quality score
- [ ] Chat UI could show quality warnings

---

## Notes

- Phase C and D can be parallelized if resources allow
- Phase E2 rules should be developed based on actual usage patterns
- Performance optimizations should be driven by measured bottlenecks
- Reporting features should be prioritized based on user feedback

# Task Context - TASK_PRV_005

## Original User Request

Extract Workspace Intelligence Services from `apps/ptah-extension-vscode/src/services/workspace-manager.ts` to `libs/backend/workspace-intelligence/` following MONSTER plan Week 6 specifications and BACKEND_LIBRARY_GAP_ANALYSIS.md recommendations.

## Reference Documents

- **Primary**: `docs/BACKEND_LIBRARY_GAP_ANALYSIS.md` (Option A: Extract → Enhance → Structure)
- **Architecture Plan**: `docs/MONSTER_EXTENSION_REFACTOR_PLAN.md` (Week 6: Workspace Intelligence)
- **Current Implementation**: `apps/ptah-extension-vscode/src/services/workspace-manager.ts` (~300 lines)

## Scope

Extract, enhance, and structure workspace intelligence features into proper library:

### Source Files to Extract

1. **`workspace-manager.ts`** (~300 lines)
   - Workspace folder detection (vscode.workspace.workspaceFolders)
   - File system operations (read, write, watch)
   - Project root resolution
   - File change monitoring

### Target Library Structure

```
libs/backend/workspace-intelligence/
├── src/
│   ├── project-analysis/
│   │   ├── project-type-detector.ts           # Extract/enhance from workspace-manager
│   │   ├── dependency-analyzer.ts             # New: package.json, requirements.txt parsing
│   │   ├── framework-detector.ts              # New: React, Angular, Next.js detection
│   │   └── index.ts
│   ├── file-indexing/
│   │   ├── workspace-indexer.ts               # Extract/enhance from workspace-manager
│   │   ├── ignore-pattern-resolver.ts         # New: .gitignore, .vscodeignore support
│   │   ├── file-type-classifier.ts            # New: Smart file type grouping
│   │   └── index.ts
│   ├── optimization/
│   │   ├── context-size-optimizer.ts          # New: Token estimation
│   │   ├── file-relevance-scorer.ts           # New: Intelligent file selection
│   │   └── index.ts
│   └── index.ts  # Export all intelligence services
```

## Features to Extract & Enhance

### Extract from Existing Code

| Feature                    | Current State           | Enhancement Needed                        |
| -------------------------- | ----------------------- | ----------------------------------------- |
| Workspace folder detection | ✅ Basic implementation | Enhance with multi-root workspace support |
| File system operations     | ✅ Basic implementation | Add caching and debouncing                |
| Project root resolution    | ✅ Basic implementation | Add monorepo support (Nx, Lerna, Rush)    |
| File change monitoring     | ✅ Basic implementation | Add smart batching and filtering          |

### New Features to Implement

| Feature                       | Purpose                                       | Priority |
| ----------------------------- | --------------------------------------------- | -------- |
| **Project Type Detection**    | Identify npm, Python, Go, Rust, etc.          | HIGH     |
| **Framework Detection**       | React, Angular, Vue, Next.js, Nuxt            | HIGH     |
| **Dependency Analysis**       | Parse package.json, requirements.txt, go.mod  | MEDIUM   |
| **Ignore Pattern Resolution** | Respect .gitignore, .vscodeignore             | HIGH     |
| **File Type Classification**  | Group files by purpose (source, test, config) | MEDIUM   |
| **Context Size Optimization** | Estimate token count for file selection       | HIGH     |
| **File Relevance Scoring**    | Intelligent file selection for context        | MEDIUM   |

## Success Criteria

1. ✅ All workspace management logic extracted from `workspace-manager.ts`
2. ✅ Project type detection for 5+ ecosystems (npm, Python, Go, Rust, Java)
3. ✅ Framework detection for 3+ frameworks (React, Angular, Vue)
4. ✅ Ignore pattern support (.gitignore, .vscodeignore, .prettierignore)
5. ✅ File type classification (source, test, config, docs)
6. ✅ Context size optimizer with token estimation
7. ✅ File relevance scorer for intelligent selection
8. ✅ Unit tests for all modules (≥80% coverage)
9. ✅ Integration tests with workspace scenarios
10. ✅ Documentation for each module
11. ✅ Integration with `ai-providers-core` for context optimization
12. ✅ Deprecation plan for old `workspace-manager.ts`

## Dependencies

- **Blocked by**: None (can run in parallel with TASK_PRV_004)
- **Blocks**: None (but enhances TASK_PRV_002 Angular UI)
- **Related**: TASK_PRV_004 (Claude Domain extraction)

## Estimated Timeline

**3-4 days** (per gap analysis recommendation)

- Day 1: Extract existing workspace-manager logic + project type detection
- Day 2: Implement framework detection + dependency analysis
- Day 3: Implement file indexing with ignore patterns + file type classification
- Day 4: Context optimization + file relevance scoring + testing

## Implementation Priorities

### Phase 1: Extract (1 day)

- Extract workspace folder detection
- Extract file system operations
- Extract project root resolution
- Basic file indexing

### Phase 2: Enhance (1.5 days)

- Project type detection (npm, Python, Go, Rust, Java)
- Framework detection (React, Angular, Vue, Next.js)
- Dependency analysis (package.json, requirements.txt)
- Ignore pattern support

### Phase 3: Optimize (1.5 days)

- File type classification
- Context size optimizer (token estimation)
- File relevance scorer
- Smart file selection algorithms

## Notes

This task follows **Option A (MONSTER Plan Compliance)** from the gap analysis:

- Extract existing code as foundation
- Enhance with intelligent features
- Structure for future extensibility
- Integration with provider system for context optimization

**Strategic Value**: This library enables intelligent context management, reducing token costs and improving AI response quality by selecting only relevant files.

# TASK_2025_039: Implementation Tasks

## Task Breakdown

### Phase 1: Type Definitions ✅ COMPLETE

- ✅ **Task 1.1**: Define enhanced `AINamespace` interface with all new methods (COMPLETE)
- ✅ **Task 1.2**: Define `IDENamespace` interface with sub-namespaces (lsp, editor, actions, testing) (COMPLETE)
- ✅ **Task 1.3**: Define supporting types (Location, HoverInfo, CodeAction, TestResult, etc.) (COMPLETE)
- ✅ **Task 1.4**: Update `PtahAPI` interface to include enhanced structure (COMPLETE)

**Batch 1 Commit**: [pending]

### Phase 2: LLM Enhancements (ptah.ai.\*)

- [ ] **Task 2.1**: Enhance `selectModel()` to return full metadata (maxInputTokens, vendor, version)
- [ ] **Task 2.2**: Implement `chatWithHistory()` - multi-turn conversations
- [ ] **Task 2.3**: Implement `chatStream()` - streaming responses with callback
- [ ] **Task 2.4**: Implement `chatWithSystem()` - chat with system prompt (XML-delimited format)
- [ ] **Task 2.5**: Implement `invokeAgent()` - load .md file as system prompt, invoke cheap model
- [ ] **Task 2.6**: Implement `countTokens()` - model-specific token counting
- [ ] **Task 2.7**: Implement `countFileTokens()` - token count for files
- [ ] **Task 2.8**: Implement `fitsInContext()` - context capacity checker
- [ ] **Task 2.9**: Implement `getTools()` - list registered VS Code LM tools
- [ ] **Task 2.10**: Implement `invokeTool()` - invoke VS Code tools directly
- [ ] **Task 2.11**: Implement `chatWithTools()` - chat with tool access

### Phase 3: Specialized AI Tasks

- [ ] **Task 3.1**: Implement `summarize()` - content summarization
- [ ] **Task 3.2**: Implement `explain()` - code explanation with context
- [ ] **Task 3.3**: Implement `review()` - code review via LM
- [ ] **Task 3.4**: Implement `transform()` - code transformation
- [ ] **Task 3.5**: Implement `generate()` - code generation from description

### Phase 4: IDE LSP Namespace (ptah.ai.ide.lsp.\*)

- [ ] **Task 4.1**: Implement `getDefinition()` - go to definition
- [ ] **Task 4.2**: Implement `getReferences()` - find all references
- [ ] **Task 4.3**: Implement `getHover()` - hover info (types, docs)
- [ ] **Task 4.4**: Implement `getTypeDefinition()` - type definition location
- [ ] **Task 4.5**: Implement `getSignatureHelp()` - function signatures

### Phase 5: IDE Editor Namespace (ptah.ai.ide.editor.\*)

- [ ] **Task 5.1**: Implement `getActive()` - active file, line, selection
- [ ] **Task 5.2**: Implement `getOpenFiles()` - all open files
- [ ] **Task 5.3**: Implement `getDirtyFiles()` - unsaved files
- [ ] **Task 5.4**: Implement `getRecentFiles()` - recently accessed files
- [ ] **Task 5.5**: Implement `getVisibleRange()` - visible code range

### Phase 6: IDE Actions Namespace (ptah.ai.ide.actions.\*)

- [ ] **Task 6.1**: Implement `getAvailable()` - get available code actions
- [ ] **Task 6.2**: Implement `apply()` - apply a code action
- [ ] **Task 6.3**: Implement `rename()` - rename symbol across workspace
- [ ] **Task 6.4**: Implement `organizeImports()` - organize imports
- [ ] **Task 6.5**: Implement `fixAll()` - apply all auto-fixes

### Phase 7: IDE Testing Namespace (ptah.ai.ide.testing.\*)

- [ ] **Task 7.1**: Implement `discover()` - discover tests
- [ ] **Task 7.2**: Implement `run()` - run tests with options
- [ ] **Task 7.3**: Implement `getLastResults()` - last test results
- [ ] **Task 7.4**: Implement `getCoverage()` - coverage info

### Phase 8: Integration & Documentation

- [ ] **Task 8.1**: Update `ptah-api-builder.service.ts` to wire new namespaces
- [ ] **Task 8.2**: Write unit tests for LLM enhancements
- [ ] **Task 8.3**: Write unit tests for IDE namespace

### Phase 9: Discovery & Guidance System

- [ ] **Task 9.1**: Update `tool-description.builder.ts` with concise API reference (all 16 namespaces)
- [ ] **Task 9.2**: Implement `ptah.help(topic?)` - self-documentation method
- [ ] **Task 9.3**: Create documentation data structure for ptah.help() to query
- [ ] **Task 9.4**: Create `.claude/PTAH_GUIDE.md` - strategic usage guide
- [ ] **Task 9.5**: Update project `CLAUDE.md` with Ptah capabilities section

## Progress Tracking

| Phase                | Tasks  | Status         | Completion |
| -------------------- | ------ | -------------- | ---------- |
| Phase 1: Types       | 4      | ✅ IMPLEMENTED | 100%       |
| Phase 2: LLM         | 11     | Not Started    | 0%         |
| Phase 3: AI Tasks    | 5      | Not Started    | 0%         |
| Phase 4: LSP         | 5      | Not Started    | 0%         |
| Phase 5: Editor      | 5      | Not Started    | 0%         |
| Phase 6: Actions     | 5      | Not Started    | 0%         |
| Phase 7: Testing     | 4      | Not Started    | 0%         |
| Phase 8: Integration | 3      | Not Started    | 0%         |
| Phase 9: Discovery   | 5      | Not Started    | 0%         |
| **TOTAL**            | **47** | In Progress    | 8.5%       |

## Assignment Notes

- **Developer**: backend-developer (VS Code extension expertise)
- **Reviewer**: code-logic-reviewer (ensure completeness)
- **Tester**: senior-tester (verify all methods work)

## Git Branch

```bash
git checkout -b feature/TASK_2025_039
```

## Commit Convention

```
feat(vscode-lm-tools): <description>
```

Examples:

- `feat(vscode-lm-tools): add enhanced selectModel with full metadata`
- `feat(vscode-lm-tools): implement chatWithHistory for multi-turn conversations`
- `feat(vscode-lm-tools): add ide.lsp namespace with definition/references`

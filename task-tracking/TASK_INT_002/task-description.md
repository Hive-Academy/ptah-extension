# Requirements Document - TASK_INT_002

**Created**: October 15, 2025  
**Task ID**: TASK_INT_002  
**Domain**: Integration (INT)  
**Priority**: P0 - Critical (Extension currently non-functional)  
**Complexity**: Medium (2 critical fixes + documentation)  
**Estimated Timeline**: 4-6 hours (within 1 day)

---

## Introduction

### Business Context

The Ptah VS Code extension has completed **Week 6 of the MONSTER refactor plan**, delivering 8,965+ lines of production-ready backend infrastructure with 94% test coverage and full EventBus architecture migration. However, the **Angular webview cannot be loaded** by the VS Code extension due to two critical integration issues:

1. **Path Mismatch**: HTML generator looking in wrong directory (`out/webview/browser/` vs. `dist/apps/ptah-extension-vscode/webview/browser/`)
2. **Build Failure**: Angular webview build failing due to CSS component styles exceeding budget limits

**Without this integration fix**, the extension is **non-functional** and **cannot be tested**, blocking all frontend development progress and preventing Week 7-9 MONSTER plan execution.

### Value Proposition

**Fixing these issues will**:

- **Unblock testing**: Enable F5 debugging and manual testing of complete extension
- **Enable frontend development**: Allow Week 7-9 Angular modernization to proceed
- **Validate MONSTER progress**: Verify backend + frontend integration works end-to-end
- **Establish baseline**: Create testing guide for ongoing development workflow

---

## Requirements

### Requirement 1: Build Output Path Alignment

**User Story**: As a VS Code extension developer using the Ptah extension in debug mode (F5), I want the Angular webview to load successfully in the extension sidebar, so that I can test and develop the extension's UI features.

#### Acceptance Criteria

1. **WHEN** the extension activates in Extension Development Host **THEN** the `WebviewHtmlGenerator` SHALL read Angular's `index.html` from the correct path `dist/apps/ptah-extension-vscode/webview/browser/`

2. **WHEN** the `WebviewHtmlGenerator._getHtmlForWebview()` method executes **THEN** the `appDistPath` variable SHALL resolve to `{extensionPath}/dist/apps/ptah-extension-vscode/webview/browser/` (not `{extensionPath}/out/webview/browser/`)

3. **WHEN** the fallback HTML generation is triggered **THEN** all asset URIs SHALL resolve to the correct Angular build output directory using `vscode.Uri.joinPath()`

4. **WHEN** Angular webview assets (main.js, styles.css, polyfills.js) are requested **THEN** they SHALL be found and loaded from `dist/apps/ptah-extension-vscode/webview/browser/` without 404 errors

5. **WHEN** the extension runs in production mode **THEN** the path resolution SHALL work identically to development mode (no environment-specific paths)

**Affected Files**:

- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (lines ~35, ~150)

**Verification Method**:

- Launch Extension Development Host (F5)
- Open Ptah sidebar
- Check VS Code Developer Tools Network tab for 200 status on all asset requests
- Verify no 404 errors in console

---

### Requirement 2: Angular Webview Build Success

**User Story**: As a build system user running `npm run build:webview`, I want the Angular application to build successfully without budget errors, so that the webview output exists and can be loaded by the VS Code extension.

#### Acceptance Criteria

1. **WHEN** `npm run build:webview` is executed **THEN** the build SHALL complete successfully without errors (exit code 0)

2. **WHEN** the build completes **THEN** the output folder `dist/apps/ptah-extension-vscode/webview/browser/` SHALL exist with the following files:
   - `index.html` (transformed Angular index)
   - `main-{hash}.js` (main application bundle)
   - `polyfills-{hash}.js` (polyfills bundle)
   - `styles-{hash}.css` (compiled styles)

3. **WHEN** CSS component styles are bundled **THEN** they SHALL NOT exceed the maximum error budget (adjusted to 16KB from 8KB for quick fix)

4. **WHEN** the main bundle is created **THEN** it SHALL NOT exceed 600KB initial size (adjusted from 500KB for quick fix)

5. **WHEN** development build is run (`npm run build:webview:dev`) **THEN** budget checks SHALL be skipped and source maps SHALL be generated

**Affected Files**:

- `apps/ptah-extension-webview/project.json` (build configuration budgets)

**Verification Method**:

- Run `npm run build:webview` and verify exit code 0
- List `dist/apps/ptah-extension-vscode/webview/browser/` directory
- Verify all expected files exist with content

---

### Requirement 3: Extension-to-Webview Integration Verification

**User Story**: As a QA engineer testing the extension, I want to verify that messages pass correctly between the VS Code extension and Angular webview, so that I can confirm the EventBus architecture is functional end-to-end.

#### Acceptance Criteria

1. **WHEN** the Angular webview loads **THEN** it SHALL send a `webview-ready` message to the extension

2. **WHEN** the extension receives `webview-ready` **THEN** it SHALL respond with `initialData` message containing sessions, context, and configuration

3. **WHEN** a user sends a chat message from the Angular UI **THEN** the `sendMessage` event SHALL publish to the EventBus with `source: 'webview'`

4. **WHEN** the EventBus routes a webview message **THEN** the `MessageHandlerService` SHALL receive it and forward to appropriate orchestration service

5. **WHEN** the extension sends a response message **THEN** the Angular webview SHALL receive it and update the UI accordingly

**Affected Components**:

- `AngularWebviewProvider.handleWebviewMessage()` (message reception)
- `EventBus.publish()` (message routing)
- Angular webview `VscodeService` (message sending)

**Verification Method**:

- Launch Extension Development Host
- Open Ptah sidebar
- Open VS Code Developer Tools console
- Send test message from webview
- Verify EventBus logs show message received and routed
- Check extension host output for orchestration service response

---

### Requirement 4: Development Workflow Documentation

**User Story**: As a new developer joining the Ptah project, I want clear step-by-step instructions for building, running, and testing the extension, so that I can set up my development environment and contribute effectively.

#### Acceptance Criteria

1. **WHEN** a developer reads `testing-guide.md` **THEN** they SHALL understand:
   - How to build the extension (`npm run build:extension`)
   - How to build the webview (`npm run build:webview:dev`)
   - How to launch Extension Development Host (F5 in VS Code)
   - How to test message passing between extension and webview
   - How to debug issues using VS Code Developer Tools

2. **WHEN** a developer follows the testing guide **THEN** they SHALL successfully:
   - Build both extension and webview without errors
   - Launch the extension in debug mode
   - See the Angular app render in the Ptah sidebar
   - Send a test message and verify it routes through EventBus

3. **WHEN** build errors occur **THEN** the guide SHALL provide troubleshooting steps for:
   - CSS budget errors (increase budgets or use dev build)
   - Path resolution errors (verify webpack config)
   - Asset loading 404 errors (check localResourceRoots)

**Deliverable**: `task-tracking/TASK_INT_002/testing-guide.md`

**Verification Method**: Have a developer unfamiliar with the project follow the guide and report success/failure

---

### Requirement 5: MONSTER Plan Progress Overview

**User Story**: As a project stakeholder reviewing the MONSTER refactor progress, I want a comprehensive summary of what has been completed (Weeks 1-6) and what remains (Weeks 7-9), so that I can understand the project status and next steps.

#### Acceptance Criteria

1. **WHEN** stakeholders read `monster-progress-overview.md` **THEN** they SHALL see:
   - **Weeks 1-6 Summary**: Backend infrastructure achievements with line counts and test coverage
   - **Week 7-9 Status**: Frontend library extraction progress (TASK_FE_001 at 92%)
   - **Integration Status**: EventBus architecture migration complete
   - **Current Blockers**: CSS budgets and path mismatch (this task)
   - **Next Steps**: TASK_SES_001, TASK_ANLYT_001, TASK_PERF_001, TASK_THEME_001

2. **WHEN** the overview is created **THEN** it SHALL include metrics:
   - Total backend libraries: 4 (vscode-core, ai-providers-core, claude-domain, workspace-intelligence)
   - Total production code: 8,965+ lines
   - Average test coverage: 94%
   - Frontend components migrated: 36/41 (92%)
   - Bundle size reduction: -150 KB

3. **WHEN** risks are documented **THEN** they SHALL identify:
   - CSS budget technical debt requiring consolidation
   - Frontend library extraction completion needed for Week 9
   - Testing coverage gaps in Angular components

**Deliverable**: `task-tracking/TASK_INT_002/monster-progress-overview.md`

**Verification Method**: Stakeholder review confirms clarity and accuracy

---

## Non-Functional Requirements

### Performance Requirements

- **Build Time**: Full webview build (production) < 15 seconds
- **Development Build**: Webview build (development) < 10 seconds  
- **Extension Load Time**: WebviewView visible within 2 seconds of sidebar activation
- **Hot Reload**: File changes reflected in webview within 500ms (development mode)

### Reliability Requirements

- **Build Success Rate**: 100% after fixes applied (no intermittent failures)
- **Extension Activation**: Must succeed on first attempt (no retry logic needed)
- **Message Passing**: 100% message delivery between extension ↔ webview

### Maintainability Requirements

- **Path Configuration**: Single source of truth for build output paths (DRY principle)
- **Documentation**: Testing guide clear enough for developers unfamiliar with codebase
- **Debugging**: All integration points logged for troubleshooting

### Security Requirements

- **CSP Compliance**: Content Security Policy must allow Angular app to load without `unsafe-inline`
- **Asset Validation**: All webview assets loaded from trusted local paths only
- **No External Resources**: No CDN dependencies (offline-first extension)

---

## Risk Assessment

### Technical Risks

| Risk                                     | Probability | Impact   | Score | Mitigation Strategy                                                  | Contingency                                   |
| ---------------------------------------- | ----------- | -------- | ----- | -------------------------------------------------------------------- | --------------------------------------------- |
| **Path resolution breaks in production** | Medium      | Critical | 6     | Test with packaged extension (.vsix), verify paths are relative     | Revert to absolute paths if needed            |
| **CSS budgets block frontend progress**  | High        | High     | 9     | Quick fix: increase budgets; Long-term: CSS consolidation (FE_001)   | Use development build indefinitely            |
| **EventBus message routing fails**       | Low         | High     | 3     | Manual E2E testing, add integration tests for message flow           | Add fallback direct message handler           |
| **Angular build breaks with new libs**   | Medium      | Medium   | 4     | Incremental testing after each library extraction                    | Rollback library changes, fix budgets first   |
| **Hot reload stops working**             | Low         | Low      | 1     | File watcher already implemented, test after path fix                | Manual browser refresh acceptable in dev mode |

### Business Risks

- **Schedule Risk**: If CSS consolidation is required (not budget increase), adds 1-2 days to timeline
- **Resource Risk**: Single developer working on this (no parallelization possible)
- **Integration Risk**: TASK_FE_001 blocked until this task completes

### Dependency Risks

- **External Dependencies**: None (all fixes are internal configuration)
- **Tool Dependencies**: Nx build system and Angular CLI must work correctly (low risk, stable tools)
- **Team Dependencies**: No cross-team coordination required

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder         | Impact Level | Involvement      | Success Criteria                               |
| ------------------- | ------------ | ---------------- | ---------------------------------------------- |
| **Backend Team**    | High         | Verification     | EventBus integration confirmed working         |
| **Frontend Team**   | Critical     | Testing          | Angular app loads and renders correctly        |
| **QA Engineer**     | High         | Manual Testing   | Testing guide allows successful E2E validation |
| **Project Manager** | Medium       | Progress Review  | MONSTER plan progress documented accurately    |

### Secondary Stakeholders

| Stakeholder         | Impact Level | Involvement    | Success Criteria                              |
| ------------------- | ------------ | -------------- | --------------------------------------------- |
| **DevOps**          | Low          | Build Pipeline | Build scripts work in CI/CD (future)          |
| **Documentation**   | Medium       | Review         | Testing guide clear and comprehensive         |
| **Future Devs**     | Medium       | Onboarding     | New developers can set up environment quickly |

---

## Dependencies

### Upstream Dependencies (Blocking This Task)

- ✅ **EventBus Architecture**: Already complete (MAIN_APP_CLEANUP)
- ✅ **Backend Libraries**: All 4 libraries built and tested
- ✅ **Angular Migration**: 92% complete (TASK_FE_001, but not blocking path fix)

### Downstream Dependencies (Blocked By This Task)

- ⏸️ **TASK_FE_001 Completion**: Final 5 components cannot be tested until webview loads
- ⏸️ **TASK_SES_001**: Session library extraction requires testable extension
- ⏸️ **TASK_ANLYT_001**: Analytics library extraction requires testable extension
- ⏸️ **TASK_PERF_001**: Performance monitoring requires functional webview
- ⏸️ **TASK_THEME_001**: VS Code theme integration requires testable webview

**Critical Path Impact**: This task is **blocking all Week 7-9 MONSTER plan work**.

---

## Quality Gates

### Before Implementation

- [ ] Context document reviewed and approved
- [ ] Integration analysis document complete
- [ ] Path mismatch root cause confirmed
- [ ] CSS budget errors root cause confirmed
- [ ] Stakeholder alignment on quick fix vs. proper fix approach

### During Implementation

- [ ] Path fixes applied to `webview-html-generator.ts`
- [ ] CSS budgets adjusted in `project.json`
- [ ] Development build script added to `package.json`
- [ ] Build succeeds with exit code 0
- [ ] Webview folder exists with all expected files

### After Implementation

- [ ] Extension loads webview successfully in Extension Development Host
- [ ] No 404 errors in VS Code Developer Tools Network tab
- [ ] `webview-ready` message sent from Angular to extension
- [ ] `initialData` message sent from extension to Angular
- [ ] Test message routes through EventBus successfully
- [ ] Testing guide created and verified
- [ ] MONSTER progress overview document created
- [ ] All acceptance criteria validated

---

## Success Metrics

### Immediate Success (This Task)

- [ ] **Build Success**: `npm run build:webview` exits with code 0
- [ ] **Path Resolution**: No 404 errors when loading webview assets
- [ ] **Message Passing**: EventBus logs show webview messages routed correctly
- [ ] **Documentation**: Testing guide allows new developer to set up in < 30 minutes

### Long-Term Success (Week 7-9)

- [ ] **Frontend Progress**: TASK_FE_001 completes final 5 components
- [ ] **Library Extraction**: TASK_SES_001, TASK_ANLYT_001 can proceed
- [ ] **Performance**: TASK_PERF_001 establishes baseline metrics
- [ ] **Theme Integration**: TASK_THEME_001 delivers VS Code theme tokens

---

## Timeline Discipline

**Estimated Effort**: 4-6 hours (within 2-week limit)

**Breakdown**:

- **Path Fix**: 30 minutes (2 file edits + verification)
- **CSS Budget Fix**: 15 minutes (1 config change)
- **Build Verification**: 30 minutes (run builds, verify output)
- **Integration Testing**: 1 hour (launch F5, test message passing, debug issues)
- **Testing Guide**: 1 hour (write comprehensive step-by-step instructions)
- **MONSTER Overview**: 1 hour (summarize Weeks 1-6, document Weeks 7-9 plan)
- **Buffer**: 1 hour (unexpected issues, re-testing)

**No scope expansion**: If CSS consolidation is needed (beyond budget increase), defer to **TASK_FE_001_CSS** as future work.

---

## Next Phase Recommendation

### Decision: Skip Research Phase

**Rationale**:

- ✅ **Problem is well-understood**: Path mismatch and CSS budgets identified with evidence
- ✅ **Solution is straightforward**: 2 config changes + 1 code fix
- ✅ **No new technology**: Angular build system, Webpack, VS Code webview APIs all known
- ✅ **No unknowns**: Integration analysis already complete with root cause

### Recommended Next Phase

- [x] **software-architect** - Skip (no architecture changes needed)
- [x] **backend-developer** - Direct to implementation (this is a config + 1 code fix)

**Delegation Target**: **Backend Developer** (or **Full-Stack Developer** if Angular skills needed for verification)

**Delegation Package**:

```markdown
**Next Agent**: backend-developer (or frontend-developer with backend skills)
**Task Focus**: Apply 3 critical fixes to unblock extension testing
**Time Budget**: 2-3 hours (fixes) + 2-3 hours (documentation)
**Quality Bar**: 
  - Build succeeds (exit code 0)
  - Extension loads webview (no 404s)
  - Message passing functional (EventBus logs confirm)
  - Testing guide allows new developer setup in < 30 min
```

---

## Deliverables Summary

1. ✅ **task-description.md** (this document)
2. ⏳ **implementation-plan.md** (software-architect creates this, OR skip directly to implementation)
3. ⏳ **Code fixes**:
   - `webview-html-generator.ts` (path alignment)
   - `project.json` (CSS budget increase)
   - `package.json` (dev build script)
4. ⏳ **testing-guide.md** (developer creates after fixes applied)
5. ⏳ **monster-progress-overview.md** (developer creates for stakeholders)
6. ⏳ **test-report.md** (senior-tester validates)
7. ⏳ **code-review.md** (code-reviewer final validation)

---

**Requirements Analysis Complete**: October 15, 2025  
**Classification**: P0-Critical | Integration | Medium Complexity  
**Estimated Completion**: October 15, 2025 (same day)  
**Blocking**: All Week 7-9 MONSTER plan tasks

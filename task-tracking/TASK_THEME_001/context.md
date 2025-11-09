# TASK_THEME_001 Context - VS Code Theme Integration

**Created**: October 10, 2025  
**MONSTER Week**: 9  
**Parent Plan**: [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md)

---

## 🎯 Task Origin

### User Request Alignment

This task implements **Week 9 (FINAL WEEK)** of the MONSTER plan before integration. From the MONSTER plan:

```markdown
Week 9: Theme Integration

Objectives:

- VS Code theme integration
- Design tokens system
- Themed base components
- Egyptian-themed UI finalization

Estimated Effort: 1 week
```

### Strategic Context

**Final Pre-Integration Task**:

- ✅ Week 6: workspace-intelligence library (COMPLETE)
- 📋 Weeks 1-6 Deferred: TASK_CORE_001 (infrastructure)
- 📋 Week 7: TASK_SES_001 + TASK_ANLYT_001 (session + analytics)
- 📋 Week 8: TASK_PERF_001 (performance monitoring)
- **🎯 Week 9: TASK_THEME_001 (THIS TASK) - Theme integration**
- ⏳ Integration: TASK_INT_001 (final library integration)

**Business Value**:

- **Native VS Code look-and-feel**: Seamless integration with editor
- **Automatic theme switching**: Light/dark/high-contrast support
- **Accessibility**: WCAG compliance via VS Code themes
- **Egyptian-themed enhancements**: Unique branding while respecting VS Code UX

---

## 📁 Scope Definition

### What This Task IS

**Core Responsibilities**:

1. **VS Code Theme Integration**

   - Extract current theme colors via VS Code API
   - Map VS Code theme tokens to CSS custom properties
   - Auto-update webview theme when VS Code theme changes

2. **Design Token System**

   - Create design token definitions (colors, spacing, typography)
   - Map tokens to VS Code theme variables
   - Fallback values for unsupported themes

3. **Themed Base Components**

   - Update existing shared UI components to use design tokens
   - Ensure all components respect active VS Code theme
   - Test across light, dark, high-contrast themes

4. **Egyptian Theme Enhancements**
   - Preserve Egyptian-themed components (hieroglyphics, papyrus textures)
   - Make Egyptian elements theme-aware (adapt to light/dark)
   - Optional Egyptian theme mode (user preference)

---

### What This Task IS NOT

**Out of Scope**:

- ❌ Creating custom VS Code color themes (user's theme is respected)
- ❌ Replacing ALL Egyptian theming (keep unique branding)
- ❌ Theme marketplace publishing (future enhancement)
- ❌ Advanced theming API for third-party extensions

---

## 🏗️ Target Library/Component Structure

### Theme Integration Components

**Not a new backend library** - this is primarily **frontend work** in Angular webview.

### Where Components Live

1. **Theme Extraction Service** → vscode-core (backend)

   - `libs/backend/vscode-core/src/theming/theme-extractor.ts`
   - Reads VS Code theme via API
   - Sends theme data to webview

2. **Design Tokens** → Angular app (frontend)

   - `apps/ptah-extension-webview/src/app/shared/design-tokens/`
   - TypeScript token definitions
   - CSS custom properties

3. **Themed Components** → shared-ui (existing)

   - `libs/frontend/shared-ui/` components updated
   - Use design tokens instead of hardcoded colors

4. **Egyptian Theme Components** → shared-ui (existing)
   - `libs/frontend/shared-ui/egyptian/` (if separate)
   - Theme-aware hieroglyphics, papyrus textures

---

## 🔗 Integration Points

### Upstream Dependencies

**Libraries This Task Depends On**:

1. **@ptah-extension/vscode-core** (from TASK_CORE_001)

   - EventBus for theme change events
   - WebviewManager for theme data messaging

2. **Angular Webview** (existing)

   - Shared UI components in `libs/frontend/shared-ui/`
   - Egyptian-themed components (current implementation)

3. **VS Code Theme API**
   - `vscode.window.activeColorTheme`
   - `vscode.workspace.onDidChangeConfiguration`
   - Color token APIs

**Soft Dependencies**:

- TASK_PERF_001 (performance dashboard should be themed too)
- TASK_ANLYT_001 (analytics dashboard should be themed too)

---

### Downstream Integrations

**Who Uses Theme System**:

1. **All Angular Components**

   - Chat components (message bubbles, code blocks)
   - Dashboard components (charts, cards)
   - Session components (session list, session info)

2. **Future Components**
   - Any new UI components use design tokens
   - Third-party integrations respect theme

---

## 📊 Research Context

### Theme Integration Best Practices

**Research Questions** (to be answered in research-report.md):

1. **VS Code Theme API**:

   - How to read current theme colors?
   - How to listen for theme changes?
   - Available color tokens (foreground, background, accent, etc.)
   - High-contrast mode detection

2. **Design Token Systems**:

   - Industry standards (Design Tokens Community Group spec)
   - Token naming conventions (semantic vs. descriptive)
   - Token hierarchy (primitive → semantic → component)
   - CSS custom properties vs. TypeScript constants

3. **Webview Theming Patterns**:

   - How do other extensions (GitLens, Copilot) handle themes?
   - Message passing for theme data
   - Performance of theme switching
   - Avoiding flicker during theme transitions

4. **Accessibility**:
   - WCAG contrast requirements
   - High-contrast mode support
   - Focus indicators and visual states
   - Screen reader compatibility (already in VS Code)

---

### Existing Patterns

**Current Egyptian Theme** (from existing webview):

- ✅ Papyrus textures, hieroglyphic icons
- ✅ Custom color palette (gold, sandstone, etc.)
- ⚠️ Hardcoded colors (need to make theme-aware)

**Angular Patterns**:

- ✅ Signal-based reactivity (perfect for theme changes)
- ✅ Standalone components (easy to update)
- ✅ Tailwind CSS (can use CSS variables)

**Lessons Applied**:

- Preserve unique Egyptian branding
- Make colors adaptive to VS Code theme
- Use signals for reactive theme switching
- Test across all VS Code theme types

---

## 🎯 Success Criteria

### Theme Integration Complete When

1. **Theme Extraction Working**:

   - [ ] ThemeExtractor service reads VS Code theme
   - [ ] Theme data sent to webview via EventBus
   - [ ] Webview updates on theme change (reactive)

2. **Design Tokens Defined**:

   - [ ] Token system created (colors, spacing, typography)
   - [ ] Tokens mapped to VS Code theme
   - [ ] Fallback values for all tokens

3. **Components Themed**:

   - [ ] All shared UI components use design tokens
   - [ ] No hardcoded colors in components
   - [ ] Egyptian elements are theme-aware

4. **Multi-Theme Support**:

   - [ ] Works with VS Code light themes
   - [ ] Works with VS Code dark themes
   - [ ] Works with high-contrast themes
   - [ ] No color contrast violations

5. **Tests Passing**:

   - [ ] Theme extraction tests
   - [ ] Theme switching tests
   - [ ] Component rendering across themes
   - [ ] Accessibility tests (contrast ratios)

6. **Documentation Complete**:
   - [ ] Theming guide for contributors
   - [ ] Token usage documentation
   - [ ] Egyptian theme customization guide

---

## 📝 Key Decisions

### Architecture Decisions

**Decision 1: Token System Approach**

- **Option A**: CSS custom properties only
- **Option B**: TypeScript constants only
- **Option C**: Hybrid (TS + CSS)
- **CHOSEN**: Option C (hybrid)
- **Rationale**: TypeScript for type safety, CSS for runtime theming

**Decision 2: Egyptian Theme Handling**

- **Option A**: Remove all Egyptian theming (full VS Code integration)
- **Option B**: Keep Egyptian, ignore VS Code theme
- **Option C**: Adaptive Egyptian theme (theme-aware)
- **CHOSEN**: Option C
- **Rationale**: Preserve branding, respect user's theme choice

**Decision 3: Theme Update Strategy**

- **Option A**: Refresh entire webview on theme change
- **Option B**: Update CSS variables only
- **CHOSEN**: Option B
- **Rationale**: Seamless transition, no flicker, better UX

**Decision 4: Design Token Hierarchy**

- **Option A**: Flat tokens (one level)
- **Option B**: Semantic hierarchy (primitive → semantic → component)
- **CHOSEN**: Option B
- **Rationale**: Maintainability, scalability, best practice

---

### Implementation Decisions

**Decision 5: Tailwind Integration**

- **Option A**: Replace Tailwind with design tokens
- **Option B**: Keep Tailwind, extend with tokens
- **CHOSEN**: Option B
- **Rationale**: Tailwind utility classes still valuable, tokens for colors

**Decision 6: Egyptian Theme Toggle**

- **Option A**: Always show Egyptian elements
- **Option B**: User preference (on/off)
- **CHOSEN**: Option A (always on, but theme-aware)
- **Rationale**: Unique branding, adaptive is enough flexibility

---

## 🚀 Next Steps After Context Review

1. **Research Phase**:

   - VS Code theme API documentation
   - Design token systems research
   - Other extensions' theming approaches
   - Create `research-report.md`

2. **Planning Phase**:

   - Token system design
   - Component update plan
   - Migration strategy for existing colors
   - Create `implementation-plan.md`

3. **Implementation Phase** (3 sub-phases):

   - **Phase 1**: Theme extraction backend service
   - **Phase 2**: Design token system creation
   - **Phase 3**: Component migration to tokens

4. **Validation Phase**:
   - Multi-theme testing (light, dark, high-contrast)
   - Accessibility validation (contrast ratios)
   - User testing with Egyptian theme adaptations
   - Create `completion-report.md`

---

## 📚 Related Documentation

**MONSTER Plan Context**:

- [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md) - Week 9 section
- [MONSTER_PROGRESS_TRACKER.md](../MONSTER_PROGRESS_TRACKER.md) - Week 9 section

**Previous Task Context**:

- [TASK_CORE_001](../TASK_CORE_001/) - Infrastructure (provides EventBus, WebviewManager)
- [TASK_PERF_001](../TASK_PERF_001/) - Performance dashboard (needs theming)
- [TASK_ANLYT_001](../TASK_ANLYT_001/) - Analytics dashboard (needs theming)

**Architecture References**:

- [AGENTS.md](../../AGENTS.md) - Universal agent framework
- [copilot-instructions.md](../../.github/copilot-instructions.md) - Ptah-specific patterns
- [MODERN_ANGULAR_GUIDE.md](../../docs/guides/MODERN_ANGULAR_GUIDE.md) - Angular signal patterns

**VS Code References**:

- [VS Code Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

---

**Context Status**: ✅ Ready for Research/Planning Phase  
**Blocked By**: TASK_CORE_001 (infrastructure)  
**Can Start**: After Week 7-8 tasks complete (for dashboard theming)  
**Estimated Timeline**: 5 days implementation  
**LAST TASK BEFORE INTEGRATION** 🎉

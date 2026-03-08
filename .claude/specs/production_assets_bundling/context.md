# Task Context - TASK_2025_080

## Task Title

Bundle Size Optimization Investigation for VS Code Extension & Webview

## User Intent

Investigate why the webview bundle size has been steadily increasing (now at 1.2MB, exceeding initial budget) and develop a strategy to optimize both the extension bundle and webview bundle sizes following VS Code best practices.

## Problem Statement

### Current State

- **Webview bundle**: 1.20 MB (exceeded original 1.2MB budget by 924 bytes, budget increased to 1.25MB as temporary fix)
- **VS Code extension bundle**: 1.71 MB
- Bundle size has been growing with each feature addition
- No systematic bundle analysis has been performed

### Impact

- Slower extension activation time
- Slower webview load time
- Larger VSIX package size
- Poor user experience on slower connections

## VS Code Best Practices Research

### From Official Documentation

1. **Bundling is Critical**

   - "Loading 100 small files is much slower than loading one large file"
   - Bundling combines multiple source files to improve installation and runtime performance
   - Source: [VS Code Bundling Guide](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)

2. **Webview Usage**

   - "Only use webviews when absolutely necessary"
   - Webviews come at the cost of performance and accessibility
   - Source: [VS Code Webview Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)

3. **Real-World Improvements**

   - Azure Account: Bundling reduced size from 6.2MB to 840KB (86% reduction)
   - Docker: Cold activation time reduced from 20 seconds to 2 seconds
   - Source: [VS Code Performance Best Practices](https://www.freecodecamp.org/news/optimize-vscode-performance-best-extensions/)

4. **`.vscodeignore` Optimization**
   - Exclude `node_modules/`, `out/`, `src/`, and build configs from VSIX
   - Number of files in VSIX impacts cold activation time

### Recommended Tools

- `webpack-bundle-analyzer` for visual bundle analysis
- `source-map-explorer` for identifying large dependencies
- `Developer: Show Running Extensions` command for activation time analysis

## Investigation Scope

### Phase 1: Analysis

1. **Webview Bundle Analysis**

   - Run `webpack-bundle-analyzer` or equivalent on Angular build
   - Identify largest chunks and their sources
   - Check for duplicate dependencies
   - Analyze tree-shaking effectiveness

2. **Extension Bundle Analysis**

   - Analyze webpack output for large modules
   - Identify unused code paths
   - Check dynamic imports effectiveness

3. **VSIX Package Analysis**
   - Check current `.vscodeignore` configuration
   - Identify files that shouldn't be packaged
   - Measure total package size

### Phase 2: Optimization Opportunities

1. **Code Splitting**

   - Lazy load non-critical features
   - Split by route/view in webview
   - Dynamic imports for optional functionality

2. **Dependency Audit**

   - Identify heavy dependencies (marked, prismjs, etc.)
   - Find lighter alternatives where possible
   - Consider CDN for large assets

3. **Tree Shaking Improvements**

   - Ensure ES modules are used
   - Configure sideEffects properly
   - Remove barrel file re-exports

4. **Build Configuration**
   - Optimize Angular production build settings
   - Configure webpack optimization options
   - Consider esbuild for faster builds

## Key Files to Analyze

### Webview

- `apps/ptah-extension-webview/project.json` - Build configuration
- `apps/ptah-extension-webview/src/main.ts` - Entry point
- `apps/ptah-extension-webview/src/styles.css` - Global styles

### Extension

- `apps/ptah-extension-vscode/webpack.config.js` - Webpack configuration
- `apps/ptah-extension-vscode/.vscodeignore` - Package exclusions
- `apps/ptah-extension-vscode/package.json` - Dependencies

### Potential Heavy Dependencies

- `marked` (markdown parsing)
- `prismjs` (syntax highlighting)
- `lucide-angular` (icons)
- `daisyui` / `tailwindcss` (CSS framework)
- `highlight.js` (code highlighting)
- `ngx-markdown` (markdown rendering)

## Success Criteria

1. **Analysis Complete**

   - Bundle composition documented with percentages
   - Top 10 largest modules identified
   - Duplicate dependencies found

2. **Optimization Plan**

   - Prioritized list of optimizations
   - Estimated size reduction for each
   - Implementation effort assessment

3. **Target Metrics**
   - Webview bundle: < 800KB (33% reduction from 1.2MB)
   - Extension bundle: < 1.2MB (30% reduction from 1.71MB)
   - VSIX package: Optimized for cold activation

## Related Resources

- [VS Code Extension Bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code Webview UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [Angular Bundle Optimization](https://angular.dev/best-practices/performance)
- [Webpack Bundle Analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer)

## Technical Context

- **Branch**: To be created: `feature/bundle-optimization`
- **Type**: OPTIMIZATION / PERFORMANCE
- **Complexity**: Medium
- **Priority**: Medium (technical debt)

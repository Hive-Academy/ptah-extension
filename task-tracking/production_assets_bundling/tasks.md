# Tasks - TASK_2025_080: Bundle Size Optimization

## Status: NOT STARTED

## Task Breakdown

### Phase 1: Analysis (Priority: HIGH)

- [ ] **1.1 Install Analysis Tools**

  - Install `webpack-bundle-analyzer` for webview
  - Install `source-map-explorer` for detailed analysis
  - Configure npm scripts for analysis

- [ ] **1.2 Analyze Webview Bundle**

  - Run production build with stats output
  - Generate bundle analysis report
  - Document largest chunks (target: top 10 modules with sizes)
  - Check for duplicate dependencies
  - Identify unused imports

- [ ] **1.3 Analyze Extension Bundle**

  - Run webpack bundle analyzer on extension
  - Document largest modules
  - Check dynamic import effectiveness
  - Identify dead code

- [ ] **1.4 Analyze VSIX Package**

  - Check `.vscodeignore` configuration
  - List all files in VSIX
  - Identify unnecessary files
  - Measure total package size

- [ ] **1.5 Document Current State**
  - Create `bundle-analysis-report.md`
  - Include screenshots of bundle visualizations
  - List all dependencies with sizes

### Phase 2: Identify Optimizations (Priority: HIGH)

- [ ] **2.1 Dependency Audit**

  - Review each large dependency
  - Find lighter alternatives (e.g., `marked` vs lighter markdown parser)
  - Check if full library is needed vs specific functions
  - Document findings

- [ ] **2.2 Code Splitting Analysis**

  - Identify lazy-loadable features
  - Map routes to potential code split points
  - Identify runtime-only vs. startup requirements

- [ ] **2.3 Tree Shaking Review**

  - Check `sideEffects` in package.json files
  - Review barrel exports (index.ts files)
  - Identify modules that aren't tree-shakeable

- [ ] **2.4 Build Configuration Review**
  - Review Angular optimization settings
  - Check webpack configuration
  - Review esbuild settings for backend

### Phase 3: Create Optimization Plan (Priority: MEDIUM)

- [ ] **3.1 Prioritize Optimizations**

  - Rank by size reduction potential
  - Rank by implementation effort
  - Rank by risk

- [ ] **3.2 Create Implementation Plan**

  - Document each optimization with:
    - Expected size reduction
    - Implementation steps
    - Risks and mitigations
  - Create `optimization-plan.md`

- [ ] **3.3 Set Target Budgets**
  - Define new budget targets
  - Create monitoring strategy
  - Add CI checks for budget enforcement

### Phase 4: Implementation (Priority: MEDIUM)

- [ ] **4.1 Quick Wins**

  - Update `.vscodeignore`
  - Remove unused dependencies
  - Fix barrel export issues

- [ ] **4.2 Code Splitting**

  - Implement lazy loading for views
  - Dynamic imports for heavy modules

- [ ] **4.3 Dependency Optimization**

  - Replace heavy libraries
  - Configure tree shaking
  - Optimize imports

- [ ] **4.4 Build Optimization**
  - Tune webpack/esbuild settings
  - Optimize production build flags

### Phase 5: Verification (Priority: HIGH)

- [ ] **5.1 Measure Results**

  - Re-run bundle analysis
  - Compare before/after sizes
  - Test activation time

- [ ] **5.2 Update Budgets**

  - Set new realistic budgets in project.json
  - Add CI enforcement

- [ ] **5.3 Document Results**
  - Create `optimization-results.md`
  - Update CLAUDE.md with size best practices

## Current Bundle Sizes (Baseline)

| Component       | Current Size | Target Size | Notes             |
| --------------- | ------------ | ----------- | ----------------- |
| Webview Initial | 1.20 MB      | < 800 KB    | Angular SPA       |
| Extension Main  | 1.71 MB      | < 1.2 MB    | Node.js bundle    |
| VSIX Package    | TBD          | TBD         | Needs measurement |

## Suspected Heavy Dependencies

| Dependency           | Used In  | Suspected Size | Alternative            |
| -------------------- | -------- | -------------- | ---------------------- |
| marked               | chat     | ~50KB          | marked-gfm-only        |
| prismjs (all langs)  | chat     | ~100KB         | Only load used langs   |
| highlight.js         | chat     | ~200KB+        | Prism (smaller)        |
| ngx-markdown         | chat     | ~50KB          | Custom component       |
| lucide-angular (all) | multiple | ~100KB         | Only import used icons |
| daisyui              | styles   | ~50KB          | Purge unused           |

## Notes

- The 924 byte increase that triggered this investigation was minor, but cumulative increases are concerning
- Consider implementing bundle size CI checks to prevent future regressions
- VS Code recommends < 5MB total VSIX size for good activation performance

# Branch Coverage Gate CI Fix Report — PR #535

**Target Project**: `@ptah-extension/chat-ui`  
**Date**: September 19, 2026  
**Status**: RESOLVED (All coverage gates PASS, all 210 tests PASS, 0 typecheck errors, 0 lint errors)

---

## 1. Executive Summary

CI job "main" on PR #535 was failing at the branch coverage gate:

```
Jest: Coverage for branches (39.92%) does not meet "global" threshold (50%)
```

This occurred because `compact-session-activity.component.spec.ts` had been introduced with only a single test pinning the $0.0000 zero-cost agent badge bugfix, which pulled `compact-session-activity.component.ts` (228 total branches) into coverage measurement for the first time. With 199 of those 228 branches uncovered, the total branch coverage dropped from 55.43% (423/763) down to 39.92% (452/1132).

By adding real, behavior-driven unit tests across all branch decision points of `CompactSessionActivityComponent`:

- `compact-session-activity.component.ts` branch coverage increased from **12.71% (29/228)** to **86.84% (198/228)** (+169 branches covered).
- `@ptah-extension/chat-ui` overall branch coverage increased from **39.92% (452/1132)** to **56.27% (637/1132)** (+185 branches covered), clearing the 50% global threshold with an 6.27% buffer.
- Statements: **70.80%** (1368/1932, threshold 50%).
- Functions: **68.52%** (233/340, threshold 40%).
- Lines: **71.86%** (1244/1731, threshold 50%).
- All **210 tests pass across 27 suites** (0 failures).

---

## 2. Root Cause Analysis

| State                          | Covered Branches | Total Branches | Branch Coverage % | Gate Status      |
| ------------------------------ | ---------------- | -------------- | ----------------- | ---------------- |
| Before PR #535 (main)          | 423              | 763            | 55.43%            | PASS             |
| PR #535 Baseline (1 test)      | 452              | 1132           | 39.92%            | FAIL (<50%)      |
| After Fix (Comprehensive spec) | 637              | 1132           | 56.27%            | **PASS** (>=50%) |

The denominator grew by +369 because Jest collects coverage only from files executed by tests. Adding `compact-session-activity.component.spec.ts` pulled `compact-session-activity.component.ts` and its dependency tree into coverage for the first time.

The file held 199 uncovered branches across:

1. Agent entry status variants (`running`, `error`, `complete`), description rendering, tool count singular vs plural, and stats badges (tokens, duration, cost).
2. Cost badge rendering: distinction between `0` (renders `$0.0000`), positive numbers (renders formatted value), and `null`/`undefined` (no badge).
3. Tool grouping and collapse logic: threshold (6 tools) vs preview (5 tools), expand/collapse toggles, singular/plural "more tools", and error counts.
4. Tool row derivation: LCS line-level diff calculation for `Edit`, line counts for `Write`, command truncation for `Bash`, search patterns for `Grep`/`Glob`, URLs for `WebFetch`, queries for `WebSearch`, fallback path normalization (Windows backslashes vs POSIX slashes vs trailing slashes).
5. Live streaming events parsing: `text_delta`, `thinking_start`/`thinking_delta`, `tool_start` with JSON accumulation / error recovery, `agent_start` with content blocks vs summary accumulators, and pulse indicators.
6. User interactions: copy-to-clipboard visual feedback, permission response emission, and clarifying question answer emission.

---

## 3. Constraints Compliance

1. **Thresholds unchanged**: `libs/frontend/chat-ui/jest.config.ts` was not modified (thresholds remain statements: 50, branches: 50, functions: 40, lines: 50).
2. **No exclusions**: No `coveragePathIgnorePatterns`, `istanbul ignore` comments, or file exclusions were introduced.
3. **Zero-cost test preserved**: The existing test `renders a cost badge for a genuinely zero-cost agent entry` remains verbatim and passes.
4. **No production code changes**: `compact-session-activity.component.ts` and other production files were not modified.
5. **Real behavioral assertions**: All 23 new tests verify component inputs, outputs, signals, and DOM interactions.

---

## 4. Verification Output

### Test & Coverage Gate

```
> npx nx run-many -t test -p @ptah-extension/chat-ui --coverage --skip-nx-cache

 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/streaming-text-reveal.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/copy-button.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/tool-icon.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/status-badge.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/error-alert.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/typing-cursor.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/token-badge.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/utils/agent-color.utils.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/duration-badge.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/atoms/expandable-content.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.spec.ts
 PASS   chat-ui  libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts (5.781 s)

Test Suites: 27 passed, 27 total
Tests:       210 passed, 210 total
Snapshots:   0 total
Time:        9.743 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/chat-ui
```

### Coverage Numbers

From `coverage/libs/frontend/chat-ui/index.html`:

- **Statements**: 1368 / 1932 (70.80%) — required >= 50%
- **Branches**: 637 / 1132 (56.27%) — required >= 50%
- **Functions**: 233 / 340 (68.52%) — required >= 40%
- **Lines**: 1244 / 1731 (71.86%) — required >= 50%

For `compact-session-activity.component.ts`:

- **Statements**: 259 / 270 (95.92%)
- **Branches**: 198 / 228 (86.84%)
- **Functions**: 30 / 30 (100%)
- **Lines**: 235 / 241 (97.51%)

### Typecheck

```
> npx nx run-many -t typecheck -p @ptah-extension/chat-ui

 NX   Running target typecheck for project @ptah-extension/chat-ui:

- @ptah-extension/chat-ui

> nx run @ptah-extension/chat-ui:typecheck

> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json

 NX   Successfully ran target typecheck for project @ptah-extension/chat-ui
```

### Lint

```
> npx nx run-many -t lint -p @ptah-extension/chat-ui

 NX   Running target lint for project @ptah-extension/chat-ui:

- @ptah-extension/chat-ui

> nx run @ptah-extension/chat-ui:lint

Linting "@ptah-extension/chat-ui"...

✖ 6 problems (0 errors, 6 warnings)

 NX   Successfully ran target lint for project @ptah-extension/chat-ui
```

(0 errors reported)

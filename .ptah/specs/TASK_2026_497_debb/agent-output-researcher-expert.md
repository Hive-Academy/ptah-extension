# Agent Output - Researcher Expert: TASK_2026_497_debb

See the complete primary deliverable at:
[containment-comparison.md](.ptah/specs/TASK_2026_497_debb/containment-comparison.md)

## Summary of Completed Preparation

1. **Comparison Matrix**:
   - Contrast between Custom-Protocol `iframe` (`ptah-mcp://<server>.<app>.<version>/`) and `WebContentsView` with ephemeral partition and no preload across all 10 critical dimensions (origin distinctness, cross-app isolation, storage and cookie partitioning, CSP enforceability by host, app metadata relaxation immunity, navigation/window-open control, permission handler reach, DevTools/debuggability, host-mediated postMessage bridge cost, lifecycle/teardown cost).
   - Every cell is backed by verified code/documentation citations or explicitly marked as `[MEASURE IN SPIKE]`.

2. **Attack Fixture Corpus (17 Files)**:
   - Located at [.ptah/specs/TASK_2026_497_debb/fixtures/](.ptah/specs/TASK_2026_497_debb/fixtures/).
   - Covers: top-level navigation, window.open, form target navigation, parent/opener traversal, cross-origin storage access, network exfiltration, metadata CSP injection, wildcard origin injection, permission requests, and resource exhaustion / postMessage flooding.
   - Includes dedicated assertion fixtures for all 7 Electron isolation controls.

3. **Electron Isolation Settings**:
   - Explicit settings and assertions specified for: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `will-navigate` block, `setWindowOpenHandler` denial, and session permission denial.

4. **Blocker & Next Steps**:
   - Fully documented dependency on `TASK_2026_491_e0da` (origin-aware session permission handlers and shell CSP).
   - Detailed execution guide for the subsequent agent once 491 lands.

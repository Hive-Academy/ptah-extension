Verdict: APPROVED

# Cross-Side Design Review: Pattern Map for Advanced and Search & Voice Tabs

**Document Under Review:** `.ptah/specs/TASK_2026_555/pattern-map-advanced-search-voice.md`  
**Reviewer:** `ui-ux-designer` (cross-side peer review)  
**Date:** 2026-09-30  
**Context:** Monorepo `task-555-settings-redesign`, user decisions of 2026-09-30 (no new prototypes; strict reuse of `prototypes/final/` patterns and `design-spec.md`; deviations: centered `NativeModalComponent`, per-tab actions, collapsed `<details>`, chevron reorder, color only on icons/dots/badges; D15 save model).

---

## Executive Summary

The pattern map under review is an exceptionally thorough, high-fidelity mapping of every control across the **Advanced** (`pro-features`) and **Search & Voice** (`tools`) settings tabs into the approved design vocabulary of `prototypes/final/` (`index.html`, `orchestration.html`, `assets/app.css`) and `design-spec.md`.

All 37 controls on Advanced (A1–A37) and all 29 controls on Search & Voice (V1–V29) are fully mapped. All 12 proposed implementation batches (39–50) strictly comply with the rule of $\le 6$ files and $\le 2$ libs per batch. The two proposed removals (PR-1 and PR-2) are verified with hard code evidence. The save model strictly honors D15.

The findings below identify minor-to-moderate improvements regarding batch dependency sequencing, component line boundaries, and the definitive resolution of Gap G9. None of the findings are blocking. The document is **APPROVED**.

---

## Verification of Checklist Items

### 1. Completeness Audit
Every control mounted in the current tab hierarchy was audited against the codebase under `libs/frontend/chat/src/lib/settings/`:
- **Advanced Tab (`settings.component.html:156-212`)**:
  - `ptah-license-status-card` (`license/license-status-card.component.ts`): Covered in A1–A7.
  - Data Portability (`settings.component.html:160-204`, `settings.component.ts:227-261`): Covered in A8–A9.
  - `ptah-enhanced-prompts-config` (`pro-features/enhanced-prompts-config.component.ts`): Covered in A10–A18.
  - `ptah-output-style-config` (`output-style/output-style-config.component.ts`, `output-style-list.component.ts`, `output-style-editor.component.ts`): Covered in A19–A25.
  - `ptah-workflows-config` (`pro-features/workflows-config.component.ts`): Covered in A26–A29.
  - `ptah-mcp-port-config` (`pro-features/mcp-port-config.component.ts`): Covered in A30–A31.
  - `ptah-browser-settings` (`pro-features/browser-settings.component.ts`): Covered in A32.
  - `ptah-vscode-lm-config` (`pro-features/vscode-lm-config.component.ts`): Covered in A33–A37.
- **Search & Voice Tab (`settings.component.html:217-226`)**:
  - `ptah-web-search-config` (`ptah-ai/web-search-config.component.ts`): Covered in V1–V8.
  - `ptah-voice-config` (`ptah-ai/voice-config.component.ts`): Covered in V9–V12.
  - `ptah-local-stt-panel` (`ptah-ai/local-stt-panel.component.ts`): Covered in V13–V16, V20.
  - `ptah-local-tts-panel` (`ptah-ai/local-tts-panel.component.ts`): Covered in V15, V17–V20.
  - `ptah-elevenlabs-panel` (`ptah-ai/elevenlabs-panel.component.ts`): Covered in V21–V25.
  - `ptah-go-vet-consent-config` (`ptah-ai/go-vet-consent-config.component.ts`): Covered in V26–V29.

No controls were missed. (See Finding 3 for inclusion of repair and form validation alert banners in the editor line range).

### 2. Approved Pattern Alignment & Visual Language
Every assigned pattern (P1–P12) corresponds to an element in `prototypes/final/` or a section of `design-spec.md`:
- **P1 Shell**: `index.html:82-115`, `.tabs.tabs-bordered` (§1.1).
- **P2 Section Card**: `orchestration.html:153-156`, `ptah-native-card density="compact" tone="neutral"` (§3.1, §3.5).
- **P3 Policy Bar**: `orchestration.html:107-113` (`routing-flow-card py-2 px-3`) (§1.2).
- **P4 Matrix Table**: `orchestration.html:170-195` (`.matrix-table`, `checkbox-xs checkbox-primary`) (§3.5).
- **P5 Popover**: `index.html:829-880` (`#popoverMainAgent`, `.popover-effort-btn`) (§3.2, §4.1).
- **P6 Side Drawer**: `index.html:426-520` (`#drawerConnDetails`) (§3.4).
- **P7 Centered Modal**: `index.html` (`#modalPalette`, `#modalAddPtahCli`) (§2.5, §3.6).
- **P8 Inline Destructive Confirm**: `credentials-tab.component.ts:234-249` (`role="group"`) (§4.1).
- **P9 Collapsed `<details>`**: `orchestration.html:482` (`details#rolesDetails.card`) (§6 #4).
- **P10 Status Badge**: `orchestration.html:197`, `badge badge-outline badge-sm` with color dot only (§3.5, §6 #6).
- **P11 Toast with Undo**: `#toastContainer`, `SettingsToastComponent` (§4.2, §4.4).
- **P12 Credential Popover**: Cursor Credentials popover precedent (§2.2).

No new visual language is invented. All gaps are explicitly declared with proposed mappings.

### 3. Write-Path Verification
Seven write paths were spot-checked directly against the active implementation:
1. **A4 (Log Out)**: `license-status-card.component.ts:400` calls `this.rpcService.call('license:clearKey', {})`. **Accurate**.
2. **A5 (Enter Membership Key)**: `license-status-card.component.ts:364` calls `this.rpcService.call('license:setKey', { licenseKey: key })`. **Accurate**.
3. **A8 & A9 (Export / Import Settings)**: `settings.component.ts:232,234` calls `settings:export` (Electron) / `command:execute ptah.exportSettings` (VS Code), and `:252,254` calls `settings:import` / `command:execute ptah.importSettings`. **Accurate**.
4. **A10 (Enhanced Prompts Enable)**: `enhanced-prompts-config.component.ts:280` calls `this.rpcService.call('enhancedPrompts:setEnabled', { workspacePath: '.', enabled })`. **Accurate**.
5. **A27 (Dynamic Workflows)**: `workflows-config.component.ts:239` calls `agent:setConfig` with `{ workflowsDisabled }`, handled in `agent-rpc.handlers.ts:395` writing to `workspace.setConfiguration('ptah', 'workflows.disabled')`. **Accurate**.
6. **A30 (MCP Server Port)**: `mcp-port-config.component.ts:244` calls `agent:setConfig` with `{ mcpPort }`, clamped 1024–65535, handled in `agent-rpc.handlers.ts:373`. **Accurate**.
7. **V27 (go vet Consent)**: `go-vet-consent-config.component.ts:471` calls `diagnostics:go-vet-consent-set` with `{ enabled, workspaceRoot, confirmToken, source: 'settings-ui' }`. **Accurate**.

### 4. Proposed Removals Verification
1. **PR-1 (`systemPromptPreset` radios, `enhanced-prompts-config.component.ts:78-112`)**:
   - Workspace-wide search for `systemPromptPreset` reveals occurrences *only* in `enhanced-prompts-config.component.ts` (lines 89, 100, 221, 291).
   - It updates a local signal (`this.systemPromptPreset.set(preset)`) that is never passed to `enhancedPrompts:setEnabled`, `enhancedPrompts:regenerate`, or any backend RPC.
   - It is 100% dead state presented as a persistent choice. **Removal is fully justified**.
2. **PR-2 ("Workflows require a paid plan." copy, `workflows-config.component.ts:130-135`)**:
   - `chat-session.service.ts:1364-1372` resolves `resolveWorkflowsDisabled()` by reading only `this.workspaceProvider.getConfiguration<boolean>('ptah', 'workflows.disabled', false)`.
   - Workspace search confirms there is zero licensing or plan gating on workflows anywhere in `libs/backend/agent-sdk`, `libs/backend/rpc-handlers`, or `libs/shared`.
   - The sentence contradicts the Membership card copy stating that local features are free. **Removal is fully justified**.

### 5. Gaps Analysis
The gap proposals are sound:
- **G1 (Checkbox-in-`table-xs` for on/off)**: Sound. Replaces bulky toggles with the dense matrix pattern from `orchestration.html:187` while retaining `input[type=checkbox]`.
- **G2 (Generic save entry in `SettingsSaveFeedbackService`)**: Sound and necessary. `SettingsSaveFeedbackService.save()` currently couples exclusively to `ProvidersSettingsStateService.commit()`. Providing a generic Promise-based entrypoint allows toast + Undo feedback across both tabs.
- **G9 (Reasoning effort overlap)**: Fully traced and resolved below.

### 6. Batch Split Review (Batches 39–50)
- **File limits**: All batches touch $\le 6$ files (Batch 39: 6, Batch 40: 3, Batch 41: 5, Batch 42: 5, Batch 43: 5, Batch 44: 6, Batch 45: 4, Batch 46: 5, Batch 47: 4, Batch 48: 4, Batch 49: 4–6, Batch 50: 1).
- **Lib limits**: All batches touch $\le 2$ libs (primarily `chat`, plus `webview-e2e-harness` in Batch 49; `apps/ptah-electron-e2e` is an app).
- **Capability reachability (D14)**: Deletions of components occur in the exact same batch where their replacements are mounted.
- **Dependency ordering**: Batch 49 needs an adjustment (see Finding 1).

### 7. Rule Tagging Verification
- `[UR]` correctly tags user-mandated deviations (per-tab actions, collapsed `<details>`, centered modal, color-only dot badges, D15 save model).
- `[PR]` correctly tags repository and spec rules (one primary per region, `data-testid` preservation, markdown sanitization chokepoints).
- `[LP]` accurately isolates every lane-proposed choice in Section 9.

---

## Numbered Findings

### Finding 1: Batch 49 Dependency Missing Batch 43
- **Severity**: Moderate
- **Location**: `pattern-map-advanced-search-voice.md:352` (Section 8, Batch 49 table row)
- **Problem**: Batch 49 ("Harness: reachability + scenes for both tabs") lists `Depends on: 44, 48`. However, Batch 43 migrates the Output Style feature (`output-style-config`, `output-style-list`, `output-style-editor`), and Batch 49 explicitly tests Output Style selectors and D15 fixtures ("fixtures for STT/TTS/web-search/output-style/effort failures"). If Batch 49 runs before Batch 43 completes, the Output Style reachability assertions will fail against obsolete DOM nodes. Furthermore, Batches 40, 41, 42, and 44 all modify `advanced-settings.component.ts`. Batch 44 is listed as depending on 39, which risks conflicting edits with Batch 42.
- **Fix**: Update Batch 49's dependency declaration to `Depends on: 43, 44, 48`. In addition, update Batch 44 to `Depends on: 42` so modifications to `advanced-settings.component.ts` remain strictly serialized.

### Finding 2: Resolution of Gap G9 (Reasoning Effort Overlap)
- **Severity**: Moderate
- **Location**: `pattern-map-advanced-search-voice.md:104` (A26) and `pattern-map-advanced-search-voice.md:298` (Section 5, Gap G9)
- **Problem**: Gap G9 was left open as "needs user decision" because the author did not verify whether Advanced reasoning effort and Providers main-agent effort resolve to the same underlying setting. Leaving this unresolved creates ambiguity for implementation Batch 41.
- **Code Trace & Resolution**: See detailed trace in the dedicated section below. Both write to the exact same setting.
- **Fix**: Resolve G9 in the pattern map by stating: "G9 Resolved: Advanced reasoning effort and Providers Main Agent effort both write to `config:effort-set` and store to `ReasoningSettings.effort`. Retain the control in Advanced as a popover cell labeled 'Chat reasoning effort' (or 'Default reasoning effort') with a sub-note linking to Providers."

### Finding 3: Output Style Editor Line Range and Banner Completeness
- **Severity**: Minor
- **Location**: `pattern-map-advanced-search-voice.md:103` (Section 2.1, A25)
- **Problem**: In A25, the file:line reference is given as `output-style-editor.component.ts:157-381`. While the notes mention overwrite conflicts (`:130-155`), the editor template also contains two critical alert banners between lines 94 and 128:
  1. The unparseable file repair warning (`@if (repair(); as broken)`, lines 94-112).
  2. The form validation error alert (`@if (formError(); as message)`, lines 114-128).
- **Fix**: Expand the cited range in A25 to `output-style-editor.component.ts:94-381` and explicitly note that both the repair banner and the form validation error banner move into drawer D-OS using the P2 inline alert pattern (`base-content` text).

### Finding 4: Key Editor Discard Behavior on Popover Dismiss
- **Severity**: Minor
- **Location**: `pattern-map-advanced-search-voice.md:181` (Section 3.1, V4)
- **Problem**: `web-search-config.component.ts:175-180` has an explicit Cancel button (`closeKeyEditor()`). When moving key entry into a P12 popover, closing via backdrop click or Escape must clear any unsaved `apiKeyInput()` draft state so reopening does not leak a stale, unverified string.
- **Fix**: Explicitly note in V4 that the P12 popover dismissal hook resets `apiKeyInput` to empty.

### Finding 5: Safe-Listing `aria-label` for Enhanced Prompts Toggle
- **Severity**: Minor
- **Location**: `pattern-map-advanced-search-voice.md:88` (Section 2.1, A10) and `pattern-map-advanced-search-voice.md:282` (Section 4)
- **Problem**: `enhanced-prompts-config.component.ts:53` defines `aria-label="Toggle Enhanced System Prompt"`. When moving this toggle to the matrix table (G1), the checkbox element must retain this exact `aria-label` to ensure e2e test compatibility.
- **Fix**: Add `aria-label="Toggle Enhanced System Prompt"` to the Section 4 selector safe-list alongside the data-testids.

---

## Detailed Answer for Gap G9: Reasoning Effort Overlap

### 1. Write-Path Trace
- **Advanced Tab Control (A26)**:
  `workflows-config.component.ts:89` calls `EffortStateService.setEffort(choice.value)` (`libs/frontend/core/src/lib/services/effort-state.service.ts:36-60`).
  Inside `EffortStateService`:
  ```ts
  const result = await this.rpc.call('config:effort-set', {
    effort: normalized,
    sessionId: this.activeSessionId(),
  });
  ```
- **Providers Tab Control (Main Agent Popover)**:
  The Providers drawer / popover commits via `ProvidersCommitService.operations` (`libs/frontend/core/src/lib/services/providers-commit.service.ts:96-108`):
  ```ts
  if (patch.effort) {
    const params = { ...patch.effort };
    operations.push({
      fields: ['Main agent reasoning effort'],
      write: async () => {
        await this.require('config:effort-set', params);
        return true;
      },
      readBack: async () =>
        (await this.require('config:effort-get', {})).effort === params.effort,
    });
  }
  ```

### 2. Backend Storage
Both frontends invoke the **exact same RPC handler** in `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:663-698`:
```ts
private registerEffortSet(): void {
  this.rpcHandler.registerMethod<ConfigEffortSetParams, ConfigEffortSetResult>(
    'config:effort-set',
    async (params) => {
      const effort = parseEffortLevel(params.effort);
      const sessionId = params.sessionId;
      const applyTo = parseApplyTo(params.applyTo, 'app');

      await this.reasoningSettings.effort.set(effort || '', applyTo);
      // optionally syncs active session if sessionId is provided
      return { effort };
    }
  );
}
```
`this.reasoningSettings.effort` is a persistent setting handle in `settings-core`.

### 3. Runtime Readers
The value saved by either control is read at runtime by:
1. `ConfigRpcHandlers.registerEffortGet` (`config-rpc.handlers.ts:635-658`): Reads `this.reasoningSettings.effort.get()`.
2. `AgentSpawnEnvironment` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:105-125`): Directly injects `ReasoningSettings` and reads `this.reasoningSettings.effort.get()` to set the spawn environment for CLI agents.
3. `ChatSessionService`: Synchronizes reasoning effort into live Claude SDK queries.

### Conclusion on G9
**They are 100% the same setting backed by the exact same storage.**
- **Recommendation**:
  Do not duplicate separate configuration mechanisms. In the Advanced tab "Agent behaviour" card, retain the popover cell pattern (P5) matching the Main Agent popover style, but label it **"Chat reasoning effort"** with a subtext: *"Configures the default reasoning effort for the main agent."* Any change made here immediately reflects in the Providers tab and vice versa because both read and write through `config:effort-get` / `config:effort-set`.

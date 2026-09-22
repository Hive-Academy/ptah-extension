# CI Degradation Audit Fix Report — PR #575

## Sites fixed

### 1. `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:2016` (`promise-catch-sentinel`)
- **What it now does**: Replaces `.catch(() => undefined)` with an explicit rejection handler that inspects the error type (`error instanceof Error ? error.constructor.name : typeof error`) and logs a structured error via `console.error('[ProviderSetupWizardComponent] Cancel draft verification failed:', errorType)`.
- **Why this is correct**: Draft probe cancellation is triggered during input or setting invalidation. Swallowing the rejection with a literal `undefined` hid unexpected RPC failures or client-side abort errors from runtime diagnostics while tripping the AST sentinel rule. Logging the error type rather than error message or raw error prevents leaking credentials or draft secret payloads.

### 2. `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:2074` (`promise-catch-sentinel`)
- **What it now does**: Replaces `.catch(() => undefined)` on `this.cancelDraftVerification()({ probeId })` with a structured rejection handler that logs `console.error('[ProviderSetupWizardComponent] Cancel probe failed:', errorType)`.
- **Why this is correct**: When the user explicitly cancels a draft probe in the setup wizard, failures in dispatching the abort call are now surfaced in client telemetry and console diagnostics instead of silently dropped. No sensitive draft tokens or request bodies are logged.

### 3. `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:372` (`promise-catch-sentinel`)
- **What it now does**: In `ngOnDestroy()`, replaces `.catch(() => undefined)` with a handler logging `console.error('[ProvidersSettingsComponent] Cancel verification on destroy failed:', errorType)`.
- **Why this is correct**: Component teardown during an open wizard must attempt cancellation cleanly. Logging teardown cancellation failures ensures RPC timeouts or connection teardown issues are observable rather than silently discarded with a literal `undefined`.

### 4. `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:456` (`promise-catch-sentinel`)
- **What it now does**: In `closeWizard()`, replaces `.catch(() => undefined)` on `cancelVerification()` with a handler logging `console.error('[ProvidersSettingsComponent] Cancel verification on wizard close failed:', errorType)`.
- **Why this is correct**: Wizard closure aborts in-flight verification. Logging the rejection error type preserves diagnostic observability while avoiding credential leaks and eliminating the AST literal-sentinel pattern.

### 5. `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:1124` (`catch-return-sentinel`)
- **What it now does**: Updated `abortProbe(probeId: string): Promise<void>` to return `Promise<void>` instead of `Promise<boolean>`, removed the boolean literal returns (`return true;` / `return false;`), and added a `console.warn('[ProvidersSettingsStateService] Draft verification abort failed:', error)` inside the `catch` block.
- **Why this is correct**: As analyzed by the reviewer, `verifyDraft` calls `void this.abortProbe(previous)`. The returned boolean sentinel was never read. Removing the return statement and recording the caught failure satisfies `catch-return-sentinel` (which rejects returning a literal from a `catch` block with no `throw` and no `.error()` call). Because `this.require()` throws a fixed string (`'Settings request failed'`), no secret or credential payload can leak into logs.

---

## Review comments

### 1. `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:163` (Major, functional correctness)
- **Reviewer finding**: `activeId()` was used for `[positiveProbeEvidence]="activeId() === connection.id"`. This caused all non-active connections to receive `false`, forcing `ProviderConnectionCardComponent.resolvedState` to `'not-checked'` even for connected or reachable providers, preventing non-active connected providers from rendering the "Activate for main agent" button.
- **Action taken**: Bound `[positiveProbeEvidence]="hasProbeEvidence(connection.id)"` and implemented helper `hasProbeEvidence(id: string): boolean`:
  ```typescript
  /** Per-provider probe verdict from the effective route. */
  protected hasProbeEvidence(id: string): boolean {
    const route = this.state.route();
    if (route.status !== 'ready') return false;
    const status = route.data?.providers.find((provider) => provider.id === id)?.status;
    return status === 'connected' || status === 'reachable';
  }
  ```
- **Rationale**: Reads probe status directly from the ready route data so non-active reachable/connected providers receive positive probe evidence and can emit `activateMainRequested`.

### 2. `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:501` (Minor, functional correctness)
- **Reviewer finding**: When mounting with a background focus target before section rows load, the deep link effect recorded `appliedDeepLinkId` immediately even when `toggleEdit` returned early due to `!row.loaded`. When rows later loaded, `deepLinkId !== this.appliedDeepLinkId` prevented re-attempting the edit.
- **Action taken**: Added row loading guard before committing `appliedDeepLinkId`:
  ```typescript
  effect(() => {
    const deepLinkId = this.initialEditingConsumerId();
    if (deepLinkId && deepLinkId !== this.appliedDeepLinkId) {
      if (!this.rows().find((row) => row.id === deepLinkId)?.loaded) return;
      this.appliedDeepLinkId = deepLinkId;
      this.toggleEdit(deepLinkId);
    }
  });
  ```
- **Rationale**: If the matching row is not yet loaded, the effect returns without setting `appliedDeepLinkId`. When `rows()` signal updates upon completion of the backend read, the effect re-triggers and successfully opens the editor.

### 3. `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1352` (Major, functional correctness)
- **Reviewer finding**: In `readSettings()`, `Number(get('skillSynthesis.enhanceTimeoutMs', ...))` coerced zero-coercible values (e.g. `''`, `null`) to `0`, which `Number.isFinite(0)` accepted and clamped to `ENHANCE_TIMEOUT_MIN_MS` (`15000`) instead of `ENHANCE_TIMEOUT_DEFAULT_MS` (`120000`).
- **Action taken**: Updated timeout resolution in `readSettings()` to strictly check `typeof raw === 'number' && Number.isFinite(raw)`:
  ```typescript
  enhanceTimeoutMs: (() => {
    const fallback =
      SETTINGS_DEFAULTS.enhanceTimeoutMs ?? ENHANCE_TIMEOUT_DEFAULT_MS;
    const raw = get<unknown>('skillSynthesis.enhanceTimeoutMs', fallback);
    return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(
          Math.max(raw, ENHANCE_TIMEOUT_MIN_MS),
          ENHANCE_TIMEOUT_MAX_MS,
        )
      : fallback;
  })(),
  ```
- **Reviewer suggestion on `SkillEnhancerService`**: CodeRabbit suggested also altering `SkillEnhancerService` and removing its workspace configuration call. We **disagree** with modifying `SkillEnhancerService` at this time because:
  1. `SkillEnhancerService` and `skill-enhancer.service.spec.ts` are outside our lane's assigned ownership ("Your files are the five above plus provider-consumer-assignments.component.ts and skill-synthesis.service.ts").
  2. `skill-enhancer.service.spec.ts` explicitly contains contract assertions (`it('reads skillSynthesis.enhanceTimeoutMs from workspace without defaultValue')`) testing that `SkillEnhancerService` queries workspace configuration directly. Modifying `SkillEnhancerService` would break existing test suites in another lane.

---

## Baseline

Command run:
```bash
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts
```

Output:
```
degradation-audit: per-directory totals
  apps/ptah-cli: 29 ok (baseline 29)
  apps/ptah-electron: 4 ok (baseline 4)
  apps/ptah-extension-vscode: 8 ok (baseline 9)
  apps/ptah-tui: 1 ok (baseline 1)
  libs/api/admin: 1 ok (baseline 1)
  libs/api/community: 5 ok (baseline 5)
  libs/api/identity: 1 ok (baseline 1)
  libs/api/licensing: 2 ok (baseline 2)
  libs/api/marketing: 2 ok (baseline 2)
  libs/api/member-hub: 3 ok (baseline 3)
  libs/api/membership: 1 ok (baseline 1)
  libs/api/youtube: 2 ok (baseline 2)
  libs/backend/agent-generation: 1 ok (baseline 1)
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/auth-providers: 24 ok (baseline 24)
  libs/backend/cli-engine: 12 ok (baseline 12)
  libs/backend/cron-scheduler: 2 ok (baseline 2)
  libs/backend/gateway-chat-bridge: 4 ok (baseline 4)
  libs/backend/harness-sync: 6 ok (baseline 6)
  libs/backend/memory-curator: 20 ok (baseline 20)
  libs/backend/messaging-gateway: 6 ok (baseline 6)
  libs/backend/output-styles: 8 ok (baseline 8)
  libs/backend/persistence-sqlite: 5 ok (baseline 5)
  libs/backend/platform-cli: 3 ok (baseline 3)
  libs/backend/platform-core: 7 ok (baseline 7)
  libs/backend/platform-electron: 4 ok (baseline 4)
  libs/backend/platform-vscode: 1 ok (baseline 1)
  libs/backend/plugin-marketplace: 2 ok (baseline 2)
  libs/backend/rpc-handlers: 1 ok (baseline 1)
  libs/backend/settings-core: 5 ok (baseline 5)
  libs/backend/skill-synthesis: 6 ok (baseline 6)
  libs/backend/task-specs: 11 ok (baseline 12)
  libs/backend/voice-providers: 3 ok (baseline 3)
  libs/backend/vscode-lm-tools: 2 ok (baseline 2)
  libs/backend/workspace-intelligence: 1 ok (baseline 1)
  libs/frontend/chat: 8 ok (baseline 11)
  libs/frontend/chat-state: 2 ok (baseline 2)
  libs/frontend/chat-streaming: 2 ok (baseline 2)
  libs/frontend/chat-ui: 14 ok (baseline 14)
  libs/frontend/cron-scheduler-ui: 6 ok (baseline 6)
  libs/frontend/harness-builder: 3 ok (baseline 3)
  libs/frontend/marketplace: 32 ok (baseline 32)
  libs/frontend/memory-curator-ui: 15 ok (baseline 15)
  libs/frontend/setup-wizard: 1 ok (baseline 1)
  libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
  libs/frontend/tasks-ui: 3 ok (baseline 3)
  libs/frontend/tribunal-panel: 1 ok (baseline 1)
  libs/frontend/ui: 1 ok (baseline 1)
  libs/frontend/workspace-indexing: 1 ok (baseline 1)
  libs/shared/src: 3 ok (baseline 3)
  libs/web/admin: 1 ok (baseline 1)
  libs/web/auth: 1 ok (baseline 1)
  libs/web/core: 3 ok (baseline 3)

degradation-audit: TOTAL 299 unsuppressed site(s)
```
- `libs/frontend/chat`: 8 ok (down from 12 FAIL; baseline 11)
- `libs/frontend/core`: 0 ok (down from 1 FAIL; baseline 0)
- Total unsuppressed sites reduced from 304 to 299.
- Exit code: 0.

---

## Verification

### 1. Typecheck
```powershell
$env:NX_DAEMON="false"; $env:NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-audit"; npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat @ptah-extension/skill-synthesis
```
Output:
```
 NX   Running target typecheck for 3 projects:

- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/skill-synthesis

√  nx run @ptah-extension/core:typecheck
√  nx run @ptah-extension/skill-synthesis:typecheck
√  nx run @ptah-extension/chat:typecheck

 NX   Successfully ran target typecheck for 3 projects
```

### 2. Lint
```powershell
$env:NX_DAEMON="false"; $env:NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-audit"; npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/skill-synthesis
```
Output:
```
 NX   Running target lint for 3 projects:

- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/skill-synthesis

√  nx run @ptah-extension/core:lint
√  nx run @ptah-extension/skill-synthesis:lint
√  nx run @ptah-extension/chat:lint

 NX   Successfully ran target lint for 3 projects
```

### 3. Unit Tests
- **`@ptah-extension/core`**:
  ```powershell
  $env:NX_DAEMON="false"; $env:NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-audit"; npx nx test @ptah-extension/core
  ```
  Result:
  ```
  Test Suites: 31 passed, 31 total
  Tests:       822 passed, 822 total
  Snapshots:   0 total
  Time:        11.709 s
  NX   Successfully ran target test for project @ptah-extension/core
  ```

- **`@ptah-extension/chat`**:
  ```powershell
  $env:NX_DAEMON="false"; $env:NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-audit"; npx nx test @ptah-extension/chat
  ```
  Result:
  ```
  Test Suites: 95 passed, 95 total
  Tests:       2 skipped, 1477 passed, 1479 total
  Snapshots:   0 total
  Time:        39.934 s
  NX   Successfully ran target test for project @ptah-extension/chat
  ```

- **`@ptah-extension/skill-synthesis`**:
  ```powershell
  $env:NX_DAEMON="false"; $env:NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-audit"; npx nx test @ptah-extension/skill-synthesis
  ```
  Result:
  ```
  Test Suites: 1 skipped, 81 passed, 81 of 82 total
  Tests:       1 skipped, 1587 passed, 1588 total
  Snapshots:   0 total
  Time:        42.754 s
  NX   Successfully ran target test for project @ptah-extension/skill-synthesis
  ```

---

## Deviations
None from the task instructions. All 5 audit sites were resolved in place without baseline modifications. Disagreed with touching `SkillEnhancerService` as explained under Review Comments.

---

## Not done
- `memory-diagnostics-accordion.component.ts`: Owned by a parallel lane; left untouched as instructed.
- `SkillEnhancerService` duplicate workspace lookup: Not modified due to lane boundary isolation and conflicting existing tests in `skill-enhancer.service.spec.ts`.

---

## Clarifications Needed
None. All requirements resolved and verified.

# Test Strategy Plan — ak/apply-pr-267 Follow-up

> Scope: testing correctness gap exposed by the settings-core / master-key CI failures.
> Branch target: `ak/apply-pr-267`.
> Date: 2026-05-12.

---

## 1. Executive Summary

Three CI failures on `ak/apply-pr-267` were coverage-threshold gates, not behavior failures. That distinction exposes a broader problem: the test suite proves code runs, not that it does the right thing. Five structural gaps drive the risk:

1. **Conformance harnesses are only partially consumed.** The contract suites in `libs/backend/platform-core/src/testing/contracts/` are comprehensive but two ports (`IWorkspaceLifecycleProvider`, `IHttpServerProvider`) have no harness, and `IMasterKeyProvider` (the site of the current failures) is not covered by any contract — it is tested only per-implementation with no cross-platform invariant suite.
2. **Silent key regeneration is untested as a correctness decision.** Existing specs confirm regeneration happens on corrupt/wrong-length key ref; none asks whether pre-existing encrypted secrets survive or become permanently unreadable.
3. **RPC dual-registration is enforced only by convention.** There is a compile-time union assertion in `register-all.ts` but no test fails when a handler prefix is absent from `ALLOWED_METHOD_PREFIXES` at runtime.
4. **Zod boundary coverage is ad-hoc.** Not every external boundary (file-read of `settings.json`, IPC payload, AI tool args, license-server webhooks) has a negative test suite.
5. **Cross-package constructor signatures drift silently.** The `SetupRpcHandlers` class is tested in `rpc-handlers` and consumed in `apps/ptah-extension-vscode` with no import-only typecheck spec to catch argument-list drift.

The fix is shaped as five targeted efforts (not a test-coverage blitz): conformance gaps, crypto lifecycle, RPC allowlist guard, boundary negative suites, and refactor safeguards. Total estimated effort is approximately 400–600 lines across 4–6 PRs, each independently CI-green.

---

## 2. Conformance Harness Design

### 2.1 Location

Conformance runners already live inside `platform-core` at:

```
libs/backend/platform-core/src/testing/contracts/
```

This is the correct canonical location — keep adding runners here rather than creating a separate lib. The consumer pattern (adapter spec file calls `runXxxContract(...)`) is already established and working across all three adapter families for the 11 ports currently covered.

### 2.2 Structure Pattern (already established, reproduced for reference)

```typescript
// run-xxx-contract.ts
export function runXxxContract(name: string, createProvider: () => Promise<IXxx> | IXxx, teardown?: () => Promise<void> | void): void {
  describe(`IXxx contract — ${name}`, () => {
    let provider: IXxx;

    beforeEach(async () => {
      provider = await createProvider();
    });
    afterEach(async () => {
      await teardown?.();
    });

    it('invariant 1 ...', async () => {
      /* AAA */
    });
    it('invariant 2 ...', async () => {
      /* AAA */
    });
    // ...
  });
}

// run-xxx-contract.self.spec.ts  (smoke-tests the runner against the mock)
import { createMockXxx } from '../mocks/xxx.mock';
import { runXxxContract } from './run-xxx-contract';
runXxxContract('createMockXxx', () => createMockXxx());
```

Each adapter spec (e.g. `cli-xxx.spec.ts`, `vscode-xxx.spec.ts`, `electron-xxx.spec.ts`) then calls `runXxxContract(...)` with a factory that constructs the real adapter against a tmp directory, followed by adapter-specific "extras" in a sibling `describe` block.

### 2.3 Worked Example — IMasterKeyProvider Conformance Suite

`IMasterKeyProvider` is defined at `libs/backend/settings-core/src/encryption/master-key-provider.ts` (single-method interface). The three concrete implementations are:

- `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts` — keytar (happy) + HKDF fallback
- `libs/backend/platform-electron/src/settings/electron-master-key-provider.ts` — `electron.safeStorage`
- `libs/backend/platform-vscode/src/settings/vscode-master-key-provider.ts` _(to be added — see Open Questions)_

**Proposed file:** `libs/backend/platform-core/src/testing/contracts/run-master-key-provider-contract.ts`

```typescript
/**
 * runMasterKeyProviderContract — cross-platform invariants for IMasterKeyProvider.
 *
 * Does NOT assert secure-storage internals; asserts observable key shape,
 * persistence semantics, and the regeneration policy the user must ratify
 * (see Open Question 1).
 */

import type { IMasterKeyProvider } from '@ptah-extension/settings-core';

export function runMasterKeyProviderContract(
  name: string,
  // Factory called twice with the SAME state root so "restart" can be simulated
  // by constructing a second provider pointed at the same backing store dir.
  createProvider: (stateRoot: string) => Promise<IMasterKeyProvider> | IMasterKeyProvider,
  /** Temporary directory owner; caller creates and destroys it. */
  makeStateRoot: () => Promise<string>,
  teardown?: (stateRoot: string) => Promise<void> | void,
): void {
  describe(`IMasterKeyProvider contract — ${name}`, () => {
    let stateRoot: string;
    let provider: IMasterKeyProvider;

    beforeEach(async () => {
      stateRoot = await makeStateRoot();
      provider = await createProvider(stateRoot);
    });

    afterEach(async () => {
      await teardown?.(stateRoot);
    });

    // -----------------------------------------------------------------------
    // Key shape
    // -----------------------------------------------------------------------

    it('getMasterKey() resolves to a Buffer of exactly 32 bytes', async () => {
      const key = await provider.getMasterKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('getMasterKey() returns the same Buffer reference on repeated calls (in-process cache)', async () => {
      const k1 = await provider.getMasterKey();
      const k2 = await provider.getMasterKey();
      expect(k1).toBe(k2);
    });

    it('getMasterKey() bytes are not all-zero (key material is non-trivial)', async () => {
      const key = await provider.getMasterKey();
      const allZero = key.every((b) => b === 0);
      expect(allZero).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Cross-restart persistence
    // -----------------------------------------------------------------------

    it('getMasterKey() returns the same key value across two provider instances sharing a state root', async () => {
      const k1 = await provider.getMasterKey();
      const provider2 = await createProvider(stateRoot);
      const k2 = await provider2.getMasterKey();
      expect(k1.toString('hex')).toBe(k2.toString('hex'));
    });

    // -----------------------------------------------------------------------
    // Idempotent get-or-create
    // -----------------------------------------------------------------------

    it('calling getMasterKey() twice on a fresh state root persists only one key ref', async () => {
      // Both calls must resolve to the same value regardless of race-like conditions.
      const [k1, k2] = await Promise.all([provider.getMasterKey(), provider.getMasterKey()]);
      expect(k1.toString('hex')).toBe(k2.toString('hex'));
    });

    // -----------------------------------------------------------------------
    // Regeneration semantics (OPEN QUESTION 1 — see Section 8)
    // The test body is intentionally left as a decision placeholder.
    // The currently-shipped behavior is regeneration; the question is whether
    // that is the SPECIFIED behavior or an accident.
    // -----------------------------------------------------------------------

    it.todo('[DECISION REQUIRED] corrupt key-ref: regenerate silently (data loss) vs. throw loudly (no data loss)');

    it.todo('[DECISION REQUIRED] wrong-length key-ref: regenerate silently vs. throw loudly');
  });
}
```

**How adapter specs wire it:**

`libs/backend/platform-cli/src/settings/cli-master-key-provider.spec.ts` (new contract call alongside existing per-adapter specs):

```typescript
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runMasterKeyProviderContract } from '@ptah-extension/platform-core/testing';
import { CliMasterKeyProvider } from './cli-master-key-provider';

runMasterKeyProviderContract(
  'CliMasterKeyProvider (keytar-available path)',
  (stateRoot) => new CliMasterKeyProvider(stateRoot),
  async () => fs.mkdtemp(path.join(os.tmpdir(), 'ptah-mkp-cli-')),
  async (stateRoot) => fs.rm(stateRoot, { recursive: true, force: true }),
);
```

Similarly in `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` using the `makeAvailableSafeStorage()` helper already defined there.

### 2.4 Port-by-Port Conformance Checklist

Ports are taken from `libs/backend/platform-core/src/di/tokens.ts` and the interface files in `libs/backend/platform-core/src/interfaces/`.

**Already covered by contract runner + at least one adapter invoking it:**

| Port                    | Contract runner                        | Adapter specs invoking it                          |
| ----------------------- | -------------------------------------- | -------------------------------------------------- |
| `IFileSystemProvider`   | `run-file-system-contract.ts`          | cli, electron (pending TODO notes in spec), vscode |
| `IStateStorage`         | `run-state-storage-contract.ts`        | cli, electron, vscode                              |
| `ISecretStorage`        | `run-secret-storage-contract.ts`       | cli, electron, vscode                              |
| `IWorkspaceProvider`    | `run-workspace-contract.ts`            | cli, electron, vscode                              |
| `IUserInteraction`      | `run-user-interaction-contract.ts`     | cli, vscode                                        |
| `IOutputChannel`        | `run-output-channel-contract.ts`       | cli, vscode                                        |
| `ICommandRegistry`      | `run-command-registry-contract.ts`     | cli, vscode                                        |
| `IEditorProvider`       | `run-editor-provider-contract.ts`      | cli, vscode                                        |
| `IDiagnosticsProvider`  | `run-diagnostics-provider-contract.ts` | cli, vscode                                        |
| `ITokenCounter`         | `run-token-counter-contract.ts`        | cli, vscode                                        |
| `IPlatformAuthProvider` | `run-auth-provider-contract.ts`        | cli, vscode                                        |

**Missing contract runners (Phase 1 target):**

| Port                          | Interface file                                                    | Invariants to assert                                                                                                                                                                                                                                                                       | Notes                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `IMasterKeyProvider`          | `settings-core/src/encryption/master-key-provider.ts`             | (1) 32-byte Buffer; (2) cached same-instance reference; (3) non-zero bytes; (4) cross-restart same value; (5) idempotent concurrent calls; (6–7) regeneration policy (pending user decision)                                                                                               | HIGHEST PRIORITY — current failures touch this port                                                                       |
| `IWorkspaceLifecycleProvider` | `platform-core/src/interfaces/workspace-lifecycle.interface.ts`   | (1) addFolder appends path; (2) addFolder deduplicates; (3) removeFolder triggers active-folder promotion; (4) setActiveFolder accepted path; (5) setActiveFolder unknown path is no-op; (6) getActiveFolder returns correct value; (7) onDidChangeWorkspaceFolders fires on each mutation | VS Code stub may return no-ops — document per Open Question 3                                                             |
| `IHttpServerProvider`         | `platform-core/src/interfaces/http-server-provider.interface.ts`  | (1) listen on port 0 returns non-zero bound port; (2) handle.close() is idempotent; (3) EADDRINUSE throws; (4) handler invoked per request; (5) errors in handler do not crash listener; (6) host/port on handle match bind params                                                         | CLI has real impl; VS Code/Electron likely stub — no-op stubs should skip conformance or assert they throw                |
| `IPlatformCommands`           | `platform-core/src/interfaces/platform-abstractions.interface.ts` | (1) reloadWindow does not throw; (2) openTerminal does not throw; (3) focusChat does not throw; (4) CLI no-ops complete without error                                                                                                                                                      | No shared state to assert beyond "does not throw / returns Promise<void>" — contract suite is lightweight by design       |
| `ISaveDialogProvider`         | `platform-core/src/interfaces/platform-abstractions.interface.ts` | (1) cancelled dialog returns null; (2) written file is readable at returned path; (3) content bytes match input                                                                                                                                                                            | CLI impl may be a stub — mark as skip-if-noop                                                                             |
| `IModelDiscovery`             | `platform-core/src/interfaces/platform-abstractions.interface.ts` | (1) getCopilotModels returns array (possibly empty); (2) getCodexModels returns array (possibly empty); (3) returned items have id/name/contextLength > 0                                                                                                                                  | VS Code impl reaches real vscode.lm API — only mock-based contract sensible                                               |
| `IMemoryWriter`               | `platform-core/src/interfaces/memory-writer.interface.ts`         | (1) upsert with stable (fingerprint, subject) is idempotent; (2) distinct subjects create distinct entries; (3) upsert returns without throwing even on duplicate                                                                                                                          | Memory-curator lib owns the impl — contract runner validates the contract against the real impl in memory-curator's tests |

**Should NOT have a conformance suite:**

- `ContentDownloadService` (token `CONTENT_DOWNLOAD`) — this is a concrete class, not an interface. It makes real network calls (GitHub raw content). Contract testing would be an integration test requiring network access. Test it with MSW or a VCR-style fixture instead.
- `PLATFORM_INFO` token — maps to an `IPlatformInfo` shape that is purely descriptive (type, storagePath, extensionPath). No behavioral contract to assert; values are environment-specific. Test that the registered object satisfies the schema shape, not behavior.

---

## 3. Behavior/Property Tests for Crypto and Persistence

### 3.1 Master-Key Lifecycle — Data-Loss Audit (CRITICAL)

**Problem:** The existing tests for `ElectronMasterKeyProvider` at `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` lines 268–373 confirm that corrupt/wrong-length/missing key-ref files result in a fresh key being generated and persisted. They do NOT test what happens to AES-256-GCM ciphertexts that were previously encrypted with the OLD key. If a key is regenerated, all prior secrets encrypted with the old key become unreadable.

**Required new tests** — add to `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` and equivalents in CLI:

| Test ID  | Scenario                                                                                    | Assertion                                                                   | Decision prereq |
| -------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| MKP-DL-1 | Write secret with key K1; simulate key-ref corruption; reinitialize provider; read secret   | Confirm secret is unreadable (undefined) OR confirm exception is thrown     | Open Question 1 |
| MKP-DL-2 | Write N secrets; simulate keyring-becomes-unavailable on second boot; read all N secrets    | Confirm behavior is deterministic (all fail or all succeed — never partial) | Open Question 1 |
| MKP-DL-3 | Key regeneration writes a new key-ref atomically — old key-ref is not partially overwritten | After regeneration, key-ref file is valid JSON with all required fields     | No prereq       |
| MKP-DL-4 | Two concurrent calls to getMasterKey() on a fresh state root produce the same value         | Both goroutines/async paths return identical hex                            | No prereq       |

**File paths for new tests:**

- `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` — append `describe('C5 — data-loss audit', ...)`
- `libs/backend/platform-cli/src/settings/cli-master-key-provider-keytar.spec.ts` — append `describe('data-loss audit', ...)`

### 3.2 Settings-Core Round-Trip

`libs/backend/settings-core/src/settings-core.spec.ts` covers the `ReactiveSettingsStore` and `MigrationRunner`. The following gaps remain:

| Test ID | File                                                                                                       | Scenario                                                                                                                                                     | Assertion                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| SC-RT-1 | `settings-core.spec.ts`                                                                                    | write secret → restart (new store, same file) → read secret                                                                                                  | Returns original plaintext                                                                      |
| SC-RT-2 | `settings-core.spec.ts`                                                                                    | idempotent flush: `flushSync()` called twice with no intervening writes                                                                                      | File modification time does NOT change on second flush (no spurious writes)                     |
| SC-RT-3 | `settings-core.spec.ts`                                                                                    | secret vs non-secret routing: a key in `FILE_BASED_SETTINGS_KEYS` goes through `PtahFileSettingsManager`; an unknown key raises a type error at compile time | Runtime: `get('known-file-key')` reaches file manager; type error: `get('vscode-internal-key')` |
| SC-RT-4 | `settings-core.spec.ts`                                                                                    | migration idempotency: running `MigrationRunner` twice on the same store version does not duplicate entries or throw                                         | Result identical to single-run                                                                  |
| SC-RT-5 | `file-settings-manager.spec.ts` (exists at `libs/backend/platform-core/src/file-settings-manager.spec.ts`) | write nested key, verify round-trip through flatten/unflatten                                                                                                | `get('a.b.c')` after `set('a.b.c', 42)` returns 42                                              |

### 3.3 SQLite Persistence — Migration Invariants

Existing coverage is in `libs/backend/persistence-sqlite/src/lib/migration-runner.spec.ts` using `FakeSqliteDatabase`. The following gaps target the real `better-sqlite3` binding:

| Test ID | File                                | Scenario                                                                                  | Assertion                                                                        |
| ------- | ----------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| SQL-M-1 | `migration-runner.spec.ts`          | applying the full `MIGRATIONS` array to a fresh in-memory DB does not throw               | All versions applied; `finalVersion === MIGRATIONS[MIGRATIONS.length-1].version` |
| SQL-M-2 | `migration-runner.spec.ts`          | re-running `applyAll` on an already-migrated DB skips all versions                        | `appliedVersions` is empty array; `skippedVersions` covers all                   |
| SQL-M-3 | `migration-runner.spec.ts`          | migration with a syntax error is rolled back — prior tables intact                        | Table count before equals table count after failed migration attempt             |
| SQL-M-4 | `migration-runner.spec.ts`          | migration version numbers are strictly monotonically increasing in the `MIGRATIONS` array | No two consecutive entries share or decrease version                             |
| SQL-M-5 | `sqlite-connection.service.spec.ts` | connection factory returns a live DB object that accepts basic SQL                        | `db.prepare('SELECT 1').get()` does not throw                                    |

---

## 4. RPC-Handler Integration Tests

### 4.1 Dual-Registration Guard Test

**Problem:** `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46` must contain a prefix for every method registered via `registerAllRpcHandlers()`. There is no automated guard that fails CI when a new handler class's prefix is missing from the runtime allowlist.

**Proposed test file:** `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`

Strategy:

1. Import `SHARED_HANDLERS` from `register-all.ts`.
2. Collect every method string from each handler's `static METHODS` tuple.
3. Extract each method's prefix (the substring up to and including the first `:`).
4. Assert that every prefix string is present in the exported `ALLOWED_METHOD_PREFIXES` array.

This requires `ALLOWED_METHOD_PREFIXES` to be exported from `rpc-handler.ts`. Currently it is `const`, not exported. **Phase 1 requires exporting it** (or exposing it via a test-only re-export in `vscode-core/testing`). The test is ~20 lines.

```typescript
// pseudo-structure of the guard test
import { SHARED_HANDLERS } from './register-all';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core/testing'; // re-export

it('every SHARED_HANDLERS method has its prefix in ALLOWED_METHOD_PREFIXES', () => {
  const missing: string[] = [];
  for (const HandlerCtor of SHARED_HANDLERS) {
    for (const method of HandlerCtor.METHODS) {
      const prefix = method.slice(0, method.indexOf(':') + 1);
      if (!ALLOWED_METHOD_PREFIXES.includes(prefix as never)) {
        missing.push(`${HandlerCtor.name}: ${method} (prefix: ${prefix})`);
      }
    }
  }
  expect(missing).toEqual([]);
});
```

### 4.2 Five Highest-Risk Handler Integration Tests

Risk ranking is based on: (a) constructor argument drift history, (b) cross-service dependencies, (c) data-loss potential.

**Rank 1 — `SetupRpcHandlers`**

- Drift history: `ConfigManager` → `ModelSettings` argument change caught by `tsc`, not tests.
- File: `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts` (exists — needs expansion).
- Missing scenarios: `wizard:deep-analyze` with no workspace folders; `wizard:deep-analyze` when `MultiPhaseAnalysisService.analyzeWorkspace()` returns `isErr: true`.

**Rank 2 — `SettingsRpcHandlers`**

- Handles import/export of credentials; any bug causes data loss.
- File: `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.spec.ts` (**does not yet exist**).
- Required scenarios: `settings:export` happy path; `settings:export` cancelled by user (null file path); `settings:import` with malformed JSON; `settings:import` with missing `config` key; `settings:import` with license key triggers `verifyLicense` + reload; `settings:import` when `showOpenDialog` is absent (CLI/no-op host) returns `cancelled: true`.

**Rank 3 — `LlmRpcHandlers`**

- Routes to `ModelSettings` typed repository (changed in this branch).
- File: `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.spec.ts` (exists — needs expansion).
- Missing scenarios: `llm:get-models` when ModelSettings returns empty string; `llm:save` with a null/undefined model value.

**Rank 4 — `AuthRpcHandlers`**

- Writes secrets through `ISecretStorage`; failure silently swallows API keys.
- File: `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts` (exists).
- Missing scenarios: `auth:save` with empty string value; `auth:save` when `secretStorage.store` rejects; `auth:get` when storage has never been written.

**Rank 5 — `GitRpcHandlers`**

- Calls `IFileSystemProvider.findFiles` and `IWorkspaceProvider.getWorkspaceRoot`; path-handling bugs are platform-specific.
- File: `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts` (exists).
- Missing scenarios: `git:status` with no workspace root; `git:status` when `findFiles` returns an empty array.

---

## 5. Zod Boundary Negative Tests

Every external boundary where Zod (or manual parsing) should validate untrusted input:

### 5.1 Boundary Inventory

| Boundary ID | Location                                                                           | Input surface                                           | Current Zod coverage                                                 | Gap                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| B-1         | `libs/backend/rpc-handlers/src/lib/handlers/*.schema.ts`                           | RPC request `params`                                    | Each handler has a schema spec                                       | Some schema specs assert only valid input; malformed input cases are sparse                                          |
| B-2         | `libs/backend/settings-core/src/settings-core.spec.ts`                             | `~/.ptah/settings.json` read at startup                 | Covered for missing/malformed via `PtahFileSettingsManager` defaults | No test for partially-valid JSON (valid outer structure, wrong field types)                                          |
| B-3         | `libs/backend/platform-core/src/file-settings-manager.spec.ts`                     | File read of `settings.json` after out-of-process write | Covered for corruption                                               | No test for deeply-nested invalid structure that passes top-level parse                                              |
| B-4         | `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` | `master-key-ref.json` on disk                           | Covered for corrupt JSON, missing fields, wrong key length           | No test for valid structure with `version` field > expected (future format)                                          |
| B-5         | `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:178`          | `settings:import` reads user-supplied file              | Manual JSON.parse with try/catch (lines 178–203)                     | No Zod validation on the parsed `PtahSettingsExport` shape — `parsedData as PtahSettingsExport` is an unchecked cast |
| B-6         | `apps/ptah-license-server/src/`                                                    | HTTP webhook bodies (Paddle, WorkOS)                    | NestJS `ValidationPipe` + DTO decorators                             | Verify all DTOs use `@IsString()` etc. on untrusted fields; missing `@Transform` could admit injection               |
| B-7         | `libs/backend/agent-sdk/src/`                                                      | AI tool call arguments from Claude SDK                  | Tool arg schemas exist                                               | Need negative tests for each tool arg schema (missing required field, wrong type, extra field)                       |
| B-8         | `apps/ptah-cli/src/cli/router.ts`                                                  | JSON-RPC stdio input                                    | Router validates method names                                        | No test for `params` field containing non-object values                                                              |

### 5.2 Required Negative Test Fixtures per Boundary

**B-1 (RPC schema specs) — standardized malformed input set for each schema:**

- `null` params
- `{}` (missing all required fields)
- Correct shape but wrong field types (e.g. `{ modelId: 123 }` instead of `string`)
- Extra unknown fields (should fail `strict()` schemas, be stripped by lenient ones)

**B-5 (settings:import) — highest risk, no current Zod guard:**
Add `PtahSettingsExportSchema` Zod object to `libs/backend/agent-sdk/src/services/settings/` and replace the cast at `settings-rpc.handlers.ts:216` with `.safeParse()`. Negative test fixtures: `null`, `{ secrets: null }`, `{ config: "string" }`, `{ version: 99 }` (future version — should be rejected or forwarded as-is?).

**B-4 (master-key-ref.json) — missing future-version test:**
Add: `{ version: 99, algorithm: 'electron-safeStorage', wrapped: 'AAAA' }` should either throw with a descriptive error or trigger regeneration. Currently the `isMasterKeyRef` guard at `electron-master-key-provider.ts` only checks field presence, not version range.

---

## 6. Cross-Package Refactor Safeguards

### 6.1 The SetupRpcHandlers Drift Pattern

The `SetupRpcHandlers` constructor signature changed (param 3: `ConfigManager` → `ModelSettings`). The change was correctly made in `libs/backend/rpc-handlers`, but the call site at `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` still passed a `ConfigManager` shape. TypeScript caught this — but only because the integration spec imports the class and constructs it directly.

The gap: if the consumer had used `container.resolve(SetupRpcHandlers)` (DI), the type error would be invisible until runtime.

### 6.2 Proposed Safeguard: Constructor-Signature Typecheck Spec

**File:** `libs/backend/rpc-handlers/src/lib/handlers/constructor-signatures.typecheck.ts`

This file is pure TypeScript with no `it()` calls. It imports every handler class and constructs them with correctly typed arguments. Because `nx typecheck` runs `tsc --noEmit`, any argument-type regression causes a CI failure in the `typecheck` target — no Jest run required.

```typescript
// Purpose: compile-time guard against constructor-argument drift.
// This file contains NO runtime tests — it exists solely so `tsc --noEmit`
// catches constructor-signature changes before they reach integration specs.

import type { SetupRpcHandlers } from './handlers/setup-rpc.handlers';
import type { SettingsRpcHandlers } from './handlers/settings-rpc.handlers';
import type { ModelSettings } from '@ptah-extension/settings-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
// ... other handler imports

// Each line is a compile-time assertion that the argument list is correct.
// Assign to `never` ensures TS evaluates the constructor parameter types.
// Change a constructor signature → type error here → CI typecheck fails.
type _SetupRpcHandlersArgs = ConstructorParameters<typeof SetupRpcHandlers>;
// Validate ModelSettings is in position 2 (0-indexed):
type _SetupParam2 = _SetupRpcHandlersArgs[2];
const _assertModelSettings: _SetupParam2 extends ModelSettings ? true : never = true;
void _assertModelSettings;
```

**Why typecheck-only rather than a Jest test:** Jest tests are compiled by `ts-jest` in CJS mode which may tolerate argument-type mismatches that would fail `tsc --strict`. A `typecheck` spec is stricter because `tsc` applies all strict flags.

### 6.3 Additional Safeguard: nx Project Boundary Linting

`nx affected -t typecheck` already runs on CI. The additional hardening is to add a `project.json` `implicitDependencies` entry in `apps/ptah-extension-vscode/project.json` pointing to `rpc-handlers`, so `nx affected` always marks the VS Code app as affected when `rpc-handlers` changes. This currently works transitively, but an explicit entry makes the dependency graph visible to `nx graph` reviewers.

No new files required; one `project.json` edit.

### 6.4 Import-Across-Package Smoke Test

For the five highest-risk handler classes (§4.2), add a one-liner import in each app's integration spec that verifies the class is importable with the current type definitions. The `wizard-seed-noop.spec.ts` at `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` already does this for `SetupRpcHandlers` — extend the pattern to `SettingsRpcHandlers`, `LlmRpcHandlers`, and `AuthRpcHandlers`.

---

## 7. Implementation Phasing

Phases are ordered by **risk-reduction-per-LOC** — earlier phases address higher-consequence gaps. Each phase must be independently CI-green before merging.

### Phase 1 — Export ALLOWED_METHOD_PREFIXES + RPC allowlist guard (10–25 LOC)

**Files changed:**

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` — export `ALLOWED_METHOD_PREFIXES`
- `libs/backend/vscode-core/src/testing/index.ts` — re-export `ALLOWED_METHOD_PREFIXES`
- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` — NEW, ~20 lines

**Risk reduced:** Silent runtime crashes from missing allowlist prefix entries. The test fails at `nx test rpc-handlers` before the extension activates in production.

**Estimated size:** 25–30 LOC net. No behavior change.

### Phase 2 — IMasterKeyProvider conformance runner + adapter wiring (60–100 LOC)

**Files changed:**

- `libs/backend/platform-core/src/testing/contracts/run-master-key-provider-contract.ts` — NEW, ~80 lines
- `libs/backend/platform-core/src/testing/contracts/run-master-key-provider-contract.self.spec.ts` — NEW, ~15 lines
- `libs/backend/platform-core/src/testing/contracts/index.ts` — add export
- `libs/backend/platform-core/src/testing/index.ts` — verify re-export
- `libs/backend/platform-cli/src/settings/cli-master-key-provider.spec.ts` — call contract runner, ~10 lines added
- `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` — call contract runner, ~10 lines added

**Risk reduced:** Cross-platform key-behavior divergence. Any future implementation must pass the same invariants.

**Note:** The `it.todo` tests for regeneration policy are deliberately left as todos until Open Question 1 is resolved.

### Phase 3 — Data-loss audit tests (MKP-DL-1 through MKP-DL-4) (50–80 LOC)

**Prerequisite:** Open Question 1 resolved.

**Files changed:**

- `libs/backend/platform-electron/src/settings/electron-master-key-provider.spec.ts` — append `describe('C5 — data-loss audit', ...)`, ~40 lines
- `libs/backend/platform-cli/src/settings/cli-master-key-provider-keytar.spec.ts` — append data-loss describe, ~30 lines

**Risk reduced:** Silent data loss when key regeneration silently discards all previously-encrypted secrets.

### Phase 4 — SettingsRpcHandlers integration tests + Zod guard for settings:import (80–120 LOC)

**Files changed:**

- `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.spec.ts` — NEW, ~100 lines (6 scenarios from §4.2 Rank 2)
- `libs/backend/agent-sdk/src/services/settings/ptah-settings-export.schema.ts` — NEW or modify existing, Zod schema for `PtahSettingsExport`
- `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts` — replace unchecked cast at line 216 with `.safeParse()`, ~5 line change

**Risk reduced:** Malformed import file crashing extension; unchecked cast admitting invalid data into secrets store.

### Phase 5 — IWorkspaceLifecycleProvider conformance runner + constructor typecheck spec (60–90 LOC)

**Files changed:**

- `libs/backend/platform-core/src/testing/contracts/run-workspace-lifecycle-contract.ts` — NEW, ~60 lines
- `libs/backend/platform-core/src/testing/contracts/run-workspace-lifecycle-contract.self.spec.ts` — NEW, ~15 lines
- `libs/backend/platform-core/src/testing/contracts/index.ts` — add export
- `libs/backend/rpc-handlers/src/lib/handlers/constructor-signatures.typecheck.ts` — NEW, ~30 lines
- `apps/ptah-extension-vscode/project.json` — add explicit `implicitDependencies` on `rpc-handlers`

**Risk reduced:** Workspace lifecycle divergence across platforms; constructor-argument drift going undetected.

### Phase 6 — Remaining missing contract runners + SQLite migration invariants (80–120 LOC)

**Files changed:**

- `libs/backend/platform-core/src/testing/contracts/run-platform-commands-contract.ts` — NEW, ~30 lines (lightweight — asserts no-throw)
- `libs/backend/persistence-sqlite/src/lib/migration-runner.spec.ts` — add SQL-M-3 through SQL-M-5, ~40 lines
- `libs/backend/settings-core/src/settings-core.spec.ts` — add SC-RT-1 through SC-RT-4, ~40 lines

**Risk reduced:** Migration re-entrancy bugs; settings round-trip regressions after future schema changes.

---

## 8. Open Questions for the User

These decisions must be made before Phase 3 starts. Each answer directly determines whether a test asserts `expect(secret).toBeUndefined()` or `expect(() => ...).toThrow()`.

**Q1. When the master-key-ref file is corrupt or has the wrong key length, what is the SPECIFIED behavior?**

- Option A (current): Silently regenerate. New key is created; all previously-encrypted secrets become permanently unreadable (undefined on get). No error is thrown or surfaced to the user.
- Option B: Throw loudly with a descriptive error code (e.g. `MASTER_KEY_CORRUPTED`). Extension/Electron fails to start. User is prompted to reset. No silent data loss.
- Option C: Log a warning at `error` level, emit a user-visible notification via `IUserInteraction.showErrorMessage`, then regenerate. Secrets are lost but the user is informed.

_The author of this plan recommends Option B for Electron (where the keyring is external state that can change) and Option C for CLI (where the HKDF fallback is already a degraded mode)._

**Q2. Should `ElectronMasterKeyProvider` handle the case where `safeStorage.decryptString` returns a plaintext that does not decode to a valid base64 Buffer?**

- Currently: the `isMasterKeyRef` guard checks field presence, not value format. A `wrapped` field that is valid JSON string but invalid base64 will produce an invalid Buffer silently.
- Recommendation: Add Zod validation on the parsed key-ref object before base64 decoding.

**Q3. Should `IWorkspaceLifecycleProvider` have a no-op VS Code implementation?**

- VS Code's workspace folder mutations go through `vscode.workspace.updateWorkspaceFolders`, which is not surfaced in the current `VscodeWorkspaceProvider`.
- Option A: Leave VS Code implementation as no-ops and skip the conformance suite for that adapter.
- Option B: Implement VS Code adapter using `vscode.workspace.updateWorkspaceFolders`.
- The answer determines whether `run-workspace-lifecycle-contract.ts` is invoked in `libs/backend/platform-vscode/` or only in `platform-cli/` and `platform-electron/`.

**Q4. Should `settings:import` reject import files whose `PtahSettingsExport.version` field is higher than the current schema version?**

- Option A: Accept and apply what is recognizable; silently skip unknown fields (Zod `.strip()`).
- Option B: Reject with a user-visible error and return `cancelled: false, result: { errors: ['Unsupported export version'] }`.
- This determines the Zod schema for `PtahSettingsExportSchema` in Phase 4.

**Q5. Is the HKDF fallback key in `CliMasterKeyProvider` intentionally deterministic across machines with the same username/hostname?**

- The existing spec at `libs/backend/platform-cli/src/settings/cli-master-key-provider.spec.ts` lines 93–111 asserts that two instances on the same machine derive the same key.
- If two different machines with the same username/hostname also derive the same key, this is a potential security weakness (shared key without keyring isolation).
- The answer determines whether a test should assert cross-machine key uniqueness (which requires injecting a machine-unique salt) or accept the current behavior as intentional for the CLI's threat model.

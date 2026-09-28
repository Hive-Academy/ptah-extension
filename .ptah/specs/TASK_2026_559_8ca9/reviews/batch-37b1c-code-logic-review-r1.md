# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 10/10 |
| Assessment | APPROVED |
| Requested verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Monorepo Batch 37b1c (`3eb907fa5`) implements the host-side per-workspace `go vet` consent RPC surface (`diagnostics:go-vet-consent-get` and `diagnostics:go-vet-consent-set`) for `TASK_2026_559_8ca9`, strictly adhering to specification documents `o2-go-vet-consent-surface.md` (O2 §3, §6, §7.3) and User Decision 25.

Score justification: Placed in the 10/10 exemplary band. The implementation is secure, resilient, and fails closed across all boundary conditions:
- **Strict Parameter Validation:** Input parameters are parsed with strict Zod schemas (`.strict()`), rejecting unknown or malformed properties with fixed error code `'invalid-params'`.
- **Target Invariant & Stale-UI Guard:** The caller-supplied `workspaceRoot` string is strictly treated as a comparison token (to detect stale UI views across folder switches). Writes are unconditionally applied only to the host's active, registered workspace root (`active.root`), preventing arbitrary file path manipulation or directory traversal.
- **Race Condition Serialization:** All mutating `SET` operations are serialized via a single sequential Promise queue (`setChain`), preventing race conditions between concurrent grants and revokes.
- **Idempotent Revoke & Read-Back Verification:** Mutating actions are verified by immediate read-back against storage and the consent store before reporting success or logging audit records. If read-back fails or storage throws, the operation fails closed with `'persist-failed'`.
- **Privacy & Information Containment:** Catch blocks swallow underlying errors without leaking file system paths or raw `error.message` strings. Audit logs hash the active workspace root using a 16-character SHA-256 digest (`workspaceHash`).
- **Capability Isolation:** The `goVetDiagnostics` capability is disabled by default (`ALL_DISABLED`), required by the manifest entry, and excluded from the VS Code extension RPC surface.
- **Test Parity & Coverage:** `JsonFileStateStorage` mirrors `CliStateStorage` from `@ptah-extension/platform-cli` line-for-line, and all 11 test cases of O2 §7.3, Decision 25, and win32 case-folding are covered with real storage and domain service instances (19/19 tests passing).

---

## Verification evidence

- **Test execution:**
  - Ran focused test suite: `node_modules\.bin\nx test @ptah-extension/rpc-handlers --testFile=diagnostics-consent-rpc.handlers.spec.ts`. All 19 tests passed (17.2s).
  - Ran RPC prefix allowlist test: `node_modules\.bin\nx test @ptah-extension/vscode-core --testFile=rpc-handler.spec.ts`. All 10 tests passed.
  - Ran full test/lint/typecheck validation: `node_modules\.bin\nx run-many -t=test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/vscode-core ptah-extension-vscode --skip-nx-cache`.
    - `ptah-extension-vscode`: `test`, `lint`, `typecheck` all passed.
    - `@ptah-extension/rpc-handlers`: `lint` and `typecheck` passed.
    - 38/39 tasks passed (3,294 tests passed; the sole failure was the known `%TEMP%/.ptah` host environment flake in `harness-skill-selection-rpc.service.spec.ts:113`, unrelated to this batch).
- **Inspection of commit `3eb907fa5`:**
  - `libs/shared/src/lib/types/rpc.types.ts`: DTOs, parameter shapes, error codes, and method entries registered in `RpcMethodRegistry`.
  - `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`: `goVetDiagnostics` added to `RPC_CAPABILITIES`.
  - `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts`: `goVetDiagnostics: false` in `ALL_DISABLED`.
  - `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`: `diagnosticsConsent` entry requiring `goVetDiagnostics`.
  - `libs/backend/rpc-handlers/src/lib/handlers/diagnostics-consent-rpc.handlers.ts`: Handlers implementation.
  - `libs/backend/rpc-handlers/src/lib/handlers/diagnostics-consent-rpc.handlers.spec.ts`: 19 tests verifying O2 §7.3 cases 1–11.
  - `libs/backend/vscode-core/src/messaging/rpc-handler.ts`: `'diagnostics:'` added to `ALLOWED_METHOD_PREFIXES`.
  - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`: Added to `VSCODE_EXPECTED_ABSENT_METHODS`.
  - `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` & `heavy-module-mocks.ts`: Provided `recognisedSourceExtensions` and `supportedLanguagesFor` mocks.

---

## Part 1 — Verification of Previous Review Findings

Batch 37b1b had 0 findings, so there are no open issues or regressions from prior reviews to verify.

---

## Part 2 — Review of Batch 37b1c (commit 3eb907fa5)

### Five logic questions

#### 1. How does this fail silently?
Nowhere. All failures are explicitly categorized and surfaced to callers via bounded, strongly typed results:
- If parameters fail schema validation, `{ success: false, error: 'invalid-params' }` is returned immediately.
- If storage is not workspace-scoped, `{ success: false, error: 'unsupported' }` is returned.
- If no workspace is active or registered, `{ success: false, error: 'no-workspace' }` is returned.
- If the caller's view of the root differs from the host's active root, `{ success: false, error: 'workspace-changed' }` is returned.
- If Go is missing from PATH, `{ success: false, error: 'no-go-binary' }` is returned.
- If writing or read-back verification fails, `{ success: false, error: 'persist-failed' }` is returned.
Internal persistence errors are caught and logged with sanitized metadata (`workspaceHash`), never exposing raw exceptions or disk paths.

#### 2. What user action produces unexpected behaviour?
None identified:
- If a user switches workspaces or closes a folder while the consent prompt is open, attempting to submit consent fails with `'workspace-changed'` or `'no-workspace'` without corrupting the new workspace state.
- If a user modifies or upgrades their Go toolchain, `diagnostics:go-vet-consent-get` detects the binary change and returns `state: 'stale'`, `staleReason: 'go-changed'`, preventing unauthorized execution until re-enabled (Decision 25).
- If a user repeatedly clicks "Revoke", the operation is strictly idempotent and safely returns `{ success: true, state: 'off' }`.

#### 3. What input data produces a wrong answer?
None found:
- Extra unexpected properties in GET or SET parameters trigger strict Zod validation errors and return `'invalid-params'`.
- Arbitrary paths passed into `workspaceRoot` (e.g. `../../etc/passwd` or non-active roots) are never passed to disk write routines; they are strictly compared to `active.root` via `path.resolve` and Win32 case-folding, yielding `'workspace-changed'` on mismatch.

#### 4. What happens when a dependency fails?
- **Storage persistence error (e.g. disk full, read-only file system):** Caught in `try ... catch`, swallowed without leaking `error.message`, and returned as `{ success: false, error: 'persist-failed' }`.
- **Toolchain resolution failure:** If `resolveGoBinary` cannot locate `go` / `go.exe`, the grant is rejected with `'no-go-binary'` without writing partial state.
- **Read-back discrepancy:** If the storage driver swallows writes or returns an inconsistent state, read-back verification detects the mismatch and returns `'persist-failed'`, skipping the audit log.

#### 5. What is missing that the requirements never mentioned?
All edge cases and unstated requirements are properly anticipated:
- Win32 case-insensitivity on drive letters and workspace paths is accounted for in path comparisons (`samePath`).
- Unhandled Promise rejections in the serialization chain are prevented by attaching both fulfillment and rejection handlers: `this.setChain.then(() => {}, () => {})`.

---

## Security Checklist & Deep Dive

| Review Area | Security Assessment | Implementation Details |
| --- | --- | --- |
| **1. Root Boundary & Stale-UI Guard** | **PASSED (Fail-Closed)** | Enforces strict check order: Zod schema → `isWorkspaceScopedStateStorage` check → host active root resolution (`lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot()`) → active storage registration check (`getStorageForWorkspace`) → comparison of caller `workspaceRoot` against `active.root`. The target for consent writes is strictly `active.root`; the caller's parameter is never used as a write destination. |
| **2. Concurrency & Serialization** | **PASSED (Thread-Safe)** | Mutations are queued on `this.setChain`. Each incoming request awaits the resolution of previous requests before reading or writing storage. Errors in earlier requests do not break the chain (`.then(() => {}, () => {})`). |
| **3. Idempotent Revoke & Read-Back** | **PASSED (Verified)** | Revoke sets the consent key to `undefined`. Read-back confirms that `storage.get` is undefined, `storage.keys()` does not contain `GO_VET_CONSENT_KEY`, and `consentStore.read(active.root, binary).state === 'off'`. Grant confirms read-back returns `'on'`. Audit logging executes strictly after read-back succeeds. |
| **4. Error Masking & PII Protection** | **PASSED (Sanitized)** | Persistence errors are caught, `void error` suppresses rethrows, and warnings are logged with fixed string descriptions and `workspaceHash: hashWorkspaceRoot(active.root)` (first 16 hex chars of SHA-256). No file paths, usernames, or exception messages leak into logs or RPC responses. |
| **5. Capability Isolation (`ALL_DISABLED`)** | **PASSED (Isolated)** | Added `goVetDiagnostics: false` to `ALL_DISABLED` in `host-profile.ts`. Manifest entry requires `goVetDiagnostics`. In `rpc-surface.spec.ts`, both methods are explicitly listed in `VSCODE_EXPECTED_ABSENT_METHODS`. |
| **6. RPC Prefix Containment** | **PASSED (Allowlisted)** | Added `'diagnostics:'` to `ALLOWED_METHOD_PREFIXES` in `vscode-core/rpc-handler.ts`. Any unregistered method under this prefix is blocked by the RPC dispatcher. |
| **7. Spec Parity (`JsonFileStateStorage`)** | **PASSED (Equivalent)** | `JsonFileStateStorage` in tests matches `CliStateStorage` line-for-line: atomic file write via `.tmp` rename, deletion on `undefined`, and graceful fallback on JSON parse failure. |

---

## Failure modes

No unhandled failure modes identified. All examined failure paths fail closed and qualify the verdict.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Moderate and minor issues

None.

---

## Data flow

1. **`diagnostics:go-vet-consent-get`:**
   - RPC request arrives -> parameters validated as `{}` (`DiagnosticsGoVetConsentGetParamsSchema`).
   - Checks if storage is workspace-scoped via `isWorkspaceScopedStateStorage(this.storage)`. If false, returns `{ supported: false, workspace: null, state: 'off' }`.
   - Resolves active folder via `this.lifecycle.getActiveFolder() ?? this.workspaceProvider.getWorkspaceRoot()`.
   - If folder is unregistered in storage, returns `{ supported: true, workspace: null, state: 'off' }`.
   - Resolves Go binary via `resolveGoBinary({ env: process.env })`.
   - Reads consent state via `this.consentStore.read(activeRoot, binary)`.
   - Returns `{ supported: true, workspace: { root: activeRoot }, state, staleReason, goBinary }`.

2. **`diagnostics:go-vet-consent-set`:**
   - RPC request arrives -> parameters validated via `DiagnosticsGoVetConsentSetParamsSchema.strict()`.
   - Operation is serialized via `this.setChain`.
   - Checks workspace storage support -> fails with `'unsupported'` if unsupported.
   - Resolves active root and checks registration -> fails with `'no-workspace'` if unregistered.
   - Compares user-supplied `workspaceRoot` against `active.root` -> fails with `'workspace-changed'` if mismatched.
   - If `enabled === true`: resolves Go binary -> fails with `'no-go-binary'` if absent; writes grant to storage; verifies read-back (`state === 'on'`).
   - If `enabled === false`: deletes consent key from storage; verifies read-back (`state === 'off'` and key absent).
   - If write or read-back fails -> logs warning with `workspaceHash` and returns `'persist-failed'`.
   - On verified success -> logs audit line `[Diagnostics] go vet consent changed` with `workspaceHash`, `enabled`, and `source`, returning `{ success: true, state }`.

---

## Requirements fulfilment

| Requirement | Status | Verification & Evidence |
| --- | --- | --- |
| Strict parameter validation via Zod | COMPLETE | Tested with extra keys, bad types, missing keys, and invalid sources (`invalid-params`). |
| Invariant check order 1–7 (O2 §3) | COMPLETE | Check order tested in sequence: schema -> supported -> active -> registered -> changed -> binary -> persist. |
| User-supplied path is comparison token only | COMPLETE | Non-active paths (registered or unregistered) produce `workspace-changed`; write target is always `active.root`. |
| Concurrency serialization | COMPLETE | Sequential execution guaranteed by `setChain: Promise<unknown>`. |
| Read-back verification before audit/success | COMPLETE | Tested: artificial storage failure or swallowed write produces `persist-failed` without audit log. |
| Idempotent revoke | COMPLETE | Revoking an already revoked workspace returns `{ success: true, state: 'off' }`. |
| Capability isolation in host profile | COMPLETE | `goVetDiagnostics` declared, disabled in `ALL_DISABLED`, verified absent in VS Code spec. |
| Audit logging with hash anonymization | COMPLETE | Log format matches O2 §6: `[Diagnostics] go vet consent changed` with 16-char SHA-256 hash. |
| Complete O2 §7.3 test cases (1–11) | COMPLETE | 19 tests in `diagnostics-consent-rpc.handlers.spec.ts` cover all 11 cases, Decision 25, and Win32. |

---

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Concurrent SET calls (grant + revoke race) | YES | Serialized through `setChain` promise queue | None. |
| Caller workspace root differs in Win32 casing | YES | `samePath` normalizes paths with `path.resolve` and case-folding on Win32 | None. |
| Folder switched while consent modal open | YES | Caught by `samePath(params.workspaceRoot, active.root)` -> `'workspace-changed'` | None. |
| Active root has no registered storage | YES | Returns `'no-workspace'` without attempting writes | None. |
| Disk write throws or disk is full | YES | Caught, swallowed, logs sanitized warning, returns `'persist-failed'` | None. |
| Go binary uninstalled after grant | YES | Next check or get detects missing binary or stale state | None. |
| Toolchain upgraded/replaced (Decision 25) | YES | Store detects binary change -> `state: 'stale'`, `staleReason: 'go-changed'` | None. |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None. The implementation is exceptionally clean, robust, and safe.

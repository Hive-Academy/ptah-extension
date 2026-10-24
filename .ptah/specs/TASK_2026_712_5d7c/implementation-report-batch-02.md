# Implementation report — Batch 2

Status: **NOT COMPLETE**. Declaration-only source for Task 2.1 is written under SEQ-B02. No typecheck, lint, test, or diagnostics command was run. Batch 2 is not accepted. P1-A is not accepted. No phase, host, release, compatibility, or rendered claim is made. `batches.md`, `decisions.md`, the task carrier, and Batch 1 files were not edited. No commit was created. SEQ-B02 authorizes no Batch 3–43.

## Executor

- Family: xAI
- Model: Grok 4.7
- Lane tools: `ptah_*` MCP tools were not listed. `search_tool` returned the `tasks` server only. Native reads and edits were used. `ptah_agent_report` is not registered, so this file is the handoff.
- Checks: none. The parent owns serial verification. Interim command, not run here: `npx nx typecheck @ptah-extension/auth-providers-tokens --parallel=1`. Full host command remains held.
- Git: read-only `rev-parse`, `diff --stat`, and `hash-object` without `-w`. No stage, commit, push, or stash.

## Checkpoint

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`
- Task: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/.ptah/specs/TASK_2026_712_5d7c`
- HEAD: `0fc0c3a09d104517e4a19a7ece73ddcc0ed788d1` (unchanged)
- Batch 1 / Task 1.1 remain IN_PROGRESS. B01-V2 remains NOT ACCEPTED. COMPLETE count is not changed by this lane.
- This is an interim declaration record only. Typecheck was not run, so it is not an interim passing checkpoint.

### Batch 1 inputs (unchanged)

Git blobs match B01-V2 before and after this lane's edits. `git diff --stat` still shows the pre-existing Batch 1 tracked additions in `libs/shared/src/index.ts` and `libs/shared/src/schemas.ts` (one line each versus HEAD). This lane did not rewrite them.

| Path | Git blob |
| --- | --- |
| `libs/shared/src/index.ts` | `f9576b99890b669535344ee873ae47945b89f630` |
| `libs/shared/src/schemas.ts` | `687ae01a1755689d89b76222f5672dbccdd80177` |
| `libs/shared/src/lib/types/provider-account.types.ts` | `44a71bd5b7c0f7b70295980fc2020760adf84ecc` |
| `libs/shared/src/lib/types/provider-account.schemas.ts` | `7d6c48d1963a42c3ddf6f3113f3020e372f9a8b6` |
| `libs/shared/src/lib/types/provider-account.schemas.spec.ts` | `e038c7010dc6cc4a20acadadeb45bb41bb43a70c` |

### Owned hashes

| Path | Input blob | Output blob |
| --- | --- | --- |
| `libs/backend/auth-providers-tokens/src/index.ts` | `2574f6a7bedc74d48649485958a0987247f38343` | `83616178020b8991abc495fd07d1b1c1afa7c754` |
| `libs/backend/auth-providers-tokens/src/lib/tokens.ts` | `4b46ab12488d8996d7f85c9c881764b1933f834f` | `a03c1a8fbbfa77e30b2549a95832029004a3ad65` |
| `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts` | absent | `165277f7bb773cca5b7dffa289f4f2a521c39935` |

The port file is untracked. `git diff` does not show it. The blob above is its content hash, not a stored object (`hash-object` without `-w`).

## What was written

Backend contracts and two `Symbol.for` identifiers only.

- `ClaudeAccountRoute` is a closed readonly union of ambient and named. Named `provider` is the literal `'claude'`. Named fields are `profileId`, `canonicalConfigDir`, `routeFingerprint`, `routeRevision`, `authEpoch`, and `runId`. There is no index signature and no environment bag.
- Both route members require `claudeAccountRouteCertification`, an `export declare const` unique symbol with no runtime value. The package barrel does not re-export that symbol. A plain object is not assignable. Holding or asserting the symbol is not admission. `admitClaudeRoute` accepts `ClaudeAccountAdmissionRequest` (shared selection, scope, operation id, run id) and does not accept a route.
- `ClaudeAccountResolvedResourceContext` is a closed ambient/named union. Ambient carries the certified route and no caller path. Named adds `accountDataDir` and `ClaudeAccountFilesystemIdentity` (`volumeId`, `fileId`). The Claude directory stays on the named route.
- Run reservation phases are `reserved`, `released`, and `retained`. Release reasons are child close, startup failure, cancel, abort, timeout, and disposal. `retainUnresolvedReservation` has no age, PID, or replacement-owner field. Release and retain carry `reservationId`, `operationId`, and `authEpoch` as lookup keys.
- `ClaudeAccountAuthOperationReservation` is the exclusive auth lease shape. No port method accepts it back from a caller. `ProviderAccountActionPort` exposes `readStatus`, `startSignIn`, `cancelSignIn`, and `signOut`. Results are `ProviderAccountActionResult` (code and summary only).
- Tokens appended on the existing object: `SDK_PROVIDER_ACCOUNT_ADMISSION` = `Symbol.for('SdkProviderAccountAdmission')`, `SDK_PROVIDER_ACCOUNT_ACTIONS` = `Symbol.for('SdkProviderAccountActions')`. Existing keys and their order are unchanged. Nothing registers or resolves them.
- The tokens barrel re-exports the port types with `export type` only. It does not import `zod` or `@ptah-extension/auth-providers`. The shared main barrel was not edited and stays zod-free.

Refusal codes reuse `ProviderAccountResultCode` except `'ok'`. This file does not validate summaries.

## Decisions

1. **Brand the route with an exported ambient unique symbol, and do not put that symbol on the package barrel.** Options: a plain structural union (any caller could build a named route), a runtime factory (forbidden by SEQ-B02), or a private unique symbol (declaration emit cannot name it; `tsconfig.lib.json` has `"declaration": true`). Evidence: plan lines 117–120 and batches.md Batch 2. Reversible before an implementation asserts the brand.
2. **Import shared selection, scope, action result, and result-code types from `@ptah-extension/shared` with `import type`.** Options: copy the unions in this package, or deep-import `provider-account.types`. Evidence: Batch 1 already exports those types from the zod-free main barrel (`libs/shared/src/index.ts`); module-boundary tags allow `scope:extension` / `type:core` to depend on `scope:shared` / `type:util`. Reversible.
3. **Keep the carrier Claude-only.** No Codex route, no `AuthEnv`, no UI route type. Evidence: plan line 119 and the batch boundary. A later phase can add a separate route type.
4. **Split run release/retain from auth-operation lifetime.** Auth leases are described on `ClaudeAccountAuthOperationReservation` and held inside action methods. They have no public acquire or steal method. Evidence: plan lines 135–136; decisions.md fail-closed reservation rule. Reversible when the action implementation is assigned.

## Preserved behavior

No consumer, registration, host file, migration, tuple, or environment helper was edited. Existing `AUTH_PROVIDERS_TOKENS` members are unchanged. Ambient routing behavior is unchanged because nothing reads these types yet.

## Unresolved holds

- Batch 1 is not accepted. Shared vocabulary passed its own B01-V2 typecheck/lint/test (122 suites / 3748 tests, as recorded in `batches.md`). That record is not re-verified here.
- Historical host failures are not baseline-proven, not waived, and not passed. Webview lint cycle, `marked` mapping, missing dist artifacts, and Electron install metadata stay outside this batch.
- Required later checks, not run: token `tsc --noEmit`, then `Verify-ProviderAccountsBatch` for `@ptah-extension/auth-providers-tokens` and the five hosts. Four host test targets need builds. Those builds are not authorized. Direct Jest is not a substitute.
- Structural typing is not admission certification. A future cast inside the admission implementation is still required after real validation. This declaration does not provide that validation.
- A1–A4 installed compatibility, abandoned-reservation recovery, subscription release, and Electron dark/light rendered evidence remain open.
- No dependency cycle was executed or measured. The new type-only import points at `@ptah-extension/shared`. Shared does not import this package. That is source inspection only.

## Stop

Return to the team-leader. Do not dispatch Batch 3 or register these tokens until a later sequencing decision and the open gates are handled.

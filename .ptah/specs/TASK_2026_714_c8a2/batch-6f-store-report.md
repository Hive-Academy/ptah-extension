# Batch 6f STORE report

## Item status

All source references below are in `libs/backend/agent-sdk/src/lib/`.

| Item | Status | Evidence |
| --- | --- | --- |
| 1 / Style B1 | Fixed | session-metadata-store.ts:888 reads repository detail through validateAccountLinkage; removed the double cast. |
| 2 / Style S4 | Fixed | session-metadata-store.ts:123 exports CodexSessionMetadataError; update and save refusal sites use it (:900, :906, :929, :942, :948, :990, :1000, :1006). |
| 3 / M5, decision 8 | Fixed | session-metadata-store.ts:875 determines created/updated inside the serialized write; :971 emits after that write and its explicit durable flush resolve. Failed writes emit nothing. Specs :2231, :2305. |
| 4 / Windows listing | Fixed | session-metadata-store.ts:1266 normalizes both workspace comparison operands using the existing permissive normalizeWorkspaceId helper (:319), extended with Windows case folding and trailing-slash removal. Win32 casing, separators and trailing slash regression specs at session-metadata-store.spec.ts:2257 cover sync and async storage. |
| 5 / Resume detail and totals | Fixed | session-metadata-store.ts:957 spreads existing detail; :964 preserves accumulated cost and tokens. Working directory, resumable subagents and child references survive updates. Sync/async regression specs :2206. |
| 6 / Alias | Fixed | session-metadata-store.ts:1051 names the persistMetadata parameter metadata and uses it directly throughout. |
| 7 / SessionId | Fixed | session-metadata-store.ts:876 uses SessionId; mismatched-id spec calls now construct the branded type. WIRING lane was notified. |
| 8 / Normalization ownership | Fixed in owned scope | Store continues normalizing runtime writes and now list comparisons. Removal of the registration-layer duplicate belongs to WIRING; no DI files edited. |
| 9 / Invariants | Preserved | Existing Codex account linkage is rejected at :905; save rejects account linkage at :1005; legacy conversion refused at :899. preservedIndexEntry and its flush use remain at :447 and :1135. Account-binding spec file unchanged. |

## Error contract

`export class CodexSessionMetadataError extends Error`, with `name = 'CodexSessionMetadataError'` and constructor `(readonly code, message: string)`.

Codes: `legacy-conversion`, `invalid-identity`, `binding-change`, `storage-unavailable`, `direct-runtime-write`, `account-linkage`.

Underlying storage failures retain their original error; the coded storage-unavailable refusal denotes an inaccessible workspace. Repository account parsing retains the existing SessionAccountBindingError contract.

## Changed absolute paths

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/session-metadata-store.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6f-store-report.md

## Verification

Both owned source/spec files formatted with node_modules/.bin/prettier --write.

Initial scoped ptah_get_diagnostics requests reported:

> Source: typescript-compiler ? Unavailable
> 2 typescript files ? TypeScript check unavailable: TypeScript check still running after 45s. It was not cancelled ? retry shortly and the completed result is served from cache.

Final scoped ptah_get_diagnostics after the workspace helper correction completed:

> Source: typescript-compiler
> Coverage: clean
> Requested files: No diagnostics in the requested files.
> Errors: 18 | Warnings: 0

All 18 errors were in sibling files owned by other lanes: index.ts (2), codex-chat-adapter.spec.ts (1), codex-chat-adapter.ts (1), di/register.codex-runtime.spec.ts (9), di/register.ts (5). They concern concurrent export/interface changes, missing listModels/cancel members, and lookup wiring. No diagnostics in either owned file.

Single scoped test command launched:

`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=session-metadata-store`

The command was launched once and remains running as native execution session 79972. Its filtered tail produced no output during the completion wait:

> wall_time_seconds: 300.0121515
> session_id: 79972
> output: ""

No test pass or failure is claimed. The machine-wide FIFO lock may be delaying execution; because the command is tail-filtered, lock messages are not visible until it exits. No rerun was started. The team leader must collect/perform authoritative verification, including the unchanged account-binding spec. The final workspace comparison correction occurred while this invocation was active, so a completed result must also be checked against the final files.

## Decisions

1. Compare normalized workspace keys in fallback listings rather than changing top-level Codex workspace storage. Options: preserve raw top-level paths or normalize comparison. Evidence: Claude create/save preserves caller paths; fallback listing already compares separator-normalized paths; existing Codex rows contain canonical keys. Normalized comparison covers existing persisted rows and differently cased Claude paths without rewriting either. Windows comparison is case-insensitive; non-Windows comparison remains case-sensitive. The permissive store helper accepts legacy paths; strict normalizeCodexWorkspaceKey remains only on native identity writes. ptah_code_search_symbols returned zero hits, so one native search located the strict helper and confirmed that it must not validate general list inputs. Reversible localized comparison change.
2. Preserve existing detail by spreading it before updating identity/activity fields, with totals defaulted only when absent. Options: enumerate every retained field or preserve the existing detail. Evidence: saveResumeState writes workingDirectory/resumableSdkSubagents and ordinary save preserves those fields; prior reconstruction lost them. Existing account linkage is refused before spreading. Reversible localized implementation.
3. Keep parser errors and underlying I/O errors intact; use the six agreed codes for explicit Codex refusal branches. Evidence: existing validateAccountLinkage and storage failure propagation contracts. No new wrapper obscures account-validation or disk errors. Reversible, additive error class.

No git commands, changes to other lanes, or account-binding-spec edits were made.

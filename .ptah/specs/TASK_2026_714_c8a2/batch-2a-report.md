# Batch 2a report

Implemented Tasks 2a.1 and 2a.2. Production routing remains disabled. No git commands, dependency installation, real evidence harness, or out-of-scope source edits were performed.

## Files

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat.

- libs/backend/codex-runtime/src/lib/codex-runtime.types.ts: readonly execution profile, identity, turn/settings, approval, usage, event and runtime/context contracts.
- libs/backend/codex-runtime/src/lib/codex-account-usage.types.ts: credential-free eligibility and the existing account-usage DTO shape, preserved for the later auth-providers re-export.
- libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts: executable pin, approval presentation, identity persistence, clock and sanitized logger ports; public platform-core IProcessSpawner re-export.
- libs/backend/codex-runtime/src/lib/codex-home-auth-reader.ts: home-scoped credential reader and disposable credential-free change notifications.
- libs/backend/codex-runtime/src/lib/di/tokens.ts: Symbol.for tokens, no container registration or resolution.
- libs/backend/codex-runtime/src/index.ts: type-only exports and DI tokens only.
- .ptah/specs/TASK_2026_714_c8a2/batch-2a-report.md: this handoff.

## Key contracts

References are relative to libs/backend/codex-runtime/src/.

- lib/codex-runtime.types.ts:63: nested readonly profile includes policy, prompts, instruction sources, MCP auth references, attachments and explicit lane restrictions. Runtime validation/deep freezing belongs to the later profile-builder batch.
- lib/codex-runtime.types.ts:92: all seven thread identity fields; resume identity cannot be patched through turn settings (:112).
- lib/codex-runtime.types.ts:125: only accept, acceptForSession, decline, cancel. Preceding JSDoc explicitly documents edit = decline + follow-up, not Claude updatedInput.
- lib/codex-runtime.types.ts:135: all five approval kinds, including mcpElicitation; correlation includes context, process generation, thread, turn and request.
- lib/codex-runtime.types.ts:147: reported usage counters are optional, never defaulted to zero.
- lib/codex-runtime.types.ts:169: discriminated ordered events, stable tool IDs, sanitized error contract, approval and terminal events.
- lib/codex-runtime.types.ts:239: CodexContext includes steer alongside startTurn and interrupt.
- lib/codex-runtime-ports.ts:23: exact sink return contract including decline/editNotSupported.
- lib/codex-runtime-ports.ts:33: persistence precedes first turn; markInactive requires full-identity comparison to protect newer generations.
- lib/codex-home-auth-reader.ts:10: normalized-home methods; watch returns platform-core IDisposable and never exposes credentials.

## Verification

Required scoped command executed once, using PowerShell Select-Object -Last 30 as the equivalent of tail -30:

`npx nx run-many -t test typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`

Exit 0. Nx reports all 3 targets successful, 0/3 cache hits, duration 49.6 seconds.

- Tests: 275 passed, 275 total; 3 suites passed, 3 total; 0 snapshots. The shared project includes parallel-lane additions alongside the existing 175 tools tests. Counts recovered from the saved run output at C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/3584245307479115065 without rerunning tests.
- Typecheck: passed.
- Lint/module boundaries: passed, 0 errors. Three existing evidence-harness.ts warnings: max-lines (:739), preserve-caught-error (:1737), no-useless-assignment (:2232). Platform-core edge accepted.
- Scoped ptah_get_diagnostics before Nx: 0 errors, 0 warnings, clean coverage.
- Then npx prettier --write completed on all six changed TypeScript files. No semantic edits followed verification.
- Jest output also reported its TypeScript config module warning, an OS-forbidden symlink fixture, and a worker forced-exit/teardown warning. No tests failed. No follow-up test execution or real harness run was performed.

## Decisions

1. Preserve the account DTO structurally instead of importing auth-providers. Options: dependency reversal or core-owned compatible types. Evidence: plan dependency direction (:29), existing codex-provider.types.ts:87-107 and eligibility signature (:59). Reversible: yes; later batch 3b owns the compatibility re-export.
2. Use readonly nested contracts now and defer runtime freezing/validation to the planned profile builder. Options: implement builder now or keep this batch contracts-only. Evidence: batch 2a ownership and plan :97. Reversible: yes; no runtime profile construction is introduced.
3. Reuse platform-core IProcessSpawner and IDisposable via its public alias. Options: reuse the platform ports or duplicate them. Evidence: batches assumption A2, platform-core public index and process-spawner.interface.ts:126. Reversible: yes; lint verifies the permitted edge.
4. Represent executable identity with the reviewed manifest row fields, excluding its developer diagnostic binaryPath. Options: portable expected pin or a machine-path identity. Evidence: plan :126 and the checked-in manifest. Reversible: yes; Batch 2b owns protocol validation.
5. Keep all initialization/routing/registration absent; export only types and tokens. Evidence: Batch 2a index ownership and production-routing prohibition. No behavioral capability is enabled.

No blocked implementation work remains in this batch. Runtime enforcement, policy mapping, persistence implementations, protocol validation and auth ownership remain with their assigned later/parallel batches.

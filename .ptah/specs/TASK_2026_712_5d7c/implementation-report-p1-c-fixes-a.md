# P1-C fixes — lane A (output styles)

Implemented findings 1, 2, 3 and the output-styles portion of finding 4 for TASK_2026_712_5d7c.

## Changes by finding

- **F1:** `libs/backend/output-styles/src/lib/output-style-discovery.service.ts:201` accepts the account context when producing display paths. Named user files use `account:output-styles/<file>`; ambient paths remain unchanged. Invalid named user rows have `openable: false` (:353). Valid rows use the existing `editable: false` contract with an explanation (:363), since their contract has no `openable` property. Project rows retain their workspace behavior. `output-style-file.writer.ts:191,506` passes context through save and located-file paths (including stat, rename and delete). Regression coverage: `output-style-account-context.spec.ts:104`.
- **F2:** `output-style-discovery.service.ts:114` adds `boundOutputStyleDirectory`, canonicalizing the account root and styles directory and rejecting parent/sibling/absolute-relative escapes with `OutputStyleAccountResourceError`. Discovery invokes it before directory I/O (:263); writer directory resolution invokes it before save/stat/delete or lookup (:415). Reads/writes use the resolved directory. A genuinely absent styles directory remains supported; lstat distinguishes a dangling symlink and refuses it. The writer preserves its existing typed NOT_FOUND boundary response. Regression coverage: `output-style-account-context.spec.ts:150,176` tests all entry points, zero content-port I/O on refusal, real junction escape to a sibling, an internal target, dangling links and an absent directory.
- **F3:** `output-style-session-activation.service.ts:91,178` adds `outputStyleUnavailable?: true`. A globally selected style absent in a named account returns no activation fields plus this marker and emits one fixed-text warning per resolution. Invalid account roots still reject; ambient selection behavior remains unchanged. Regression coverage: `output-style-account-context.spec.ts:337,349`.
- **F4:** `output-style-discovery.service.ts:163,312,329` logs a structurally read, constrained filesystem code and basename for named directory/file read failures, never the raw message. Unknown codes become UNKNOWN. Writer failure logs also suppress raw filesystem error messages for named contexts. Regression coverage: `output-style-account-context.spec.ts:213` uses a plain cross-realm-shaped error object containing a private path and asserts sanitized log payloads.

## Verification

Final `ptah_get_diagnostics` scoped to the four changed TypeScript files: **0 errors, 0 warnings**, source `typescript-compiler`, coverage `clean`. An earlier diagnostic pass found two missing context parameters; corrected before the final clean pass. Formatting applied with Prettier's API (an initial shell quoting error was corrected).

No nx, Jest, tsc, lint, build, serve, e2e, package or git command was run. Regression specs were added but not executed, as instructed; CI owns execution.

## Decisions

1. **Use a local Node canonicalization helper; no port edits.** Options: add a cross-platform realpath port method or use the explicitly authorized local helper. Evidence: `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:17` offers stat but no realpath, and stat cannot establish a symlink's target. `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:75` provides the boundPath containment pattern. Chosen: `node:fs` promises realpath plus lstat only in the discovery module's shared helper; content operations remain through the existing port. Reversible: helper internals can move to a future realpath port without changing callers.
2. **Preserve absent-directory behavior and typed writer errors.** Options: reject all realpath ENOENT results or distinguish absence from dangling links. Evidence: existing discovery treats absent output-styles as normal, and the file-system write contract creates parent directories. Chosen: require the canonical account root to exist, then permit only genuine styles-directory absence; retain the writer's NOT_FOUND result contract. Reversible without a public signature change.
3. **Expose an additive unavailable marker, not an exception for a missing global preference.** Options: rely on a later launcher catch or return explicit service data. Evidence: this fix request and the activation service's preference fallback contract. Chosen: outputStyleUnavailable: true with no outputStyleName/outputStyleBody and one fixed warning per call. Invalid roots still refuse. Reversible/additive; callers may show the marker without parsing logs.
4. **Use existing row capabilities.** Options: change shared contracts/host consumers or disable opening through existing fields. Evidence: OutputStyleEntry has editable while InvalidOutputStyle has openable; shared contracts and UI files are outside ownership. Chosen: disable named user-row editing/opening only; workspace project rows stay editable. Explicit context-aware writer APIs remain functional. Reversible when account-aware editor routing is delivered.

## Not done

- CI test execution, per instruction.
- Caller UI rendering of outputStyleUnavailable; the marker is provided for the subsequent caller integration batch.
- Findings outside the assigned output-styles scope. No agent-sdk files or filesystem port files were edited.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/output-styles/src/lib/output-style-discovery.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/output-styles/src/lib/output-style-file.writer.ts`
- `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/output-styles/src/lib/output-style-session-activation.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/output-styles/src/lib/output-style-account-context.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/.ptah/specs/TASK_2026_712_5d7c/implementation-report-p1-c-fixes-a.md`

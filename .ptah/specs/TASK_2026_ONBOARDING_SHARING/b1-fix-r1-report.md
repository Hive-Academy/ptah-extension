# B1 backend revision, round 1

## Defect fixes

1. Root ignore matching: [analysis-fingerprint.ts:79](../../../libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts) parses ordered root rules with `picomatch`, including anchored paths, directory patterns, globs, negation, comments, and escaped leading `#`/`!`. [analysis-fingerprint.spec.ts:36](../../../libs/backend/agent-generation/src/lib/services/analysis-fingerprint.spec.ts) covers a clone missing local folders and negation/escaped names.
2. Nontransported directories: [analysis-fingerprint.ts:136](../../../libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts) omits empty top-level folders and folders with only directly ignored children. The scan is bounded to one level; nested `.gitignore` files and deeper empty trees are not inspected. The clone spec above covers empty `logs/` and ignored-only `log-cache/`.
3. Sharing visibility: [analysis-freshness.service.ts:68](../../../libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts) reports whether root rules ignore analysis files, including parent-directory ignore behavior. [analysis-freshness.service.spec.ts:150](../../../libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts) covers `.ptah`, `.ptah/`, `.ptah/**`, `/.ptah`, and exceptions. The user's root ignore file is untouched.
4. Linker races: [analysis-claude-md-linker.ts:18](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts) queues each workspace's link calls and compares the file again before writing. [analysis-claude-md-linker.spec.ts:88](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.spec.ts) covers concurrent calls and an editor save.
5. Linker cost: [analysis-claude-md-linker.ts:72](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts) sorts completed candidates by manifest date, then hashes only candidates until the latest valid one. [analysis-claude-md-linker.spec.ts:60](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.spec.ts) asserts that the older run's phase files are not read.
6. Dead arguments: [analysis-claude-md-linker.ts:29](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts) takes only the workspace path. Completion and load call sites now pass that path; [setup-rpc.handlers.spec.ts:1109](../../../libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts) asserts it.
7. Git attributes: [analysis-storage.service.ts:238](../../../libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts) scopes LF to `manifest.json` and `*.md`; [analysis-storage.service.spec.ts:168](../../../libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts) asserts the exact content.
8. Slug safety: [analysis-claude-md-linker.ts:51](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts) rejects unsafe directory names before importing; [analysis-claude-md-linker.spec.ts:76](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.spec.ts) covers a hand-created slug with a space.
9. Line endings: [analysis-claude-md-linker.ts:95](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts) chooses the dominant file EOL; [analysis-claude-md-linker.spec.ts:108](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.spec.ts) covers one stray CRLF in an LF file.
10. Old status reason: [wizard-generation-rpc.handlers.spec.ts:1752](../../../libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts) uses `workspace-changed`.

## Contract changes

- [rpc-setup.types.ts:176](../../../libs/shared/src/lib/types/rpc/rpc-setup.types.ts): optional `AnalysisStatus.sharing` is `shareable | ignored-by-gitignore | unknown`. Unknown means the root ignore file could not be read. Missing `.gitignore` is shareable.
- [analysis-claude-md-linker.ts:29](../../../libs/backend/agent-generation/src/lib/services/analysis-claude-md-linker.ts): `link(workspaceRoot)` replaces the unused slug and phase-file arguments.
- [package.json](../../../libs/backend/agent-generation/package.json): declares existing root dependency `picomatch` in the consuming project for Nx dependency checks.

## Verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/shared`: final run passed with `NX   9 tasks: 9 succeeded, 3 cached`. The first run failed with `NX   9 tasks: 5 succeeded, 4 failed` due to TS7022 in `analysis-fingerprint.ts:116`; an explicit `boolean` annotation fixed it. The second run reported `NX   9 tasks: 8 succeeded, 3 cached, 1 failed`. Jest exposed an escaped `\!` pattern bug; retaining its escape fixed it. The linker spec also called its own file-system mock recursively and exhausted a Jest worker's heap; it now captures the original mock implementation.
- Focused `npm run verify -- -t test -p @ptah-extension/agent-generation -- --runInBand --runTestsByPath src/lib/services/analysis-fingerprint.spec.ts src/lib/services/analysis-claude-md-linker.spec.ts`: `NX   1 task: 1 succeeded`.
- Two preparatory focused attempts each reported `NX   1 task: 0 succeeded, 1 failed`: the first used workspace-relative test paths where Jest needed project-relative paths; the second was stopped after the recursive test mock exhausted memory. Both issues were corrected before the passing focused run.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-tui`: `NX   3 tasks: 3 succeeded`.
- `npm run verify -- -t lint -p degradation-audit`: `NX   1 task: 0 succeeded, 1 failed`. The sole new finding is `libs/frontend/chat/src/lib/services/composer-attachments.service.ts:91 [orphaned-suppression]`; `libs/backend/agent-generation`, `libs/backend/rpc-handlers`, and `libs/shared/src` match their baselines. The frontend file is owned by another lane and was not edited here.
- `git diff --check`: passed.
- Ptah scoped diagnostics were attempted twice but the service returned unavailable after 45 seconds each time. The scoped Nx typechecks above passed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `picomatch` for root ignore globs | `picomatch`, `minimatch`, custom regex | Both libraries are installed; `picomatch` is already used in neighboring backend code. | Yes |
| Keep sharing information in status, without editing root ignore rules | Status hint, automatic root ignore edit | The coordinator already added scoped exceptions; other workspaces may keep their own rules. | Yes |
| Scan only direct children when deciding whether a top-level directory is transportable | One-level scan, deeper walk | Fingerprints must stay bounded; the review explicitly permits a shallow check. | Yes |
| Link the latest valid completed run | Requested run, latest valid | Existing contract and review call for the latest run; load's old slug arguments were unused. | Yes |

## Remaining work

The frontend lane needs to attach or remove the orphaned degradation-audit marker at `libs/frontend/chat/src/lib/services/composer-attachments.service.ts:91`, then rerun `npm run verify -- -t lint -p degradation-audit`. No backend or shared verification failure remains.

The coordinator's root `.gitignore` exceptions and the parallel lane's `libs/frontend/**` changes were already present in this worktree. This lane did not edit them.

Skill discovery was not exposed by this Codex lane. I located and read the repository's orchestration skill directly; no UI skill applies to this backend-only revision.

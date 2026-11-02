# B1 backend report

## Files changed

- `libs/backend/agent-generation/src/lib/services/`: `analysis-fingerprint.ts`, `analysis-freshness.service.ts`, `analysis-storage.service.ts`, new `analysis-claude-md-linker.ts`, and their specs.
- `libs/backend/agent-generation/src/lib/services/wizard/`: `analysis-run-checkpoint.ts`, `multi-phase-analysis.service.ts`, and the multi-phase spec.
- `libs/backend/agent-generation/src/lib/di/`: `tokens.ts`, `register.ts`; `libs/backend/agent-generation/src/index.ts`.
- `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`.
- `libs/backend/rpc-handlers/src/lib/handlers/`: setup, harness, and workspace RPC handlers and their specs.
- `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts` for pinned-root emptiness checking.
- `libs/shared/src/lib/types/rpc/`: `rpc-setup.types.ts`, `rpc-harness.types.ts`.
- This report.

The concurrent frontend lane changed `libs/frontend/**`; I did not edit those files. The task specs were untracked before this lane began.

## Contract changes

- Workspace fingerprints default to `sha256-v2`: sorted eligible root directory names plus LF-normalized bytes of root metadata files. Root `.gitignore` literal `name` and `name/` entries exclude directories. `sha256-v1` remains available for old manifests.
- Freshness no longer expires on elapsed time. It checks the manifest's recorded algorithm and accepts raw or LF-normalized phase hashes. `analyzedAt` remains in the status response; `expired` is removed from its reason union.
- Completed analyses write LF phase markdown and create `.ptah/analysis/.gitignore` and `.gitattributes` only when absent. Sharing-file write errors warn without failing completion.
- `AnalysisClaudeMdLinker` maintains one latest valid completed run in the root `CLAUDE.md` marked block. It preserves outside text and the file's EOL style. Malformed markers and I/O failures return an error without writing; callers log it.
- `wizard:load-analysis` links a completed run. `workspace:addFolder` allows `createDirectory`. `harness:initialize` returns `workspaceEffectivelyEmpty` for the pinned root; a failed hint check returns `false` and logs a warning. The project-profile citation now names `01-project-profile.md`.

## Verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/shared`: `NX   9 tasks: 8 succeeded, 1 failed` (`@ptah-extension/rpc-handlers:test`). The saved Jest log showed two spec compile errors: the setup mock token list lacked `ANALYSIS_CLAUDE_MD_LINKER`, and the new harness assertion accessed an `unknown` result. Both were fixed.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers`: `NX   1 task: 1 succeeded`.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-tui`: `NX   3 tasks: 3 succeeded`.
- `npm run verify -- -t lint -p degradation-audit`: `NX   1 task: 1 succeeded, 1 cached`.
- `git diff --check`: passed.
- Ptah scoped diagnostics were unavailable after a 45-second TypeScript timeout; `npm run verify` is the fallback.
- Independent read-only review completed. Its CRLF resume finding was fixed; the root Git ignore and nested-source findings are recorded below.

## Decisions

- **A1 sharing files:** Decision: create each file only when absent. Options: preserve user rules or overwrite them. Evidence: the plan names those files and the storage service owns analysis I/O. Reversible: remove the writer; existing user files stay intact.
- **A2 fingerprint:** Decision: filesystem v2 with a literal root `.gitignore` filter. Options: filesystem metadata or `git ls-files`. Evidence: no Git port exists in agent-generation and the plan requires use outside Git repositories. Reversible: manifests carry the algorithm, so another version can be introduced.
- **A3 freshness:** Decision: no wall-clock expiry. Options: retain the seven-day cutoff or rely on fingerprint and output hashes. Evidence: those hashes directly test the state, and a 30-day-old matching run is covered by a spec. Reversible: a separate age warning can be added without invalidating manifests.
- **A4 EOL:** Decision: byte-preserving CRLF normalization for metadata and phase comparisons. Options: raw-byte-only or EOL-tolerant hashes. Evidence: binary lockfiles must retain non-EOL bytes; CRLF copy specs cover freshness and resume. Reversible: algorithm versioning isolates metadata behavior.
- **A5 linker:** Decision: a dedicated DI service maintains a marked block in root `CLAUDE.md`; malformed markers return an error. Options: block editing or HarnessConfigStore's whole-file writer. Evidence: the plan requires preserving outside text. Reversible: removing the block and service does not change analysis artifacts.
- **Pinned emptiness:** Decision: pass the resolved pinned root to the existing emptiness service. Options: check the active root or the requested root. Evidence: the handler can initialize a non-active open folder. Reversible: its optional argument preserves old no-argument calls.

## Anything not done

- This repository's root `.gitignore` has `.ptah/**`; Git ignores `.ptah/analysis` even with nested sharing files. The explicit B1 scope excludes changing the root `.gitignore`. `git check-ignore -v --no-index` confirmed this; the parent task needs a scoped root ignore exception or an explicit force-add policy before this repository can share analysis files normally.
- The existing emptiness heuristic checks source files only one directory below the root. A deeper source tree without a manifest can still be reported as effectively empty; that heuristic was outside component 3's requested field wiring.
- The shared response is now required by type. The frontend lane owns any fixture updates in `libs/frontend/**`; this lane did not edit them.
- No applicable backend skill was discoverable in the available CLI skill inventory. No commits, pushes, or cleanup actions were performed.

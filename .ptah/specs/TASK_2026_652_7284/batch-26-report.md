# Batch 26 — generation output and analysis freshness

## Write targets traced

| Workspace target | Writer and call path |
| --- | --- |
| `.ptah/analysis/<slug>/{phase files,manifest.json}` | `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:193,229-230,314-315`; root is defined at `:97-98`. |
| `.ptah/analysis/<slug>/generation-manifest.json`, or `.ptah/analysis/generation-manifest.json` without a slug | `analysis-storage.service.ts:162-169,527-534`; wizard checkpoint calls it at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:163-167,272-276`. |
| `.ptah/analysis/<slug>/enhanced-prompt.md` and `enhanced-prompt.json` (or directly under `.ptah/analysis`) | `analysis-storage.service.ts:595-607`; enhanced-prompt generation calls it at `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:558`. |
| `.claude/agents/<agent-id>.md` | `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:420-424,792,874`; `file-writer.service.ts:228,341`; wizard output directory at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:104-105`. |
| `.codex/agents/*.toml`, `.github/agents/*.agent.md`, `.cursor/agents/*.md`, `.opencode/agent/*.md`; `.agents/skills`, `.github/skills`, `.cursor/skills`, `.cursor/commands` | Wizard propagates after a write at `wizard-generation-rpc.handlers.ts:509,1088-1102`; target paths are documented in `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:13-17,120,137,161-162`. These are conditional on installed targets and sync policy. |
| `.vscode/mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.mcp.json`, `opencode.json` | Conditional harness propagation at `wizard-generation-rpc.handlers.ts:1088-1102`; path definitions at `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.registry.ts:79,88,107,118` and `codex-toml-mcp-facet.ts:108-115`. |
| `.gitignore` managed block | Conditional harness reconcile after wizard propagation; `libs/backend/harness-sync/src/lib/gitignore/gitignore-writer.ts:130,200-208`. |

`content-generation.service.ts:198-273` generates text in memory; the orchestrator writes it. The wizard generation handlers and supervisor have no direct `writeFile` or `createDirectory` calls. No inspected generation flow writes root `CLAUDE.md` or `AGENTS.md`.

## Decisions

- Excluded `.claude`, `.codex`, `.github`, `.cursor`, `.opencode`, `.agents`, and `.vscode`, plus root `.gitignore`, `.mcp.json`, and `opencode.json` in `analysis-fingerprint.ts:39-50`. `.ptah` was already excluded. These names can be created or rewritten by the generation and propagation flow. A user-authored `.github` or `.gitignore` can be a project input, but generated writes make its top-level presence unsuitable as a freshness signal. The fingerprint hashes only the names and types of non-metadata entries, not their contents (`analysis-fingerprint.ts:81-95`). This choice is reversible.
- Kept `sha256-v1` (`analysis-fingerprint.ts:89,98`).
- Did not cache freshness once per run. Status is currently resolved per template in `content-generation.service.ts:593`; run-scoped caching would change the content-generation interface, orchestration call chain, and tests. The output exclusions remove the observed same-run invalidation. The regression checks two successive content calls with a generated `.claude/agents` write between them (`content-generation.service.spec.ts:1672`).

## Verification

- `npx prettier --write` on the three changed source/spec files: passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`: both targets passed.
- `npx nx test @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`: 38 suites passed; 1,292 tests passed, 1 skipped, 1,293 total. The new fingerprint spec covers all seven directories and three root files; each case also detects a real `package.json` content change (`analysis-fingerprint.spec.ts:7-52`).
- Scoped `ptah_get_diagnostics` after the final edit: 0 errors, 0 warnings.

Nx printed a non-fatal Nx Cloud free-plan message after the successful local checks.

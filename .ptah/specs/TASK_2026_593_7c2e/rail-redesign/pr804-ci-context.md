# PR #804 CI repair

## Scope
Fix the failing Electron shard on existing branch fix/attention-coderabbit-followup at 04fd8e12db048c49b70912495f27739c1898cc30. Work only in this worktree. No commit, push, merge, or cleanup is authorized.

## Evidence
GitHub run 39533059655, job 119003251363: apps/ptah-electron-e2e/src/specs/git/spot-editor-save.spec.ts:289 cannot find alertdialog containing Discard unsaved changes? after Back. One failed test. Other shards and CI checks pass. Aggregate electron-e2e failure follows shard failure.
Log also records nonfatal header-caret focus timeouts in visual-review.spec.ts. Do not expand scope unless directly related.

## Execution
Minimal BUGFIX continuation of existing task. CLI lanes enabled by explicit /agent-lanes request. Codex is disabled. Glm (Ollama Cloud) implements, Grok independently reviews. Both limits are unknown, not confirmed room. Initial two calls, at most one correction/re-review pair. Maximum 40 tool calls per lane. No document plan gate for bounded bugfix.

## Decisions
- User-requested: repair CI on existing PR worktree, do not create a replacement branch.
- Project-rule: Electron first, memory-safe project-scoped checks, one heavy check at a time (CLAUDE.md).
- Evidence decision: investigate the one failed test before changing application code or CI configuration.
- Preserve all test assertions and application capabilities. No timeout increases, skips, retry masking, or weakened assertions.
- Do not run build, serve, dev, e2e, or package targets without explicit user permission. Run typecheck/lint and focused unit checks where applicable. Record unavailable runtime verification clearly.
- Source confirms an apply-time race in SpotEditorComponent.reload: a read can replace edits made during that read. CI watcher trigger remains unproven. Extend scope to that method and deterministic unit regression tests. Preserve explicit confirmed discard/reload and baseline semantics.
- Add one Glm frontend implementation call after diagnostic lane stopped at role boundary. Grok remains independent reviewer. No extra document gates for this bounded correction.

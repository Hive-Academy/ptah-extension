# PR #583 CodeRabbit Comments Lane Report

## Findings

Both review findings were verified against the codebase and resolved.

| id | still valid? | file:line | change |
| --- | --- | --- | --- |
| 1 | Yes | `libs/backend/agent-generation/templates/agents/visual-reviewer.template.md:261`<br>`.claude/agents/visual-reviewer.md:236` | Added report item `- Before/after comparison (no prototype): [for a no-prototype review, one entry per dark and light before/after screenshot pair (paths) with its comparison result, written even when there are no regressions]` under `## Prototype fidelity` in the Output contract. |
| 2 | Yes | `scripts/regen-agents.mjs:12,21-26,31` | Added `skipped` array and `isPtahOutput(cur)` check when target exists and content differs: skips writing non-Ptah output files (user-owned agents) and reports them in `SKIPPED (not Ptah output)` list while still writing missing targets. |

## isPtahOutput evidence

The `isPtahOutput` check in `scripts/regen-agents.mjs` directly mirrors the production harness reconciler:

1. **Port definition**:
   `libs/backend/harness-sync/src/lib/targets/transformers/agent-transformer.port.ts:75-76` defines `isPtahOutput(content: string): boolean`.
   `libs/backend/harness-sync/src/lib/targets/transformers/agent-transformer.port.ts:94-98` provides `hasPtahFrontmatterSignature(content: string): boolean` matching leading YAML frontmatter `source: ptah`.

2. **Transformer implementations**:
   - OpenCode transformer: `libs/backend/harness-sync/src/lib/targets/transformers/opencode-agent-transformer.ts:93-95` implements `isPtahOutput(content: string): boolean { return hasPtahFrontmatterSignature(content); }`.
   - Codex transformer: `libs/backend/harness-sync/src/lib/targets/transformers/codex-agent-transformer.ts:110-116` implements `isPtahOutput(content: string): boolean` checking `# source: ptah` marker or legacy predecessor keys (`name` and `developer_instructions`).

3. **Production writer rule in `WorkspaceHarnessTarget`**:
   - `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:472-479`: when target does not exist (`stat === null`), writes file (`reason: 'create'`).
   - `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:491-512`: when target exists, unowned in manifest, and content differs, checks `carriesWriterSignature(absolute, entry)` — if true, writes file (`reason: 'update', adopted: true`); if false, classifies as `foreign` and skips write.
   - `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:544-557`: `carriesWriterSignature` delegates directly to `transformer.isPtahOutput(await readFile(absolute, 'utf-8'))`.

In `scripts/regen-agents.mjs`, when `cur !== out`:
- If `cur !== null && !t.isPtahOutput(cur)`: the target exists on disk and is not Ptah output, so it is skipped and added to `skipped` without writing.
- Else: target is missing (`cur === null`) or is confirmed Ptah output (`t.isPtahOutput(cur)` is true), so it is added to `changed` and written when `--write` is specified.

## Generated files

1. Dry run of `node scripts/regen-agents.mjs`:
```text
WOULD CHANGE 2
.opencode/agent/visual-reviewer.md
.codex/agents/visual-reviewer.toml
```
0 skipped (`skipped.length === 0`). Only the two `visual-reviewer` target files were marked for changes.

2. Write run of `node scripts/regen-agents.mjs --write`:
```text
WROTE 2
.opencode/agent/visual-reviewer.md
.codex/agents/visual-reviewer.toml
```
Both files were regenerated through the harness transformers; neither was hand-edited.

3. Content manifest check:
Per step 3 ("only if a file under apps/ptah-extension-vscode/assets/plugins changed; otherwise run `node scripts/generate-content-manifest.js --check` and report"):
No files under `apps/ptah-extension-vscode/assets/plugins` were modified.
Ran `node scripts/generate-content-manifest.js --check`:
```text
content-manifest.json is stale.

  contentHash mismatch — file contents changed without regeneration.
    committed: sha256:fc1e77d13dd846abd81cb0d65c4782731a5ad291ae8bc6d95251efd6a293186f
    actual:    sha256:33850c65df177fc06ec4f2fe629047ae3f405f143b75de80858a3e0c1a85e504

A stale manifest is destructive: ContentDownloadService prunes local files
the manifest omits, so users LOSE content they already have.

Fix: npm run manifest:generate — then commit content-manifest.json.
```
Report: `--check` detected content drift because `generate-content-manifest.js` walks both plugin and template directories (`TEMPLATES_BASE_PATH = 'libs/backend/agent-generation/templates/agents'`) into its SHA-256 calculation. As instructed, `content-manifest.json` was not modified since no plugin files changed.

## Verification

1. **3-project test suite**:
`npx nx run-many -t test -p vscode-lm-tools agent-generation harness-sync --skip-nx-cache`
```text
 NX   --skip-nx-cache disables the connection to Nx Cloud for the current run.
The remote cache will not be read from or written to during this run.
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.sandbox-escape.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/services/providers/exa.provider.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts (27.611 s)
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/types/tool-parameters.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/session-aware-workspace-provider.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/json-namespace.builder.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/services/screen-recorder.service.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/workspace-root-resolver.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/services/providers/tavily.provider.spec.ts
PASS vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/diagnostics/diagnostics-cache-invalidator.service.spec.ts (31.976 s)

Test Suites: 52 passed, 52 total
Tests:       1207 passed, 1207 total
Snapshots:   0 total
Time:        39.457 s
Ran all test suites.

 NX   Successfully ran target test for 3 projects
```
Header confirmed 3 projects: all 3 projects passed on the first run with exit code 0.

2. **Git diff check**:
`git diff --check` exited with code 0 (no whitespace errors, no trailing whitespace, clean LF line endings).

3. **Line endings**:
All modified and generated files use pure LF (`\n`) endings.

4. **Rules hygiene**:
No lane rules added outside `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`. No git commit, push, branch, restore, reset, stash, or clean executed.

## Lane-introduced constraints

none

## git status

```text
 M .claude/agents/visual-reviewer.md
 M .codex/agents/visual-reviewer.toml
 M .opencode/agent/visual-reviewer.md
 M libs/backend/agent-generation/templates/agents/visual-reviewer.template.md
 M scripts/regen-agents.mjs
?? .ptah/specs/TASK_2026_533/pr-583-comments-lane-report.md
```

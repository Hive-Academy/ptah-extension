# Lane report — DOC_FILES widened with design-spec.md

## Changes

One file changed:

- `libs/shared/src/lib/types/task-spec.contract.ts:85` — added `'design-spec.md'` to `DOC_FILES`, after `'visual-design-specification.md'` and before `'design-handoff.md'`, next to the other design documents.
- `libs/shared/src/lib/types/task-spec.contract.ts:64-66` — added one bullet to the doc comment's list of admitted names, in the same style. The bullet cites `ui-ux-designer.template.md:104`, the row that writes `.ptah/specs/<TASK_FOLDER>/design-spec.md`, and states that orchestration checkpoints Gate 1.7 reads it before the next phase runs.

`visual-design-specification.md` stays in `DOC_FILES` (existing task folders may carry it). The guard test and every asset file are untouched.

## Tests touched

None. No test hard-codes the `DOC_FILES` list. Checked:

- `libs/shared/src/lib/types/task-spec.contract.spec.ts` — iterates `DOC_FILES` for `renderSpecsReadme` and `renderTaskSpecAgentBlock`; derives everything.
- `libs/backend/task-specs/src/lib/contract.guard.spec.ts` — builds `OWNED_FILENAMES` from `DOC_FILES`; no expected count.
- `libs/backend/task-specs/src/lib/task-index.service.spec.ts` — compares on-disk README against `renderSpecsReadme()` dynamically.
- `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts:435` — iterates `DOC_FILES`.
- `libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts:197` and `task-prompt-context.service.spec.ts:65` — use `DOC_FILES[0]` and `DOC_FILES[DOC_FILES.length - 1]` (`context.md` and `tasks.md`), both unchanged because the new entry sits mid-list.

## Generated files

None needed regeneration.

- Grepped `design-handoff.md` and `content-specification.md` across the repo (outside node_modules, including `.claude/`, `.codex/`, `.opencode/`, docs/, content-manifest.json). The `.claude/agents/*.md` and `.opencode/agent/*.md` mirrors contain `design-handoff.md` only as template-body prose, not as a rendered `DOC_FILES` list. No shipped file contains the rendered "Recognised documents" / "Read from a task folder" list — `TemplatePartialResolver` resolves that block at build time, and no `_shared/task-spec-contract.md` exists on disk.
- I changed no file under `apps/ptah-extension-vscode/assets/plugins` or `libs/backend/agent-generation/templates`, so the manifest content hash is unaffected. Verified: `node scripts/generate-content-manifest.js --check` reports `content-manifest.json is up to date (sha256:33850c65df177fc06ec4f2fe629047ae3f405f143b75de80858a3e0c1a85e504, 225 files).`

## Verification

Command run once from the worktree root:

`npx nx run-many -t test lint typecheck -p @ptah-extension/shared @ptah-extension/task-specs @ptah-extension/rpc-handlers @ptah-extension/tasks-ui`

Output tail:

```
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/task-specs:typecheck
√  nx run @ptah-extension/task-specs:lint
√  nx run @ptah-extension/task-specs:test
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:lint
√  nx run @ptah-extension/rpc-handlers:test
√  nx run @ptah-extension/tasks-ui:typecheck
√  nx run @ptah-extension/tasks-ui:test
√  nx run @ptah-extension/tasks-ui:lint

 NX  Successfully ran targets test, lint, typecheck for 4 projects

Output of 12 successful tasks were not shown. Run with --verbose or --output-style=static to see it.
```

12 of 12 tasks pass. The previously failing guard test `contract guard — asset document names › names only documents inside DOC_FILES (plus the carrier)` now passes with the two former offenders admitted.

## Lane-introduced constraints

none
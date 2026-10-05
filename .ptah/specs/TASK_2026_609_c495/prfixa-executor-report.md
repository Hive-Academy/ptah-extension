# PR-FIX-A executor report — TASK_2026_609_c495 (PR #635 CodeRabbit, agent-generation)

Comments were read in full with `gh api repos/Hive-Academy/ptah-extension/pulls/635/comments --paginate`, filtered by path. Comment ids: 4175024986 (item 1), 4175024989 (item 2), 4175024993 (item 4), 4175024958 (item 5). All four are fixed. Nothing was committed.

## Item 1: generation reads model layers at the harness-resolved root (orchestrator.service.ts:1094, FU-10)

- **Change.** In `orchestrator.service.ts:1090-1104`, `readAgentModelLayers` now calls `layersForPath(resolveHarnessWorkspaceRoot(workspacePath))`. The import is at `orchestrator.service.ts:32`, from `@ptah-extension/harness-sync`. Generation does not call `normalizeActivePath` itself. `AgentModelSettings.layersForPath` → `WorkspaceScopeResolver.inspectForPath` already applies it inside settings-core (`workspace-scope-resolver.ts:154/173/219`), so the read goes through the same steps as the B-5g save (`resolveHarnessWorkspaceRoot`, then `normalizeActivePath`).
- **Boundary check.** The import is allowed, so no suppression was needed:
  - Both projects are tagged `scope:extension` and `type:feature` (`libs/backend/agent-generation/project.json`, `libs/backend/harness-sync/project.json`).
  - The root `eslint.config.mjs` rule for `scope:extension` allows `scope:shared` and `scope:extension`.
  - It creates no dependency cycle: harness-sync imports only `@ptah-extension/shared` and `@ptah-extension/vscode-core`, and nothing in harness-sync imports agent-generation.
  - There is precedent: `cli-agent-runtime/.../capability-resolver.service.ts:38` imports the same symbol from the same lib.
  - `lint`, which includes `enforce-module-boundaries` and `dependency-checks`, passes.
- **Spec.** `orchestrator.service.spec.ts:1603`, "reads the override saved for the .git root when opened in a subfolder". The mocked `existsSync` reports `<root>/.git`, and generation runs with `<root>/apps/web`. The test expects `layersForPath` to be called with `<root>` and the written frontmatter to contain `model: haiku`. The existing assertion at `:1597` now expects `path.resolve(WS)`, because the resolver resolves the path.

## Item 2: the Claude override is looked up by the file slug, `template.id` (orchestrator.service.ts:1120)

- **Which key the settings use.**
  - Generation writes `${template.id}.md` (`orchestrator.service.ts:790-791`).
  - The B-6 editor (`agent-models.store.ts:187-207`) and the B-5g `skillSynthesis:setAgentModel` save key by the clone `slug`, which is the agent file name.
  - Template storage falls back `id` to the file's template id, and `name` is the independent frontmatter `name` (`template-storage.service.ts:428-429`).
  - The settings key is therefore `template.id`.
- **Change.** `orchestrator.service.ts:1131` now calls `resolveAgentModel(layers, template.id, 'claude')`, with a short comment explaining the key. The warning for an ignored override now names `template.id` as well.
- **Spec.** `orchestrator.service.spec.ts:1631`, "looks the override up by the agent file slug (template id), not its name". It uses id `backend-developer` and name `Backend Developer`, with workspace entries for both keys. It expects `model: haiku`, the value saved under the id, and not `sonnet`, the value saved under the name.

## Item 4: Restore refuses a symlinked or junctioned `.claude` or `.claude/agents` (CWE-59, user-layer-seed-quarantine.ts:886)

- **Change.** A new private method, `refuseLinkedSourceDir` (`user-layer-seed-quarantine.ts:855-892`), checks `dirname(agentSourceDir)` (`{ws}/.claude`) and then `agentSourceDir` (`{ws}/.claude/agents`) with `lstat`:
  - A symbolic link or junction (Node reports a Windows junction as `isSymbolicLink()`) returns the existing `'conflict'` outcome. `path` is the linked component, and the reason is "`<dir>` is a symbolic link or junction; restore only writes into a real directory inside the workspace".
  - A component that exists but is not a directory also returns `'conflict'`.
  - `ENOENT` returns `null`, because `mkdir` will then create real directories.
  - Any other lookup error is re-thrown into `restoreUnderLock`'s existing `copy-failed` catch.
- **Placement.** It is called at `:836`, before the snapshot read, the `compareExisting` read of `dest`, `mkdir` and the temp write. No new outcome state was added.
- **Why only these two components.** They are the only path components below the workspace root, so if neither is a link, nothing below the root can resolve outside it. The root itself may legitimately be a link and is not checked.
- **Spec.** `user-layer-seed-quarantine.spec.ts:1283-1309`, `it.each` over `.claude` and `.claude/agents`, "refuses a symlinked %s as a conflict and writes nothing through it". After a real quarantine pass, the test replaces the component with `symlink(outside, linkPath, 'junction')`. It expects outcome `conflict`, `path === linkPath`, a reason containing "symbolic link or junction", and an empty `outside` directory (no agent file and no temp). On Windows a junction needs no privilege, and POSIX ignores the type argument, so neither test needs a skip. Both ran and passed on win32. `os.homedir()` is still mocked (existing `jest.mock('os')` in that spec).

## Item 5: `validateFilePath` runs before `resolveAbsolutePath` (file-writer.service.ts:206)

- **Change.** In `file-writer.service.ts:198-204`, `prepare` now runs `validateFilePath` first and returns its error, then returns `resolveAbsolutePath(agent.filePath)`. Traversal and non-`.claude` paths keep `securityViolation: true`. Relative paths that pass the security checks are still rejected with "An absolute path is required".
- **Specs** (`file-writer.service.spec.ts`):
  - **Updated:** three existing traversal tests (`:151`, `:276`, `:426`) now expect "Path traversal detected". The `:151` test also asserts `context.securityViolation === true`.
  - **Moved:** `'C:foo'` left the non-absolute `it.each`, because it is now a security violation (no `.claude`). The remaining `.claude/agents/x.md` and `C:.claude/agents/x.md` still assert "An absolute path is required" with no filesystem access.
  - **New:** an `it.each` at `:445` covers `C:foo`, `agents/x.md` and `.claude/../x.md`. Each must carry `securityViolation: true`, must not carry the absolute-path message, and must make no `createDirectory` or `writeFile` call.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` printed `degradation-audit: TOTAL 293 unsuppressed site(s)` and exited 0. The one new `catch` (in `refuseLinkedSourceDir`) only returns on `ENOENT` and otherwise re-throws, the same shape as the existing `compareExisting`.

## Checks (tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation`: "Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation". The only other output was an Nx Cloud 401 notice about the plan, which does not affect the result.
- `npx nx test @ptah-extension/agent-generation --maxWorkers=2`: Test Suites 36 passed, 36 total; Tests 1 skipped, 1257 passed, 1258 total. The skip is the existing POSIX-only chmod test.

## Files modified

- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts`
- `libs/backend/agent-generation/src/lib/services/file-writer.service.ts`
- `libs/backend/agent-generation/src/lib/services/file-writer.service.spec.ts`
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.spec.ts`

## Out-of-scope observations

- `git status` also shows `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts` and the skill-synthesis-ui clones files as modified. Other agents changed them; I did not touch them.
- Item 4 still has a small window between the `lstat` check and `mkdir`/`writeFile` (time-of-check to time-of-use). Closing it fully would need `O_NOFOLLOW` or opening relative to a directory handle, which Node does not offer portably. The check covers the reported case: a link already in place before Restore runs.

# Batch 1 report — TASK_2026_855_d4b6

## Ownership and changed paths

- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` — optional nearest-first ancestor policy reads, canonical deduplication, strict contextual root/config errors, local-only agent disables, contextual fingerprint input.
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.capabilities.spec.ts` — R → A → B precedence, local save scope, strict reads, aliases and same-root context.
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/capability-id-codec.ts` — optional ordered contextual fingerprint; no-context v1 digest preserved.
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/capability-id-codec.lineage.spec.ts` — focused contextual digest invariants. The existing codec suite covers legacy behavior; this new file owns lineage coverage.

No source outside Batch 1 ownership was edited. No real user settings/state were written.

## Behavior and decisions

- Explicit plugin/skill choices fold local → nearest ancestor → distant ancestor → global/default. A deny wins within its own layer. Ancestor agent disables do not flow into the child. Executable plugin paths still use the supplied execution workspace root; saving still writes only the local root.
- Every supplied contextual root is checked for an existing directory, and every unique config is read even when nearer choices shadow it. Malformed and unreadable configs use `CapabilityPolicyUnknownError`; an existing root with no config is empty. Full authorization and physical-path validation remain Batch 6 work, so this intermediate result is unshippable.
- Canonical root identity deduplicates aliases and same-root entries. The fingerprint records the local canonical identity and ordered unique ancestor identities and plugin/skill choices, including shadowed choices. Ancestor agent lists and timestamps are excluded. No-context calls retain the existing v1 digest.
- Decision: reuse `canonicalRootKey` and the existing strict `readWorkspaceLayer` and `pluginConfigLayer` contracts; this avoids a second persistence or policy parser. Reversible within the batch. The approved plan selects the API shape and precedence.

## Verification

- `ptah_get_diagnostics` on four changed files, then the two changed agent-sdk files: both attempts returned **unchecked** because its TypeScript check exceeded 45 seconds. No clean result claimed.
- First `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared`: **exit 1**, 4/6 tasks passed. Agent SDK test and typecheck failed on the new TypeScript narrowing error; corrected in the owned loader file.
- Corrected `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared`: **exit 1**, 5/6 tasks passed. Both project lint/typecheck tasks and shared tests passed. Agent SDK test: 184 suites passed, 4 unrelated suites failed because Jest maps `marked` to a nonexistent worktree `node_modules/marked/lib/marked.umd.js`; 4283 tests passed, 3 failed in those suites. The owned capability suite was not among failures. Log: `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/4239993073453946397`.
- Dependent-host `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode`: **exit 1**, 47/50 Nx tasks succeeded, 2 cached, 3 failed. All three selected host typechecks passed. Each host test target failed on the same missing Jest `marked` mapping: Electron 54 suites passed, 21 failed (1118 tests passed, 9 failed); VS Code 8 suites passed, 9 failed (97 tests passed); TUI 25 suites passed, 1 failed (345 tests passed). Logs: `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/7969789715292849255`, `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/12080593138337419229`, `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/10287196749533455602`.
- Scoped string search found no direct app import of the changed fingerprint symbol or codec module; the three hosts named by Batch 1 were verified. No additional host was established by that symbol search.

## Risk disposition and blockers

- Suite F policy precedence, strict shadowed reads, local save scope and fingerprint behavior have focused regression coverage. Provider-aware skill gating and query-context propagation belong to later batches; no claim of end-to-end behavior yet.
- Full Agent SDK and dependent-host test passes are blocked by the `marked` Jest mapping/dependency issue outside owned files. No dependency/config changes were made. Root validation, resolver propagation, lifecycle persistence and combined independent review remain for later batches; Batch 1 cannot be accepted as a shippable phase.
- No skill-loading tool is exposed to this lane; the Ptah harness skill inventory tool does not load an invocation skill. No optional skill was applied.

# Batch 5d - P5 review fixes

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/index.ts

## Findings addressed

File basenames below refer to the absolute paths above.

1. Logic 1: `workspace-provider-profile-resolver.ts:146` dispatches native resumes from the saved identity. Candidate provider is the literal `openai-codex` (:181); fresh-start active-provider selection is short-circuited for every existing identity (:152). Spec `workspace-provider-profile-resolver.spec.ts:749` switches the workspace to Kimi, resumes successfully, and proves no active-provider, proxy or auth-manager call. Unsupported-host and identity mismatch tests remain.
2. Logic 2: `workspace-provider-profile-resolver.ts:222` uses path.resolve, preserves roots, strips trailing separators, converts backslashes and folds case only on Windows. Both saved and input workspace paths use it (:174, :182). Both current and saved homes are normalized (:157-169); invalid homes produce AuthRequiredError. Specs :795 cover workspace aliases in both directions (case, separators and trailing slash on Windows; trailing slash on POSIX), :813 stored-home aliases, :828 typed invalid-home refusal, and :874 provider/workspace/home mismatches. Platform-specific cases run on the corresponding host; this verification ran on Windows.
3. Logic 3: `workspace-provider-profile-resolver.ts:233` validates models against CODEX_PROVIDER_ENTRY.staticModels. Opus/sonnet/haiku map through CODEX_DEFAULT_TIERS; blank/default/Claude/unknown IDs fall back to the first catalog model. Table spec :776 pins all eight cases including a valid model retained. Credential-free specs :720 still cover all three consumers.
4. Style 1: `ExecutionProfileRequest` and `ResolvedExecutionProfile` are exported at `workspace-provider-profile-resolver.ts:103` and :111 and re-exported by `index.ts:44`. `shouldStartNativeCodex` (:214) names the fresh-start decision. Legacy spec :898 and provider-switch spec :749 pin the branch behavior. No caller or parity gate changed.
5. Style 3: `provider-owner.resolver.ts:568` uses the original default-home material for explicit lexical aliases of the default home before hashing unknown owners. Invalid homes remain isolated without throwing. The doc comment (:563) describes the optional home. Specs `provider-owner.resolver.spec.ts:867` and :886 pin default aliases and invalid homes; :897 retains explicit-home isolation and same-home reads.

## Decisions

- Resume follows immutable identity rather than the workspace's current provider. Literal Codex provider validation remains through sessionRuntimeIdentityMismatch. Evidence: resolver :146-189 and provider-switch/mismatch specs. Reversible locally; no persisted identity migration.
- Normalize paths at comparison time rather than change persisted identity format. Workspace IDs remain paths. Comparisons are lexical, not filesystem/symlink resolution. Invalid home errors use existing AuthRequiredError rather than a new class. Evidence: resolver :157-189, :222. Reversible; seed retains original workspace path and identity object.
- Use explicit Codex tier mappings rather than the Anthropic model resolver. Candidates must exist in the static Codex catalog; otherwise use its first/default model. Evidence: resolver :233 and model table spec :776. Reversible with a future native catalog policy; no live discovery or credential reads introduced.
- Canonicalize only default-home aliases for unknown-owner keys, preserving existing hashing material for other explicit homes. Invalid paths retain isolated unknown keys rather than throwing or merging into the default. Evidence: owner resolver :568-582 and alias/invalid-home specs. Reversible locally.

## Verification

Required command: `npm run verify -- -p @ptah-extension/auth-providers`, executed once from the worktree root, foreground. PowerShell `Select-Object -Last 60` is the equivalent of `tail -60`; a temporary log retained output for the report. Waited for the FIFO lock; preceding Electron/VS Code/CLI verification finished before lock acquisition. No git commands, installs, other project checks, builds or host checks were run by this agent.

Result: **exit code 1**. Typecheck succeeded (the only successful task); lint and tests failed on known issues outside this batch.

Scope evidence: this Nx output mode did not print a literal "1 project" header. The command header is `node scripts/verify.mjs -p @ptah-extension/auth-providers`; the acquired-lock label is `verify lint,test,typecheck (@ptah-extension/auth-providers)`; Nx reports three tasks. The selected scope is one project, but the requested literal header cannot be quoted from this run.

- Tests: **75 passed suites, 1 failed, 1 skipped; 2022 passed tests, 6 failed, 10 skipped; 2 snapshots passed**. Only failing suite: translation-proxy.sdk.integration.spec.ts, with Windows EPERM teardown errors. Neither changed spec is listed as failing.
- Lint: **3 errors, 14 warnings**. Errors are the known persistence-sqlite dependency check, provider-account.store.spec.ts:132 no-unexpected-multiline, and provider-account.store.ts:16 no-control-regex. No lint findings in changed files.
- Read existing Nx task logs to identify failures; did not repeat verification or tests.

Exact invocation:

```powershell
$verifyLog = Join-Path $env:TEMP 'ptah-batch-5d-verify.log'
npm run verify -- -p @ptah-extension/auth-providers 2>&1 | Tee-Object -FilePath $verifyLog | Select-Object -Last 60
$verifyCode = $LASTEXITCODE
Select-String -Path $verifyLog -Pattern '1 project|projects:' | Select-Object -First 4
exit $verifyCode
```

Real output tail (last 60 lines; captured run had fewer than 60):

```text

> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/auth-providers

[verify 2026-10-25T15:32:06.191Z] waiting on pid 44888 [verify test (ptah-electron,ptah-extension-vscode,ptah-cli)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:21:49.828Z (queue position 2)
[verify 2026-10-25T15:33:06.828Z] waiting on pid 44888 [verify test (ptah-electron,ptah-extension-vscode,ptah-cli)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:21:49.828Z (queue position 2)
[verify 2026-10-25T15:33:11.886Z] waiting on queued pid 14212 [verify test (@ptah-extension/rpc-handlers)] in D:\projects\ptah-extension\.claude-worktrees\provider-switch-model-sync since 2026-10-25T15:30:04.272Z
[verify 2026-10-25T15:33:12.902Z] waiting on pid 14212 [verify test (@ptah-extension/rpc-handlers)] in D:\projects\ptah-extension\.claude-worktrees\provider-switch-model-sync since 2026-10-25T15:33:12.118Z (queue position 1)
[verify 2026-10-25T15:33:56.308Z] lock acquired after 110s: verify lint,test,typecheck (@ptah-extension/auth-providers)
node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   3 tasks: 1 succeeded, 2 failed


✖ nx run @ptah-extension/auth-providers:test
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\13628026684437695834

✖ nx run @ptah-extension/auth-providers:lint
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\3056550894988569834

Re-run with --output-style=static to inline logs.

  Run duration:      2m 11s
  Cache:             0/1 hit (0%)
  Critical path:     1m 57s (1 task)
  Recoverable time:  13.7s (10% of the run)

  Recommendations:
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/KCOgvuakDD.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/auth-providers:test    1m 57s
[verify 2026-10-25T15:36:11.082Z] lock released after 134.8s, exit code 1
```

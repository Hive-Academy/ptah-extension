# Setup wizard agent-generation investigation

Investigated 2026-09-22 in `D:\projects\ptah-extension`. Repository source was read-only; this report is the only repository file written. No wizard, download, build, or full test suite was run. File references below are relative to that repository unless absolute. Findings distinguish the current code and files from the unobserved execution of today's wizard.

## 1. Runtime template source and the user layer

**The normal runtime source is `C:\Users\abdal\.ptah\templates\agents`, a downloaded content cache. It is neither the workspace template directory nor the editable user-agent layer.**

The complete registration and loading chain is:

- `libs/backend/platform-vscode/src/registration.ts:122` registers `PLATFORM_TOKENS.CONTENT_DOWNLOAD` with `new ContentDownloadService()`.
- `libs/backend/platform-core/src/content-download.service.ts:97` constructs its home-directory paths; line 100 sets `.ptah/templates/agents`; `getTemplatesPath()` returns that directory at line 216.
- `libs/backend/agent-generation/src/lib/di/register.ts:80` registers the template storage through `instanceCachingFactory`; lines 84–94 resolve content download, call `getTemplatesPath()`, and pass that path and a real `TemplatePartialResolver` into `TemplateStorageService`.
- `libs/backend/agent-generation/src/lib/services/template-storage.service.ts:109` also defaults to the same home directory if no path is supplied. Its comments describing an extension-bundled directory are outdated; the executable constructor and DI determine behavior.
- `template-storage.service.ts:351` reads the selected template from that directory; line 387 expands its shared blocks from the sibling `_shared` directory. Parsed templates are cached (`loadTemplate`, line 236); `clearCache()` clears both template and partial caches. No workspace or worktree fallback is involved in this path.
- `libs/backend/platform-core/src/content-download.service.ts:94` names the GitHub **main** content manifest. Lines 251–258 reuse a matching cached content hash; lines 283–286 download manifest-listed templates into the cache. Manifest fetch failure returns existing-cache availability at lines 234–246. `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:55` initiates `ensureContent()` asynchronously during activation.

Direct recursive byte comparison found **20/20 current checkout template/partial files identical to their runtime-cache counterparts**. Thus this machine's current cached corpus contains the same old rules as this checkout. This is an observed equality, not evidence that the wizard reads workspace source.

The other directory, `C:\Users\abdal\.ptah\user\agents\ptah-extension-f3f2fa6ea9b593a6`, exists and holds generated **editable clones with origin sidecars**, used as downstream harness sources:

- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:276` documents the workspace scope; lines 292–298 construct the scoped agent root.
- `libs/backend/harness-sync/src/lib/state/agent-sync-gate.ts:182` resolves the upstream agent source as `<workspace>/.claude/agents` at line 190.
- `user-layer-mirror.service.ts:1885` enumerates those generated Markdown files; lines 1918–1926 skip existing clones; lines 1930–1938 copy missing clones and write origin hashes.
- `user-layer-mirror.service.ts:1436` compares upstream hashes; lines 1442–1449 fast-forward an unchanged clone; lines 1451–1457 mark an edited clone diverged instead of replacing it.
- `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:74` establishes the user agents base, and line 95 scopes it. `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:504` reads these clones into the desired-agent manifest.

It is therefore an editable downstream source/override layer for harness distribution, **not a template input to wizard generation** and not merely a disposable download cache. The inspected `team-leader.ptah-origin.json` records `diverged: true` and a `pendingSourceHash`, confirming that this particular clone has divergence bookkeeping. That does not explain stale text in the upstream `.claude/agents/team-leader.md`.

## 2. Real resolver rendering and comparison

Executed a one-off script outside the repository:

```powershell
node C:/Users/abdal/AppData/Local/Temp/ptah-agent-investigate.cjs
```

The script loads the actual `TemplatePartialResolver` TypeScript implementation with the installed TypeScript transpiler, real `tsyringe` decorators, real `Result`, actual `renderTaskSpecAgentBlock`, and `gray-matter`. Only the logger/token dependency is stubbed. It passes template frontmatter variables and the checkout `_shared` directory to `resolve()`.

For final file formatting, it extracts and executes the actual AST nodes for `stripCompositionMarkers`, its two regex constants, and `buildAgentFileContent` from `orchestrator.service.ts:135`, `:172`, and `:1070`. It does not reimplement their algorithms. It deliberately does not exercise an LLM or instantiate the full wizard. Rendered artifacts are saved next to the script in the OS temp directory.

Observed output:

```text
HEAD byte equality: 15/15
team-leader: byteEqual=true whitespaceEqual=true renderedChars=22749 existingChars=22749
backend-developer: byteEqual=true whitespaceEqual=true renderedChars=14525 existingChars=14525
Cache team-leader.template.md exists=true matchesCheckout=true
Cache backend-developer.template.md exists=true matchesCheckout=true
Full template cache comparison: 20/20 byte-identical
```

Team-leader resolved `TOOLING_PRECEDENCE`, `TASK_SPEC_CONTRACT`, `CLARIFICATION_PROTOCOL`, and `REPLACEMENT_POLICY`; backend-developer additionally resolved `CLI_DELEGATION`. There is **no diff, even before whitespace normalization**, for either emitted agent. HEAD comparisons used raw `git show HEAD:.claude/agents/<name>.md` buffers against on-disk buffers, rather than Git's line-ending-normalizing working-tree diff.

Other read-only checks independently verified the reported checkout facts:

```text
git branch --show-current
feat/task-2026-523-providers-auth

git log -1 --format='%h %ai %s' -- .claude/agents
bb95f6508 2026-09-22 10:03:48 +0300 chore(harness): regenerate claude and codex agent definitions

Get-ChildItem .claude/agents/*.md | Group-Object { $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
2026-09-22 10:34    Count=15
```

`libs/backend/agent-generation/templates/agents/team-leader.template.md:34` includes the shared preamble and line 56 explicitly says `## Advisory boundary — you never spawn`. The emitted heading is at `.claude/agents/team-leader.md:104`. Long tooling and clarification instructions originate in `_shared/tooling-precedence.md:1` and `_shared/clarification-protocol.md:1`; their presence is authored input, not a resolver retaining obsolete generated text.

`git worktree list` identifies `.claude-worktrees/prompt-token-efficiency` at `f0625b497` on `feat/prompt-token-efficiency`. `git merge-base --is-ancestor f0625b497 HEAD` returns exit 1: that worktree commit is not an ancestor of this checkout. Its `libs/backend/agent-generation/templates/agents/team-leader.template.md:16` instead permits running a recommended executor as a CLI lane; lines 44–45 include `CLI_DELEGATION`. These newer files are distinct from both the checkout corpus and the matching runtime cache. The normal path traced above cannot load that worktree directly.

## 3. Today's extension-host logs

**No log for today's wizard run was found in the three requested locations.** A recursive PowerShell search selected files with local modification date 2026-09-22 and searched for `wizard|AgentGeneration|FileWriter|Generated|\.claude[/\\]agents`. A second recursive Node scan confirmed the result without suppressing filesystem errors:

| Directory | Total files | Files modified 2026-09-22 | Matching files | Latest file mtime, UTC |
| --- | ---: | ---: | ---: | --- |
| `C:\Users\abdal\AppData\Roaming\Code\logs` | 119 | 0 | 0 | 2026-09-21T14:00:16.592Z |
| `C:\Users\abdal\AppData\Roaming\Code - Insiders\logs` | Directory absent | — | — | — |
| `C:\Users\abdal\.ptah\logs` | 1 | 0 | 0 | 2026-09-19T15:08:09.526Z |

There are consequently no observed run timestamps, written-file counts, warnings, or errors to quote. The agents' mtimes alone do not identify their writer or prove wizard execution.

According to `libs/backend/vscode-core/src/logging/logger.ts:51`, the logger uses the **Ptah** output channel. Line 75 creates it, and line 269 writes formatted log messages through `OutputManager`; console forwarding depends on development defaults at lines 84–87 and uses console methods at lines 350–364. `libs/backend/vscode-core/src/api-wrappers/output-manager.ts:95` creates a standard VS Code output channel using `vscode.window.createOutputChannel`. This code delegates persistence/location to VS Code; it does not name a dedicated `~/.ptah/logs` file for wizard logging. The appropriate live surface is VS Code's Output → Ptah, with developer-console output when enabled.

Expected messages from current code, **not observed log lines**, include `Agent already current, skipping write` (`file-writer.service.ts:221`), `Agent written successfully` (`:228`), and `Agent generation settled` with written/unchanged/failed totals (`orchestrator.service.ts:515`). The batch writer has a separate aggregate message at `file-writer.service.ts:165`, but the wizard orchestrator currently writes agents individually.

## 4. Overwrite, unchanged files, and user edits

**Existing `.claude/agents` files are skipped only when their full content is exactly equal; differing content is overwritten, including user edits.** There is no merge or user-edit protection at this upstream write point.

- `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:71` implements `writeAgent`; line 89 delegates to `writeIfChanged`.
- Lines 210–225 read the existing target and return `status: 'unchanged'` for strict string equality. Whitespace differences are not ignored.
- Lines 226–231 call `fs.writeFile(absolutePath, agent.content)` for a missing or differing target and return `status: 'written'`. A read failure is treated as no existing content at lines 216–219.
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:404` fixes the output directory to `<projectRoot>/.claude/agents`; line 789 loads each selected template; line 854 calls `fileWriter.writeAgent(rendered)`; lines 874–880 propagate the returned status.
- Lines 449–456 count both written and unchanged as successful; lines 515–521 log totals. The user-layer preservation behavior described in question 1 is a separate downstream mechanism.

`libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts:7` explains that this service is the UI facade and that generation is reached through RPC. Its line 92 handles completion by closing the panel and reloading. The runtime generation supervisor calls the orchestrator at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts:225`; inspecting the facade alone would miss the actual write behavior.

## 5. Defect assessment and smallest corrective action

**No generation defect explaining these old rules was reproduced.** The current resolver/emitter produces exactly the observed files, and all 20 template/partial source files in the runtime cache are byte-identical to this checkout. The disputed advisory restriction is explicitly authored in `libs/backend/agent-generation/templates/agents/team-leader.template.md:56`.

The source mismatch is between the expected newer worktree and the corpus actually available to generation. To obtain the newer rules, integrate the intended template/partial changes into the distributed corpus, update the content manifest/cache through the normal distribution path, then reload or clear template caches before generating. Merely editing or switching a workspace branch is insufficient because normal DI reads the home-directory download cache. No implementation patch is justified by the observed stale-rules symptom.

There is a documentation discrepancy: `template-storage.service.ts:50` and `:75` describe an extension-bundled default while the constructor at line 109 uses the home cache. The smallest correction is updating those comments to match the actual path. It does not change generation behavior or explain a runtime malfunction. No source changes were made.

## Conclusion

The old rules are present because they are the rules authored in both this checkout and the current downloaded runtime corpus. Team-leader and backend-developer regenerate byte-for-byte to their existing files; all 15 generated agents are byte-identical to HEAD. The newer worktree is unmerged and is not a normal runtime template source.

This establishes that the inspected generation logic and observed output are consistent. It does **not** establish that today's wizard completed or wrote 15 files: no matching run log exists in the requested locations, and a current-code run can correctly report unchanged files without writing them. The evidence supports a template-version expectation mismatch, not a demonstrated generation failure.

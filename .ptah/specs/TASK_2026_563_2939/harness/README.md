# TASK_2026_563_2939 measurement harness

These files are evidence artifacts, not product code (implementation-plan.md component 9). They
have no nx project, and nothing in them is lint- or typecheck-gated. Everything they do runs on
backup-API working copies in `%TEMP%\mqs-563-eval\`.

## Safety rules the scripts enforce

- **The live database is never opened.** Nothing here opens `%USERPROFILE%\.ptah\state\**`.
  `lib/copy-db.ts` refuses any target under that directory, any target named `ptah*`, and any
  target outside `%TEMP%\mqs-563-eval\`. `lib/connection.ts` refuses to open anything else.
- **The snapshot is re-verified every time.** It is
  `%TEMP%\mqs-563-snapshot\memcopy-563.sqlite`, and its SHA-256 must be
  `2661275c4c120fd7554953cfae60ec6cc5f82c726ef0ebe925adf5b2e33b7810`. Every `makeWorkingCopy` call
  checks it and throws on a mismatch.
- **Working copies are taken with the online backup API.** `better-sqlite3` `Database#backup`
  reads from a `readonly` + `fileMustExist` source in a single step. The target is reserved with an
  exclusive create (`wx`), so an existing file fails the run.
- **Harness LLM calls run with MCP off.** They pass `mcpServers: {}`, `strictMcpConfig: true` and
  `settingSources: []`, and they use only the read-only built-in tools `Read`, `Grep` and `Glob`.
  They also pass `persistSession: false`.

## One-time setup (clean shell, Git Bash)

```bash
REPO=/d/projects/ptah-extension-memory-quality-source
E=C:/Users/abdal/AppData/Local/Temp/mqs-563-eval
mkdir -p "$E"

# 1. Verify the snapshot (PowerShell):
#    (Get-FileHash -Algorithm SHA256 "$env:TEMP\mqs-563-snapshot\memcopy-563.sqlite").Hash
#    Expect 2661275C4C120FD7554953CFAE60EC6CC5F82C726EF0EBE925ADF5B2E33B7810

# 2. Point bare-module requires from the bundles in $E (better-sqlite3, sqlite-vec,
#    @anthropic-ai/claude-agent-sdk, @huggingface/transformers) at the worktree's node_modules
#    with a JUNCTION (PowerShell):
#    New-Item -ItemType Junction -Path "$env:TEMP\mqs-563-eval\node_modules" -Target "D:\projects\ptah-extension-memory-quality-source\node_modules"
#    CLEANUP WARNING: remove it ONLY with `cmd /c rmdir "%TEMP%\mqs-563-eval\node_modules"`.
#    Never delete it recursively: a recursive delete follows the junction and wipes the worktree's
#    node_modules.

# 3. Capture the base-commit prompts (implementation-plan.md:915-917):
cd "$REPO"
git show ebfc73321:libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts > "$E/old-extract-prompt.ts"
git show ebfc73321:libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts > "$E/old-resolve-prompt.ts"
for f in old-extract-prompt old-resolve-prompt; do
  npx esbuild "$E/$f.ts" --format=cjs --platform=node --outfile="$E/$f.cjs"
done
node -e "const fs=require('fs');const E='$E';
fs.writeFileSync(E+'/old-EXTRACT_SYSTEM_PROMPT.txt',require(E+'/old-extract-prompt.cjs').EXTRACT_SYSTEM_PROMPT);
fs.writeFileSync(E+'/old-RESOLVE_SYSTEM_PROMPT.txt',require(E+'/old-resolve-prompt.cjs').RESOLVE_SYSTEM_PROMPT);"

# 4. Base-commit worktree, used only for the relevance "main" baseline:
git -C "$REPO" worktree add --detach 'C:\Users\abdal\AppData\Local\Temp\mqs-563-base' ebfc73321
```

## Bundle and run

This is the plan's esbuild invocation (implementation-plan.md:894) with one addition,
`--alias:vscode=./apps/ptah-electron/src/shims/vscode-shim.ts`. The `@ptah-extension/vscode-core`
barrel imports `vscode` at module level, and the Electron build maps it to the same shim through
`apps/ptah-electron/tsconfig.build.json`. Without the alias, esbuild fails with
`Could not resolve "vscode"`.

Every script runs with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd`, which loads the
production `better-sqlite3` ABI (`.ptah/specs/TASK_2026_439_1310/HANDOFF.md:56-63`).

```bash
REPO=/d/projects/ptah-extension-memory-quality-source
E=C:/Users/abdal/AppData/Local/Temp/mqs-563-eval
H=.ptah/specs/TASK_2026_563_2939/harness
ESB="--bundle --platform=node --tsconfig=tsconfig.base.json --alias:vscode=./apps/ptah-electron/src/shims/vscode-shim.ts --external:better-sqlite3 --external:sqlite-vec --external:@huggingface/transformers --external:@anthropic-ai/claude-agent-sdk"
RUN="env ELECTRON_RUN_AS_NODE=1 $REPO/node_modules/.bin/electron.cmd"

# M5 migration + M5 rules. BRANCH sources, copy A = copyA-m5.sqlite:
cd "$REPO" && npx esbuild $H/copy-audit.ts $ESB --outfile=$E/copy-audit.cjs
cd "$E" && $RUN copy-audit.cjs m5
#  -> output/m5-migration.json, output/m5-rules.json

# Relevance "main". BASE sources: bundled FROM the base worktree with ITS tsconfig.base.json, so
# every @ptah-extension/* alias resolves to ebfc73321 code. NODE_PATH lets esbuild find bare
# packages for base files. The script asserts MIGRATIONS max = 47:
cd 'C:/Users/abdal/AppData/Local/Temp/mqs-563-base' && \
  NODE_PATH='D:\projects\ptah-extension-memory-quality-source\node_modules' \
  "$REPO/node_modules/.bin/esbuild.cmd" "$REPO/$H/copy-audit.ts" $ESB \
  --outfile=$E/copy-audit.base.cjs --metafile=$E/copy-audit.base.meta.json
cd "$E" && $RUN copy-audit.base.cjs relevance-main
#  -> output/relevance-main.raw.json (judged by hand into output/relevance-main.md)

# M4 extraction eval. BRANCH sources, fresh unmigrated copy m4-unmigrated.sqlite:
cd "$REPO" && npx esbuild $H/extract-eval.ts $ESB --outfile=$E/extract-eval.cjs
cd "$E" && $RUN extract-eval.cjs sample   # -> output/m4-sample.json (+ m4-working-copy.json)
cd "$E" && $RUN extract-eval.cjs probe    # 1 LLM call -> output/m4-probe.json
cd "$E" && $RUN extract-eval.cjs run      # <= 2 x windows LLM calls; appends $E/m4-calls.jsonl, resumable
cd "$E" && $RUN extract-eval.cjs report   # -> output/m4-extraction.json, output/m4-drafts.json

# Embedder worker used by lib/embedder.ts (Phase 2):
cd "$REPO" && npx esbuild libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts \
  --bundle --platform=node --format=cjs --external:@huggingface/transformers --outfile=$E/embedder-worker.cjs
```

## Phase 2 (M3 8a/8b, relevance "branch", restore equivalence, KNN starvation)

Every Phase 2 script is bundled from the BRANCH sources and asserts `MIGRATIONS` max = 49. The
same one-time setup applies: the snapshot hash, the `node_modules` junction, the captured
`old-RESOLVE_SYSTEM_PROMPT.txt`, and the embedder worker bundle above. Models are byte-copied into
`$E/models` on first use (`lib/embedder.ts`). The base worktree is not needed.

```bash
REPO=/d/projects/ptah-extension-memory-quality-source
E=C:/Users/abdal/AppData/Local/Temp/mqs-563-eval
H=.ptah/specs/TASK_2026_563_2939/harness
ESB="--bundle --platform=node --tsconfig=tsconfig.base.json --alias:vscode=./apps/ptah-electron/src/shims/vscode-shim.ts --external:better-sqlite3 --external:sqlite-vec --external:@huggingface/transformers --external:@anthropic-ai/claude-agent-sdk"
RUN="env ELECTRON_RUN_AS_NODE=1 $REPO/node_modules/.bin/electron.cmd"

cd "$REPO" && npx esbuild $H/branch-audit.ts $ESB --outfile=$E/branch-audit.cjs
cd "$REPO" && npx esbuild $H/merge-replay.ts $ESB --outfile=$E/merge-replay.cjs

# Relevance "branch" + restore-all equivalence. Fresh copy relbranch-copyA49.sqlite, migrated to 49.
# Reads output/relevance-main.raw.json (Phase 1) for the equivalence check:
cd "$E" && $RUN branch-audit.cjs relevance-branch    # -> output/relevance-branch.raw.json

# KNN starvation. Creates copy B (copyB-m3.sqlite, 48 only) if it is missing, plus a fresh
# knn-copyA49.sqlite (49). Real embedder and reranker:
cd "$E" && $RUN branch-audit.cjs knn                 # -> output/knn-starvation.raw.json (+ output/m3-copyB.json)

# M3 reach 8(a): once plainly, once with a dead proxy. Each run installs lib/net-guard.ts in the
# main thread and the embedder worker, and logs to $E/netguard-m3-reach-<label>.log. That log
# must not exist yet, so pick a new label to re-run:
cd "$E" && env -u HTTPS_PROXY -u HTTP_PROXY $RUN merge-replay.cjs reach direct   # -> output/m3-reach-direct.json
cd "$E" && env HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 NODE_USE_ENV_PROXY=1 \
  $RUN merge-replay.cjs reach proxy                                               # -> output/m3-reach-proxy.json

# M3 replay 8(b):
cd "$E" && $RUN merge-replay.cjs select   # replay set on copy B -> output/m3-replay-set.json (no LLM)
cd "$E" && $RUN merge-replay.cjs replay   # copy B' (copyBprime-m3.sqlite) -> output/m3-copyBprime.json;
                                          # candidate sets -> $E/m3-candidates.json (local, timed);
                                          # resolve calls -> $E/m3-calls.jsonl (resumable; <= 3 x drafts calls)
cd "$E" && $RUN merge-replay.cjs report   # -> output/m3-replay.json (guard applied; no LLM)
```

Resumability and fail-if-exists:

- `replay` reuses `copyBprime-m3.sqlite` and `m3-candidates.json` when they exist.
- `replay` skips every (draft, variant) already recorded in `m3-calls.jsonl` without an error.
- Deleting `m3-candidates.json` re-runs the local collection. Deleting `m3-calls.jsonl` re-runs
  the LLM calls.
- Working copies are never overwritten. To start over, remove the copy files by hand first.

## Files

| File                | Purpose                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/copy-db.ts`    | Snapshot verification and backup-API working copies (fail-if-exists, path refusals)                                                                                   |
| `lib/connection.ts` | The `{ db }` `SqliteConnectionService` stand-in (`adaptSqliteDatabase` shape), the production pragmas, sqlite-vec loading, and a console logger                       |
| `lib/embedder.ts`   | A real `EmbedderWorkerClient` over a `node:worker_threads` factory, with the model byte copy in `$E/models`                                                           |
| `lib/llm.ts`        | The real `SdkInternalQueryCuratorLlm` over an `InternalQueryService` stand-in that calls `@anthropic-ai/claude-agent-sdk` `query()`, with old/new prompt substitution |
| `lib/copies.ts`     | Phase 2: `makeMigratedCopy` (backup-API copy, then the production runner to 48 or 49), `ensureCopyB` (48 only, created once), and the 8(a) draft source row           |
| `lib/net-guard.ts`  | Phase 2: records every outbound `connect`, `dns.lookup` and `fetch` in the main thread and the embedder worker thread (the 8(a) locality proof)                       |
| `copy-audit.ts`     | Modes `m5` (M5 migration and M5 rules) and `relevance-main`. Also bundled against the base worktree, so it imports no Phase 2 lib                                     |
| `extract-eval.ts`   | M4: `sample`, `probe`, `run` and `report`                                                                                                                             |
| `branch-audit.ts`   | Phase 2: `relevance-branch` (with restore-all equivalence) and `knn` (KNN starvation)                                                                                 |
| `merge-replay.ts`   | M3: `reach <label>` (8a), `select`, `replay` and `report` (8b)                                                                                                        |
| `output/`           | Raw results, the judged tables, and `run-log.md`                                                                                                                      |

## Cleanup

```bash
cmd //c rmdir 'C:\Users\abdal\AppData\Local\Temp\mqs-563-eval\node_modules'   # junction only
git -C /d/projects/ptah-extension-memory-quality-source worktree remove 'C:\Users\abdal\AppData\Local\Temp\mqs-563-base' --force
```

Phase 2 creates no worktree. Its only link is the same `node_modules` junction, removed the same
way.

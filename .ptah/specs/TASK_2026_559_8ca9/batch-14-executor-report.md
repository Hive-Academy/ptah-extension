# Batch 14 executor report

Task: `TASK_2026_559_8ca9`, Lane B. Implementation and verification performed only in `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-b`.

## Changes

Paths below are relative to that working tree. `A` in the adapter table denotes `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:490`: `buildTaskPrompt` accepts an explicit optional `resumeRestoresContext` flag. Only a true flag together with a nonempty `resumeSessionId` suppresses system/project context and the role. Omitted/false flags preserve the full prefix. Policy, task, file focus, deliverable instructions, two-way messaging and completion contract remain on the existing path.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:669`: explicitly opts in when assembling the task for the SDK thread. Exactly one prompt call changed; the deferral feature remains false.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:280`: explicitly opts in for the SDK agent. Prettier also normalized formatting in this owned file.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts:137`: four regression cases, including an inline snapshot captured against the original implementation before the production change.
- CREATED `.ptah/specs/TASK_2026_559_8ca9/batch-14-executor-report.md`: this report.

Only two adapter files were edited. `codex-cli.adapter.spec.ts` needed no change. No new imports, registrations, dependencies, catches, suppressions, or untyped escape hatches were added. The two protected system-prompt files were not edited. The native tool-policy source block remained identical: SHA-256 `8f6314194e69fbd56c1decd2d72c7e808d779b170d37bfe0aa0a82c83b20b3ee` before/after (UTF-8 source block with normalized line endings).

## Resume capability evidence

This is source/SDK-contract evidence, not a live provider smoke test. Passing a CLI session flag alone was not treated as proof that prior prompt history is restored. The requested conservative fallback applies wherever that evidence is unclear.

| Adapter     | Resume restores history?                                | Evidence file:line                                                                                                                                                                                                                                                      | Flag used                                      |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Codex       | Yes, SDK persisted conversation resume                  | `A/codex-cli.adapter.ts:666` selects `resumeThread`; installed `node_modules/@openai/codex-sdk/dist/index.d.ts:276` documents resuming a conversation persisted under the Codex sessions directory                                                                      | Explicit `true`, `A/codex-cli.adapter.ts:670`  |
| OpenCode    | Unclear locally; treated as non-restoring               | `A/opencode-cli.adapter.ts:587` forwards `--session`; `:555` builds the full task. No local history-restoration guarantee was established. `:285` describes one-shot turns without handle continuation                                                                  | Default `false`                                |
| Antigravity | Unclear locally; treated as non-restoring               | `A/antigravity-cli.adapter.ts:229` forwards `--conversation`; `:605` builds the full task. A conversation ID alone does not establish prefix restoration                                                                                                                | Default `false`                                |
| Cursor      | Yes, SDK existing-agent resume                          | `A/cursor-cli.adapter.ts:345` selects `Agent.resume` and `:356` sends the next prompt to that agent; installed `node_modules/@cursor/sdk/dist/esm/options.d.ts:269` documents the persisted local store used by `Agent.resume`                                          | Explicit `true`, `A/cursor-cli.adapter.ts:281` |
| Pi          | Explicitly unverified; treated as non-restoring         | `A/pi-cli.adapter.ts:54` marks RPC session support UNVERIFIED; `:380` repeats that caveat before `--session`; `:503` builds the prompt                                                                                                                                  | Default `false`                                |
| Copilot     | Unclear locally; treated as non-restoring               | `A/copilot-sdk.adapter.ts:243` describes CLI resume; `:324` forwards `--resume`; `:463` builds the full task. This proves the requested session is forwarded, not what history the CLI reloads                                                                          | Default `false`                                |
| Ptah CLI    | SDK persistence/resume configured; outside this utility | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:824` sets `persistSession`, `:825` supplies SDK `resume`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts:9` documents that this path never calls `buildTaskPrompt` | Not applicable; no call/flag                   |

## Role delivery outside the task prompt

`renderRoleBlock` originates at `A/cli-adapter.utils.ts:465`. Codex declares the `developer-instructions` role channel at `A/codex-cli.adapter.ts:446`, renders the role under the unconditional role-presence guard at `:630`, and assigns `config.developer_instructions` at `:636`. It strips the role before calling `buildTaskPrompt`. A resumed Codex lane therefore still resends the role on that separate configuration channel; this batch changes only task-prefix delivery, as requested.

Ptah CLI assembles the role into `systemPromptContent` at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:180`. `ptah-cli-registry.ts:673` supplies the role during assembly and `:774` sends the resulting system prompt without a resume exclusion. It also still resends the role outside this utility. The other five adapters deliver their role through `buildTaskPrompt`; Cursor now omits that role on a restoring resume, and the conservative defaults retain it for the others.

## Prefix size

Measured against the original inline snapshot fixture: 1,000-character system prompt, fallback project guidance, backend role, task, file focus and named deliverable. System prompt takes precedence over fallback guidance, as before.

| Measurement                             |      Before | After restoring resume |
| --------------------------------------- | ----------: | ---------------------: |
| System/role prefix including delimiters | 1,202 chars |                0 chars |
| Whole task prompt                       | 2,716 chars |            1,514 chars |

The separate project-guidance-only regression verifies that fallback guidance is omitted too. Fresh spawns remain byte-identical to the captured snapshot. Codex already stripped the role from the task channel, so a 1,000-character system prompt saves 1,007 task-input characters there (system prompt plus delimiter); its separate developer-instructions role remains as noted above. These are fixture character counts, not token or live billing measurements.

## Fails-before evidence

1. Before changing production code, ran `node_modules/.bin/nx run @ptah-extension/cli-agent-runtime:test --skip-nx-cache --maxWorkers=2 --testFile=cli-adapter.utils.spec.ts --testNamePattern='resume context' --updateSnapshot`. Result: **1 passed, 79 skipped; 1 snapshot written** against the old output.
2. Added the resume assertions and three additional cases, then ran them once against the unchanged prompt implementation. The four cases cover the 1,000-character prefix plus exact retained tail, project-guidance fallback, explicit/default non-restoring behavior versus restoring behavior, and a restoring adapter without a resume ID versus a resumed one. Each contains a new-behavior assertion and each failed on the old code; the fresh snapshot itself still passed.
3. The pre-change command also exercised the temporary Codex feature mutation:

```text
node_modules/.bin/nx run @ptah-extension/cli-agent-runtime:test --skip-nx-cache --maxWorkers=2 --testPathPatterns='(cli-adapter.utils|codex-cli.adapter).spec.ts' --testNamePattern='resume context|registers the Ptah server AND disables MCP tool deferral'

Test Suites: 2 failed, 2 total
Tests:       5 failed, 138 skipped, 143 total
Snapshots:   1 passed, 1 total
```

All four new cases subsequently passed in the full library test target. The test target succeeded after the implementation without updating snapshots.

## Task 14.2 mutation and revert

Changed only `tool_search_always_defer_mcp_tools: false` to `true` temporarily at `A/codex-cli.adapter.ts:627`. The existing spec failed at `A/codex-cli.adapter.spec.ts:1276`:

```text
expect(config.features).toEqual({
  tool_search_always_defer_mcp_tools: false,
});

- Expected: "tool_search_always_defer_mcp_tools": false
+ Received: "tool_search_always_defer_mcp_tools": true
```

Reverted by editing the boolean back, before making the production prompt-call change. The complete adapter file's SHA-256 before the flip and after the revert was identical: `9393e09b49e0abda0c579873e05a9973ef02b1c6b116aba6a6f5fa50adc98ff3`. This proves the temporary flip left no byte changes at that point. The current adapter intentionally includes the subsequent Batch 14.1 prompt-call edit. The full test target then passed with the false feature value restored. No extra deferral assertion was necessary.

## Stack and verification

Observed Node 24 requirement (`package.json:6`), TypeScript 6.0.3 (`package.json:282`), Nx 23.2.1 (`package.json:271`) and Jest 30 (`package.json:261`), with the npm lockfile read. This is the runtime-neutral CLI-agent library, not a NestJS service. Existing typed `CliCommandOptions` is the internal prompt boundary; adapters supply SDK/process collaborators using the existing local conventions. No external boundary or DI wiring was added. Module boundary rules were read in `eslint.config.mjs:365`; the changed code keeps existing imports and the library's `scope:extension`, `type:feature` tags in its `project.json`.

All Nx commands used `NX_ISOLATE_PLUGINS=false`, `NX_DAEMON=false`; task parallelism and Jest workers were capped at two.

- `ptah_get_diagnostics` scoped to all four edited source/spec files: **0 errors, 0 warnings**.
- Initial `nx run-many '-t=test,lint,typecheck' -p @ptah-extension/cli-agent-runtime --skip-nx-cache --maxWorkers=2`: **test passed; lint passed; typecheck invocation failed** because Nx forwarded the Jest-only option to `tsc`. Exact error: `TS5023: Unknown compiler option '--maxWorkers=2'`. Successful tests/lint were not rerun just to recover output. Typecheck was rerun without that option, together with the requested downstream projects.
- `node_modules/.bin/nx run-many -t=typecheck -p @ptah-extension/cli-agent-runtime ptah-cli ptah-electron @ptah-extension/vscode-lm-tools --parallel=2 --skip-nx-cache --output-style=static`: **passed for all four projects**. Tail: `NX Successfully ran target typecheck for 4 projects`; duration **46.7s**, cache skipped.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` tail:

```text
NX Successfully ran target validate-deps for project ptah-electron and 1 task it depends on
Run duration: 3.1s
Cache: Skipped (--skip-nx-cache)
```

- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` tail:

```text
degradation-audit: TOTAL 300 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
Run duration: 8.7s
```

- `npx prettier --check` on the four edited source/spec files: **All matched files use Prettier code style!** Final check includes this report: all five files pass.

## Deviations and limits

- The governing backend-developer instruction explicitly says not to run git. Therefore the requested read-only `git diff`, `git status --short`, and `git diff --stat` were not run. The exact pre/post-mutation file hash above substitutes for the temporary flip's revert proof. No git operation was run, and no commit/stage/push occurred. Repository-wide working-tree state was not independently certified.
- Unknown CLI history behavior conservatively retains the prefix, as explicitly authorized. Only Codex and Cursor are opted in; there was no live provider run.
- The combined verification command required the Jest-option correction described above.
- No unrelated defect was changed. No Codex review lane was launched; review belongs to the invoking workflow.

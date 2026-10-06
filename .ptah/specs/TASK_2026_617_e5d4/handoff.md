# TASK_2026_617 — handoff (2026-10-06)

## Where things stand

The Grok CLI lane over ACP is implemented. Batches 1–9 are committed on branch `feat/task-617-grok-acp`, in
worktree `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp`. The worktree is clean and the
branch is **not pushed**. No agents or lanes are running.

**Next step:** the Phase 2 review. Nothing in Phase 2 has been reviewed yet.

The user asked to pause before Batch 8, but the pause arrived after Batches 8 and 9 had been committed.
History was not rewritten; `b720f2f18` is the last pre-Batch-8 commit. Resetting to it is destructive, so it
needs the user's explicit approval. The default is to keep the current history.

### Commits

| Item                                                       | Commit      |
| ---------------------------------------------------------- | ----------- |
| Batch 0 probe, fixtures, plan                              | `6ca659432` |
| Batch 1: SDK loader and dependency wiring                  | `d9b964db0` |
| Batch 2: host bundle externals                             | `0ba619bcc` |
| Batch 3: transport, update mapper, permission policy       | `1b2ad5f30` |
| Batch 4: vendor profile, session runner, fake ACP peer     | `eff0a4292` |
| Phase 1 review fixes and review files                      | `6163b042e` |
| Batch 5: `grokModel` shared types and file key             | `cd6ec1f57` |
| Batch 6: settings export and agent RPC get/set             | `91554e5ef` |
| Batch 7: frontend providers state and e2e fixture          | `2c551c7e1` |
| Merge of origin/main                                       | `72b5677d0` |
| Batch 8: `'grok'` in `SYSTEM_CLI_TYPES` and every consumer | `9966bd35d` |
| Batch 9: Grok profile, adapter, registration               | `ff87f761d` |
| HEAD (batches.md update)                                   | `140edfcb2` |

`batches.md` holds the per-batch evidence plus the "Batch 1 results" and "Batch 4 results" deviation notes.

### Phase 1 review (Batches 1–4): passed

- Logic review: APPROVED 7/10 (`code-logic-review.md`).
- Style review: REVISE 7/10 (`code-style-review.md`). After the fix round, the re-review was APPROVED 8.5/10
  (`code-style-rereview.md`).

## Next steps

1. **Phase 2 review.** Run code-logic-reviewer and code-style-reviewer in parallel on
   `git diff 5caeff54d..HEAD`, excluding the upstream content of merge `72b5677d0`.
   - Main files, under `libs/backend/cli-agent-runtime/src/lib/cli-agents/`:
     - `cli-adapters/grok/grok-acp-profile.ts`
     - `cli-adapters/grok-cli.adapter.ts`
     - `cli-detection.service.ts`
     - `lane-spawn-policy.ts`
     - `agent-spawn-environment.service.ts`
   - Shared types: `agent-process.types.ts`, `rpc-agents.types.ts`, `rpc-auth.types.ts`.
   - Settings and RPC: `file-settings-keys.ts`, `settings-export.types.ts`, `agent-rpc.handlers.ts`,
     `cli-model-list.service.ts`.
   - The frontend matrix row, permission note and labels, plus the core providers state.
   - The ptah-cli `agent-cli.ts` and `router.ts`.
   - Settings write path to trace: providers commit → `agent:setConfig` → `agentOrchestration.grokModel` →
     `MODEL_CONFIG_KEYS` → `options.model` → `session/set_config_option {configId:"model"}`.
   - Reviewers must check:
     - no env values or argv reach logs (they can carry API keys);
     - the real Grok error wording for `-32003` (rate limited), `-32000` (auth required) and `-32602`
       (unknown model);
     - `--no-leader` is always passed and `--always-approve` is never passed by default;
     - the permission policy answers with `allow_once`.
2. **Fix round and re-review** if either review returns REVISE. Then run the team-leader in completion mode.
3. **Known loose ends** to fix during Phase 2 or record:
   - `agent-process-manager.service.spec.ts:2624`: the `it.each` over antigravity, opencode and pi leaves out
     grok. Adding grok needs the mock to report it as installed.
   - The merge commit `72b5677d0` has the default message, without the Co-Authored-By line. Leave it alone;
     do not rewrite history.
   - Stdin backpressure in `acp-process-transport.ts` is not handled (Minor from the logic review).
   - Check `skill-synthesis-ui/.../clones/agent-models.store.ts:45` for a missing grok entry, if that list is
     meant to cover every CLI.
   - `rpc-handlers:test` flaked once under parallel load in Batch 8; it passed 3 of 3 isolated runs.
4. **Before the PR:**
   - QA screenshots of the settings matrix (dark and light).
   - A live Grok smoke test: spawn the lane, call the Ptah MCP tool, queue a follow-up, stop, resume. The
     local grok.com free quota was exhausted on 2026-10-06 (rolling 24 h).
   - Push and open the PR only when the user asks. End the PR body with the Claude Code attribution line.

## Rules for the next session

- Work only in the task-617 worktree. The main checkout `D:\projects\ptah-extension` must stay clean.
  Something kept writing `.claude/skills/ptah-surface-authoring/*` there earlier.
- Lanes: opencode, codex (pass `effort: "high"`; `minimal` fails on gpt-5.6-terra), or Glm (ptahCliId
  `pc-355b645d-35af-4974-84cf-9cf961ea0164`). **Never antigravity.**
- Run the degradation audit before every commit:
  `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`.
- Use scoped checks only: `npx nx run-many -t typecheck,test,lint -p <projects>`.
- The ESM-only SDK is loaded only by `acp/acp-sdk-loader.ts`. Specs reach it through `connectAcp`, and type
  imports use `import type` only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Related work outside this task

- PR #658 (opencode exit-1 fix and queue-next-turn, TASK_2026_591): all CI checks were green after
  `59bed7b84`, and it is ready to merge.
  - Still to check on a rebuilt host: opencode shows `messaging: queue`, and a long lane that recovers from a
    provider error ends as completed.
  - The opencode move to ACP and the TASK_2026_591 `opencode serve` Phase 2 are paused by the user.
- A possible new task: codex lanes fail when reasoning effort is `minimal` on `gpt-5.6-terra`. The adapter
  should map `minimal` to `low`/`none` for models that reject it.
- `~/.grok/leader.lock` and `leader.log` exist from earlier probes. Delete them only with the user's
  permission.

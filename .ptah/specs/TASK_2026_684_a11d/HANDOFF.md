# HANDOFF - TASK_2026_684_a11d (2026-10-17, end of session 3 of task 684)

Status at handoff: no subagent, CLI lane or Electron instance of this session is running. All work is committed
and pushed (last pushed commit `b57843023`); this HANDOFF.md edit is the only uncommitted change unless the
handoff commit landed. Check `git status -sb` first.

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model` (`W`)
- Branch: `feat/ollama-cloud-decision-model`; draft PR https://github.com/Hive-Academy/ptah-extension/pull/740
- Task folder: `W\.ptah\specs\TASK_2026_684_a11d\` (`context.md`, `task-description.md`, `implementation-plan.md`,
  `batches.md`, `phase-1..3-*-review.md`, `phase-4-code-logic-review.md`, this file)

## Goal

Follow-up to task 646 (PR #731, merged): set our decision model to Ollama Cloud `clef`
(https://ollama.com/library/clef:27b-cloud), bring-your-own decision providers (Jev or any `/v1/systemone` host),
filter the Ollama model list to decision-capable models, and add evals and tests.
End state: PR #740 implemented, reviewed, CI green, marked ready, merged by the user.

## Final user decisions (do not reopen)

| # | Decision |
| --- | --- |
| D1 | Reuse the existing `ollama-cloud` provider key (`ptah.auth.provider.ollama-cloud`). No separate key slot. |
| D2 | One generic custom `/v1/systemone` endpoint kind (base URL + key in secret storage + model). Jev and Ollama presets stay. |
| D3 | Filtered picker only, no auto-select, no default to clef. We set clef in our own settings. |
| D4 | With a key, a custom endpoint must use `https` except on loopback (`localhost`, `localhost.`, `[::1]`, `127.0.0.0/8`); without a key `http` is allowed. |
| Plan | The user APPROVED `implementation-plan.md` (2026-10-16). |
| R2-1 | (session 3) Drop `error.code` from logs entirely; log only the fixed error-name category. Done. |
| Live run | The user runs the gated live spec locally ONCE with their key after Batch 19 and shares the printed timing line. No agent handles the key. Batch 21 then applies the plan's timeout formula. |

## Done

`batches.md` header: Complete 18/23 (Batches 0-17).

- Phases 0-2: implemented, reviewed, APPROVED (`phase-2-code-logic-review.md`, final check 8/10).
- Phase 3 (Batches 11-16): implemented. Reviews `phase-3-code-logic-review.md` and `phase-3-code-style-review.md` both
  REVISE 6/10 with defects L1, L2, L3, S1, S2. **Revise round 1 fixes committed in `249d625a1`** (not yet re-reviewed):
  - L1 key write that persists then rejects is rolled back (`decision-model-writer.ts` `writeKey`/`restoreKey`).
  - L2 per-caller deadline over a shared `/api/show` lookup (`decision-model.catalog.ts` `joinLookup`/`startLookup`).
  - L3 body cap 1 MiB, model cap 256 (`ollama-catalog.schema.ts`).
  - S1 `DECISION_MODEL_CATALOG_SOURCES` + types owned only in shared `rpc-decision-model-catalog.types.ts`.
  - S2 error classification moved to `libs/shared/src/lib/utils/loggable-error-name.ts` (`loggableErrorName`);
    lane-routing re-export and the writer's `errorTypeOf` removed. Visible change: writer logs custom error classes as
    `'other'`.
  - Subagent-reported checks: run-many test/typecheck/lint for shared, lane-routing, rpc-handlers passed; audit TOTAL 294.
- Phase 4 Batch 17 (decision row editor): committed `69891d210`. Codex logic review `phase-4-code-logic-review.md`:
  **REVISE 6/10, 3 defects, not yet fixed**.

Session 3 commits (all pushed): `c3b4b2080` B11, `c382db95a` P2 fixes r1, `1d4905d60` B12, `0b783a5e0` P2 fixes r2,
`2bf93d7de` B13, `c7097e0a1`/`5051b9600` R2-1, `2e1bc7f04` B14, `5c45d7843` P2 final, `5892b9932` B15,
`641743bd1` B16, `69891d210` B17, `a3d04e808` P3 reviews, `249d625a1` P3 fixes r1, `b57843023` P4 review.

## In progress

Nothing is running. Two open revise cycles, each at round 1 of 2:

1. Phase 3: fixes committed; needs codex re-review (logic + style) of `249d625a1`.
2. Phase 4: three defects from `phase-4-code-logic-review.md` need a fix:
   - SERIOUS `decision-model-row.component.ts:732-746`: save success checked by truthiness; require
     `result.data.success === true`, treat other shapes as the fixed failure. Add a malformed-success spec.
   - MODERATE `decision-model-row.component.ts:514-547` + `decision-model-row.view.ts:371-380`: stored key counted
     for every edited custom URL; count it for D4 only when the draft URL has the same normalized origin as the saved
     custom URL (backend `decision-model-writer.ts` origin binding). Spec same-origin and different-origin http edits.
   - MODERATE `decision-model-suggestions.ts:127-135`: validate every model id and the full result contract before
     `ready`; invalid response shows the unavailable hint. Extend the malformed catalog spec.

## Open problems and notes

1. Electron is shared with peer sessions. At handoff TASK_2026_687 held it (port 9334). Earlier queue: 683, 678/687.
   Before launch: `ListAgents`, send "Electron: 684 launching" to live peers; after close "Electron: free".
   Never port 9333. Only the Phase 4 visual review needs Electron.
2. Lanes: at handoff only codex had confirmed room (weekly 62%, resets 2026-10-22). opencode monthly 92%.
   Codex reviews only, never implements. Claude subagents implement. Do not pass `taskKind` to `ptah_agent_spawn`.
   Last codex session (P4 review): `01a14a57-4fa4-7363-aa6e-fea00047d818`. Resume = give complete instructions.
3. `translation-proxy.sdk.integration.spec.ts` (auth-providers) fails locally with Windows `EPERM`; not ours.
4. After each commit `git restore tsconfig.base.json` if the hook reformatted it. Commit foreground (timeout 600000),
   push background, only when no agent edits `W`. Never `--no-verify`.
5. Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched. Audit TOTAL <= 294 (hard 297).
6. If this worktree is ever removed: `cmd /c rmdir <W>\node_modules` FIRST (junction), then `git worktree remove`.
7. Commit scopes from `.commitlintrc.json`: `lane-routing`, `rpc-handlers`, `shared`, `chat`, `task-specs`,
   `ptah-cli`, `ptah-extension-vscode`, `ptah-electron`. End commits with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Key files

- lane-routing: `libs/backend/lane-routing/src/lib/decision-model/` (`decision-model.catalog.ts`,
  `ollama-catalog.schema.ts`, `decision-model.keys.ts`, `decision-model.prober.ts`, `decision-endpoint.url.ts`,
  `system-one.client.ts`, ...), `lib/route-decide.service.ts`, `lib/failure-class/decision-model-failure-classifier.ts`.
- rpc-handlers: `libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts`,
  `decision-model-catalog-rpc.handlers.ts`, `agent-rpc.handlers.ts`.
- shared: `libs/shared/src/lib/utils/loggable-error-name.ts`, `types/rpc/rpc-decision-model-catalog.types.ts`.
- webview: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`, `.view.ts`,
  `decision-model-key-field.component.ts`, `decision-model-suggestions.ts`, `decision-model-row.endpoint.spec.ts`.

## Next steps (in order)

1. `git -C W status -sb` (commit this HANDOFF.md if uncommitted: `docs(task-specs): ...`; push in background).
2. In parallel (file-disjoint; only the subagent runs heavy checks):
   - `ptah_agent_list`, then codex lane (`role: code-logic-reviewer`, `workingDirectory: W`,
     `taskFolder: .ptah/specs/TASK_2026_684_a11d`, `deliverables: ["phase-3-re-review.md"]`, timeout 1200000,
     read-only, no tests, 40-call ceiling): re-review `git show 249d625a1` against L1-L3 and S1-S2 in the two
     phase-3 review files (logic + style in one file, verdict APPROVED/REVISE). Round 1 of 2.
   - frontend-developer Claude subagent: fix the 3 Phase 4 defects above (chat lib only, no commit), verify with
     Jest on the changed chat specs and `nx typecheck/lint @ptah-extension/chat`.
3. Commit; codex re-review of the Phase 4 fix (resume session above with full instructions). Max 2 rounds per cycle;
   at the cap report open defects or make one bounded correction plus an independent review.
4. Visual review (Phase 4): visual-reviewer subagent, dark + light, before (base `641743bd1`) / after screenshots of
   Settings > Agent Orchestration > Decision model. States list: Batch 17 report in `batches.md` / plan section 13
   (kind picker, Ollama Cloud notices, custom endpoint errors incl. "needs https", stored key Remove, Jev, focus rings).
   Electron coordination per note 1. Show screenshots to the user.
5. Phase 5 (Batches 18-20) with Claude subagents, then codex review of 18-20. After Batch 19 ask the user to run the
   live spec locally with their key (command in `batches.md`, Batch 19) and share the timing line.
6. Phase 6: Batch 21 (timeout formula from the user's numbers), Batch 22 (docs).
7. Push, `gh pr checks 740` green, `gh pr ready 740`; the user merges. User steps: select Ollama Cloud / clef in the app,
   check one `/orchestrate` pre-flight; add the `OLLAMA_API_KEY` repo secret for the weekly workflow.

## Verification commands (prefix `NX_NO_CLOUD=true`; one heavy check at a time)

- Libs: `NX_NO_CLOUD=true npx nx run-many -t test -p <A> <B> --parallel=1 --maxWorkers=2` (header must say N
  projects), then `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p <A> <B> --parallel=1`. Names:
  `@ptah-extension/lane-routing`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/chat`.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
  Never `nx test ptah-cli` or `nx test ptah-electron`.
- Audit: `npx tsx tools/degradation-audit/check-degradation.ts 2>&1 | grep -E "TOTAL|FAIL"` → `TOTAL 294` or lower.
- Manifest: `npm run manifest:check`.
- CI: `gh pr checks 740`; failed logs `gh run view <id> --log-failed | grep ...`.
- Never build/serve/e2e unless reproducing a CI failure.

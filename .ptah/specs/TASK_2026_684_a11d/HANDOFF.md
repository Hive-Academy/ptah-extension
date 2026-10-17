# HANDOFF - TASK_2026_684_a11d (2026-10-17, end of session 4 of task 684)

Status at handoff: no subagent, CLI lane or Electron instance of this session is running. All work is
committed and pushed except this HANDOFF.md edit (commit it first if `git status` shows it). Last pushed
commit before this file: `66f006b08`.

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model` (`W`)
- Branch: `feat/ollama-cloud-decision-model`; draft PR https://github.com/Hive-Academy/ptah-extension/pull/740
- Task folder: `W\.ptah\specs\TASK_2026_684_a11d\` (`context.md`, `task-description.md`,
  `implementation-plan.md`, `batches.md`, all phase reviews, this file)

## Goal

Follow-up to task 646 (PR #731, merged): set our decision model to Ollama Cloud `clef`
(https://ollama.com/library/clef:27b-cloud), bring-your-own decision providers (Jev or any `/v1/systemone`
host), filter the Ollama model list to decision-capable models, add evals and tests.
End state: PR #740 implemented, reviewed, CI green, marked ready, merged by the user.

## Final user decisions (do not reopen)

| # | Decision |
| --- | --- |
| D1 | Reuse the `ollama-cloud` provider key. No separate key slot. |
| D2 | One generic custom `/v1/systemone` endpoint kind (base URL + key in secret storage + model). Jev and Ollama presets stay. |
| D3 | Filtered picker only, no auto-select, no default to clef. |
| D4 | With a key, a custom endpoint must use `https` except on loopback; without a key `http` is allowed. |
| Plan | `implementation-plan.md` APPROVED (2026-10-16). |
| R2-1 | Never log `error.code`; only the fixed error-name category. |
| Live run | The user runs the gated live spec ONCE locally with their key and shares the printed lines. No agent handles the key. Batch 21 then applies the plan's timeout formula. |
| Nav gap | The user asked for `mb-3` under the settings tab bar (`b3475f839`); keep it. |

Orchestrator deviation (disclosed to the user, not objected to): the live spec no longer falls back to the
first catalog model when clef is missing; it fails unless `PTAH_LIVE_DECISION_MODEL` names another model
(`0aecad48b`, from the Phase 5 review).

## Done

`batches.md` header: Complete 22/23 (Batch 21 waits for the user live run).

Session 4 commits (all pushed):
- `046532cae`, `72def3853` Phase 3 L3: bounded streamed body read; stream body required. Reviews
  `phase-3-re-review.md`, `phase-3-re-review-2.md`, `phase-3-final-check.md` (APPROVED 8/10).
- `4ccf9f4a8`, `c131cae8a` Phase 4 logic defects (save success, origin-bound stored key, catalog
  contract). Reviews `phase-4-re-review.md`, `phase-4-re-review-2.md` (APPROVED 8/10).
- `f346b6eb1` Phase 5 Batches 18-20 (persistence spec, gated live spec + fixtures, weekly workflow
  `.github/workflows/decision-model-live-eval.yml`); `0aecad48b` review fixes. Reviews
  `phase-5-code-logic-review.md`, `phase-5-re-review.md` (APPROVED).
- `bbdd5d431`, `a75dc30e2`, `eda548d2c` Phase 4 visual fixes (height cap, fixed Save footer, reserved
  error slot, focus on open + Tab wrap, placeholders, stored-key Remove). Visual reviews
  `phase-4-visual-review.md` (REVISE), `phase-4-visual-re-review.md` (APPROVED),
  `phase-4-visual-check-round-2.md` (APPROVED). Code reviews `phase-4-visual-fix-logic-review.md`,
  `phase-4-visual-fix-re-review.md` (APPROVED), `phase-4-visual-fix-round-2-review.md` (REVISE at cap,
  edge cases recorded as follow-ups).
- `b3475f839` user nav gap; `e76096b7d` Main Agent popover cap from the trigger's free space (fixed the
  Electron Webview E2E failure the gap caused). Review `main-agent-popover-fix-review.md` (REVISE 7/10:
  pre-existing 160 px minimum can overflow very short windows; recorded as follow-up).
- `924e6f346` Batch 22 dated clef corrections in the task 646 docs.
- Docs/review commits: `460293200`, `ae89f9e48`, `748f641b1`, `6e0d72ab5`, `0954ea452`, `85ddc7ef7`
  (its message says "approves"; the file verdict is REVISE, see above), `66f006b08` (batch status +
  follow-ups section at the end of `batches.md`).

CI on `e76096b7d`: CI, Webview E2E, CLI E2E, Electron E2E all success. Docs-only commits after it were
pushed; their CI may still be running at handoff.

## In progress / waiting

1. USER: mark GitGuardian incidents 38304789 and 38304790 as false positives
   (https://dashboard.gitguardian.com/workspace/684886/incidents/38304789 and .../38304790). They are
   fake credentials (`https://user:secret@host.example` etc.) in commit `8a40121af`,
   `decision-endpoint.url.spec.ts:54-56,87` and a comment at `decision-endpoint.url.ts:85`. No history
   rewrite (same handling as PR #735).
2. USER: live run (bash, in `W`):
   `PTAH_LIVE_PROBES=1 OLLAMA_API_KEY=<key> npx jest -c libs/backend/lane-routing/jest.config.ts libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts --coverage=false --maxWorkers=2`
   (PowerShell: set `$env:PTAH_LIVE_PROBES='1'` and `$env:OLLAMA_API_KEY` first). The user shares the
   `DECISION_LIVE_LATENCY {...}`, `DECISION_LIVE_MODEL`, `DECISION_LIVE_MODEL_ID_FORMS` lines and any
   failed test names. Possible product findings: clef omitting `confidence`/`probabilities`; unknown
   model not answering 404/405.

## Open problems and notes

1. Electron is shared. Before launch: `ListAgents`, send "Electron: 684 launching" to live peers; after
   close "Electron: free". Never port 9333. At handoff 687/689 held it (port 9334); 683 also queues for it.
   684 needs Electron only if Batch 21 changes UI (it should not).
2. Lanes: only codex had confirmed room (weekly 73%, resets 2026-10-22). Codex reviews only, never
   implements. Claude subagents implement. Do not pass `taskKind` to `ptah_agent_spawn`.
3. A new push cancels CI runs in progress on this branch. Push after runs finish when you need a result.
4. `translation-proxy.sdk.integration.spec.ts` (auth-providers) fails locally with Windows `EPERM`; not ours.
5. Commit in the foreground (timeout 600000), then `git restore tsconfig.base.json` if the hook
   reformatted it; push in the background, only when no agent edits `W`. Never `--no-verify`.
6. Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched. Audit TOTAL
   is 294 (must stay <= 294, hard limit 297).
7. Screenshots in `.ptah/specs/TASK_2026_684_a11d/visual/` are git-ignored (72 + `rr-*` + `r2-*`).
   A local Playwright run can overwrite tracked screenshots of TASK_2026_555; restore those, never commit them.
8. If this worktree is ever removed: `cmd /c rmdir <W>\node_modules` FIRST (junction), then
   `git worktree remove`.
9. Commit scopes from `.commitlintrc.json`: `lane-routing`, `rpc-handlers`, `shared`, `chat`, `task-specs`,
   `ptah-cli`, `ptah-extension-vscode`, `ptah-electron`. End commits with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
10. The user saw `RPC timeout for method: agent:getConfig` in DevTools. Not caused by this branch: the
    handler, 1500 ms probe and 5 s client timeout are the same on `main`; the slow part is
    `cliDetection.detectAll()` (`agent-rpc.handlers.ts:434`). A fresh-profile run showed no timeout.
    Offered to the user as a separate task; no decision yet.

## Key files

- lane-routing: `libs/backend/lane-routing/src/lib/decision-model/` (`decision-model.catalog.ts`,
  `bounded-body-reader.ts`, `ollama-catalog.schema.ts`, `decision-model.config.ts`,
  `decision-model.types.ts` (`DECISION_MODEL_PROBE_TIMEOUT_MS`), `system-one.client.ts`
  (`SYSTEM_ONE_TIMEOUT_MS`), `system-one.live.spec.ts`, `system-one.live.fixtures.ts`),
  `lib/route-decide.service.ts`.
- rpc-handlers: `libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts`,
  `agent-rpc.handlers.ts`, `decision-model-catalog-rpc.handlers.ts`.
- shared: `libs/shared/src/lib/utils/loggable-error-name.ts`,
  `types/rpc/rpc-decision-model-catalog.types.ts`.
- webview: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`, `.view.ts`,
  `.popover.ts`, `.base-url-field.component.ts`, `decision-model-key-field.component.ts`,
  `decision-model-suggestions.ts`, `main-agent-reassign-popover.component.ts`;
  `libs/frontend/chat/src/lib/settings/settings.component.html:69`.
- Workflow: `.github/workflows/decision-model-live-eval.yml`.
- Batch 21 spec: `batches.md` "Batch 21" (~line 996) and `implementation-plan.md` (timeout formula, C16).

## Next steps (in order)

1. `git -C W status -sb`; commit this HANDOFF.md if uncommitted (`docs(task-specs): ...`), push in background.
2. `gh pr checks 740`; if a non-GitGuardian check failed, read
   `gh run view <id> --log-failed | grep -E "✘|Error|Expected|Received"` and fix (Claude subagent).
3. When the user shares the live-run lines: Batch 21 with a Claude backend-developer subagent (read
   `batches.md` Batch 21 and the plan's formula; apply the remote timeout from the user's numbers; fix
   any live-result findings). Then a codex `code-logic-reviewer` lane (read-only, deliverable in the
   task folder, 40-call ceiling, `ptah_agent_list` first). Max 2 revise rounds; at the cap report or
   make one bounded correction plus an independent review.
4. Mark Batch 21 COMPLETE in `batches.md` (header 23/23). Push; wait for CI green
   (`gh pr checks 740`; GitGuardian green after the user's marks).
5. `gh pr ready 740`. The user merges. User steps after merge: select Ollama Cloud / clef in the app,
   check one `/orchestrate` pre-flight; add the `OLLAMA_API_KEY` repo secret for the weekly workflow.

## Verification commands (prefix `NX_NO_CLOUD=true`; one heavy check at a time)

- Lib tests: `NX_NO_CLOUD=true npx nx run-many -t test -p <A> <B> --parallel=1` (header must say N
  projects); typecheck/lint: `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p <A> --parallel=1`
  (do not pass `--maxWorkers` to typecheck). Names: `@ptah-extension/lane-routing`,
  `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/chat`,
  `@ptah-extension/platform-core`.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
- Live spec without env must report skipped (7 skipped).
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
  Never `nx test ptah-cli` or `nx test ptah-electron`.
- Audit: `npx tsx tools/degradation-audit/check-degradation.ts 2>&1 | grep -E "TOTAL|FAIL"` -> `TOTAL 294`.
- CI: `gh pr checks 740`; `gh run list --branch feat/ollama-cloud-decision-model --limit 6`.
- Never build/serve/e2e unless reproducing a CI failure (then only the failing spec, filtered).

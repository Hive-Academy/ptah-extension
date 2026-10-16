# HANDOFF - TASK_2026_684_a11d (2026-10-17, end of session 2 of task 684)

Status at handoff: no subagent, CLI lane or Electron instance of this session is running. All work is committed.
The last push is the handoff commit (see "Done"); check `git status -sb` first.

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model` (`W`)
- Branch: `feat/ollama-cloud-decision-model`; draft PR https://github.com/Hive-Academy/ptah-extension/pull/740
- Task folder: `W\.ptah\specs\TASK_2026_684_a11d\` (`context.md`, `task-description.md`, `implementation-plan.md`,
  `batches.md`, `phase-1-code-logic-review.md`, this file)

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
| D3 | Offer only: filtered picker, no auto-select, no default to clef. We set clef in our own settings. |
| D4 | With a key, a custom endpoint must use `https` except on loopback; without a key `http` is allowed. Loopback = `localhost`, `localhost.`, `[::1]`, `127.0.0.0/8` (RFC 1122; Phase 1 review fix, not a reopening). |
| Plan | The user APPROVED `implementation-plan.md` (2026-10-16). |
| Live run | The user runs the gated live spec locally ONCE with their key and shares the printed timing line. No agent handles the key. Batch 21 then applies the plan's timeout formula. |
| Old worktree | 2026-10-17: the user said remove `.claude-worktrees/decision-model-routing` + branch. DONE. |

## Done (this session)

Batches 0-10 of 22 are COMPLETE (`batches.md` header: Complete 11/23). Phases 0, 1 and 2 implementation done.

| Commit | Content |
| --- | --- |
| `096f014bc` | Merge `origin/main` (after #731) into the branch, no conflicts |
| `5530ec423` | Batch 0: ~250 file:line citations re-checked, 10 pre-existing drifts corrected, no material findings |
| `be50ce134` | Batch 1: `isCloudTag`/`toCloudId` moved to `@ptah-extension/shared` (`ollama-cloud-model-id.ts`) |
| `c1b558dec` | Batch 2: shared contracts. `decisionModelCustomApiKey` is on `AgentSetConfigParams` (write-only), NOT the read DTO (deliberate deviation from batch text) |
| `8a40121af` | Batch 3: `decision-endpoint.url.ts`, `decision-model.keys.ts` (`DecisionModelKeys`), member schemas |
| `299c53e5c` | Batch 4: Jev key callers moved to the `'jev'` key slot (snapshot/set/restore); rollback restores the raw stored value |
| `a98d0da4b` | Batch 5: shared selection unions widened; `decision-model-row.view.ts` (helpers moved from `provider-consumer-rows.ts`) |
| `08c59dc56` | Batch 6: `decision-model.target.ts` resolver; `DECISION_REQUEST_TIMEOUT_REMOTE_MS = 3000`; + codex phase 1 review |
| `13f539e85` | Phase 1 review fixes: loopback 127/8 + `localhost.` (backend + row hint); model fields `trim().min(1).max(128)` |
| `076b0308f` | Batch 7: config delegates to resolver; per-target timeout in `pipeline/model-refine.ts` |
| `6843908d6` | Batch 8: `decision-model.prober.ts` (`DecisionEndpointProber`), `systemOneUrl` path-preserving join; + approved re-review |
| `b239f55b8` | Batch 9: union gains `ollama-cloud`/`custom`; status by probe mode; classifier; rpc-handlers equality |
| `26e6b76b0` | Batch 10: `decision-model.types.spec.ts` (28 cases), `decision-model.config.endpoint.spec.ts` (63 cases) |

Pushed to origin up to `6843908d6`; `b239f55b8`, `26e6b76b0` and the handoff commit are pushed by the handoff push
(verify with `git status -sb`: expect "in sync"; if "ahead", push again in the background).

Reviews:
- Phase 1 (Batches 1-5): codex code-logic review REVISE 7/10 (2 MINOR) -> fixed in `13f539e85` -> re-review round 1
  APPROVED 9/10 (`phase-1-code-logic-review.md`). Revise rounds used for Phase 1: 1 of 2.
- Phase 2 (Batches 6-10): NOT reviewed yet. This is the next step.

Checks at handoff (all scoped, all pass): lane-routing 24 suites / 679 tests; rpc-handlers tests; typecheck + lint for
shared, auth-providers, lane-routing, rpc-handlers, chat; chat `settings/providers` 712 tests; degradation audit
`TOTAL 294` (limit 297), no FAIL.

Other session actions:
- Removed worktree `.claude-worktrees/decision-model-routing` and deleted local branch `feat/decision-model-routing`
  (user approved). Visual worktrees `646-base-shots` and `646-after-shots` still stay until the user says otherwise.
- Created the missing `node_modules` junction in `W` (to `D:\projects\ptah-extension\node_modules`). Without it,
  40 auth-providers suites fail with "Could not locate module marked". Main `node_modules` verified intact (1332 dirs).

## In progress

Nothing is running. Batch 11 has not started.

## Open problems and notes

1. **Phase 2 review points to give codex** (in addition to the normal code-logic focus):
   - Batch 6: the Ollama Cloud base-URL override is only trimmed, not run through `parseEndpointBaseUrl`, so an override
     with userinfo, query or fragment is not refused (the plan has no rule). Judge whether a key can leak.
   - Batch 8: prober 401/403 carry fixed `keyRefused`/`keyRequired` text; plain-http key to a non-loopback host returns
     `keyNeedsHttps` without a request; probe errors mask URLs as `<url>`; client debug log records the origin only.
   - Batch 9: `isMarkedUnsupported()` became async; a 404 re-check probes only when the resolved base URL equals the failed
     call's base URL; the agent-rpc fallback row uses the same `reportsConfidence` rule as `dto()`.
   - Batch 10 found no production defect.
2. `translation-proxy.sdk.integration.spec.ts` (auth-providers) fails locally with Windows `EPERM` on temp-dir teardown.
   It does not touch this task's code. Not a regression; do not chase it.
3. The lint-staged hook runs `nx format:write`, which can reformat `tsconfig.base.json` outside the commit. After each
   commit run `git restore tsconfig.base.json` if it shows as modified (it did not happen this session). Commit in the
   foreground with a 600000 ms timeout.
4. Commit subjects lower-case; scopes from `.commitlintrc.json` (`lane-routing`, `rpc-handlers`, `shared`, `chat`,
   `auth-providers`, `task-specs`, `platform-core`, ...).
5. Lanes: at handoff only codex had confirmed room (weekly 53%, resets 2026-10-22). opencode monthly 92% (near limit).
   Codex is the reviewer: never use it to implement. Claude subagents implement. `ptah_agent_spawn` rejects `taskKind`.
   Codex "resume" with a large context starts a fresh lane with a handoff brief: always give complete instructions.
   Last codex session id (phase 1 re-review): `01a146ed-a652-7113-ab1b-07f8a5e57d76`.
6. Push only when no agent edits `W`: the pre-push hook runs a build gate that reads the working tree.
7. Electron is shared with peer sessions (649, 674, 678, 679, 681, 683). Before any launch send "Electron: 684 launching"
   to live peers (`ListAgents` + `SendMessage`), after close "Electron: free". Never port 9333. At handoff 679 had freed
   it and 683 had asked for the next slot. This task needs Electron only for the Phase 4 visual review.
8. Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched. Never raise a degradation
   baseline (Batch 5 briefly added one chat site; fixed with `URL.canParse`; prefer non-throwing APIs).
9. If this worktree is ever removed: `cmd /c rmdir <W>\node_modules` FIRST (junction), then `git worktree remove`.

## Key files

- Decision model (lane-routing): `libs/backend/lane-routing/src/lib/decision-model/`
  `decision-model.types.ts`, `decision-model.config.ts`, `decision-endpoint.url.ts`, `decision-model.keys.ts`,
  `decision-model.target.ts`, `decision-model.prober.ts`, `decision-model.probe.ts`, `decision-model.detail.ts`,
  `system-one.client.ts`; `lib/routing-constants.ts`; `lib/pipeline/model-refine.ts`;
  `lib/failure-class/decision-model-failure-classifier.ts`; `lib/route-decide.service.ts`.
- Config RPC: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (`writeDecisionModel` ~`:856-936`).
- Shared: `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `rpc-decision-model-catalog.types.ts`,
  `libs/shared/src/lib/providers/ollama-cloud-model-id.ts`.
- Webview: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.ts`,
  `decision-model-row.component.ts`, `provider-consumer-rows.ts`.
- Live-test pattern: `libs/backend/auth-providers/src/lib/model-lists.live.spec.ts`,
  `.github/workflows/model-lists-probe.yml`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model status -sb` (expect clean, in sync;
   push in the background if ahead). Confirm `W\node_modules` is a junction.
2. Phase 2 review: `ptah_agent_list`, then a codex lane (`role: code-logic-reviewer`, `workingDirectory: W`,
   `taskFolder: .ptah/specs/TASK_2026_684_a11d`, `deliverables: ["phase-2-code-logic-review.md"]`, timeout 1200000,
   read-only, no heavy commands, 40-call ceiling) on the Batch 6-10 commits, read with `git show <sha> -- libs/`:
   `08c59dc56`, `076b0308f`, `6843908d6`, `b239f55b8`, `26e6b76b0` (`13f539e85` is the Phase 1 fix, already reviewed).
   Include the review points in "Open problems" 1. Fix defects with a Claude subagent, re-review (max 2 rounds).
   While the review runs, Batch 11 may start (Phase 3 builds on Phase 2; fix review defects on top).
3. Phase 3 (Batches 11-16, write path, catalog, `agent:listDecisionModels` RPC, DI guards): one Claude subagent per batch
   per `batches.md`; sequential unless the batch says otherwise; one heavy check at a time; commit each batch after
   its checks pass and no agent edits `W`. Review: codex code-logic + style on the combined diff of 11-16.
4. Phase 4 (Batch 17, decision row editor): frontend-developer subagent; codex code-logic review + visual-reviewer
   subagent (Electron coordination per note 7; before/after screenshots in dark and light).
5. Phase 5 (Batches 18-20: persistence proof, live eval spec, live eval workflow): codex review of 18-20 combined.
   After Batch 19: ask the user to run the live spec locally with their key (command in `batches.md`, Batch 19) and
   share the timing line. No agent handles the key.
6. Phase 6 (Batch 21 timeout formula from the user's numbers; Batch 22 docs).
7. Push, CI green (`gh pr checks 740`), `gh pr ready 740`; the user merges. User-run steps: select Ollama Cloud / clef
   in the app and check one `/orchestrate` pre-flight; add the `OLLAMA_API_KEY` repo secret for the weekly workflow.

## Verification commands (prefix `NX_NO_CLOUD=true`; one heavy check at a time)

- Libs: `NX_NO_CLOUD=true npx nx run-many -t test -p <A> <B> --parallel=1 --maxWorkers=2` (header must say N
  projects), then `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p <A> <B> --parallel=1`. Names use the
  `@ptah-extension/` prefix (`@ptah-extension/lane-routing`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`,
  `@ptah-extension/chat`, `@ptah-extension/auth-providers`). Typecheck excludes specs: check specs with
  `ptah_get_diagnostics` or Jest.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
  Never `nx test ptah-cli` or `nx test ptah-electron`.
- DI / RPC surface guards (Batches 13-16): see "Verification rules" in `batches.md`.
- Audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | grep -E "TOTAL|FAIL"`
  must say `TOTAL 294` or lower and no FAIL (hard limit 297).
- Manifest: `npm run manifest:check`.
- CI: `gh pr checks 740`; failed logs `gh run view <id> --log-failed | grep ...`.
- Never build/serve/e2e unless reproducing a CI failure; never `--no-verify`; commit in the foreground, push in the
  background.

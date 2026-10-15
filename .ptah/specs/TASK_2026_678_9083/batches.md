# Batches - TASK_2026_678_9083

Total tasks: 66 | Batches: 28 (26 code batches + 2 user-run gates; B8F split into 8F0, 8FA-8FE, plus the bounded correction 8FG) | Complete: 25/28 | Phases A, B and C CLOSED; B9-B16 done; B0 waived (D34); next: Phase D reviews (B11-B16), then B17, B18

Worktree for every edit, check and commit: `D:/projects/ptah-extension/.claude-worktrees/command-center`
(branch `feat/command-center`). Task folder: `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083`
(abbreviated `TASK/` below). All other paths are absolute.

Sources: `implementation-plan.md` rev 3 plus binding **Amendment A1** (plan lines 118-137, which override any
conflicting plan text), `task-description.md` rev 3 (AC1-25), `design-spec.md` rev 3, `prototype/command-center.html`,
`decisions.md` #2, #3, #7, #13, #14, #17, #18, #19, and the carried Moderates in `design-spec-review.md` (R3-1 to R3-13)
and `implementation-plan-review.md` (S1 resolved by A1, M1 open).

## Verification rules (repeat verbatim in EVERY lane or subagent prompt)

From `CLAUDE.md` (STRICT, memory-safe):

- Verify only the project(s) the batch changed. Use the batch's one scoped command below. For one-off spec runs:
  `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Never run workspace-wide checks and never `nx run-many` across projects the batch did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets.
- Cap concurrency: `--parallel=1` for Nx, `--maxWorkers=2` for Jest.
- One heavy check at a time across all lanes; never start a second one while one is in flight.
- One foreground run with a long timeout; filter output (`| tail -40`, `grep`) instead of re-running.
- With `nx run-many -p A B`, confirm the header names the requested project count. Never use positional
  `nx test A B`.
- Lanes never run git. The team-leader owns commits. Executors never edit `batches.md` or `task.md`.

## Plan validation

Status: PASSED WITH RISKS

Stress-test notes: every file named by the plan was checked on disk at `054ac18ca`. Missing items, ordering defects and
unowned behaviour were found; none contradicts the architecture, so each is carried as a RISK with a mitigation task
rather than a BLOCKER. Amendment A1 closes review finding S1 (option a: Confirm is never delivered to the model).

Assumptions:

- `AskUserQuestion` answers are free-form strings. `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.ts:16,137-144`
  types `answers: Record<string,string>` with no option-membership check, so the page can return a fixed non-actionable
  text on Confirm (Decision D1). Verified in code; Task 8.3 adds a spec that the delivered answer never contains
  "Confirm" or any affirmative token.
- Persona reaches the SDK on resume. `sdk-agent-adapter.ts` `resumeSession` spreads `config` into its session config
  (`...config`, about line 1240) and `AISessionConfig.systemPrompt` exists (`libs/shared/src/lib/types/ai-provider.types.ts:167`),
  and `sdk-query-options-builder.ts:1766-1779` reads `sessionConfig.systemPrompt` as `userSystemPrompt`. Verified by
  reading; Task 1.3 pins it with a spec on the `resumeSession` call arguments.
- Chat RPC schemas are `.passthrough()` (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:57-95`), so
  today an extra field would pass unchecked. Task 1.2 adds an explicit, length-bounded `systemPrompt` field instead of
  relying on passthrough.
- Feature-to-feature imports are allowed (`eslint.config.mjs` `type:feature` row), so `@ptah-extension/command-center`
  may import `@ptah-extension/chat` (`ChatStore` exported at `libs/frontend/chat/src/lib/services/index.ts:13`) and
  `@ptah-extension/chat-streaming`. `chat` and `tribunal-panel` must never import `command-center`; each phase review
  checks it, and `nx lint` enforces direction for chat-state (data-access).
- The VS Code initial-view spec does not pin the surface list
  (`apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts:97-108`), so adding
  `command-center` needs no VS Code change. Verified; Task 15.1 re-checks with a grep.
- No webview CSP blocks a Blob-URL AudioWorklet module (grep found a CSP only in `apps/ptah-electron/src/assets/preparing-workspace.html`).
  Unverified at runtime; Task 10.1 falls back to text mode with a safe message when `audioWorklet.addModule` rejects,
  and Gate B18 verifies capture in Electron.
- CLI lanes can read `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/*` (outside the worktree).
  Unverified; if a lane cannot read it, the orchestrator pastes the five source files (vad, sentence-chunker,
  tts-playback-queue and two specs) into the B9 prompt.
- The preimplementation spike (B0) can be run by the user with the prototype HTML in the Electron renderer for frame
  timing and the existing voice settings test path for STT/TTS timing. Unverified; B0 records the method used.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| R1. Rewind activation needs the persona, but the plan's Unit 1/3 lists omit its RPC path: `session:rewindFiles` params (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:547-563`), handler call `ensureSessionActiveForRewind(sessionId, sessionId, workspacePath)` (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1405`), frontend `ClaudeRpcService.rewindFiles` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:351`) called from `chat-view.component.ts:1677,1757`. Without them a rewind restarts the live query without the persona and every later turn loses it. | HIGH | Tasks 1.1 and 1.3 (shared params, handler pass-through), Task 16.3 (core RPC parameter, chat-view caller). |
| R2. Plan orders the route (Unit 8) before the `ViewType`/`SURFACE_ROUTE_IDS` change (Unit 9), but `surfaceActiveFor('command-center')` and `setCurrentView('command-center')` need the id first, and `webview-routing.spec.ts` checks routes against the id list. Precedent `45e549bd8` (apps surface) landed id, route and routing spec in one batch. | MEDIUM | B15 lands id, route and routing spec together (shared + webview); B16 (nav, regular-chat link) follows. |
| R3. Review M1: `ChatStore.handleQuestionResponse` takes the deciding tab from `tabManager.activeTabId()` (`libs/frontend/chat/src/lib/services/chat.store.ts:500-509`), not the marked tab; a Command Center answer while regular chat shows another tab cancels the wrong tabs' copies. | MEDIUM | Task 4.3 adds an optional explicit `decidingTabId`; Tasks 6.1 and 13.1 pass the marked tab ID. |
| R4. Paid Tribunal spawns (S1 / A1): the model must never receive Confirm in the discovery turn; a model may still spawn during discovery because no spawn-free MCP profile exists (`ai-provider.types.ts:150`). | HIGH | Task 8.3 (A1 items 1-4: fixed non-actionable answer, Decline on deny/timeout/non-delivery, Decline-first check, one launch turn per proposal after registration, discovery-turn spawn shown provisional and never registered); Task 13.1 (click/key-only card); Gate B18 manual check. If B18 observes a discovery-turn spawn, the orchestrator escalates a host-side per-root hold (plan Risks paragraph 2) before release. |
| R5. New-lib skeleton in plan Unit 4 omits `eslint.config.mjs` (every feature lib has one, e.g. `libs/frontend/mcp-apps-page/eslint.config.mjs`), the commitlint scope, and the `chat-state` barrel export for new services (`libs/frontend/chat-state/src/index.ts`). | MEDIUM | Task 5.1 (eslint config, `command-center` scope in `.commitlintrc.json`); Tasks 2.2, 2.3, 3.1 export from the chat-state barrel. |
| R6. No plan unit owns the spoken-content filter (plan line 38: strip code/diffs/tools/links/secret-shaped text, 600 chars or 4 sentences, 180 for status) or the status narration queue (plan line 32: dedupe by `{root,workId,stateOrPhase}`, turn boundaries, revoke stale). | MEDIUM | Task 9.4 (`spoken-text.ts`), Task 10.3 (`status-narrator.ts`). |
| R7. No plan unit owns the `COMMAND_CENTER_STATUS_CONTEXT` builder (plan line 32, 2 KB cap, no secrets or raw tool output). | MEDIUM | Task 8.2 (`status-context.ts`); Task 6.1 sends it only on Command Center status turns. |
| R8. Design spec says host calls use `MESSAGE_HANDLERS`; the plan (line 15) forbids a root `MESSAGE_HANDLERS` provider, private transport listener or surface claim. Plan governs (later gate). | LOW | Task 6.1 and B14 consume existing `ChatStore`/tab state only; the phase B and D reviews check that no handler provider is added. |
| R9. `tab-manager.service.ts` is 3119 lines and `chat-view.component.ts` 1948; broad edits risk regressions in unrelated tab flows. | MEDIUM | Tasks 3.2 and 16.2/16.3 keep edits surgical and put new logic in new files; new behaviour gets new focused spec files instead of growing the 1000-2500-line specs. |
| R10. Persona text is renderer-supplied on `chat:continue`/`chat:resume`/`session:rewindFiles`. | MEDIUM | Task 1.2 bounds `systemPrompt` length at every schema; Task 2.2 keeps the persona a fixed constant applied only to tabs with a validated `commandCenterOrigin`. Never global, never unmarked tabs. |
| R11. Voice/scene work is gated on the user-run spike (B0); if the user cannot run it promptly, Phases C and D stall. | MEDIUM | B0 is requested immediately and runs alongside B1-B8, which do not depend on it (Decision D2). |
| R12. Speaker echo cannot be separated by RMS alone (plan Risks paragraph 3). | MEDIUM | Task 10.2 (sustained onset plus echo correlation during playback, text/Stop fallback); Gate B18 speaker and headset cases. |
| R13. Canvas draw cost omits composite and labels; prototype FPS is not acceptance evidence (plan Risks paragraph 5, design review R3-6, R3-7). | MEDIUM | Tasks 11.2, 11.3, 12.1 carry the frame-loop hygiene (R3-13); Gate B18 runs the Electron Scene and Voice Gate with full-frame traces. |
| R14. Design review Moderates/Minors R3-1 to R3-13 must land in code. | MEDIUM | R3-1, R3-9: Task 11.1. R3-2, R3-3, R3-4, R3-11: Task 11.3. R3-8, R3-10: Task 11.2. R3-12: Tasks 13.3/13.4. R3-13: Tasks 11.2, 12.1. R3-5 (stale screenshots) and R3-6/R3-7: Gate B18. |
| R15. ElevenLabs synthesis has no host-side cancel and costs money per request. | LOW | Task 9.3 (two in flight, generation revocation), Task 10.3 (dedupe narration); B18 records cold-worker and post-barge-in latency separately. |
| R16. Persisted writes (tab marker, last-session record, run manifest) change what is stored per workspace. | MEDIUM | Tasks 2.1, 2.3 (validate on restore, corrupt values sanitize to ordinary tabs/absent records); Mode 3 write-path trace from each write to its reader. |

Edge cases:

- Command Center tab closed in regular chat: warn, abort stream, remove tab; last-session record survives for Resume - Tasks 2.3, 3.2, 6.1.
- App restart with a marked tab, then a send from regular chat: persona still attached on inactive resume; lock not restored - Tasks 1.3, 2.1, 3.1, 4.2.
- Tab-to-SDK rekey (`session:id-resolved`) while the lock is engaged or a queued flush is pending - Tasks 3.1, 4.1.
- Regular-chat queued content present when the lock engages: held, never flushed or cleared; sendable after unlock - Task 4.1.
- Stop response, permission decisions and question answers stay enabled while locked - Tasks 4.1, 4.2, 16.2.
- Interleaved stream events from two tabs; sibling roots and unattributed agents never enter the tree - Tasks 6.1, 8.1.
- Provisional child tab ID replaced by SDK ID without duplicate node - Task 8.1.
- Roster proposal malformed, stale nonce, wrong root, first option not Decline, no launchable lane, round count out of bounds - Task 8.3.
- Confirm clicked twice, replayed proposal, timeout auto-resolve, non-delivery, page exit while pending - Tasks 8.3, 13.1.
- Two Tribunal runs under one root; restart with a registered run whose task folder is missing (phase unavailable with reason) - Tasks 7.2, 8.1, 8.3.
- Silence/noise clip, empty transcript, payload near 25 MB, transcription RPC timeout - Tasks 9.1, 10.1, 10.2.
- Barge-in during playback (stop audio, queue exactly one utterance until the turn and its tool call finish); explicit Stop calls `chat:abort` first - Task 10.2.
- Code-heavy reply, diffs, links, secret-shaped strings in speech; caps and "See text for the rest" cue - Task 9.4.
- Mic denied, missing provider or key, synth or playback failure, chat/tool failure - Tasks 10.2, 13.3, 14.2.
- Canvas 2D unavailable: accessible list only - Task 12.2.
- More than 24 owned nodes: overflow completed nodes collapse to a count chip; the list keeps all - Tasks 11.2, 13.2.
- Unknown provider ID: monogram; no `glm` to `ollama` alias - Tasks 11.1, 11.3.
- Reduced motion, hidden window (visibility pause), DPR above 2, theme switch - Tasks 11.3, 12.1, 12.2.
- Navigation away: mic, AudioContext, worklet, object URLs, timers, listeners, rAF and observers released; session identity kept - Tasks 10.2, 12.2, 14.2.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| D1 | On explicit Confirm, the page answers the discovery `AskUserQuestion` with the fixed text `Recorded. End this turn now without starting any agent; launch instructions follow in a separate message.` Deny, timeout, page exit and non-delivery answer `Decline`. | (a) fixed non-actionable text; (b) answer `Decline` on Confirm too | A1 item 1 forbids any affirmative answer and specifies only the Decline cases; review S1 option (a) recommends a fixed non-actionable value; answers are free-form (assumption 1). Option (b) would make Ptah tell the user the run was declined just before the launch turn arrives. | yes |
| D2 | The B0 spike gates the voice (B9-B10) and scene (B11-B12) batches only; B1-B8 proceed in the meantime. | gate everything from plan Unit 3 on; gate voice/scene only | Plan Unit 0 row says "before units 3-6", while plan lines 60 and 113 say "before voice/scene units". The spike measures frame and audio budgets, which only voice and scene code consume. | yes |
| D3 | Surface id, route and routing spec land in one batch (B15) after the page exists; Electron nav and the regular-chat "Open Command Center" link follow in B16. | plan order (route, then id) | R2; precedent commit `45e549bd8`. | yes |
| D4 | Plan units are split into smaller sequential batches (about 10 files or fewer; B5 has 12 because 8 are config boilerplate mirrored from `mcp-apps-page`). | keep plan units as batches | Team-leader batch-size rule and the orchestrator's ~10-file limit; Units 2, 3, 6b, 7 and 8 exceed it with specs counted. | yes |
| D5 | Every batch is sequential; no two batches run concurrently. | run Tribunal (B7) and voice primitives (B9) in parallel | `CLAUDE.md` allows one heavy check at a time across all lanes; the time saved is small next to the risk of overlapping Jest runs. | yes |
| D6 | Each secondary-entry alias goes into `tsconfig.base.json` in the batch that creates its target (Tribunal `phase` in B7, `ui/provider-brand-art` in B11, the lib alias in B5) instead of all in plan Unit 4. | all aliases in Unit 4 | Avoids aliases pointing at missing files between commits. Batches run sequentially, so the shared file is never edited concurrently. | yes |
| D7 | The last-session record and Tribunal run manifest go in a new `chat-state` file `command-center-records.ts`, not inside `tab-persistence.ts`. | extend `tab-persistence.ts` | `tab-persistence.ts` serializes the tab envelope only (`PersistedTabState`, lines 104-108); the records must survive tab close (plan line 16). | yes |
| D8 | Phase A fix round fixes Serious L1 now in Batch 4F (one backend project, 2 files). | fix now; defer | Fix-round rule: Blocking and Serious are fixed. Orchestrator confirmed L1 at `chat-slash-command-router.service.ts:141-150` and `chat-session.service.ts:983-984`. | yes |
| D9 | Moderate L2 (first `chat:start` on a marked tab carries no persona) is deferred to Task 6.2 in Batch 6, not fixed in Batch 4F. | fix now in the sender (cheapest, same file as B4); defer to B6 | Fix-round rule: a Moderate is fixed now only if it can break a lane config or lose data. L2 does neither: it yields a persona-less session and no product caller of `createCommandCenterTab` exists until B6 (review L2). The race only opens when B6 adds the coordinator start, so B6 is where it closes; the review recommends the same. | yes |
| D10 | Moderates L3 (close leaves the send lock engaged) and L4 (records write failure ignored, `tab-manager.service.ts:991,1930-1933`) are deferred to Batch 6A. | fix now; defer | L3: no production caller of `engage` until B6/B14, and a stale lock on a dead root holds no live send (sends pass tab ids). L4: the failure comes from storage; ignoring the `false` hides it but does not cause it, and the SDK session itself stays listed by `session:list`, so no user data is lost. Neither breaks a lane config. | yes |
| D11 | Batches 5 and 6A may run as two concurrent implementation lanes (amends D5 for this pair only). Neither lane runs any `nx` or `jest` command; the orchestrator runs the two scoped checks one after the other, each in the foreground. | keep strictly sequential; parallel with lanes running their own checks | File-disjoint: B5 writes only `libs/frontend/command-center/**`, `tsconfig.base.json` and `.commitlintrc.json`; B6A writes only 4 `libs/frontend/chat-state` files. B6A depends on B3 only (its "after B6" was D5 ordering, not code). Different Nx projects. Lanes running their own checks would break the one-heavy-check rule, so checks stay with the orchestrator. B7 is excluded (shares `tsconfig.base.json` with B5); B6 is excluded (depends on B5). | yes |
| D12 | Task 8.4 is verified by a per-site classification table in the B8 report plus the team-leader's on-disk read of every `catch`/`.catch` under `libs/frontend/command-center/src` (non-spec). Neither the lane nor the team-leader runs `nx run degradation-audit:lint`; CI runs it on push (`.github/workflows/ci.yml:81-84`). | lane runs the audit; on-disk classification | The audit has no path flag (`check-degradation.ts:863-865` reads only `--self-test`, `--self-test-parse-guard`, `--update-baseline`) and its inputs are `libs/**/src/**/*.ts` and `apps/**/src/**/*.ts` (`tools/degradation-audit/project.json`), so it is a workspace-wide scan, which `CLAUDE.md` forbids unless the user asks. The detector rules are explicit enough to classify each site by reading it. | yes |
| D13 | The run-manifest contract gaps found at B8 (TL-1 multi-run overwrite, TL-2 empty role rejected by the schema, TL-3 close does not remove the manifest) go into Batch 8F, the Phase B fix round, seeded now as PENDING. Phase B review findings that the fix-round rule covers are appended to B8F when the verdict returns; B8F's re-review is the one re-review. | (a) seed B8F now; (b) record as a named later task with the user; (c) fold into B13 (page wiring) | Two runs and restart-with-manifest are B8 validation notes and plan :16, :74, :98 (AC 10-16 rows at plan :54-56), so this is in scope, not a later task. `command-center-records.ts:29,104,111,117` keys `runs` by `rootTabId`; `:18` requires a non-empty `role` while `tribunal-run-coordinator.ts:54` writes `role: item.role ?? ''` for Council/Forge/Race, so every non-role run is withheld once the real transport is wired; `tab-manager.service.ts` has no `removeRunManifest` call (only `setActiveTabId` at :1003, :1379 and `writeLastSession` at :1965). B13 is presentational and should not carry a persisted-schema change. No production caller of the manifest API exists yet, so nothing is lost before B8F. | yes |
| D14 | Batch 8 keeps its local `rosterIsLaunchableLocally` copy (`tribunal-roster-proposal.ts:35-51`) for now; the Phase B style review decides between the copy and widening `@ptah-extension/tribunal-panel/phase` to export `rosterIsLaunchable`. A widening, if chosen, lands in B8F. | keep copy; widen the phase entry now | The phase entry was scoped narrow on purpose (B7, Decision D6); the copy mirrors `tribunal-roster-rules.ts:42-106` and can drift. This is a structure call that the style reviewer owns. | yes |
| D14-R | D14 resolved by the Phase B style review (ruling 3): widen `@ptah-extension/tribunal-panel/phase` with `rosterIsLaunchable`, the two round-cap constants, the role and move values and their types (Batch 8FB), and delete the local copy (Batch 8FC). | keep copy | `code-style-review.md` S2, S3, ruling 3: the rule file is pure, `VendorLane` already accepts the parsed lanes, and the copy has already drifted. | yes |
| D15 | Root cause of style S1 (unformatted files): **no git hook has ever run in this worktree**. `core.hooksPath` is the relative `.husky/_`, which git resolves per worktree. Husky created that folder only in the main checkout, and `node_modules` here is a symlink, so `prepare` never ran. B1-B8 skipped lint-staged (Prettier and lint), commitlint and pre-push. The team leader ran `npx husky` in the worktree on 2026-10-15. It wrote a self-ignored `.husky/_/` and set the shared `core.hooksPath` to the same `.husky/_` value. `npx commitlint --from main --to HEAD` passes for every existing commit. | leave hooks off and format by hand; restore hooks | `.husky/pre-commit`, `.lintstagedrc.mjs` (`nx format:write --files=…` then `nx affected --target=lint`); `ls .husky/_` was missing; `nx format:check --files=<file>` flags the file correctly, so the formatter itself works. Follow-up outside this task: every worktree created per `CLAUDE.md` has the same gap; recommend a separate chore so worktree setup runs `npx husky`. | yes (delete `.husky/_`) |
| D16 | With hooks restored, every commit that stages TS runs `nx affected --target=lint` on about 80 projects, because this branch changes `libs/shared` (nx `parallel: 2`). That conflicts with the `CLAUDE.md` memory rule against workspace-wide checks. **Open question Q1 for the orchestrator** (answered (a), orchestrator default: D25). Default until answered: keep the hook (never bypass it) and run each TS commit alone in the foreground with a long timeout and no other heavy check in flight. Docs-only commits run only `nx format:write`. | (a) keep hook, serialise commits (recommended); (b) user approves a one-off scoped lint arrangement; (c) bypass (refused) | `npx nx show projects --affected --withTarget=lint` lists about 80 projects; `nx.json:4` sets `parallel: 2`. | yes |
| D17 | 8F0 formats 41 files whole: 37 new, 3 modified that were Prettier-clean on `main`, and `chat.store.ts`. It excludes `session-loader.service.ts` and `chat-rpc.schema.spec.ts`. Two in-hunk drifts stay as recorded residue: `session-loader.service.ts:997` and `chat-rpc.schema.spec.ts:36-44`. | reformat everything; hand-wrap hunks in the dirty files | `main` check with `prettier --check --stdin-filepath`. `session-loader.service.ts` has 217 drift lines that predate this task, and lint-staged formats whole staged files, so staging it would rewrite unrelated code. `chat.store.ts` has about 8 drift lines that predate this task, and 8FD stages it anyway. `tab-manager.service.ts` and `message-sender.service.ts` were clean on `main`, contrary to the style review's assumption. | yes |
| D18 | Logic S1 fix: a per-proposal state machine (`open` -> `answered` -> `launched`, or `declined`). The id is consumed only on launch or Decline. Failures after the D1 answer stay retryable and reuse the `specTaskId` and `runId`. The manifest is rolled back when the launch send fails. One fixed safe message goes through `transport.reportFailure`. Confirm-time availability re-check comes before the answer. | consume on confirm (today); always Decline on any failure | A1 items 1-3; review S1 fix text; Decision D1 (once the fixed text is delivered, the question is closed and a later Decline is impossible, so a retry handle is the only path to launch). | yes |
| D19 | Logic S4: when another tab already owns the last-session SDK id, Command Center refuses (switches to that tab and shows a safe message) instead of adopting that tab. Logic S6: `newCommandCenter` stops voice (`idle`, lock released, meters zeroed) instead of re-engaging the lock on the new tab. | adopt the tab (needs a new chat-state mark-existing-tab API and lifecycle rules); carry voice to the new tab | No mark-existing API exists (`tab-manager.service.ts:995` only creates). The voice loop does not exist until B10, so carrying voice has no owner. Both choices keep one SDK id on one tab and one writer. | yes |
| D20 | Fix-round disposition. **Fixed in 8F:** logic S1-S6; S7 (D22); M1-M3 (TL-1..TL-3); M5, inside the S6 voice-release path, which also gives B10.2 its zero API; M6 (AC11 correctness, same rewrite as S7, no later owner); M7 (a malformed success starts a new session whose first send overwrites the persisted last-session record, losing the resume pointer: data loss). Style S1-S3; Moderate 2 (guard for the S2 widening); Moderate 4 (the S5 fix rewrites that signature); Moderate 5 (= TL-2); Moderate 3 (casts inside the lines 8FE rewrites). **Carried to named later tasks:** logic M4 and style Moderate 6 (status ages producer, `setStatusContextProvider` seam) and style Moderate 1 (barrel `export *`) go to Task 14.2. Style Minors are recorded only. | fix all Moderates now; carry all Moderates | Fix-round rule: Blocking and Serious are fixed; a Moderate is fixed only if it can break a lane config or lose data, else it gets a named later task. | yes |
| D21 | Manifest lane `role` is `role?: string` (non-empty when present), not `LaneRole`. | `role?: LaneRole` (style Moderate 5) | `chat-state` is `type:data-access` and may not import `tribunal-panel` (`type:feature`) under `eslint.config.mjs:407-414`. The producer (8FC) only writes roles from the zod enum built from `RELAY_ROLES`/`CRUCIBLE_ROLES`. | yes |
| D22 | "Flat Tribunal moves have no lanes or stage" is treated as Serious S7. Lane nodes get the new stable id prefix `lane:<runId>:<laneId>`, and a missing stage gets `phase:<runId>:stage`. | Moderate / later task | The review's data-flow item 10 and requirements row AC15 cite it as "S7", although its summary counts six Serious. AC15 is unmet and no later batch owns the projector. | yes |
| D23 | `TASK/reports/phase-b.diff` (137 KB, generated) is not committed. Delete it after the 8F re-review returns. | commit it | Reproducible with `git diff fa97a6967^..2137ab904`; the re-review range is the 8F commits. | yes |
| D24 | 8F runs in this order: 8F0 alone, then wave 1 in PARALLEL MODE (8FA, 8FB, 8FD; disjoint files and disjoint Nx projects; lanes run no nx or jest), then 8FC, then 8FE. The team leader checks and commits one batch at a time. Each lane stays at 6 files or fewer, in at most 2 projects, under 40 tool calls. | one 8F batch (about 20 files, 5 projects); fully sequential | Batch-size rule; orchestrator's parallel condition (file-disjoint and different projects); 8FC needs 8FA and 8FB; 8FC and 8FE share `command-center`. | yes |
| D25 | Q1 (from D16) answered by the orchestrator as a default, not a user answer: option (a). Keep the restored pre-commit hook, never bypass it, and run every commit alone in the foreground with a long timeout and nothing else heavy in flight. Wave 1 lanes run no nx/jest, so a team-leader commit never overlaps a lane check. | (b) scoped-lint arrangement; (c) bypass | A hook bypass is user-reserved and was not requested (orchestrator message, Batch 8F0 Mode 2). The user can overturn this. | yes |
| D26 | Re-review Serious fix: `pageExit` cancels every `answered` proposal (new terminal state `'cancelled'`, consumed, no turn, no Decline), and `confirmEntry` re-checks after each await before the manifest write. On cancel it removes any manifest from an earlier attempt and returns `cancelled`, not retryable, with one `reportFailure`. A send that already succeeded stays `launched`. | (a) cancel token per entry; (b) keep answered entries alive across page exit; (c) drop silently with no report | `code-logic-review-phase-b-rereview.md` Serious; on disk `pageExit` `:115` deletes and `confirmEntry` has no post-await check. (b) is wrong because the coordinator is page-owned. (c) breaks the "one `reportFailure` per `ok: false`" contract from D18. A method-call check avoids TypeScript keeping the `'answered'` narrowing across `await`. | yes |
| D27 | The records-migration Moderate is IN the bounded correction: a run-keyed entry beats a root-keyed entry for one `runId`, else the greater `startedAt` wins. | carry to a later task | Fix-round rule: a Moderate is fixed when it can lose data. This is a persisted read path, and key enumeration order decides which body survives and the next write drops the other. No production writer exists yet (B13/B14), so it is not reachable today, but the fix is a few lines in a file the batch can own. | yes |
| D28 | The projection-dedup Moderate (a persisted provisional id hides the live row as `'unknown'`) is OUT of the bounded correction and carried to Task 14.2, which builds the projection inputs. | fix in 8FG | Fix-round rule: display-only, no lane-config break and no data loss. The re-review marked M6 CLOSED; this is a new edge case where a persisted id equals a live tab id. Task 14.2 owns `persistedChildren` and gets `work-projection.ts` and its spec added to its files. | yes |
| D29 | Re-review Minors (`removeManifest` false ignored; Decline boolean ignored on duplicate receive and lanes-unavailable) and the 3 style re-review Minors are recorded only, not fixed. 8FG.1 does touch the rollback path, but only for the cancel case. | fix the Minors in 8FG | Fix-round rule: Minor recorded, not fixed. No path sends a launch: a false rollback leaves a run key that the retry rewrites, and an undelivered Decline still ends with the host's Decline-first timeout. The `childBySession` style Minor rides with D28 in Task 14.2. | yes |
| D30 | 8FG is accepted and Phase B is CLOSED: the grok review of `ea106f685..433aab5ad` is APPROVED 9/10 with 0 new Blocking, Serious, Moderate or Minor. Per D23 the generated diffs `phase-b.diff`, `phase-b-8f.diff` and `phase-b-8fg.diff` are deleted, not committed. Carried items stay where D28 and D29 put them (Task 14.2; Minors recorded). Phase C (B9) waits for the B0 baseline (D2). | (a) another fix round; (b) close Phase B | `code-logic-review-phase-b-8fg.md` (reviewer grok, implementer codex): RR-S1 closed at `tribunal-run-coordinator.ts:119-123` with every `isCancelled` check before `writeManifest` (`:216`); RR-M2 closed at `command-center-records.ts:64-82`; D18 and A1 hold; its top risk is the D29 Minor. This was the last review the revise cap allowed, and it passed, so (a) has nothing to fix. | yes |
| D31 | The user chose "Popover fix only" on 2026-10-15. The node popover flicker on dense scenes is fixed in Batch 14 only: Task 14.1 replaces the per-label instant tooltip with ONE shared node card keyed by stable node ID (hover intent with open/close delays, safe area, no close while the canvas hit test still reports the node, sphere anchor for hidden labels, click/Enter pin, `FloatingUIService` positioning at most once per frame, reduced motion), adds `command-overlay.component.spec.ts`, and Task 14.2 wires and specs it. Task 12.2 gains ONLY a `hoveredNodeId` output, because the canvas pointer hit test lives in `CommandSceneComponent` and the overlay cannot know the hovered node otherwise; nothing else in Batch 12 changes, and Batches 11 and 13 do not change. Zoom and pan are OUT of scope for this task: no scene camera, zoom, pan, fit-to-view or zoom-to-node in any batch. Candidate follow-up task: zoom and pan with a hand-written bounded camera (`{scale,tx,ty}`), d3-zoom as the fallback, no minimap (research recommendation). Batch 14 now carries 7 files in one project (one over the 6-file rule); kept as one batch because the card and its page wiring are one rollback unit. Rules are tagged in Task 14.1: delay values (150/200 ms, tunable at B18) and the bridge safe-area method are lane-proposed. | (a) popover fix only; (b) popover fix plus zoom and pan across B11-B14 (research amendment, one new camera helper) | User decision 2026-10-15. `research-canvas-zoom-pan.md` "Flicker root cause" and "Popover options"; `prototype/command-center.html:81` (label `mouseenter` -> `showTip`, `mouseleave` -> `display='none'`, no delay, safe area or pin) and `:95` (`positionLabels` moves, compacts or hides labels while drawing; dense at `nodes.length > 12`); `floating-ui.service.ts:125-163` (`offset`, `flip`, `shift`, fixed strategy, `autoUpdate`; no hover intent or safe area). | yes |
| D32 | The user chose "Unblock B9/B11 now" on 2026-10-15. The B0 gate (D2) now covers only B10 (voice loop) and B12 (scene renderer), the first batches that consume the measured frame and voice budgets. B9 (pure voice primitives) and B11 (brand-art entry, pure layout, sprite cache) start now. The user records the B0 baseline in `test-report.md` before B10 and B12. Per the user's relayed instruction for 2026-10-15/16 (Claude usage near its limit), CLI lanes do the implementation and review work, and the orchestrator records team-leader bookkeeping and commits. | (a) unblock B9/B11 now; (b) user measures now, keep D2; (c) defer every measurement to B18 | User decision 2026-10-15. B9 and B11 read no measured number: B9 tasks 9.1-9.4 are pure logic, and B11 tasks 11.1-11.3 are an export entry, pure geometry and a sprite cache; the frame and voice budgets first apply in B10 (voice loop) and B12 (renderer). | yes |
| D33 | B9 (`b65372ba1`) and B11 (`4b7455a36`) are accepted after one orchestrator fix round each (3 defects per batch, all fixed by the same codex lane, recorded in each batch's verification). The B11 lane found that child nodes cannot show `Codex · Builder` because the B8 projection carries no child session name and no provider ids; the fix is carried to Task 14.2, which already owns `work-projection.ts` (D28). No per-batch review (plan); the Phase C logic review runs after B10, and the Phase D reviews after B16. | (a) carry the child-label fix to Task 14.2; (b) a new bounded batch now | `reports/batch-11-report.md` "Carry-over"; `work-projection.ts` child label `'Child session'` and `providerId: null`; Task 14.2 already lists `work-projection.ts` (D28), so (a) adds no new file owner. | yes |
| D34 | The user waived the B0 baseline on 2026-10-15 ("continue as if the test went well"). B0 is WAIVED, and nothing gates B10 or B12 any more. No measured number is recorded or invented: `test-report.md` "Preimplementation baseline" records the waiver only. Until B18, code and specs use the plan's fixed scene targets (p95 draw at most 8 ms at N=24, sustained at least 30 FPS, implementation-plan.md:60) and record latency marks without a pass/fail bound. B18 (the Electron Scene and Voice Gate) now also takes the baseline: the refresh interval, the provider pair, the 30 or more end-of-utterance to first-audio samples, and the voice p95 bound; AC20 is judged there. Risk: a budget problem first shows at B18, after B10-B17 are built. | (a) waive B0 and measure at B18; (b) wait for the user's measurements | User instruction 2026-10-15. The plan forbids invented numbers (implementation-plan.md:60, B0 validation notes). | yes |
| D35 | B10 (`cd3a5c6e9`) and B12 (`64c69a8ca`) are accepted after one orchestrator fix round each (3 and 2 defects, fixed by the same codex lanes; recorded in each batch's verification). Both lanes report page integration that their file lists exclude: the voice loop lifecycle and callbacks, including the new `onRosterResolved`, and the scene's `setOverlayLabels` and `setCardAnchor`. Task 14.2 owns that wiring because the page owns the voice and scene lifecycle. The Phase C code-logic review of the combined B9-B10 voice diff runs next on a different family (grok). | (a) carry the wiring to Task 14.2; (b) a new integration batch | `reports/batch-10-report.md` and `reports/batch-12-report.md` "Needed changes outside the batch"; Task 14.2 already owns the page lifecycle ("voice loop start/stop"). | yes |
| D36 | B13 (`fd493f2c9`) is accepted after one orchestrator fix round (5 defects: 2 lint errors for outputs named as DOM events, stale typed answer per request, duplicate answer/decline emits, unclamped roving list index, 4 spec non-null warnings; same codex lane family). The Phase C fix round (`57f5d0940`) closes S1, M1, M2, M3 in code; one residual of S1 is carried to Task 14.2: `onTurnBoundary(text)` has no turn token, so a stale boundary that arrives after a new send has settled cannot be told apart inside the loop. The page, which calls it, passes a turn token (or calls it only for the turn it sent). Task 14 runs as two sequential codex lanes (14.1 overlay, then 14.2 page) because B14 has 7+ files. | (a) carry the turn token to 14.2; (b) a voice-loop contract change now without a caller | `reports/batch-13-fix-report.md`; `reports/phase-c-fix-report.md` "Carried to Task 14.2"; the page owns the assistant-stream boundary (D35). | yes |
| D37 | Phase C CLOSED: grok re-review of `57f5d0940` APPROVED 7/10 (`code-logic-review-phase-c-rereview.md`; reviewer grok, implementer codex). New Moderate N1 (barge-in clears `playbackMarks` but leaves `synthesisIds` queued, so a later reply's latency origin can attach to the wrong chunk; `command-voice-loop.ts:82,96,154-163,271-273`) is fixed in a small follow-up (Task 14.2c: clear `synthesisIds` with `playbackMarks` on barge-in plus a spec), run after the page lane because that lane may edit `command-voice-loop.ts` for the turn token (D36). `reports/phase-c.diff` deleted (same rule as D23). Grok weekly usage reached 91% during this phase; Phase D reviews must stay off codex, so they use grok if it has room, else the in-process reviewers after 2026-10-16. | (a) close Phase C and carry N1; (b) another revise round now | Revise cap: one fix round plus one re-review used; N1 is Moderate, not Blocking or Serious; the reviewer approved. | yes |
| D38 | Task 14.2 runs as five codex lanes: 14.1 overlay (`5b02f44a8`), 14.2a projection model (`4d7cd2f92`), 14.2b page shell, controller, voice wiring and named export (partial: no Tribunal, empty agents/runs), 14.2c Tribunal wiring, 14.2d projection source and N1, then a final lane that wires the source and writes the page specs. Tribunal nonce: the PAGE issues it. On an explicit move word the controller appends a delimited request block with a `crypto.randomUUID()` nonce and the root session id; the persona (`command-center-persona.ts`) tells the model to copy them into the AskUserQuestion payload instead of inventing a nonce; `parseRosterProposal` checks both. Lane availability comes from `TribunalDiscoveryService` plus `agent:getConfig` disabledClis. | (a) page-issued nonce; (b) accept the model's nonce (no authority); (c) defer Tribunal launch | Plan unit 5 (`implementation-plan.md:31`: the coordinator sends the discovery-only turn and validates the matching nonce); A1; `tribunal-roster-proposal.ts:98-130` expects a caller-known nonce; `reports/batch-14-2b-report.md` "Needed changes". | yes |
| D39 | The webview routing specs failed when the route loaded the real `@ptah-extension/command-center` chunk: the lib imported `TribunalDiscoveryService` from the MAIN `@ptah-extension/tribunal-panel` barrel, which also exports the Tribunal page (`tribunal-page.component.ts` imports `gridstack/dist/angular`, ESM-only in Jest), so the lazy Command Center chunk carried the whole Tribunal page. Fix: a narrow secondary entry `@ptah-extension/tribunal-panel/discovery` (`src/discovery.ts`, alias in `tsconfig.base.json`, purity guard `src/discovery.spec.ts`) in the style of `/phase` (D6), and command-center imports only the narrow entries. Also replaced 5 banned `text-base-content/70` classes found by the webview design-lint spec. New public API for the Phase D style review. | (a) narrow entry; (b) add gridstack to the webview Jest `transformIgnorePatterns` (hides the bundle cost); (c) mock the module in the routing spec | `/tmp` B15 check: 4 routing failures with the gridstack ESM error, 1 design-lint failure; `reports/batch-14-2e-report.md`. | yes |

## Phases and reviews

| Phase | Batches | Phase review |
| ----- | ------- | ------------ |
| 0 - Baseline | B0 | none (measurement) |
| A - Chat runtime contracts | B1-B4, fix B4F | CLOSED: code-logic (B1-B4: NEEDS_REVISION); B4F re-review APPROVED (L1 closed) |
| B - Command Center model and Tribunal source | B5, B6, B6A, B7, B8, fix B8F | code-logic + style (new public API: `@ptah-extension/command-center`, `@ptah-extension/tribunal-panel/phase`); B8 review on `fa97a6967^..2137ab904`: logic NEEDS_REVISION 4/10 (grok), style NEEDS_REVISION 6/10 (Anthropic); fix round B8F = 8F0, 8FA-8FE (D20, D24), all committed; re-review on `5d52cfa5b..b5af1cc42`: logic NEEDS_REVISION 7/10 (grok; all 13 prior findings closed; 1 new S, 2 M), style APPROVED (Anthropic); bounded correction 8FG (D26-D29) committed `433aab5ad`; 8FG review on `ea106f685..433aab5ad`: logic APPROVED 9/10 (grok; implementer codex; RR-S1, RR-M2 closed, 0 new issues). CLOSED (D30) |
| C - Voice | B9-B10, fix 57f5d0940 | code-logic: initial review on `0c9ca43a9..48d2fafee` NEEDS_REVISION 6/10 (grok; implementer codex; 1 S, 3 M); fix round `57f5d0940` (codex); re-review on `57f5d0940^..57f5d0940` APPROVED 7/10 (grok; S1, M1, M2, M3 closed; 1 new Moderate N1 carried to Task 14.2c, D37). CLOSED (D37) |
| D - Scene, page, route, nav | B11-B16 | code-logic + style (new public API: `@ptah-extension/ui/provider-brand-art`); visual review runs with B18 evidence because it needs the Electron app |
| E - Acceptance | B17-B18 | none (tests and measurement); B18 visual evidence is still required for Mode 3 |

Reviewer for every phase review is a different model family from the batch implementer (for example, a lane
implementer is reviewed by a lane of another family or an in-process subagent). Record both families on the phase's
last batch header.

## Batch 0: Preimplementation Electron spike (user-run gate) - WAIVED (D34)

- Recommended executor: user-run on target Electron hardware, recorded by the orchestrator
- Execution mode: sequential
- Fallback order: N/A (manual gate; no agent may run build/serve/e2e)
- Subagent reason: N/A - this needs the user's Electron hardware and an Electron run, which `CLAUDE.md` bars agents from starting
- Review family: N/A
- Rationale: plan line 60 requires measured frame and audio baselines before voice/scene code; it is a user action.
- Tasks: 1 | Depends on: none | Gates: none (waived by the user, D34; measurements move to B18)
- Phase: 0 - Baseline | Phase review: none

### Task 0.1: Record the baseline in test-report.md - WAIVED (D34)

- File: `TASK/test-report.md` (section "Preimplementation baseline")
- Plan reference: implementation-plan.md:60, :68; task-description.md "Pre-implementation measurement gate"
- Pattern to follow: plan line 60 field list
- Quality requirements: record display refresh interval at 1280x720 on integrated GPU; N=24 mixed nodes; the selected
  provider pair (STT, TTS); at least 30 end-of-utterance to first-audio samples, cold worker and post-barge-in reported
  separately; the selected-provider p95 upper bound (measured p95 plus declared tolerance); frame budget at most one
  refresh interval; the measurement method (assumption 8).
- Validation notes: no invented numbers. If the user defers, B9-B12 stay PENDING; B1-B8 continue.
- Implementation details: the orchestrator asks the user to run the spike and writes the numbers the user reports;
  the team-leader commits `test-report.md` with `docs(task-specs): ...`.

### Batch 0 verification

- `TASK/test-report.md` holds every field above with units, date and hardware.
- No Nx command.

## Batch 1: Persona RPC contract on continue, activate and rewind - COMPLETE (commit 639470cfc)

- Recommended executor: CLI lane (implementation; TypeScript backend + shared contracts)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one contract threaded through three coupled seams in two projects; order matters (types, schema, service).
- Tasks: 3 | Depends on: none
- Phase: A - Chat runtime contracts | Phase review: code-logic (after B4)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `feat(shared,rpc-handlers): batch 1 - persona on continue, activate and rewind`
- Verification: the scoped command passed after fix round 1 ("Successfully ran targets test, typecheck, lint for 2
  projects", 6/6 tasks, run by the orchestrator). Report: `TASK/reports/batch-1-report.md`.

### Task 1.1: Optional systemPrompt on chat continue, resume and rewind params - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/rpc/rpc-chat.types.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/rpc/rpc-session.types.ts`
- Plan reference: implementation-plan.md:14, :27, :69; risk R1
- Pattern to follow: `ChatStartParams.options.systemPrompt` (`rpc-chat.types.ts:73`); `ChatContinueParams.ptahUiFence` doc style (`:127-164`)
- Quality requirements: add `systemPrompt?: string` to `ChatContinueParams`, `ChatResumeParams` (applies only with
  `activate: true`) and `SessionRewindParams`, each documented as "per-tab persona for an inactive SDK resume; ignored
  by an active turn". No other field changes.
- Validation notes: R1, R10. History-only resume must stay unchanged.
- Implementation details: type-only change plus a spec asserting the optional fields compile and are absent by default.

### Task 1.2: Bounded systemPrompt in chat and session RPC schemas - COMPLETE

- Depends on: Task 1.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
- Plan reference: implementation-plan.md:14, :69; assumption 3; risk R10
- Pattern to follow: `ChatResumeParamsSchema.historyPage` (`chat-rpc.schema.ts:84-95`)
- Quality requirements: explicit `systemPrompt: z.string().max(<bound>).optional()` on continue and resume schemas
  (bound: 16 KB unless an existing start-prompt bound is found; use the same constant for start if one exists). Reject
  over-long values with a safe validation message. `session-rpc.schema.ts` has no `session:rewindFiles` schema
  (grep for "rewind" finds none at `054ac18ca`), so the rewind bound is enforced in Task 1.3's handler before the
  value reaches `ensureSessionActiveForRewind`, using the same exported constant.
- Validation notes: passthrough remains for other fields; do not convert to `.strict()`.
- Implementation details: schema field plus spec cases (absent, valid, over-length rejected).

### Task 1.3: Thread systemPrompt into inactive resume, activate and rewind - COMPLETE

- Depends on: Task 1.2
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-persona-resume.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/handlers/session-rpc-rewind-persona.spec.ts` (new)
- Plan reference: implementation-plan.md:14, :27, :87; risk R1; assumption 2
- Pattern to follow: `AutoResumePreflight` (`chat-session.service.ts:111-130`); `ptahUiFence` conditional spread at
  `chat-session.service.ts:1583-1601`; existing spec `chat-session-resume-activate.spec.ts`
- Quality requirements: add `systemPrompt?` to `AutoResumePreflight`; `chat:continue` inactive resume passes
  `params.systemPrompt` into `sdkAdapter.resumeSession` config only when set; `resumeSession` with `activate: true`
  (`:1183-1192`) forwards it; `ensureSessionActiveForRewind` gains an optional `systemPrompt` argument and
  `session:rewindFiles` (`session-rpc.handlers.ts:1405`) passes `params.systemPrompt` after rejecting a non-string or
  over-length value with the Task 1.2 constant. Active turns ignore it.
- Validation notes: tests cover start, inactive continue with prompt, continue without prompt (no key in config),
  activate with and without prompt, rewind with and without prompt, history-only resume untouched. Log no prompt text.
- Implementation details: conditional spread `...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {})`
  into the `resumeSession` config; assert the call arguments in specs.

### Batch 1 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes (2 projects in the header); output tailed.
- No per-batch review; the Phase A code-logic review covers this batch.
- Edge cases: restart then regular-chat send (persona present), history-only resume unchanged.

## Batch 2: Tab marker, persona resolver and Command Center records - COMPLETE (commit 619ec683b)

- Recommended executor: CLI lane (implementation; Angular data-access TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: persisted types and validators that later batches read; one data-access lib plus its util type lib.
- Tasks: 3 | Depends on: B1
- Phase: A - Chat runtime contracts | Phase review: code-logic (after B4)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-types @ptah-extension/chat-state --parallel=1 2>&1 | tail -60`
  (chat-types has no test target; header must list both projects for typecheck/lint). Verification rules above apply.
- Suggested commit: `feat(chat-types,chat-state): batch 2 - command center tab marker and records`

### Task 2.1: commandCenterOrigin on TabState, validated on restore - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-types/src/lib/chat-types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-persistence.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-restore-command-center.spec.ts` (new)
- Plan reference: implementation-plan.md:16, :27, :70, :98; risk R16
- Pattern to follow: `TabState.agentOrigin` (persisted, validated on restore) at `chat-types.ts:603-630`;
  `sanitizeRestoredTab` (`tab-persistence.ts:233`) and `tab-restore-sanitize.spec.ts`
- Quality requirements: optional `commandCenterOrigin?: { workspaceId: string; createdAt: number; version: 1 }`
  (final shape documented); restore keeps a well-formed marker and drops a malformed one so the tab becomes ordinary;
  never persists any voice/lock state.
- Validation notes: corrupt markers sanitize to ordinary tabs (plan Risks paragraph 1).
- Implementation details: type plus validator inside `sanitizeRestoredTab`; spec with valid, malformed and absent markers.

### Task 2.2: Fixed head-of-engineering persona resolver - COMPLETE

- Depends on: Task 2.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-persona.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-persona.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/index.ts`
- Plan reference: implementation-plan.md:14, :27, :31-32; A1 items 1-2; task-description AC2, AC10, AC13
- Pattern to follow: constants in `libs/frontend/chat-state/src/lib/live-context-stats.ts`; barrel `chat-state/src/index.ts`
- Quality requirements: export `COMMAND_CENTER_PERSONA` (fixed text) and `commandCenterPersonaFor(tab): string | undefined`
  that returns the persona only for a tab with a valid `commandCenterOrigin`. Persona instructs Ptah to acknowledge
  accepted delegation, distinguish running/completed/failed in status replies, treat `COMMAND_CENTER_STATUS_CONTEXT`
  as ephemeral context, and for a Tribunal request run discovery only: call `ptah_agent_list`, skip AT LIMIT lanes,
  honor saved `preferredAgentOrder`/`disabledClis`, call `AskUserQuestion` with **Decline first, Confirm second** and
  the delimited payload (nonce, root ID, mode, lane IDs/roles/names, objective, rounds), then end the turn without
  spawning whatever the answer. Under the persona's length bound from Task 1.2.
- Validation notes: R4, R10. Never applied to unmarked tabs.
- Implementation details: pure module; spec asserts marked/unmarked/malformed behaviour and that the text contains the
  Decline-first and no-spawn-in-discovery rules.

### Task 2.3: Workspace last-session record and Tribunal run manifest - COMPLETE

- Depends on: Task 2.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/index.ts` (same file as 2.2, sequential)
- Plan reference: implementation-plan.md:16, :27, :31 (manifest fields), :86, :98; Decision D7; risk R16
- Pattern to follow: workspace-scoped storage in `tab-workspace-partition.service.ts` and backoff helpers in `tab-persistence.ts:319-399`
- Quality requirements: per-workspace `lastSession { sdkSessionId, tabId?, updatedAt }` and active-marker switch for New
  Command Center; run manifests `{ runId (UUID), rootTabId, rootSdkId, move, specTaskId, laneIds/roles, rounds, startedAt }`
  keyed by root. Validate on read; malformed entries are dropped, never thrown. Survives tab close.
- Validation notes: write-path trace in Mode 3 (key, scope, value format, reader).
- Implementation details: injectable store over the same storage the tab partition uses; spec covers write/read,
  per-workspace isolation, malformed payload, close-then-read.

### Batch 2 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review; Phase A review covers it.
- Edge cases: corrupt marker restore, records survive tab close, workspace isolation.
- Result: files verified on disk; orchestrator's foreground scoped run passed for 2 projects
  (`TASK/reports/batch-2-report.md`). Notes for the Phase A review: the marker's `workspaceId` and
  the records' `workspacePath` key must name the same value when B3 writes them; the records
  service does read-modify-write on one key per workspace (last writer wins across windows).

## Batch 3: Send lock service and marked-tab lifecycle - COMPLETE (commit ad19f9679)

- Recommended executor: CLI lane (implementation; Angular data-access TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: transient lock plus surgical TabManager hooks in one data-access lib.
- Tasks: 2 | Depends on: B2
- Phase: A - Chat runtime contracts | Phase review: code-logic (after B4)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-state --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(chat-state): batch 3 - command center send lock and tab lifecycle`

### Task 3.1: CommandCenterSendLockService - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/index.ts`
- Plan reference: implementation-plan.md:17, :29
- Pattern to follow: root-provided signal services in chat-state (`session-liveness.registry.ts`)
- Quality requirements: state `{ rootTabId, sdkSessionId | null, ownerToken, active }`; `engage(tabId, sdkId, token)`,
  `release(token)`, `rekey(tabId, sdkId)` (atomic on `session:id-resolved`), `isHeld(tabIdOrSdkId, token?)` true only
  for the locked root and a missing/wrong token; other roots and tabs are never held. Never persisted, so a reload
  starts unlocked.
- Validation notes: rekey during engaged lock; release by wrong token is a no-op.
- Implementation details: signals only; spec covers engage/release/rekey/other-tab/owner-token/reload.

### Task 3.2: Mark, rekey and close-warning hooks in TabManagerService - COMPLETE

- Depends on: Task 3.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts` (new)
- Plan reference: implementation-plan.md:16, :27, :29, :86; risk R9
- Pattern to follow: `createTab` (`tab-manager.service.ts:934-967`), close path (`:1296`), SDK-ID resolve (`:2782`);
  `ConfirmationDialogService` in chat-state
- Quality requirements: a method to create a marked ordinary tab (activates it in regular chat by design); on
  `session:id-resolved` call `CommandCenterSendLockService.rekey` and update the last-session record; closing a marked
  tab asks for confirmation, then aborts its stream and removes it while the last-session record remains.
- Validation notes: surgical edits only; unmarked tab flows unchanged (existing tab-manager specs must stay green).
- Implementation details: new spec file for the marked-tab paths.

### Batch 3 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed; all existing `tab-manager.*.spec.ts` still pass.
- No per-batch review; Phase A review covers it.
- Edge cases: rekey with lock engaged; close warns and keeps the record; reload never restores a lock.
- Result: files verified on disk; orchestrator's foreground scoped run passed for 1 project
  (`TASK/reports/batch-3-report.md`; 30 suites, 585 tests). Notes for the Phase A review:
  (a) `CommandCenterSendLockService.engage` overwrites a lock held by another owner token (no
  owner check); (b) `closeTab` on a marked tab clears the active-tab record but does not release
  the send lock, so a lock engaged on a closed root stays held until page reload; (c) the marker
  `workspaceId` and the records key both use `activeWorkspacePath` (B2 note resolved).

## Batch 4: Chat send funnel guard, persona attach and tab-explicit answers - COMPLETE (commit 97929ae01)

- Recommended executor: CLI lane (implementation; Angular feature TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: three coupled services in one feature lib; UI pieces move to B16 because they need the surface id (R2).
- Tasks: 3 | Depends on: B1, B3
- Phase: A - Chat runtime contracts (last batch) | Phase review: code-logic on the combined diff B1-B4
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(chat): batch 4 - command center send gate and persona attach`

### Task 4.1: Hold competing sends in MessageDispatchService - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat-store/message-dispatch.command-center-lock.spec.ts` (new)
- Plan reference: implementation-plan.md:17, :29, :71
- Pattern to follow: `sendOrQueueMessage` / `sendQueuedMessage` (`message-dispatch.service.ts:151-165,224-253`)
- Quality requirements: when `isHeld(tab)` is true without the owner token, a new send is held (content kept in
  `TabState` queue, user notified through the existing queued path) and `sendQueuedMessage` neither flushes nor clears
  existing queued content. Owner-token sends pass. Slash commands are gated too.
- Validation notes: lock engaged during a pending queued flush; other tabs unaffected.
- Implementation details: optional `ownerToken` option on dispatch entry points; new focused spec.

### Task 4.2: Guard MessageSenderService and attach persona on continue and activate - COMPLETE

- Depends on: Task 4.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.command-center.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat-store/session-loader.command-center-persona.spec.ts` (new)
- Plan reference: implementation-plan.md:14, :17, :27, :71
- Pattern to follow: `chat:continue` call in `message-sender.service.ts`; `chat:resume` with `activate: true` at
  `session-loader.service.ts:990-1010`
- Quality requirements: direct sender entry points refuse held sends without the owner token (Stop/abort untouched);
  every `chat:continue` and every `chat:resume { activate: true }` for a marked tab carries
  `systemPrompt: commandCenterPersonaFor(tab)`; unmarked tabs send no `systemPrompt` key.
- Validation notes: R10; regular-chat send after restart includes persona.
- Implementation details: resolve the tab through `TabManagerService`; specs assert RPC params.

### Task 4.3: Tab-explicit deciding tab for question answers (review M1) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat.store.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat.store.question-tab.spec.ts` (new)
- Plan reference: implementation-plan.md:22, :31; implementation-plan-review.md M1; risk R3
- Pattern to follow: `handleQuestionResponse` (`chat.store.ts:500-509`)
- Quality requirements: `handleQuestionResponse(response, decidingTabId?)` uses the explicit tab when given, otherwise
  `activeTabId()` as today.
- Validation notes: existing callers unchanged.
- Implementation details: spec with active tab differing from the deciding tab.

### Batch 4 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed; existing message-dispatch/sender/session-loader specs still pass.
- Phase A's last batch: after commit return NEEDS REVIEW (code-logic, combined diff B1-B4).
- Edge cases: queued content held not flushed; Stop/answers enabled; rekey mid-lock.
- Result: files verified on disk; orchestrator's foreground scoped run passed for 1 project
  (`TASK/reports/batch-4-report.md`; 213 suites, 3942 tests passed, 2 skipped). Executor: codex.
  Notes for the Phase A review: (d) a held `sendQueuedMessage` returns early and nothing
  re-flushes on lock release, so held queued content waits for the next turn-end or user send;
  (e) the sender's `isHeld` falls back to `activeTabId()` when `options.tabId` is absent, so a
  send for a non-active tab without `tabId` checks the wrong tab; (f) the four new specs are thin
  (6 tests total) and the owner token is a local intersection type, not part of
  `SendMessageOptions`.
- Phase A review: REQUESTED - code-logic on `054ac18ca..97929ae01` (B1-B4, 30 code/spec files).
  Implementer family: codex (B1-B4). Reviewer family: grok CLI lane (different family). Output:
  `TASK/code-logic-review.md`. Verdict: NEEDS_REVISION (6/10; 0 Blocking, 1 Serious L1,
  3 Moderate L2, L3, L4). Fix round: L1 in Batch 4F (Decision D8). L2 deferred to Task 6.2 (D9).
  L3 and L4 deferred to Batch 6A (D10). One re-review, scoped to the Batch 4F commit, follows it.

## Batch 4F: Phase A fix round - persona on slash relaunch (review L1) - COMPLETE (commit f590a5647)

- Recommended executor: CLI lane (implementation; NestJS-style backend TypeScript), codex family
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (implementer codex; re-reviewer grok or another non-codex family)
- Rationale: one fix in one router plus one new spec, all in one backend project.
- Tasks: 1 | Depends on: B1, B4
- Phase: A - Chat runtime contracts (fix round) | Phase review: code-logic re-review scoped to the
  Batch 4F commit only (L1 closure); no new public API, so no style review
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -60`
  (header must name 1 project). Verification rules above apply.
- Suggested commit: `fix(rpc-handlers): batch 4F - keep persona on slash relaunch`

### Task 4F.1: Carry systemPrompt into the slash new-query sessionConfig (L1) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-persona.spec.ts` (new)
- Plan reference: implementation-plan.md:14, :27; `TASK/code-logic-review.md` finding L1; risk R10
- Defect: the `new-query` branch (`chat-slash-command-router.service.ts:114-157`) builds `sessionConfig`
  at lines 141-150 with `model`, `projectPath`, `mcpToolProfile`, `ptahUiFence` and no `systemPrompt`.
  `continueSession` sends every slash command through `endDeadRecordBeforeSlashCommand` and skips
  `autoResumeIfInactive` (`chat-session.service.ts:981-991`), so the persona spread at
  `chat-session.service.ts:1599` never runs for a slash relaunch.
- Pattern to follow: `...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {})` at
  `chat-session.service.ts:1599`; spec setup in `chat-continue-slash-before-resume.spec.ts` and
  `chat-session-persona-resume.spec.ts` (same folder).
- Quality requirements: the `new-query` `sessionConfig` carries `systemPrompt` when
  `params.systemPrompt` is a non-empty string and carries no `systemPrompt` key otherwise. Native
  commands (`/clear` and the other native branch) are unchanged. No other field of the call changes.
- Validation notes: assumption to verify by reading and to record in the report:
  `SdkAgentAdapter.executeSlashCommand` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1602-1630`)
  keeps `systemPrompt` when it merges `providerProfile` into `sessionConfig` (`...config.sessionConfig`),
  and `SessionLifecycleManager.executeSlashCommandQuery` (`helpers/session-lifecycle-manager.ts:730-759`)
  passes `sessionConfig` to `executeQuery`, whose options builder reads `sessionConfig.systemPrompt`.
  If that chain drops the field, stop and report it; do not edit agent-sdk.
- Implementation details: one spread line in the router. The new spec asserts the
  `executeSlashCommand` call's `sessionConfig` for: (a) slash continue with a persona on a session with
  no live record (inactive); (b) the same on a session with a live record (already active); (c) no
  `systemPrompt` param gives no key; (d) an empty-string `systemPrompt` gives no key; (e) `/clear`
  makes no `executeSlashCommand` call.

### Batch 4F verification

- Both listed files exist; the router has the spread and the spec has cases (a)-(e).
- The scoped command passes (1 project in the header); output tailed; existing
  `chat-continue-slash-before-resume.spec.ts` and `chat-session-provider-profile.spec.ts` still pass.
- After commit, return NEEDS REVIEW for the one scoped re-review (code-logic, Batch 4F commit only).
- Edge cases: inactive and active slash continue; unmarked tab sends no key; empty string; native commands.
- Verified by team-leader on disk (`TASK/reports/batch-4F-report.md`; executor codex). Router line 150
  carries `...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {})` in the
  `new-query` `sessionConfig`; no other call field changed. Spec has cases (a)-(e) through the real
  router (`it.each` inactive/active, `it.each` absent/empty, `/clear`). Agent-sdk chain read and
  confirmed: `sdk-agent-adapter.ts:1617-1626` spreads `config.sessionConfig` first (only model and
  effort override), `:1650-1654` passes it on, `session-lifecycle-manager.ts:743-746` hands it to
  `executeQuery`, `sdk-query-options-builder.ts:1769` reads `sessionConfig?.systemPrompt`. Scoped
  check (run once by the orchestrator): `run-many -t test typecheck lint -p
  @ptah-extension/rpc-handlers --parallel=1`, header names 1 project, all 3 targets succeeded.
- Committed: `f590a5647` (4 files: router, new spec, batch-4F report, batches.md). HANDOFF.md not staged.
- Phase A re-review: REQUESTED - code-logic, scoped to `97929ae01..f590a5647` (L1 closure only).
  Implementer family: codex. Reviewer family: grok CLI lane (different family). Output: a
  `## Re-review (Batch 4F)` section appended to `TASK/code-logic-review.md`. Verdict: APPROVED
  (L1 Closed; no new findings). Review path: `TASK/code-logic-review.md` "## Re-review (Batch 4F)".
- Phase A: CLOSED. Accepting verdict recorded above; implementer family codex (B1-B4, B4F),
  reviewer family grok CLI lane for both the phase review and the re-review (different family,
  no exception). The reviewer edited only `code-logic-review.md`. Deferred Moderates carried
  forward: L2 -> Task 6.2 (D9); L3, L4 -> Batch 6A (D10). L2-L4 were not re-reviewed; the
  Phase B review checks them.

## Batch 5: command-center lib skeleton, scope and store - COMPLETE (commit fa97a6967)

- Recommended executor: CLI lane (implementation; Nx/Angular library setup)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: 12 files, 8 of them boilerplate mirrored from `mcp-apps-page` (Decision D4); one project.
- Tasks: 2 | Depends on: B4 | May run concurrently with B6A (Decision D11)
- Phase: B - Command Center model | Phase review: code-logic + style (after B8)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 5 - add command-center lib and store` (needs the scope added here)

### Task 5.1: Library skeleton, alias and commit scope - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/{project.json,eslint.config.mjs,jest.config.ts,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json,src/test-setup.ts,src/index.ts}` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/tsconfig.base.json`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/.commitlintrc.json`
- Plan reference: implementation-plan.md:44, :72; risk R5
- Pattern to follow: `libs/frontend/mcp-apps-page/*` (project.json:1-27 with test/lint/typecheck targets, eslint.config.mjs, jest/tsconfig files, test-setup)
- Quality requirements: name `@ptah-extension/command-center`, tags `["scope:webview","type:feature","platform:angular"]`,
  prefix `ptah`; alias `@ptah-extension/command-center` only (Decision D6); add `command-center` to `scope-enum`.
- Validation notes: the barrel exports real code only (Task 5.2 store); no placeholder export.
- Implementation details: copy-and-rename from `mcp-apps-page`.

### Task 5.2: CommandCenterStore - COMPLETE

- Depends on: Task 5.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.spec.ts` (new)
- Plan reference: implementation-plan.md:27, :46; design-spec.md:52-56 (signal list)
- Pattern to follow: signal stores in `libs/frontend/mcp-apps-page/src/lib/state/`
- Quality requirements: immutable signal snapshots for marked tab ID, SDK ID, workspace, session status, voice state
  (idle/listening/thinking/speaking/muted/stopped/error), levels, muted, nodes/edges projection, selected ID, pending
  input, provider readiness, toast, theme, reduced motion. No per-frame writes; level updates throttled (at most 2 Hz
  for UI meters).
- Validation notes: state vocabulary queued/starting/running/awaiting input/completed/failed/cancelled (plan line 19).
- Implementation details: export from `src/index.ts`; spec covers transitions and immutability.

### Batch 5 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed; `.commitlintrc.json` contains `command-center`.
- No per-batch review.
- Result (2026-10-15): implementer codex lane 13183492 plus fix round 1 (lane c63f7544). The first
  orchestrator run failed lint (1 error `use-injectable-provided-in` at `command-center.store.ts:61`,
  29 `explicit-member-accessibility` warnings). The fix round added the repo-convention suppression
  with a reason (as at `marketplace/.../capability-toggles.store.ts:85-86`), explicit `public`
  modifiers, and removed a non-null assertion. Re-run with `--skip-nx-cache`: header "for project
  @ptah-extension/command-center", "Successfully ran targets test, typecheck, lint", 0 errors,
  0 warnings. Team-leader read all 10 lib files on disk: real store, no TODO/stub markers; the only
  suppression is the documented page-scope one. Report: `TASK/reports/batch-5-report.md`.
- Phase B review watch item (not a defect today): `updateLevels` samples on the leading edge, so the
  last level of a burst can be dropped and a meter can hold a stale non-zero value after input
  stops. B10 (voice loop) must push a final zero level on stop/mute/idle; the Phase B review checks it.

## Batch 6: Session coordinator - COMPLETE (commit 7bf32ad0c)

- Recommended executor: CLI lane (implementation; Angular feature TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one central orchestration service with heavy specs.
- Tasks: 1 | Depends on: B5
- Phase: B | Phase review: after B8
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 6 - session coordinator over an ordinary tab`

### Task 6.1: CommandCenterSessionCoordinator - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/index.ts`
- Plan reference: implementation-plan.md:13-17, :27-29, :32; A1 item 2; task-description AC2, AC16, AC25; risks R3, R8
- Pattern to follow: tab-branch flow in `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:507-533`;
  contrast with `apps-session.service.ts:234-250` (do NOT copy its `surfaceMode` claim)
- Quality requirements: open-or-resume for the workspace (marked tab present, else last-session record via
  `session:list`/`chat:resume`, else new); New Command Center creates another marked tab and switches the active
  marker; `chat:start` with persona then `chat:continue` with owner token via the B4 entry points; `chat:abort` for
  explicit Stop; engage the lock on voice start and release on mute/stop/teardown; status turns prepend the Task 8.2
  block (wired once B8 lands: expose a `statusContextProvider` input function now, defaulting to no block);
  pending-question answers call `ChatStore.handleQuestionResponse(response, markedTabId)`; a `sendLaunchTurn` entry
  used by Task 8.3. No `surfaceMode`, root `MESSAGE_HANDLERS` provider, private listener or claim.
- Validation notes: interleaved events from two tabs only update the marked root; retry only idempotent reads with
  bounded backoff; safe errors without raw exception text.
- Implementation details: depends on `@ptah-extension/chat-state` and `@ptah-extension/chat`; specs mock `ClaudeRpcService`.

### Task 6.2: Persona on the first chat:start of a marked tab (deferred Phase A review L2) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.command-center.spec.ts`
- Plan reference: implementation-plan.md:14, :27; `TASK/code-logic-review.md` finding L2; Decision D9
- Defect: `startNewConversation` (`message-sender.service.ts:457-472`) sends `chat:start` with no
  `options.systemPrompt`; only continue (`:711-719`) and activating resume
  (`session-loader.service.ts:995-1000`) attach `commandCenterPersonaFor`. A regular-chat send on a marked tab
  with no SDK id yet pins a persona-less query that later continues cannot repair.
- Pattern to follow: the continue-path persona spread at `message-sender.service.ts:711-719`.
- Quality requirements: `chat:start` for a marked tab carries `options.systemPrompt: commandCenterPersonaFor(tab)`;
  unmarked tabs send no `systemPrompt` key; the coordinator's own start (Task 6.1) and a racing regular-chat
  send produce the same persona.
- Validation notes: the backend reads `options.systemPrompt` on `chat:start` today; confirm by reading the
  `chat:start` schema and handler and record it in the report.
- Implementation details: extend the existing B4 spec with a marked and an unmarked start case.

### Batch 6 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed. With Task 6.2 the batch changes 2 projects: use
  `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center @ptah-extension/chat --parallel=1 2>&1 | tail -60`
  (header must name 2 projects) in place of the one-project command above.
- No per-batch review.
- Result (2026-10-15): implementer codex lane fcec9867. Orchestrator ran
  `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center @ptah-extension/chat --parallel=1`
  in the foreground: header "Running targets test, typecheck, lint for 2 projects", "Successfully ran
  targets test, typecheck, lint for 2 projects". Team-leader read `session-coordinator.ts`, its spec,
  the barrel line and the sender/spec diff on disk: real code, no TODO/stub markers, explicit `public`
  modifiers, the only lint suppression is the documented page-scope one. L2 closed:
  `message-sender.service.ts:455,473` spreads `systemPrompt` on `chat:start` for a marked tab only;
  specs pin the marked and unmarked start. Report: `TASK/reports/batch-6-report.md`.
- Closed by team-leader on disk: a voice lock engaged before the first send holds
  `sdkSessionId: null`, keyed by `rootTabId`; `isHeld` matches on the root tab ID and
  `TabManagerService.attachSession` (`tab-manager.service.ts:1962`) calls `rekey(tabId, sessionId)`,
  so the lock follows the new SDK ID.
- Carried defect (fixed in Task 8.4, before any push): `tools/degradation-audit` runs in CI
  (`.github/workflows/ci.yml:81-84`) and `libs/frontend/command-center` has no baseline entry
  (baseline 0). By the detector rules (`check-degradation.ts:505-625`) three sites in
  `session-coordinator.ts` count: `:41-43` `.catch(() => undefined)` (promise-catch-sentinel),
  `:80-83` and `:167-170` (catch-return-sentinel: `this.fail` is not an `.error(...)` call). The
  `:97` catch holds a comment and no literal return, so it does not count. The scoped Nx lint does
  not run this tool, so the batch checks passed; CI would fail.
- Phase B code-logic review watch items: (1) resume path `session-coordinator.ts:71-79` attaches the
  last SDK ID to a new marked tab, then calls `ChatStore.switchSession`; confirm it does not open a
  second tab for the same SDK ID, and that the first send after resume reaches `chat:continue` with the
  persona (B4) rather than relying on a history-only resume. (2) The `:80` failure path leaves the
  newly created marked tab in place with the SDK ID attached; confirm a retry reuses it rather than
  creating another. (3) `openOrResume` dedupe at `:37-45`.

## Batch 6A: Lock release on close and record-write surfacing (deferred Phase A review L3, L4) - COMPLETE (commit f7230a25b)

- Recommended executor: CLI lane (implementation; Angular data-access TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: two surgical fixes in one data-access lib, both on the marked-tab close and bind paths.
- Tasks: 2 | Depends on: B3 | May run concurrently with B5 (Decision D11); otherwise runs after B5
- Phase: B | Phase review: covered by the Phase B review after B8
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-state --parallel=1 2>&1 | tail -60`
  (header must name 1 project). Verification rules above apply.
- Suggested commit: `fix(chat-state): batch 6A - release lock on close, surface record failures`

### Task 6A.1: Drop the send lock when its root tab closes (L3) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- Plan reference: implementation-plan.md:17, :29; `TASK/code-logic-review.md` finding L3; Decision D10
- Defect: confirmed close of a marked tab (`tab-manager.service.ts:1349-1352`) clears the active-tab record and
  does not release the lock; `release` is token-gated, so close cannot call it.
- Quality requirements: a lock-service method that clears the lock only when its `rootTabId` is the given tab id;
  `closeTab` calls it after the confirm, for a removed tab only (a workspace-switch park keeps the lock). Owner
  `release` after the clear is a no-op; another root's lock is untouched.
- Validation notes: do not treat the next `engage` overwrite as the release path.

### Task 6A.2: Surface a failed records write on bind, create and close (L4) - COMPLETE

- Depends on: Task 6A.1 (same file)
- Files: same as Task 6A.1 (tab-manager service and its command-center spec)
- Plan reference: implementation-plan.md:16; `TASK/code-logic-review.md` "Record write failure looks like success"; Decision D10
- Defect: `CommandCenterRecordsService` writes return `false` on quota or validation failure; `attachSession`
  (`tab-manager.service.ts:1930-1933`, `writeLastSession`) and `createCommandCenterTab` (`:991`, `setActiveTabId`)
  ignore it, as does the close-path `setActiveTabId(..., null)`.
- Quality requirements: on `false`, log a warning with the workspace and record kind (no raw exception text) and set
  a readonly signal that the page (Task 14) can read to show a safe notice; the tab lifecycle still proceeds.
- Validation notes: a later successful write clears the signal; unmarked tabs never touch it.

### Batch 6A verification

- Every listed artifact exists and contains the required work.
- The scoped command passes (1 project); output tailed; all existing `tab-manager.*.spec.ts` still pass.
- No per-batch review; the Phase B review covers it.
- Edge cases: close of a marked tab with lock engaged; close of a non-root tab; park on workspace switch;
  setItem throws on bind and on close.
- Result (2026-10-15): implementer codex lane 08e4604b, run concurrently with B5 (Decision D11);
  the lane ran no Nx or Jest. Orchestrator scoped run: header "for project @ptah-extension/chat-state",
  "Successfully ran targets test, typecheck, lint". Team-leader read the diff on disk:
  `clearForRoot(tabId)` clears only a matching root (`command-center-send-lock.service.ts:26-29`);
  `closeTab` calls it after the post-confirm re-read and the `_tabs` removal, so a cancelled close or
  a workspace-switch park returns before it (`tab-manager.service.ts:1370-1405`).
  `recordCommandCenterWrite` warns with workspace and record kind only (no raw exception text) and
  sets or clears the readonly `commandCenterRecordWriteFailure` signal on create, close and SDK bind;
  the lifecycle proceeds. `console.warn` matches the file's existing style (TabManagerService has no
  injected Logger). All four edge cases are covered in `tab-manager.command-center.spec.ts` and
  `command-center-send-lock.service.spec.ts`. Report: `TASK/reports/batch-6A-report.md`.
- Barrel note: `CommandCenterRecordWriteFailure` is exported from `tab-manager.service.ts` but not
  from `libs/frontend/chat-state/src/index.ts`. B14 needs no barrel change if the page reads the
  signal through `TabManagerService` with the inferred type (see Task 14.2). Add the type export only
  if a later batch must name the type, and count `chat-state` in that batch's scoped command.

## Batch 7: Tribunal pure framing, phase derivation and narrow phase entry - COMPLETE (commit 9b3f268be)

- Recommended executor: CLI lane (implementation; behaviour-preserving refactor, Angular TypeScript)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: extraction inside one lib with Tribunal behaviour unchanged; 10 files.
- Tasks: 3 | Depends on: none in code (runs after B6 by order, Decision D5)
- Phase: B | Phase review: after B8 (style review covers the new `phase` entry)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/tribunal-panel --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `refactor(tribunal-panel): batch 7 - extract run framing and phase derivation`

### Task 7.1: Extract tribunal-run-framing.ts - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.spec.ts`
- Plan reference: implementation-plan.md:20, :31, :73
- Pattern to follow: framing at `tribunal-run.service.ts:150-180,315-363`, lane tags `:397-409`, round bounds `:109,230-232`
- Quality requirements: pure functions (no DI) for framing text, lane tag format `[tribunal:<laneId>] (<role>)` and
  move round bounds; add a "conduct this approved run, then return to your normal role" framing variant for the
  head-of-engineering root that does not replace the persona. `TribunalRunService` delegates to them; its output is
  byte-identical for existing paths.
- Validation notes: existing tribunal-run specs stay green unchanged except imports.
- Implementation details: move, re-export, spec snapshots of existing strings.

### Task 7.2: Extract tribunal-phase-derivation.ts - COMPLETE

- Depends on: Task 7.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts`
- Plan reference: implementation-plan.md:20, :31, :73, :91
- Pattern to follow: `tribunal-progress.service.ts:60-68,113-127,315-361,480-505`
- Quality requirements: pure `derivePhase({ move, specTaskId, laneBindings, agents, artifacts })` used by the progress
  service and later by Command Center; missing artifacts yield "phase unavailable" with a reason; unregistered tagged
  work yields provisional lane state.
- Validation notes: Tribunal page behaviour unchanged.
- Implementation details: progress service delegates; existing progress specs stay green.

### Task 7.3: Narrow phase entry and alias - COMPLETE

- Depends on: Task 7.2
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/tsconfig.base.json`
- Plan reference: implementation-plan.md:44, :73; Decision D6
- Pattern to follow: `libs/frontend/ui/src/brand-mark.ts`; alias style `tsconfig.base.json:217`
- Quality requirements: `phase.ts` exports only the framing and phase-derivation functions and their types; never the
  page, components or `TribunalStateService`. Alias `@ptah-extension/tribunal-panel/phase`.
- Validation notes: tribunal-panel never imports command-center.
- Implementation details: add a small spec only if needed to pin the export list (counts toward the 10-file limit).

### Batch 7 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed; existing tribunal specs green.
- No per-batch review.
- Result (team-leader, Mode 2): implementer codex CLI lane `1c4132d2`; report `TASK/reports/batch-7-report.md`.
  Scoped `run-many -t test typecheck lint -p @ptah-extension/tribunal-panel` header named 1 project and passed
  (19 suites, 0 lint warnings). On disk: `phase.ts` exports only `buildTribunalFraming`,
  `buildApprovedRootFraming`, `roundCapFor`, `laneTag`, `derivePhase` and 3 types; one alias at
  `tsconfig.base.json:33`; `tribunal-run.service.spec.ts` unchanged; progress spec changed one import; no
  `command-center` import and no catch site in tribunal-panel's new files. Carried to the Phase B style review:
  `derivePhase` uses literal `2` instead of `DEFAULT_CRUCIBLE_ROUND_CAP` (`tribunal-phase-derivation.ts`), and
  the new files keep long one-line declarations (the lint-staged `format:write` left them unchanged; commit
  `git show --stat` matched the working diff line for line, so no whole-file CRLF rewrite).

## Batch 8: Owned work projection, status context and Tribunal roster gate (A1) - COMPLETE (commit 2137ab904)

- Recommended executor: CLI lane (implementation; Angular feature TypeScript, strong test design)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: carries the paid-spawn safety invariant (A1); highest-risk logic, so the batch stays at 8 files.
- Tasks: 4 | Depends on: B6, B7
- Phase: B (last batch) | Phase review: code-logic + style on the combined diff B5-B8
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 8 - work projection and tribunal roster gate`

### Task 8.1: Owned work projection - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.spec.ts` (new)
- Plan reference: implementation-plan.md:18-19, :30; task-description AC11, AC14, AC15
- Pattern to follow: `agent-monitor.store.ts:426-432,891-893,2396-2410`; `session-organization.types.ts:116-128`
- Quality requirements: stable IDs `root:<sdkId>`, `cli:<agentId>`, `sdk:<parentId>:<agentId>`, `child:<sessionIdOrTabId>`,
  `tribunal:<runId>`, `phase:<runId>:<phase>`; recursive descendants of the active root only; reconcile monitor
  snapshots, `AGENT_SESSION_OPENED`/`chat:agent-sessions` and persisted `session:list` `organization.parentSessionId`;
  provisional tab ID replaced by SDK ID without duplication; terminal fallback; terminal nodes kept for the current
  root; unknown/unattributed and sibling-root work ignored; Tribunal runs grouped with lanes and derived phase via
  `@ptah-extension/tribunal-panel/phase`. Full list always; scene cap is the renderer's job.
- Validation notes: no new RPC (plan line 18).
- Implementation details: pure reducer over inputs; spec covers rekey, sibling exclusion, restart join, two runs.

### Task 8.2: COMMAND_CENTER_STATUS_CONTEXT builder - COMPLETE

- Depends on: Task 8.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/status-context.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/status-context.spec.ts` (new)
- Plan reference: implementation-plan.md:32; task-description AC13; risk R7
- Pattern to follow: delimited prompt blocks in `tribunal-run-framing.ts` (Task 7.1)
- Quality requirements: clearly delimited block of node IDs, states and ages, at most 2 KB (truncate with a count);
  no secrets, raw tool output or error text. Wire it into the coordinator's `statusContextProvider` (Task 6.1) with a
  one-line change in `session-coordinator.ts` (allowed edit; report it).
- Validation notes: ordinary chat sends never receive the block.
- Implementation details: pure function; spec covers cap, redaction, empty tree.

### Task 8.3: Roster proposal validation and Tribunal run coordinator (Amendment A1) - COMPLETE

- Depends on: Task 8.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts` (new)
- Plan reference: implementation-plan.md:31, :74, :90-91; Amendment A1 items 1-4 (lines 123-134); decisions.md #17, #18; Decision D1; risk R4
- Pattern to follow: `rosterIsLaunchable` (`tribunal-roster-rules.ts:42-47`); `tasks:create` (`tribunal-run.service.ts:248-267`)
- Quality requirements: parse the delimited payload as untrusted input (nonce, root ID, mode, lanes, objective,
  rounds); reject when the first option is not Decline, no lane, bad lane ID/role syntax, not launchable, rounds out
  of bounds, wrong root or stale nonce, answering Decline. Coordinator: on deny, timeout, page exit or non-delivery
  answer `Decline`; on explicit Confirm answer the fixed D1 text (never "Confirm" or any affirmative); wait for the
  discovery turn to complete; revalidate the immutable roster; call `tasks:create` where required; persist the
  manifest through `command-center-records`; then send exactly one framed launch turn per proposal ID via
  `sendLaunchTurn`. Second confirm or replayed proposal is a no-op. Launch never starts from an
  `ASK_USER_QUESTION_AUTO_RESOLVED` push.
- Validation notes (A1 item 4 tests): confirm delivers no affirmative text; launch sent once and only after
  registration; duplicate confirm ignored; non-Decline-first proposal rejected; timeout answers Decline; a spawn
  observed during the discovery turn shows as provisional and is never registered; AT LIMIT lanes and saved
  preferences respected; two runs; restart with manifest; missing folder.
- Implementation details: confirmation input is a method called only by the card's click/key handler (B13); no
  speech path reaches it.

### Task 8.4: Degradation-audit clean command-center lib (carried from Batch 6) - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.ts`
  (same file Task 8.2 already edits; no new file)
- Plan reference: Batch 6 verification "Carried defect"; `tools/degradation-audit/check-degradation.ts:1-60` (rules
  and suppression syntax); CI step `.github/workflows/ci.yml:81-84`
- Pattern to follow: suppression fixture `tools/degradation-audit/__fixtures__/suppressed-optional-capability.ts`
- Quality requirements: zero unsuppressed degradation-audit sites under `libs/frontend/command-center/src` (non-spec
  files), because the lib has no baseline entry. For `session-coordinator.ts:80-83` and `:167-170` (the catch shows a
  safe toast through `fail`), add `// degradation-audit: reported — <reason>` inside the catch body. For `:41-43`,
  either drop the derived `.catch` by restructuring the dedupe reset so no derived promise can reject unhandled, or
  keep it with a `// degradation-audit: reported — the caller receives the original promise and handles its
  rejection` marker on the comment run directly above the statement. Every new catch or `.catch` written in Tasks
  8.1-8.3 either rethrows, calls an `.error(...)` logger, avoids returning a literal, or carries a valid marker.
- Validation notes: never edit `tools/degradation-audit/baseline.json` (a new lib starts at 0; the ratchet only
  drops). A malformed or orphaned marker is itself a violation.
- Implementation details: comment-only change for the existing sites unless the `:41-43` restructure is chosen.

### Batch 8 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- Phase B's last batch: after commit return NEEDS REVIEW (code-logic + style, combined diff B5-B8); reviewer checks
  A1 conformance, the no-`MESSAGE_HANDLERS` rule and that chat/tribunal-panel never import command-center.
- Phase B review plan (team-leader, after B7): implementer family codex for B5-B8 (B6A also lane-implemented).
  Code-logic review: grok CLI lane (different family). Style review is due (new public API
  `@ptah-extension/command-center` and `@ptah-extension/tribunal-panel/phase`): in-process `code-style-reviewer`
  subagent (Anthropic family, different from codex); it may run after the logic review returns, never as a
  concurrent heavy check. Both reviews read the range `fa97a6967^..HEAD` (covers B5, B6A, B6, B7, B8).
- Result (team-leader, Mode 2): implementer codex CLI lane `980ddba8`; report `TASK/reports/batch-8-report.md`.
  Orchestrator's foreground `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center
  --parallel=1 --skip-nx-cache`: header "for project @ptah-extension/command-center", "Successfully ran
  targets test, typecheck, lint", no error or warning lines. Team-leader read all 8 new files and the
  `session-coordinator.ts` diff on disk: real code, no TODO/stub markers; `CONFIRMED_DISCOVERY_ANSWER` is the
  exact D1 text (`tribunal-run-coordinator.ts:5`); deny, timeout, page exit, rejected and replayed proposals
  answer `Decline` (`:24-25,:32-34,:41-42,:68-73`); `parseRosterProposal` rejects non-Decline-first, wrong
  root and stale nonce (`tribunal-roster-proposal.ts:66`). Session-coordinator change is the default
  `statusContextProvider` (`:28`) plus 3 markers; ordinary `send` never reads the provider (`:177-179`).
- Task 8.4 (Decision D12, on-disk classification against `check-degradation.ts`): every non-spec `catch` /
  `.catch` in the lib is accounted for. `session-coordinator.ts:42` marker attaches through Zone 1 of the
  `.catch(...)` call: the call node starts at `opening` on `:43` (`check-degradation.ts:560-563`,
  `commentBlockAbove(callLine - 1)`), and the marker line is consumed even if the arrow is not a sentinel
  (`:581-584`), so it is neither orphaned nor leaves an unsuppressed site. `:83`, `:171`,
  `tribunal-roster-proposal.ts:60` and `tribunal-run-coordinator.ts:63` sit in Zone 2 of their
  `CatchClause` (first comment line after the block opens, `:508-513`). `session-coordinator.ts:100` holds
  only a comment, so it is not `empty-catch` (`:521-523`), and returns no literal; `:152` returns no literal.
  All five markers use `reported` with an em dash and a reason (`SUPPRESSION_BODY_RE`, `:106-107`). CI's
  audit run on push is the final proof.
- Specs are thin (work-projection 2 tests, status-context 3, roster-proposal 4, run-coordinator 8); B17 adds
  the integration specs per AC group. Recorded for the Phase B review.
- Team-leader findings carried to Batch 8F (Decision D13), not fixed here because no production caller
  exists before B13: TL-1 `runs` keyed by `rootTabId` (`command-center-records.ts:29,104,111,117`), so a
  second run under one root overwrites the first and AC 15/16 restart holds one run; TL-2 the manifest
  schema requires a non-empty lane `role` (`command-center-records.ts:18`) but the coordinator writes
  `role: item.role ?? ''` (`tribunal-run-coordinator.ts:54`), so every Council/Forge/Race run would fail
  `writeRunManifest` and be withheld once the real transport is wired (the spec mocks `writeManifest` to
  `true`); TL-3 closing a marked tab never calls `removeRunManifest` (no caller in
  `tab-manager.service.ts`), against plan :16, :98.
- Carried to the Phase B style review (Decision D14): local `rosterIsLaunchableLocally` copy; zod
  `rounds.max(2)` literal (`tribunal-roster-proposal.ts:19`) next to B7's literal `2` in `derivePhase`.
- Phase B review: REQUESTED on `fa97a6967^..2137ab904`. Implementer family: codex (B5, B6, B6A, B7, B8).
  Code-logic reviewer: grok CLI lane (different family), output `TASK/code-logic-review-phase-b.md`.
  Style reviewer: in-process `code-style-reviewer` subagent (Anthropic family), output
  `TASK/code-style-review.md`, run after the logic review returns.
- Phase B verdicts (team-leader, Mode 2 step 6, 2026-10-15): logic `TASK/code-logic-review-phase-b.md`
  NEEDS_REVISION 4/10 (0 B, 6 S + S7, 7 M; grok lane `a59878ea`); style `TASK/code-style-review.md`
  NEEDS_REVISION 6/10 (0 B, 3 S, 6 M, 5 Minor; Anthropic in-process). Both are different families from the
  codex implementer. The orchestrator spot-checked S2 (`tribunal-run-coordinator.ts:28`) and S6
  (`session-coordinator.ts:116-120`) on disk. The one fix round is B8F (8F0, 8FA-8FE). Disposition: Decision D20.

## Batch 8F: Phase B fix round - split into 8F0, 8FA, 8FB, 8FC, 8FD, 8FE - see sub-batches

The Phase B reviews returned NEEDS_REVISION on both sides (`TASK/code-logic-review-phase-b.md`, grok, 4/10, 0 B,
6 S, 7 M; `TASK/code-style-review.md`, Anthropic in-process, 6/10, 0 B, 3 S, 6 M, 5 Minor). This is the one fix
round (Decision D13). Disposition of every finding: Decision D20. The original Tasks 8F.1-8F.3 (TL-1..TL-3) move
into Batch 8FA (chat-state half) and Batch 8FC (coordinator half of TL-2).

Run order (Decisions D16, D24):

1. **8F0** alone (format-only; every later 8F batch edits files it formats). Commit before any lane starts.
2. **Wave 1, PARALLEL MODE: 8FA, 8FB, 8FD**, three lanes. They are file-disjoint and in disjoint Nx projects
   (8FA `chat-state`; 8FB `tribunal-panel`; 8FD `chat` + `command-center`). Lanes run no `nx` and no `jest`.
   When all three are back, the team leader checks and commits them one at a time, in this order:
   8FA, 8FB, 8FD (one heavy check in flight at a time).
3. **8FC** (needs the 8FA manifest contract and the 8FB phase exports on disk and committed).
4. **8FE**. It edits `command-center.store.ts` after 8FD and shares the `command-center` project with 8FC, so
   it runs after 8FC, not beside it.
5. NEEDS REVIEW: one code-logic re-review (grok lane) on `5d52cfa5b..HEAD`, which excludes the format-only
   commit. A style re-review also runs (in-process `code-style-reviewer`), because 8FB widens the
   `@ptah-extension/tribunal-panel/phase` entry. Scope it to `phase.ts`, its guard spec, `tribunal-roster-proposal.ts`
   and Prettier compliance of the 8F files.

Implementer family for 8F lanes: any capable family except grok, so the grok re-review stays independent. If a
lane falls back to grok, the logic re-review goes to another non-implementer family. Record the families on the
8FE header.

### 8F lane prompt preamble (paste verbatim at the top of every 8F lane prompt, then the batch section)

```text
Worktree (the only place you edit): D:/projects/ptah-extension/.claude-worktrees/command-center (branch feat/command-center)
Task folder: D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083
Read first: <task folder>/batches.md (your batch section and "Verification rules"), <task folder>/code-logic-review-phase-b.md,
<task folder>/code-style-review.md, <task folder>/implementation-plan.md lines 118-137 (Amendment A1, binding).

Verification rules (verbatim from batches.md):
- Verify only the project(s) the batch changed. Use the batch's one scoped command below. For one-off spec runs:
  `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Never run workspace-wide checks and never `nx run-many` across projects the batch did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets.
- Cap concurrency: `--parallel=1` for Nx, `--maxWorkers=2` for Jest.
- One heavy check at a time across all lanes; never start a second one while one is in flight.
- One foreground run with a long timeout; filter output (`| tail -40`, `grep`) instead of re-running.
- With `nx run-many -p A B`, confirm the header names the requested project count. Never use positional
  `nx test A B`.
- Lanes never run git. The team-leader owns commits. Executors never edit `batches.md` or `task.md`.

Lane rules for this batch:
- You run NO nx and NO jest command. Other lanes run beside you; the team leader runs the scoped command
  listed in your batch section after you return. Do not run it yourself.
- Hard ceiling: 40 tool calls. If you reach it, stop and report what is done and what is left.
- Keep any Jest or tool cache outside the worktree (never create .jest-cache or similar under the worktree).
- No git commands of any kind (no add, commit, stash, checkout, restore).
- Touch only the files listed in your batch section. If a fix needs another file, stop and report it; do not edit it.
- Line numbers in the batch sections predate the 8F0 Prettier commit (5d52cfa5b) and may be off by a few lines.
  Locate code by symbol name and confirm on disk before editing.
- Real code only: no TODO, PLACEHOLDER or STUB markers, no empty method bodies, no mock data standing in for
  logic, no logging in place of an implementation. Replace code in place; no V2 copies or compatibility shims.
- New and changed code is lint-clean under the project's eslint config and Prettier-formatted. Finish with
  `npx prettier --write <every file you changed>` then `npx prettier --check <the same files>` (must print
  "All matched files use Prettier code style!"). Prettier is the only command you may run besides reads.
- Degradation-audit rules (tools/degradation-audit/check-degradation.ts). The restored pre-commit hook runs it on
  every TS commit (and CI on push), so ONE violation now blocks the team leader's commit of your batch. Every new or changed
  `catch` / `.catch` in non-spec code either rethrows, calls an `.error(...)` logger, avoids returning a literal
  (object literals and `false`/`null` count as literals), or carries a valid marker. Marker syntax is
  `// degradation-audit: reported — <reason>` (em dash), as the first comment line inside the catch body, or on
  the comment run directly above a `.catch(` call. A malformed or orphaned marker is itself a violation. Never
  edit tools/degradation-audit/baseline.json.
- Deliverable: write <task folder>/reports/batch-<id>-report.md with: each task and finding ID and how it was
  fixed (file:line), the absolute path of every file changed, the specs added or changed and what each asserts,
  every catch site and its degradation-audit classification, the prettier --check output line, and anything you
  could not do. Then return a short summary naming that report path.
```

## Batch 8F0: Format-only pass on files this task created or changed - COMPLETE (commit 5d52cfa5b)

- Recommended executor: CLI lane (mechanical; one command)
- Execution mode: sequential (runs alone, before every other 8F batch)
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: none (format-only; excluded from the re-review range)
- Rationale: style review S1. The cause was that no git hook ever ran in this worktree (Decision D15). Formatting
  first keeps every later 8F diff readable.
- Tasks: 1 | Depends on: Phase B verdicts (received)
- Phase: B (fix round) | Phase review: none (formatting only)
- Scoped verification (team leader): `npx prettier --check <the 41 files below>` must print "All matched files use
  Prettier code style!"; `git diff --name-only` must list exactly those 41 files. No nx/jest: Prettier keeps the
  AST, and the logic batches that follow re-run each project's tests.
- Suggested commit: `style: batch 8F0 - prettier on command center task files` (no scope; commitlint
  `scope-empty` is not enforced). Body: names Decision D15/D17 and lists the excluded files.

### Task 8F0.1: Prettier on the 41 task files - COMPLETE

- Files (all relative to the worktree root; the lane passes these exact paths, never a glob):
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-persona-resume.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-persona.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/session-rpc-rewind-persona.spec.ts`,
  `libs/frontend/chat-state/src/index.ts`,
  `libs/frontend/chat-state/src/lib/command-center-persona.spec.ts`,
  `libs/frontend/chat-state/src/lib/command-center-records.spec.ts`,
  `libs/frontend/chat-state/src/lib/command-center-records.ts`,
  `libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-restore-command-center.spec.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.command-center-lock.spec.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-loader.command-center-persona.spec.ts`,
  `libs/frontend/chat/src/lib/services/chat.store.question-tab.spec.ts`,
  `libs/frontend/chat/src/lib/services/chat.store.ts`,
  `libs/frontend/chat/src/lib/services/message-sender.command-center.spec.ts`,
  `libs/frontend/chat/src/lib/services/message-sender.service.ts`,
  `libs/frontend/command-center/src/lib/model/command-center.store.spec.ts`,
  `libs/frontend/command-center/src/lib/model/command-center.store.ts`,
  `libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts`,
  `libs/frontend/command-center/src/lib/model/session-coordinator.ts`,
  `libs/frontend/command-center/src/lib/model/status-context.spec.ts`,
  `libs/frontend/command-center/src/lib/model/status-context.ts`,
  `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts`,
  `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts`,
  `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`,
  `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`,
  `libs/frontend/command-center/src/lib/model/work-projection.spec.ts`,
  `libs/frontend/command-center/src/lib/model/work-projection.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.spec.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.spec.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts`,
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts`,
  `libs/frontend/tribunal-panel/src/phase.ts`,
  `libs/shared/src/lib/types/rpc/rpc-chat.types.spec.ts`,
  `tsconfig.base.json`
- Quality requirements: run `npx prettier --write <the 41 paths>` from the worktree root, then
  `npx prettier --check <the 41 paths>`. No other edit. Do NOT format
  `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (217 lines of drift that predate this
  task; the task's hunks sit at :40 and :995-1001) or
  `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` (drift at :194-195 predates this task).
  Staging either file makes the re-enabled lint-staged hook rewrite the whole file (Decision D17).
- Validation notes: 37 of the 41 are new in this task. The other modified files (`tab-manager.service.ts`,
  `message-sender.service.ts`, `message-dispatch.service.ts`, `chat-slash-command-router.service.ts`,
  `tribunal-progress.service*.ts`, `tribunal-run.service.ts`, `chat-state/src/index.ts`, `rpc-chat.types.spec.ts`,
  `tsconfig.base.json`) were Prettier-clean on `main`, so a whole-file run changes only this task's hunks. The
  style review assumed otherwise; the team leader checked `main` with `prettier --check --stdin-filepath`.
  `chat.store.ts` was already dirty on `main` (drift at :33 and :228, about 8 lines). It is formatted whole anyway,
  because 8FD stages it again and the hook would format it whole at that point too.
- Lane prompt: preamble plus this section. Deliverable `TASK/reports/batch-8F0-report.md`.

### Batch 8F0 verification

- `prettier --check` on the 41 files passes; `git diff --name-only` lists exactly the 41 files; the diff carries
  no token changes beyond formatting (spot-check `git diff --word-diff` on 3 files).
- The commit runs the restored pre-commit hook (Decision D16, Q1 answered in D25).
- Result (team-leader, Mode 2): executor orchestrator in-process (one Prettier command, no lane); report
  `TASK/reports/batch-8F0-report.md`. 40 files changed, all in the list; the 41st
  (`tribunal-progress.service.spec.ts`) was already clean. Spot-check: stripped-token compare of
  `tribunal-run-coordinator.ts`, `tab-manager.service.ts`, `phase.ts` identical to `HEAD`;
  `command-center.store.ts` differs only by Prettier joining the `CommandSessionStatus` union (leading `|`
  dropped); `prettier --check` on 3 sampled files (incl. `chat.store.ts`, `tsconfig.base.json`) clean.
  Excluded per D17: `session-loader.service.ts`, `chat-rpc.schema.spec.ts` (not staged).
- Commit attempt 1 (team-leader, foreground, hook not bypassed): FAILED in the pre-commit hook.
  lint-staged `nx format:write` changed nothing; `nx affected --target=lint` ran 80 projects (3m10s), 79 passed,
  `degradation-audit:lint` failed: `libs/frontend/chat-state: 3 FAIL (baseline 2)`. The new site is
  `libs/frontend/chat-state/src/lib/command-center-records.ts:78 [catch-return-sentinel]` (`write()`'s
  `catch { return false; }`). It is NOT caused by formatting: the same catch is at `:73` on `HEAD` and dates from
  Batch 2 (`619ec683b`), committed while no hook ran (D15). The audit scans the whole tree, so every TS commit
  fails until it is fixed. Fix: Task 8F0.2. Nothing was committed; the index still holds the 42 staged paths.
- Task 8F0.2 verified (team-leader, Mode 2): the marker is the first line of the `write()` catch body
  (`command-center-records.ts:79`, `return false;` at `:80`); `prettier --check` on the file is clean; one direct
  audit run (`check-degradation.ts --max-warnings=-1`, exit 0) prints `libs/frontend/chat-state: 2 ok (baseline 2)`,
  `libs/backend/rpc-handlers: 1 ok (baseline 1)`, `libs/frontend/tribunal-panel: 1 ok (baseline 1)` and no FAIL line.
- Commit attempt 2 (team-leader, foreground, hook not bypassed): PASSED. lint-staged `nx format:write` and
  `nx affected --target=lint --max-warnings=-1` both green, commitlint valid. Commit `5d52cfa5b`, 42 files (the 40
  formatted files, `batches.md`, `reports/batch-8F0-report.md`). `HANDOFF.md` and `reports/phase-b.diff` stay
  untracked and unstaged.

### Task 8F0.2: Degradation-audit marker on the records write catch (carried from Batch 2) - COMPLETE

- File: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`
  (already in the 8F0 set; no other file)
- Finding: `:78` `catch { return false; }` in `private write(...)` is a `catch-return-sentinel`
  (`libs/frontend/chat-state` baseline is 2; this is the third). Never edit `tools/degradation-audit/baseline.json`.
- Pattern to follow: Task 8.4 markers in `libs/frontend/command-center/src` and
  `tools/degradation-audit/__fixtures__/suppressed-optional-capability.ts`.
- Quality requirements: add, as the first comment line inside the catch body, exactly one marker with an em dash:
  `// degradation-audit: reported — false reaches TabManagerService.recordCommandCenterWrite, which warns and sets commandCenterRecordWriteFailure`
  (wrap is not allowed inside the marker line; keep it one line). The marker is true: every caller of
  `writeLastSession`/`writeRunManifest` passes the boolean to `recordCommandCenterWrite`
  (`tab-manager.service.ts:1014-1027`, warn plus failure signal). No behaviour change, no other edit.
- Verification (team-leader): `npx prettier --check` on the file;
  `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 2>&1 | grep chat-state`
  must show `libs/frontend/chat-state: 2 ok (baseline 2)`; then re-stage the file and re-run the 8F0 commit alone in
  the foreground with the hook.
- Validation notes: 8FA rewrites the manifest half of this file next; it must keep this marker.

## Batch 8FA: chat-state manifest contract and close cleanup (TL-1, TL-2 schema, TL-3) - COMPLETE (commit dd8e42cd9)

- Recommended executor: CLI lane (implementation; Angular data-access TypeScript, persisted-schema migration)
- Execution mode: sequential within the batch; runs in PARALLEL wave 1 beside 8FB and 8FD
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (grok re-review)
- Rationale: one persisted contract and its close-path consumer, in one project. Same task text as the
  pre-seeded 8F.1-8F.3, plus a remove-by-run API that 8FC's rollback needs.
- Tasks: 3 | Depends on: 8F0 committed
- Phase: B (fix round) | Phase review: covered by the 8F re-review
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-state --parallel=1 2>&1 | tail -60`.
  The header must name 1 project (`@ptah-extension/chat-state`).
- Files the lane may touch (4):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts` (close-path hunk only),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- Suggested commit: `fix(chat-state): batch 8FA - per-run manifests and close cleanup`
- Keep the 8F0.2 marker: the first line inside the `private write(...)` catch body in `command-center-records.ts`
  stays exactly `// degradation-audit: reported — false reaches TabManagerService.recordCommandCenterWrite, which warns and sets commandCenterRecordWriteFailure`
  (one line, em dash). If `write()` moves or changes, the marker moves with its catch. Any new catch in the
  rewritten read/migrate path needs its own valid classification (`libs/frontend/chat-state` is at baseline 2).

### Task 8FA.1: Key run manifests by run ID and migrate the old shape on read (TL-1 / logic M1) - COMPLETE

- Finding: `command-center-records.ts:29` (`runs: Record<string, …>` keyed by `rootTabId`), `:103-118`
  (`readRunManifest`/`writeRunManifest`/`removeRunManifest` by `rootTabId`, write at `:111`). A second run under
  one root replaces the first.
- Plan reference: implementation-plan.md:16, :74, :98; B8 validation notes "two runs", "restart with manifest"
- Pattern to follow: the existing per-field `safeParse` sanitising read (`command-center-records.ts:41-67`)
- Quality requirements: store `runs` keyed by `runId`. Replace the three methods in place (no V2):
  `readRunManifests(workspacePath, rootTabId): readonly CommandCenterRunManifest[]` (every valid manifest for that
  root, sorted by `startedAt` ascending); `writeRunManifest(workspacePath, manifest): boolean` (adds or replaces
  by `runId`); `removeRunManifest(workspacePath, runId): boolean` (drops one run; 8FC's rollback calls it through
  its transport); `removeRunManifests(workspacePath, rootTabId): boolean` (drops every run of that root). On read,
  accept the old shape: an entry keyed by a `rootTabId` whose manifest `rootTabId` equals the key is re-keyed by its
  `runId`. Drop entries that fail the schema or whose key matches neither the manifest's `runId` nor its
  `rootTabId`, without losing the valid ones. The next write persists only the new shape. Last-session and
  active-tab fields stay byte-compatible.
- Validation notes (write-path trace, required by Mode 3): the only writer is `writeRunManifest` (8FC transport,
  wired in B13/B14). Removers are `removeRunManifest` (8FC rollback) and `removeRunManifests` (8FA.3 close). The
  reader is `readRunManifests` (B13/B14 restart join). Same storage key (`<partition>.command-center`, `:37-39`),
  same workspace scope, no env side effects. Spec cases: two runs under one root survive a reload; old-shape record
  loads and the next write stores the new shape; a corrupt entry is dropped and the others survive; workspace
  isolation; remove-by-run leaves the sibling run; remove-by-root leaves other roots.

### Task 8FA.2: Role-less lanes in the manifest schema (TL-2 schema half / logic M2 / style Moderate 5) - COMPLETE

- Depends on: Task 8FA.1 (same file)
- Finding: `command-center-records.ts:18` requires `role: nonEmpty`. The coordinator writes `role: item.role ?? ''`
  for Council/Forge/Race (`tribunal-run-coordinator.ts:54`), so every flat-move manifest fails the schema.
- Quality requirements: lane `role` becomes `nonEmpty.optional()`: absent for flat moves, never `''`, and still
  non-empty when present. The inferred `CommandCenterRunManifest` lane type becomes `{ laneId: string; role?: string }`
  (Decision D21: not `LaneRole`, because `chat-state` is `type:data-access` and must not import `tribunal-panel`).
  Spec: a role-less Council manifest writes and reads back; a manifest with `role: ''` is rejected; old records with
  non-empty roles still load.

### Task 8FA.3: Remove the root's run manifests on confirmed close (TL-3 / logic M3) - COMPLETE

- Depends on: Task 8FA.1
- Finding: `tab-manager.service.ts:1370-1405` (close path) never calls a manifest remover. Close clears only the
  active-tab id (`:1378-1379`) and the send lock (`:1403-1404`).
- Plan reference: implementation-plan.md:16, :98 ("Closing it warns, aborts its stream and removes its tab/manifest")
- Pattern to follow: the B6A close path, `clearForRoot` and `recordCommandCenterWrite` (`:1007-1019`)
- Quality requirements: after the confirmed removal of a marked root tab, call `removeRunManifests(workspace, tabId)`
  and route its boolean through `recordCommandCenterWrite`. Add `'runManifest'` to `CommandCenterRecordKind`
  (`tab-manager.service.ts:75`). A cancelled close and a workspace-switch park (`:1374` early return) keep the
  manifests. The last-session record stays untouched, so Resume stays available. Unmarked tabs never touch the
  records. Touch only the close-path hunk and the record-kind union in this 3182-line file.
- Spec (`tab-manager.command-center.spec.ts`): confirmed close removes that root's runs and leaves another root's;
  cancel keeps them; a failed remove sets `commandCenterRecordWriteFailure` with record `'runManifest'`; an unmarked
  tab close never calls the remover.

### Batch 8FA verification

- Every listed artifact exists and contains the required work (team leader reads the 4 files on disk).
- The scoped command passes, 1 project in the header.
- Write-path trace recorded on this header after commit (8FA.1 validation notes).
- Result (team-leader, Mode 2, wave 1): executor codex lane; report `TASK/reports/batch-8FA-report.md`. On disk:
  lane `role` is `nonEmpty.optional()` (`command-center-records.ts:18`); `read()` re-keys a manifest stored under
  its `runId` or its `rootTabId` by `runId` and drops the rest; `readRunManifests` filters by root and sorts by
  `startedAt`; `writeRunManifest` keys by `runId`; `removeRunManifest(runId)` and `removeRunManifests(rootTabId)`
  exist. The 8F0.2 marker is intact in the `write()` catch. `tab-manager.service.ts` changes only the record-kind
  union (`'runManifest'`) and the close-path call after the tab is removed (`:1419-1426`), routed through
  `recordCommandCenterWrite`. No new catch site. No stale `readRunManifest` caller in `libs/`.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/chat-state`,
  header 1 project, all 3 targets green. Commit `dd8e42cd9`: pre-commit hook (lint-staged format, `nx affected
  --target=lint --max-warnings=-1` incl. degradation audit) and commitlint passed on the first attempt.
- Write-path trace (Mode 3 input): one storage key, `<workspace partition key>.command-center`
  (`command-center-records.ts:38`), localStorage, workspace scope, no env side effects. Writer: `writeRunManifest`
  (no production caller yet; 8FC transport, wired in B13/B14). Removers: `removeRunManifests` (only caller
  `tab-manager.service.ts:1422`, confirmed close of a marked root) and `removeRunManifest` (8FC rollback, not yet
  wired). Reader: `readRunManifests` (B13/B14 restart join, not yet wired). Old root-keyed records load and the
  next write persists the run-keyed shape; last-session and active-tab fields are unchanged.

## Batch 8FB: Tribunal phase entry widening and constants (style S2, S3, Moderate 2) - COMPLETE (commit 545d3b53a)

- Recommended executor: CLI lane (implementation; pure TypeScript module surface)
- Execution mode: sequential within the batch; runs in PARALLEL wave 1 beside 8FA and 8FD
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (grok logic re-review plus in-process style re-review, because the
  public `phase` entry widens)
- Rationale: style ruling 3 (Decision D14 resolved: widen). The rule file is pure; exporting the real rule and
  constants removes the Command Center mirror in 8FC.
- Tasks: 3 | Depends on: 8F0 committed
- Phase: B (fix round) | Phase review: covered by the 8F re-review (logic + style)
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/tribunal-panel --parallel=1 2>&1 | tail -60`.
  The header must name 1 project.
- Files the lane may touch (5):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts`
- Suggested commit: `refactor(tribunal-panel): batch 8FB - export roster rule and round caps`

### Task 8FB.1: Split the round cap and replace the literal 2s (style S3, ruling 2) - COMPLETE

- Findings: `tribunal-run-framing.ts:97` (`DEFAULT_CRUCIBLE_ROUND_CAP = 2`, doc says "default AND maximum"),
  `:104` (`Math.min(..., 2)`), `tribunal-phase-derivation.ts:61` (`?? 2`).
- Quality requirements: keep `DEFAULT_CRUCIBLE_ROUND_CAP = 2` and add `MAX_CRUCIBLE_ROUND_CAP = 2` beside it, each
  with a one-line doc comment for its own meaning. `roundCapFor` clamps with `MAX_CRUCIBLE_ROUND_CAP`.
  `derivePhase` uses `?? DEFAULT_CRUCIBLE_ROUND_CAP` (import from `./tribunal-run-framing`). Behaviour does not change.
  The existing framing and derivation specs must still pass unchanged.

### Task 8FB.2: A canonical move list (style S3, moves re-typed) - COMPLETE

- Finding: `TribunalMove` is a type only (`tribunal-ui.types.ts:4`), so `tribunal-roster-proposal.ts:16` re-types
  the five moves as a zod enum literal.
- Quality requirements: in `tribunal-ui.types.ts` add `export const TRIBUNAL_MOVES = ['council', 'forge', 'race',
  'relay', 'crucible'] as const;` and derive `export type TribunalMove = (typeof TRIBUNAL_MOVES)[number];`. The type
  must stay identical, and no other file in `tribunal-panel` needs an edit for it.

### Task 8FB.3: Widen the phase entry, add its header and a barrel guard (style S2, Moderate 2, ruling 3) - COMPLETE

- Depends on: Tasks 8FB.1, 8FB.2
- Findings: `phase.ts:1-4` exports only framing and derivation, so the Command Center keeps a drifting copy of
  `rosterIsLaunchable` (`tribunal-roster-proposal.ts:35-51` against `tribunal-roster-rules.ts:42-47`). `phase.ts`
  has no header and no guard, unlike `chat-ui/src/turn-recap.ts` and `marketplace/src/harness.ts`; `ui` guards its
  entry with `brand-mark-barrels.spec.ts`.
- Quality requirements: `phase.ts` adds `rosterIsLaunchable` (from `./lib/services/tribunal-roster-rules`),
  `DEFAULT_CRUCIBLE_ROUND_CAP` and `MAX_CRUCIBLE_ROUND_CAP` (from `./lib/services/tribunal-run-framing`), and
  `RELAY_ROLES`, `CRUCIBLE_ROLES`, `TRIBUNAL_MOVES` plus types `TribunalMove`, `LaneRole`, `VendorLane` (from
  `./lib/types/tribunal-ui.types`). Named exports only, never `export *`. Add a 6-8 line header: why the entry
  exists (Command Center reads Tribunal's pure rules without the Angular panel), and that it must stay pure (no
  Angular, no DI, no `TribunalStateService`, no component). Name Decision D6 and say no eager importer may be added.
  First confirm that `tribunal-roster-rules.ts` and `tribunal-ui.types.ts` import nothing from Angular. Report their
  import lines.
  New `phase.spec.ts` asserts the exact sorted list of runtime export names of `./phase` (`import * as phase`), so an
  accidental `export *` or an Angular symbol fails the test. Use `brand-mark-barrels.spec.ts` in `libs/frontend/ui`
  as the pattern.

### Batch 8FB verification

- Every listed artifact exists; the scoped command passes, 1 project in the header.
- `git diff` of `tribunal-run-framing.ts` / `tribunal-phase-derivation.ts` shows constant swaps only.
- Result (team-leader, Mode 2, wave 1): executor codex lane; report `TASK/reports/batch-8FB-report.md`. On disk:
  the framing and derivation diffs are constant swaps only (new `MAX_CRUCIBLE_ROUND_CAP = 2`, `Math.min(..., MAX_...)`,
  `?? DEFAULT_CRUCIBLE_ROUND_CAP`) plus one doc line split; no import cycle (framing does not import derivation).
  `TRIBUNAL_MOVES` tuple with `TribunalMove` derived from it. `phase.ts` has a 6-line purity header naming D6 and
  named exports only; `phase.spec.ts` pins `Object.keys(phase).sort()` (11 runtime names). Rule-file imports:
  `tribunal-roster-rules.ts:1-7` imports only from `../types/tribunal-ui.types`; `tribunal-ui.types.ts:1-2` has
  type-only imports from `@ptah-extension/shared` and `@ptah-extension/canvas`; no Angular. No catch site touched.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/tribunal-panel`,
  header 1 project, all 3 targets green. Commit `545d3b53a`: hook and commitlint passed on the first attempt.

## Batch 8FD: Session coordinator resume, voice release and meter zero (S3, S4, S6, M5, M7) - COMPLETE (commit a5adac5cd)

- Recommended executor: CLI lane (implementation; Angular feature TypeScript, strong test design)
- Execution mode: sequential within the batch; runs in PARALLEL wave 1 beside 8FA and 8FB
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (grok re-review)
- Rationale: one owner class (`CommandCenterSessionCoordinator`) plus the store method it calls and a one-field
  `ChatStore` pass-through. It does not depend on 8FA or 8FB: the coordinator reads only `readActiveTabId` and
  `readLastSession`, and neither changes.
- Tasks: 3 | Depends on: 8F0 committed
- Phase: B (fix round) | Phase review: covered by the 8F re-review
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/chat @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  The header must say 2 projects.
- Files the lane may touch (6):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat.store.ts` (the `switchSession` signature only, :220-225),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/chat.store.question-tab.spec.ts`
  (add one case; it already builds a `ChatStore` TestBed)
- Suggested commit: `fix(command-center,chat): batch 8FD - pinned resume and voice release`

### Task 8FD.1: Pin resume to the marked tab and retry an unfinished restore (logic S3, S4, M7) - COMPLETE

- Findings:
  - S3 `session-coordinator.ts:61-65` and `:73-85`: if `switchSession` throws after `createCommandCenterTab` and
    `attachSession`, the next `openOrResume` (often a new page instance, so in-memory flags do not survive) takes
    the "tab already marked" branch. It marks the session `running` without ever restoring history.
  - S4 `session-coordinator.ts:73-78`: `switchSession` gets no `targetTabId`. If another live tab already owns the
    SDK id, `session-loader.service.ts:860-868` switches to that older tab and returns. One SDK id then sits on two
    tabs, and the store points at the new, empty one.
  - M7 `session-coordinator.ts:97-98`: a `success: true` payload with no `sessions` array returns `false`, which
    falls through to `newCommandCenter()` (`:88`). The next send then overwrites the persisted last-session record,
    which loses the resume pointer (Decision D20).
- Quality requirements:
  - `ChatStore.switchSession` (`chat.store.ts:220-225`) widens `opts` with `targetTabId?: TabId` and passes it to
    `sessionLoader.switchSession` unchanged (`SessionLoaderService` already accepts it, `session-loader.service.ts:117`).
    No other `ChatStore` change.
  - Last-session branch: before `createCommandCenterTab`, look up an existing tab for `last.sdkSessionId`
    (`TabManagerService.findTabBySessionId`). If one exists, do not create or attach: `switchTab` to it, `fail` with
    "This session is already open in another tab. Close it there to resume it in Command Center.", and return null
    (Decision D19: refuse, do not adopt). Otherwise create, attach, then
    `chat.switchSession(SessionId.from(id), { targetTabId: TabId.from(tabId) })`. Use whatever `TabId`
    constructor/parse helper the codebase already uses; `chat.store.ts` uses `TabId.safeParse`. Set
    `running` only after it resolves.
  - Existing-marked-tab branch: if the tab has a `claudeSessionId`, has no messages, and is not `hasLiveSession`
    (verify these fields on `TabState`, `libs/frontend/chat-types/src/lib/chat-types.ts:603`), treat the restore as
    unfinished. Call `switchSession(..., { targetTabId })` again, set `running` only after it resolves, and on throw
    `fail('Could not restore the Command Center session.')` and return null (the tab stays marked for the next try).
    A tab with messages or a live session keeps today's path.
  - `sessionExists`: a `success: true` result whose `data.sessions` is not an array counts as a failed attempt
    (retry, then `null`, then the existing fail toast), never as "not found".
- Specs (`session-coordinator.spec.ts`): retry after a thrown restore calls `switchSession` again with the marked
  tab id and only then reports `running`; an SDK id already on another tab creates no tab, calls no `attachSession`,
  and toasts; the happy path passes `targetTabId`; a success payload without `sessions` creates no tab. One case in
  `chat.store.question-tab.spec.ts` asserts that `switchSession` forwards `targetTabId` to the loader.

### Task 8FD.2: New Command Center stops voice together with the lock (logic S6) - COMPLETE

- Finding: `session-coordinator.ts:110-120`. `newCommandCenter()` releases the lock (`:116`) but leaves `voiceState`
  (for example `listening`). Regular chat sends are no longer held (`message-sender.service.ts:100-102`) while the
  page still shows voice as on, which breaks AC25.
- Quality requirements: one private `stopVoiceLocally()` (name is the lane's choice) releases the lock, sets
  `voiceState` to `'idle'` and zeroes the meters through 8FD.3's `resetLevels()`. `newCommandCenter` uses it (voice
  is stopped, not carried to the new tab: Decision D19). `mute` and `stop` keep their states (`'muted'`,
  `'stopped'`) but also zero the meters. `DestroyRef` teardown keeps releasing the lock.
- Spec: `newCommandCenter` while listening leaves `isHeld` false and `voiceState` `'idle'`, with levels 0.

### Task 8FD.3: A trailing zero always reaches the meters (logic M5) - COMPLETE

- Finding: `command-center.store.ts:136-150`. `updateLevels` drops every sample inside 500 ms, including a final
  `(0, 0)`, so output stays at the last accepted level. Batch 10.2 must push a final zero on stop, mute and idle.
- Quality requirements: add `resetLevels(): void`, which sets both levels to 0 and clears `lastLevelUpdateAt`, so the
  throttle restarts. It is the only way to bypass the throttle; `updateLevels` stays as is. Spec: `updateLevels(0.8,
  0.8)` then `resetLevels()` within 500 ms gives 0/0; the next `updateLevels` is accepted at once.

### Batch 8FD verification

- Every listed artifact exists; the scoped command passes with 2 projects in the header.
- `chat.store.ts` diff is the `switchSession` signature and forwarding only (plus the 8F0 formatting already
  committed).
- Result (team-leader, Mode 2, wave 1): executor codex lane; report `TASK/reports/batch-8FD-report.md`. On disk:
  `chat.store.ts` changes one line (the `opts` type gains `targetTabId?: TabId`; the call already forwards `opts`).
  `CommandCenterStore.resetLevels()` zeroes both levels and clears `lastLevelUpdateAt`; `updateLevels` unchanged.
  Coordinator: the marked-tab branch re-runs `switchSession(..., { targetTabId })` when the tab has a session id, no
  messages and no live session, and sets `running` only after it resolves (fail toast plus `null` on throw, with a
  valid `reported` marker); the last-session branch refuses via `findTabBySessionId` (switch to the owner tab, toast,
  `null`) before any create/attach, then passes `targetTabId: TabId.from(tabId)`; `sessionExists` treats a success
  payload without a `sessions` array as a failed attempt; `newCommandCenter` calls `stopVoiceLocally()` (release
  lock, `idle`, `resetLevels`); `mute` and `stop` also call `resetLevels`. One new non-spec catch, marked.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/chat
  @ptah-extension/command-center`, header 2 projects, all 6 tasks green. Commit `a5adac5cd`: hook and commitlint
  passed on the first attempt (Wave 1: `dd8e42cd9`, `545d3b53a`, `a5adac5cd`, no hook failure).

## Batch 8FC: Tribunal confirm state machine, real roster rule, saved preferences (S1, S2, S5, TL-2 coordinator half, style S2/S3, Moderate 4) - COMPLETE (commit ae74169bc)

- Recommended executor: CLI lane (implementation; Angular feature TypeScript, strong test design; paid-spawn safety)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (grok re-review)
- Rationale: carries the A1 paid-spawn invariant. Two source files and their specs only, so the lane has room
  for test design inside 40 tool calls.
- Tasks: 2 | Depends on: 8FA and 8FB committed (needs the optional `role` and `removeRunManifest`, and the `phase`
  exports)
- Phase: B (fix round) | Phase review: covered by the 8F re-review (style re-review reads `tribunal-roster-proposal.ts`)
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  The header must name 1 project.
- Files the lane may touch (4):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- Suggested commit: `fix(command-center): batch 8FC - retryable confirm and real roster rule`

### Task 8FC.1: Roster proposal uses Tribunal's rule and constants, and enforces saved preferences (style S2, S3; logic S5) - COMPLETE

- Findings:
  - style S2 `tribunal-roster-proposal.ts:35-51`: `rosterIsLaunchableLocally` mirrors and has already diverged from
    `tribunal-roster-rules.ts:42-106` (inlined relay roles `:38`, inlined `normalizeModel` `:40`).
  - style S3 `:8` (CLI enum re-typed; canonical `SYSTEM_CLI_TYPES` in `libs/shared/src/lib/types/agent-process.types.ts:70-82`
    plus `'ptah-cli'`), `:10` (roles), `:16` (moves), `:19` (`rounds.max(2)`), `:28` and `:67` (`'AT LIMIT'` twice).
  - logic S5 `:27-32` and `:67`: `availableLanes` is optional, so AT LIMIT is enforced only when the caller passes it.
    `rankAvailableLanes` has no `disabledClis`, so a lane the user disabled can be proposed and launched.
- Quality requirements:
  - Delete `rosterIsLaunchableLocally`. Keep only the two shape checks that the Tribunal rule lacks, as
    `proposalShapeIsValid(proposal)`: unique `laneId`, and flat moves carry no `role`. Launchability is
    `proposalShapeIsValid(p) && rosterIsLaunchable(p.move, p.lanes)` from `@ptah-extension/tribunal-panel/phase`. If
    the zod lane type is not assignable to `VendorLane`, map it explicitly; no cast.
  - zod enums come from the canonical values: `cli` from `[...SYSTEM_CLI_TYPES, 'ptah-cli']` (confirm the export path
    from `@ptah-extension/shared`), `role` from `[...RELAY_ROLES, ...CRUCIBLE_ROLES]`, `move` from `TRIBUNAL_MOVES`, and
    `rounds.max(MAX_CRUCIBLE_ROUND_CAP)`. Add one `const AT_LIMIT_STATE = 'AT LIMIT'`.
  - A named `ProposalAvailability { readonly lanes: readonly AvailableLane[]; readonly disabledClis: readonly string[] }`.
    `AvailableLane` gains `readonly cli: string`. `rankAvailableLanes(availability, preferredAgentOrder)` drops AT
    LIMIT lanes and lanes whose `cli` is disabled, then sorts by preference.
    `parseRosterProposal(payload, expectedRoot, expectedNonce, availability)` takes a **required** availability and
    rejects a proposal with any lane that is missing from `availability.lanes`, is AT LIMIT, or has a `cli` in
    `disabledClis`. Export a `rosterIsAvailable(proposal, availability)` helper for the coordinator's
    confirm-time re-check.
- Specs: a disabled CLI is rejected; an AT LIMIT lane is rejected; a Relay with self-review (same family and model) is
  rejected through the real Tribunal rule; a Council lane with a role is rejected; rounds above
  `MAX_CRUCIBLE_ROUND_CAP` are rejected; the ranker drops disabled and AT LIMIT lanes and keeps preference order.

### Task 8FC.2: Confirm keeps the proposal retryable until the launch is sent (logic S1, S2, TL-2 coordinator half; style Moderate 4) - COMPLETE

- Depends on: Task 8FC.1
- Findings:
  - S1 `tribunal-run-coordinator.ts:36-66`: `confirm` deletes the pending entry and marks the id consumed (`:39-40`)
    before anything succeeds. Every later failure (`discoveryComplete` rejects, `createTask` null, `writeManifest`
    false, `sendLaunchTurn` false) returns `false` with nothing the user can see, and the id can never launch. The
    Decline fallback at `:41-43` ignores its own result.
  - S2 `:22-28`: a second `receive` with an id that is still pending overwrites the first question. The first
    question is never answered and Confirm answers the wrong card. Task 8.3 requires a replay to be a no-op.
  - TL-2 `:54`: `role: item.role ?? ''`.
  - style Moderate 4 `:13`, `:22`: an anonymous 8-field context and a `Pending` interface that duplicates it.
- Quality requirements (Decision D18):
  - Named exported types (exported from this file only, not the barrel): `ProposalReceiveContext { questionId,
    questionKey, rootSdkId, rootTabId, workspace, nonce, availability: ProposalAvailability }` (all readonly,
    availability **required**), and `PendingProposal` built on a readonly base plus its state.
  - Per-proposal state: `open` (question unanswered) -> `answered` (the fixed D1 text was delivered; launch not yet
    sent) -> `launched`; or -> `declined`. `launched` and `declined` are terminal, and only they put the id in
    `consumed`.
  - `receive`: an id that is terminal, or already open or answered, answers `Decline` to the **new** question,
    keeps the first entry untouched, and returns null (S2).
  - `confirm(proposalId): Promise<ConfirmResult>`, where `ConfirmResult = { ok: true } | { ok: false; reason:
    ConfirmFailureReason; retryable: boolean }`. Concurrent calls for one id share one in-flight promise.
    - From `open`: re-check `rosterIsAvailable(proposal, transport.availability())`. If unavailable, answer `Decline`,
      mark it declined, and report `lanes-unavailable`, not retryable. Otherwise send `CONFIRMED_DISCOVERY_ANSWER`.
      If that is not delivered, try `Decline`. If `Decline` is delivered, mark it declined (`answer-undelivered`, not
      retryable). If neither is delivered, stay `open` (`answer-undelivered`, retryable; the host's timeout still
      resolves Decline first).
    - From `answered`, or straight after the answer: `discoveryComplete()`, then revalidate (shape, rule, root,
      availability). If revalidation fails, the state is terminal `declined` with `not-launchable`. No further turn
      is sent, and the failure is reported.
    - Relay/Crucible `createTask` runs once per proposal: keep the returned `specTaskId` on the entry and reuse it on
      retry. Then `writeManifest` with lanes that omit `role` when the proposal lane has none (TL-2; never `''`).
      Then `sendLaunchTurn`. When the send returns false or throws after the manifest write, roll back with
      `transport.removeManifest(workspace, runId)`. Keep the `runId` on the entry, so a retry reuses or rewrites one
      run.
    - Each failure after `answered` keeps the state `answered` with `retryable: true`
      (`discovery-failed`, `task-create-failed`, `manifest-write-failed`, `launch-send-failed`). Success sets
      `launched`.
    - Every `ok: false` calls `transport.reportFailure(message)` once, with a fixed safe message per reason from an
      exported `CONFIRM_FAILURE_MESSAGES: Record<ConfirmFailureReason, string>`. Messages carry no error text and no
      payload content.
  - `ProposalTransport` gains `availability(): ProposalAvailability`, `removeManifest(workspace: string, runId:
    string): boolean` and `reportFailure(message: string): void`. The page wires them in B13/B14 (records service,
    store toast).
  - `pageExit` declines only `open` entries. `answered` entries are dropped without sending a turn. `decline` and
    `timeout` act only on `open` entries.
  - Each `catch` follows the degradation-audit rules in the preamble. A `catch` that returns a result object
    literal needs the marker.
- Specs (`tribunal-run-coordinator.spec.ts`). At least one spec writes the manifest through the real
  `CommandCenterRecordsService` from `@ptah-extension/chat-state`, over an in-memory storage, for a role-less Council
  roster, so a stub can no longer hide the schema. Cases:
  - the delivered answer never contains "Confirm" or any affirmative token (kept);
  - a manifest-write failure, then a retry, launches exactly once and calls `createTask` once (Relay);
  - a launch-send failure rolls back the manifest, and a retry launches once;
  - an undelivered answer with an undelivered Decline stays retryable;
  - a duplicate pending id declines the second question and keeps the first;
  - a disabled CLI at confirm time declines and reports `lanes-unavailable`;
  - every failure calls `reportFailure` exactly once;
  - `pageExit` after `answered` sends no `Decline`;
  - no launch starts from a timeout or auto-resolve (kept).

### Batch 8FC verification

- Every listed artifact exists; the scoped command passes, 1 project.
- The team leader reads every `catch` in the two files against `check-degradation.ts` (Decision D12 method).
- `rosterIsLaunchableLocally` is gone from the lib (grep); the zod enums carry no literal CLI, role, move or 2.
- Result (team-leader, Mode 2): executor codex lane `daeb9089`; report `TASK/reports/batch-8FC-report.md`. Exactly
  the 4 listed files changed. On disk, `tribunal-roster-proposal.ts`: `cli` is `z.enum([...SYSTEM_CLI_TYPES,
  'ptah-cli'])` (the one literal the task names), `role` from `[...RELAY_ROLES, ...CRUCIBLE_ROLES]`, `move` from
  `TRIBUNAL_MOVES`, `rounds.max(MAX_CRUCIBLE_ROUND_CAP)`, one `AT_LIMIT_STATE`; `proposalShapeIsValid` plus
  `rosterIsLaunchable` from `@ptah-extension/tribunal-panel/phase` (no cast); required `ProposalAvailability`;
  `rankAvailableLanes` drops AT LIMIT and disabled CLIs; exported `rosterIsAvailable`. `rosterIsLaunchableLocally`
  has no match under `libs/`. `tribunal-run-coordinator.ts`: exported `ProposalReceiveContext`/`PendingProposal`,
  states `open -> answered -> launched | declined` (only terminal states enter `consumed`), duplicate ids decline the
  new question, one shared in-flight promise per id, `specTaskId`/`runId` kept on the entry and reused, role-less
  manifest lanes omit `role`, send failure rolls back with `removeManifest`, one `reportFailure` per `ok: false` with
  fixed `CONFIRM_FAILURE_MESSAGES`, `pageExit` drops `answered` entries without a turn. The coordinator spec writes a
  role-less Council manifest through the real `CommandCenterRecordsService`. No stubs, no skipped or focused specs.
- Catch classification (D12 method, against `check-degradation.ts`; a valid marker in zone 1 or 2 is consumed by any
  catch, flagged or not, so none is orphaned): `tribunal-roster-proposal.ts:114` returns `null`, a
  catch-return-sentinel, suppressed by a valid `reported` marker. `tribunal-run-coordinator.ts:162`, `:182`, `:206`
  return `this.failure(...)` (a call, not a literal), not flagged, marker consumed. `:224` and `:229` hold a
  comment only, so they are not "truly empty" (`isTrulyEmpty` needs no text between the braces) and have no literal
  return; not flagged, marker consumed (the marker would also suppress an empty-catch). One direct audit run
  (`check-degradation.ts --max-warnings=-1`, exit 0): no `libs/frontend/command-center` line (0 sites, baseline 0),
  no orphaned or bare marker there; `chat-state 2 ok (baseline 2)`, `tribunal-panel 1 ok (baseline 1)`.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/command-center`,
  header 1 project, all 3 targets green.

## Batch 8FE: Tribunal lanes and stage in the projection; persisted state unknown (logic S7, M6; style Moderate 3) - COMPLETE (commit b5af1cc42)

- Families (8F fix round): implementer codex for every 8F lane (8FA `codex`, 8FB `codex`, 8FC `daeb9089`, 8FD
  `codex`, 8FE `9dc9ee2b`); 8F0 was an in-process Prettier run (format-only, outside the review range). Review:
  code-logic re-review by a grok CLI lane on `5d52cfa5b..HEAD`; style re-review by the in-process
  `code-style-reviewer` (Anthropic). Both differ from the codex implementer; no same-family exception.

- Recommended executor: CLI lane (implementation; pure TypeScript reducer, test design)
- Execution mode: sequential (after 8FC, because both edit `command-center`)
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (grok re-review)
- Rationale: one pure reducer file and its spec. AC15 and AC11 gaps that no later batch owns (Decision D20).
- Tasks: 1 | Depends on: 8FD committed (8FD edits `command-center.store.ts` first) and 8FC committed (same project)
- Phase: B (fix round, last batch) | Phase review: after commit, NEEDS REVIEW for the 8F range
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  The header must name 1 project.
- Files the lane may touch (3):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.ts`
  (add `'unknown'` to `CommandWorkState` (`:19-26`) only)
- Suggested commit: `fix(command-center): batch 8FE - tribunal lanes and stage in work tree`

### Task 8FE.1: Lanes and stage for every Tribunal run; persisted-only children are unknown - COMPLETE

- Findings:
  - S7: the review's data-flow and requirement tables call this "S7" (AC15 PARTIAL), though its summary counts six
    Serious (Decision D22). `work-projection.ts:41-50`: Council, Forge and Race runs project one `tribunal:<runId>`
    node with no lanes and no stage, because `derivePhase` returns `kind: 'none'` (`tribunal-phase-derivation.ts:51-53`).
    The spec asserts only group ids (`work-projection.spec.ts:14-20`).
  - M6 `work-projection.ts:27`: persisted-only children are labelled `completed`, so after a restart a running child
    reads as done (AC11) until its live descriptor arrives.
  - style Moderate 3 `:22` (`child.sessionId as string`) and `:59` (`node.parentId as string`). These lines are inside
    the code this task rewrites.
- Quality requirements:
  - For every run (all five moves), emit one node per `run.phase.laneBindings.lanes` entry with id
    `lane:<runId>:<laneId>` (new stable prefix, recorded in Decision D22), parent `tribunal:<runId>`, label the lane's
    `displayName` (with the role when present), `providerId` from the lane's `cli`, and state mapped from
    `laneBindings.bound.get(laneId)?.status` (unbound lanes are `'queued'`). An owned agent whose `runId` matches and
    whose `agentId` equals a lane's `agentId` parents under that lane node instead of the group. No duplicate nodes.
  - When `derivePhase` gives `kind: 'none'` or `'unavailable'`, emit one `phase:<runId>:stage` node with a label for
    that case and the run's state. Relay and Crucible output stays as today.
  - Persisted-only children get state `'unknown'`. Add `'unknown'` to `CommandWorkState` in `command-center.store.ts`
    and nothing else there. Live rows still win. If `status-context.ts` or any other switch over `CommandWorkState`
    fails to typecheck, stop and report it; do not widen the file list.
  - Replace the two `as string` casts with a type-guard filter or `flatMap`.
- Specs: a Council run with 3 bound lanes gives 3 lane nodes plus one stage node; a lane agent parents under its
  lane; a Relay is unchanged; a persisted-only child is `'unknown'` and turns live when its descriptor arrives; two
  runs under one root keep separate lanes.

### Batch 8FE verification

- Every listed artifact exists; the scoped command passes, 1 project.
- Phase B fix round closes with NEEDS REVIEW: logic re-review (grok) on `5d52cfa5b..HEAD`, plus a style
  re-review (in-process) of the `phase` widening and the 8F files' formatting.
- Result (team-leader, Mode 2): executor codex lane `9dc9ee2b`; report `TASK/reports/batch-8FE-report.md`. Exactly
  the 3 listed files changed; `command-center.store.ts` adds only `| 'unknown'` to `CommandWorkState`. On disk,
  `work-projection.ts`: every run emits one `lane:<runId>:<laneId>` node per `laneBindings.lanes` entry under
  `tribunal:<runId>` (label adds the role only when present, `providerId` is the lane `cli`, bound status maps to
  running/completed/failed/cancelled, unbound is `queued`); `derivePhase` kind `none`/`unavailable` emits one
  `phase:<runId>:stage` node with the run state; Relay and Crucible branches are unchanged; an owned agent whose
  `runId` and `agentId` match a lane parents under that lane; persisted-only children are `'unknown'` and a live
  child with the same session id wins; both `as string` casts are replaced by `flatMap` narrowing; nodes are
  de-duplicated by id. No catch site. The only other reader of node state, `status-context.ts:16`, prints it as
  text, so `'unknown'` needs no change there. Specs cover the 5 required cases plus a Crucible unavailable stage.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/command-center`,
  header 1 project, all 3 targets green.
- Phase B fix round B8F: all batches committed (8F0 `5d52cfa5b`, 8FA `dd8e42cd9`, 8FB `545d3b53a`, 8FD
  `a5adac5cd`, 8FC `ae74169bc`, 8FE this commit). Phase B status: NEEDS REVIEW (logic re-review, grok, output
  `TASK/code-logic-review-phase-b-rereview.md`; style re-review, in-process, appends a `## Re-review (fix round 8F)`
  section with its own verdict to `TASK/code-style-review.md`).
- Phase B re-review verdicts (team-leader, Mode 2 step 6, 2026-10-15), range `5d52cfa5b..b5af1cc42`:
  - Logic: `TASK/code-logic-review-phase-b-rereview.md`, grok lane `a6f5ac65` (implementer codex), 7/10,
    **NEEDS_REVISION**. All 13 prior findings CLOSED (S1-S7, TL-1..TL-3 = M1-M3, M5, M6, M7). New from 8F: 0 B,
    1 S (pageExit during an in-flight confirm still launches), 2 M (projection dedup lets a persisted
    provisional id hide the live row; mixed root/run-keyed records: key order decides which body survives),
    2 Minor (`removeManifest` false ignored; Decline boolean ignored on duplicate receive and lanes-unavailable).
  - Style: `TASK/code-style-review.md` section `## Re-review (fix round 8F)`, in-process Anthropic, **APPROVED**.
    S1-S3 and Moderates 2-5 CLOSED; `prettier --check` clean on all 21 files; 3 Minor recorded (spread keeps
    `availability` on the pending entry; `childBySession` could be a `Set<string>`; residual `input<number>(2)` in
    `tribunal-panel/src/lib/wizard/step-run.component.ts:94`, not introduced by 8F).
  - Disposition: Decisions D26-D29. This is the ONE bounded correction (revise cap): Batch 8FG, then one
    independent review of the 8FG diff only. If that review finds defects, report them and stop; no further
    fix round in Phase B.

## Batch 8FG: Phase B bounded correction - page exit cancels an in-flight confirm; deterministic manifest migration - COMPLETE (commit 433aab5ad) - Phase B review APPROVED 9/10 (`TASK/code-logic-review-phase-b-8fg.md`; implementer codex, reviewer grok) - PHASE B CLOSED

- Recommended executor: CLI lane (implementation; Angular feature/data-access TypeScript, async state machine and
  test design)
- Execution mode: sequential (one lane; the two tasks are file-disjoint but small, and one scoped command covers both)
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer. Implementer codex (any family except grok); follow-up review of the
  8FG diff only by the grok lane (resume session `01a14044-266f-7ab0-9875-f29af51b78ea`).
- Rationale: the re-review Serious (paid launch after page exit) and the one Moderate the fix-round rule admits
  (persisted-record loss, D27). 4 files, 2 projects, well inside 40 tool calls.
- Tasks: 2 | Depends on: 8FE committed (`b5af1cc42`)
- Phase: B (bounded correction) | Phase review: one review of the 8FG commit only (logic, grok); no style review
  (no new public API: only the exported `PendingProposal` state union and `ConfirmFailureReason` gain a member)
- Scoped verification (team leader): `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-state @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  The header must name 2 projects.
- Files the lane may touch (4):
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts`
- Suggested commit: `fix(command-center,chat-state): batch 8FG - cancel confirm on page exit`
- Out of scope (D28, D29): the projection dedup Moderate (carried to Task 14.2), both logic Minors and all style
  Minors (recorded only). Do not change `receive`, `decline`, `timeout`, the lanes-unavailable branch, or the
  existing `removeManifest`-after-failed-send behaviour except where Task 8FG.1 says so.

### Task 8FG.1: Page exit cancels an in-flight confirm before any manifest write or launch send (re-review Serious) - COMPLETE

- File: `tribunal-run-coordinator.ts` and its spec.
- Finding: `pageExit()` (about `:111-117`) deletes an `answered` entry from `pending`, but the in-flight
  `confirmEntry` (about `:134-233`) keeps the object and, after `discoveryComplete()` or `createTask()` resolves, still
  calls `writeManifest` and `sendLaunchTurn`. A failed send then returns `retryable: true` for an id that is neither
  pending nor consumed, so the next `confirm` returns `not-launchable` and reports a second time.
- Quality requirements (Decision D26):
  - Add terminal state `'cancelled'` to `PendingProposal['state']`, reason `'cancelled'` to `ConfirmFailureReason`,
    and to `CONFIRM_FAILURE_MESSAGES`: `cancelled: 'Command Center closed before the run launched. Nothing was started.'`
  - `pageExit()`: an `open` entry that is not in flight is declined as today. Every `answered` entry, in flight or
    not, is cancelled: set `state = 'cancelled'`, delete it from `pending`, add its id to `consumed`. Send no turn
    and no Decline (the question is already closed by the fixed answer, D1). Do not touch `inFlight`.
  - `confirmEntry`: add one private helper, for example `isCancelled(id, entry): boolean` returning
    `this.pending.get(id) !== entry` (a method call, so TypeScript does not keep the `'answered'` narrowing across
    an `await`). Check it after EVERY `await` that precedes the manifest write: after `discoveryComplete()` (also
    when that await rejects) and after `createTask()` (also when it throws or returns null). On cancel, return
    one shared private path that: calls `transport.removeManifest(entry.workspace, entry.runId)` once if
    `entry.runId` is set (a manifest from an earlier attempt), inside a `try`/`catch` with a valid
    `// degradation-audit: reported — <reason>` marker as the first line of the catch body; then returns
    `this.failure('cancelled', false)`. It never calls `writeManifest` or `sendLaunchTurn`.
  - After the `sendLaunchTurn` await: if the send succeeded, the launch was already sent before the exit was
    seen; keep today's `terminate(id, entry, 'launched')` and `{ ok: true }` (`terminate` must still work when the
    id was already removed from `pending`). If the send returned false or threw AND the entry was cancelled, roll
    back the manifest (today's rollback) and return `this.failure('cancelled', false)` instead of
    `launch-send-failed`. Not cancelled: today's behaviour, unchanged.
  - Invariants kept: exactly one `reportFailure` per `ok: false` result; concurrent `confirm` calls still share one
    promise; `inFlight` is still cleared on settle; a cancelled id is consumed, so a later `confirm(id)` returns
    `not-launchable` (not retryable), which is consistent with the `retryable: false` the cancel returned.
  - The existing comment `/** Page-owned paid-spawn gate. ... */` stays; add one line to the `pageExit` doc or
    body saying an answered proposal is cancelled and an in-flight confirm stops before the manifest write.
- Specs (`tribunal-run-coordinator.spec.ts`, use a deferred promise for the awaited transport call):
  1. `pageExit()` while `discoveryComplete()` is pending, then resolve it: `writeManifest` and `sendLaunchTurn`
     are never called; the result is `{ ok: false, reason: 'cancelled', retryable: false }`; `reportFailure` is
     called exactly once with the `cancelled` message; no `Decline` is sent.
  2. Same with `discoveryComplete()` rejecting after `pageExit()`: reason `cancelled`, not `discovery-failed`.
  3. Relay: `pageExit()` while `createTask()` is pending: no manifest write, no send, `cancelled`.
  4. Retry then exit: attempt 1 fails at `sendLaunchTurn` (false, rollback called), attempt 2 is exited during
     `discoveryComplete()`: `removeManifest` is called with the same `runId`, `writeManifest` is not called again,
     `cancelled`.
  5. `pageExit()` while `sendLaunchTurn` is pending and it resolves false: `removeManifest(workspace, runId)` is
     called, the result is `cancelled` and not retryable, `reportFailure` once; a following `confirm(id)` returns
     `not-launchable`, `retryable: false`.
  6. `pageExit()` while `sendLaunchTurn` is pending and it resolves true: `{ ok: true }`; the id is consumed.
  7. All existing specs pass unchanged (retry after manifest-write failure, rollback after send failure,
     undelivered answer, duplicate id, lanes-unavailable, `pageExit` after `answered` sends no `Decline`).
- Validation notes: A1 still holds (no affirmative token, no launch from timeout or auto-resolve). The new catch is
  the only new catch site; `libs/frontend/command-center` is at degradation-audit baseline 0.

### Task 8FG.2: Deterministic migration when a run key and a root key hold the same run (re-review Moderate, D27) - COMPLETE

- File: `command-center-records.ts` and its spec.
- Finding: `read()` (about `:64-72`) writes `empty.runs[manifest.data.runId]` for each accepted stored key, so when
  `runs[<runId>]` and `runs[<rootTabId>]` both hold the same `runId`, the key enumerated last wins and the other body
  is lost on the next write.
- Quality requirements: when `empty.runs[runId]` is already set, decide by rule, not by key order: an entry stored
  under its own `runId` key always wins over one stored under a `rootTabId` key; between two root-keyed entries for
  one `runId`, keep the greater `startedAt` (ties keep the first). Track the winning entry's key kind locally (for
  example a `Map<string, boolean>` of "stored under runId"); do not change the persisted shape, the schema, the
  storage key or any public method. Keep the 8F0.2 marker in the `write()` catch exactly as it is. No new catch.
- Specs (`command-center-records.spec.ts`): a record with `runs[runId]` (newer body) and `runs[rootTabId]` (older
  body, same `runId`) reads back the run-keyed body in BOTH insertion orders, and the next write persists only that
  body under `runId`; two root-keyed entries with one `runId` keep the greater `startedAt`; all existing migration,
  corrupt-entry and isolation specs pass unchanged.

### Batch 8FG verification

- Every listed artifact exists; the scoped command passes with 2 projects in the header.
- Team leader reads the `confirmEntry` cancel checks, the new catch against `check-degradation.ts`, and the
  `read()` precedence rule on disk.
- After commit: NEEDS REVIEW of the 8FG commit only (grok, resume session `01a14044-266f-7ab0-9875-f29af51b78ea`).
  APPROVED closes Phase B. Any defect is reported and Phase B stops there (no further fix round).
- Result (team-leader, Mode 2): executor codex lane `c2787791`; report `TASK/reports/batch-8FG-report.md`. Exactly
  the 4 listed files changed. On disk, `tribunal-run-coordinator.ts`: `'cancelled'` added to the state union,
  `ConfirmFailureReason` and `CONFIRM_FAILURE_MESSAGES` (the specified text); `pageExit` sets an `answered` entry to
  `'cancelled'`, deletes it from `pending` and consumes it (no turn, no Decline); `isCancelled(id, entry)` is
  `pending.get(id) !== entry` and is checked after `discoveryComplete()` (resolve and reject) and after
  `createTask()` (resolve, null and throw), all before `writeManifest`; nothing awaits between `writeManifest` and
  `sendLaunchTurn`; `cancel(entry)` removes an earlier attempt's manifest when `runId` is set, then
  `failure('cancelled', false)`; a failed or thrown send on a cancelled entry rolls back and returns `cancelled`
  (not retryable); a send that succeeds stays `launched`. `command-center-records.ts` `read()`: a local `runKeyed`
  map; a run-keyed entry replaces a root-keyed one in either order and is never replaced by one; between root-keyed
  entries only a strictly greater `startedAt` replaces (a tie keeps the first). The 8F0.2 marker is intact (`:94`).
  Specs: 6 new coordinator cases with deferred promises (`:279-394`), 2 new records cases (`:92-144`); no focused or
  skipped specs.
- Catch classification (`check-degradation.ts`): one new site, `cancel()`'s catch, whose body is only a valid
  `reported` marker. It is not "truly empty" and returns no literal, so it is not flagged, and the marker is used.
  The discovery and createTask catches keep their marker as the first body line; the added lines return method
  calls, not literals. One direct audit run, exit 0: no `libs/frontend/command-center` line (0 sites, baseline 0),
  `chat-state 2 ok (baseline 2)`, no orphaned or malformed marker.
- Scoped check (orchestrator, foreground): `nx run-many -t test typecheck lint -p @ptah-extension/chat-state
  @ptah-extension/command-center`, header 2 projects, all 6 tasks green.
- Commit: `433aab5ad` `fix(command-center,chat-state): batch 8FG - cancel confirm on page exit` (hooks and the
  degradation audit passed).
- Review (D30): grok, range `ea106f685..433aab5ad`, `TASK/code-logic-review-phase-b-8fg.md`. Verdict APPROVED,
  9/10; 0 new Blocking, Serious, Moderate or Minor. RR-S1 CLOSED (`tribunal-run-coordinator.ts:119-123`; every
  `isCancelled` check runs before `writeManifest` at `:216`). RR-M2 CLOSED (`command-center-records.ts:64-82`,
  `runKeyed` precedence in both orders; greater `startedAt` between root keys). D18 and Amendment A1: no
  regression. Top risk is the D29 Minor (`removeManifest` false ignored), already recorded; not a new defect.
- Status: COMPLETE. Phase B CLOSED. The generated diffs (`TASK/reports/phase-b.diff`, `phase-b-8f.diff`,
  `phase-b-8fg.diff`) were deleted uncommitted (D23).

## Batch 9: Voice primitives (adapted from property-hub) - COMPLETE (commit b65372ba1)

- Recommended executor: CLI lane (implementation; TypeScript, Web Audio)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: pure, well-specified units ported per A1 item 5.
- Tasks: 4 | Depends on: B5 (B0 gate removed by D32)
- Phase: C - Voice | Phase review: code-logic (after B10)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 9 - vad, chunker, playback queue, spoken text`

### Task 9.1: VAD - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.spec.ts` (new)
- Plan reference: implementation-plan.md:36, :75; A1 item 5
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/vad.ts`
- Quality requirements: energy-based onset/offset with hangover, minimum utterance length, noise floor; a playback
  mode that requires sustained onset (used by Task 10.2 for echo gating). Pure, frame-driven, no timers.
- Validation notes: silence and noise produce no utterance.
- Implementation details: adapt to Ptah lint rules; new spec (source has none).

### Task 9.2: Sentence chunker - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.spec.ts` (new)
- Plan reference: implementation-plan.md:36, :38; A1 item 5
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/sentence-chunker.ts` and its spec
- Quality requirements: incremental streaming chunks at sentence boundaries with a bounded maximum chunk length.
- Validation notes: abbreviations and decimals do not split.
- Implementation details: port and adapt the spec.

### Task 9.3: TTS playback queue - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.spec.ts` (new)
- Plan reference: implementation-plan.md:38; A1 item 5; risk R15
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/tts-playback-queue.ts` and its spec
- Quality requirements: ordered playback, at most two synth requests in flight, generation IDs that revoke stale clips
  on barge-in/stop/mute/navigation, object URL revocation, playback failure reported (full text stays).
- Validation notes: superseded audio never plays.
- Implementation details: inject the synth function (`voice:synthesize` wrapper) for testability.

### Task 9.4: Spoken-text boundary filter - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/spoken-text.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/spoken-text.spec.ts` (new)
- Plan reference: implementation-plan.md:38; task-description AC24; risk R6
- Pattern to follow: pure helpers in `libs/frontend/chat/src/lib/services/voice-input.service.ts` style
- Quality requirements: keep only assistant conversational text; strip code fences, diffs, tool calls/results, raw
  links and secret-shaped strings; reply cap 600 characters or four sentences, status cap 180, append a short
  "See text for the rest" cue when truncated.
- Validation notes: code-heavy reply test; secret-shaped token test.
- Implementation details: pure function.

### Batch 9 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.
- Result: implementer codex lane (`reports/batch-9-report.md`). Orchestrator review found 3 defects, fixed by
  the same lane: false playback failure after barge-in and double reports (`tts-playback-queue.ts` guarded
  `fail()`), bullet lists stripped as diff lines (`spoken-text.ts` `stripUnifiedDiff`), and a short onset with no
  closing transition (`vad.ts` `'discard'`). The orchestrator updated one stale spec input (a bare `+const` line
  now sits under a hunk header) and added the `public` modifiers that lint warned about. Scoped command (run
  together with B11): "Successfully ran targets test, typecheck, lint for 2 projects", 680 + 82 tests, 0 lint
  problems in the new files; command-center re-run green after the lint fix. Commit `b65372ba1` passed the hooks.

## Batch 10: PCM capture, voice loop and status narrator - COMPLETE (commit cd3a5c6e9)

- Recommended executor: CLI lane (implementation; TypeScript, Web Audio, Angular services)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: integrates the primitives with the coordinator; 6 files.
- Tasks: 3 | Depends on: B6, B8, B9
- Phase: C (last batch) | Phase review: code-logic on the combined diff B9-B10
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 10 - hands-free voice loop and narration`

### Task 10.1: PCM capture with pre-roll and WAV encoding - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/pcm-capture.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/pcm-capture.spec.ts` (new)
- Plan reference: implementation-plan.md:36, :92; assumption 6
- Pattern to follow: `getUserMedia` seam in `libs/frontend/chat/src/lib/services/voice-input.service.ts:19-80`
- Quality requirements: one stream with `echoCancellation`, `noiseSuppression`, `autoGainControl`; one AudioWorklet
  (Blob-URL module) PCM ring buffer with short pre-roll; encode each utterance to `audio/wav` base64; reject empty
  clips; cap payload below 25 MB; release tracks, context, worklet and URLs on stop. If `addModule` or
  `getUserMedia` fails, report a typed reason (denied/unavailable/worklet) for the text fallback.
- Validation notes: AC5, AC7; no MediaRecorder onset start (loses pre-roll).
- Implementation details: injectable factories for `AudioContext`/`getUserMedia` for tests.

### Task 10.2: CommandVoiceLoop - COMPLETE

- Depends on: Task 10.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/command-voice-loop.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts` (new)
- Plan reference: implementation-plan.md:36-40; task-description AC3-AC9, AC23; risk R12
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/voice-session.service.ts` (behaviour only)
- Quality requirements: provider readiness from the main voice config RPC (no key ever in renderer); VAD close ->
  `voice:transcribe` with explicit timeout -> nonempty transcript answers a pending ordinary question (never a Tribunal
  confirm) or starts one serialized turn via the coordinator; assistant text -> spoken-text filter -> chunker ->
  playback queue; during playback require sustained onset plus echo correlation; real barge-in stops audio at once
  and queues exactly one utterance until the turn and its tool call finish; `chat:abort` only from explicit Stop;
  speak one short summary for a valid roster proposal; transcription failure creates no turn; synth/playback failure
  keeps text and allows retry; mute stops capture without ending the session; stop releases everything; exit releases
  tracks, context, worker, URLs, timers and listeners.
- Validation notes: record cold-worker and post-barge-in latency marks for B18. Push the final meter zero on
  stop, mute and idle through `CommandCenterStore.resetLevels()` (added in 8FD.3; `updateLevels` throttles to
  500 ms and drops a trailing zero, logic review M5).
- Implementation details: state flows into `CommandCenterStore` voice state.

### Task 10.3: Status narrator - COMPLETE

- Depends on: Task 10.2
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/status-narrator.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts` (new)
- Plan reference: implementation-plan.md:32; task-description AC12, AC22; risks R6, R15
- Pattern to follow: Task 9.3 generation revocation
- Quality requirements: derive updates from projection diffs for owned lanes/children start/complete/fail and
  meaningful Tribunal phases; dedupe by `{root, workId, stateOrPhase}`; deliver only at turn boundaries; revoke stale
  states; no synthetic user turn; 180-character cap via spoken-text; pending prompts get a short spoken summary while
  the card stays actionable if speech fails.
- Validation notes: unrelated events never narrated.
- Implementation details: pure queue plus a thin integration with the loop.

### Batch 10 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- Phase C's last batch: after commit return NEEDS REVIEW (code-logic, combined diff B9-B10).
- Result: implementer codex lane (`reports/batch-10-report.md`). Orchestrator review found 3 defects, fixed by
  the same lane: barge-in impossible by default (`isIndependentSpeech` now defaults to browser echo cancellation
  plus the sustained playback-mode onset), latency marks that timed only the synth RPC (now end of utterance to
  first play start, labelled cold-worker, post-barge-in or warm), and a voice route that could answer a Tribunal
  roster question (now a pending-roster gate with `onRosterResolved`, Amendment A1). The orchestrator removed
  three unused catch bindings that lint rejected. Scoped command: "Successfully ran targets test, typecheck, lint
  for project @ptah-extension/command-center", 102 tests; degradation audit exit 0. Commit `cd3a5c6e9` passed the
  hooks. Page wiring of the loop is carried to Task 14.2 (D35).

## Batch 11: Provider brand-art entry, scene layout and sprite cache - COMPLETE (commit 4b7455a36)

- Recommended executor: CLI lane (implementation; TypeScript, Canvas 2D)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: pure geometry and cached drawing plus a narrow UI entry; 7 files in 2 projects.
- Tasks: 3 | Depends on: B8 (B0 gate removed by D32)
- Phase: D - Scene, page, route, nav | Phase review: code-logic + style (after B16)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/ui @ptah-extension/command-center --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `feat(ui,command-center): batch 11 - brand-art entry and scene layout`

### Task 11.1: Narrow provider-brand-art entry and barrel guard - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/ui/src/provider-brand-art.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/ui/src/lib/native/brand-mark/brand-mark-barrels.spec.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/tsconfig.base.json`
- Plan reference: implementation-plan.md:23, :48, :76, :93; design-spec-review R3-1, R3-9; Decision D6
- Pattern to follow: `libs/frontend/ui/src/brand-mark.ts`; guard cases at `brand-mark-barrels.spec.ts:41-88`
- Quality requirements: export only `PROVIDER_BRAND_ART` (from `provider-brand-art.vendored.ts`) and its type; spec
  pins its `valueExports` and `specifiers`; `brand-mark/index.ts` and umbrella barrels unchanged; alias
  `@ptah-extension/ui/provider-brand-art`. No new key in `PROVIDER_BRAND_SLUGS` (no `glm` alias).
- Validation notes: existing barrel tests stay green.
- Implementation details: mirror the brand-mark entry test.

### Task 11.2: Scene layout - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/scene-layout.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts` (new)
- Plan reference: implementation-plan.md:46; design-spec.md:38-47 (scene grammar); design-spec-review R3-8, R3-10, R3-13
- Pattern to follow: orbital layout and collision code in `TASK/prototype/command-center.html`
- Quality requirements: orbital positions for root, delegates, Tribunal group and satellites; 24-node cap with
  overflow completed nodes collapsed to a count chip; label placement clearing halos by at least 12 px; label sizes
  measured once per layout (not per frame); child-session chip text shows the parent provider name with the session
  name; at N>12 plate visibility rule per design spec.
- Validation notes: deterministic for a given projection and size.
- Implementation details: pure functions over projection + viewport.

### Task 11.3: Sprite cache - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/sprite-cache.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/sprite-cache.spec.ts` (new)
- Plan reference: implementation-plan.md:46, :48; design-spec.md:58-63; design-spec-review R3-2, R3-3, R3-4, R3-11, R3-13
- Pattern to follow: sphere cache in `TASK/prototype/command-center.html`
- Quality requirements: detached-canvas sprites keyed by theme/palette/size/brand slug/monogram, keys cached per node
  (no per-frame join); `Path2D` parsed only on miss; marks use the vendor lit/rim colour (one rule for plate, chip,
  rail); Tribunal core uses the Lucide shield path (no "T"); satellites at least 32 px; chip marks at least 12 px;
  unknown provider -> two-letter monogram; DPR capped at 2; rebuild on theme change only.
- Validation notes: no `shadowBlur`, gradient creation or `getComputedStyle` in hot paths.
- Implementation details: resolve provider art through `@ptah-extension/ui/provider-brand-art` + `PROVIDER_BRAND_SLUGS`.

### Batch 11 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes (2 projects); output tailed.
- No per-batch review.
- Result: implementer codex lane (`reports/batch-11-report.md`). Orchestrator review found 3 defects, fixed by
  the same lane: lanes and phases placed on the global rings (now lanes orbit their Tribunal core and phase nodes
  are exposed as the core's `phases` for the B12 arc, design-spec.md:40,46), hidden non-completed nodes and
  orphaned children past the cap (now `overflowOther`, a `+M more` chip text, and ancestors kept with each shown
  node), and an unbounded sprite cache (now `SpriteCache.prune`). Carry-over D33 (child session name and parent
  provider) moves to Task 14.2. Scoped command: "Successfully ran targets test, typecheck, lint for 2 projects".
  Commit `4b7455a36` passed the hooks.

## Batch 12: Scene renderer and scene component - COMPLETE (commit 64c69a8ca)

- Recommended executor: CLI lane (implementation; Angular, Canvas 2D performance)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: frame loop and its Angular host; 4 files.
- Tasks: 2 | Depends on: B11
- Phase: D | Phase review: after B16
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 12 - canvas scene renderer`

### Task 12.1: CommandSceneRenderer - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts` (new)
- Plan reference: implementation-plan.md:46; design-spec.md:56-63; risk R13
- Pattern to follow: draw loop in `TASK/prototype/command-center.html`
- Quality requirements: draws outside NgZone from immutable snapshots; `drawImage`, status rings, Bezier links,
  bounded particles (16) and dots (48); render-on-demand idle; visibility pause; no signal writes per frame; overlay
  label transforms written directly in rAF from cached sizes; dev meter at most 2 Hz.
- Validation notes: separate voice ring and selection halo.
- Implementation details: spec with a mocked 2D context counting calls.

### Task 12.2: CommandSceneComponent - COMPLETE

- Depends on: Task 12.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts` (new)
- Plan reference: implementation-plan.md:46; design-spec.md:52-56
- Pattern to follow: `afterNextRender`, `DestroyRef`, `viewChild` usage in existing standalone components
- Quality requirements: standalone OnPush; one `ResizeObserver`; visibility and reduced-motion listeners; theme
  `effect()` rebuilds sprites; Canvas 2D unavailable -> emits a flag so the page shows the list only; teardown
  releases rAF, observer, listeners and caches.
- Validation notes: no timer or observer per node.
- Implementation details: inputs: projection snapshot, selected ID, theme; output: selection.
- Added by D31 (minimal; nothing else in Batch 12 changes): output `hoveredNodeId` (`string | null`) from the
  canvas pointer hit test against the renderer's last projected spheres. Coalesce `pointermove` to at most one
  hit test per animation frame, run outside Angular, and emit only when the ID changes; emit `null` on
  `pointerleave` and teardown. Spec: two moves over the same sphere emit once; moving off emits `null`; no
  emission per frame.

### Batch 12 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.
- Result: implementer codex lane (`reports/batch-12-report.md`). Orchestrator review found 2 defects, fixed by
  the same lane: every voice-level update re-ran the layout and sprite requests (now a layout effect and a
  separate voice effect that calls `setVoice`), and label and anchor styles were written on every frame (now
  written only on change). The renderer also positions the Task 14.1 card anchor (`setCardAnchor`, assumption
  A-D31 holds). The orchestrator corrected one spec assertion that expected a `hoveredNodeId` null emission with
  no prior hover (the output emits only on change). Scoped command: "Successfully ran targets test, typecheck,
  lint for project @ptah-extension/command-center", 102 tests. Commit `64c69a8ca` passed the hooks.

## Batch 13: Presentational components (pending card, work list, HUD, session controls) - COMPLETE (commit fd493f2c9)

- Recommended executor: CLI lane (implementation; Angular UI)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: standalone input/output components; the card carries the click/key-only confirm rule.
- Tasks: 4 | Depends on: B8, B10
- Phase: D | Phase review: after B16
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 13 - pending card, work list, hud, controls`

### Task 13.1: CommandPendingInputComponent - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts` (new)
- Plan reference: implementation-plan.md:22, :31, :77; A1 items 1-4; task-description AC22; risk R4
- Pattern to follow: pending/question frames in `TASK/prototype/command-center.html`; design-spec.md:48-51
- Quality requirements: ordinary question/permission card with full prompt and choices (explicit click/key; spoken
  answers only for ordinary questions, never permissions); Tribunal confirm card shows lanes, mode, rounds; Confirm
  only from click or focused key activation; an invalid (non-Decline-first) proposal renders as invalid; emits to the
  coordinator, which answers with the marked tab ID.
- Validation notes: spec covers click and key confirm, spoken "yes" ignored, Decline, timeout, duplicate click.
- Implementation details: 44 px targets, focus rings, accessible text state.

### Task 13.2: CommandWorkListComponent - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts` (new)
- Plan reference: implementation-plan.md:46; task-description AC14, AC17, AC18
- Pattern to follow: rail list in prototype
- Quality requirements: every owned item (not capped) with node, provider, parent and state in text; keyboard
  selection; state changes announced via a live region, not colour alone; provider mark via `ProviderMarkComponent`,
  unknown -> `MonogramTileComponent`.
- Validation notes: list stays complete when the scene caps at 24.
- Implementation details: input projection, output selection.

### Task 13.3: CommandVoiceHudComponent - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts` (new)
- Plan reference: implementation-plan.md:40, :46; task-description AC3, AC4, AC7, AC8, AC9
- Pattern to follow: HUD frames in prototype (listening/thinking/speaking/muted/mic denied/missing provider/errors)
- Quality requirements: start/stop/mute/interrupt controls; Stop never disabled while a turn can be aborted; mic
  denied and missing provider states link to existing voice settings; safe error text only; never a key.
- Validation notes: covered by page spec (Task 14.2) and integration specs (B17).
- Implementation details: input voice state, outputs control intents.

### Task 13.4: CommandSessionControlsComponent - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-session-controls.component.ts` (new)
- Plan reference: implementation-plan.md:5, :46; task-description AC16, AC17, AC25
- Pattern to follow: header controls in prototype
- Quality requirements: text command input (compact reply view), Resume latest session offer, New Command Center,
  status on demand; copy discloses the explicit Tribunal move-word rule (plan Deferred paragraph 3).
- Validation notes: covered by page spec and B17.
- Implementation details: input session state, outputs intents.

### Batch 13 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.
- Result (2026-10-15, orchestrator): codex lane delivered the 6 files; orchestrator review found 5 defects
  (D36), fixed by a codex lane (`reports/batch-13-fix-report.md`). Scoped run before the fix: test 112/112,
  typecheck pass, lint 2 errors; after the fix: `npx eslint` on the 6 files clean, the 2 B13 specs 14/14,
  pre-commit `nx affected --target=lint` pass. A1 rules checked on disk: Confirm only from click or focused
  Enter/Space, once per proposal; invalid proposal shows no Confirm; spoken input has no confirm path; the work
  list is uncapped with one polite live region.

## Batch 14: Overlay and page component - COMPLETE (commits 5b02f44a8, 4d7cd2f92, 6606037c1, 0d2b4d91a)

- Recommended executor: CLI lane (implementation; Angular UI)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: composes everything; exposes the lazy entry used by the route in B15. 7 files in one project after
  D28 and D31 (one over the 6-file rule; see D31).
- Tasks: 2 | Depends on: B12, B13
- Phase: D | Phase review: after B16
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 14 - command center page`

### Task 14.1: CommandOverlayComponent - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts` (new, D31)
- Plan reference: implementation-plan.md:46; design-spec.md:42-45, :52-56; D31;
  `TASK/research-canvas-zoom-pan.md` "Flicker root cause" and "Popover options"
- Pattern to follow: DOM label layer in prototype (NOT its tooltip: `prototype/command-center.html:81` opens and
  closes the tooltip instantly on label `mouseenter`/`mouseleave`, which is the flicker D31 fixes);
  `FloatingUIService` (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:125-163`, exported from
  `@ptah-extension/ui`, `@Injectable()` without `providedIn`, so list it in the component's `providers`)
- Quality requirements: label plates positioned by the renderer's direct transforms; repeating CSS motion
  uses only transform/opacity; theme-aware chips.
- Node card (D31; replaces the per-label instant tooltip). Each rule is tagged [user-requested] or [lane-proposed]:
  - ONE shared node card for the whole overlay, keyed by stable node ID, never one card or one positioning
    service per node [user-requested]. It shows the same content as the work list row (node, provider mark,
    parent, state in text) [user-requested].
  - Hover intent: open after an open delay and close after a close delay [user-requested]. Values: open 150 ms,
    close 200 ms, inside the research ranges 120-180 ms and 180-250 ms [lane-proposed]. Keep both as named
    exported constants in the overlay file so they can be tuned in Electron at the B18 gate [lane-proposed].
    At most one open timer and one close timer exist at a time (design rule "no timer per node").
  - Cancel a pending close when the pointer enters the card or returns to the trigger [user-requested].
  - Safe area: the trigger-to-card path does not close the card [user-requested]. Method: an invisible
    `pointer-events:auto` bridge element between the anchor rect and the card rect, rebuilt on each reposition,
    plus the close delay as the grace period; no pointer-trajectory triangle math [lane-proposed].
  - Do not close only because the label moved, compacted or hid while the canvas hit test still reports the
    same node [user-requested]. Hover state is the union of three sources: label trigger hover, card hover and
    the scene's `hoveredNodeId` input (Task 12.2 output). A close is scheduled only when all three have left
    that node ID; a label `pointerleave` caused by a renderer move or hide does not close the card while
    `hoveredNodeId` still equals the card's node ID.
  - Anchor: the node's label plate while it is visible; when the label is hidden, anchor to the node's sphere
    [user-requested]. `FloatingUIService.position()` takes an `HTMLElement` reference, so the overlay exposes
    one zero-size `aria-hidden` card-anchor element with its other element refs, and the scene writes its
    transform to the open card's sphere centre in the same rAF write as the labels [lane-proposed].
    ASSUMPTION A-D31: Task 12.1's existing direct overlay-transform write can position this one extra element
    without changing Task 12.1. The B14 executor checks the committed B12 code; if it cannot, the executor
    reports it and the team-leader adds a bounded fix task. The executor does not edit B12 files.
  - Pin: click or Enter on a label or node trigger pins the card until explicit close (card close button),
    Escape, a selection change or scene teardown [user-requested]. Hover leave does not close a pinned card.
    A second pin on another node replaces the pinned node ID (still one card).
  - Focus [user-requested]: pinning does not move focus; the trigger keeps focus and the card's close button is
    the next Tab stop. Escape or close returns focus to the trigger when focus was in the card; if that label is
    hidden, focus goes to the matching work-list row (page wiring, Task 14.2). The passive hover card never
    takes focus and is `role="tooltip"` linked by `aria-describedby`; the pinned card is a non-modal region
    with an accessible name and the trigger carries `aria-expanded`.
  - Position with `FloatingUIService` (`offset`, `flip`, `shift`); no backdrop for the passive hover card
    [user-requested]. Reposition only the open card, at most once per animation frame, and only when its anchor
    moved: coalesce through one rAF flag; call `cleanup()` on close and on destroy [user-requested].
    The service's `autoUpdate` does not see transform-only label moves, so the rAF coalescer is required
    [lane-proposed].
  - `prefers-reduced-motion` (store `reducedMotion`): no card enter, exit or move animation [user-requested].
- Validation notes: no per-frame Angular change detection; card state changes enter Angular only on semantic
  events (open, close, pin, unpin), never per pointermove or per frame.
- Spec cases (`command-overlay.component.spec.ts`, Jest fake timers, `FloatingUIService` stubbed or spied):
  - dense-label hover stability: with `hoveredNodeId` unchanged, a label that moves (transform change) or hides
    (`display:none` plus a synthetic `pointerleave`) under a still pointer does not toggle the card; no
    close fires after the close delay elapses;
  - open delay: no card before 150 ms, card at 150 ms; a leave before 150 ms cancels the open;
  - close delay: card stays until 200 ms after leave; entering the card or re-entering the trigger within
    200 ms cancels the close; crossing the bridge keeps it open;
  - pin and unpin: click pins and survives hover leave; Enter pins; Escape unpins and restores focus to the
    trigger; the close button unpins; a selection change input unpins; destroy calls `cleanup()`;
  - edge flip: a trigger near the right or bottom edge is positioned through the service with `offset`, `flip`
    and `shift` enabled (assert the options passed); two anchor moves in one frame cause one reposition call;
  - one card: hovering a second node while the first card is open re-keys the same card element;
  - reduced motion: no animation class or transition on the card.
- Implementation details: exposes element refs to the scene (labels plus the one card anchor); inputs: projection
  nodes, `hoveredNodeId`, `selectedId`, `reducedMotion`; outputs: pin and unpin with node ID.

### Task 14.2: CommandCenterPageComponent and lazy export - COMPLETE

- Depends on: Task 14.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-center-page.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/index.ts`
- Plan reference: implementation-plan.md:40, :46, :48; design-spec.md:5-12 (72 px header, 336 px rail, stack below 720 px)
- Pattern to follow: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts` lifecycle
- Quality requirements: owns lifecycle (coordinator open/resume, voice loop start/stop, teardown on navigation keeps
  the session); renders scene, overlay, HUD, pending card, work list, controls and compact text replies; list-only
  mode when Canvas 2D is unavailable; mic denied/provider missing keep text and graph usable.
- Validation notes: navigation away releases mic/playback and keeps identity (AC16). Read the Task 6A.2
  records-write-failure signal and show a safe notice that the session pointer was not saved.
  Read it as `inject(TabManagerService).commandCenterRecordWriteFailure()` with the inferred type, so
  no `chat-state` barrel change is needed. `CommandCenterRecordWriteFailure` is not exported from the
  chat-state barrel; if the page must name the type, add
  `type CommandCenterRecordWriteFailure` to `libs/frontend/chat-state/src/index.ts` (tab-manager export
  block, lines 11-20) and use a 2-project scoped command
  (`-p @ptah-extension/command-center @ptah-extension/chat-state`, header must name 2 projects).
- Implementation details: export `CommandCenterPageComponent` from `src/index.ts`.
- Node card wiring (D31), owned here because the page composes scene and overlay: bind the scene's
  `hoveredNodeId` output to the overlay input; pass `selectedId` so a selection change unpins the card; when an
  unpin returns focus and the node's label is hidden, focus the matching work-list row. Page spec cases: a
  scene `hoveredNodeId` emission reaches the overlay input; a work-list selection change unpins a pinned card;
  leaving the page tears the card down (no card, no pending timer).
- Carried from the Phase B reviews (Decision D20), owned here:
  - (style Moderate 1) Replace `export *` in `src/index.ts` with named exports: only `CommandCenterPageComponent`,
    plus a one-line comment that the model classes are page-internal.
  - (logic M4 / style Moderate 6) Give `buildStatusContext` a real `agesMs` producer: node timestamps from the
    projection inputs, wired by the page. Otherwise drop the parameter and the `setStatusContextProvider` seam
    (`session-coordinator.ts:28,34`) if the page needs no second provider.
  - Wire the 8FC transport additions (`availability()`, `removeManifest`, `reportFailure` -> store toast) and
    pass a required `ProposalAvailability` to `receive`.
- Carried from the Phase B re-review (Decision D28), owned here: the page builds the projection inputs, so it owns
  the dedup Moderate. Either pass `persistedChildren` keyed by canonical SDK session ids only, or (preferred) fix
  `projectOwnedWork` itself: key the persisted filter and the node dedup by `canonical(sessionId)`, and when two
  candidates share a node id keep the live state over `'unknown'`. This adds
  `libs/frontend/command-center/src/lib/model/work-projection.ts` and its spec to this task's files. Spec: live
  child `{ tabId: 'temporary', sessionId: 'child-sdk' }` plus persisted `{ sessionId: 'temporary' }` gives one
  `child:child-sdk` node in the live state. Also apply the recorded style Minor there (`childBySession` as a
  `Set<string>` built with `flatMap`).
- Carried from the B11 review (Decision D33), owned here because this task already owns `work-projection.ts`:
  child nodes show `Session · Child session` because `projectOwnedWork` gives every child `label: 'Child session'`
  and `providerId: null`, and the root has no provider id. Add optional `name` and `providerId` to `OwnedChild`
  and an optional `rootProviderId` to `ProjectionInput`; emit the child's session name as its label (fallback
  `'Child session'`) and the provider ids on the nodes; the page fills them from the tab and session data it
  already reads. `layoutScene` already prefixes a child label with its parent's provider name, so the scene then
  shows `Codex · Builder` (design-spec.md:40, design-spec-review R3-10). Spec: a named child of a Codex parent
  gives the label `Codex · Builder` through `layoutScene`; an unnamed child keeps the fallback.
- Voice loop wiring (D35), owned here because the page owns the voice lifecycle. `CommandVoiceLoop`
  (`voice/command-voice-loop.ts`, B10) is page-owned: construct it with the store, the session coordinator and
  `ClaudeRpcService`; call `start`/`mute`/`stop` from the session controls and `exit` on page teardown; call
  `onTurnBoundary(assistantText)` only after the assistant stream and its tool calls settle; call
  `onProjection(rootId)` on owned projection changes; call `onPendingPrompt(summary)` for a pending ordinary
  question; call `onRosterProposal(summary, valid)` when the roster card opens and `onRosterResolved()` on confirm,
  decline, timeout or page exit; pass `answerOrdinaryQuestion` that answers only a non-roster question with its
  full prompt and question key; offer `retrySpeech()` after a playback-failure toast. Page spec cases: the controls
  drive start, mute and stop; a turn boundary reaches the loop once; the roster open and resolve calls reach the
  loop; teardown calls `exit` and leaves no capture or timer. `getLatencyMarks()` feeds the B18 latency table.
- Scene wiring (D35): call `CommandSceneComponent.setOverlayLabels(...)` with the overlay's measured label
  elements and `setCardAnchor(element, nodeId)` for the Task 14.1 card anchor (`reports/batch-12-report.md`).

### Batch 14 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.
- Result (2026-10-15, orchestrator): six codex lanes (D36, D38, D39; reports `batch-14-1`, `14-2a` to `14-2f`). Orchestrator fixes found by
  the scoped runs: overlay typecheck (Event narrowing), a rAF spec and an emit after destroy (14.1 correction); a `workspaceRoot` narrowing
  error in the Tribunal transport (fixed by the orchestrator); the transport rewrote the D1 answer text (14.2f forwards it, never "Confirm").
  Final scoped run `-p @ptah-extension/command-center @ptah-extension/chat-state @ptah-extension/tribunal-panel` (3 projects): tests 597 + 345 +
  154 pass, typecheck pass, lint 0 errors (warnings only in files this task did not change). Known limit: a Tribunal move word on a new tab
  without an SDK root session id is refused with a safe toast until the first turn settles (`reports/batch-14-2c-report.md`).

## Batch 15: Surface id and Electron-only route - COMPLETE (commit eb3b280c4)

- Recommended executor: CLI lane (implementation; Angular routing + shared types)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: id, route and routing spec must land together (R2, precedent `45e549bd8`).
- Tasks: 2 | Depends on: B14
- Phase: D | Phase review: after B16
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/shared ptah-extension-webview --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `feat(shared,webview): batch 15 - command-center surface id and route`

### Task 15.1: command-center surface id - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/webview-surface.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/webview-surface.types.spec.ts`
- Plan reference: implementation-plan.md:23, :78; Decision D3; assumption 5
- Pattern to follow: the `'apps'` entry (`webview-surface.types.ts:43-74`)
- Quality requirements: add `'command-center'` to `ViewType` and `SURFACE_ROUTE_IDS` (after `'apps'`); doc comment
  says Electron-only via route guard.
- Validation notes: grep specs pinning the list (`grep -rn "'apps'" apps libs --include=*.spec.ts`); update only those
  in the two batch projects; report any outside them instead of editing.
- Implementation details: type + list + spec line.

### Task 15.2: Electron-only lazy route - COMPLETE

- Depends on: Task 15.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/apps/ptah-extension-webview/src/app/app.routes.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
- Plan reference: implementation-plan.md:23, :77; task-description AC1
- Pattern to follow: `apps` route (`app.routes.ts:180-189`) with `canMatch: [electronOnlySurface]` and `SURFACE_ACTIVE`
- Quality requirements: lazy `import('@ptah-extension/command-center')`; VS Code refuses the match before loading;
  routing spec covers Electron match, VS Code fallback to chat, and lazy chunk not requested on VS Code.
- Validation notes: no VS Code active page.
- Implementation details: mirror the apps tests in `webview-routing.spec.ts`.

### Batch 15 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes (2 projects); output tailed.
- No per-batch review.
- Result (2026-10-15, orchestrator): first scoped run failed 5 tests (4 routing cases on the gridstack ESM import through the main
  tribunal-panel barrel, 1 design-lint case on `text-base-content/70`), fixed by D39. Final run (2 projects): shared 113 suites / 3597 tests,
  webview 18 suites / 481 tests pass; typecheck pass; lint 0 errors.

## Batch 16: Electron nav, regular-chat lock banner and rewind persona - COMPLETE (commit 45fb50746)

- Recommended executor: CLI lane (implementation; Angular UI)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: regular-chat UI touches that need the surface id; 8 files in 2 projects.
- Tasks: 3 | Depends on: B4, B15
- Phase: D (last batch) | Phase review: code-logic + style on the combined diff B11-B16; visual review with B18 evidence
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat @ptah-extension/core --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `feat(chat,core): batch 16 - command center nav, lock banner, rewind persona`

### Task 16.1: Electron navigation entry - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/electron-shell.command-center-tab.spec.ts` (new)
- Plan reference: implementation-plan.md:23, :78; task-description AC1, AC18
- Pattern to follow: Apps tab (`electron-shell.component.ts:150-151,516`); spec `electron-shell.apps-tab.spec.ts`
- Quality requirements: keyboard-reachable nav entry, `aria-selected`, `setCurrentView('command-center')`; Electron shell only.
- Validation notes: no VS Code nav change.
- Implementation details: mirror the Apps tab.

### Task 16.2: Regular-chat lock banner and Open Command Center link - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts` (new)
- Plan reference: implementation-plan.md:5, :29, :71; task-description AC25
- Pattern to follow: read-only banner for `attachedBinding` (`chat-types.ts` `TabState.attachedBinding` doc)
- Quality requirements: while `isHeld(activeTab)` the composer shows that Command Center voice owns this session,
  holds sends, keeps Stop and pending answers enabled, and links to Command Center; unlocked tabs unchanged.
- Validation notes: queued content stays visible and sendable after unlock.
- Implementation details: signal from `CommandCenterSendLockService`.

### Task 16.3: Persona on rewind activation - COMPLETE

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/core/src/lib/services/claude-rpc.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/core/src/lib/services/claude-rpc.rewind-persona.spec.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/chat-view.rewind-persona.spec.ts` (new)
- Plan reference: implementation-plan.md:14, :27, :87; risk R1
- Pattern to follow: `ClaudeRpcService.rewindFiles` (`claude-rpc.service.ts:351-360`); callers `chat-view.component.ts:1677,1757`
- Quality requirements: `rewindFiles` accepts an optional `systemPrompt` and forwards it in `session:rewindFiles`
  params; chat-view passes `commandCenterPersonaFor(tab)` for marked tabs only (core takes a plain string; core does
  not import chat-state).
- Validation notes: unmarked rewind sends no `systemPrompt` key.
- Implementation details: surgical edit in chat-view (R9).

### Batch 16 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes (2 projects); output tailed.
- Phase D's last batch: after commit return NEEDS REVIEW (code-logic + style, combined diff B11-B16). Visual review is
  requested with B18 evidence.
- Result (2026-10-15, orchestrator): codex lane delivered the 8 files; the orchestrator rejected 3 source-text specs (`readFileSync`) and a codex
  correction replaced the shell-tab and composer-lock specs with TestBed behavior specs (`chat-view.rewind-persona.spec.ts` stays source-level:
  weaker evidence, chat-view is very large) and updated the pinned Apps tab order. The orchestrator updated the pinned tab list in
  `electron-shell.config-gate.spec.ts`. Scoped run: core 41 suites / 1255 tests pass; chat 216 suites pass after the config-gate fix (18/18 in
  that suite); typecheck pass; lint 0 errors (2 existing max-lines warnings on chat-input and chat-view).

## Batch 17: Acceptance integration specs - PENDING

- Recommended executor: CLI lane (testing; Angular/Jest)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: N/A (tests only; no phase review)
- Rationale: new spec files only; no production file shared with another batch.
- Tasks: 2 | Depends on: B16
- Phase: E - Acceptance | Phase review: none (tests and measurement only)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `test(command-center): batch 17 - acceptance integration specs`

### Task 17.1: Integration specs per AC group - PENDING

- Files: new specs under `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/integration/`
  (at most 6: session-identity-and-lock, voice-turn-loop, delegation-and-status, tribunal-confirm-gate,
  failure-and-fallback, accessibility-list)
- Plan reference: implementation-plan.md:50-56, :79; task-description AC1-AC25
- Pattern to follow: TestBed integration specs in `libs/frontend/mcp-apps-page/src/lib/`
- Quality requirements: map each AC to at least one assertion; A1 tests re-asserted end to end through page +
  coordinator; secret boundary (no key, no raw error) asserted.
- Validation notes: if a spec exposes a production defect, report it; the team-leader opens a fix batch (no
  production edits in this batch).
- Implementation details: mock RPC at `ClaudeRpcService`.

### Task 17.2: AC evidence table in test-report.md - PENDING

- Files: `TASK/test-report.md` (section "Automated evidence")
- Plan reference: implementation-plan.md:50-56
- Quality requirements: AC -> spec file:test name table; manual items listed for B18.

### Batch 17 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.

## Batch 18: Electron Scene and Voice Gate and visual evidence (user-run gate) - PENDING

- Recommended executor: user-run Electron session + visual-reviewer subagent for screenshot review
- Execution mode: sequential
- Fallback order: N/A
- Subagent reason: visual review needs a rendered browser/Electron app and screenshots, which a CLI lane cannot
  produce; the Electron run itself is user-run because `CLAUDE.md` bars agents from build/serve/e2e.
- Review family: visual-reviewer is independent of every implementer
- Rationale: plan line 60 gate and the Mode 3 rendered-evidence requirement.
- Tasks: 2 | Depends on: B17 (B18 records the baseline and the voice bound, D34)
- Phase: E | Phase review: none (measurement); visual review verdict recorded here for Phase D
- Suggested commit: `docs(task-specs): batch 18 - electron scene and voice gate evidence`

### Task 18.1: Electron Scene and Voice Gate - PENDING

- Files: `TASK/test-report.md` (section "Electron Scene and Voice Gate"), trace/config files under `TASK/evidence/`
- Plan reference: implementation-plan.md:60; risks R4, R12, R13; design-spec-review R3-6, R3-7
- Quality requirements: 30-second dark and light traces at N=24 after 10 s warmup, 1280x720, integrated GPU: full
  frame including composite, p95 draw (pass at most 8 ms), sustained at least 30 FPS, no persistent layout spike,
  stable memory after navigation teardown, voice p95 within the bound recorded in B18 (D34; B0 was waived) (cold worker and post-barge-in separate);
  laptop-speaker and headset echo/barge-in cases; Blob-URL worklet capture works (assumption 6); manual Tribunal
  check that no agent spawns during the discovery turn or after Decline (R4 - if one does, the orchestrator escalates
  a host-side hold before release); spoken status summary distinguishes running/completed/failed (AC10, AC13).
- Validation notes: headless numbers do not count.

### Task 18.2: Visual evidence vs prototype - PENDING

- Files: `TASK/visual-review.md`, screenshots under `TASK/evidence/screens/`
- Plan reference: implementation-plan.md:60 ("reshoot design-review frames"); design-spec-review R3-5
- Quality requirements: dark and light screenshots of idle, listening, speaking, 24 nodes, pending question, Tribunal
  confirm card, failure, unknown provider (monogram), mic denied, missing provider; compared to `TASK/prototype/`
  frames; visual-reviewer verdict.

### Batch 18 verification

- `TASK/test-report.md` and `TASK/visual-review.md` exist with all fields, pass/fail per criterion and an accepting
  visual verdict; every failing criterion opens a fix batch before Mode 3.

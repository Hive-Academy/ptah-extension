# Batches - TASK_2026_678_9083

Total tasks: 56 | Batches: 22 (20 code batches + 2 user-run gates) | Complete: 10/22

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

## Phases and reviews

| Phase | Batches | Phase review |
| ----- | ------- | ------------ |
| 0 - Baseline | B0 | none (measurement) |
| A - Chat runtime contracts | B1-B4, fix B4F | CLOSED: code-logic (B1-B4: NEEDS_REVISION); B4F re-review APPROVED (L1 closed) |
| B - Command Center model and Tribunal source | B5, B6, B6A, B7, B8, fix B8F | code-logic + style (new public API: `@ptah-extension/command-center`, `@ptah-extension/tribunal-panel/phase`); REQUESTED after B8 on `fa97a6967^..<B8 SHA>`; B8F is the one fix round (pre-seeded, Decision D13) |
| C - Voice | B9-B10 | code-logic |
| D - Scene, page, route, nav | B11-B16 | code-logic + style (new public API: `@ptah-extension/ui/provider-brand-art`); visual review runs with B18 evidence because it needs the Electron app |
| E - Acceptance | B17-B18 | none (tests and measurement); B18 visual evidence is still required for Mode 3 |

Reviewer for every phase review is a different model family from the batch implementer (for example, a lane
implementer is reviewed by a lane of another family or an in-process subagent). Record both families on the phase's
last batch header.

## Batch 0: Preimplementation Electron spike (user-run gate) - IN_PROGRESS

- Recommended executor: user-run on target Electron hardware, recorded by the orchestrator
- Execution mode: sequential
- Fallback order: N/A (manual gate; no agent may run build/serve/e2e)
- Subagent reason: N/A - this needs the user's Electron hardware and an Electron run, which `CLAUDE.md` bars agents from starting
- Review family: N/A
- Rationale: plan line 60 requires measured frame and audio baselines before voice/scene code; it is a user action.
- Tasks: 1 | Depends on: none | Gates: B9, B10, B11, B12 (Decision D2)
- Phase: 0 - Baseline | Phase review: none

### Task 0.1: Record the baseline in test-report.md - IN_PROGRESS

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

## Batch 8: Owned work projection, status context and Tribunal roster gate (A1) - COMPLETE (commit PENDING_SHA)

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
- Phase B review: REQUESTED on `fa97a6967^..PENDING_SHA`. Implementer family: codex (B5, B6, B6A, B7, B8).
  Code-logic reviewer: grok CLI lane (different family), output `TASK/code-logic-review-phase-b.md`.
  Style reviewer: in-process `code-style-reviewer` subagent (Anthropic family), output
  `TASK/code-style-review.md`, run after the logic review returns.

## Batch 8F: Phase B fix round - multi-run manifest, manifest role contract, close cleanup - PENDING

- Recommended executor: CLI lane (implementation; Angular data-access TypeScript with a persisted-schema migration)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (re-review by a non-implementer family, scoped to the B8F commit)
- Rationale: one persisted contract (`CommandCenterRunManifest` storage) with its producer and its close-path
  consumer; the producer and the store must change in the same commit or the contract is broken between commits.
- Tasks: 3 (+ Phase B review findings appended when the verdict returns) | Depends on: B8 and the Phase B verdict
- Phase: B (fix round) | Phase review: code-logic re-review scoped to the B8F commit; style re-review only if B8F
  changes a public entry (for example a `phase` widening under D14)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/chat-state @ptah-extension/command-center --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `fix(chat-state,command-center): batch 8F - per-run manifests`

### Task 8F.1: Key run manifests by run ID and migrate the old shape on read (TL-1) - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts`
- Plan reference: implementation-plan.md:16, :74, :98; B8 validation notes "two runs" and "restart with manifest"
- Pattern to follow: the existing per-field `safeParse` sanitising read (`command-center-records.ts:41-67`)
- Quality requirements: store `runs` keyed by `runId`; API `readRunManifests(workspace, rootTabId)` returns every
  valid manifest for that root (stable order by `startedAt`), `writeRunManifest` adds or replaces one run by
  `runId`, `removeRunManifests(workspace, rootTabId)` drops all runs of that root. On read, accept the old shape
  (an entry keyed by `rootTabId` whose manifest `rootTabId` equals the key) and re-key it by its `runId`; drop
  entries that fail the schema or whose key matches neither `runId` nor `rootTabId`. The next write persists only
  the new shape. Last-session and active-tab fields stay byte-compatible.
- Validation notes (write-path trace, required by Mode 3): the only writer is `writeRunManifest`, called by the
  B13 transport; readers are `readRunManifests` (B13/B14 restart join) and the projection input. Same storage
  key (`<partition>.command-center`, `:37-39`), same scope (workspace partition), no env side effects. The spec
  covers: two runs under one root survive a reload; an old-shape record loads and is rewritten in the new shape;
  a corrupt entry is dropped without losing the others; workspace isolation.
- Implementation details: replace the old single-run methods in place (no V2 copies); update the 4 spec cases
  that call `readRunManifest`/`removeRunManifest`.

### Task 8F.2: Allow role-less lanes in the manifest contract (TL-2) - PENDING

- Depends on: Task 8F.1 (same file)
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- Plan reference: implementation-plan.md:31, :74; Amendment A1 item 3 (registration before launch)
- Quality requirements: lane `role` becomes optional in the schema (absent, never `''`), and the coordinator omits
  `role` when the proposal lane has none. Add a coordinator spec that runs `writeManifest` through a real
  `manifestSchema`-shaped check (or the records service) for a Council roster, so a mock can no longer hide the
  contract.
- Validation notes: Relay and Crucible manifests keep their roles; old records with non-empty roles still load.

### Task 8F.3: Remove the root's run manifests on confirmed close (TL-3) - PENDING

- Depends on: Task 8F.1
- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- Plan reference: implementation-plan.md:16, :98 ("Closing it warns, aborts its stream and removes its tab/manifest")
- Pattern to follow: the B6A close path (`tab-manager.service.ts:1370-1405`, `clearForRoot` and
  `recordCommandCenterWrite`)
- Quality requirements: after the confirmed removal of a marked root tab, call `removeRunManifests` for that root and
  route a `false` through `recordCommandCenterWrite`; a cancelled close and a workspace-switch park keep the
  manifests; last-session record is untouched (Resume stays available).
- Validation notes: unmarked tabs never touch the records.

### Batch 8F verification

- Every listed artifact exists and contains the required work, plus any appended review fixes.
- The scoped command passes (2 projects in the header); output tailed.
- Write-path trace recorded in the batch result (Task 8F.1 validation notes).
- Then the one code-logic re-review, scoped to the B8F commit, closes Phase B.

## Batch 9: Voice primitives (adapted from property-hub) - PENDING

- Recommended executor: CLI lane (implementation; TypeScript, Web Audio)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: pure, well-specified units ported per A1 item 5.
- Tasks: 4 | Depends on: B0 recorded (D2), B5
- Phase: C - Voice | Phase review: code-logic (after B10)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 9 - vad, chunker, playback queue, spoken text`

### Task 9.1: VAD - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.spec.ts` (new)
- Plan reference: implementation-plan.md:36, :75; A1 item 5
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/vad.ts`
- Quality requirements: energy-based onset/offset with hangover, minimum utterance length, noise floor; a playback
  mode that requires sustained onset (used by Task 10.2 for echo gating). Pure, frame-driven, no timers.
- Validation notes: silence and noise produce no utterance.
- Implementation details: adapt to Ptah lint rules; new spec (source has none).

### Task 9.2: Sentence chunker - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.spec.ts` (new)
- Plan reference: implementation-plan.md:36, :38; A1 item 5
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/sentence-chunker.ts` and its spec
- Quality requirements: incremental streaming chunks at sentence boundaries with a bounded maximum chunk length.
- Validation notes: abbreviations and decimals do not split.
- Implementation details: port and adapt the spec.

### Task 9.3: TTS playback queue - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.spec.ts` (new)
- Plan reference: implementation-plan.md:38; A1 item 5; risk R15
- Pattern to follow: `D:/projects/property-hub/libs/admin/feature-ai-agent/src/lib/voice/tts-playback-queue.ts` and its spec
- Quality requirements: ordered playback, at most two synth requests in flight, generation IDs that revoke stale clips
  on barge-in/stop/mute/navigation, object URL revocation, playback failure reported (full text stays).
- Validation notes: superseded audio never plays.
- Implementation details: inject the synth function (`voice:synthesize` wrapper) for testability.

### Task 9.4: Spoken-text boundary filter - PENDING

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

## Batch 10: PCM capture, voice loop and status narrator - PENDING

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

### Task 10.1: PCM capture with pre-roll and WAV encoding - PENDING

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

### Task 10.2: CommandVoiceLoop - PENDING

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
- Validation notes: record cold-worker and post-barge-in latency marks for B18.
- Implementation details: state flows into `CommandCenterStore` voice state.

### Task 10.3: Status narrator - PENDING

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

## Batch 11: Provider brand-art entry, scene layout and sprite cache - PENDING

- Recommended executor: CLI lane (implementation; TypeScript, Canvas 2D)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: pure geometry and cached drawing plus a narrow UI entry; 7 files in 2 projects.
- Tasks: 3 | Depends on: B0 recorded (D2), B8
- Phase: D - Scene, page, route, nav | Phase review: code-logic + style (after B16)
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/ui @ptah-extension/command-center --parallel=1 2>&1 | tail -60`
  (header must say 2 projects). Verification rules above apply.
- Suggested commit: `feat(ui,command-center): batch 11 - brand-art entry and scene layout`

### Task 11.1: Narrow provider-brand-art entry and barrel guard - PENDING

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

### Task 11.2: Scene layout - PENDING

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

### Task 11.3: Sprite cache - PENDING

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

## Batch 12: Scene renderer and scene component - PENDING

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

### Task 12.1: CommandSceneRenderer - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts` (new)
- Plan reference: implementation-plan.md:46; design-spec.md:56-63; risk R13
- Pattern to follow: draw loop in `TASK/prototype/command-center.html`
- Quality requirements: draws outside NgZone from immutable snapshots; `drawImage`, status rings, Bezier links,
  bounded particles (16) and dots (48); render-on-demand idle; visibility pause; no signal writes per frame; overlay
  label transforms written directly in rAF from cached sizes; dev meter at most 2 Hz.
- Validation notes: separate voice ring and selection halo.
- Implementation details: spec with a mocked 2D context counting calls.

### Task 12.2: CommandSceneComponent - PENDING

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

### Batch 12 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.

## Batch 13: Presentational components (pending card, work list, HUD, session controls) - PENDING

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

### Task 13.1: CommandPendingInputComponent - PENDING

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

### Task 13.2: CommandWorkListComponent - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.ts` (new),
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts` (new)
- Plan reference: implementation-plan.md:46; task-description AC14, AC17, AC18
- Pattern to follow: rail list in prototype
- Quality requirements: every owned item (not capped) with node, provider, parent and state in text; keyboard
  selection; state changes announced via a live region, not colour alone; provider mark via `ProviderMarkComponent`,
  unknown -> `MonogramTileComponent`.
- Validation notes: list stays complete when the scene caps at 24.
- Implementation details: input projection, output selection.

### Task 13.3: CommandVoiceHudComponent - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts` (new)
- Plan reference: implementation-plan.md:40, :46; task-description AC3, AC4, AC7, AC8, AC9
- Pattern to follow: HUD frames in prototype (listening/thinking/speaking/muted/mic denied/missing provider/errors)
- Quality requirements: start/stop/mute/interrupt controls; Stop never disabled while a turn can be aborted; mic
  denied and missing provider states link to existing voice settings; safe error text only; never a key.
- Validation notes: covered by page spec (Task 14.2) and integration specs (B17).
- Implementation details: input voice state, outputs control intents.

### Task 13.4: CommandSessionControlsComponent - PENDING

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

## Batch 14: Overlay and page component - PENDING

- Recommended executor: CLI lane (implementation; Angular UI)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: composes everything; exposes the lazy entry used by the route in B15.
- Tasks: 2 | Depends on: B12, B13
- Phase: D | Phase review: after B16
- Scoped verification: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | tail -60`.
  Verification rules above apply.
- Suggested commit: `feat(command-center): batch 14 - command center page`

### Task 14.1: CommandOverlayComponent - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay.component.ts` (new)
- Plan reference: implementation-plan.md:46; design-spec.md:52-56
- Pattern to follow: DOM label/tooltip layer in prototype
- Quality requirements: label plates and tooltip positioned by the renderer's direct transforms; repeating CSS motion
  uses only transform/opacity; theme-aware chips.
- Validation notes: no per-frame Angular change detection.
- Implementation details: exposes element refs to the scene.

### Task 14.2: CommandCenterPageComponent and lazy export - PENDING

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

### Batch 14 verification

- Every listed artifact exists and contains the required work.
- The scoped command passes; output tailed.
- No per-batch review.

## Batch 15: Surface id and Electron-only route - PENDING

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

### Task 15.1: command-center surface id - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/webview-surface.types.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/shared/src/lib/types/webview-surface.types.spec.ts`
- Plan reference: implementation-plan.md:23, :78; Decision D3; assumption 5
- Pattern to follow: the `'apps'` entry (`webview-surface.types.ts:43-74`)
- Quality requirements: add `'command-center'` to `ViewType` and `SURFACE_ROUTE_IDS` (after `'apps'`); doc comment
  says Electron-only via route guard.
- Validation notes: grep specs pinning the list (`grep -rn "'apps'" apps libs --include=*.spec.ts`); update only those
  in the two batch projects; report any outside them instead of editing.
- Implementation details: type + list + spec line.

### Task 15.2: Electron-only lazy route - PENDING

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

## Batch 16: Electron nav, regular-chat lock banner and rewind persona - PENDING

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

### Task 16.1: Electron navigation entry - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/templates/electron-shell.command-center-tab.spec.ts` (new)
- Plan reference: implementation-plan.md:23, :78; task-description AC1, AC18
- Pattern to follow: Apps tab (`electron-shell.component.ts:150-151,516`); spec `electron-shell.apps-tab.spec.ts`
- Quality requirements: keyboard-reachable nav entry, `aria-selected`, `setCurrentView('command-center')`; Electron shell only.
- Validation notes: no VS Code nav change.
- Implementation details: mirror the Apps tab.

### Task 16.2: Regular-chat lock banner and Open Command Center link - PENDING

- Files: `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`,
  `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts` (new)
- Plan reference: implementation-plan.md:5, :29, :71; task-description AC25
- Pattern to follow: read-only banner for `attachedBinding` (`chat-types.ts` `TabState.attachedBinding` doc)
- Quality requirements: while `isHeld(activeTab)` the composer shows that Command Center voice owns this session,
  holds sends, keeps Stop and pending answers enabled, and links to Command Center; unlocked tabs unchanged.
- Validation notes: queued content stays visible and sendable after unlock.
- Implementation details: signal from `CommandCenterSendLockService`.

### Task 16.3: Persona on rewind activation - PENDING

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
- Tasks: 2 | Depends on: B17 (and B0 recorded bound)
- Phase: E | Phase review: none (measurement); visual review verdict recorded here for Phase D
- Suggested commit: `docs(task-specs): batch 18 - electron scene and voice gate evidence`

### Task 18.1: Electron Scene and Voice Gate - PENDING

- Files: `TASK/test-report.md` (section "Electron Scene and Voice Gate"), trace/config files under `TASK/evidence/`
- Plan reference: implementation-plan.md:60; risks R4, R12, R13; design-spec-review R3-6, R3-7
- Quality requirements: 30-second dark and light traces at N=24 after 10 s warmup, 1280x720, integrated GPU: full
  frame including composite, p95 draw (pass at most 8 ms), sustained at least 30 FPS, no persistent layout spike,
  stable memory after navigation teardown, voice p95 within the B0 bound (cold worker and post-barge-in separate);
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

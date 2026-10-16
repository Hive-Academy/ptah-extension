# Completion summary - TASK_2026_678_9083 (voice Command Center, Electron only)

Team-leader Mode 3, 2026-10-16. Branch `feat/command-center`, head `8fb2525e5` (in sync with
`origin/feat/command-center`), draft PR #735. 73 commits on `main..HEAD`.

## Outcome

TASK COMPLETE, with three exceptions the user chose. They are listed here, not hidden:

1. **B18 Task 18.1 (Electron Scene and Voice Gate) is DEFERRED (D57).** No mic latency, barge-in, echo,
   FPS, p95 draw or R4 spawn value was measured. The B0 baseline was waived earlier (D34) and moved into
   18.1, so it is also not recorded. AC20 and AC23 are proven by nothing yet.
2. **No visual review returned APPROVED.** Four visual passes (`visual-review.md`, `-phase-e-r1.md`,
   `-r3.md`, `-r6.md`, plus `visual-review-phase-e.md`) all ended NEEDS_REVISION. The last one (r6, 7/10)
   had one Serious item, S-1: an in-flight send rebinds the page to the old workspace's session. It was fixed
   in `4051af50c` and closed by the APPROVED r7 code-logic review using spec evidence only. Per the user's
   decision D55 there was no Electron re-check.
3. **`836ca1548` has no independent review.** It is the orchestrator's 18-line fix for r7 Moderate M-A:
   a fixed-text toast when a typed send throws, plus a spec. It is exactly the fix the r7 reviewer
   prescribed. Label: weaker evidence (same family as the orchestrator, not reviewed).

All 26 code batches and every Phase D/E fix round are committed. Every SHA in `batches.md` is an ancestor
of HEAD (checked with `git merge-base --is-ancestor`). Every phase that changed shipping code ends with
an accepting code-logic review. Phases B and D, which added new public API, also have an accepting style
review.

## What shipped (by area)

- **Chat runtime contracts (Phase A).** An optional, length-bounded persona `systemPrompt` on chat
  continue, resume and rewind params (`shared`, `rpc-handlers`), kept on slash relaunch (B4F). A
  `commandCenterOrigin` tab marker, a persona resolver and the `CommandCenterRecordsService` (last session
  and per-run Tribunal manifests) in `chat-types`/`chat-state`. A send lock service and the marked-tab
  lifecycle. A guard on the chat send funnel, persona attach, and question answers that name their tab
  explicitly (`chat`).
- **Command Center model and Tribunal source (Phase B).** The new lib `@ptah-extension/command-center`:
  store, session coordinator, owned-work projection, a status-context builder capped at 2 KB, and
  Tribunal roster proposal validation with a run coordinator behind an explicit on-page Confirm gate
  (Amendment A1: no affirmative discovery answer; Decline on deny, timeout, exit and non-delivery). In
  `tribunal-panel`: run framing and phase derivation extracted, plus the narrow `/phase` entry.
- **Voice (Phase C).** VAD, sentence chunker, TTS playback queue, spoken-text boundary filter, PCM capture
  with pre-roll and WAV encoding, `CommandVoiceLoop` (barge-in, mute/release) and the status narrator.
- **Scene, page, route, nav (Phase D).** The narrow `@ptah-extension/ui/provider-brand-art` entry, scene
  layout, sprite cache, canvas scene renderer and component, pending-input card, work list, voice HUD,
  session controls, overlay and page. The `command-center` surface id and an Electron-only lazy route; the
  Electron nav entry, a regular-chat lock banner with an "Open Command Center" link, and persona on rewind
  activation. The narrow `@ptah-extension/tribunal-panel/discovery` entry (D39).
- **Acceptance and visual fixes (Phase E).**
  - B17 integration specs per AC group.
  - The AudioWorklet is now served from a same-origin asset that the renderer CSP allows (B1 Blocking), and
    sprites draw at prototype size (B2 Blocking).
  - Typed error kinds and Stop for typed turns; identity labels and plate selection; page chrome.
  - Command Center cards in the Setup hub and the dashboard (E6); a voice provider chip.
  - Ref-counted visible-tab registration (`chat-state`); a bounded rail as the single scroller; HUD state
    that follows real TTS playback.
  - Workspace binding: the page follows the active workspace, and every send is guarded against a stale
    workspace. An in-flight send keeps the binding it started on; a failed start shows a toast.
  - Backend (D56): the Electron argv workspace must be an existing directory; a failed start and a failed
    resume now have different error text; each CHAT_ERROR is logged once.

## Per-phase executor, families and verdict

Implementer family "codex" means codex CLI lanes. "Orchestrator" means bounded corrections made by the
Anthropic orchestrator. Reviewers marked Anthropic were in-process subagents.

| Phase | Batches / commits | Executor | Author family | Reviewer family | Final verdict | Last review a delta after NEEDS_REVISION? |
| --- | --- | --- | --- | --- | --- | --- |
| 0 Baseline | B0 | user-run | - | - | WAIVED (D34), folded into 18.1 (deferred) | - |
| A Chat runtime contracts | B1 `639470cfc`, B2 `619ec683b`, B3 `ad19f9679`, B4 `97929ae01`, fix B4F `f590a5647` | codex lanes | codex | grok (logic) | APPROVED: B4F re-review in `code-logic-review.md` (L1 closed). L2-L4 deferred into B6/B6A, now closed | yes (initial NEEDS_REVISION, B4F re-review) |
| B Model and Tribunal source | B5 `fa97a6967`, B6 `7bf32ad0c`, B6A `f7230a25b`, B7 `9b3f268be`, B8 `2137ab904`, 8F0 `5d52cfa5b`, 8FA `dd8e42cd9`, 8FB `545d3b53a`, 8FC `ae74169bc`, 8FD `a5adac5cd`, 8FE `b5af1cc42`, 8FG `433aab5ad` | codex lanes | codex | logic grok; style Anthropic | logic APPROVED 9/10 (`code-logic-review-phase-b-8fg.md`); style APPROVED (`code-style-review.md` re-review) | yes (8FG delta after re-review NEEDS_REVISION 7/10) |
| C Voice | B9 `b65372ba1`, B10 `cd3a5c6e9`, fix `57f5d0940` | codex lanes | codex | grok (logic) | APPROVED 7/10 (`code-logic-review-phase-c-rereview.md`); N1 carried into 14.2c (D37) | yes |
| D Scene, page, route, nav | B11 `4b7455a36`, B12 `64c69a8ca`, B13 `fd493f2c9`, B14 `5b02f44a8` `4d7cd2f92` `6606037c1` `0d2b4d91a`, B15 `eb3b280c4`, B16 `45fb50746`; fixes `dc2751082` `c4f4a51c7` `711a1c980` `e1f2e5ea7` `c005c7a7a` `73f36418a` `eb52cdbb9` `93489596d` | codex lanes | codex | logic: grok (initial, re-review), then Anthropic (r2, final, sa, guard, s1); style Anthropic | logic APPROVED (`code-logic-review-phase-d-s1.md`); style APPROVED 7/10 (`code-style-review-phase-d-rereview.md`) | yes (s1 delta after guard NEEDS_REVISION 6.5/10). Rounds past the fix-round cap were each authorised by the user (D40-D44) |
| E Acceptance tests | B17 `59f366c50` | codex lane | codex | none (tests only, by rule) | n/a | - |
| E Visual fix rounds 1-7 | E1-E5 `e4375e451`, E6 `294be63cc`; r1 `8d15080be` `95e8cd4fe` `be433c363`; r3 `ee39c7311`; r4 `29ba80c32` `14a642675`; r5 `af8906844`; r6 `2501d9670`; r7 `4051af50c` `ee719b838` `836ca1548` | codex lanes + orchestrator bounded corrections | codex; orchestrator edits Anthropic | Anthropic (logic and visual) | logic APPROVED 8/10 (`code-logic-review-phase-e-r7.md`). Visual last NEEDS_REVISION 7/10 (r6); S-1 closed by code review only (D55) | yes (r7 delta after visual r6 NEEDS_REVISION; r6 delta after r5 NEEDS_REVISION). Rounds past the cap authorised by the user (D46-D56) |
| B18 gate | 18.2 visual evidence; 18.1 measurements | visual-reviewer subagent; user (18.1) | - | Anthropic visual-reviewer | 18.2 COMPLETE (evidence exists, no APPROVED verdict); 18.1 DEFERRED (D57) | - |

**Same-family exceptions (weaker evidence).** These orchestrator corrections were reviewed by Anthropic
reviewers, the same family as the orchestrator:

- r1: provider mapping and status/visibility effects moved out of the controller; harness mocks.
- r3: revert of a canvas change.
- r4: the `viewChild` generic, and `14a642675` (one CSS rule).
- r5: `canSend` moved into the binding, and the do-while first open.
- r7: the `submitting` guard, and the require-yield lint exception.

`836ca1548` has no review at all (exception 3 above). Every codex-authored change had a cross-family review.

**Phase E delta reviews.** No reviewer has looked at the whole Phase E diff (`e4375e451^..HEAD`) in one
pass. Each round was reviewed as a delta scoped to its fixes.

## Mode 3 checks

1. **Commits and reviews.** Done for all phases (table above). Branch working tree is clean except the
   untracked `HANDOFF.md`.
2. **Rendered visual evidence.** Dark and light screenshots compared against `prototype/command-center.html`
   exist on disk in each pass:

   | Folder | Total | Dark | Light |
   | --- | --- | --- | --- |
   | `reports/visual/` (base pass and prototype frames) | - | yes | yes |
   | `reports/visual/phase-e/` | 62 | 53 | 5 |
   | `reports/visual/phase-e-r1/` | 83 | 47 | 32 |
   | `reports/visual/phase-e-r3/` | 58 | 32 | 20 |
   | `reports/visual/phase-e-r6/` | 22 | 19 | 2 |

   Every verdict was NEEDS_REVISION. The last Serious (r6 S-1) has spec evidence only (D55). These folders
   are git-ignored, so PR readers cannot see the screenshots.
3. **B18 measurements.** Not measured (D57). This summary claims none of them.
4. **Write-path trace** (risk R16):
   - **Records.** `CommandCenterRecordsService` writes `localStorage` key
     `<getStorageKeyForWorkspace(ws)>.command-center` (`chat-state/src/lib/command-center-records.ts:38,91`).
     The same service reads it back with zod-validated `lastSession` and `runs` schemas (`:45`); corrupt data
     yields an empty record. Readers and writers: the session coordinator (last session), the Tribunal
     transport and run coordinator (per-run manifests, 8FA/8FG migration), the projection source (manifests),
     and the tab manager (close cleanup; write failures surfaced since B6A). Reviewed in
     `code-logic-review.md:39,73`, `code-logic-review-phase-b.md:66` and the 8FA/8FG reviews. It is a new key
     and leaves existing keys alone.
   - **Tab marker.** `commandCenterOrigin` is written on create (`tab-manager.service.ts:1011`) and
     sanitized on persist by `validCommandCenterOrigin` (`tab-persistence.ts:219-258`). On restore it is
     validated (`tab-manager.service.ts:1364-1396`), and an invalid marker turns the tab into an ordinary tab.
     Tabs without a marker are unchanged.
   - **Electron argv workspace (D56).** `initialFolders` now takes only an existing directory, still
     `path.resolve`d (`initial-workspace-arg.ts`, `bootstrap.ts`). This is an intended narrowing: a
     non-directory argument is no longer registered. An invalid entry already stored in a profile stays.
   - **Settings and config.** The command-center lib makes no settings or config writes (no `setItem`,
     config-set or preference-save calls outside specs). Visible-tab ref-counting is in memory only.
5. **Parity.** N/A. `task-description.md:22` puts replacing the chat canvas or the Tribunal page out of
   scope, and no existing surface was replaced, consolidated, rebuilt or redesigned. The Tribunal extraction
   (B7) is a behaviour-preserving refactor that the Phase B review covered. There is no
   `parity-inventory.md`, and none is required.

**Validation risks.**

| Validation risk | Resolution |
| --- | --- |
| R1 rewind persona | B1, B16 (Task 16.3) |
| R2 route vs surface id | B15 (D3) |
| R3 deciding tab | B4 (Task 4.3) |
| R4 paid Tribunal spawns | Code half done (A1 gate, `tribunal-confirm-gate.spec.ts`, AC22 holds in every Phase D/E review). The manual check that no agent spawns during discovery or after Decline is NOT done (D57). Release-relevant: if a spawn occurs, a host-side hold is needed. |
| R5 lib skeleton | B5 |
| R6 spoken filter and narrator | B9, B10 |
| R7 status context | B8 (Task 8.2) |
| R8 no `MESSAGE_HANDLERS` provider | Phase B and D reviews |
| R9 large files | Surgical edits; controller kept under 700 lines |
| R10 renderer persona | B1 (length bound), B2 (marked tabs only) |
| R11 B0 gate | Waived (D34) |
| R12 echo | Code done (B10); speaker/headset case not measured (D57) |
| R13 draw cost | Frame-loop hygiene done; full-frame traces not measured (D57) |
| R14 design R3-x | Landed in B11-B13; R3-5 reshoot done (visual reviews); R3-6/R3-7 not measured (D57) |
| R15 ElevenLabs cost | B9, B10; latency not measured (D57) |
| R16 persisted writes | Traced above |

## Evidence index

- State and decisions: `batches.md` (D1-D57, Phases and reviews, Phase E rounds), `decisions.md`,
  `test-report.md`.
- Logic reviews:
  - Phase A: `code-logic-review.md`.
  - Phase B: `code-logic-review-phase-b.md`, `-phase-b-rereview.md`, `-phase-b-8fg.md`.
  - Phase C: `-phase-c.md`, `-phase-c-rereview.md`.
  - Phase D: `-phase-d.md`, `-phase-d-rereview.md`, `-phase-d-r2.md`, `-phase-d-final.md`, `-phase-d-sa.md`,
    `-phase-d-guard.md`, `-phase-d-s1.md`.
  - Phase E: `-phase-e.md`, `-phase-e-r1.md` (with r1b and r1c deltas), `-phase-e-r3.md`, `-r4.md`, `-r5.md`,
    `-r6.md`, `-r7.md`.
- Style reviews: `code-style-review.md` (Phase B), `code-style-review-phase-d.md`,
  `code-style-review-phase-d-rereview.md`.
- Visual reviews: `visual-review.md`, `visual-review-phase-e.md`, `visual-review-phase-e-r1.md`,
  `visual-review-phase-e-r3.md`, `visual-review-phase-e-r6.md`. Screenshots are under `reports/visual/`
  (git-ignored).
- Lane reports: `reports/batch-*-report.md`, `reports/phase-*-report.md`.
- Follow-ups: `future-enhancements.md`.
- Latest scoped checks (run by the orchestrator, not re-run here):
  - `command-center` 328/328, and the page spec 18/18 after `836ca1548`.
  - `rpc-handlers` broadcaster 38/38; `chat` handler and lifecycle 99/99; Electron `initial-workspace-arg`
    4/4.
  - Typecheck and lint clean for `command-center`, `rpc-handlers`, `chat` and `ptah-electron`.
  - Degradation audit 296 (unchanged).
  - Earlier rounds: `chat-state` 599/599 and `canvas` 371/371 at `ee39c7311`.
- **Stale wording in `test-report.md`.** The AC5, AC12, AC15 and AC24 rows still say "final run failed
  during TestBed setup". Those integration specs live in `libs/frontend/command-center/src/lib/integration/`
  and run inside the 328/328 `command-center` target, so the wording is from B17 and should be refreshed.

## Open items

### Deferred by the user

- **B18 Task 18.1 (D57):**
  - End-of-utterance to first-audio latency: at least 30 samples, cold worker and after barge-in (median and
    p95).
  - Barge-in feel; speaker vs headset echo.
  - FPS and p95 draw at N=24 (1280x720, integrated GPU, dark and light, 30 s traces).
  - The R4 discovery-turn spawn check.
  - The D34 baseline (refresh rate, provider pair).
  - Real OS microphone denial and settings recovery.
- **No visual re-check after `4051af50c` (D55).** Visual passes also never reached: a live mid-turn model
  question, a real Tribunal Confirm click, barge-in by voice, or the S-1 race on the Tribunal Confirm and
  `answerQuestion` paths.
- **Out of scope by decision:** scene zoom and pan (D31); `npx husky` in worktree setup (D15).
- **Phase D Moderates and Minors** left open by D41 and D43, listed under Logic below.

### Follow-ups by severity (from `future-enhancements.md` unless marked)

Blocking and Serious: none open.

**Moderate, logic:**

- Phase D final M-1 to M-4:
  - no correlation from pulse to send, so a phantom token can leave the loop deaf;
  - a clip cancels an awaited typed reply;
  - a mic failure disables Start for the page lifetime, and every capture failure reads as "denied";
  - a failed voice-sent turn gives no feedback.
- After D44:
  - M-A: `expectedRequest` has no TTL;
  - M-B: no UI for retrying Decline after the third failure;
  - M-C: no specs for the retry timers;
  - guard M-3: `confirmProposal` clears a newer request's nonce.
- Phase E r1:
  - M-4: the typed error kinds stt/tts/playback/chat are never produced;
  - M-5: a hidden pinned card keeps its pinned state;
  - M-6/F-8: dense grid searches inside a reactive effect, and the root plate can land far from its sphere;
  - F-2: narrowed;
  - F-6: the chip reads "Voice unavailable" while the config loads, and its aria-label lacks the visible text;
  - F-9: plate size jumps;
  - F-10: check that no notification sound plays over a spoken reply.
- R3-3: no bound on a turn that never receives a terminal `turn_state`.
- r5 M-2 (an old-workspace turn keeps running after a rebind) and M-3 (a fast start failure can miss the
  toast).
- r6 Moderate-1 and Moderate-2. The r6 reviewer recommends fixing both before release:
  - Moderate-1: the initial `page.open()` rejection is unhandled and can leave the status stuck at
    `starting`;
  - Moderate-2: after a failed rebind, Status and Tribunal Confirm retries are refused and nothing retries
    the open.

**Moderate, style:** M1 (split `CommandCenterPageController`; extract the roster flow); N1 (HUD error kind is
matched on toast text); N2 (no spec for the HUD outputs or the theme feed); N3 (duplicated reset in
`mute()`/`release()`).

**Moderate, visual:**

- The shell tab-strip scrollbar overlays labels at 892/900 (M-e, M-r1-4).
- Contrast: disabled controls are 1.76:1 or 1.46:1 (M-g, M-r1-5); the light focus ring is 2.2-2.5:1
  (M-r1-2).
- Ptah plate far from its sphere at 24 nodes (M-r1-6).
- The "+1 completed" overflow chip has a square backing that overlaps the hint (M-r1-7).
- The error toast pushes the dock down about 60 px (r3, r6 m-2).
- The input sits at or below the fold at 900x800 and 892x735 (r3).

**Minor:**

- Phase D: the Minors in `code-logic-review-phase-d-final.md`; style N4-N9 and the 10 Minors of
  `code-style-review-phase-d.md`.
- After D44: `requestStatus` bypasses the send gate; `skipNextPulse` reads only active-workspace tabs;
  a second untagged question waits; the 2 Minors of the guard review.
- Phase E r1: m-1 to m-5; the visual r1 Minors.
- R3-4 to R3-8, R4-2, R4-3, and the extra `.work-list-region` tab stop.
- r5 m-1 and m-3.
- r6 logic Minor-1 to Minor-3:
  - a Tribunal Confirm in the stale window still answers on the old tab;
  - a null-marked-tab race;
  - the "switching" toast text in every refusal.
- Not yet in `future-enhancements.md`:
  - visual r6 m-1: the "switching" toast stays after the rebind;
  - visual r6 m-3: the idle dock hint is cut at 900 px high;
  - r7 Minor-5: start-failure text can end with an empty reason;
  - r7 Minor-6: prettier churn in `chat-message-handler.service.ts`.
- r7 Minors 1-4:
  - a stale `true` can arm a typed voice turn;
  - no cue when a send landed on the previous workspace or Enter is pressed while submitting;
  - a rejected argv workspace is dropped without a log, and the audit comment says "reported";
  - no spec for B3 or for the `statSync` adapter.
- A stale invalid workspace stays in existing profiles. Future visual reviews must capture the renderer
  console.

## Draft PR body

```markdown
## Summary

Adds the voice Command Center (Electron only): a page where you talk to or type to Ptah's head-of-engineering
persona, see owned work (children, CLI lanes, Tribunal runs) on a canvas scene and a text work list, and launch
Tribunal runs behind an explicit on-page Confirm.

- Chat runtime: persona `systemPrompt` on continue/resume/rewind, `commandCenterOrigin` tab marker, records
  service (last session, per-run Tribunal manifests), send lock and send-funnel guard, tab-explicit answers.
- New lib `@ptah-extension/command-center`: store, session coordinator with a stale-workspace guard, workspace
  binding, owned-work projection, status context, Tribunal roster validation and confirm gate (Amendment A1).
- Voice: VAD, sentence chunker, TTS playback queue, spoken-text filter, PCM capture via a same-origin
  AudioWorklet, voice loop with barge-in, status narrator.
- Scene and page: canvas renderer, sprite cache, overlay plates, HUD, pending-input card, work list, session
  controls, voice provider chip; Electron-only route, nav entry, Setup hub and dashboard cards, regular-chat
  lock banner.
- New narrow entries: `@ptah-extension/tribunal-panel/phase`, `@ptah-extension/tribunal-panel/discovery`,
  `@ptah-extension/ui/provider-brand-art`.
- Backend: the Electron argv workspace must be an existing directory; failed start and failed resume report
  different text; each CHAT_ERROR is logged once.

Reviews: every phase ends with an accepting code-logic review (codex implementers; grok or Anthropic
reviewers); style reviews APPROVED for the new public API (Phases B and D). Last visual review (r6) was
NEEDS_REVISION for one race (S-1), fixed in 4051af50c and closed by the r7 code review without a visual
re-check (user decision). Open Moderates and Minors are in
`.ptah/specs/TASK_2026_678_9083/future-enhancements.md`.

## Test plan

- [x] `command-center` tests 328/328 (page spec 18/18 after 836ca1548), typecheck, lint
- [x] `rpc-handlers` broadcaster spec 38/38; `chat` message handler + lifecycle specs 99/99;
      `ptah-electron` `initial-workspace-arg` spec 4/4; typecheck and lint for rpc-handlers, chat, ptah-electron
- [x] Scoped test/typecheck/lint for every other changed project before each batch commit (batches.md);
      `chat-state` 599/599 and `canvas` 371/371 at ee39c7311
- [x] Degradation audit unchanged (296)
- [x] Acceptance integration specs (B17) and the Tribunal confirm-gate spec (Amendment A1)
- [x] Dark and light visual reviews against the prototype in the dev Electron app (4 passes; last NEEDS_REVISION,
      its Serious fixed in 4051af50c with spec evidence only)
- [ ] Visual re-check after 4051af50c (workspace switch during an in-flight send)
- [ ] Mic latency, 30+ samples, cold worker and after barge-in (median, p95)
- [ ] Barge-in feel; speaker vs headset echo
- [ ] Scene FPS and p95 draw at N=24, 1280x720, integrated GPU, dark and light
- [ ] R4: no agent spawns during the Tribunal discovery turn or after Decline (real Confirm click)
- [ ] Baseline: refresh rate and STT/TTS provider pair
- [ ] Real OS microphone denial and settings recovery

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Gate 3 QA recommendation

**Recommend `senior-tester`.** Selecting row: **"ACs no test proves -> senior-tester."**

- AC20 and AC23 have no test at all; they are the deferred manual items.
- Several rows are only Partial at seams that a test can reach:
  - AC9: speech failure and retry;
  - AC14: all lifecycle states;
  - AC18: keyboard traversal;
  - AC21: delegated agent failure and retry.
- The AC5, AC12, AC15 and AC24 rows still carry stale "final run failed" wording.

Brief: write the missing automatable AC specs in `command-center`, rerun only that project, and refresh the
AC table in `test-report.md`. Leave the person-run B18 items marked as not measured.

Other rows:

- **New public API -> code-style-reviewer:** does not fire. Phase E changed no barrel, alias or secondary
  entry (checked with `git diff e4375e451^ HEAD`); the B and D API was style-APPROVED.
- **Logic not covered by the required review -> code-logic-reviewer:** fires narrowly, for `836ca1548` only
  (18 lines, the fix the reviewer prescribed, with a spec). Optional; a scoped delta check can run alongside.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Return TASK COMPLETE with labelled exceptions, not a block | block on 18.1 or on the missing APPROVED visual verdict | The user explicitly chose D34, D55 and D57; the team-leader cannot override user-reserved scope; each exception is stated here and in the PR body | yes |
| Parity N/A | require `parity-inventory.md` | `task-description.md:22` puts replacing an existing surface out of scope; no surface was replaced | yes |
| Gate 3 = senior-tester | logic review of `836ca1548`; skip | Automatable AC gaps and stale test-report rows; `836ca1548` is small and prescribed | yes |

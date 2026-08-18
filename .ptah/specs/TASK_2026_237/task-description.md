# Requirements Document — TASK_2026_237

**Title**: Wire Relay and Crucible into the Tribunal panel, with first-class phase/round state
**Type**: FEATURE
**Surfaces**: `libs/frontend/tribunal-panel` (primary), `libs/shared` (only if a new RPC namespace lands), `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/**` + `.github/skills/tribunal/` (doc re-sync), release process (publication)
**CLI delegation**: enabled, codex only — gated on TASK_2026_238 (see §8 Finding 2)

---

## 1. Problem statement

The tribunal skill documents **five** moves; the Tribunal panel offers **three**. `SKILL.md` lists council, forge, race, relay and crucible as all "available now" and ships full behavioural references at `references/relay.md` and `references/crucible.md`, but the panel does not know the last two exist: `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:4` declares `TribunalMove = 'council' | 'forge' | 'race'`, `wizard/step-pick-move.component.ts:83` renders exactly three cards, and `services/tribunal-run.service.ts:8-20` carries framing text for the same three. The two commits that added the missing moves (`3524c0479` Relay, `5cdb14d89` Crucible) touched markdown only — zero TypeScript. The gap is structural, not cosmetic: `TribunalRunService.prepare()` builds one tile per lane and fans them all out with one identical objective, `VendorLane` (`tribunal-ui.types.ts:6-15`) has **no role, phase or round field anywhere**, and the run view's entire status vocabulary is `idle | running | completed | failed` derived from `agent.status` (`tribunal-page.component.ts:250-263`). Relay is a **sequential four-phase pipeline with a pinnable per-phase roster**; Crucible is an **unequal executor/judge pair looping under a frozen rubric and a hard round cap**. Neither can be expressed by the current flat-panel wizard, and neither is observable in the current tile UI.

---

## 2. Scope (settled by the user — not open for re-litigation)

| Decision       | Answer                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Move set       | **Both** Relay and Crucible — five moves total                                                                     |
| UI depth       | **Full phase/round UI** — Relay phase progress and Crucible round + verdict are first-class state, not launch-only |
| Publication    | Settled in this document (§8, Finding 1). The tribunal plugin is not yet in any user's hands                       |
| CLI delegation | codex only, max 1 concurrent                                                                                       |

---

## 3. Functional requirements

Each requirement is independently testable. `AC` = acceptance criterion.

### FR-1 — The move set widens to five

**User story**: As a Ptah user opening the Tribunal wizard, I want to see all five moves the skill supports, so that Relay and Crucible are reachable without dropping to a chat prompt.

- **AC-1.1** `TribunalMove` (`types/tribunal-ui.types.ts:4`) includes `'relay'` and `'crucible'`. Every exhaustive `Record<TribunalMove, …>` in the lib is **completed**, not widened with a fallback — specifically `MOVE_PHRASE` and `MOVE_FRAMING` (`services/tribunal-run.service.ts:8`, `:14`) and `TURNS_PER_VENDOR` (`wizard/step-panel-preview.component.ts:35`). A `default:` arm or `??` escape hatch that silences the compiler on any of these is a defect: the exhaustiveness is the safety net that finds every site the widening touches.
- **AC-1.2** `step-pick-move.component.ts` renders five cards, each with a distinct icon and a one-line description faithful to `SKILL.md:50-58`. Relay and Crucible ship `enabled: true` — no "Coming soon" badge.
- **AC-1.3** Selecting Relay or Crucible advances the wizard, and the framing emitted by `TribunalRunService.buildTribunalFraming()` names the move and states its shape (Relay: sequential per-phase pipeline; Crucible: executor/judge loop under a frozen rubric).
- **AC-1.4** Council/Forge/Race behaviour is byte-identical for the same lane selection. A regression test pins the council framing string.

### FR-2 — Lane selection gains role assignment

The current lane step (`wizard/step-panel-preview.component.ts`) produces a **flat, order-insensitive set** of `VendorLane`s. Relay and Crucible both need _named roles_, and this is the single largest piece of work in the task.

**User story**: As a user convening a Relay, I want to name which vendor plans, architects, implements and reviews, so that the roster I designed is the roster that runs.

- **AC-2.1** `VendorLane` (or a wrapper type) carries a role discriminator. For Relay the vocabulary is exactly the four phases of `relay.md:45-50` — `plan | architect | implement | review`. For Crucible it is exactly `executor | judge` (`crucible.md:28-35`).
- **AC-2.2** For Relay, the wizard presents four **role slots**, each independently assigned a lane. The same vendor family may be assigned to two or more slots on **different models** — explicitly permitted by `relay.md:60` ("the same family may legitimately appear twice on different models … Take the user's assignment as given; do not re-pick it by family spread") and it MUST NOT be collapsed or de-duplicated.
- **AC-2.3** For Crucible, the wizard presents exactly two role slots — executor and judge — each independently assigned.
- **AC-2.4** **Relay constraint, enforced in the UI**: the review lane must not be the implement lane (`relay.md:84`). Identical lane (same family _and_ same model) in both slots blocks Next with a stated reason. Same-family/different-model is permitted but surfaces a visible warning that this is a weaker independence signal (`relay.md:85`).
- **AC-2.5** **Crucible constraint, enforced in the UI**: the judge must be a **different vendor family** from the executor (`crucible.md:37`, `:53`). Same-family selection blocks launch by default; if permitted at all it carries the same explicit weaker-signal warning. When discovery returns fewer than two available families the Crucible card is disabled with the reason from `crucible.md:55` ("no independent judge to be had") plus a link to provider settings.
- **AC-2.6** Council, Forge and Race keep the existing flat multi-lane picker unchanged, including the "same vendor multiple times" affordance and the `TRIBUNAL_MAX_VENDOR_TILES` cap (`services/tribunal-state.service.ts:26`).
- **AC-2.7** The framing prompt for Relay/Crucible states each lane's role **explicitly**, so the conductor never infers it. This closes the documented guess at `crucible.md:51` — "the **first** lane is the executor and the **last** is the judge unless the user said otherwise — confirm that reading before spending a call". An explicit role token removes both the confirmation round-trip and the risk of a loop running backwards with the cheap lane judging the strong one.
- **AC-2.8** Any change to the explicit-panel line format is mirrored into `references/vendor-panel.md` §0, which is the contract the conductor actually reads (currently `[tribunal:<laneId>] <displayName> — ptah_agent_spawn({ <spawnArgs> }). <objective>`). The panel and the skill must not disagree about the wire format.

### FR-3 — Crucible rubric input and round cap

**User story**: As a user convening a Crucible, I want to state the quality bar and the number of rounds I am willing to pay for before anything spawns, so that the loop is bounded and the judge grades what I actually care about.

- **AC-3.1** The Crucible path adds a rubric step: free-text input for 3–7 criteria. The UI states the `crucible.md:59` shape — each criterion needs a **binary pass condition** and a **how to check it** — and offers the default criteria table from `crucible.md:61-71` as a prefilled, editable starting point.
- **AC-3.2** A round-cap control defaults to **2 revise rounds** and does not allow more than 2 at launch, per `crucible.md:3` and `:113` ("A 3rd round only on the user's explicit say-so; never a 4th"). A 3rd round stays a mid-run conductor decision, never a launch-time setting.
- **AC-3.3** The pre-launch cost estimate reflects each move's real shape. Crucible is **2 paid calls per round** (`crucible.md:74`, `:117`). Relay is **per phase, not per lane** — four phases, one paid call each (`relay.md:116`). The existing `estimatedTurns` formula (`step-panel-preview.component.ts:320-323`) multiplies lane count by a per-move constant and is wrong for both; it **changes shape** rather than gaining two map entries.
- **AC-3.4** The rubric text reaches the conductor verbatim, and the framing instructs the conductor to write it to `rubric.md` in the spec folder **before the first spawn** and freeze it after round 1 (`crucible.md:57`, `:73`). The panel does not write `rubric.md` itself — frontend libs have no filesystem access (NFR-2).
- **AC-3.5** Launch is blocked with a stated reason when the rubric is empty. A rubric outside 3–7 criteria warns but does not block.

### FR-4 — Relay phase progress is visible

**User story**: As a user watching a Relay, I want to see which phase is running, which lane owns it, and which phases are done, so that I can tell a working pipeline from a stalled one without reading raw agent output.

- **AC-4.1** The run view shows a four-step phase indicator — plan → architect → implement → review — each step labelled with its assigned lane's display name and its deliverable filename from `relay.md:45-50` (`task-description.md`, `implementation-plan.md`, `tasks.md`, `code-logic-review.md`).
- **AC-4.2** Each phase renders exactly one of `pending | running | complete | failed`. Exactly zero or one phase is `running` at any time — Relay is sequential (`relay.md:16`), so two concurrent `running` phases is a state the UI must be structurally unable to display.
- **AC-4.3** Phase state is derived from a defined data source (the choice belongs to the architect — §9 Q1), never from regexing prose out of the conductor's chat transcript.
- **AC-4.4** When a phase completes, its deliverable path is shown and openable. When a lane fails twice and its phase is reassigned (`relay.md:136`), the indicator shows the reassignment rather than silently swapping the lane name.
- **AC-4.5** The panel degrades honestly: if progress data never arrives, the indicator shows "phase progress unavailable" rather than an all-`pending` pipeline that falsely implies nothing has happened. The vendor tiles keep working regardless.

### FR-5 — Crucible round and verdict are visible

**User story**: As a user watching a Crucible, I want to see the round number, the judge's verdict, and why it was not a PASS, so that I can decide whether to authorise a third round.

- **AC-5.1** The run view shows the current round number and the cap (e.g. "Round 2 of 2").
- **AC-5.2** The verdict renders as exactly one of `PASS | REVISE | REJECT` — the three values of the judge output contract at `crucible.md:82` — each visually distinct. An unparsed or missing verdict renders as "awaiting verdict", **never** as a default `PASS`.
- **AC-5.3** On `REVISE`, the defect list renders each defect's severity (`blocking | major | minor`) and its `file:line` citation, per the `D1 [severity] <file:line> — what is wrong — what correct looks like` contract at `crucible.md:90`. Defects with no `file:line` are **not** rendered — the Conductor drops them (`crucible.md:145`) and the UI must not resurrect them.
- **AC-5.4** The mentor note (`crucible.md:94`) is displayed with the round it belongs to.
- **AC-5.5** On `REJECT`, the UI states the loop stopped and the approach is not being patched (`crucible.md:100`). It must not present REJECT as a revisable round.
- **AC-5.6** Terminal states are distinguishable and honestly labelled: `PASS` (noting the Conductor still verifies against the build — `crucible.md:151`, "the judge's PASS is an opinion; the build is the fact"), cap reached at `REVISE` with open defects, regression stop (`crucible.md:154`), and `REJECT`.
- **AC-5.7** All judge-authored text (defect descriptions, mentor note) renders through `libs/frontend/markdown` or as interpolated plain text. No `[innerHTML]` — NFR-4.

### FR-6 — Run-view state model

- **AC-6.1** `TribunalSlice` (`services/tribunal-state.service.ts:41-47`) gains the phase/round/verdict state and stays inside the existing per-workspace slice map, so workspace switching, the bootstrap-sentinel migration (`:372-390`) and the removed-workspace cleanup (`:133-139`) behave identically for the two new moves.
- **AC-6.2** The existing lane-to-agent binding by `[tribunal:<laneId>]` tag (`:441`) keeps working for Relay/Crucible lanes, including the late-panelist reconciliation path (`:297-352`).
- **AC-6.3** Relay's four role slots and Crucible's two fit within `TRIBUNAL_MAX_VENDOR_TILES` (8) and the 3-column tile layout (`:445-453`) renders them without overlap. A dedicated layout for a 4-slot pipeline or a 2-slot pair is a design decision (§9 Q5), not a cap change.
- **AC-6.4** `Close Tribunal` (`tribunal-page.component.ts:203`) fully resets the new state; a subsequent run of a different move starts clean with no residual phase, round or verdict.

### FR-7 — Tests

- **AC-7.1** Unit tests cover the widened move set, both role-constraint validations (AC-2.4, AC-2.5), the reshaped cost estimator (AC-3.3), verdict parsing including the malformed/missing case (AC-5.2), and defect filtering by missing `file:line` (AC-5.3).
- **AC-7.2** The framing strings for all five moves are pinned by snapshot-style assertions — they are a wire contract with the skill, not cosmetic copy.
- **AC-7.3** `nx test tribunal-panel`, `nx lint tribunal-panel` and `nx typecheck tribunal-panel` green. Any new shared type also passes `nx affected -t typecheck`.

---

## 4. Non-functional requirements and constraints

### NFR-1 — Angular

Angular 21 signals + `inject()`. `ChangeDetectionStrategy.OnPush` mandatory on every new component — the lib is currently 100% compliant, do not be the first exception. New state lives in signals/`computed`, never in mutable component fields read from the template.

### NFR-2 — Architecture boundaries

`libs/frontend/tribunal-panel` MUST NOT import any `libs/backend/**` lib, and backend libs must not import it. `libs/shared` is the only bridge. All backend access goes through `ClaudeRpcService`, as `TribunalDiscoveryService` already does (`services/tribunal-discovery.service.ts:100`, `:126`, `:141`). No filesystem access from the frontend — the conductor writes `rubric.md`, `round-N-judge.md` and the Relay deliverables.

### NFR-3 — RPC dual-registration

If the chosen progress data source (§9 Q1) introduces a **new RPC namespace**, it requires BOTH:

1. the compile-time declaration in `libs/shared/.../rpc.types.ts`, and
2. the runtime guard entry in `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`.

Missing the second is a silent runtime crash, not a type error. If the design reuses an existing namespace (e.g. `agent:*`), this requirement is satisfied by inspection and the implementation plan must say so explicitly rather than leaving it unaddressed.

### NFR-4 — XSS

No `[innerHTML]` on any agent- or judge-authored string. Markdown routes through `libs/frontend/markdown` (the single DOMPurify chokepoint); anything else renders as interpolated text.

### NFR-5 — Type safety

TypeScript strict. `catch (error: unknown)` narrowed with `instanceof Error` before `.message` — the pattern already in place at `tribunal-discovery.service.ts:108-113`. No `any`. No `@ts-ignore` without `@ts-expect-error` plus a reason.

### NFR-6 — Marketplace scanner

Changes under `apps/ptah-extension-vscode/assets/plugins/**` stay excluded from the VSIX by `.vscodeignore`. TypeScript in `libs/frontend/**` compiles to bundled JS and is not scanned, so vendor names in TS are safe. Do not add trademarked vendor names (`copilot`, `codex`, `claude`, `openai`, `anthropic`) to any new non-JS file that could enter the VSIX.

### NFR-7 — Cost honesty

Every pre-launch estimate is labelled an estimate, consistent with the existing disclaimer (`step-panel-preview.component.ts:153-156`). Crucible and Relay estimates must not understate — both spend real paid vendor calls per round/phase.

### NFR-8 — Concurrent-agent checkout safety

The working tree carries unrelated WIP (`apps/ptah-electron/project.json`, `package.json`, `apps/ptah-video-studio/**`, `scripts/reset-ptah-dev-profile.sh`). Implementers touch only files in this task's scope, **stop and report** on out-of-scope failures rather than fixing neighbouring WIP, and never bypass hooks with `--no-verify`.

---

## 5. Stakeholders

| Stakeholder     | Impact | Success criterion                                                          |
| --------------- | ------ | -------------------------------------------------------------------------- |
| Ptah end user   | High   | Can launch Relay and Crucible from the panel and watch them progress       |
| The Conductor   | High   | Receives an unambiguous role-tagged panel; never guesses executor vs judge |
| Dev team        | Medium | `tribunal-panel` stays within its boundary; no backend import creeps in    |
| Release process | High   | The five-move skill actually reaches users (§8 Finding 1)                  |

---

## 6. Risks

| Risk                                                                              | P    | Impact   | Mitigation                                                                                  |
| --------------------------------------------------------------------------------- | ---- | -------- | ------------------------------------------------------------------------------------------- |
| Progress data source proves unreliable, leaving the phase UI permanently blank    | Med  | High     | AC-4.5 mandates an explicit "unavailable" state; choose the source at §9 Q1 with a fallback |
| Panel and skill disagree on the explicit-panel line format once roles are added   | Med  | High     | AC-2.8 — update `vendor-panel.md` §0 in the same change                                     |
| `content-manifest.json` stale, so Crucible silently never reaches users           | High | Critical | §8 Finding 1 — this is the live state today, not a hypothetical                             |
| **Codex spawn ENOENT — confirmed branch defect, gates codex-only CLI delegation** | High | High     | Filed as **TASK_2026_238** with the fix identified; must land before codex-lane QA          |
| Widening `TribunalMove` breaks exhaustive maps elsewhere in the monorepo          | Low  | Med      | `nx affected -t typecheck`; AC-1.1 forbids papering over with a `default:` arm              |
| `FULL_AUTO_DIRECTIVE` conflicts with the two moves' mandatory user gates          | Med  | Med      | §9 Q2 — must be resolved before implementation                                              |

---

## 7. Publication requirement — how `ptah-core` actually reaches users

**The mechanism.** `ContentDownloadService` (`libs/backend/platform-core/src/content-download.service.ts`) fetches a single manifest from a URL hardcoded to the **`main` branch**:

```
https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json
```

(`content-download.service.ts:79-80`). It then downloads **only the files that manifest enumerates**, one by one, from `{baseUrl}/{basePath}/{file}` (`:333`), into `~/.ptah/plugins/` (`:84`); templates go to `~/.ptah/templates/agents/`. It is called non-blocking on activation in all three runtimes — `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:50`, `apps/ptah-electron/src/activation/wire-runtime.ts:171`, `libs/backend/cli-engine/src/lib/container.ts:655` — so VS Code, Electron and the CLI share one path.

**Invalidation** is by `contentHash`: the service compares the manifest hash against `~/.ptah/.content-cache.json` and returns early from cache on a match (`:187-198`). Files present locally but **absent from the manifest are deleted** by `pruneStaleFiles` (`:200-201`, `:265-275`).

**Publication is therefore a RELEASE-PROCESS step, not a code change** — the manifest is read at runtime, so skill content ships independently of the VSIX, the Electron build and the CLI package. But the process is currently broken; see §8 Finding 1 for the defect and its repair steps.

---

## 8. First-class findings

### Finding 1 — Publication defect: Crucible cannot reach any user today (BLOCKING)

Three compounding facts, each verified:

1. **`content-manifest.json` omits `crucible.md`.** Lines 86-91 of the repo-root manifest enumerate `ptah-core/skills/tribunal/SKILL.md` plus `council.md`, `forge.md`, `race.md`, `relay.md` and `vendor-panel.md` — and stop. The manifest's `generatedAt` is **2026-08-09**, predating the crucible commit `5cdb14d89`. Consequence: even after this branch merges to `main`, **Crucible would never download**, and `SKILL.md` would arrive on user machines advertising a reference file that is not there.
2. **`pruneStaleFiles` makes it actively destructive, not merely absent.** Because the service deletes any local file not listed in the manifest (`:265-275`), a user who obtained `crucible.md` by any other route would have it **removed** on the next activation.
3. **Regeneration is entirely manual and unenforced.** `scripts/generate-content-manifest.js` exists and is correct (walks `apps/ptah-extension-vscode/assets/plugins`, hashes, writes the manifest — `:51-99`), and its own header says "Run before each release". But it is referenced by **no npm script** in the root `package.json` and by **none of the 16 workflows** in `.github/workflows/`, including `publish-extension.yml`. Nothing enforces it. The stale manifest in fact 1 is the predictable result of fact 3, and it will recur on the next skill edit.

**Repair steps (required for this task to deliver user-visible value):**

- **Step 1** — run `node scripts/generate-content-manifest.js` and commit the regenerated `content-manifest.json`. Verify `ptah-core/skills/tribunal/references/crucible.md` appears in the `plugins.files` array and that `contentHash` changed.
- **Step 2** — merge to `main`. `ContentDownloadService` reads `main` and only `main`; work on `ak/tui-defects` is invisible to every user until it lands there.
- **Step 3 (verification)** — on a clean profile, delete `~/.ptah/.content-cache.json` and `~/.ptah/plugins/ptah-core/`, launch, and confirm `~/.ptah/plugins/ptah-core/skills/tribunal/references/crucible.md` exists on disk. No extension re-publish, no Electron release and no CLI release is required.

**CI wiring is a SEPARATE DEVOPS TASK.** Wiring `generate-content-manifest.js` into CI — as a `prepublish`-style step, or as a check that fails when the committed manifest differs from a fresh regeneration — fixes the _class_ of defect rather than this instance. It touches CI and release plumbing, not the panel, and must not be absorbed into this feature task. File it separately; treat it as a known follow-up, not an optional nicety.

### Finding 2 — Codex spawn ENOENT: filed as TASK_2026_238 (PREREQUISITE)

The codex lane spawned for this task's investigation failed immediately with exit code 1:

```
[Codex SDK Error] spawn C:\Users\abdal\AppData\Local\Programs\Ptah\resources\app.asar\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe ENOENT
```

Verified as a real bug on this branch — not environmental, not a stale host build. `codex-cli.adapter.ts:228-235` hardcodes a `vendor/<triple>/codex/` path segment; the binary ships at `vendor/<triple>/bin/codex.exe`. Every candidate misses, `codexPathOverride` is never set (`:475-478`), and the SDK self-resolves — which works against a real `node_modules` tree but fails from a packaged asar build.

**Filed separately as TASK_2026_238**, with root cause, fix and verification steps in that task's `context.md`. It **gates the codex-only CLI delegation mode chosen for this task** and must land before any codex-lane QA of Relay or Crucible. Not implemented as part of the panel changes in §3.

---

## 9. Open technical questions for the architect

Enumerated with trade-offs. **Not decided here.**

### Q1 — Where does phase/round/verdict state come from? (the load-bearing question)

Today the conductor is the only party that knows what phase or round it is in. The panel sees only spawned-agent tiles bound by the `[tribunal:<laneId>]` tag (`tribunal-state.service.ts:441`), and `MonitoredAgent` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:66-96`) exposes `task`, `status`, `stdout`, `segments`, `streamEvents` and `streamRevision` — no structured progress channel of any kind.

**Option A — extend the lane tag** (e.g. `[tribunal:<laneId>:<phase>]`, or a second tag alongside it).
_For_: zero backend change; reuses the regex already in place at `:441`; rides the existing framing mechanism; works today.
_Against_: the tag is baked into a lane's spawn prompt **at spawn time**, so it can express _which phase this lane owns_ but **cannot** express a round number or a verdict that only comes into existence after the judge replies. Parsing prompt text is a fragile contract, and a conductor that alters or drops the tag loses all progress silently, with no error surface. Covers FR-4 partially and FR-5 not at all.

**Option B — a dedicated backend event / RPC namespace** the conductor writes to via an MCP tool (e.g. `tribunal:progress`).
_For_: fully typed structured state; phase, round, verdict, defects and mentor note are all expressible; survives session boundaries; the natural home for FR-5 in its entirety.
_Against_: the largest new surface — needs the RPC dual-registration of NFR-3, a new MCP tool the conductor must be instructed to call, and backend work in a task that is otherwise frontend-only. Reliability shifts to prompt compliance at _every_ state transition, not just at spawn.

**Option C — read the spec-folder artifacts.**
_For_: the skill **already mandates** these files and their exact format, so this adds **zero** new conductor obligation. Relay writes `task-description.md` / `implementation-plan.md` / `tasks.md` / `code-logic-review.md` (`relay.md:45-50`); Crucible writes `rubric.md` and `round-N-judge.md` under a strict `## VERDICT` / `## SCORES` / `## DEFECTS` / `## MENTOR NOTE` contract (`crucible.md:79-96`). The round number is in the filename; verdict, defects and mentor note are parseable from a format the judge is _already required_ to produce. `libs/backend/task-specs` already reads `.ptah/specs/`.
_Against_: needs an RPC (and probably a file watch or poll) since the frontend cannot read files; resolution is per-phase-completion, so there is no in-flight "phase 3 is 40% done" signal; and it needs the spec-folder path, which the panel does not currently create or know (Q3).

**Option D — parse the conductor's own stream** (`streamEvents` / `segments`, already in `AgentMonitorStore`).
_For_: no new plumbing whatsoever.
_Against_: natural-language parsing against no contract; brittle across models and phrasings. **Not recommended as a primary source**; possibly acceptable as a last-resort enrichment.

**Hybrid worth evaluating — C + A**: Option C for authoritative phase/round/verdict (the artifacts are ground truth and already contractual, and it is the only option that gets FR-5's defect list for free) combined with Option A for "which lane is live right now" (cheap, and the tag already exists). The architect should weigh whether the hybrid's two mechanisms cost more than Option B's single typed channel, given that B's reliability rests entirely on prompt compliance while C's rests on files the skill already mandates.

### Q2 — Autonomy vs mandatory gates (must be settled before implementation)

`TribunalRunService` injects `FULL_AUTO_DIRECTIVE` — "Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions" (`tribunal-run.service.ts:22-23`). This **directly contradicts** both new moves:

- Relay (`relay.md:140`): "CLI lanes cannot ask the user — **you** run every gate, exactly as orchestration", with mandatory checkpoints after `task-description.md` and `implementation-plan.md` before the next phase is relayed.
- Crucible (`crucible.md:153`): a 3rd revise round runs "**only if the user asks for it** — never a 4th, and never a 3rd on your own initiative".

Options: (a) suppress `FULL_AUTO_DIRECTIVE` for Relay/Crucible and let the conductor gate in the conductor chat pane; (b) keep full-auto and have the panel itself render the checkpoint as a UI approval; (c) make it a wizard toggle with a stated default. This changes the framing prompt and possibly the run view, so it cannot be deferred to implementation time.

### Q3 — Who allocates the `.ptah/specs/TASK_[ID]` folder?

Both moves persist to a spec folder (`relay.md:36-43`, `crucible.md:117`, `:162-172`), with the ID coming from a folder scan. If the panel needs to _read_ those artifacts (Q1 Option C), it needs the path. Either the panel allocates the folder before launch and passes it in the framing, or the conductor allocates it per the skill and the panel discovers it afterwards. The first is deterministic but puts spec-folder allocation in the frontend (via RPC); the second keeps the skill authoritative but leaves the panel guessing which folder belongs to this run.

### Q4 — Does the panel depend on the skill being installed?

The current framing is self-contained in shape — it names the move and lists explicit lanes — but carries only a one-sentence `MOVE_FRAMING`; it does **not** embed the protocol. For Council that is survivable. For Crucible, the defect contract, the round cap, the regression stop and the "judge never edits code" rule all live in `crucible.md`, and a conductor without the skill installed will not follow any of them. Options: (a) the panel embeds the essential protocol in the framing (heavier prompt, works even when the plugin has not downloaded); (b) the panel relies on the skill being present and detects/warns when it is not. Given §8 Finding 1, this choice determines how hard the publication defect blocks the feature.

### Q5 — Layout for non-flat moves

`slotFor()` (`tribunal-state.service.ts:445-453`) lays tiles out in a 3-column grid, which suits a peer panel. A 4-phase sequential pipeline and a 2-lane executor/judge pair may want different arrangements (left-to-right pipeline; side-by-side pair). Is a per-move layout in scope, or does the existing grid plus a phase indicator suffice?

---

## 10. Recommendation on the doc divergence

Confirmed on disk:

| Copy                                                                              | Tribunal references present                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/` | council, **crucible**, forge, race, relay, vendor-panel (6)       |
| `.github/skills/tribunal/references/`                                             | council, forge, race, relay, vendor-panel (5 — no crucible)       |
| `apps/ptah-docs/src/content/docs/tribunal/`                                       | council, forge, race, relay, index (no crucible, no vendor-panel) |

**Recommendation: split by consequence, and do not bundle either into the main implementation batch.**

- **`.github/skills/tribunal/` — re-sync INSIDE this task**, as its own small batch, **before implementation starts**. This is the dev-side copy that agents working in this repo actually read. Leaving it four-move means every agent — including the ones implementing this very task — reads a spec that does not describe Crucible. It is a file copy plus a diff review, not design work. Cheap, and it removes a live source of confusion from the task's own execution.
- **`apps/ptah-docs/src/content/docs/tribunal/` — FOLLOW-UP task.** Public documentation is a genuine writing job, not a copy: it needs a Crucible page, an `index.md` update, Starlight sidebar wiring, and the hardcoded-vendor-list cleanup that `5cdb14d89` set out to do and only half-completed. Doing it here would pull `technical-content-writer` into a frontend feature task and risk publishing docs for a UI that has not shipped. Sequence it _after_ the panel lands so the docs describe the actual UI.
- The manifest regeneration in §8 Finding 1 is **not** part of either — it is a release step, required regardless of both.

---

## 11. Out of scope

- **Changing the behaviour of the five moves.** `SKILL.md`, `relay.md` and `crucible.md` are the authority; this task makes the panel match them, not the reverse. Any perceived defect in the moves themselves is a separate task.
- **Council, Forge and Race functional changes.** Touched only where a widened type or a reshaped estimator forces it; behaviour pinned by regression tests (AC-1.4).
- **A sixth move**, or a generic user-defined move framework.
- **Public docs rewrite** (`apps/ptah-docs/src/content/docs/tribunal/`) — follow-up per §10.
- **CI automation for `generate-content-manifest.js`** — separate DEVOPS task per §8 Finding 1.
- **The codex/opencode adapter path fix** — filed as TASK_2026_238. A prerequisite, but its own unit of work.
- **Backend Relay/Crucible orchestration.** The conductor already implements both moves via the skill. This task does not reimplement them in TypeScript; it configures and observes them.
- **Persisting tribunal runs across app restarts.** State stays in-memory per workspace slice.
- **Electron-only or VS Code-only variants.** `tribunal-panel` is shared; whatever ships, ships everywhere it is mounted.

---

## 12. Definition of done

- [ ] Five move cards, all enabled, all launchable
- [ ] Relay: four role slots, pinnable, same-family-different-model permitted, implement != review enforced
- [ ] Crucible: executor/judge slots, cross-family enforced, rubric input, round cap of 2
- [ ] Cost estimates reshaped per move (not per lane) for Relay and Crucible
- [ ] Relay phase indicator with per-phase lane, status and deliverable path
- [ ] Crucible round counter, verdict, defect list with `file:line`, mentor note
- [ ] Honest degradation when progress data is unavailable
- [ ] No backend imports in `tribunal-panel`; RPC dual-registration done if a namespace was added
- [ ] No `[innerHTML]` on agent/judge output
- [ ] `nx test|lint|typecheck tribunal-panel` green; `nx affected -t typecheck` green
- [ ] `.github/skills/tribunal/` re-synced to six references
- [ ] `content-manifest.json` regenerated and containing `crucible.md`; merged to `main`; verified on a clean profile
- [ ] TASK_2026_238 (codex adapter path fix) landed before codex-lane QA of Relay/Crucible
- [ ] CI-wiring follow-up filed as a DEVOPS task

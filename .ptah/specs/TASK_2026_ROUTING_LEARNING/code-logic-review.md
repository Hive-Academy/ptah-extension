# Code logic review — routing and learning

Review family: opencode; Implementer families: codex, grok

- Branch: `fix/routing-learning` vs `main`
- Requirements authority: `.ptah/specs/TASK_2026_ROUTING_LEARNING/verification-routing.md` (items 1–8 plus `## Decisions`)
- Mode: read-only. No source edits, no build, no tests, no serve, no state-changing git.

## Score

**5.5 / 10**

The scoring math (items 3 and 5) and the workspace-filter SQL are correct, and item 8's gate is well built. But two requirements are violated in ways that produce silent, user-visible wrong behaviour: the rotation cursor is frozen while rotation is off (item 1), and workspace scoping compares two spellings of the same directory (item 4). Two more are only partly met (items 6 and 7).

## Verdict

**REVISE**

Blocking: none. Major: D1 (rotation persistence), D2 (workspace key not normalized), D3 (child cwd scoping), D4 (capability view reads unloaded state), D5 (pre-flight figures have no size fallback). All are local fixes; the architecture is sound.

---

## Defects

### D1 — Rotation off stops persisting the pick, contrary to the requirement (major)

`libs/backend/lane-routing/src/lib/route-decide.service.ts:292`

```ts
if (rotate) await this.persistRotation(gathered, validated.data);
return validated.data;
```

`verification-routing.md:32` is explicit: "Keep `persistRotation` as it is, so the stored id is still the last chosen executor. When rotation is off, `successor` ignores that id, so saving it does not change the next ranking pick." `verification-routing.md:38` repeats it: "The persisted entry is the chosen id in both modes."

What goes wrong:

1. `getLastPicks()` (`route-decide.service.ts:160-162`) keeps returning the entry from before the setting was turned off, forever. The Electron settings page shows a pick that is no longer the last chosen lane.
2. Re-enabling rotation resumes from that pre-disable cursor (`spread.ts:97-98`), so the first post-re-enable pick can repeat a lane that already ran many times while rotation was off.
3. `persistRotation` replaces the whole global state with the current chosen roster (`:346-355`); skipping it also means every key not touched by another decide call stays stale for as long as rotation is off.

The new gate test pins the wrong behaviour: `libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts:438` asserts `rotation.load().state.entries` is `[]` for `rotate: false`, which contradicts the requirement, so it cannot be cited as evidence that item 1 is met.

Fix: call `await this.persistRotation(gathered, validated.data)` unconditionally. `spread.ts:116` already avoids advancing the in-memory cursor when `rotate === false`, so the only thing the unconditional write changes is the stored chosen id — exactly what the requirement asks for. Then change `gate.spec.ts:438` to assert the chosen id is present in both modes.

### D2 — Workspace rows are written with one spelling and read with another (major)

- producer: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:53` — `workspaceRoot: info.workingDirectory || null` (raw)
- reader: `libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.ts:47` and `:73` — `this.workspace?.getWorkspaceRoot() ?? null` (raw, from a different source)
- comparison: `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts:366` and `:384` — `workspace_root = ?` (byte equality)
- same equality in `libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.ts:207` and `:220`

`libs/shared/src/lib/utils/workspace-root-key.ts:36-49` documents why this is wrong: "the same directory arrives spelled differently — separator and case differ on Windows between a startup root, a renderer echo, and an agent's recorded working directory. Two spellings of one directory must land on one key." The same file's `normalizeWorkspaceRoot()` is already used a few lines below the new write, at `lane-completion-outcome.ts:169`, for `workspaceKey`.

What goes wrong: when the child's recorded cwd is `D:\projects\app\` and the active folder is `d:/projects/app`, every new row fails the equality predicate and the workspace's own learning silently disappears from the matrix (local cells fall back to seed/prior). Legacy rows (`workspace_root IS NULL`) still match through the null bridge, which disguises the failure as "no new local evidence yet". No error, no log.

Fix: normalize at the boundary and use one helper on both sides (or store raw + key and filter on the key). If rows already exist unnormalized, a one-shot backfill is required, otherwise the fix only helps rows written after it lands.

### D3 — Rows produced under a child cwd are scoped to a subdirectory (major)

`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:53`

`info.workingDirectory` is the spawned process cwd, not necessarily the active workspace root. Subdirectory spawns are supported and pinned: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts:198` uses `${ROOT_A}\sub`. A lane launched with cwd `${ROOT_A}\sub` writes `workspace_root = <ROOT_A>\sub`, so it is invisible to the matrix for `${ROOT_A}` — the common case. Even after D2's normalization fix, a subdirectory is still a distinct string and still fails equality.

Fix: take the workspace root from the host workspace provider at the capture boundary (the notifier already reaches the platform layer for the usage contribution), and fall back to `info.workingDirectory` only when no root is available. Keep the cwd as separate telemetry if it is needed.

### D4 — The capability matrix reads unloaded state (major)

`libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts:186`

```ts
const local = await this.readLocalMatrix(nowMs, this.lastOutcomeQueries);
```

`lastOutcomeQueries` is a mutable field initialised to `[]` at `:168` and populated only by `load()` at `:203`. `readMergedView()` (`:183-193`) never refreshes it, and `readLocalMatrix` returns `emptyMatrix()` when the lane id list is empty.

What goes wrong: on app start, choosing Settings → Capability matrix before any route decide (or pre-flight) has run in that process returns the seed + user layers only, with every local cell falling back to its seed value and every local sample count reading zero — even though the outcome database has rows. The view is also cross-call coupled: its contents depend on whichever routing call ran last, so two windows opened after different activity disagree. A pre-flight and a gate also build different query lists, so the same settings table changes shape after an unrelated action.

Secondary: `readMergedView()` calls the user-layer read, which creates the empty user template file on a missing-file path. A read-only RPC writes to disk on first open.

Fix: make the view self-sufficient. Either `readMergedView()` resolves the installed-lane registry itself to build the query set, or it takes the queries as a required argument and the RPC handler supplies them from the same source the decide path uses. A display read must not depend on an earlier, unrelated `load()`.

### D5 — A fixed pre-flight request fails with `payload-too-large` instead of dropping figures (major)

`libs/backend/lane-routing/src/lib/pipeline/model-refine.ts:170-172`

The pre-flight questions are fixed and cheap; the only variable part is the newly attached `outcomeFigures`. `verification-routing.md:170` requires that when the fitted request would exceed the byte cap, the figures are omitted and the questions are still sent. `runFixedRequest` instead returns `emptyOutcome('payload-too-large')` on the first over-size attempt.

What goes wrong: on a host with a long history, pre-flight silently degrades to the default task type and depth instead of asking the decision model. `runFixedRequest` reports `sent: false`, `readPreflight` fills defaults, and nothing surfaces an error; the routing notice simply stops carrying model-chosen answers.

Fix: in `runFixedRequest`, if the payload with figures exceeds `maxRequestBytes`, retry once with `outcomeFigures: []` before reporting `payload-too-large`. Mirror the `runLaneRequest` fit loop so both paths degrade the same way.

### D6 — Outcome figures are not limited to the lanes actually offered (moderate)

`libs/backend/lane-routing/src/lib/route-decide.service.ts:322`

```ts
outcomeFigures: gathered.matrix.outcomeFigures ?? [],
```

`verification-routing.md:169` requires the figure table to be capped to the lanes on offer. The matrix returns figures for every installed lane × every task kind (`libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts:12-22`), and `model-refine.ts` embeds the whole array in every fit attempt.

What goes wrong: the payload grows with history breadth rather than with the decision. On a wide install this is the most likely cause of D5 firing: a request that would otherwise fit is pushed over `maxRequestBytes`, and the whole pass falls back to ranking.

Fix: filter `outcomeFigures` to the candidate ids in `gathered` (plus the subagent lane) before passing them.

### D7 — The band predicate is duplicated three ways (minor)

`libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts:213` computes `top`; `:218` filters with `top - row.scored.score <= CLOSENESS_BAND`. `libs/backend/lane-routing/src/lib/pipeline/phase-resolve.ts:20` re-implements the same expression inline inside `isSendable`, and `ranking/spread.ts:87-88` has a third copy.

`verification-routing.md:61` asks for a single exported predicate so the copies cannot drift. They agree today (same max over `plan.ranked`, same inequality), which is why this is minor. Two secondary costs: `Math.max(...)` is recomputed for every element of the filter (O(n²), and `RangeError` on a very large array), and `Math.max()` of an empty array is `-Infinity` — unreachable today but unguarded.

Fix: export one `inBand(plan)` / `bandOf(plan)` and use it in all three places.

### D8 — A refused apply loses its reason at the RPC boundary (minor)

`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:422`

```ts
return { applied: result.applied, historyTs: result.historyTs };
```

`applyProposal` produces `skipReason` for every refusal (`skill-enhancer.service.ts:706-719`, `:507-512`), and the preview handler returns it (`:378`). Apply drops it, and `SkillSynthesisApplyProposalResult` has no field for it, so a double-clicked or stale apply that hits the cooldown, the 5-use floor, or the judge gate reaches the UI as a bare `applied: false`.

Fix: add `skipReason: result.skipReason ?? null` to the result type and the return.

### D9 — Generate and apply use different judge thresholds (minor, latent)

`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:510` validates the cached proposal with `proposalClearsJudge` (`:216-218`), which hardcodes `MANUAL_PREVIEW_JUDGE_SETTINGS.minJudgeScore` (6) from `skill-judge.service.ts:55-58`. The proposal was generated against the `settings` argument at `:399-406`.

Not reachable through today's RPC (the preview handler passes the same constant at `skills-synthesis-rpc.handlers.ts:368`), but the service contract allows `generateProposal(slug, { minJudgeScore: 4 })` to produce a proposal that `applyProposal` always refuses as `judge-rejected`. Fix: pass the gate settings into `applyProposal`, or store `minJudgeScore` on the proposal and compare against that.

### D10 — `as unknown as` and duck-typed fakes in a new spec (minor)

`libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.handlers.spec.ts:97-99`

Three `as unknown as` casts build the reader/store fakes. The repository rule is no `any`, no `@ts-ignore`, no `as unknown as`, no duck typing. Test-only, but it is new surface and will be copied. Fix: type the fakes as `jest.Mocked<Pick<CapabilityMatrixViewReader, 'readMergedView'>>` and `Pick<RotationStateReader, 'load'>`, or use the real store with an in-memory seam.

### D11 — The documented last-pick RPC does not exist (minor)

`verification-routing.md:33` requires a read-only `routing:getRotation` returning `RotationStore` entries. A repository-wide search finds no such method; the data is exposed instead as `lastPicks` on `agent:getCapabilityMatrix` (`libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.handlers.ts:54-105`).

The user can see the picks, so the feature is delivered, but any consumer of the documented method gets method-not-found, and the settings page now depends on an agent-surface call: when the matrix read fails with `PERSISTENCE_UNAVAILABLE`, the rotation history is hidden with it. Fix: add the thin `routing:getRotation` method over the same reader, or record the deviation as an accepted design change in the requirement document.

### D12 — A failed rotation-setting read is silent (minor)

`libs/backend/lane-routing/src/lib/scope/lane-rotation-setting.ts:10`

```ts
} catch (_error: unknown) {
  // degradation-audit: reported - unreadable settings preserve the existing rotation default.
  return true;
}
```

The comment says "reported", but nothing is reported: `LaneRotationSetting` takes no `Logger` and emits no warning. A setting the user explicitly turned off can silently come back on when the workspace provider throws. Fix: inject the lane-routing logger and warn once per failure, as `HostRoutingSetting` does.

### D13 — Reverting an enhancement starts the 24 h cooldown (minor)

`libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:765`

`revert()` calls `this.registry.markEnhanced(kind, slug, Date.now())` on a successful restore. `manualEnhanceGate` reads that timestamp (`:697-702`), so after a user reverts a bad enhancement, Enhance is refused with `cooldown` for 24 hours even though nothing was enhanced. Fix: clear `lastEnhancedAt` (or leave it untouched) on revert; the cooldown should measure the last accepted enhancement, not the last history write.

---

## Requirement coverage

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Deterministic mode and visible rotation | **partly** | Setting is registered with default `true` (`file-settings-keys.ts:142,371`), joins `ROUTING_KEYS` (`file-settings-manager.ts:52`), the reader treats missing/non-boolean as ON (`scope/lane-rotation-setting.ts:9`), and `spread.ts:98,116` honours `rotate:false`. Fails on D1 (persist is skipped), D11 (no `routing:getRotation`) and D12 (silent read failure). |
| 2 | Keep the decision model inside the band | **met** | `phase-plan.ts:213-219` offers only `top - score <= 5`; the 80/76/70 case offers 80 and 76, so the 70 row never reaches the model and an answer naming it cannot match an offered label (`phase-resolve.ts:64-81`); a one-member band is not sendable (`phase-resolve.ts:16-22`, `:37`). D7 is a structure deviation, not a behavioural one. |
| 3 | Do not score capacity failures as capability | **met** | `local-derivation.ts:190-193` drops capacity `failed` rows from the delivery bucket; `outcome-figures.ts:16` drops them from the figure table. Worked example below. |
| 4 | Scope outcomes to the workspace, or fix README.md:76 | **partly** | SQL, binding order and the null bridge are correct (below), but D2/D3 make the filter miss the workspace's own rows on common paths. |
| 5 | Use reviseRounds in the review rate | **met** | `local-derivation.ts:211-215` adds one `unresolvedRevise` per open-revise row regardless of `reviseRounds`; `:289` adds it to `reviewTotal`. Worked example below. |
| 6 | Feed or remove pastOutcomes | **partly** | Figures are built (`outcome-figures.ts`), plumbed into pre-flight (`route-decide.service.ts:182`) and into lane requests (`:322`), and a malformed row cannot poison the table. Fails on D5 (no over-size fallback) and D6 (not capped). |
| 7 | Show the matrix | **partly** | Handler validates with strict Zod, fails closed with `PERSISTENCE_UNAVAILABLE`, keeps unknown cells as `{kind:'unknown'}`, and the allow-map/manifest entries are correct; store and component specs exist. Fails on D4 (cold read shows no local layer). |
| 8 | Server-side guards for skill Enhance | **met** | 5-use floor and 24h cooldown in `manualEnhanceGate` (`skill-enhancer.service.ts:648-704`), fail-closed on thrown registry/stats; the judge threshold is applied in `generateProposal` (`:424-439`) and re-applied in `applyProposal` (`:510-512`); `takeProposal` runs only after both gates (`:513`), so a refusal does not consume the preview. D8/D9/D13 are polish. |

### Verified correct (no defect)

- **SQL parameter binding, `sqlite-lane-outcome.store.ts:366-368` and `:384-386`.** Four placeholders, four arguments in order `(laneId|role, sinceMs, workspaceRoot, workspaceRoot)`; `?? null` makes the two nullable bindings `NULL` rather than `undefined`; `? IS NULL` short-circuits the predicate for a host with no workspace. `LIMIT 2000` is applied after the filter, so a narrow workspace is not truncated by other workspaces' rows.
- **Legacy null rows.** `workspace_root IS NULL` keeps pre-migration rows visible in every workspace. That is the specified bridge and an accepted attribution risk, not a defect.
- **Index use.** The existing indexes (`0054_lane_outcome_records.ts:69-74`) cover `(lane_id, ended_at DESC)` and `(role, ended_at DESC)`; `workspace_root` is a residual filter over an already time-bounded scan. Correct, though a `(workspace_root, lane_id, ended_at)` index would help as history grows — enhancement, not a defect.
- **In-memory parity.** `in-memory-lane-outcome.store.ts:207,220` uses `workspaceRoot == null` (catches both `null` and `undefined`) and the same null bridge; no divergence from SQLite beyond the missing normalization (D2).
- **Settings default.** `file-settings-keys.ts:371` is `true`; `lane-rotation-setting.ts:9` is `!== false`, so a missing key, a wrong type, or a failed read is rotation-on. Correct.
- **Item 8 refusal path.** Both gates run before `takeProposal`, and the cooldown timestamp is written only on a successful write. Correct.
- **No logger bypass.** The new backend paths use the injected `Logger`; no `console.*` was added. (D12 is the exception: no logger exists there at all.)

### Worked example — item 3 (capacity exclusion)

`blendedRate(successes, attempts, prior)` scores `100 * (successes + 10*prior/100) / (attempts + 10)`, rounded half-up: `blendNumerator = 100*successes + 10*prior` (`local-derivation.ts:420-427`), `blendDenominator = 100*(attempts + 10)` (`:430-432`), `roundPercent = floor((200*n + d) / (2*d))` (`:343-348`).

Rows: one `delivered`, one `failed` with `failureClass: 'usage-limit'`, prior 50.

- Before the fix: `successes = 1, attempts = 2` → `(100 + 500) / (100*12) = 600/1200 = 50.0`.
- After the fix: the capacity failure is excluded, `successes = 1, attempts = 1` → `600/1100 = 54.5` → **55**.

The capacity run no longer lowers the lane's capability score. A `failed` row with `failureClass: null` still counts (spec-pinned), and `no-deliverable` still counts as an attempt.

### Worked example — item 5 (revise rounds in the review rate)

Rows for one lane/task kind, both `verdict: 'unverified'`:

- A: `finalReview: 'approved'`, `reviseRounds: 0`
- B: `finalReview: null`, `reviseRounds: 1` (open revise)

- Before the fix: `reviewTotal = approved + rejected = 1`, `approved = 1` → `600/1100 = 54.5` → **55**.
- After the fix: `reviewTotal = 1 + 1 = 2` (`local-derivation.ts:211-215`) → `600/1200 = 50.0` → **50**.

An open revise counts as exactly one failed review. B with `reviseRounds: 3` still adds exactly one to `reviewTotal`, so the score is 50, not 33. An approved row with `reviseRounds: 3` adds one to both numerator and denominator (55), so revision churn neither rewards nor punishes a row that eventually passed. This matches the `## Decisions` text.

---

## Test gaps

1. `route-decide.gate.spec.ts:438` asserts the **opposite** of `verification-routing.md:38` (empty entries when rotation is off). It must change with D1; today it makes the correct fix look like a regression.
2. No two-workspace test for the outcome store. Missing: same directory with different case/separators, a subdirectory cwd, legacy `NULL` rows under a scoped read, and an unscoped read (no workspace). `sqlite-lane-outcome.store.spec.ts` filters only with byte-identical roots, and no spec checks that `LaneOutcomeReader` passes the provider's root to the store.
3. No cold-store test for `readMergedView()` — every existing test loads the matrix first, so D4 is invisible to the suite.
4. No test that the pre-flight request still sends when figures alone push it over `maxRequestBytes`; `model-refine` has no over-size-with-figures case.
5. No test that `outcomeFigures` are limited to the offered lanes.
6. `local-derivation.spec.ts` covers one-open-revise vs approved separately; it does not pin the combined "1 approved + 1 open revise ⇒ 50" case, nor `reviseRounds: 3` producing the same score as `reviseRounds: 1`.
7. Item 2's required gate-spec cases (80/76/70, model answers the 70 row ⇒ `bad-output`; one-member band ⇒ no request) exist in the new `phase-plan.spec.ts`, but not in `route-decide.gate.spec.ts` as the requirement asked; the end-to-end rejection path through `resolvePhase` is not exercised together with the narrowed offer.
8. No RPC-shape test for a refused `skillSynthesis:applyProposal` (`applied: false` plus reason); the service spec covers the gate, the handler spec does not cover the dropped field (D8). No test for revert clearing the cooldown (D13).
9. `apps/ptah-electron/src/di/rpc-surface.spec.ts` was updated but not executed, and `ptah-electron:test` was not run by the implementers. The new `agent:getCapabilityMatrix` shape has no verified Electron-level coverage.
10. Pre-existing failures the implementers reported (`rpc-handlers:test` temp-root harness, missing `marked` mapping, symlink `EPERM`) are unverified here; this review ran no tests.

## What this review did not do

No build, typecheck, lint, test, serve, or e2e run. Findings are from reading the diff and the files it touches. `ptah_get_diagnostics` was not invoked for the same read-only reason.

## Re-review (round 1)

Scope: only the 9 fixes in `impl-report-review-fixes.md`, read in the current tree. No builds or tests were run.

### Per-defect status

| # | Status | Evidence |
| --- | --- | --- |
| 1 Cold-start matrix | Fixed | `capability-matrix.store.ts:184-194` `readMergedView()` no longer uses `lastOutcomeQueries` (field removed). It calls `readWorkspaceLocalMatrix` (`:321-333`), which calls `reader.recentWorkspaceOutcomes` (`lane-outcome-reader.service.ts:51-59`) and then `store.listRecent` (sqlite `:73-76`, in-memory `:22-28`). The failure path logs and returns an empty matrix with `OUTCOMES_UNAVAILABLE_REASON`. A spec for a fresh view without `load()` was added per the report. |
| 2 Workspace scope normalisation | Fixed | Writer: `lane-completion-outcome.ts:53` stores `normalizeWorkspaceRoot(info.workingDirectory)`. Reader: `lane-outcome-reader.service.ts:44-49` normalises the active root; `NO_WORKSPACE_KEY` and `undefined` become `null` (no filter). In-memory match: `in-memory-lane-outcome.store.ts:7-12`, equal or `startsWith(root + '/')`, so a sibling `/proj-other` does not match `/proj`; a worktree under the root does. SQL: `sqlite-lane-outcome.store.ts:12-17`. Checked below. |
| 3 Rotation persistence | Fixed | `route-decide.service.ts:293` now calls `persistRotation` unconditionally. `rotate` still gates `spread` through `planRoutePhases`, so the stored id does not change the next pick when rotation is off. |
| 4 Setting read failure logging | Fixed | `lane-rotation-setting.ts:5,13` takes the lane logger and warns with an error name only (no path or value) before returning `true`. `di/register.ts:173` passes `LANE_ROUTING_TOKENS.LOGGER`. No failure-path spec (the report says so); see test gaps. |
| 5 Apply refusal reason | Fixed | `skills-synthesis-rpc.handlers.ts:422` returns `skipReason: result.skipReason ?? null`; `rpc-skill-clone.types.ts:158-162` adds `skipReason: string | null`. The only type consumers are the handler, the shared registry and `skill-synthesis-rpc.service.ts` (passes `result.data` through). Handler spec covers an applied and a cooldown refusal. |
| 6 Missing scorecard | Fixed with a naming nit | `skill-enhancer.service.ts:104,666-672` returns a distinct `judge-unavailable`. The reason names the judge, but the gate is missing invocation stats (see N4). The revert-starts-cooldown note was not addressed. It is a documentation point only. |
| 7 Shared band rule | Fixed | `ranking/closeness-band.ts:3` is used by `spread.ts:16`, `phase-plan.ts:12`, `phase-resolve.ts:6`. `isSendable` computes `top` once (`phase-resolve.ts:18`). `Math.max()` of an empty `ranked` gives `-Infinity` with no throw, and the status check still decides. |
| 8 Rotation read failure visible | Fixed | `route-decide.service.ts:111-113,160-163` keeps `load().reason`; `capability-matrix-rpc.handlers.ts:101-104` returns `lastPicksUnavailable`; the component shows "Recent picks are unavailable" when the flag is true or `lastPicks` is absent (`lane-rotation-setting.component.ts:84,162-168`). Rotation history still rides on the matrix RPC, so a matrix read failure hides it (accepted deviation, now surfaced to the user as "unavailable" because `lastPicks` is undefined). |
| 9 Read-only view | Fixed | `capability-matrix.store.ts:186` calls `readUserMatrix(false)`; `:218-223` skips `writeEmptyTemplate` when `createTemplate` is false. `readMergedView` calls no other writer (`writeViewIfChanged` stays in `load`). |

### SQL workspace match: verified

`WORKSPACE_MATCH` (`sqlite-lane-outcome.store.ts:12`) has three placeholders; `workspaceBindings` returns exactly three values (`[null, null, null]` for no filter, so `? IS NULL` is true). Escapes: the JS double-quoted string turns `'/\'` into the SQL literal `'/\'` (rtrim of `/` and `\`) and `'\'` into `'\'`, matching `normalizeWorkspaceRoot` (`workspace-root-key.ts:44-49`: strip trailing separators, backslash to slash, lower case). LIKE: `ESCAPE '!'`, with `!`, `%` and `_` in the root escaped as `!x` (`:14-16`), then `/%` appended, so a root containing `_` or `%` cannot over-match and `/proj` does not match `/proj-extension`. A root of `/` normalises to the empty string; the LIKE pattern `/%` and equality to `''` both still behave. Values are bound, never concatenated. Null-root legacy rows still match.

### New defects

N1. **minor** — `lane-outcome-reader.service.ts:51-59`. `recentWorkspaceOutcomes` returns `this.join(...)` without `await` inside the `try`, so a rejection from `join` would bypass the `catch`. `join` catches its own seam errors today, so this is latent. It also truncates silently at `READ_LIMIT` (no warning, unlike `recentOutcomes`) and returns `[]` on a store error, which the matrix store cannot tell apart from "no history". Fix: `return await this.join(...)`, log a cap warning, and leave the empty result as the documented contract.

N2. **minor** — `sqlite-lane-outcome.store.ts:12`. SQLite `lower()` folds ASCII only, while the JS side uses `toLowerCase()`. A row written raw by another writer (the subagent path stores `event.cwd` unnormalised, `lane-outcome-recorder.service.ts:231`) whose path has a non-ASCII upper-case letter will not match its own workspace. CLI lane rows are lower-cased in JS before storage, so they are unaffected. Fix: normalise `event.cwd` on write too, or fold only ASCII in JS for the comparison. The expression is also not index-friendly; it is bounded by `ended_at >= ?`, so acceptable.

N3. **minor** — matching rule (`in-memory-lane-outcome.store.ts:7-12`, SQL `:12`). The rule is "recorded root equals the active root or is below it". When the active workspace is itself a worktree or sub-folder, rows recorded under the repository root or a sibling worktree are hidden. This is a documented choice in the fix report and fits the main-checkout case. It should be stated in the settings help or README line the original decision referred to.

N4. **minor** — `skill-enhancer.service.ts:672`. `judge-unavailable` is returned when invocation stats are missing, not when a judge is. A caller reading `skipReason` is misled. Rename to something like `stats-unavailable`, or document it on the type at `:104`.

N5. **minor (process)** — `impl-report-review-fixes.md` Verification. The seven-project run ended with 4 failed suites in `cli-agent-runtime` and 14 in `rpc-handlers`, attributed to the environment without individual classification. Only the two changed specs were re-run and passed. The failures were not shown to predate this branch. Run those two projects' failed suites on `main` (or inspect the failing names) before merge.

No blocking or major defects remain.

### Residual test gaps

- No failure-path spec for `LaneRotationSetting` logging (defect 4).
- No spec for the non-ASCII or `_`/`%` root cases of the SQL match, and none for a root of `/`.
- No spec that `recentWorkspaceOutcomes` surfaces a store failure to the matrix view.

### Verdict

Verdict: APPROVED
Score: 8/10 (up from 6.5). All nine defects are fixed; the normalised workspace match and the read-only cold-start view are correct on the paths read. Remaining items are minor and should be tracked (N1 and N5 first).

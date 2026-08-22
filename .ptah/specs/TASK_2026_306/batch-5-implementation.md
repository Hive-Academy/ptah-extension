# Batch 5 — `harness-sync`: 13 unclosed gaps and a mis-scoped summary (Defect F)

**Branch**: `ak/boot-blocker-quota-gate` · **Tasks**: 5.1 (diagnosis, no fix), 5.2, 5.3

---

# TASK 5.1 — DIAGNOSIS ONLY (no remedy implemented)

## Verdict in one line

The 13 files are **not** "produced by neither source". They are produced fine, and every
one of them **already exists on disk**. The reconciler is **deliberately refusing to
overwrite them** because each is an unowned file sitting on a desired path — `blocked`,
which is `foreign` and therefore counted `missing` **by design** (E9). The 13 are not a
malfunction; they are 13 correct refusals being reported through a counter that reads like
a failure.

## The workspace is not this repo

`tmp/logs/log.log` was captured against **`D:\projects\property-hub`**, not
`ptah-extension` (`SessionImporter` at the adjacent log lines names it). Every number
below is reproduced from that workspace's live on-disk state, which still matches the
capture.

## Which 13 files, on which target, from which source

**All 13 are on the `claude` target.** Every other target is whole.

| Target      | expected |   found | missing | detected               |
| ----------- | -------: | ------: | ------: | ---------------------- |
| claude      |   **27** |  **14** |  **13** | yes                    |
| codex       |       36 |      36 |       0 | yes                    |
| copilot     |       36 |      36 |       0 | yes                    |
| antigravity |       20 |      20 |       0 | yes                    |
| cursor      |        0 |       0 |       0 | **no** — not installed |
| vscode      |        0 |       0 |       0 | no MCP intents         |
| **TOTAL**   |  **119** | **106** |  **13** |                        |

`27 + 36 + 36 + 20 = 119` and the four manifests hold `14 + 36 + 36 + 20 = 106` entries —
the captured `expected:119, found:106, missing:13` reproduces **exactly**, to the unit.

The 13, all `kind: skill`, all under `{ws}/.claude/skills/`, all sourced from
`~/.ptah/user/skills/<slug>` (the user layer — the ordinary skill source, no plugin
overlay involved):

```
.claude/skills/angular-3d-scene-crafter
.claude/skills/angular-frontend-patterns
.claude/skills/angular-gsap-animation-crafter
.claude/skills/ddd-architecture
.claude/skills/humanize-library
.claude/skills/nestjs-backend-patterns
.claude/skills/nx-workspace-architect
.claude/skills/orchestration
.claude/skills/saas-workspace-initializer
.claude/skills/skill-creator
.claude/skills/technical-content-writer
.claude/skills/ui-ux-designer
.claude/skills/video-showcase
```

## Why each one is blocked

`~/.ptah/user/skills` holds 20 skills. The claude manifest owns **7** of them. The other
**13** exist in `.claude/skills/` but appear in **no manifest**, so
`ClaudeTarget.planEntry` returns `'foreign'`, the slug is pushed to `scanned`
(`claude-target.ts:189-194`), and `blocked = foreign.filter(relPath => desiredRel.has(relPath))`
(`:277`) puts all 13 into `plan.blocked`. `appliedTargetHealth` then reports
`missing = [...writeFailedPaths, ...plan.blocked]` (`harness-health.ts:112`) — with
`writeFailed` empty, **`missing` IS `plan.blocked`, exactly**.

**The mtimes name the era, and they split cleanly:**

| Group                      | Count | mtime              | Manifest |
| -------------------------- | ----: | ------------------ | -------- |
| The 13 blocked             |    13 | **2026-07-08/09**  | unowned  |
| 6 more foreign (undesired) |     6 | **2026-07-08**     | unowned  |
| The 7 owned                |     7 | 2026-08-19 / 08-22 | owned    |

`2026-07-08 21:45` predates `harness-sync` entirely — these are leftovers from the deleted
`SkillJunctionService`/legacy copy era. The 7 owned skills carry reconciler-era mtimes:
they were **absent** on 07-08, so `harness-sync` created them fresh with nothing in the
way. The 13 had a legacy occupant on every desired path.

**Why adoption did not rescue them.** All three adoption proofs fail, and the third does
not apply:

1. **Byte identity** — hash-compared all 20 with the lib's own `hashDirSync` algorithm
   (sorted POSIX relpaths, `IGNORED_ENTRY_NAMES` filtered, sha256 fold). Result:
   **13/13 DIFFER** from their user-layer source; **7/7 owned are EQUAL**. The legacy
   copies drifted from upstream in the ~6 weeks since 07-08, so the "content already
   equals what this pass would produce" proof cannot fire.
2. **Legacy `.ptah-managed.json`** — `.claude/skills/.ptah-managed.json` does **not
   exist** (verified). This is the load-bearing asymmetry: `SkillJunctionService` wrote
   that sidecar into `.claude/commands` but **had nowhere to put one for `.claude/skills`**
   — a fact `harness-sync/CLAUDE.md` already records as a design constraint. That is
   precisely why **all 7 legacy commands adopted cleanly and 0 legacy skills did.**
3. **Writer signature** — `IHarnessAgentTransformer.isPtahOutput` is **agents only**.
   Skills carry no signature and, per the lib's own docs, never will.

So the 13 are foreign forever until a human moves them. That is the documented, intended
outcome — `harness-sync/CLAUDE.md`: _"A drifted `.claude/skills/<slug>` with no legacy
manifest therefore stays foreign, is counted missing, and is LISTED by the doctor so the
user can move it out of the way. That is the correct answer, not a gap in the mechanism."_

## `foreign: 19` corroborates the count exactly

13 blocked + 6 undesired legacy dirs in the managed directory (`agent-browser`,
`cloudflare-wrangler`, `figma-designer`, `impeccable`, `neon-postgres copy`,
`turnstile-spin` — all 07-08, none in the user layer) = **19**. And the Electron line's
`foreign=19` equals the reconciler's `foreign=19`, confirming **all 19 are on claude too**.
Every published number closes.

## Why the second pass closes zero — answered

**Because `blocked` is a refusal, not a failure, and refusals are not retryable.**

The `content-download-complete` pass exists to correct a **cold or cached SOURCE** — it
re-runs after `ContentDownloadService` populates `~/.ptah/user`. But the sources were never
the problem: all 20 source directories were present and hashed fine on pass 1
(`sources: "ok"`). What blocks the write is the **target-side occupant**, which the
download does not touch. Even if the download had _changed_ every source byte, the target
copy would still be unowned, still fail all three adoption proofs, still be `foreign`,
still be `blocked`. **No number of passes can close a blocked path** — only the user moving
the file, or an adoption proof succeeding, can. Identical counts across two passes is the
correct signature of a converged steady state, not of a stuck retry.

The one field that **did** differ is the tell: `removed: 4` on pass 1, `removed: 0` on
pass 2. Pass 2 ran real work and reaped nothing because pass 1 had already converged.

## `writeFailed: 0` and `sources: "ok"` — explained, not restated

- **`writeFailed: 0` is not evidence that writes succeeded — it is evidence that no write
  was ever attempted.** `plan.writes` is built only from desired paths that were _not_
  classified foreign (`claude-target.ts:189-194` `continue`s before the `writes.push`).
  A blocked path never enters `writes`, `apply()` never touches it, so it is structurally
  impossible for it to appear in `writeFailed`. Reading `writeFailed: 0` as "permissions
  are fine" is true but irrelevant; the gap sits one phase earlier, in `plan`.
- **`sources: "ok"` is a statement about the SOURCE side only** (`ok` |
  `sources-missing` | `pending-download`), set by the manifest builder from the state of
  `~/.ptah/user`. It is orthogonal to target health by construction and correctly reports
  `ok` here — I verified all 20 source dirs exist and hash cleanly. A pass can be
  `sources: "ok"` and 100% blocked at every target; the two facts never constrain each
  other.

## Which `found` shape produced `106/119` — established, not assumed

**`appliedTargetHealth` (`harness-health.ts:110-112`), `found = plan.unchanged + written`.**

Both passes are `mode: 'full'`. In `reconcileTarget`, the `plannedTargetHealth` path is
reachable only via `target.verify()`, called from exactly two places: the
`options.mode === 'preflight'` no-drift branch (`:470-475`), and `verify()` itself. Neither
is on a `full` reconcile. Every detected target therefore returns through
`appliedTargetHealth` — including the `isNoOp` branch (`:479-489`), which calls
`appliedTargetHealth` with an empty result. Confirmed empirically: `found` (106) equals the
total live manifest entry count (106) to the unit, which is the applied shape's meaning.

## Proposed remedy — NOT implemented

The counters are correct. The defect is that a **user-actionable refusal is reported through
a channel that looks like a system failure**, with no path to the fix.

**Recommended: make the refusal actionable, do not change the classification.**

- **R1 (primary, low risk).** When `missing` is non-empty but `writeFailed` is empty and
  every missing entry is also in `blocked`, the warn is misleading — it says "gaps" for a
  state Ptah is _correctly_ maintaining. Split the log: a distinct message naming the
  blocked paths and the one-line user action ("move or delete these, then re-run
  `ptah harness doctor --fix`"). Keep the `summarizeHarnessHealth` level at `degraded`
  (the harness genuinely is incomplete) but stop spelling a refusal as a gap of unknown
  cause. This is what actually cost the diagnosis time.
- **R2 (worth a decision, medium risk).** Legacy skill copies are unadoptable **only**
  because `.claude/skills` never got a sidecar. That is an accident of the deleted
  implementation, not a safety property. Consider a bounded one-shot migration: adopt an
  unowned `.claude/skills/<slug>` when the slug is in the desired state **and** a
  `SkillJunctionService`-era `.claude/commands/.ptah-managed.json` proves the legacy
  pipeline ran in this workspace. **Risk: this overwrites a skill a user genuinely
  authored by hand at a colliding slug.** Needs an explicit product decision — I recommend
  it be its own task with its own review, not folded into a logging fix.
- **R3 (cheap).** `ptah harness doctor` already lists the paths. The Electron/VS Code boot
  lines do not. Task 5.2 narrows the gap by printing `missing`/`foreign` counts at the
  right scope; naming the first few paths would close it.

**Explicitly NOT recommended**: excluding `blocked` from `missing`. That is the exact
regression `harness-sync/CLAUDE.md` documents at length (`harness doctor --fix` reporting
"in sync" and `harness doctor` reporting "23 missing" over the same tree, never
converging). `missing` must stay "desired but not owned on disk, regardless of why".

**Leaf constraint holds** under all three options: none needs anything from `agent-sdk`.

**Expect this batch to gain 1–2 tasks (R1, optionally R3). R2 should be a separate task.**

---

# TASK 5.2 — Electron summary reported a per-target slice as the whole

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\activation\plugin-activation.ts`

## Scope decision — and why

**Chose: report the aggregate as the headline, and keep the claude slice beside it,
explicitly labelled.**

Reasoning:

1. **The aggregate is the half that makes the two lines reconcilable.** That was the whole
   complaint — `found=14/27` beside `found=106/119` from one pass. Labelling the line
   claude-only would make it _honest_ but would still leave a reader with no way to check
   it against the reconciler's warn. The aggregate does both.
2. **The aggregate comes from `summarizeHarnessHealth` (`@ptah-extension/shared`), not
   from a fourth summation.** `harness-sync/CLAUDE.md` is explicit: _"Never re-derive 'is
   the harness healthy'. Call `summarizeHarnessHealth`. Three consumers depend on that
   rule being one rule."_ Hand-rolling a `reduce` in the Electron host would have made a
   fourth. **Verified numerically equivalent** to the reconciler's `totals`:
   `summarizeHarnessHealth` sums _detected_ targets while `log()` sums _all_, and
   `undetectedTargetHealth` zeroes every counter — so the two agree by construction, not
   by luck.
3. **The claude slice is kept because dropping it trades a legibility bug for information
   loss.** Claude is this host's primary target. Labelled `claude=14/27` beside
   `found=106/119 (all targets)`, the scopes are unambiguous.

## `?? 0` — three states, not two

`claude?.found ?? 0` collapsed three distinct facts to `0/0`, of which only one is a
healthy pass. `formatClaudeSlice` now renders each:

| State                            | Renders as              |
| -------------------------------- | ----------------------- |
| no claude target registered      | `claude=not-registered` |
| registered but `detected: false` | `claude=undetected`     |
| detected, nothing desired        | `claude=0/0`            |

The third state was the requirement; the second is a real environment fact the old
spelling also hid, so I distinguished it too.

## Both sites fixed, and made structurally undriftable

`reconcileHarness` (was `:365-371`) and `propagateHarness` (was `:413-417`) both now call
**one shared `formatHarnessLine(verb, reason, health)`**. They are not two parallel fixes —
there is one formatter, so they cannot disagree with each other again. `propagate` returns
`HarnessHealth | null`; `null` renders as `no health report produced` rather than being
run through the summarizer (which would print `sources=sources-missing`, a fact not in
evidence).

Net: `plugin-activation.ts` 425 → 473 lines (under the 700 ceiling).

**Out of scope, reported not fixed:** `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:287`
and `:337` carry the **identical defect** (same `find(t => t.target === 'claude')`, same
`?? 0`, same bare field names). It is outside my assigned files. **Recommend a follow-up
task** — otherwise the VS Code host now disagrees with both the Electron host and the
reconciler.

---

# TASK 5.3 — reconciler summary now states its scope

**File**: `libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`

Added to `detail` in `private log(health)`:

- `scope: 'all-targets'` — names what the six counters measure, in the line itself.
- `targetCount: health.targets.length` — the denominator of that scope.
- `perTarget: [...]` — `{ target, detected, expected, found, missing, foreign, removed,
writeFailed }` per target.

`perTarget` rather than only the count, because 5.1 is the argument for it: the aggregate
`missing:13` reads identically whether the gaps sit on one target or six, and _which target
owns them_ was the first question and the single most expensive one to answer. With
`perTarget`, `claude 14/27` is on the line and the diagnosis starts from the right target.

**Constraints honoured:**

- **What is counted is unchanged.** `totals` is byte-for-byte the same reduce over the same
  fields; the six counters keep identical keys and values, so a re-run stays directly
  comparable to `tmp/logs/log.log`. `perTarget` reads the same `HarnessTargetHealth`
  fields the reduce already reads — no new derivation.
- **Warn gate at `:649` unchanged** — still `totals.writeFailed > 0 || totals.missing > 0`.
- **`plannedTargetHealth` / `appliedTargetHealth` untouched.** The specs flagged as at risk
  were never approached.
- **`harness-sync` is still a leaf** — internal deps remain exactly
  `@ptah-extension/shared` + `@ptah-extension/vscode-core`. No `agent-sdk`.

---

# Test coverage — honest accounting

**New spec cases written: 0.**

Both 5.2 and 5.3 are log-string/log-object shape, which the batch brief itself calls
"poorly served by unit tests". I did not contort a spec to cover them, per instruction.
Concretely:

- **5.3** would require asserting on the shape of an object passed to a `logger.warn` stub.
  The 10 reconciler specs that stub `logger.warn` (`concurrency`, `foreign-edits`,
  `idempotency-removal`, `migration`, `overlay-and-disabled`, `preflight`, `remove`,
  `sources-health`, `workspace-isolation`, `write-failure`) all discard the payload. Pinning
  a log payload's key set would be a change-detector test over a diagnostic string.
- **5.2** is `console.log` formatting in an Electron activation function.
  `plugin-activation.spec.ts:337` already mocks `console.log` and asserts nothing about its
  content — deliberately.

**Verified against real data instead**, which is stronger here: the 5.1 numbers were
reproduced to the unit from the live `property-hub` workspace, and both new log lines were
hand-evaluated against that captured health object.

**No existing assertion was changed.** Nothing needed changing — reported as required.

---

# Verification (all commands as specified, `run-many`)

| Command                                     | Result                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p harness-sync`   | **PASS** — 33/33 suites, **233/233 tests**, 0 changed                              |
| `npx nx run-many -t lint -p harness-sync`   | **PASS** — "All files pass linting", 0 warnings                                    |
| `npx nx run-many -t build -p ptah-electron` | **PASS** — build + 8 dependent tasks                                               |
| `npx nx run-many -t test -p ptah-electron`  | **PASS** — 255 passed, 4 skipped (pre-existing)                                    |
| `npx nx run-many -t lint -p ptah-electron`  | **PASS** — 0 errors; 4 pre-existing `max-lines` warnings, none in a file I touched |

`ptah-electron` lint reporting **0 errors** is the `@nx/enforce-module-boundaries` check on
the new `@ptah-extension/shared` import — confirming the dependency direction is allowed.

## Files changed

- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\plugin-activation.ts`

No commit, no branch change, no files touched in `libs/backend/task-specs/` or
`libs/backend/persistence-sqlite/`.

## Expected shape on the next boot

```
[WARN] [harness-sync] Reconcile finished with gaps: {"reason":"activation","mode":"full",
  "sources":"ok","collisions":0,"scope":"all-targets","targetCount":6,
  "expected":119,"found":106,"missing":13,"foreign":19,"removed":4,"writeFailed":0,
  "perTarget":[{"target":"claude","detected":true,"expected":27,"found":14,"missing":13,
  "foreign":19,...},{"target":"codex",...,"expected":36,"found":36,"missing":0,...},...]}

[Ptah Electron] Harness reconciled (activation): sources=ok, detectedTargets=N/6,
  found=106/119 (all targets), claude=14/27, missing=13, foreign=19, writeFailed=0
```

`106/119` now appears on both lines, `claude=14/27` is labelled as the slice it always was,
and `perTarget` shows at a glance that all 13 gaps are claude's.

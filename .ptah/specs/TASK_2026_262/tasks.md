# Development Tasks — TASK_2026_262

**Total Tasks**: 13 | **Batches**: 4 (one conditional) | **Status**: 0/4 complete
**Branch**: `ak/tui-defects` | **Decomposed**: 2026-08-16

Live-model-list resolution for tier-shaped values on the three providers that
declare no `defaultTiers` (`openrouter`, `lm-studio`, `requesty`).

There was **no architecture pass** — deliberately. The three open design
questions in `context.md:89-99` are assigned below to the batch that must
answer them, and each answer must be argued in that batch's report. Do not
treat this file as having made them.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS. No blockers. Nothing in `context.md`
was re-derived; the checks below are only the ones that decide batch shape.

### Assumptions verified against code

1. **`ModelResolver.resolve` is synchronous and cannot become async.**
   `model-resolver.ts:37` returns `string`. It is reached through
   `IModelResolver` (`agent-sdk/src/lib/auth-env.port.ts:28`) from per-message
   hot paths that are sync by construction —
   `message-transform/assistant-message.transformer.ts:306`,
   `helpers/stream-transformer.ts:315`,
   `session-history-reader.service.ts:499,589,725`. Design question 1's
   "check whether making it async is even viable" is therefore **answered: it
   is not.** Do not re-open it; the batch plan is built on this.

2. **There is an existing async seam that already writes exactly the values
   `resolve()` reads.** `ProviderModelsService.applyPersistedTiers`
   (`provider-models.service.ts:617-643`) computes
   `userTiers ?? providerDefaults` and writes `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`
   into `authEnv` + `process.env`. `resolve()` consults that env var **first**
   on both branches (`:42` for `claude-*`, `:57` for the bare alias). So a
   third fallback link on that chain — live-catalogue-derived — closes the
   chat path, the lane alias path and the pinned-id path **without touching
   `resolve()`'s signature at all.** This is the recommended shape. It is not
   mandated: if the developer finds it wrong, argue it in the report.

3. **A synchronous read of a live catalogue already exists.**
   `readPersistedCatalog` (`provider-models.service.ts:165`) is sync, reads
   `provider.<id>.modelCatalog`, and validates the stored shape as untrusted.
   `persistCatalog` (`:141`) is already written on both dynamic-fetch paths
   (`:235`, `:274`), and `modelCache` (TTL) sits in front. Design question 1's
   "where the live list is cached" therefore has a repo-native answer to
   evaluate first: **in-memory cache → persisted catalog (sync) → async
   network refresh out of band.** No network round trip on `resolve()`.

4. **All 8 `switchActiveProvider` call sites are inside async strategy
   `configure` methods** (`api-key.strategy.ts:456,591,635`,
   `local-native.strategy.ts:153,222`, `local-proxy.strategy.ts:101`,
   `oauth-proxy.strategy.ts:146,247`). So an async refresh at provider-switch
   time is viable if wanted. `switchActiveProvider` and `applyPersistedTiers`
   are themselves sync today; making either async is a real but contained
   change.

5. **There are TWO tier-population sites, not one — and `context.md` names
   only the second as a caller.** Besides `applyPersistedTiers`, the profile
   resolver has its own private copy of the same `persisted ?? defaults` chain
   writing the same three vars into a **snapshot** env:
   `workspace-provider-profile-resolver.ts:334-345`. A live-tier source wired
   only into `ProviderModelsService` **leaves the per-workspace profile path
   still broken.** This is why Batch 2 exists and why it is not optional.

6. **skill-synthesis likely needs no production change at all.**
   `resolveJudgeModel` returns the pinned `claude-haiku-4-5-20251001`, which
   enters `resolve()` at `:39`, detects tier `haiku`, and reads
   `ANTHROPIC_DEFAULT_HAIKU_MODEL` at `:43`. Once Batch 1 populates that var,
   the pinned id resolves to a real catalogue id. Same for `resolveLaneModel`'s
   bare alias via `:57`. Batch 2 must **verify this rather than assume it**,
   and its skill-synthesis work is expected to be specs + doc correction only.
   This preserves the zero-direct-SDK-import rule for free.

### Risks

| #   | Risk                                                                                                                                                                                                                                       | Severity | Mitigation                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| R1  | **Cold start with no catalogue ever fetched** (fresh install, `openrouter` active, no model picked) leaves the value still verbatim — the exact bug this task was filed about. Also hit by an **offline LM Studio**, whose fetcher throws. | HIGH     | Task 1.4 must handle it explicitly; it is the pass/fail of the whole task            |
| R2  | **Which of ~200 catalogue entries is "opus"** is a heuristic. Getting it wrong ships a wrong-but-servable model, which is worse than a 404 because it is silent.                                                                           | HIGH     | Task 1.2 — the rule must be explicit, testable, and defended in the report           |
| R3  | The characterization pair in `model-resolver.spec.ts` (`5c9094f12`) asserts today's verbatim behaviour and **will go green-to-red**. Deleting it is the single likeliest way this task goes wrong.                                         | HIGH     | Task 1.5 — read comments first, rewrite deliberately, never delete                   |
| R4  | `fetchModels` needs an `apiKey` for the dynamic path; at tier-population time the key may not be in hand.                                                                                                                                  | MED      | Task 1.4 — trace where the key is available before choosing the refresh trigger      |
| R5  | Making `applyPersistedTiers` / `switchActiveProvider` async ripples into 8 strategy call sites and their specs.                                                                                                                            | MED      | Task 1.3 — prefer sync-read + out-of-band refresh; if async, list every touched site |
| R6  | A new error channel (design Q2) may need a new RPC namespace → **dual registration** (`libs/shared/.../rpc.types.ts` AND `rpc-handler.ts:46` `ALLOWED_METHOD_PREFIXES`).                                                                   | MED      | Task 3.2                                                                             |
| R7  | Concurrent session commits on `ak/tui-defects`; `.ptah/specs/TASK_2026_242/` and `TASK_2026_257/` hold another session's uncommitted work.                                                                                                 | MED      | Git rules below — enforced every batch                                               |
| R8  | The one-time warn (`warnUnservableTierValue`, `model-resolver.ts:117-128`) becomes partly redundant once values resolve; left as-is it fires on a now-handled case.                                                                        | LOW      | Task 1.6 — stays / narrows / goes, decided, not defaulted                            |

### Design questions — where each is answered

| Q                                                     | Owner    | Default                                                                    |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Q1 cache location + cold cache + offline local server | Task 1.4 | Assumption 1 already closes the "make it async" half                       |
| Q2 error vs verbatim send for an unresolvable tier    | Task 1.7 | **No default.** Recommendation with reasoning required; Batch 3 implements |
| Q3 should `claude-*` also consult `defaultTiers`      | Task 1.6 | **Leave it.** Changing it must be argued and must not be incidental        |

### Git rules — every batch, non-negotiable

- Never `git add -A`, never `git add .`, never `git stash` without a pathspec,
  never `git checkout .`. Stage explicit paths only.
- Do not touch `.ptah/specs/TASK_2026_242/` or `.ptah/specs/TASK_2026_257/`.
- Developers do **not** commit. team-leader commits after an APPROVED verdict.

### Gate — every batch

```
npx nx run-many -t test lint typecheck -p auth-providers shared rpc-handlers skill-synthesis
```

Report real numbers. Pre-existing lint warnings at the TASK_2026_250 baseline:
`auth-providers` 2, `skill-synthesis` 30, `shared` clean. No new warnings in a
touched file.

### Standing constraints

- **No invented model ids.** Any id must be cited to that provider's docs or to
  existing repo code. A tier derived from a catalogue the provider itself
  returned satisfies this by construction — that is the point of the approach.
  A hardcoded slug does not, no matter how plausible.
- **No provider is privileged.** No `if (providerId === 'openrouter')`.
- `skill-synthesis` keeps **zero** direct SDK imports; `platform-core` ports
  only, never adapters.
- Every behaviour change needs a spec that **fails without it**, mutation-tested
  with exact before/after counts reported.

---

## Batch 1: Live-tier source + the chat path ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: Every task lands in `auth-providers`, two of them in the same
file, and all three design questions are decided here. Splitting this across
parallel executors would produce merge conflicts, not throughput. This batch
alone makes the most user-visible instance — the chat path's `'default'` —
resolve, so it is independently verifiable.
**Tasks**: 7 | **Dependencies**: none

### Task 1.1: Read the ground truth before writing anything ⏸️ PENDING

**Files** (read-only):

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_262\context.md`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_250\followup-a-report.md`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\model-resolver.ts`
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\model-resolver.spec.ts` — the `describe('tier values with nothing left to resolve them')` block **and its comments**
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models.service.ts` — `:130-200` (catalog), `:203-300` (fetch/cache), `:617-709` (tier application)
- `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries\requesty-provider-entry.ts:19-23`
- `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries\local-provider-entry.ts:148-163`

**Acceptance**: report states, in one line each, what the characterization pair
asserts and why, before any edit is made.

---

### Task 1.2: The catalogue → tier derivation rule ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models.service.ts` (or a new sibling module in the same lib — developer's call, argue it)

Given a `ProviderModelInfo[]` from a provider's own catalogue, produce
`Partial<Record<'opus'|'sonnet'|'haiku', string>>`.

**Quality requirements**:

- Provider-agnostic. No id literals, no per-provider branches (R2, standing constraints).
- Every returned id comes from the passed catalogue. Nothing synthesised.
- Deterministic and total: same catalogue → same map; an unrecognisable
  catalogue returns `{}`, never a guess.
- The rule is stated in a docblock **with its reasoning**, so the next reader
  can disagree with it on purpose.

**Validation notes**: R2 is the risk that this task exists to contain. A
wrong-but-servable model is worse than a 404 because it is silent — say in the
report what the rule does with a catalogue it cannot read.

**Acceptance**: unit specs over ≥3 realistic catalogue fixtures (a broad
OpenRouter-shaped one, a 2-model LM Studio-shaped one, an empty one). Mutation
count reported.

---

### Task 1.3: Wire the derived tiers into `applyPersistedTiers` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\provider-models.service.ts:617-643`
**Dependencies**: 1.2

Extend the chain to `userTiers ?? providerDefaults ?? liveDerived`.

**Quality requirements**:

- **Precedence is exactly that order.** A user's explicit tier choice and a
  registry `defaultTiers` both outrank the live list. This must have its own spec.
- Read path is **synchronous** — in-memory `modelCache` first, then
  `readPersistedCatalog` (`:165`). No network call on this path (Assumption 3).
- Prefer leaving `applyPersistedTiers` / `switchActiveProvider` sync. If made
  async, enumerate all 8 call sites touched and justify (R5).
- `applyTierMetadata` (`:658`) already resolves display metadata from
  `modelCache` — confirm it still behaves for a live-derived tier, or say why not.

**Acceptance**: spec proving `applyPersistedTiers('openrouter')` with a
populated catalogue writes real ids where it previously wrote nothing
(`followup-a-report.md:126-128` documents that it currently, legitimately,
writes nothing).

---

### Task 1.4: Cold cache and offline local server — design Q1 ⏸️ PENDING

**Files**: `provider-models.service.ts`; whichever refresh trigger is chosen
**Dependencies**: 1.3

**This task is the pass/fail of the whole carrier (R1).** Batch 1 is not done
if a fresh install with `openrouter` active and nothing selected still sends
`'opus'`.

**Must answer, in the report**:

- What happens when no catalogue has **ever** been fetched. Where the async
  refresh is triggered, and what re-applies tiers when it lands.
- What happens when LM Studio is **offline** and the dynamic fetcher throws
  (`:245-255` already swallows and falls back).
- Whether the `apiKey` needed by `fetchModels`' dynamic path is in hand at that
  trigger point (R4) — trace it, do not assume.
- Explicit statement of any residual hole, which then becomes Batch 3's input.

**Quality requirements**: a failed or slow refresh must never block or throw on
a resolution path. Bounded work — no refresh storm, no retry loop. Match the
existing fire-and-forget-with-logged-swallow idiom (`persistCatalog`, `:141`).

**Acceptance**: specs for cold-cache and fetcher-throws, both asserting no
throw and a defined outcome.

---

### Task 1.5: Rewrite the characterization pair — deliberately ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\model-resolver.spec.ts`
**Dependencies**: 1.3, 1.4

The two cases from `5c9094f12` — `sends a bare tier alias verbatim when the
provider declares no defaultTiers` and `sends a dated claude id verbatim there
too` — assert the behaviour Batch 1 changes.

**Quality requirements**:

- **Never delete them (R3).** Rewrite each to assert the new behaviour, keeping
  a comment that says what it used to assert, that it was TASK_2026_250
  characterization, and why TASK_2026_262 changed it.
- `names exactly the registry entries the docs say are exposed` must still pass
  **unchanged** — no registry entry gains `defaultTiers` in this task. If it
  fails, something went in the registry that should not have.
- `resolves the alias through defaultTiers when the provider declares them` must
  still pass unchanged — it is the precedence contract from 1.3.

**Acceptance**: report quotes the old assertion and the new one side by side,
with the reason for the change.

---

### Task 1.6: Warn disposition (R8) + the `claude-*` asymmetry (design Q3) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\model-resolver.ts:117-128`, `:39-50`
**Dependencies**: 1.3

Two decisions, both explicit, neither defaulted-by-silence:

- **Warn**: stays / narrows / goes. Its docblock (`:104-112`) says "Closing that
  needs the provider's LIVE model list, which is not this function's to fetch" —
  that sentence is now partly historical and must be corrected either way.
- **Q3**: default is to **leave** the asymmetry (`claude-*` consults only the
  tier env var, never `defaultTiers`). `followup-a-report.md:278-282` explains
  why. Changing it requires an argument; the characterization case
  `does NOT resolve a dated claude id through defaultTiers` must not be altered
  incidentally.

**Acceptance**: report has one paragraph per decision. "Left unchanged" is a
valid outcome; "not mentioned" is not.

---

### Task 1.7: Design Q2 recommendation — error vs verbatim send ⏸️ PENDING

**Dependencies**: 1.4
**No production code.** Output is a recommendation in the batch report.

Should a tier that still cannot resolve after Batch 1 surface as an **error**
rather than a verbatim send?

**Must cover**:

- The asymmetry: background lanes have a stall channel (`auth-unresolvable`);
  the chat path has none.
- What the chat user sees today (a provider 404) vs. under the proposal.
- Blast radius: which of the four callers would need a failure channel it does
  not currently have. `followup-a-report.md:170` rejected giving
  `resolveJudgeModel` one, for stated reasons — engage with them.
- Whether Task 1.4's residual hole is large enough to need this at all.

**Acceptance**: a recommendation with reasoning and a stated cost, not a
preference. This gates Batch 3.

---

**Batch 1 verification**:

- Chat path: `openrouter` active, nothing selected, populated catalogue →
  `'default'` resolves to a real catalogue id, not `'opus'`. Same for
  `lm-studio` and `requesty`.
- Precedence spec: user tier > `defaultTiers` > live-derived.
- Cold cache and offline fetcher: defined, non-throwing outcomes.
- Characterization pair rewritten, not deleted; the other five cases in that
  block still pass.
- Gate green. Mutation counts reported for every behaviour change.
- Report answers Q1, Q3, states the warn disposition, and carries the Q2
  recommendation.

---

## Batch 2: The remaining three callers ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: Not parallel-eligible. Task 2.1 is a real behaviour change that
must mirror Batch 1's precedence decision exactly; 2.2 and 2.3 are verification
whose expected result depends on how 2.1 lands. Cross-lib (`auth-providers` →
`skill-synthesis` → `rpc-handlers`) with one shared invariant.
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Per-workspace profile resolver ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\workspace-provider-profile-resolver.ts:334-345` and `:353-369`

This path has its **own** copy of the `persisted ?? defaults` chain writing the
three tier vars into a snapshot env (Assumption 5). Batch 1 does **not** reach
it. Left alone, the profile path stays broken.

**Quality requirements**:

- Reuse Batch 1's derivation, do not re-implement it — a second copy of the
  rule is a second thing to get wrong.
- Precedence identical to 1.3.
- The `resolveModel` post-fallback ladder at `:359-366`
  (`snapshot env → defaultTiers → staticModels[0] → model`) should now be
  reached far less often. State whether it stays as a backstop or narrows.

**Acceptance**: spec for a workspace profile pinned to a no-`defaultTiers`
provider resolving to a real catalogue id. Mutation count reported.

---

### Task 2.2: skill-synthesis — verify, do not assume ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\model-resolver.ts`, `lanes\lane-resolver.service.ts`, `lanes\lane-resolver.providers.spec.ts`
**Dependencies**: 2.1

Assumption 6 predicts **zero production change**: the pinned judge id and the
lane alias both resolve once the tier env var is populated. Verify it.

**Quality requirements**:

- **Prove it with a spec**, do not assert it in prose.
- If a production change turns out to be needed: zero direct SDK imports,
  `platform-core` ports only, never adapters.
- `lane-resolver.providers.spec.ts`'s registry-coverage scan must still pass —
  it is a `Function.prototype.toString` body scan, so docblocks are outside it
  (`followup-a-report.md:176-187`). Do not name a provider in executable code.
- Correct the docblocks TASK_2026_250 wrote that are now historical:
  `model-resolver.ts` boundary section, `lane-resolver.service.ts` line-2/line-3
  bullets, `skill-synthesis/CLAUDE.md` bullets 1 and "inherit keeps a PINNED
  default".

**Acceptance**: report states plainly whether production code changed and why.
"No change needed, and here is the spec that proves it" is the expected result.

---

### Task 2.3: OpenRouter passthrough + chat `'default'` substitution ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\openrouter\openrouter-translation-proxy.ts:80-82`; `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts:418`, `:1009`
**Dependencies**: 2.1

`normalizeModelId` is the identity function
(`translation-proxy-base.ts:266`), so nothing downstream repairs a bad id.
Confirm that with Batch 1 in place nothing bad arrives, and that the two
`'default'` substitution sites need no change.

**Quality requirements**: prefer **no change**. If `rpc-handlers` must change,
say why Batch 1 did not cover it — that would mean Assumption 2 is incomplete
and is worth flagging loudly.

**Acceptance**: an end-to-end spec from the chat entry point through to the id
the proxy would send.

---

**Batch 2 verification**:

- All four callers from `context.md:44-60` resolve to a real catalogue id.
- No provider-id literal added to any `skill-synthesis` executable body.
- `skill-synthesis` still has zero direct SDK imports.
- Gate green, including `rpc-handlers`.

---

## Batch 3: Unresolvable-tier surfacing ⏸️ CONDITIONAL — PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: sequential
**Rationale**: Product-shaped and cross-cutting (chat + lanes + profiles). Only
a sub-agent can weigh Task 1.7's recommendation against the residual hole Task
1.4 actually measured.
**Tasks**: 2 | **Dependencies**: Batches 1 and 2, **and** an explicit go/no-go
on Task 1.7's recommendation.

> **Do not spawn this batch on autopilot.** Its scope is defined by Task 1.7's
> recommendation and Task 1.4's residual hole. If 1.4 shows the hole is closed
> in practice and 1.7 recommends against, mark this batch ❌ CANCELLED with the
> reason recorded and go straight to Batch 4. That is a good outcome, not a
> skipped one.

### Task 3.1: Implement the agreed surfacing ⏸️ PENDING

Scope from 1.7. Likely shape: a typed unresolvable-tier result the chat path
can render, aligned with the lanes' existing `auth-unresolvable` stall channel.

**Quality requirements**: no silent behaviour change to a path that already
works; the failure must be actionable ("select a model for this provider"), not
a stack trace.

---

### Task 3.2: RPC dual registration, if a namespace is added ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\shared\src\lib\...\rpc.types.ts`; `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts:46`

Any new RPC namespace requires **both** the compile-time contract and the
runtime `ALLOWED_METHOD_PREFIXES` guard (R6). One without the other fails at
runtime only.

**Acceptance**: if no namespace was added, say so and mark no_change_needed.

---

**Batch 3 verification**: gate green; new failure path has a spec that fails
without it; no existing working path changed behaviour.

---

## Batch 4: Documentation and carrier close ⏸️ PENDING

**Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: sequential
**Rationale**: Small, but it is prose **about the decisions** made in Batches
1–3, so it needs the reasoning, not just the diff. Explicitly **not** a
parallel-CLI candidate for that reason.
**Tasks**: 1 | **Dependencies**: Batches 1–3

### Task 4.1: Update the docs the earlier tasks made stale ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\auth-providers\CLAUDE.md` — `ProviderModelsService` / `DynamicModelFetcher` now own tier derivation
- `D:\projects\ptah-extension\libs\backend\skill-synthesis\CLAUDE.md` — only if Batch 2 did not already correct it
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_262\task.md` — `status:` line **only**, via `Edit`, never `Write`

**Quality requirements**:

- The "3 of 11 entries declare no `defaultTiers`" figure is still true — no
  registry entry was changed. Do not "fix" it.
- Note in `auth-providers/CLAUDE.md` that `requesty-provider-entry.ts:19-23`'s
  "tiers come from the live model list instead" is now implemented rather than
  aspirational.
- `context.md` is the historical record of the investigation. Leave it.

---

## Executor summary

| Batch | Executor            | Mode       | Parallel-eligible                                |
| ----- | ------------------- | ---------- | ------------------------------------------------ |
| 1     | `backend-developer` | sequential | No — same files, coupled decisions               |
| 2     | `backend-developer` | sequential | No — 2.2/2.3 expectations depend on 2.1          |
| 3     | `backend-developer` | sequential | No — conditional, product-shaped                 |
| 4     | `backend-developer` | sequential | No — prose about decisions, not mechanical edits |

**No batch qualifies for parallel CLI execution.** The file-disjointness test
fails for 1 and 2 (both concentrate in `provider-models.service.ts` and the
`auth-providers` spec tree), and 3 and 4 are judgement work. Splitting them
would create conflicts rather than throughput.

---

## Status legend

⏸️ PENDING · 🔄 IN PROGRESS · 🔄 IMPLEMENTED · ✅ COMPLETE · ❌ FAILED/CANCELLED

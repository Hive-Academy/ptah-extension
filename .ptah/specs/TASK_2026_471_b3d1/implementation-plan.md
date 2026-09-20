# Implementation Plan — TASK_2026_471_b3d1: TypeSafe (Jev) typed judgments in Ptah

Design only. No production code is written by this task.

Inputs read: `research-typesafe-api.md`, `evidence-skill-synthesis.md`,
`evidence-memory-curator.md`, root `CLAUDE.md`,
`libs/backend/platform-core/CLAUDE.md`, plus first-hand reads of
`skill-judge.service.ts:1-200`, `memory-contracts/src/lib/curator-llm.port.ts`,
`memory-contracts/src/lib/tokens.ts`, `memory-search.service.ts:285-344`,
`agent-sdk/src/lib/di/register.ts:485-508`,
`gates/trigger-eval.service.ts:1-30`, `gates/replay-validator.service.ts:10-20,180-196`,
`memory-curator/CLAUDE.md:70-89`, and a directory listing of
`libs/backend/skill-synthesis/src/lib/lanes/`.

**Every TypeSafe API detail below is UNVERIFIED.** The research was fetched
through a summarizing tool. Field names, response shapes, the `jev-latest` model
id, the presence of `confidence` on Score, its absence on Noul, and the
`$0.06 / 1,200 calls` anchor are all treated as claims to be confirmed, never as
contracts. See `## What must be verified before coding`.

---

## Recommendation

Do not adopt TypeSafe into any production path in this repository now.

Build one thing instead: an **offline calibration harness**, gated behind an env
var, that replays existing `skill_candidates` rows through both today's judge and
a Jev Score battery and measures which composite better separates skills that
were later invoked from skills that were never invoked. Ship nothing to users.

If and only if that harness passes its stated criterion, adopt exactly **one**
decision point — D4, the skill judge (`skill-judge.service.ts:171`) — behind a
new zero-dependency port in a new `judgment-contracts` lib, opt-in, off by
default, consulted before the lane and never inside it.

Reject every retrieval and memory-curation candidate. The cross-encoder reranker
at `memory-search.service.ts:311-340` already answers the relevance question
locally, and the real defect on the curator's resolve path is an exact
string-equality candidate filter (`memory-curator.service.ts:603-612`), not a
missing model.

The decisive reason to start with D4 and nowhere else: **it is the only decision
point in this repository with an available ground-truth label.** Invocation
telemetry records real usage per slug (`SkillTriggerService.onPostToolUse` →
`SkillInvocationRecorder`, slug-keyed `skill_invocation_events`, read as
`getInvocationStats(slug).total`; `skill-synthesis/CLAUDE.md`, invocation
telemetry bullet). Nothing labels a correct `mergeTargetId`, a correct
`salienceHint`, or a correct `evidenceClass`. Adopting a probabilistic judgment
where no outcome label exists means swapping one unfalsifiable opinion for
another and paying a network round trip for it.

**Invocation telemetry is a behavioral proxy, not a correctness label.**
`skill_invocation_events` records that a skill ran after the existing promotion
gate let it through. It does not record that the skill was right, useful, or
triggered at the correct moment, and it cannot record anything at all about a
skill the gate never promoted. A judge scored against it therefore measures
exposure and the current gate, not judgment quality. Any conclusion drawn from
it must be stated as "predicts invocation", and a claim about correctness needs
an independent label a person assigns.

---

## Adopt

### A1 (conditional on the experiment) — D4, the five-criterion skill judge

**Site**: `skill-judge.service.ts:171` (Verified — read directly; the call is
`this.laneRunner.run({ laneId: 'judge', ... })`).

**Primitive**: five **Score** questions in one request, one per criterion, plus
**no** Noul and **no** Choice. Rationale, from the primitives table in
`research-typesafe-api.md:28-38` (UNVERIFIED): each criterion is a spectrum with
defined levels, which is exactly Score's stated selection guidance. A Choice
distribution would discard the ordering that `maxCriterionDelta`
(`gates/judge-panel.service.ts:646-653`) depends on; a Noul cannot express
"partly novel".

**Exact question text to send.** Take the five criterion lines verbatim from the
rubric that already ships (`skill-judge.service.ts:124-129`, Verified — read
directly), one per `instructions` field, with the 1-10 framing stripped because
the levels now carry it:

| Question id      | `instructions`                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `novelty`        | How novel and non-obvious is this skill versus common knowledge a coding agent already has?                     |
| `actionability`  | How directly executable are the steps — imperative, concrete and ordered?                                       |
| `scope`          | Is the scope a single well-defined workflow, neither too broad nor a trivial one-off?                           |
| `generalization` | Is it repo-agnostic and transferable, with no leftover workspace paths, file names or session-specific details? |
| `triggerClarity` | Does the description state clearly WHEN to use the skill, so another agent could decide to trigger it?          |

`criteria` for each is an **ordered 5-level array**, low→high, each level written
as a concrete situation rather than an abstract qualifier — the docs' own best
practice (`research-typesafe-api.md:57`, UNVERIFIED). Five, not ten: the docs
permit 2-10 and recommend testing against real data; ten levels invite a level
description nobody can distinguish, and the re-scale in `## The scale problem`
makes level count a free parameter anyway. Example for `generalization`, whose
level text must be derived from the existing rubric's own instruction to "Score
1-3 if it merely echoes one session or restates the user's request"
(`skill-judge.service.ts:128`, Verified):

```
0  The body names a specific workspace path, repository or session and would not run anywhere else.
1  The body restates one session's work with its file names left in place.
2  The workflow generalizes but several concrete identifiers from its origin remain.
3  The workflow is repo-agnostic; one or two incidental specifics remain.
4  No workspace path, file name or session detail appears; the workflow applies to any repository.
```

**State to send**: `{ name, description, body }` of the candidate, the same three
fields `buildJudgePrompt` already composes (`skill-judge.service.ts:174`
constructs it; the builder is at `:289-312` per the evidence map — Assumption,
the builder body was not read; the implementer must confirm the field set before
sizing the request). **The rubric does not travel.** Today it must ride
`systemPromptAppend` because `maxInputChars` clips `prompt`
(`skill-judge.service.ts:29-34`, Verified). Under TypeSafe the rubric IS the
`criteria` structure, which is not the state, so the whole clipping hazard the
header describes disappears — that, not the JSON ladder, is the largest
structural gain here.

**How the answer maps onto what the caller needs today**: the caller needs a
`JudgeDecision { status, score, criteria, reason }`
(`skill-judge.service.ts:83-90`, Verified). Mapping:

- five `answers[k].score` values, each linearly re-scaled to 1-10 by the formula
  in `## The scale problem`, become `JudgeCriteria` — unchanged shape, unchanged
  column set, no migration.
- their plain mean becomes `score`, exactly as `:345-351` computes it today
  (per the evidence map — Assumption, that range was not read first-hand).
- `status: 'scored'`, `reason: JUDGE_REASONS.verdict` on a confident answer.
- **a new sixth reason token, `judge-low-confidence`**, returns `unscored` when
  any criterion's `confidence` falls below the threshold set by the experiment.

**I disagree with the evidence map here.** `evidence-skill-synthesis.md:93-95`
claims a typed judgment removes "two of the four reason tokens (`noJson`,
`invalidScores`) by construction". That is only true of the parse; it is not true
of the reason _set_. `callThrew` must stay — `api.md` lists 401/422/429/529
(`research-typesafe-api.md:72`, UNVERIFIED) and all four are throws or non-answers.
`disabled` must stay. And a calibrated probability introduces a failure mode the
LLM path does not have: a confidently-spread distribution, which is a real
"I do not know" and must be nameable. Net reason count goes from four to five,
not from four to two. Anyone selling this change as simplification is measuring
the wrong thing; the gain is calibration, if it exists at all.

**Cost of adopting**: a new external dependency on the backend side of the
hexagon; a new network egress path carrying skill bodies; a new secret to store;
a fifth reason token; a re-derived threshold and a re-derived
`maxCriterionDelta`; and a permanent second code path, because contract 3 (a host
with no key must still work) means the lane path at `:171` can never be deleted.
That last item is the real price: this is additive forever, which is exactly what
the repository's "Replace, do not accumulate" rule normally forbids. It is
tolerable here **only** because the compatibility requirement is external (no
network key on a host) and not a migration convenience. Record it at the call
site with that reason.

### A2 — the calibration harness itself (adopt unconditionally, ships nothing)

See `## First experiment`. This is the only work this task should authorize
without further evidence.

---

## Reject

### R1 — every retrieval path. The local reranker wins.

`memory-search.service.ts:311-340` (Verified — read directly) already runs a
cross-encoder over the top `limit * 4` fused candidates, truncated to 512
characters (`:315`), through an in-process worker client (`:323`), with a
documented fallback to RRF order and a warn on failure (`:331-338`). It costs
zero network calls, zero dollars, and survives a host with no key by construction.

A TypeSafe Noul-per-pair rerank — the shape `cookbooks/rerank_typesafe.md`
teaches (`research-typesafe-api.md:93-99`, UNVERIFIED) — would be strictly worse
on this path: one HTTP round trip per (query, candidate) pair on a path that
already has a working local answer. The cookbook's own benchmark replaced BM25
with nothing after it; here there is something after it. **Do not adopt on any
retrieval path.** The rerank cookbook is a template for systems that lack a
reranker; this system has one.

### R2 — memory-curator `resolve` (ranked #1 in `evidence-memory-curator.md:247`)

The evidence map ranks this first. I disagree, on its own evidence.

The candidate set handed to the resolve prompt is built by exact, case-sensitive
string equality — `m.subject && subjects.has(m.subject)`
(`memory-curator.service.ts:610`, per the evidence map) — while the prompt itself
asks for case-insensitive matching (`resolve-prompt.ts:19`). The model can only
merge into memories whose subject already matches byte for byte. That is a
retrieval defect, not a judgment defect. A typed pairwise judgment over the same
byte-matched candidate set would produce a well-typed confidence about a
candidate list that already excluded the right answer.

The correct change is local and free: feed the resolve candidate set from the
hybrid search that exists in the same library (`searchRich`,
`memory-search.service.ts:291-310`), which already fuses BM25 and vectors and
already reranks. Then, and only then, is there a question worth asking a model.
That change is out of scope for this task but should be filed; it is the higher-
value work and it costs no network.

Second reason to reject: cost shape. A pass already spends up to 9 LLM calls
(8 extract windows + 1 resolve; `memory-curator/CLAUDE.md:83`, Verified — read
directly) with measured windows at 24, 37 and 27 seconds (`:84`, Verified). A
pairwise fan-out multiplies call count by draft count × candidate count on a path
whose stated budget unit is calls per pass (`evidence-memory-curator.md:237-239`).

### R3 — the memory trigger cue regexes (`evidence-memory-curator.md:249`, item 3)

`DEFAULT_CUE_LIST` is seven regexes gated by `minPromptLength: 20`
(`memory-trigger-config.ts:64-72`, `:99`, per the evidence map). Replacing it
with a Noul means a network round trip on **every user prompt that clears 20
characters**, before anything else happens, and it means every user prompt leaves
the machine. That is the worst privacy trade in the whole inventory and it sits
on a latency-sensitive path. Reject outright, not defer.

### R4 — the BM25/vector weight switch (`evidence-memory-curator.md:252`, item 6)

`const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;`
(`memory-search.service.ts:307-308`, Verified — read directly). It is a
classification standing in as a constant, and the evidence map is right about
that. It is also on the synchronous search path, in front of a reranker that will
re-order the result anyway. A network call to choose a fusion weight that a
downstream cross-encoder then overrules is cost with no observable outcome.

### R5 — D1 prefilter and D6's scoring half

Local by contract, both. `hasSessionWorkEvidence` is a counting rule
(`eligibility/session-work-evidence.ts:19-23`, per the evidence map), and
`TriggerEvalService`'s header states the constraint in its own words: "Nothing in
the scoring path may ever call a model, because the moment a model scores the
retrieval this stops being a measurement and becomes a second judge, which is the
thing it exists to replace" — and a spec pins the call count at one and scans the
file's text for a second `laneRunner.run(` call site
(`gates/trigger-eval.service.ts:16-25`, Verified — read directly). A TypeSafe
call is a model call. It would fail the intent even where it passed the scan.

### R6 — D2 `evidenceClass` (ranked #3 in `evidence-skill-synthesis.md:245`)

A closed five-way enum with a built-in `unverified` abstain is the cleanest Choice
target in the repository on paper. It fails on state. The classification depends
on multi-pass retrieval over a transcript larger than any single context window,
served by `archaeology/transcript-window.reader.ts`
(`evidence-skill-synthesis.md:155-157`), and retrieval is driven from TypeScript
because a reply may carry `requestTurns` / `requestSearch`
(`archaeology/session-verdict.types.ts:159-177`, per the evidence map). The
TypeSafe API takes one `state` and answers (`research-typesafe-api.md:70`,
UNVERIFIED). There is no tool loop to serve windows into. You would have to send
the whole transcript, which is the thing the window reader exists because you
cannot do. Reject until a hybrid is designed where the lane still runs the
retrieval loop and hands a settled window set to a Choice — which is a different,
larger task.

### R7 — D5, the judge panel escalation

Reject for now, and re-justify rather than port. The panel exists because one LLM
scorecard is one noisy sample; both panellists must answer the same five criteria
on the same 1-10 scale because escalation compares per criterion
(`gates/judge-panel.service.ts:369`, `:646-653`, per the evidence map), and the
library's own doc states rule 1 as "the scorecard shape never varies … vary the
question, never the answer format" (`skill-synthesis/CLAUDE.md`, judge PANEL
bullet, Verified — read directly). A mixed Jev-plus-LLM panel violates that
directly: two different estimators on two different scales make every delta
noise. If A1 ships and Jev proves calibrated, the honest move is to re-examine
whether the panel's variance rationale still holds — not to make one panellist
Jev.

---

## Defer

Ranked, highest first. Each is deferred behind A1's port existing and A1's
experiment passing; none should be started before both.

1. **D7, the replay comparator** (`gates/replay-validator.service.ts`). The
   comparator is constrained to `{alignment: 0..1, rationale}`
   (`REPLAY_ALIGNMENT_JSON_SCHEMA`, `:184-190`, Verified — read directly), which
   is a single Noul with a rationale bolted on. Its `null`-is-not-zero contract
   (`:16`, Verified — read directly: "a `null` hold-out yields a `null`
   confidence, not a low one") maps cleanly onto abstention. Deferred for two
   reasons: only the _comparator_ is a judgment — the plan call that precedes it
   is generative and stays on the lane, so the saving is one call of two; and
   there is no labelled alignment data anywhere, so the threshold
   `minConfidence` (read at `skill-promotion.service.ts:441-492`, per the
   evidence map) cannot be re-derived by the method `## The scale problem`
   prescribes. Cost of deferring: nothing; it is currently correct.
2. **D8, the curator overlap pass** (`skill-curator.service.ts:288`). Highest
   defect risk, lowest blast radius — it never auto-deletes, it logs, reports and
   queues (`:4-8`, per the evidence map) — and it is the one call in the library
   that deliberately sends no `outputSchema`, because the answer is a JSON array
   and the runner's ladder resolves objects only (`:15-18`, per the evidence
   map). A pairwise Noul removes that whole limitation. Deferred because the
   fan-out is quadratic in library size against a residency budget of 200
   (`maxActiveSkills`, `skill-synthesis/CLAUDE.md`, Verified), so it needs the
   lens's neighbour pre-selection (`gates/judge-panel.service.ts:448-495`) built
   first. Cost of deferring: an unschema'd array parse stays in the codebase.
3. **The curator's `kind` classification and `salienceHint`**
   (`extract-prompt.ts:14`, `:27`). `salienceHint` is described in the prompt as
   "your subjective importance" (per the evidence map) and is written once on
   insert, with every recency and reuse effect living in the query-time ranking
   expression (`memory-curator/CLAUDE.md:79`, Verified — read directly). A
   calibrated probability is a better number than a self-reported one, in
   principle. Deferred because there is no label: nothing in the schema records
   whether a memory later mattered. `MemoryUsageRecorder` exists
   (`MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`,
   `memory-contracts/src/lib/tokens.ts:4`, Verified) and _could_ become that
   label; building the label is the prerequisite, and it is a separate task.
4. **D3 / D9 generation** — not judgments. Free-form authoring. Out of scope
   permanently, not deferred.

---

## Port design

### Where it lives — and where it must not

**Not `platform-core`.** Its own boundary section excludes business and domain
logic and forbids importing any other backend lib
(`platform-core/CLAUDE.md:18-24`, `:225`, `:233`, Verified — read directly). A
typed-judgment provider is a domain capability, not a platform capability; there
is no VS Code / Electron / CLI variation in it. Putting it there would also drag
a 28-token platform registry into a decision about LLM judgments. The evidence
map floats `platform-core` as an option (`evidence-skill-synthesis.md:213-214`);
I am rejecting that half of its suggestion.

The precedent to follow is `memory-contracts`: a zero-dependency contracts lib
whose port is implemented in a separate lib and registered by the host
(`memory-curator/src/lib/di/register.ts:9-10` states the rule explicitly — "The
CURATOR_LLM … is registered by agent-sdk … NOT by this function", Verified). The
repository already runs three such libs: `memory-contracts`,
`voice-contracts`, `auth-providers-tokens` (root `CLAUDE.md`, Backend Libs list,
Verified).

### The four artifacts

| Artifact | Path                                                               | Rule                                                         |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Port     | `libs/backend/judgment-contracts/src/lib/typed-judgment.port.ts`   | zero runtime deps, no SDK type in any signature              |
| Token    | `libs/backend/judgment-contracts/src/lib/tokens.ts`                | `JUDGMENT_TOKENS.TYPED_JUDGE = Symbol.for('PtahTypedJudge')` |
| Adapter  | `libs/backend/judgment-typesafe/src/lib/typesafe-judge.adapter.ts` | the ONLY file in the repo that may import `@typesafe-ai/sdk` |
| Register | `libs/backend/judgment-typesafe/src/lib/di/register.ts`            | conditional; called from each host's activation              |

### The interface

One method. A discriminated union return, modelled directly on
`CuratorExtraction` (`curator-llm.port.ts:94-111`, Verified — read directly),
because that union is the repository's settled answer to "how does a judgment say
it did not happen":

```
ask(request: JudgmentRequest, signal?: AbortSignal): Promise<JudgmentOutcome>
```

`JudgmentRequest` carries `state: unknown` and a map of question id → a plain
description of the question (`kind: 'score' | 'choice' | 'noul'`, `instructions:
string`, `levels` / `options` as plain arrays and records). No `@typesafe-ai/sdk`
type appears. This satisfies constraint 1 and the `memory-contracts` zero-dep
rule (`memory-contracts/CLAUDE.md`, Guidelines, Verified — read directly).

`JudgmentOutcome` has **three** arms, and the third is the one that matters:

- `{ status: 'answered', answers }` — `answers[id]` carries `value` and
  `confidence: number | null`. `confidence` is nullable **because Noul is
  documented as carrying no confidence field** (`research-typesafe-api.md:62`,
  UNVERIFIED). Modelling that as nullable at the port keeps the API's asymmetry
  from becoming a lie in our types.
- `{ status: 'unavailable', reason }` — no key, no adapter, opted out.
- `{ status: 'stalled', reason }` — dispatched, no answer: 429, 529, network
  class, abort. The same argument `curator-llm.port.ts:53-92` makes: a stall and
  an empty answer must not be byte-identical, because the caller's retention
  decision differs.

**Do not collapse `unavailable` and `stalled`.** `unavailable` is permanent for
this host and must map to `judge-disabled` (which blocks nothing); `stalled` is
transient and must map to `unscored` (which leaves the row retry-eligible)
(`skill-judge.service.ts:15-20`, `:70-81`, Verified — read directly). One arm
would force the caller to guess, and guessing wrong in the permanent direction
carries a backoff forever on a host that can never answer — the exact mistake the
library's conditional-registration rule exists to avoid.

### Registration phase and host matrix

Registered in the adapter lib's own `registerTypedJudgmentServices(container)`,
called from each host's activation at the same phase as
`SDK_TOKENS.SDK_CURATOR_LLM_ADAPTER` today
(`agent-sdk/src/lib/di/register.ts:499-503`, Verified — read directly:
`container.register(SDK_TOKENS.SDK_CURATOR_LLM_ADAPTER, { useClass:
SdkInternalQueryCuratorLlm }, { lifecycle: Lifecycle.Singleton })`).

**Registration is conditional on a resolved key.** No key → the token is never
registered at all. Not a null object, not a stub answering "I am not here" — the
library's own reasoning against that is explicit: "registering a handler that
could only ever answer 'I am not here' spends a claim and an attempt to say what
'no handler for stage X' says for free" (`skill-synthesis/CLAUDE.md`,
conditional-registration bullet, Verified — read directly).

Consumers inject `@inject(JUDGMENT_TOKENS.TYPED_JUDGE) { isOptional: true }`,
matching how all four LLM collaborators are injected today
(`evidence-skill-synthesis.md:231-233`; `skill-synthesis/CLAUDE.md`, "all three
are injected `{isOptional:true}`", Verified).

**What happens with no key**: `SkillJudgeService.judge` finds the collaborator
undefined and falls through to `this.laneRunner.run(...)` at
`skill-judge.service.ts:171`, byte for byte as today. VS Code, Electron and CLI
all behave exactly as they do now. Constraint 3 satisfied by the absence of a
registration, not by a branch.

### Not a lane. Ever.

Constraint 2 is mechanical: `lane-resolver.providers.spec.ts` exists
(Verified — listed in `libs/backend/skill-synthesis/src/lib/lanes/`) and scans
compiled function bodies across `LaneResolverService.{resolve,readConfig,readConfigs}`
plus the free functions `resolveLaneModel` and `resolveJudgeModel`
(`skill-synthesis/CLAUDE.md`, lane semantics rule 1, Verified — read directly).

The typed judge therefore sits **beside** the lane, not inside it:
`SkillJudgeService` consults the optional collaborator first; on `unavailable`
or `stalled` it runs the existing lane call. No provider-id literal, no endpoint
name and no fifth `SkillLane` enters the resolution chain. Add one new mechanical
scan in the adapter lib's spec asserting that no file under
`libs/backend/skill-synthesis/src/lib/lanes/` mentions the adapter package —
the existing scan would not catch a new literal added outside the five scanned
functions.

### Budget and governance

A TypeSafe call is still a call (constraint 3). The adapter must ledger its
reported `usage.input_tokens` / `usage.output_tokens`
(`research-typesafe-api.md:71`, UNVERIFIED) into `SkillBudgetStore` on the same
UTC-day-and-stage key the lane runner writes, and `judge` must stay in
`TOKEN_SPENDING_STAGES`. A token ledger that silently stops counting when the
provider changes is exactly the defect `trigger-eval` and `prefilter` each
shipped once (`skill-synthesis/CLAUDE.md`, drain semantics, Verified).

---

## The scale problem

### What changes

Today: five ordinals in 1-10, validated to coerce to a finite 1-10 number or the
whole scorecard is rejected, composited as a plain mean, compared by the caller
against `minJudgeScore`, default `6.0` (`skill-judge.service.ts:105-115`
constrains the schema to `minimum: 1, maximum: 10`, Verified — read directly;
validation at `:332-359` and the mean at `:345-351` per the evidence map;
default at `skill-synthesis.service.ts:142` per the evidence map).

Under Score: `score` is documented as "each level's index times its probability,
summed" over levels numbered from 0 (`research-typesafe-api.md:55-56`,
UNVERIFIED). For `L` levels that is an expectation in `[0, L-1]`.

### The re-derivation, in order

1. **Re-scale per criterion, not per composite.**
   `s = 1 + 9 · (score / (L − 1))`, with `L = 5`. This keeps `judge_score` a
   float in 1-10 and keeps the five per-criterion columns meaning what they mean
   today, so **no migration and no UI change** — satisfying constraint 6. Do this
   per criterion and composite afterwards; compositing first and re-scaling the
   composite would be arithmetically identical for a plain mean but would break
   the moment the panel compares per criterion.

2. **Accept that the estimator changed, and do not paper over it.** An
   expectation over a distribution is not an ordinal pick. A Score whose mass
   sits between levels 3 and 4 returns 3.5; the LLM would have written 7 or 9.
   The consequence is systematic: **the composite distribution compresses toward
   its middle.** A fixed `6.0` applied to a compressed distribution rejects more
   candidates than it does today if the mass sits below the midpoint, and fewer
   if above. There is no analytic correction, because the compression depends on
   each criterion's prior. Do not attempt one.

3. **Re-derive the threshold empirically, by preserving throughput.** Over the
   existing corpus of `skill_candidates` rows with `judge_status = 'scored'`,
   compute today's composite `t` and the Jev composite `j`. Choose `t′` such that
   `P(j ≥ t′) = P(t ≥ 6.0)` on that corpus — the quantile that keeps the
   promotion rate unchanged. Ship `t′` as its own settings key beside
   `minJudgeScore`, never as a replacement for it: two estimators need two
   thresholds, and one host may run both paths depending on key availability.

4. **Then check that `t′` is not merely equal but better**, by the AUC test in
   `## First experiment`. Preserving throughput is a safety property, not a value
   claim. A re-derived threshold that reproduces today's promotion rate while
   promoting a _worse_ set is the most likely bad outcome of this whole proposal
   and is invisible to every check except an outcome label.

5. **Re-derive `maxCriterionDelta` separately.** Its default is 3 with a strictly-
   greater comparison (`gates/judge-panel.service.ts:140`, `:374`, per the
   evidence map) on a 1-10 ordinal scale. After compression, a delta of 3 between
   two re-scaled expectations is a much larger disagreement than a delta of 3
   between two ordinal picks. It must be re-derived from the observed delta
   distribution — take the same quantile of `|a − b|` that 3 occupies today. Do
   not carry the constant across. (This only becomes live if R7 is ever revisited;
   record it now so the number is not carried over by default later.)

6. **Abstention threshold on `confidence`.** The docs recommend a three-tier
   usage and state that thresholds are use-case-specific, to be tuned against
   observed data rather than fixed (`research-typesafe-api.md:63-64`,
   UNVERIFIED). Start conservative: any criterion below the chosen confidence
   floor returns the whole scorecard `unscored` with reason
   `judge-low-confidence`. Whole-scorecard, not per-criterion, because
   `JudgeCriteria` is deliberately non-nullable — "a partial scorecard is exactly
   the condition that produces an `unscored` verdict"
   (`skill-judge.service.ts:47-53`, Verified — read directly).

### What must be measured on real data before anyone trusts the threshold

- The distribution of `j` over the existing scored corpus, and its overlap with
  the distribution of `t`. If Spearman ρ between them is high and the AUCs are
  equal, the change is a re-typing with a network bill and should not ship.
- The confidence distribution per criterion. If more than a small fraction of
  rows abstain, the gate's throughput drops and the drain grows a backlog.
- The observed `|a − b|` distribution, if and only if R7 is revisited.
- Actual USD and wall-clock per call, measured — replacing the
  `$0.06 / 1,200 calls` figure, which is one cookbook's reported total for an
  unstated token size (`research-typesafe-api.md:99`, UNVERIFIED and explicitly
  flagged there as "too thin to size" this work).

---

## Privacy and host matrix

State this plainly, because it is the strongest argument against the whole
proposal and it must not be buried.

**What would leave the machine.** For the judge: a candidate's name, description
and body. The `generalization` criterion exists precisely because bodies carry
"leftover workspace paths, file names, or session-specific details"
(`skill-judge.service.ts:128`, Verified — read directly) — so the candidates that
score lowest are exactly the ones carrying the most identifying content, and they
are sent before anyone knows they score low. For the curator (deferred, R2/defer
item 3): raw transcript splices (`buildExtractUserPrompt`, `extract-prompt.ts:31-33`,
per the evidence map) and the user's stored memories.

**A fully-local install exists today and this would break it.** The curator rides
the `haiku` tier alias of the resolved provider (`sdk-internal-query.curator-llm.ts:161`,
per the evidence map), and `lm-studio` is a registered provider described in this
repository as "a local server holding whatever model the user loaded"
(`skill-synthesis/CLAUDE.md`, "Inherit" bullet, Verified — read directly). A user
running that configuration has chosen that no session content leaves their
machine. TypeSafe is a single named third-party endpoint
(`https://api.typesafe.ai/v1/systemone`, `research-typesafe-api.md:68`,
UNVERIFIED) with no local option documented anywhere in the research.

**Verdict: opt-in, off by default, per subsystem.** Not one global switch — a
user may reasonably accept sending a synthesized, repo-agnostic skill body and
refuse sending their memories. Two keys, defaulting off.

- Enablement flags belong in `FILE_BASED_SETTINGS_KEYS` /
  `FILE_BASED_SETTINGS_DEFAULTS` (`platform-core/CLAUDE.md:229`, Verified), read
  transparently through `IWorkspaceProvider.getConfiguration()` (root
  `CLAUDE.md`, marketplace section, Verified). They must not go into VS Code
  `package.json contributes.configuration`.
- The API key is a secret and belongs in the `settings-core` secret envelope /
  `ISecretStorage` (`PLATFORM_TOKENS.SECRET_STORAGE`,
  `platform-core/CLAUDE.md:180`, Verified), never in a settings file and never in
  an env var read at module scope.
- The opt-in copy must name what is sent, not that "AI features" are enabled. A
  consent that does not say "your synthesized skill bodies, which may contain
  file names from your workspace, are sent to api.typesafe.ai" is not consent.

**Host matrix.** All three hosts behave identically because behaviour keys on
_registration_, not on host:

| Host     | Key configured | Behaviour                                           |
| -------- | -------------- | --------------------------------------------------- |
| VS Code  | no             | token unregistered → lane path at `:171`, unchanged |
| VS Code  | yes + opted in | typed judge, falls back to lane on `stalled`        |
| Electron | no             | as above                                            |
| Electron | yes + opted in | as above                                            |
| CLI      | no             | as above; also the common e2e/CI case               |
| CLI      | yes + opted in | as above                                            |

No host is privileged and no host branches. That is the point of putting the
decision in registration.

---

## First experiment

**Smallest change that proves or disproves the value. Ships nothing. No RPC, no
host registration, no settings key, no user-visible behaviour.**

**Form**: one spec file in the new `judgment-typesafe` lib, `describe.skip` unless
an env var is set — the precedent is `off-thread-process-spawner.perf.spec.ts`,
which is skipped unless `PTAH_PERF_SPECS=1` (`agent-sdk/CLAUDE.md`, spawner
bullet, Verified — read directly). Gate this one on `PTAH_JUDGE_CALIBRATION=1`
plus a present API key. In CI, with neither set, it does not run and costs
nothing.

**Data, all of it already on disk**: read-only against the developer's own
`~/.ptah/state/ptah.sqlite`.

- Population: `skill_candidates` rows where `judge_status = 'scored'` and the
  body file resolves (`readCandidateBodyFile`, `candidate-body.ts`, per the
  library's own structure section, Verified).
- Label: joined from `skill_invocation_events` by slug — the outcome signal that
  drives auto-enhance eligibility today (`getInvocationStats(slug).total`,
  `skill-synthesis/CLAUDE.md`, Verified). Positive = invoked at least once after
  promotion; negative = promoted and never invoked.
- Secondary label, for the rows the primary label cannot reach: promoted-and-
  still-resident vs demoted to `dormant` by the residency budget
  (`SkillPromotionService`, `maxActiveSkills`, Verified).

**Precondition, and it is a result if it fails**: at least 200 scored rows with at
least 30 positives. Below that the AUC confidence interval is wider than the
effect size being tested, and the honest answer is "this repository does not yet
hold enough evidence to decide" — which closes the task without spending
anything.

**Procedure**: for each row, one TypeSafe request carrying the five Score
questions of A1 against `{name, description, body}`. Record per criterion:
`score`, `probabilities`, `confidence`. Compute `j` by the re-scale and mean of
`## The scale problem`. Record `usage` and wall-clock per call.

**Measures**

1. AUC of today's composite `t` against the label.
2. AUC of `j` against the same label, same rows.
3. Spearman ρ between `t` and `j`.
4. Fraction of rows where any criterion's `confidence` falls below each candidate
   abstain floor (sweep it; do not fix it in advance).
5. Total USD and wall-clock for N calls, and the derived per-call figures.

**Pass criterion — all four must hold**

- AUC(`j`) ≥ AUC(`t`) + 0.05.
- Measured cost per call ≤ the judge lane's current measured cost per call.
- Abstain fraction ≤ 5% at the confidence floor chosen.
- Spearman ρ < 0.95 — because a near-perfect correlation means the two estimators
  rank identically and the AUC difference is noise, however it came out.

**Fail on any one → do not adopt. Record the numbers and close the task.**

**The confound, stated because it will otherwise be discovered late.** Today's
composite already gated promotion at 6.0, so the invocation label is only
observable for rows that passed. Every AUC computed on promoted rows is
conditional on today's judge having approved them, which biases _against_
today's composite showing separation (its low-scoring failures were never given
the chance to fail visibly) and therefore flatters `j`. Two mitigations, run
both: restrict measure 1 and 2 to the promoted subset and report them as
conditional; and run the secondary dormancy label over the full scored
population, where the selection is different. If the two labels disagree on which
estimator wins, that disagreement is the finding — report it and do not adopt.

---

## What must be verified before coding

Nobody writes an adapter until every row below is confirmed against the real SDK
and the live API, by reading source or by one authenticated probe. The research
deliverable was produced through a summarizing fetch tool and says so
(`research-typesafe-api.md:4`).

| #   | Claim (currently UNVERIFIED)                                            | Source of the claim                 | How to resolve                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Score returns `score`, `probabilities`, `legend`, `confidence`          | `research-typesafe-api.md:56`       | read `typesafe-sdk-js/src/types.ts`; assert against one live call                                                                                                                                                                                   |
| 2   | `score` = Σ(level index × probability), levels numbered from 0          | `:55-56`                            | one live call with a known-skewed input; check the arithmetic                                                                                                                                                                                       |
| 3   | Score `criteria` accepts 2-10 ordered levels                            | `:55`                               | send 5; send 11 and confirm the 422                                                                                                                                                                                                                 |
| 4   | Noul carries **no** `confidence` field                                  | `:62`                               | read `types.ts`; this decides the port's nullable `confidence`                                                                                                                                                                                      |
| 5   | Endpoint is `POST https://api.typesafe.ai/v1/systemone`, Bearer auth    | `:68`                               | one authenticated probe                                                                                                                                                                                                                             |
| 6   | Model name `jev-latest`; whether a pinned dated id exists               | `:70`, `:109`                       | ask the vendor / read `models.md`. **A floating model id is a reproducibility hazard for a calibrated threshold** — if no pin exists, `t′` must be re-derived on every model change, and that recurring cost belongs in the adopt/reject arithmetic |
| 7   | Errors 401 / 422 / 429 / 529; SDKs retry automatically                  | `:72`                               | read `client.ts`. If retry is not automatic, the adapter owns the backoff and must reuse `agent-sdk`'s `NetworkBackoff` shape rather than invent one                                                                                                |
| 8   | `usage` carries `input_tokens` / `output_tokens`                        | `:71`                               | one live call — required for the `SkillBudgetStore` ledger                                                                                                                                                                                          |
| 9   | Package `@typesafe-ai/sdk`, Node 20+, v0.6.0                            | `:77`, `:82`                        | `npm view`; check the published version and its license                                                                                                                                                                                             |
| 10  | Per-call cost; the `$0.06 / 1,200 calls` anchor                         | `:99`                               | measure it in the experiment. Do not size anything from the anchor                                                                                                                                                                                  |
| 11  | Whether streaming / abort is supported                                  | `:83` (explicit gap)                | read `client.ts`. The port takes an `AbortSignal`; every pass in both target libraries is abortable (`evidence-memory-curator.md:234-236`) and an adapter that cannot abort violates that                                                           |
| 12  | Data handling: retention, training use, region                          | not researched at all               | vendor terms. **Blocking for the privacy section.** Do not ship an opt-in whose copy cannot state what happens to the data                                                                                                                          |
| 13  | `buildJudgePrompt`'s exact field set (`skill-judge.service.ts:289-312`) | `evidence-skill-synthesis.md:65`    | read it — it decides the `state` payload and its size                                                                                                                                                                                               |
| 14  | The composite mean and validation ranges (`:332-359`, `:345-351`)       | `evidence-skill-synthesis.md:74-78` | read them — the re-scale must land inside the existing guards                                                                                                                                                                                       |

**Documentation defect, recorded and deliberately not fixed here.**
`libs/backend/memory-curator/CLAUDE.md:79` states "dedup happens via cosine
similarity" (Verified — read directly). No cosine implementation exists in that
library; dedup is content-identity, keyed on `sha256(subject + ' ' + content)`
(`memory-writer.adapter.ts:29,31-33,54,63`, per the evidence map). The claim is
false. Fixing it is out of scope for this task; file it separately so it is not
lost, and do not let a future reader use that line as evidence that semantic
dedup exists.

---

## Risks

1. **The permanent second path.** Constraint 3 means the lane call at
   `skill-judge.service.ts:171` can never be deleted. This proposal is additive
   by construction, against the repository's "Replace, do not accumulate" default.
   Mitigation: the compatibility requirement is external (a host with no network
   key), not a migration convenience, and must be documented as such at the call
   site with the condition under which it would be removed — which, honestly, is
   never. If that is unacceptable, the correct decision is to reject A1 too.
2. **Calibration rots with the model.** If `jev-latest` floats (verification item
   6), `t′` is valid only until the vendor ships a new model, and nothing will
   signal the drift — the promotion rate will simply move. Mitigation: the
   calibration harness must be re-runnable on demand and its last-run model id
   and threshold recorded beside the setting. If no pinned id exists, treat this
   as a reason to reject rather than a cost to absorb.
3. **Silent scale drift into SQLite.** `judge_score` is a float 1-10 and
   `replay_confidence` is 0-1, both on the wire and rendered
   (`evidence-skill-synthesis.md:235-237`). The re-scale keeps the range; it does
   not keep the _meaning_, and two estimators will have written to the same column
   over a database's lifetime. Mitigation: record the estimator per row. That is a
   migration, and it should be in the first adopting batch rather than deferred —
   a mixed column with no provenance can never be re-analyzed.
4. **Abstention becomes the common case.** If the confidence floor is set
   conservatively and the distributions are flat, most scorecards return
   `unscored`, every candidate goes back to the queue with a backoff, and the
   drain grows a backlog of rows that will abstain again. Mitigation: measure 4 of
   the experiment; the 5% pass criterion exists for this.
5. **A privileged provider creeps into the lane path.** The existing mechanical
   scan covers five functions in the resolution chain
   (`skill-synthesis/CLAUDE.md`, lane semantics rule 1, Verified), not the whole
   library. Mitigation: the new scan named in `## Port design`.
6. **Egress on a host that assumed none.** A user who configured `lm-studio` for
   privacy and later enables the judge opt-in without reading it has silently
   changed their threat model. Mitigation: default off; per-subsystem; consent
   copy that names the data. Consider refusing to enable the curator opt-in at all
   while a local provider is the resolved one, and saying why.
7. **Cost estimates are currently unfounded.** Every dollar figure in the research
   traces to one cookbook total for an unstated token size
   (`research-typesafe-api.md:99`). Nothing should be approved on that basis.
   Mitigation: measure 5 of the experiment is the only cost number anyone may
   quote.

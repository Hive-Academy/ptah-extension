# Evidence map — `libs/backend/skill-synthesis` decision points

Research only. Every claim below carries a `file:line` anchor. Paths are relative
to `libs/backend/skill-synthesis/src/lib/` unless stated otherwise.

Purpose: identify where this library turns evidence into a JUDGMENT, and which of
those judgments are today "prompt an LLM and parse the reply" — the shape a
TypeSafe System One model (Jev) could replace with a typed judgment.

## 1. The decision inventory

Every LLM call site in the library (grep `laneRunner.run(` / `internalQuery.execute(` /
`.judge(`, production files only):

| #   | Decision                                                        | Site                                                                                                | Answer shape                                                                                          | Cost       |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Is this session worth spending tokens on?                       | `skill-synthesis.service.ts:1129` (`passesPrefilter`) → `eligibility/session-work-evidence.ts:15`   | boolean, **local**                                                                                    | 0          |
| D2  | Did this session succeed, and what was the user actually after? | `archaeology/session-archaeologist.service.ts:383`                                                  | JSON verdict, `SESSION_VERDICT_JSON_SCHEMA` (`archaeology/session-verdict.types.ts:197`)              | 1–N passes |
| D3  | Draft a reusable skill from this trajectory                     | `skill-synthesizer.service.ts:179`                                                                  | `{name, description, body}` (`skill-synthesizer.service.ts:68`)                                       | 1 call     |
| D4  | Is this candidate a good skill? (5-criterion scorecard)         | `skill-judge.service.ts:171`                                                                        | `{novelty, actionability, scope, generalization, triggerClarity}` 1–10 (`skill-judge.service.ts:105`) | 1 call     |
| D5  | Second opinion + escalation tie-break                           | `gates/judge-panel.service.ts:262`, `:332`, `:512`                                                  | same scorecard shape ×2–3                                                                             | 1–3 calls  |
| D6  | Does the description actually get retrieved?                    | `gates/trigger-eval.service.ts:597` (probe generation only)                                         | prompt set; scoring is **local embedder arithmetic**                                                  | 1 call     |
| D7  | Does the drafted skill reproduce a held-out session?            | `gates/replay-validator.service.ts:423` (plan) + `:397` (comparator)                                | `{alignment: 0..1, rationale}` (`gates/replay-validator.service.ts:184`)                              | 2 calls    |
| D8  | Which promoted skills overlap or are stale?                     | `skill-curator.service.ts:288`                                                                      | JSON **array** of `{type, skillIds, reason}` (`skill-curator.service.ts:127`), **no `outputSchema`**  | 1 call     |
| D9  | Is this enhancement better than the current clone?              | `skill-enhancer.service.ts:426` (judge) + `:832` (generation, raw `internalQuery`)                  | scorecard + body                                                                                      | 2 calls    |
| D10 | Sharpen a suggestion's trigger description                      | `digest/skill-gap-curator.service.ts` header §"the one LLM call" (opt-in, default off, lines 21–54) | JSON rewrite                                                                                          | 0–1 call   |

Two decisions are already deliberately NOT model calls and are the design
precedent a Jev proposal has to respect: D1 (evidence-only prefilter) and D6's
scoring half ("nothing in the scoring path may ever call a model" —
`gates/trigger-eval.service.ts:16-25`).

## 2. D1 — prefilter: the one purely local gate

- Eligibility is **evidence-only**: edits ≥ `prefilterMinEdits`, OR non-MCP tool
  uses ≥ `prefilterMinToolUses`, OR a shell test command ran
  (`eligibility/session-work-evidence.ts:19-23`). MCP tools do not count
  (`trajectory-extractor.ts:360`).
- Defaults: `prefilterMinEdits: 1`, `prefilterMinToolUses: 2`
  (`skill-synthesis.service.ts:139-140`); re-read per host at `:1312-1318`.
- Readability floor is separate and lower: `MIN_ROLE_TURNS_FLOOR = 2`
  (`trajectory-extractor.ts:19`), applied at `skill-synthesis.service.ts:688-693`
  and re-checked in `passesPrefilter` at `:1133`.
- Rejections are bucketed `prefilterTooThin` / `prefilterRejected`
  (`skill-synthesis.service.ts:728-738`) — this is the only place the subsystem
  emits a structured "we declined to spend" signal.
- **`prefilter` is NOT cheap** despite the name: once eligibility passes the
  stage drafts a candidate with a model (`queue/stage-handlers.service.ts:272` →
  `skill-synthesis.service.ts:615` → `skill-synthesizer.service.ts:179`); the
  lib CLAUDE.md records it measured at $0.077 on one boot, the largest single
  line of a ~$0.19 boot.

**Jev relevance**: D1 is a counting rule, not a judgment — there is nothing here
for a model to improve except the thing the rule deliberately refuses to do
(judge "was this session productive" from prose). A Jev probability over the
trajectory could sit BESIDE the counters as a third disjunct, but it would have
to be cheaper than the $0.077 draft it gates, and the regex-demotion contract
(`trajectory-extractor.ts:52-64`) forbids any new success heuristic deciding
anything.

## 3. D4 — the judge: five criteria, an average, a caller-owned threshold

- Rubric is fixed text on the unclippable half (`skill-judge.service.ts:121-132`,
  sent as `systemPromptAppend` at `:173`); only the candidate material rides
  `prompt` (`:289-312`) because `maxInputChars` clips `prompt` only
  (`skill-judge.service.ts:27-34`).
- Output is constrained by a JSON Schema built from the criterion keys
  (`skill-judge.service.ts:97-115`).
- Parsing is a two-rung ladder: the lane's structured `run.json` if it is a plain
  object, else a **first-flat-object regex** over the assistant text
  (`skill-judge.service.ts:259-274`). Both rungs are load-bearing — a provider
  can honour the schema and still answer `null`, a string, or an array (`:243-250`).
- Validation: all five keys must coerce to a finite 1–10 number or the whole
  scorecard is rejected (`skill-judge.service.ts:332-342`, `:354-359`). The
  composite is a plain mean (`:345-351`).
- **The service reports a status and never decides**: `scored | unscored |
disabled` (`skill-judge.service.ts:83-90`), with four distinct reason tokens for
  the failure modes (`:70-81`). `score: 10` appears nowhere — the three former
  fail-open sites now return `unscored` (`:186`, `:217`, `:227`).
- Thresholding is the caller's, three different policies:
  - promotion: `< minJudgeScore` rejects, `unscored` leaves the row a candidate
    for retry (`skill-promotion.service.ts:564-590`);
  - curator suggestion pass: any non-`scored` verdict files no suggestion at all,
    because `judge_score` is a NUMBER column (`skill-curator.service.ts:491-504`);
  - enhancer: automatic runs require `scored`, a MANUAL run is refused only by an
    explicit low score (`skill-enhancer.service.ts:457-463`).
- Default `minJudgeScore: 6.0` (`skill-synthesis.service.ts:142`).

**Jev relevance**: this is the single highest-value replacement target. It is a
bounded, rubric-driven, 5-dimensional judgment over one short document, whose
answer is already a typed struct, whose failure modes are already enumerated, and
whose consumers already tolerate "no verdict" (`unscored`). A typed judgment
would remove the JSON-extraction ladder (`:259-274`), the coercion guard
(`:354-359`) and two of the four reason tokens (`noJson`, `invalidScores`) by
construction. Caveat: the criteria are 1–10 ordinal scores averaged and compared
to a float threshold — a Jev probability is a different scale and the threshold,
the panel's per-criterion delta (§4) and the stored `judge_score` column would all
have to be re-derived, not merely re-typed.

## 4. D5 — the panel: where the scorecard shape is load-bearing

- Panellist A judges the artifact alone; panellist B judges it through a **lens** —
  nearest description neighbours + already-measured gate results
  (`gates/judge-panel.service.ts:429-436`, neighbours at `:448-495`).
- Both panellists must answer the **same five criteria on the same 1–10 scale**,
  because escalation compares PER CRITERION (`gates/judge-panel.service.ts:369`,
  `maxCriterionDelta` at `:646-653`); a reshaped rubric on one side turns every
  delta into noise (`:13-28`).
- R8: a non-`scored` first verdict ends the panel at one call
  (`gates/judge-panel.service.ts:271-290`).
- A degenerate lens (no neighbours AND nothing measured) skips the second call
  (`:314-330`), reason `judge-panel-lens-degenerate` (`:163`).
- Agreement within threshold ⇒ per-criterion MEAN (`:374-390`, `meanCriteria` at
  `:656-665`); disagreement above it ⇒ a third call on the `synthesis` lane
  (`:505-578`) and the mean is explicitly NOT the fallback (`:74-78`).
- Threshold default 3, strictly-greater comparison (`:140`, `:374`); negative
  values are rejected, `0` is honoured (`:629-642`).
- Persistence is all-or-nothing and deliberately un-wrapped: an impossible verdict
  MUST reach the store and throw (`:587-606`).
- Hard constraint: this library imports nothing from the multi-vendor tribunal,
  asserted by a source scan (`:36-53`).

**Jev relevance**: the panel exists because one LLM scorecard is one noisy sample.
If a Jev judgment is deterministic/calibrated, the second panellist's purpose
changes from "variance reduction" to "different evidence" — which it already
partly is (the lens). The escalation's value is the part most at risk of
becoming dead code, and `maxDelta`/`meanCriteria` assume a comparable ordinal
scale on both sides, so a mixed Jev-plus-LLM panel would violate the "same answer
format" contract at `:70-73`.

## 5. D2 — the archaeologist: multi-pass retrieval, orchestrated in TypeScript

- Verdict fields and their nullability contract: `intent`, `outcome`,
  `evidenceClass`, `routine` all nullable, and a `degradedReason` row with a null
  intent is a FIRST-CLASS record (`archaeology/session-verdict.types.ts:13-19`).
- `EvidenceClass` is a CLOSED five-member vocabulary enforced three times — TS
  union, store, SQLite `CHECK` in migration `0034`
  (`archaeology/session-verdict.types.ts:21-57`); `degradedReason` is OPEN by
  design (`:30-36`).
- The model is told to prefer `unverified` over guessing, and the schema types
  nullable fields as `['string','null']` so it can SAY it does not know — the doc
  names this as the same failure as the judge's fabricated `score: 10`
  (`:186-192`, `:214`).
- Retrieval is driven from TypeScript, not SDK tool calling: a reply may carry
  `requestTurns` / `requestSearch` and a reply with neither is TERMINAL
  (`:159-177`); one schema serves every pass (`:180-186`).
- The verdict is what the synthesizer prompts from when usable
  (`skill-synthesizer.service.ts:20-35`), read at `skill-synthesis.service.ts:785`
  via `readVerdict` (`:1110-1123`).

**Jev relevance**: `evidenceClass` is the cleanest classification target in the
library — a closed 5-way enum over a transcript, with an explicit "unverified"
abstain. `intent`/`outcome`/`routine` are generative and stay LLM work. A hybrid
(Jev classifies the evidence class; the lane still writes the prose) is the shape
the schema already permits, but note the classification depends on multi-pass
retrieval over a transcript larger than any single context window — a Jev call
would need the same window-serving loop (`archaeology/transcript-window.reader.ts`).

## 6. D7 and D6 — the two gates that produce numbers

**Replay** (`gates/replay-validator.service.ts`):

- Two calls: a plan, then a comparator constrained to `{alignment: 0..1,
rationale}` (`:184-190`, rubric `:221-228`, call sites `:387-407`).
- Plan-only containment: `cwd: os.homedir()`, `maxTurns: 1` (`:429-430`).
- `null` confidence ≠ `0`: a `null` hold-out yields a `null` confidence (`:16`),
  and no hold-out means no write at all (`:466`, `:513`, `:555`).
- Promotion reads the result as: promote iff judge scored ≥ threshold AND
  (`replayConfidence >= minConfidence` OR it is NULL)
  (`skill-promotion.service.ts:441-492`); the `!== null` test is written first on
  purpose (`:459-464`).

**Trigger-eval** (`gates/trigger-eval.service.ts`):

- The library's one MEASURING gate — it exists to replace the judge's
  `triggerClarity` opinion with a number (`:1-15`).
- Exactly one lane call, for probe generation; everything after is local embedder
  arithmetic, pinned by a spec that counts call sites (`:16-25`, call at `:597`).
- ~5 should-trigger + ~5 near-miss prompts (`:117`), hard ceiling 8/side (`:125`),
  top-K 3 (`:131`); the near-miss half is what makes precision a real number
  (`:52-58`), and an empty side returns an all-`null` measurement rather than a
  flattering one (`:57-58`).
- Known bias stated in the file: prompts are generated FROM the description, so
  it measures "does this description attract what it claims", not truth (`:76-83`).

**Jev relevance**: D7's comparator is a single 0–1 alignment judgment with a
rationale — a near-exact fit for a typed judgment, and its "null is not zero"
contract maps onto an abstain. D6 is the counter-example: its value comes
precisely from NOT being a model call, and any Jev usage there must stay on the
probe-generation side or it re-creates the second judge the gate replaced.

## 7. D8 — the curator overlap pass: the weakest-typed call in the library

- Free-text prompt, findings shaped `{type: 'overlap'|'stale', skillIds[],
reason}` (`skill-curator.service.ts:127-131`, prompt `:273-284`).
- **No `outputSchema` is requested, deliberately**: the answer is a JSON ARRAY and
  the runner's structured-output ladder resolves objects only, so asking for a
  schema would turn every successful array answer into a
  `structured-output-unsupported` failure (`skill-curator.service.ts:15-18`).
- It never auto-deletes; it logs, reports and queues (`:4-8`).

**Jev relevance**: highest defect risk, lowest blast radius. A typed pairwise
judgment ("do these two skills overlap?") would replace an unschema'd array parse
with N bounded judgments, and the array-vs-object limitation that forced the
schema off disappears. Cost scales quadratically in library size, so it needs the
same neighbour pre-selection the panel's lens already does
(`gates/judge-panel.service.ts:448-495`).

## 8. Constraints any Jev proposal must satisfy

1. **Zero direct SDK imports.** `IInternalQuery`, `LaneAuthOverride` and
   `ILaneAuthResolver` are LOCAL structural mirrors because `agent-sdk` depends
   back on this library (lib `CLAUDE.md`, "keeps ZERO direct SDK imports"). A
   TypeSafe SDK would be a NEW external dependency on the backend side of the
   hexagon and needs a port in `platform-core` or a local mirror, not an import
   in a service.
2. **No provider is privileged.** Lanes differ only by declared capability, and a
   provider-id literal anywhere in the model-resolution chain fails a mechanical
   source scan (`lanes/lane-resolver.providers.spec.ts`, described in lib
   `CLAUDE.md`). A named TypeSafe endpoint cannot sit inside the lane path — it
   would be a fifth lane or its own port.
3. **Every background call is budgeted and governed.** Token spend is ledgered per
   UTC day and stage (`queue/skill-budget.store.ts`), a stage that spends must be
   in `TOKEN_SPENDING_STAGES` (`queue/skill-drain.service.ts:566-567` records the
   cost of getting that wrong for `trigger-eval`), and every call rides
   `SKILL_SYNTHESIS_QUERY_LANE` for concurrency. A Jev call is still a call.
4. **Degradation must stay first-class.** Three vocabularies already encode
   "we do not know": `JUDGE_REASONS` (`skill-judge.service.ts:70-81`),
   `JUDGE_PANEL_REASONS` (`gates/judge-panel.service.ts:149-164`),
   `SESSION_VERDICT_DEGRADED_REASONS` (`archaeology/session-verdict.types.ts:105-110`).
   A typed judgment that cannot abstain would re-introduce the fabricated-verdict
   defect phase 1 removed.
5. **A host with no LLM must still work.** All four LLM collaborators are injected
   `{isOptional: true}` and their stages register conditionally
   (`queue/stage-handlers.service.ts`, lib `CLAUDE.md` "registered CONDITIONALLY").
6. **Stored scales are on the wire and in SQLite.** `judge_score` (float),
   per-criterion columns, `replay_confidence` (0–1), `trigger_score` /
   `trigger_precision` / `trigger_recall` are persisted and rendered. Changing what
   a score MEANS is a migration plus a UI change, not a service swap.

## 9. Ranked replacement candidates

1. **D4 judge scorecard** — bounded rubric, typed output, enumerated failures,
   three consumers that already handle abstention. Biggest token saving (it runs
   at promotion, the suggestion pass, the enhancer and twice inside the panel).
2. **D7 replay comparator** — one 0–1 number with an explicit null/abstain path.
3. **D2 `evidenceClass` only** — closed 5-way enum with a built-in "unverified"
   abstain; leave `intent`/`outcome`/`routine` on the lane.
4. **D8 curator overlap** — replace an unschema'd array parse with N pairwise
   typed judgments over lens-selected neighbours.
5. **D5 escalation** — only after D4; if D4 becomes deterministic the panel's
   variance rationale needs re-justifying rather than porting.

Not candidates: **D1** (local by contract), **D6 scoring path** (local by
contract, and a model there re-creates the judge it replaced), **D3/D9 generation**
(free-form authoring, not a judgment).

## 10. Files read for this map

`trajectory-extractor.ts`, `eligibility/session-work-evidence.ts`,
`skill-judge.service.ts`, `gates/judge-panel.service.ts`,
`gates/trigger-eval.service.ts` (1–140),
`gates/replay-validator.service.ts` (380–460 + symbol scan),
`archaeology/session-verdict.types.ts`, `skill-synthesizer.service.ts` (1–200),
`skill-curator.service.ts` (1–131 scan, 440–560),
`skill-promotion.service.ts` (430–600), `skill-enhancer.service.ts` (415–475),
`skill-synthesis.service.ts` (600–900, 1110–1170), `digest/skill-gap-curator.service.ts` (1–60),
plus `libs/backend/skill-synthesis/CLAUDE.md` in full.

UNREAD (not needed for the decision map, noted for completeness):
`skill-candidate.store.ts`, `queue/skill-drain.service.ts` (cited only via grep
anchors at `:566-567`), `queue/stage-handlers.service.ts` (cited via grep anchors
at `:113`, `:272`, `:420`), `gates/judge-lens.ts`,
`archaeology/session-archaeologist.service.ts` (cited via grep anchor at `:383`),
`archaeology/transcript-window.reader.ts`, `lanes/lane-runner.service.ts`,
`cleanup/`, `triggers/`, all `*.spec.ts`.

# Research: TypeSafe (Jev) API Surface, Primitives, SDK, and Cookbooks

Source: fetched live from https://docs.typesafe.ai/ via WebFetch, one page at a time, on 2026-09-18.
Everything below is drawn from those fetches (summarized by the fetch tool's model, not raw HTML) unless marked UNVERIFIED. Treat all claims as UNVERIFIED against the raw page source — the fetch tool returns a model's summary of the page, not the page's exact bytes.

## Fetch status

| Page | Status |
| --- | --- |
| https://docs.typesafe.ai/primitives.md | Fetched |
| https://docs.typesafe.ai/primitives/choice.md | Fetched |
| https://docs.typesafe.ai/primitives/noul.md | Fetched |
| https://docs.typesafe.ai/primitives/score.md | Fetched |
| https://docs.typesafe.ai/confidence.md | Fetched |
| https://docs.typesafe.ai/api.md | Fetched |
| https://docs.typesafe.ai/sdk/javascript.md | Fetched |
| https://docs.typesafe.ai/cookbooks/llm_guardrails.md (judge a candidate against criteria) | Fetched — best match found for "judge against criteria"; not a literal page named "judge cookbook". See caveat below. |
| https://docs.typesafe.ai/cookbooks/rerank_typesafe.md (rerank/select evidence) | Fetched — direct match |
| https://docs.typesafe.ai/cookbooks/llm-judge.md | UNFETCHED — 404, this path does not exist. Superseded by llm_guardrails.md above, found via the llms.txt index. |

Caveat on the "judge" cookbook: the site's llms.txt index (https://docs.typesafe.ai/llms.txt) lists no page literally titled "judge". `llm_guardrails.md` was selected as the closest available match — it scores a candidate prompt/response against defined safety criteria (hazard Nouls + a harm-severity Score) and routes on the result, which is the judge-against-criteria pattern. It is safety-specific, not a general-purpose judge template. If the task needs a non-safety judge-against-rubric example, none was found in the index; the closest secondary candidate is `citation_check.md` (Choice-based verdict against a claim), also summarized below for reference. UNVERIFIED: whether a more general "judge" cookbook exists at a path not listed in llms.txt.

## Primitives (docs.typesafe.ai/primitives.md)

TypeSafe's System One API exposes three typed question primitives. All are sent together in one request against a shared `state`, enabling parallel evaluation with minimal latency cost (per docs; UNVERIFIED against a live benchmark).

| Primitive | Purpose | Returns |
| --- | --- | --- |
| Choice | "Which of these options?" | `choice`, `probabilities`, `confidence` |
| Score | "Which level?" | `score`, `legend`, `probabilities`, `confidence` |
| Noul | "Is this true?" | `noul` (probability 0–1) |

Every question needs: an `id` (the response key), a `type` (`choice` / `score` / `noul`), `instructions` (the question), and `criteria` (options for Choice, ordered levels for Score, optional true/false clarification for Noul).

Selection guidance from the docs:
- Choice — discrete options without hierarchy (routing, classification, detection).
- Score — spectrum answers with defined levels (severity, frustration, skill).
- Noul — clean yes/no where a probability signal matters.

### Choice (primitives/choice.md)

- Request: `type: "choice"`, `instructions`, `criteria` (map of option name → description, up to 255 options).
- Response: `type: "choice"`, `choice` (highest-probability option), `probabilities` (full distribution, sums to 1.0), `confidence` (0–1, derived from distribution spread).
- Python SDK: `Choice(instructions=..., criteria={...})` passed into `client.system_one(state=..., questions={...})`.
- Best practices per docs: batch multiple Choice questions in one call; include an "other"/"none of the above" option when coverage may be incomplete; use structured criteria (`what`/`not_for`/`examples`) to disambiguate close options.

### Noul (primitives/noul.md)

- Request: `type: "noul"`, `instructions` (required), `criteria` (optional, object with `true`/`false` descriptions to disambiguate the boundary).
- Response: `type: "noul"`, `noul` (0–1 probability the answer is "yes"). No `confidence` field — see Confidence section below.
- Best practices: phrase questions so a high probability reads as "yes"; use `criteria` when the yes/no boundary is ambiguous; don't use Noul for spectrum positions (use Score) or multi-option decisions (use Choice).

### Score (primitives/score.md)

- Request: `type: "score"`, `instructions`, `criteria` (ordered array, 2–10 levels low→high; each level a string or a structured object with `what`/`examples`). Levels are numbered from 0 by array position.
- Response: `type: "score"`, `score` (float — each level's index times its probability, summed), `probabilities` (level index → probability, sums to 1), `legend` (level index → description), `confidence` (0–1).
- Best practices: describe concrete situations rather than abstract qualifiers ("no impact to functionality" not "minor"); one dimension per question; 3–10 levels; test against real data; normalize scores across different-length scales before combining several Score answers.

## Confidence (docs.typesafe.ai/confidence.md)

- Confidence is a statistic derived automatically from the `probabilities` array already present on Choice and Score answers — not a separately requested field, and not something the caller computes by hand. A concentrated distribution → high confidence; a spread distribution → low confidence.
- **Noul answers do not carry a `confidence` field.** This is a concrete API-shape fact worth flagging for any integration plan: code that branches on "low confidence → route to human" cannot use that field for Noul; it would need to threshold on `noul` distance from 0.5 instead (an inference on my part, not stated in the docs — UNVERIFIED).
- Recommended three-tier usage: high confidence → act automatically; medium → confirm with a user, flag for review, or gather more data; low → route to a human or a fallback system.
- Thresholds are use-case-specific: "different actions within the same system should be gated at different levels depending on the consequences of getting it wrong." Docs recommend starting conservative and tuning against observed data, not adopting a fixed number.

## API reference (docs.typesafe.ai/api.md)

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`.
- Auth: Bearer token in the `Authorization` header.
- Request: `state` (string/object/array — the content being judged), `model` (`"jev-latest"` is the flagship model name given), `questions` (map of question-id → typed question object as above).
- Response: `model`, `answers` (map keyed the same as `questions`), `usage` (`input_tokens`, `output_tokens`).
- Errors: `401` invalid/missing key, `422` request validation failure, `429` rate limit, `529` overloaded. Docs recommend exponential backoff on 429/529; SDKs are said to handle this automatically (UNVERIFIED — not confirmed against SDK source in this pass).
- **No pricing information is published on this page.** Any cost figures used for this task's cost analysis will have to come from the cookbook's reported cost-per-run (see rerank cookbook below, $0.06 for 1,200 calls) or from a pricing page not fetched in this pass — flag as UNVERIFIED/missing in the implementation plan.

## JavaScript/TypeScript SDK (docs.typesafe.ai/sdk/javascript.md)

- Package: `@typesafe-ai/sdk`, requires Node.js 20+.
- Auth via `TYPESAFE_API_KEY` environment variable, then instantiate `TypeSafeClient`.
- Usage pattern: create client → call `systemOne()` with `state` → define questions with helper functions such as `choice()` → read typed answers off `response.answers`.
- TypeScript: "answer types inferred from your questions" — compile-time typing of the answer shape based on the question definitions passed in.
- Distribution: ships ESM, CommonJS, and `.d.ts` declarations.
- Source referenced (not fetched/read directly in this pass): https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts and .../src/types.ts — implies **v0.6.0** is the tagged SDK version as of this doc snapshot. UNVERIFIED against npm's currently published version.
- Gap explicitly called out by the fetch: **the quickstart page does not document streaming, detailed error handling, or the full method surface beyond `systemOne()`.** For this task's integration plan, error handling and retry behavior for the JS SDK should be treated as unknown until the client source itself is read — the fallback is to mirror the raw HTTP error codes in api.md (401/422/429/529).

## Cookbook 1 — judge a candidate against criteria: `llm_guardrails.md`

- Scenario: screening both user-submitted prompts and model outputs for safety without a second heavyweight LLM call.
- Method: one TypeSafe request per message carries **four Noul questions** (jailbreak attempt, harmful request, medical advice, self-harm indicator — each a hazard-probability judgment) plus **one Score question** (harm severity, 0–3 scale, "no harm" → "serious physical harm").
- Routing: a policy table maps the Noul probabilities and Score value to an action — pass / review / block / support. Two named policies (`strict`, `permissive`) set the review threshold at 0.35 and act thresholds in the 0.70–0.85 range.
- Code shape: a `screen(text, side)` function calls the API and returns `{"nouls": ..., "severity": ...}`; a `route(nouls, severity, policy)` function applies the policy's thresholds and returns the action string; `guard(text, side, policy_name)` composes the two.
- Relevance to this task: this is the closest published template for "run several typed judgments against one candidate and turn the result into a routing decision" — directly analogous to what a skill-synthesis judge or a memory-curation admit/reject gate would need, except the criteria here are safety hazards rather than task-quality or memory-relevance criteria. The pattern (N Noul checks + 1 Score check → policy table) is reusable; the specific criteria are not.

## Cookbook 2 — rerank / select evidence: `cookbooks/rerank_typesafe.md`

- Scenario: two-stage document retrieval over a large corpus — BM25 narrows thousands of candidates to ~30, then TypeSafe re-ranks the shortlist to surface the true best match at position 1.
- Reported result (legal-document benchmark, per the cookbook): top-1 accuracy improved from 5% → 18%, top-10 from 38% → 62%. These are the cookbook's own reported numbers, not independently reproduced here — UNVERIFIED beyond "the docs say so."
- Primitive used: a single **Noul** per (query, candidate) pair — e.g. "Could the candidate passage be from the cited precedent?" with `criteria={true: "...", false: "..."}` — because a plain 0–1 confidence score is directly sortable, unlike open-ended generation.
- Code shape: loop over `query_candidate_pairs`, call `client.system_one(state={"query":..., "candidate":...}, questions={"is_cited_source": question})` for each, collect `.noul` into a `pair_scores` dict, then `sorted(candidates, key=pair_scores.get, reverse=True)`.
- Cost/scale data point (only one found in this research pass): **1,200 concurrent calls (40 queries × 30 candidates) cost approximately $0.06** per the cookbook. That is the one concrete cost anchor available for this task's cost analysis; it implies roughly $0.00005 per Noul call at whatever token sizes that benchmark used — this is an extrapolation, not a stated per-call price, and the input/output token counts behind that $0.06 were not given in the fetched summary. Flag as UNVERIFIED and too thin to size skill-synthesis or memory-curator costs without a second data point.

## Other pages discovered but not fetched (out of the requested scope, listed for completeness)

Via https://docs.typesafe.ai/llms.txt: `introduction.md`, `sdk.md` (general SDK index, JS-specific already covered), `patterns.md`, `models.md`, and additional cookbooks (`consistency_noul_cookbook.md`, `consistency_choice_cookbook.md`, `parallel_questions.md`, `semantic_find.md`, `autoformat.md`, `function_calling.md`, `skill_suggestion.md`, `entity_alignment.md`, `classifying_rag_passages.md`, `citation_check.md`, `sde_cascade.md`, `date_extraction_cookbook.md`, `pre_parsed_value_extraction_cookbook.md`, `hierarchical_classification.md`, `autoresearch_feature_discovery.md`, `classification_using_confidence.md`). None of these were required by this task and none were fetched, except `citation_check.md`, which was skimmed as a second candidate for the "judge" cookbook slot (see summary above) and could be substituted if `llm_guardrails.md` proves too safety-specific for the recommendation.

## What this means for the two target libraries (preliminary, for the evidence-map deliverables)

- **skill-synthesis judge**: the Noul-battery-plus-Score-plus-policy-table shape in `llm_guardrails.md` is a directly transferable pattern for a trajectory judge that currently does prompt-and-parse — replace the criteria set with quality/success criteria and the policy table with an accept/revise/reject gate. Confidence is available on the Score leg but not on any Noul leg, so a "low confidence → escalate" gate has to be built on Noul's raw probability distance from 0.5, not a `confidence` field.
- **memory-curator**: the rerank cookbook's per-pair Noul scoring loop is the applicable pattern for a Letta-style "is this memory relevant/worth keeping" gate scored against many candidate memories, sorted by `noul`. Cost at scale is only loosely bounded by the single $0.06/1,200-calls data point above; a real estimate needs the JS SDK's token accounting once the client source is read (not yet done here — see SDK gap above).
- Model name to standardize on across both proposals: `jev-latest`, per `api.md`. No pinned/dated model name was found in this pass — UNVERIFIED whether the endpoint accepts pinned deploy names for reproducibility.

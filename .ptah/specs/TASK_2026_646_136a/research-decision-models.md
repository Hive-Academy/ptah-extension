# Research: decision models for orchestration routing — TASK_2026_646_136a

Purpose: pick the model behind the optional `ptah_route_decide` tool. The tool turns one engineering
request into a typed routing answer: `{ taskType, depth, roster[], confidence, reasons }`. The model
chooses only from options that Ptah code supplies.

All external pages were read on 2026-10-14. "Not documented" means the cited pages do not state the
fact. "Vendor claim" means the publisher states the fact about its own model, and this report did not
verify it. Illustrative answer values in `## Example calls` are marked as such.

Source legend (each label is a URL):

- [SEARCH] https://ollama.com/search?c=decision
- [TEV1] https://ollama.com/library/tev1
- [NIMBLE] https://ollama.com/library/nimble
- [CLEF] https://ollama.com/library/clef
- [CLEF-F] https://ollama.com/library/clef-flash
- [LAYA] https://ollama.com/library/laya
- [OLDOCS] https://docs.ollama.com/capabilities/decision
- [BLOG] https://ollama.com/blog/ollama-now-supports-decision-models (published 2026-09-29)
- [OLLAMA-API] https://github.com/ollama/ollama/blob/main/docs/api.md
- [TS-API] https://docs.typesafe.ai/api.md
- [TS-CONF] https://docs.typesafe.ai/confidence.md
- [TS-STATE] https://docs.typesafe.ai/concepts/state.md
- [TS-MODELS] https://docs.typesafe.ai/models.md
- [TS-JAG] https://docs.typesafe.ai/model-jaggedness/jev-1.13.md (page shows "Last reviewed 2026-10-02")
- [TS-LEGAL] https://docs.typesafe.ai/legal.md
- [TS-PRIV] https://typesafe.ai/legal/privacy-policy
- [TS-LLMS] https://docs.typesafe.ai/llms.txt
- [BENCH] https://github.com/bespokelabsai/nimble/blob/main/docs/PUBLIC_BENCHMARKS.md
- [TEV1-HF] https://huggingface.co/togethercomputer/Tev1-4B-experimental
- [TEV1-BLOG] https://www.together.ai/blog/how-to-train-your-own-jev

## Summary table

| Candidate | Input format | Typed output | Confidence | Local / cloud | Latency | Licence | Source (date) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TypeSafe Jev (`jev-1.13.0`) | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`. `state` = string, JSON object or array. `questions` = named map: `choice` (up to 255 options), `score` (2-10 levels), `noul` (yes/no) | Yes. `answers` map: chosen option plus full `probabilities`; `score` plus `legend`; `noul` probability 0-1. `usage` tokens | Yes for `choice` and `score`: 0-1, derived from the answer's probability distribution. `noul` carries no confidence | Cloud API. No downloadable weights documented. Zero data retention (ZDR) for enterprise | Not documented | Hosted service. USD 0.042 per Mtok input, output tokens free | [TS-API], [TS-MODELS] (2026-10-14) |
| clef (Cloudflare, 27B) | Local `POST /v1/systemone` (Ollama 0.35.1+). `state` = string, object or array. 1-64 named questions. Optional base64 `images` | Yes. Same System One answers | Yes for `choice` and `score`, 0-1. "It isn't the chance that the answer is right" (vendor) | Local, 18 GB download. Ollama Cloud serving not documented | About 5x slower than clef-flash (vendor claim, no figure) | Apache 2.0 | [CLEF] (2026-10-14) |
| clef-flash (Cloudflare, 9B) | Same endpoint as clef. Multimodal: images scored jointly with the text state | Yes. Same System One answers | Yes, same rule as clef | Local, 11-12 GB download | "Lowest measured latency of any decision model in Cloudflare's Decision Index runs" (vendor claim, no figure) | Apache 2.0 | [CLEF-F] (2026-10-14) |
| nimble (Bespoke Labs, 9B) | Local `POST /v1/systemone` (Ollama 0.35+). `state` plus up to 64 questions. "The endpoint follows TypeSafe's Jev API" | Yes. Same System One answers, plus `usage` | Yes for `choice` and `score` | Local, 9.3-9.5 GB download | "Under 100ms on a MacBook Pro M5 Max" (vendor). 91 ms average per decision, local on an M5 Max | Apache 2.0 | [NIMBLE], [BLOG] (2026-10-14; blog published 2026-09-29) |
| tev1 (Together AI, 0.8B / 4B) | Local `POST /v1/systemone` (Ollama 0.35+). `state` plus 1-64 questions. Request body cap 64 KiB | Yes. Same System One answers | Yes for `choice` and `score`. "Reflects probability concentration, not correctness" | Local. 0.8B: 797-812 MB. 4B: 4.4-4.5 GB | Not documented | Base model Qwen3.5-4B is Apache-2.0. Fine-tuned weights: "release license ... being finalized before public conversion" | [TEV1], [TEV1-HF] (2026-10-14) |
| laya (Convai Innovations, 421M) | Local `POST /v1/systemone` (Ollama 0.40.0+). ModernBERT-large encoder. Text only, English only. Each question gets a 512-token budget | Yes. "Typed answers with calibrated probabilities". No text generation | Yes for `choice` and `score`. ECE 0.060 (vendor claim) | Local, 846 MB download | Not documented. Single forward pass, no decoder | Apache 2.0 | [LAYA] (2026-10-14) |
| Baseline: any chat model plus a JSON schema | Local `POST /api/generate` or `/api/chat` with `format: <JSON schema>`. The prompt must ask for JSON | Schema-shaped JSON. "The model will generate a response that matches the schema". Content truth is not guaranteed | None native. A self-reported field inside the schema only. Not calibrated | Local (model-dependent), or any provider | Not documented. Scales with model size | Varies by model | [OLLAMA-API] (2026-10-14) |

## Candidate notes

### The shared System One contract

Every Ollama decision model exposes the same endpoint: `POST /v1/systemone`. Ollama describes the
feature as "based on TypeSafe's Jev API for fast, typed decisions" [BLOG]. The nimble page states it
directly: "The endpoint follows TypeSafe's Jev API" [NIMBLE]. The request carries `model`, `state`
and `questions` [OLDOCS]. Local calls need no API key [OLDOCS].

Consequence for Ptah: one small typed HTTP client can serve every candidate. Configure the base URL:

- `https://api.typesafe.ai/v1/systemone` — cloud, `Authorization: Bearer <API_KEY>` [TS-API].
- `http://localhost:11434/v1/systemone` — local, no key [OLDOCS].

The TypeSafe SDK pattern already works against Ollama: the clef page shows TypeSafe's Python SDK
pointed at Ollama through `TYPESAFE_BASE_URL`, and notes "The SDK requires an API key, but Ollama
ignores it, so any value works" [CLEF]. The docs index lists a JavaScript SDK with `TypeSafeClient`,
`SystemOneRequest` and `SystemOneResult` [TS-LLMS]. Whether the JavaScript SDK accepts a base-URL
override like the Python one is not documented on the pages read.

Question types, all vendors: `choice` returns the chosen option and the probability of every option.
`noul` returns the probability that a yes/no answer is true. `score` returns a probability-weighted
value across ordered levels, plus a `legend` [TS-API], [OLDOCS].

Shared limits:

| Limit | Ollama decision models | TypeSafe Jev | Source |
| --- | --- | --- | --- |
| Questions per request | 1-64, answers in the same order | Not documented on the pages read | [TEV1], [NIMBLE], [CLEF-F], [LAYA] |
| `choice` options | 2-26 (tev1 page: training covered 2-24) | Up to 255 | [OLDOCS], [TEV1], [TS-API] |
| `score` levels | 2-10 [OLDOCS]. The clef page says 2-26 — the two pages disagree | 2-10 | [OLDOCS], [CLEF-F], [TS-API] |
| Request body | 64 KiB | Not documented | [TEV1], [LAYA] |
| State size | Model-specific, see below | 64k tokens per request. 32k tokens for `state` plus the longest question | [TS-MODELS] |
| Rate limits | Not documented | "100K tokens per second / 80 requests per second", dynamic, 429 on excess | [TS-MODELS] |

### Per-model notes

**TypeSafe Jev.** Jev is "TypeSafe's flagship model and the first System One model" [TS-LLMS]. One
version exists: `jev-1.13.0`, with aliases `jev-latest` and `jev-preview` (both currently point to
`jev-1.13.0`) [TS-MODELS]. Jev accepts text only: "State must be a string, JSON object, or array of
text values" [TS-STATE]. All questions in one request see the same state and are evaluated
independently [TS-STATE]. The docs advise pinning the versioned ID when thresholds are tuned to it
[TS-MODELS]. Jev's known weaknesses are published on a "jaggedness" page, last reviewed 2026-10-02:
it reads questions literally, counts unreliably, compares dates unreliably, loses accuracy with
indirection, suffers "context rot" as irrelevant state grows, can be moved by adversarial state,
answers worse when instructions and criteria contradict, "leans toward the option that comes first"
in a choice, and is not trained to generate text [TS-JAG]. English is its strongest language [TS-STATE].

**nimble.** Fine-tuned from Qwen3.5-9B by Bespoke Labs, Apache 2.0 [NIMBLE]. It reads the prompt once
per question and scores answer tokens with no reasoning step, which is why it is fast [NIMBLE].
Latency: "under 100ms on a MacBook Pro M5 Max" [NIMBLE]. The Ollama blog measured "averaged 91ms per
decision ... running locally on an M5 Max" [BLOG]. Other hardware differs: Bespoke's benchmark log
gives about 1.1 s per record for nimble on an AMD Radeon RX 6800 XT with partial GPU offload,
against a median 0.66 s per request for Jev's hosted API. The document states "Latencies are not
compared" [BENCH]. Context: the readme says prompts must fit
"Nimble's 8,192-token context", while the model table shows "256K context window" — the page
disagrees with itself. The 8,192-token readme figure is the safe planning number. Up to 64 questions
per call [NIMBLE]. Requires Ollama 0.35+ [NIMBLE].

**tev1.** Experimental, from Together AI, fine-tuned from Qwen3.5, in 0.8B (797-812 MB) and 4B
(4.4-4.5 GB) sizes [TEV1]. The readme says tev1 "runs with a context of about 2,000 tokens", while
the model table shows "256K context window" — another page-internal disagreement. The 2,000-token
figure limits how much lane and outcome history fits in one request. Licence: the Ollama page
states only "The dataset builders and training scripts are MIT licensed" [TEV1]. The model card
states "The base Qwen3.5-4B model is Apache-2.0" and "The release license for these fine-tuned
weights is being finalized before public conversion" [TEV1-HF]. The weights licence is not settled.
The card frames the checkpoint as "a Jev-inspired experiment, not a non-autoregressive Jev
runtime". Its raw interface takes `state`, `question` and 2-24 labeled `options`, and it returns
"exactly one option letter" [TEV1-HF]. The card itself gives no probabilities or confidence
[TEV1-HF]. Through Ollama's `/v1/systemone`, tev1 is presented with the full choice, noul and score
semantics [TEV1]. The card warns: "The model can be wrong; do not use it as the sole authority for
high-impact decisions", and prompt injection, multilingual behavior, calibration, and broad
out-of-distribution robustness "have not been comprehensively evaluated" [TEV1-HF]. Its own
development run reports "Main decision set: 880/1,000 (88.0%)", labelled "development results, not
an independent benchmark" [TEV1-HF].

**clef and clef-flash.** From Cloudflare, Apache 2.0. clef is 27B (18 GB download), fine-tuned from
Qwen3.8-27B. clef-flash is 9B (11-12 GB download), fine-tuned from Qwen3.5-9B [CLEF], [CLEF-F]. Both
are multimodal: base64 images are scored jointly with the text state. URLs and data URLs are not
accepted [CLEF-F]. clef-flash is positioned for "latency-critical decisions", with clef as "the
larger, more accurate variant" that is about five times slower [CLEF-F]. Context: the readme says
"64K context window: Twice the state Jev's 32K window holds", while the model table shows 256K
[CLEF], [CLEF-F]. Both require Ollama 0.35.1+ [CLEF], [CLEF-F]. The clef page lists no model card,
repo or paper link, so the accuracy claims rest on the vendor's own "Decision Index runs" [CLEF-F].

**laya.** A 421M encoder, fine-tuned from ModernBERT-large, Apache 2.0, English and text only [LAYA].
It has no decoder and generates no text: "nothing to parse, nothing to hallucinate" [LAYA]. Every
option of every question is scored in one forward pass, up to 64 questions [LAYA]. Cost of that
shape: each question gets a 512-token budget [LAYA]. Ptah's routing state (request text, lane rows,
outcomes) will often exceed 512 tokens, so laya is a poor fit for this tool despite its size.
The page claims calibration ECE 0.060 and RLCD training [LAYA]. The page links no source repo.
Requires Ollama 0.40.0 or later [LAYA].

**Baseline (chat model plus JSON schema).** Ollama constrains the shape: "Structured outputs are
supported by providing a JSON schema in the `format` parameter" and "The model will generate a
response that matches the schema" [OLLAMA-API]. With `format: "json"` alone, the output is a
well-formed JSON object, but "the model may generate large amounts whitespace" unless the prompt asks
for JSON [OLLAMA-API]. A schema forces the shape. It does not force truthful content, and it cannot
produce calibrated probabilities. Any confidence field in the schema is a generated string, not a
distribution summary.

**Unread category members.** The Ollama decision category lists eight models. Three were not read:
`kev`, `nimble-v3` and `strands-decider` [SEARCH]. They fall outside the candidate set this task
names.

### Failure behaviour

- Decision models generate no text, so there is no free-form output to parse [LAYA], [TS-JAG]. The
  typed answer is the contract. Failure surfaces at the HTTP layer instead of the content layer.
- TypeSafe documents its error contract: 401 missing or invalid key, 422 failed validation, 429 rate
  limit, 529 overloaded. On 429 and 529, back off and retry. The SDKs do this by default [TS-API].
  Ollama does not document decision-endpoint error codes on the pages read.
- Confidence is not correctness. Ollama: "A higher value does not guarantee the answer is correct"
  [OLDOCS]. clef page: "It isn't the chance that the answer is right" [CLEF-F]. TypeSafe defines the
  statistic precisely: for `choice`, `(p_max - 1/n) / (1 - 1/n)`. For `score`, a distance from the
  most likely level. `noul` answers carry no confidence at all [TS-CONF].
- Results vary: "Results can vary with the model and configuration" [OLDOCS]. Pin the model version
  and log the version that answered [TS-MODELS].
- Option order biases Jev: it "leans toward the option that comes first" [TS-JAG]. Ptah must therefore
  shuffle or rotate roster options, or verify that answers survive reordering [TS-JAG]. The
  published benchmark runs used "no candidate shuffling", so position bias is unmeasured there
  [BENCH].
- Jev rounds its probabilities. Bespoke's benchmark notes that Jev's API "returns probabilities
  rounded to two decimals", and calls Jev's NLL non-comparable for that reason [BENCH]. Do not
  build thresholds on the third decimal.
- The baseline can fail in a way decision models cannot: a schema-valid but wrong answer, plus a
  self-reported confidence number. Nothing constrains the semantic content [OLLAMA-API].

### Privacy

- Local Ollama decision models keep the routing state on the machine. The announcement stresses
  "requests don't have to travel over a network" [BLOG], and local requests need no API key [OLDOCS].
- Jev is a hosted API at `api.typesafe.ai`, so the request text, lane rows and outcomes leave the
  machine [TS-API]. The legal index states a commitment "not to train models on user data" and offers
  "zero data retention (ZDR) for enterprise customers" [TS-LEGAL]. The privacy policy defines the
  collected material as "your prompts, data, instructions, and other input ('Input')" and covers the
  APIs [TS-PRIV]. It commits that TypeSafe "will not train or fine tune any artificial intelligence
  or machine learning models on Input", and "will not disclose any Input to a third party other
  than our service providers" [TS-PRIV]. No fixed retention period is stated: data is kept "as
  long as reasonably necessary to provide you the Services", and is deleted or de-identified on
  request [TS-PRIV]. The services are "hosted in the United States" [TS-PRIV]. The policy names
  Google Analytics and payment processors, lists no subprocessor register, and describes no ZDR
  mechanics. ZDR is offered only through the enterprise channel [TS-PRIV], [TS-LEGAL].

### Latency, hardware and cost

- Measured figures: nimble "averaged 91ms per decision" locally on an M5 Max [BLOG], and claims
  "under 100ms on a MacBook Pro M5 Max" [NIMBLE]. Bespoke's benchmark log gives about 1.1 s per
  record for nimble on an AMD Radeon RX 6800 XT with partial GPU offload, and a median 0.66 s per
  request for Jev's hosted API including transport. The document states "Latencies are not
  compared" [BENCH]. clef-flash claims the "lowest measured latency of any decision model in
  Cloudflare's Decision Index runs", without a figure [CLEF-F]. clef is about five times slower
  than clef-flash (vendor claim) [CLEF-F]. tev1, laya and the baseline have no documented latency.
- Hardware: no vendor page states minimum RAM. Planning inference from the published download sizes:
  laya and tev1:0.8b run in under 1 GB of RAM. nimble and clef-flash need roughly 10-12 GB. clef
  needs roughly 18 GB. This is inference, not a vendor statement.
- Cost: Jev charges USD 0.042 per Mtok input, output tokens free [TS-MODELS]. A routing call with
  about 3,000 input tokens costs about USD 0.000126 (computed from that price). Local models cost no
  per-call fee. Ollama's own pricing page was not read.
- Decision models are not in the Ollama CLI or the Ollama Python and JavaScript libraries yet. Calls
  go through the HTTP endpoint [NIMBLE], [CLEF].
- Cloud serving: "Currently available locally in Ollama" [OLDOCS]. The announcement says "More
  decision models are coming soon, including models served by Ollama's cloud" [BLOG]. As of
  2026-10-14 no decision model is documented as served on Ollama Cloud.

### Accuracy evidence

Two published comparisons exist. Neither measures orchestration routing.

Bespoke Labs publishes a paired evaluation of nimble-9b against Jev 1.13.0 over 13 public data sets
with human labels (3,880 records) [BENCH]. Mean accuracy, macro across subsets:

| Question group | nimble-9b | jev-1.13.0 |
| --- | --- | --- |
| All 13 subsets | 74.8% | 76.0% |
| `choice` (5 subsets) | 81.6% | 82.9% |
| `noul` (5 subsets) | 80.2% | 84.6% |
| `score` (3 subsets) | 54.6% | 50.1% |

Micro averages are close: 75.9% versus 77.3% [BENCH]. Calibration favours Jev: its ECE is lower on
nearly every subset (paws 0.041 versus nimble's 0.100, squad2 0.042 versus 0.139) [BENCH]. The
same document reports informal latency (nimble about 1.1 s per record on an AMD Radeon RX 6800 XT
with partial offload; Jev's hosted API a median 0.66 s per request including transport) and states
"Latencies are not compared" [BENCH]. The reported runs used "no candidate shuffling", so position
bias is unmeasured there [BENCH]. The run date is not stated. The default selection seed is
20260918 [BENCH].

The Ollama announcement shows the same benchmark as a chart: "Mean accuracy across 13 public data
sets with human labels, covering 3,880 decisions", with nimble and tev1 evaluated on Ollama and
"Jev 1.13 ... from Bespoke Labs' published run on the same decisions" [BLOG]. The chart's values do
not appear in the page text, so no per-model figure can be cited from it.

tev1's own card reports "Main decision set: 880/1,000 (88.0%)" and labels this "development
results, not an independent benchmark" [TEV1-HF].

What this means for Ptah: routing questions are `choice` questions. On `choice`, nimble and Jev sit
1.3 points apart (81.6% versus 82.9% macro) [BENCH]. Jev is better calibrated, so its confidence
numbers are the more trustworthy fallback signal. `score` accuracy is weak for both models (54.6%
and 50.1% macro) [BENCH]. Ptah should not gate a routing decision on a `score` answer.

## Example calls

The top two candidates are nimble (local, default) and TypeSafe Jev (cloud, fallback). Both use the
same System One body. Only the URL, the model field and the auth header differ.

Ptah state (built from the Gate 0.1 rows in `context.md` and the task's telemetry record):

```json
{
  "request": "fix the flaky auth e2e test and add a regression test",
  "availableExecutors": {
    "codex":    { "kind": "cli",      "installed": true, "limitState": "unknown",  "recentOutcome": "delivered" },
    "opencode": { "kind": "cli",      "installed": true, "limitState": "unknown",  "recentOutcome": "delivered" },
    "grok":     { "kind": "cli",      "installed": true, "limitState": "no plan",   "recentOutcome": "not used" },
    "glm":      { "kind": "ptah-cli", "installed": true, "limitState": "unknown",   "recentOutcome": "delivered" },
    "subagent": { "kind": "in-process", "installed": true, "limitState": "none",   "recentOutcome": "delivered" }
  },
  "userPreferences": ["lanes first", "codex first", "review must cross the implementer side"],
  "pastOutcomes": {
    "codex/implement": { "delivered": 12, "failed": 1 },
    "glm/implement":   { "delivered": 9,  "failed": 2 },
    "grok/research":   { "delivered": 4,  "failed": 0 }
  }
}
```

The `task_type` options below are Ptah's own task-type set, defined in
`libs/shared/src/lib/types/task-spec.types.ts:30`.

### Example 1: nimble, local

Call 1 of 2 — task type, depth, implementer:

```
POST http://localhost:11434/v1/systemone
Content-Type: application/json

{
  "model": "nimble",
  "state": { ...the Ptah state above... },
  "questions": {
    "task_type": {
      "type": "choice",
      "instructions": "Which Ptah task type fits this request?",
      "criteria": {
        "BUGFIX":      "A test or feature is broken and must be fixed",
        "FEATURE":     "A new capability must be built",
        "REFACTORING": "Restructure existing code without new behaviour",
        "DOCUMENTATION": "Write or update documents",
        "RESEARCH":    "Investigate and report, no code changes",
        "DEVOPS":      "Build, pipeline or deployment work",
        "SAAS_INIT":   "Initialize a workspace or SaaS setup",
        "CREATIVE":    "Visual or marketing content"
      }
    },
    "depth": {
      "type": "choice",
      "instructions": "How deep should the workflow be for this request?",
      "criteria": {
        "minimal": "One clear file-level change",
        "partial": "Known requirements, two to four files",
        "full":    "Unclear scope, five or more files, needs a plan"
      }
    },
    "implement_executor": {
      "type": "choice",
      "instructions": "Which executor should implement? Choose only from these options.",
      "criteria": {
        "codex":    "CLI lane; strongest delivery record for fixes",
        "opencode": "CLI lane; available",
        "glm":      "Ptah CLI lane on Ollama Cloud",
        "subagent": "In-process subagent with a specialist role"
      }
    },
    "needs_research": {
      "type": "noul",
      "instructions": "Must this request be researched before implementation?"
    }
  }
}
```

Documented response shape with illustrative values (the shape and field names follow [OLDOCS],
[NIMBLE]; the answer values are examples, not measured output):

```json
{
  "model": "nimble",
  "answers": {
    "task_type": {
      "type": "choice", "choice": "BUGFIX",
      "probabilities": { "BUGFIX": 0.92, "FEATURE": 0.03, "REFACTORING": 0.02, "DOCUMENTATION": 0.01, "RESEARCH": 0.01, "DEVOPS": 0.005, "SAAS_INIT": 0.003, "CREATIVE": 0.002 },
      "confidence": 0.90
    },
    "depth": {
      "type": "choice", "choice": "partial",
      "probabilities": { "partial": 0.78, "minimal": 0.14, "full": 0.08 },
      "confidence": 0.67
    },
    "implement_executor": {
      "type": "choice", "choice": "codex",
      "probabilities": { "codex": 0.81, "glm": 0.11, "opencode": 0.05, "subagent": 0.03 },
      "confidence": 0.75
    },
    "needs_research": { "type": "noul", "noul": 0.21 }
  },
  "usage": { "input_tokens": 1180, "output_tokens": 4 }
}
```

Ptah code then compiles the tool's answer:

```json
{
  "taskType": "BUGFIX",
  "depth": "partial",
  "roster": [
    { "phase": "implement", "executor": "codex" },
    { "phase": "review", "executor": "pending call 2" }
  ],
  "confidence": 0.67,
  "reasons": [
    "task_type BUGFIX, confidence 0.90: the request asks to fix a failing test",
    "depth partial, confidence 0.67: one test area, two to four files expected",
    "implement codex, confidence 0.75: 12 delivered of 13 past implement runs"
  ]
}
```

`confidence` is the minimum of the routing-critical answers (code choice, shown illustrative).
`reasons` is compiled by Ptah code from the typed answers. Decision models do not generate text, so
reasons cannot come from the model [TS-JAG], [LAYA].

Call 2 of 2 — reviewer. The reviewer choice depends on the implementer choice, and "All questions
see the same state and are evaluated independently" [TS-STATE]. So code asks the reviewer question in
a second request, with the implementer in the state and removed from the options. Hard constraints
stay in code: the implementer never reviews its own work [context.md].

```
POST http://localhost:11434/v1/systemone
Content-Type: application/json

{
  "model": "nimble",
  "state": {
    "request": "fix the flaky auth e2e test and add a regression test",
    "chosenImplementer": "codex",
    "availableReviewers": {
      "glm":      "Ptah CLI lane, different provider from the implementer",
      "subagent": "In-process subagent, cross-side reviewer",
      "grok":     "CLI lane, currently without a plan"
    },
    "userPreferences": ["review must cross the implementer side"]
  },
  "questions": {
    "review_executor": {
      "type": "choice",
      "instructions": "Which executor should review the implementer's work? The implementer is codex and is not an option.",
      "criteria": {
        "glm":      "Different provider, strong delivery record",
        "subagent": "In-process reviewer with a review role",
        "grok":     "Available, but has no plan and was not used recently"
      }
    }
  }
}
```

### Example 2: TypeSafe Jev, cloud

Same body, different endpoint, auth header and model. Pin the version because thresholds are tuned
to it [TS-MODELS].

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "model": "jev-1.13.0",
  "state": { ...same Ptah state... },
  "questions": { ...same questions... }
}
```

Documented response fields [TS-API]: `model` (reports the versioned ID that answered), `answers`
(one per question key), `usage` (`input_tokens`, `output_tokens`). Illustrative answer body:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "task_type": { "type": "choice", "choice": "BUGFIX", "probabilities": { "...": "..." }, "confidence": 0.91 },
    "depth": { "type": "choice", "choice": "partial", "probabilities": { "...": "..." }, "confidence": 0.70 },
    "implement_executor": { "type": "choice", "choice": "codex", "probabilities": { "...": "..." }, "confidence": 0.77 },
    "needs_research": { "type": "noul", "noul": 0.18 }
  },
  "usage": { "input_tokens": 1210, "output_tokens": 20 }
}
```

Differences that matter to Ptah: `choice` accepts up to 255 options, so a growing roster fits in one
question [TS-API]. State gets 32k tokens [TS-MODELS]. Errors are typed: 401, 422, 429, 529 [TS-API].
Every request is metered and billed at USD 0.042 per Mtok input [TS-MODELS]. The state leaves the
machine [TS-API].

### Baseline contrast

The same decision through a normal chat model takes a JSON schema in `format` and a prompt that
enumerates the allowed values. Example request [OLLAMA-API]:

```
POST http://localhost:11434/api/chat
Content-Type: application/json

{
  "model": "<any local chat model>",
  "stream": false,
  "messages": [
    { "role": "user", "content": "<routing prompt: request, lanes, outcomes. Answer with taskType, depth, implementer, review, confidence.>" }
  ],
  "format": {
    "type": "object",
    "properties": {
      "taskType":      { "type": "string", "enum": ["FEATURE", "BUGFIX", "REFACTORING", "DOCUMENTATION", "RESEARCH", "DEVOPS", "SAAS_INIT", "CREATIVE"] },
      "depth":         { "type": "string", "enum": ["minimal", "partial", "full"] },
      "implementer":   { "type": "string", "enum": ["codex", "opencode", "glm", "subagent"] },
      "confidence":    { "type": "number" }
    },
    "required": ["taskType", "depth", "implementer", "confidence"]
  }
}
```

The schema forces the shape. The `confidence` field is a generated number with no distribution
behind it. Nothing in this path produces per-option probabilities or a legend [OLLAMA-API].

## Recommendation

Every System One candidate answers the core question natively: state plus a schema of typed
questions in, typed answers with derived confidence out. None of them needs JSON-schema plumbing.
The baseline needs it, and its confidence is self-reported and not calibrated. So the baseline ranks
below every decision model for this tool.

- **Default: a local Ollama decision model through `/v1/systemone`, with nimble as the preset.**
  Reason: the routing state contains the user's request text, lane rows and outcomes. Local models
  keep it on the machine [BLOG]. nimble is the only candidate with a measured latency (91 ms per
  decision, local) [BLOG], an Apache 2.0 licence [NIMBLE], an 8,192-token context that fits Ptah's
  routing state [NIMBLE], and a 64-question batch that covers task type, depth and executors in one
  call [NIMBLE]. On `choice` questions, the shape Ptah's routing uses, nimble scores 81.6% against
  Jev's 82.9% macro accuracy, so the local default costs about one accuracy point [BENCH]. Ptah
  already integrates Ollama on both surfaces it needs: the local provider proxy and the Ollama
  Cloud usage reader
  (`libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts`), so the
  provider surface is not new.
- **Cloud preset: TypeSafe Jev, pinned to `jev-1.13.0`.** It is the reference implementation of the
  same API [BLOG]. It offers 255-option choices and 32k-token state, a published error contract and
  published failure modes [TS-API], [TS-JAG]. It is the more accurate and the better calibrated of
  the two benchmarked models (76.0% versus 74.8% macro overall, lower ECE on nearly every subset)
  [BENCH]. Per-decision cost is negligible at USD 0.042 per Mtok input [TS-MODELS]. But the state
  leaves the machine and is kept "as long as reasonably necessary" [TS-API], [TS-PRIV], hosted in
  the United States [TS-PRIV], and strict tenants need the enterprise ZDR option [TS-LEGAL].
  TypeSafe's own docs give no latency figure; Bespoke's log reports a median 0.66 s per request
  including transport [BENCH]. Make it an explicit user choice.
- **Small-footprint option: tev1:0.8b** (797-812 MB) for machines that cannot hold a 9B model, with
  three caveats: it is labelled experimental, its readme says it "runs with a context of about
  2,000 tokens" [TEV1], and its weights licence is not settled ("being finalized before public
  conversion") [TEV1-HF]. Ptah must then trim the state or drop the outcome history. **Not
  recommended: laya** for this tool, because each question gets a 512-token budget [LAYA], which
  the routing state will often exceed. **Not recommended as default: clef and clef-flash.** They
  work through the same endpoint, but their advantages (multimodal input, 64K state) do not serve
  text-only routing, their latency claims carry no published figure, and clef needs roughly 18 GB
  [CLEF], [CLEF-F]. Keep them selectable.
- **Ship as "unset": today's rule tables, unchanged.** The decision model is optional
  [context.md]. Whatever runs, three rules stay in code: the model picks only from supplied options
  (the `choice` type enforces this by construction [TS-API]), hard constraints are applied after the
  model answers (never an AT LIMIT lane, never the implementer as reviewer, the batch cap
  [context.md]), and low confidence falls back to the rule table. TypeSafe documents exactly this
  three-range pattern — act above high confidence, confirm in the middle, fall back below low — and
  advises conservative thresholds at the start [TS-CONF]. Start the fallback at 0.5 and log every
  fallback in `decisions.md` [context.md].
- **One client, two URLs.** Implement a single typed System One client with a configurable base URL
  (`api.typesafe.ai` or `localhost:11434`). The clef page proves the pattern: the TypeSafe SDK runs
  against Ollama with `TYPESAFE_BASE_URL`, and Ollama ignores the key [CLEF]. A raw-fetch TypeScript
  client avoids a new dependency; the request and response are small JSON [TS-API], [OLDOCS].

## Unknowns

- Routing accuracy for Ptah's domain. The published benchmarks measure generic classification, not
  orchestration routing [BENCH]. Smallest experiment: replay 30-50 recorded past routing decisions
  through each candidate, and compare the picks against the verdicts in the lane outcome record.
- The Bespoke benchmark's run date is not stated. The default selection seed is 20260918 [BENCH].
- Position bias is unmeasured in the published runs: they used "no candidate shuffling" [BENCH].
  Only Jev's first-option lean is documented [TS-JAG].
- Whether the TypeSafe JavaScript SDK accepts a base-URL override the way the Python SDK does
  (`TYPESAFE_BASE_URL`) [CLEF], [TS-LLMS]. Unverified for the JS SDK pages.
- Latency figures for clef, clef-flash, tev1, laya and the baseline. Jev has only Bespoke's
  informal median [TS-MODELS], [CLEF-F], [TEV1], [LAYA], [BENCH].
- Ollama decision-endpoint error codes and retry contract [OLDOCS].
- Whether any decision model ships on Ollama Cloud. "Currently available locally" [OLDOCS];
  cloud models were "coming soon" on 2026-09-29 [BLOG].
- Score-level limits disagree: 2-10 [OLDOCS] versus 2-26 [CLEF-F].
- Context windows disagree inside three model pages (256K table rows versus readme notes) [TEV1],
  [NIMBLE], [CLEF]. This report plans against the readme numbers.
- kev, nimble-v3 and strands-decider were not read [SEARCH].
- laya lists no source repository or model card [LAYA].

## Decisions

These are recommendations. The architect makes the decisions.

| # | Decision | Recommendation | Reason |
| --- | --- | --- | --- |
| 1 | Default preset | Local `/v1/systemone` with nimble | Privacy: state stays on the machine [BLOG]. Measured 91 ms [BLOG]. Apache 2.0 [NIMBLE]. Choice accuracy within 1.3 points of Jev [BENCH] |
| 2 | Cloud preset | TypeSafe Jev, pinned `jev-1.13.0` | Reference API, 255-option choices, 32k state, published errors [TS-API], [TS-MODELS]. Best accuracy and calibration in the published comparison [BENCH]. Explicit user choice, because state leaves the machine [TS-PRIV] |
| 3 | Small machines | tev1:0.8b, with state trimming | 797-812 MB download [TEV1]. Caveats: experimental, ~2,000-token context [TEV1], weights licence not settled [TEV1-HF] |
| 4 | "Unset" behaviour | Today's rule tables, unchanged | The feature is optional [context.md]. Confidence below 0.5 also falls back to the rule table, logged in `decisions.md` |
| 5 | Client shape | One raw-fetch System One client, base URL configurable | Same body for every candidate [OLDOCS], [TS-API]. Avoids a new SDK dependency |
| 6 | Reviewer selection | Second request, after the implementer is known | Questions are evaluated independently against one state [TS-STATE]. The reviewer depends on the implementer |
| 7 | `reasons[]` source | Compiled in Ptah code from typed answers | Decision models generate no text [TS-JAG], [LAYA] |
| 8 | Option order | Rotate or verify roster options | Jev "leans toward the option that comes first" [TS-JAG]. Published runs did not shuffle, so bias is unmeasured [BENCH] |
| 9 | Lane outcome storage | Open — outside this report | Flagged in `context.md`. Model quality depends on this history |
| 10 | Question-type policy | Use `choice` and `noul` for routing. Do not gate on `score` | `score` accuracy is weak for both benchmarked models: 54.6% and 50.1% macro [BENCH] |
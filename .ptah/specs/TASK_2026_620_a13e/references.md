# Verified external references — memory-curation and skill-learning benchmark

Task: TASK_2026_620_a13e, phase 2 (benchmark design).
Decision this supports: which external metrics, taxonomies and protocols may be borrowed
into a deterministic CI gate for the memory-curator and skill-pipeline benchmark, which
stay inform-only, and which data may not be reused at all for license reasons.

All URLs below were fetched on 2026-10-06 unless stated otherwise. "VERIFIED" means the
source was retrieved and read directly. "Secondhand" means the claim came from a search
engine's summary of a page and was not read in the original. "UNVERIFIED" means not
settled by any retrieved source.

---

## 1. LongMemEval — VERIFIED

- Repo: https://github.com/xiaowu0162/longmemeval (fetched 2026-10-06)
- Data: https://huggingface.co/datasets/xiaowu0162/LongMemEval (fetched 2026-10-06)
- Paper: arXiv 2410.10813 (read at https://ar5iv.labs.arxiv.org/html/2410.10813)
- License: code MIT (repo sidebar, confirmed). Data MIT (HF card license tag `mit`, confirmed).

**What it measures.** Long-term interactive chat memory: 500 questions over five abilities —
information extraction, multi-session reasoning, knowledge updates, temporal reasoning,
abstention. Seven question types at data level: `single-session-user`,
`single-session-assistant`, `single-session-preference`, `multi-session`,
`knowledge-update`, `temporal-reasoning`, plus an `_abs` (abstention) suffix.
Variants: `longmemeval_s` (~115k tokens, ~40 history sessions), `longmemeval_m`
(500 sessions, ~1.5M tokens), `longmemeval_oracle` (evidence sessions only).

**Data format (confirmed from README).** Each instance has `question_id`, `question_type`,
`question`, `answer`, `question_date`, `haystack_session_ids`, `haystack_dates`,
`haystack_sessions` (each session a list of `{"role", "content"}` turns), and
`answer_session_ids`. For turn-level labels, evidence turns carry `has_answer: true`;
`answer_session_ids` is "used for session-level memory recall accuracy evaluation".
System output is JSONL with `question_id` and `hypothesis` per line.

**Exact metric definitions.**
- QA accuracy: LLM-as-judge, not exact match — "an exact matching strategy as in previous
  works can result in inaccurate evaluations". Judge is "gpt-4o-2024-08-06", asked to
  "directly generate 'yes' or 'no'" ("Please answer yes if the response contains the
  correct answer. Otherwise, answer no."). Paper claims "more than 97% agreement with
  human experts" (meta-evaluation, self-reported).
- Retrieval: "we report Recall@k and NDCG@k, where k is the number of top items retrieved
  by the system" (paper; reported at k=5 and k=10). **No formulas are given in the paper
  text retrieved**; the computation lives in the repo
  (`src/evaluation/print_retrieval_metrics.py`). Both metrics are possible because the
  data has "human-annotated answer location labels" (turn `has_answer`, session
  `answer_session_ids`).
- Retrieval evaluation skips abstention instances: "for evaluating the retrieval, we
  always skip the 30 abstention instances".

**Protocol.** Indexing/retrieval (`src/retrieval`: `flat-bm25`, `flat-contriever`,
`flat-stella`, `flat-gte`; granularity `turn` or `session`) is evaluated separately from
reading/generation (`src/generation`: `full-history-session`, or RAG with reading methods
`direct`, `con`, `con-separate`).

**Determinism.** Recall@k and NDCG@k over fixed labels: deterministic. QA accuracy:
needs an LLM judge, non-deterministic.

**Borrow.** GATE: the evidence-label retrieval metrics (recall@5/10, NDCG@5/10 over
`has_answer` turns and `answer_session_ids`) — exactly the deterministic recall@k the 619
infra already implements, plus a rank-aware NDCG. Also borrow the taxonomy: knowledge-update
and temporal categories map onto our update/contradiction scenarios; abstention maps onto
"memory says nothing useful here". INFORM-ONLY: the LLM-judge QA accuracy. Do not gate on it.

**Caution.** The HF card says the original dataset is deprecated: "This dataset is
deprecated. It is replaced by `longmemeval-cleaned`", which removes noisy history sessions
"that interfere with the answer correctness". Use `longmemeval-cleaned` if we adopt the data.

---

## 2. LocAgent / Loc-Bench — VERIFIED

- Repo: https://github.com/gersteinlab/LocAgent (fetched 2026-10-06)
- Data: https://huggingface.co/datasets/czlll/Loc-Bench_V1 (fetched 2026-10-06)
- Paper: arXiv 2503.09089, ACL 2025 (read at https://ar5iv.labs.arxiv.org/html/2503.09089)

**License.** Code Apache-2.0 (repo sidebar, confirmed). Loc-Bench dataset: **no license
tag on the HF dataset page** — only a citation request. Data reuse terms are undefined; do
not redistribute or embed the data until clarified.

**What it measures.** Code localization from issue descriptions, as a proxy for the
first stage of issue resolution. Loc-Bench: 560 samples — 242 bug reports, 150 feature
requests, 29 security issues, 139 performance issues. Contamination control: bug reports
"created after October 2024" (after known training cutoffs), with "tooling to continuously
update the benchmark with new examples". Large patches excluded (">5 Python files or
>10 functions").

**Exact metric definitions (quoted from the paper).**
- Acc@k: "a modified accuracy metric inspired by R-Precision", "following Agentless" —
  "we select the top-k predicted locations" and "consider a localization attempt
  successful only if all relevant locations are correctly identified within these
  top-k predictions". File level: Acc@1, Acc@3, Acc@5. Function level: Acc@5, Acc@10.
  Module level: "only requires finding any function within the patched class".
  On Loc-Bench: file Acc@5/10, function and module Acc@10/15.
- NDCG@k: appendix only — "The results of the NDCG are presented in Table 11",
  "NDCG scores comparison showing ranking quality" (NDCG@1/3/5/10).
- **recall@k is NOT used by LocAgent.** Our `context.md` listed "Acc@k, recall@k, NDCG@k"
  for LocAgent — the recall@k part is wrong (recall@k appears in LoCoMo's RAG evaluation,
  not here). Correct the context line before it propagates into design docs.

**Protocol.** Ground truth is patch-based: "affected files or functions in the original
codebase, as identified in the patches" are the targets; "documents, import statements,
and comments are excluded from the localization target". Evaluation code:
`evaluation.eval_metric.evaluate_results` and `evaluation/run_evaluation.ipynb`.

**Determinism.** Acc@k and NDCG@k are set/rank computations over a fixed prediction list:
deterministic, no judge.

**Borrow.** GATE: the all-correct Acc@k rule for our evidence-retrieval gate (the system
must surface *every* seeded fact that a scenario needs, not just one); NDCG@k for ranked
memory-injection quality (top-of-context matters). Also borrow the contamination pattern:
keep the frozen set dated and refreshable, "collected after known LLM training cutoffs"
equates for us to ground truth the system under test did not produce.

**Data format (HF viewer).** Parquet, 560 rows, one test split; columns include `repo`,
`instance_id`, `base_commit`, `patch`, `test_patch`, `problem_statement`, `hints_text`,
`created_at`, `labels`, `category`, `edit_functions`, `added_functions`,
`edit_functions_length`.

---

## 3. LoCoMo — VERIFIED

- Repo: https://github.com/snap-research/locomo (fetched 2026-10-06)
- License text: https://raw.githubusercontent.com/snap-research/locomo/main/LICENSE.txt
  (read in full)
- Paper: arXiv 2402.17753, ACL 2024 (read at https://ar5iv.labs.arxiv.org/html/2402.17753)
- Project page: https://snap-research.github.io/locomo/

**License — flag.** CC BY-NC 4.0. The license grants a "worldwide, royalty-free,
non-sublicensable, non-exclusive, irrevocable license" restricted to noncommercial
purposes; "NonCommercial means not primarily intended for or directed towards commercial
advantage or monetary compensation"; attribution required when sharing. Ptah is a
commercial product. Running LoCoMo data in product CI is at least legally ambiguous.
**Do not commit, redistribute, or gate on LoCoMo data without a legal decision.** If used
at all, keep it out of the repository and out of any shipped artifact.

**What it measures.** Very long-term conversational memory: 10 released conversations
(subset of an original 50), ~300 turns / ~9K tokens each, up to 35 sessions, with
~7,512 QA pairs across five categories (paper counts): single-hop 2,705 ("require answers
based on a single session"), multi-hop 1,104 ("synthesizing information from multiple
different sessions"), temporal 1,547 ("temporal reasoning and capturing time-related data
cues"), open-domain 285 ("integrating a speaker's provided information with external
knowledge"), adversarial 1,871 ("designed to trick the agent into providing wrong
answers", with the "expectation that the agent will correctly identify them as
unanswerable"). Each sample carries "the turn IDs in the conversation logs that contain
the answer". Images are not released.

**Exact metric definitions (quoted).**
- QA: "we calculate the F1 score for exact matches" with normalization, then "employ the
  F1 partial match metric for evaluating the predictions". Deterministic. No LLM judge.
- Event summarization: ROUGE-1/2/L plus FactScore, adapted to measure "(1) precision of
  the summarized content" and "(2) recall of the summarized content", reporting "the F1
  score, derived from the calculated precision and recall".
- RAG: "the accuracy of retrieving the correct context for RAG models" (recall@k).
- Multimodal generation: BLEU-1/2, Rouge-L, MM-R.

**Protocol.** Three QA setups: truncated-context base LLMs, long-context LLMs, and RAG
(retriever DRAGON, reader gpt-3.5-turbo-16k) over dialogs / observations / session
summaries.

**Borrow.** GATE: the normalized exact-match + partial-match F1 scoring style — it is
deterministic and fits QA-over-seeded-facts checks. Also borrow the *adversarial /
unanswerable* category concept (maps to abstention and to "don't answer from stale
memory") and the temporal category. The taxonomy can be borrowed even where the data
cannot (we would build our own seeded scenarios anyway). INFORM-ONLY: any absolute
LoCoMo scores.

---

## 4. mem0's LoCoMo evaluation — VERIFIED (protocol); scores are vendor-reported

- Repo: https://github.com/mem0ai/mem0 (fetched 2026-10-06; Apache 2.0 — "Apache 2.0 — see
  the LICENSE file for details")
- Evaluation: https://github.com/mem0ai/mem0/tree/main/evaluation — a git submodule
  pointing at the separate `mem0ai/memory-benchmarks` repo
- Judge code: https://github.com/mem0ai/mem0/blob/ece7ff6b/evaluation/metrics/llm_judge.py
- Paper: arXiv 2504.19413 ("Mem0: Building Production-Ready AI Agents with Scalable
  Long-Term Memory"), linked from the README

**What it measures.** Memory systems (mem0, zep, RAG, langmem, full-context) on LoCoMo.

**Metric definitions (secondhand, from repo file listing and code search).** BLEU, F1,
and an LLM-judge score per category, plus tokens and latency. The judge
(`metrics/llm_judge.py`) uses `gpt-4o-mini` with a binary CORRECT/WRONG prompt that
instructs the judge to be *generous* (semantically matching answers, date formats), and
**skips category 5 (adversarial)** — i.e. the unanswerable questions are dropped from the
headline score.

**Borrow.** NOTHING for gates. The numbers are vendor-reported, self-judged with a
lenient prompt, and the harness drops the hardest category — they are evidence of
nothing for us. Useful only as a known-bad example of evaluation hygiene: (1) a judge
prompted to be generous, (2) category-selective scoring, (3) vendor self-report. Two
independent reimplementations (e.g. `jaylfc/taosmd`, `vbcherepanov/total-agent-memory`)
exist precisely because the numbers are not directly reproducible-comparable.
INFORM-ONLY, and only as a cautionary reference.

---

## 5. Voyager — VERIFIED

- Repo: https://github.com/MineDojo/Voyager (fetched 2026-10-06)
- License: code MIT (README states the codebase is released under MIT; no separate data
  license stated for the learned skill libraries)

**What it measures.** Not a packaged benchmark. An open-ended Minecraft agent with an
"ever-growing skill library of executable code for storing and retrieving complex
behaviors". Evaluation is environment-driven gameplay: "3.3× more unique items",
"unlocks key tech tree milestones up to 15.3× faster than prior SOTA" (README claims,
paper-reported), plus a transfer test — "utilize the learned skill library in a new
Minecraft world to solve novel tasks from scratch".

**Skill mechanism (relevant to our skill pipeline).**
- Skills are executable code stored in a directory (`skill_library_dir`), retrieved and
  composed by decomposition (`decompose_task` then `inference`).
- Iteration is a prompting loop that "incorporates environment feedback, execution
  errors, and self-verification for program improvement" — no model fine-tuning.
- Automatic curriculum "maximizes exploration"; checkpoint/resume support.
- "Do not resume from a skill library because this is not learning" (their warning
  against reusing a library as if it were fresh experience).

**Determinism.** The evaluation is environment-measured (unique items, milestones) —
deterministic given the environment, but Minecraft-specific and not portable.

**Borrow.** GATE-adjacent: the *self-verification by execution* loop is the strongest
idea — a skill that is executable gets a deterministic execution test as its promotion
gate, which is exactly the kind of non-LLM evidence our judge-panel step lacks. Also
borrow the transfer-to-new-environment protocol as the shape of a skill-generalization
test (run the skill on a held-out scenario it was not mined from). Their absolute
numbers: inform-only.

---

## 6. Agent Workflow Memory (AWM) — VERIFIED

- Repo: https://github.com/zorazrw/agent-workflow-memory (fetched 2026-10-06)
- License: Apache-2.0 (repo sidebar and About, confirmed; no separate data license stated)
- Paper: arXiv 2409.07429

**What it measures.** Web-agent task success when a memory of induced "workflows"
(common sub-routines "with example-specific contexts abstracted out") is added. Two
modes, quoted: offline — "when additional (e.g., training) examples are available, agents
induce workflows from ground-truth annotated examples"; online — "without any auxiliary
data, agents induce workflows from past experiences on the fly". Induction is LLM-based
(GPT-4o, secondhand from paper/repo search).

**Metric definitions.** WebArena: success rate (README: "We achieve the state-of-the-art
result — 35.6% success rate") — environment-driven, deterministic given the environment.
Mind2Web: Elem Acc, Action F1, Step SR, SR (secondhand, from the paper's results table;
the repo renders them as an image). Those are match-based and deterministic given logs.

**Borrow.** GATE-adjacent: the **offline-induction-from-ground-truth** mode is the exact
shape of our skills arm — induce workflow drafts from a frozen human-labelled exemplar
set, then measure task success with and without the induced workflow. Their
cross-task / cross-website / cross-domain generalization splits are the model for our
skill-trigger generalization test (a skill mined from workspace A must fire and help on
held-out session B). Their SOTA numbers: inform-only.

---

## 7. ExpeL — VERIFIED (repo, license); metric details secondhand

- Repo: https://github.com/LeapLabTHU/ExpeL (fetched 2026-10-06)
- License: Apache-2.0 (repo README badge/label, confirmed)
- Project page: https://andrewzh112.github.io/expel/ — paper arXiv 2308.10144 (linked
  from the repo), AAAI 2024

**What it measures.** Experiential learning without parametric updates. Three stages:
(1) gathering experiences by trial-and-error with reflection on failures; (2) insight
extraction; (3) task inference combining insights with retrieved successful trajectories.
Benchmarks: HotpotQA, ALFWorld, WebShop, FEVER — all with their standard metrics
(success rates / accuracy), which are deterministic at the benchmark level. Reported
improvements (secondhand, project page): HotpotQA +36%/31% from insights; ALFWorld
+50%/55% from trajectory recollection; HotpotQA→FEVER transfer 70% vs 63% for ReAct.

**Insight lifecycle (secondhand, search summary of the repo):** insights are iteratively
refined with ADD / EDIT / REMOVE / AGREE operations and a voting/importance counter.
This is the published precedent for our merge/update/retire lifecycle: memory items are
not write-once, they are promoted, edited and demoted by accumulated agreement.

**Borrow.** GATE-adjacent: the ADD/EDIT/REMOVE-with-voting lifecycle as the design
reference for deterministic merge and retire counters (e.g. a memory survives only with
repeated independent support; a contradiction demotes it). Also the transfer test
(HotpotQA→FEVER) as the shape for cross-domain skill/memory usefulness. Their absolute
numbers: inform-only.

---

## 8. SkillWeaver — VERIFIED

- Repo: https://github.com/OSU-NLP-Group/SkillWeaver (fetched 2026-10-06)
- License: MIT (repo sidebar, confirmed). Dataset disclaimer: "collected and released
  solely for research purposes" — treat their data as research-only.
- Paper: arXiv 2504.07079 ("Web Agents can Self-Improve by Discovering and Honing Skills")

**What it measures.** Web-agent skill acquisition: "the agent autonomously discovers
skills, executes them for practice, and distills practice experiences into robust APIs"
(Playwright-based Python functions). Pipeline: skill proposal → skill synthesis →
skill **honing** — "tests and debugs synthesized APIs using environment feedback", with
recovery: `--allow-recovery` lets the agent "patch" APIs that throw exceptions during
testing. Skills are consumed at inference via a knowledge-base path; removing it gives the
no-skills baseline (a clean ablation toggle).

**Protocol.** Evaluation on WebArena via Docker-hosted sites, entry point
`python -m skillweaver.evaluate_benchmark`, with per-task results and a "modified
WebArena debugger which adds additional information about why a test case failed".
Environment-driven, deterministic given the environment. Paper numbers (secondhand):
31.8% relative improvement on WebArena, 39.8% on Online-Mind2Web, up to 54.3% weak-to-strong
skill transfer.

**Borrow.** GATE-adjacent: **honing = execution-based verification before a skill enters
the library**, with failure reasons surfaced. This is the strongest published precedent
for replacing (or backing) our LLM-judge promotion gate with a deterministic test:
a candidate skill must demonstrably run and produce the expected effect on a held-out
input before promotion. Also the explicit no-knowledge-base baseline toggle. Their
numbers: inform-only.

---

## 9. Reflexion — VERIFIED

- Repo: https://github.com/noahshinn/reflexion (fetched 2026-10-06)
- License: MIT (repo sidebar, confirmed; no separate data license; paper logs are
  included in the repo)

**What it measures.** Verbal self-reflection stored in memory across repeated attempts.
Benchmarks: HotpotQA ("a random sample of 100 questions from the HotPotQA distractor
dataset"), ALFWorld, WebShop, programming. Ablation structure is first-class:
agent types (ReAct, CoT) × strategies (`NONE`, `LAST_ATTEMPT`, `REFLEXION`,
`LAST_ATTEMPT_AND_REFLEXION`), plus a `use_memory` toggle ("persisting memory to store
self-reflections" vs baseline). Metrics are the standard benchmark ones (success rates) —
deterministic at benchmark level.

**Borrow.** GATE-adjacent: the **with/without-memory ablation as the primary reported
comparison** — identical to our method rule "always score against a baseline ('no
memory', 'raw transcript grep', 'last-N messages')". Reflexion is the canonical published
example of that protocol, and its strategy enum (reflection vs last attempt vs both) is a
clean factorial for testing *which* injected artifact helps: memory vs raw trace vs both.
Their numbers: inform-only.

---

## 10. MSC — Multi-Session Chat — VERIFIED (existence, contents); license UNVERIFIED

- Project page: https://parl.ai/projects/msc/ (fetched 2026-10-06)
- Paper: "Beyond Goldfish Memory: Long-Term Open-Domain Conversation" (Xu, Szlam,
  Weston; ACL 2022; arXiv 2107.07567 — secondhand)
- Access: ParlAI task `parlai/tasks/msc` ("We release the Multi-Session Chat and
  Summarization tasks at parlai/tasks/msc"; sessions 1–4: "237k training examples and
  25k valid examples"; sessions 1–5: "extra 6k valid examples")

**License.** UNVERIFIED. The ParlAI project page states no dataset license or usage
terms (only site Terms of Service links). **Verify the ParlAI task terms before any
reuse of MSC data.**

**What it measures.** Session continuity: human-human chats over up to 5 sessions with
time gaps, speakers referencing prior sessions; sessions annotated with summaries that act
as "extended personas". The paper's SumMem-MSC is a read-write memory model — a published
precedent for *write-quality* evaluation (memory built incrementally per session, then
used). DMR (Deep Memory Retrieval), the 500-conversation MSC subset used by MemGPT/Letta
for single-fact recall, derives from it (secondhand).

**Borrow.** Inform-only at this stage. The incremental write-then-read-per-session
protocol matches our write-quality arm (extract after each session, then answer), but
with LoCoMo and LongMemEval already covering the space under clear licenses, MSC adds
little unless its license checks out.

---

## 11. HaluMem — VERIFIED — closest match to our write/update arms; license is the worst

- Repo: https://github.com/MemTensor/HaluMem (fetched 2026-10-06)
- Data: https://huggingface.co/datasets/IAAR-Shanghai/HaluMem (fetched 2026-10-06)
- Paper: arXiv 2511.03506 ("HaluMem: Evaluating Hallucinations in Memory Systems of
  Agents", Nov 2025 — secondhand summary)

**License — hard flag.** Code: CC BY-NC-ND 4.0 (repo badge "CC_BY_NC_ND_4.0" + LICENSE.txt).
Data: CC BY-NC-ND 4.0 (HF card tag). NonCommercial **and** NoDerivatives: no commercial
use, no adaptations. **Do not reuse HaluMem code or data in any form** in this commercial
product. What remains borrowable is the *task decomposition* — a taxonomy and protocol,
not their material.

**What it measures (why it matters).** The first operation-level memory benchmark:
instead of end-to-end QA, it decomposes the memory workflow into stages and scores each:
- **Memory extraction**: Memory Integrity ("Recall of reference memory points"), Memory
  Accuracy ("Precision of extracted memory points"), extraction F1, and False Memory
  Resistance (FMR) against adversarial distractors.
- **Memory updating**: "Evaluates accuracy, hallucination, and omission rates during
  memory updates" — correct rate (C), hallucination rate (H), omission rate (O).
- **Question answering**: accuracy, hallucination and omission rates end-to-end.

This is the only verified external benchmark that scores **write quality** (extraction)
and **update/contradiction handling** directly — our arms 1 and 3. Scale: 20 users,
14,948 memory points, 3,467 QA pairs; Medium ~160k tokens, Long ~1M tokens per user.
Their finding (secondhand): hallucinations "generated/accumulated during extraction and
updating propagate to QA", and correct updates < 50% across six commercial memory systems.

**Scoring.** The README gives metric names and directions (R, Target P, Acc., FMR, F1,
C, H, O) but **no computation formulas**, and does not state whether scoring is exact
match or LLM-judged. UNVERIFIED until the paper's method section is read. Their dataset
construction used GPT-4o assistance plus ~50% human annotation (95.7% correctness claimed,
secondhand).

**Borrow.** GATE: the **taxonomy only** — the extraction-stage triple (recall / precision
/ FMR against distractors) and the update-stage triple (correct rate, hallucination rate,
omission rate) map one-to-one onto our curator benchmark, and all three are computable
deterministically against seeded facts (exact match on seeded fact ids; hallucination =
extracted rows matching no seed; omission = seeds with no row). Implement our own scenarios
on our own data; take nothing from theirs.

---

## 12. MemBench — VERIFIED (existence); metric details secondhand

- Repo: https://github.com/import-myself/Membench (fetched 2026-10-06)
- License: MIT badge on the README (badge only; no LICENSE file visible in the root
  listing — confirm before relying on it). Data hosted on Baidu Pan and Google Drive with
  **no data license stated** — do not redistribute.
- Paper: arXiv 2506.21605, Findings of ACL 2025 (secondhand)

**What it measures (secondhand).** Memory of LLM-based agents across participation
(first-person) vs observation (third-person) scenarios, factual vs reflective memory
levels, and a multi-metric view: accuracy, recall, capacity and **temporal efficiency**.
Key finding: retrieval-based memory held up at 100k contexts where most mechanisms
declined.

**Borrow.** GATE-adjacent: the *capacity* and *temporal-efficiency* axes are the two
metric dimensions our plan names but no other verified source defines — capacity maps to
our retention/decay arm (how much useful memory survives at a fixed token budget),
temporal efficiency maps to our write-path cost accounting. Read the paper's metric
section before committing to their definitions (not yet done; see Unknowns).

---

## 13. OmniMemEval and other harnesses — VERIFIED (existence); inform-only

- Repo: https://github.com/MemTensor/OmniMemEval (secondhand via search; Apache 2.0)
- Related: ProsusAI/MemEval (Apache 2.0, secondhand), Vectorize Agent Memory Benchmark
  (secondhand), TeleAI-UAGI/Awesome-Agent-Memory list (secondhand)

OmniMemEval is an evaluation *framework* over existing datasets (LoCoMo, LongMemEval,
BEAM, PersonaMem v2, HaluMem) with two tracks (memory backend APIs; agent runtimes with
memory plugins). One practice is directly worth copying: its `THIRD_PARTY_NOTICES.md`
keeps upstream dataset licenses intact — "The OmniMemEval code license does not
relicense external datasets" — and its own README notes the bundled LoCoMo copy remains
CC BY-NC 4.0. Borrow the license-hygiene pattern, not the harness. Inform-only.

---

## Summary table

| Reference | License (code / data) | Metric or taxonomy to borrow | Deterministic? | Gate or inform-only |
|---|---|---|---|---|
| LongMemEval | MIT / MIT (data card `mit`; use `longmemeval-cleaned`) | Recall@k + NDCG@k over labeled evidence turns/sessions; knowledge-update / temporal / abstention taxonomy | Retrieval metrics yes; QA accuracy needs LLM judge | Retrieval metrics + taxonomy: GATE. LLM-judge QA: inform-only |
| LocAgent / Loc-Bench | Apache-2.0 / **none stated** (HF card has no license tag) | Acc@k all-correct rule; NDCG@k for ranking; dated refreshable ground truth | Yes (set/rank computation) | GATE (re-implement the metrics; do not embed the dataset). Note: recall@k is NOT a LocAgent metric — fix context.md |
| LoCoMo | — / **CC BY-NC 4.0** | Adversarial (unanswerable) + temporal categories; normalized exact + partial F1 | F1 yes; no LLM judge | Taxonomy + F1 style: GATE (our own scenarios). Their data: do not ship/gate without legal check |
| mem0 LoCoMo eval | Apache 2.0 / (LoCoMo data, CC BY-NC) | Lenient self-judged, category-skipping protocol — borrow only as an anti-pattern | No (gpt-4o-mini judge, generous prompt, skips adversarial) | Inform-only; vendor numbers are not evidence |
| Voyager | MIT / none stated | Execution-based skill self-verification; transfer-to-new-environment test | Environment-measured | Execution gate idea: GATE-adjacent. Their numbers: inform-only |
| AWM | Apache-2.0 / none stated | Offline induction from ground truth; cross-domain generalization splits | Environment/ match metrics | Protocol for skills arm: GATE-adjacent. SOTA numbers: inform-only |
| ExpeL | Apache-2.0 / — | ADD/EDIT/REMOVE-with-voting insight lifecycle; transfer test | Benchmark metrics standard | Lifecycle design reference: GATE-adjacent. Numbers: inform-only |
| SkillWeaver | MIT / research-only disclaimer | Honing: execution test + failure reason before a skill enters the library; explicit no-skill baseline toggle | Environment-driven | Execution-based promotion gate: GATE-adjacent. Numbers: inform-only |
| Reflexion | MIT / (logs in repo) | With/without-memory ablation as primary comparison; strategy factorial | Standard benchmark metrics | Ablation protocol: GATE-adjacent. Numbers: inform-only |
| MSC | — / **UNVERIFIED** (no license on ParlAI page) | Incremental write-per-session then read protocol | Paper uses perplexity + human eval | Inform-only until license verified |
| HaluMem | **CC BY-NC-ND 4.0** / **CC BY-NC-ND 4.0** | Extraction triple (recall, precision, FMR) and update triple (correct, hallucination, omission) — taxonomy only | Formula not stated in README; UNVERIFIED | Taxonomy: GATE (re-implemented deterministically). Code and data: do NOT reuse |
| MemBench | MIT badge (confirm) / none stated (Baidu/Drive hosting) | Capacity and temporal-efficiency metric axes | UNVERIFIED (paper not read) | Axis ideas: GATE-adjacent after reading paper. Data: inform-only |
| OmniMemEval / ProsusAI MemEval | Apache 2.0 / upstream licenses preserved | License-hygiene pattern (THIRD_PARTY_NOTICES) | Framework, not metrics | Inform-only |

---

## Recommendations for the benchmark design (phase 2)

**Can gate (deterministic, CI-safe):**
1. Evidence-label retrieval metrics: recall@5/10 and NDCG@5/10 over seeded facts with
   known evidence turns (LongMemEval's labels, LocAgent's rank metric) — fits the 619
   `retrieval-metrics.ts` infra.
2. All-correct Acc@k rule (LocAgent): a memory scenario passes only if *every* seeded
   fact needed for it is surfaced — punishes partial retrieval the way plain recall does
   not.
3. Update-triple on contradiction scenarios (HaluMem taxonomy, re-implemented): correct
   rate = updated rows match the newest seed; hallucination rate = rows matching no seed;
   omission rate = seeds with no row. All exact-match on seeded ids — no judge.
4. Extraction triple on write quality (HaluMem taxonomy): seeded facts in, recall /
   precision / FMR of extracted rows out, with planted distractors for FMR.
5. Normalized exact + partial F1 (LoCoMo style) for answer checks against seeded facts
   with fixed gold answers.
6. Abstention/adversarial scenarios (LongMemEval `_abs`, LoCoMo adversarial): the system
   must return "no memory" when the seeded corpus holds nothing relevant — a pure
   deterministic assertion on the curator's suppression behavior.
7. Execution-based skill promotion (Voyager self-verification, SkillWeaver honing): a
   candidate skill that is executable must pass a held-out execution test before
   promotion; failure reasons must be recorded.
8. Ablation protocol (Reflexion, SkillWeaver): every run reports with-memory vs
   no-memory / raw-grep / last-N baselines on the same scenarios.

**Must NOT gate:**
- Any LLM-judge accuracy: LongMemEval's gpt-4o judge (>97% human agreement is a
  self-reported meta-evaluation), mem0's generous gpt-4o-mini judge, and our own judge
  panel. Keep judge scores as recorded inform metrics with a pinned judge prompt, pinned
  model, and a stated non-determinism caveat.
- Any vendor-reported number: mem0's LoCoMo scores, Voyager's multipliers, AWM's SOTA,
  SkillWeaver's relative improvements. None was reproduced here; two independent mem0
  reimplementations exist because the originals are not comparable.
- Anything computed on LoCoMo or HaluMem data inside this commercial product until the
  license question is settled (CC BY-NC 4.0 and CC BY-NC-ND 4.0 respectively).

## License flags (do-not-ship list)

| Data | License | Consequence |
|---|---|---|
| LoCoMo (`locomo10.json`) | CC BY-NC 4.0 | Non-commercial only. No embedding in product or product CI without legal decision |
| HaluMem (repo and dataset) | CC BY-NC-ND 4.0 | Non-commercial, no derivatives. No reuse of code or data in any form |
| Loc-Bench (HF `czlll/Loc-Bench_V1`) | No license tag | Terms undefined. Re-implement metrics from the paper; do not redistribute data |
| MemBench data (Baidu/Drive) | None stated | Do not redistribute |
| MSC | Unstated on ParlAI page | Verify before use |
| LongMemEval data | MIT (HF card) | Reusable; prefer `longmemeval-cleaned` |

## Unknowns

- LongMemEval's Recall@k / NDCG@k formulas are not stated in the paper text retrieved;
  the implementation lives in `src/evaluation/print_retrieval_metrics.py` (repo). Smallest
  experiment: read that one file and port the definitions verbatim into our metrics module.
- HaluMem's scoring mechanics (exact match vs LLM judge) are not stated on the repo
  README. Smallest experiment: read `eval/README.md` and the method section of arXiv
  2511.03506 before trusting their reported system rankings.
- MemBench's metric definitions (accuracy, recall, capacity, temporal efficiency) are in
  arXiv 2506.21605, not the repo. Smallest experiment: read the paper's metrics section if
  we adopt the capacity/temporal axes.
- MSC's dataset license is not stated on the ParlAI project page. Smallest experiment:
  check the ParlAI task README/terms for `parlai/tasks/msc` before any data use.
- ExpeL's insight-operation details (ADD/EDIT/REMOVE/AGREE, voting counters) and AWM's
  Mind2Web metric definitions came from search-result summaries, not read directly in
  the sources. Both matter only if we cite them in design docs; read the papers first.
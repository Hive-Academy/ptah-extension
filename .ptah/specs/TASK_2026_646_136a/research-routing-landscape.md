# Research routing landscape — TASK_2026_646_136a

As of 2026-10-14. Question this supports: which model, inside which Ptah lane family, should seed a capability matrix for plan, architecture, backend implementation, frontend implementation, logic review, style review, test writing, web research, documentation, and long-context survey.

Read 2026-10-14. `ptah_web_search` was not registered in this session (tool search returned only the `tasks` server). Sources below were opened with web search and, where noted, a full page fetch.

## Matrix

Labels apply only to **implement (backend)**, and only from SWE-bench Verified run under mini-SWE-agent (source [1]). Thresholds, settled here: **strong** = resolved rate at least 72.8% (the cluster within 4.0 points of the 76.8% leader); **good** = 64.0–71.9%; **weak** = under 60%. Every [1] result was published on or before 2026-02-19, so every one of those labels is **possibly stale** (older than 2026-07).

Every other task column is **no data**. Terminal-Bench 3.0 pass rates are written beside a cell when source [2] states one. They are not converted into strong / good / weak: that benchmark mixes coding with non-coding work, and its ceiling is about 34%, so it is not on the same scale as source [1].

Context is tokens. Price is USD per 1M tokens, input / output, short-context rate unless noted. "—" means this pass did not open a primary page that states it.

| Model (lane family) | Context | Price in/out | Plan | Architecture | Implement backend | Implement UI | Review logic | Review style | Tests | Web research | Docs | Long-context survey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Opus 4.5 high (Anthropic, in-process) | — | — | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| Claude Opus 4.6 (Anthropic, in-process) | — | — | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| Claude Opus 4.8 (Anthropic; priced in the Sonnet 5 post) | — | $5 / $25 [3] | no data | no data | no data; TB3 21.1% in Claude Code [2] | no data | no data | no data | no data | no data | no data | no data |
| Claude Sonnet 4.5 high (Anthropic; also the npm-readme default of Copilot CLI [19]) | — | — | no data | no data | good [1] | no data | no data | no data | no data | no data | no data | no data |
| Claude Sonnet 5 `claude-sonnet-5` (Anthropic default on Free and Pro [3]) | — | $2 / $10 [3] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| Claude Haiku 4.5 high (Anthropic) | — | — | no data | no data | good [1] | no data | no data | no data | no data | no data | no data | no data |
| Claude Fable 5 (named on TB3 with Claude Code, not as the Ptah in-process model) | — | — | no data | no data | no data; TB3 33.8% in Claude Code [2] | no data | no data | no data | no data | no data | no data | no data |
| Claude Opus 5, Sonnet 5.5, Haiku 5.5 (names on the Copilot changelog [16][17][18]; no score opened) | — | — | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.2 high (OpenAI Codex CLI credit card [20]) | — | credits, not $/MTok [20] | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.2-Codex (OpenAI Codex CLI) | — | — | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.1 medium (OpenAI) | — | — | no data | no data | good [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.1-Codex medium (OpenAI Codex CLI) | — | — | no data | no data | good [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5 medium (OpenAI) | — | — | no data | no data | good [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5 mini medium (OpenAI) | — | — | no data | no data | weak [1] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.3-Codex, GPT-5.4, GPT-5.4-mini, GPT-5.5 (on the Codex pricing page [20]; no resolved-rate opened) | — | credits, not $/MTok [20] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.6 Sol (OpenAI; TB3 with an unnamed harness) | — | — | no data | no data | no data; TB3 34.4% [2] | no data | no data | no data | no data | no data | no data | no data |
| GPT-5.6 Terra (OpenAI) | — | — | no data | no data | no data; TB3 20.8% [2] | no data | no data | no data | no data | no data | no data | no data |
| grok-4.7 (xAI Grok CLI / API) | 500k [10] | $2 / $6; $4 / $12 once the prompt is at least 200k [10] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| grok-build-0.1 (xAI; docs call it a coding model) | 256k [10] | $1 / $2; $2 / $4 once the prompt is at least 200k [10] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| grok-4.3 (xAI; May 2026 docs index still presents this as current [10]) | 1M [10] | $1.25 / $2.50 [10] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| Gemini 3 Flash high (Google; SWE-bench row, not confirmed as the Oct 2026 Antigravity default) | — | — | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| Gemini 3 Pro (Google; SWE-bench row published 2025-11-18) | — | — | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| Gemini 4 Argon (Antigravity CLI and app for AI Ultra [12][13]; also Copilot CLI [14]) | — | $2 / $10 introductory; cached input 95% off [12] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GLM-5 high (Z.ai; Ollama Cloud quant not checked) | 200k; max out 128k [7] | $1 / $3.2 [6] | no data | no data | strong [1] | no data | no data | no data | no data | no data | no data | no data |
| GLM-4.6 (Z.ai) | — | $0.6 / $2.2 [6] | no data | no data | no data (68.2% on an undisclosed scaffold [1], not mini-SWE-agent) | no data | no data | no data | no data | no data | no data | no data |
| GLM-4.5 (Z.ai) | — | $0.6 / $2.2 [6] | no data | no data | no data (64.2% on an undisclosed scaffold [1]) | no data | no data | no data | no data | no data | no data | no data |
| GLM-5.3 (Z.ai flagship on the 2026-10-10 docs [8]) | 1M; max out 128k; text only [8] | $1.4 / $4.4 [6] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GLM-5.3-Flash (Z.ai) | 1M [8] | $0.15 / $0.50 [6] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GLM-5.2 (Z.ai) | 1M [9] | $1.4 / $4.4 [6] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GLM-5.1 (Z.ai) | 200k [6] | $1.4 / $4.4 [6] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| opencode (harness, not a model) | — | — | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |
| GitHub Copilot CLI auto (harness) | — | plan multiplier, 10% off the selected model's multiplier [15] | no data | no data | no data | no data | no data | no data | no data | no data | no data | no data |

Resolved rates behind the labels, all source [1], all possibly stale:

| Model | Resolved | Scaffold | Result published |
| --- | --- | --- | --- |
| Claude Opus 4.5 high | 76.8% | mini-SWE-agent | 2026-02-17 |
| Gemini 3 Flash high | 75.8% | mini-SWE-agent | 2026-02-17 |
| Claude Opus 4.6 | 75.6% | mini-SWE-agent | 2026-02-17 |
| Gemini 3 Pro | 74.2% | mini-SWE-agent | 2025-11-18 |
| GPT-5.2 high | 72.8% | mini-SWE-agent | 2026-02-17 |
| GPT-5.2-Codex | 72.8% | mini-SWE-agent | 2026-02-19 |
| GLM-5 high | 72.8% | mini-SWE-agent | 2026-02-17 |
| Claude Sonnet 4.5 high | 71.4% | mini-SWE-agent | 2026-02-17 |
| Claude Haiku 4.5 high | 66.6% | mini-SWE-agent | 2026-02-17 |
| GPT-5.1 medium | 66.0% | mini-SWE-agent | 2025-11-20 |
| GPT-5.1-Codex medium | 66.0% | mini-SWE-agent | 2025-11-24 |
| GPT-5 medium | 65.0% | mini-SWE-agent | 2025-08-07 |
| GPT-5 mini medium | 59.8% | mini-SWE-agent | 2025-08-07 |

Vendor self-reports that were **not** copied into the label column:

- Z.ai says GLM-5 scores 77.8 on SWE-bench Verified and 56.2 on Terminal-Bench 2.0 [7]. Source [1] records 72.8% for the same model name under mini-SWE-agent.
- Z.ai says GLM-5.2 scores 81.0 on Terminal-Bench 2.1 against GLM-5.1 at 62.0, and 62.1 on SWE-bench Pro against GLM-5.1 at 58.4 [9]. Not checked against a maintainer board.
- Z.ai says GLM-5.3 moves Terminal-Bench 3.0 from GLM-5.2's 4.6 to 28.3, and at max effort reaches 34.5% against GLM-5.2's 23.4% [8]. The Terminal-Bench 3.0 post that was fetched [2] does not list GLM-5.3.
- Google says Gemini 4 Argon, inside Google, raised agentic code submissions by more than 35% and cut post-submit rollbacks by nearly a third [13]. No public task count or denominator.
- GitHub says Gemini 4 Argon solved more Copilot tasks than earlier Gemini models on every coding benchmark they ran, with the largest gain in Copilot CLI [14]. No percentages.

Lane notes that are not scores:

- **opencode** has no single default model. The docs list, "in no particular order" and "not necessarily up to date", GPT 5.2, GPT 5.1 Codex, Claude Opus 4.5, Claude Sonnet 4.5, Minimax M2.1, and Gemini 3 Pro [4]. A configured model that is missing falls back to "the newest available supported model" [5]. The `model` snippets on those pages are examples (`lmstudio/google/gemma-3n-e4b`, `anthropic/claude-sonnet-4-5`), not a shipped default.
- **Copilot CLI auto**, as of the 2026-04-17 changelog, routed to GPT-5.4, GPT-5.3-Codex, Sonnet 4.6, and Haiku 4.5, and the post says that set will change [15]. Later changelogs add Claude Sonnet 5.5 and GPT-6.1 Sol (2026-10-02) [17], Claude Haiku 5.5 (2026-10-09) [16], and Gemini 4 Argon in the CLI model picker (2026-10-13) [14]. On 2026-10-02 GitHub deprecated Gemini 3.5 Flash, Gemini 3.6 Flash, Kimi K2.7 Code, and Claude Opus 4.7, naming Gemini 3.8 Flash, Kimi K3, and Claude Opus 5 as the alternatives [18]. The `@github/copilot` 1.0.97 readme still says the CLI defaults to Claude Sonnet 4.5 [19]. That sentence disagrees with auto and with the October changelog. Treat the readme as possibly stale.
- **Copilot CLI** can also attach an OpenAI-compatible endpoint (including Ollama), Azure OpenAI, or Anthropic, and from CLI 1.0.94-0 (2026-10-07) `/model` can discover a running local Ollama [16]. Discovery does not install the model. Tool-calling and streaming are required.
- **xAI docs disagree with themselves.** `https://docs.x.ai/developers/models` says "Last updated: May 29, 2026" and presents Grok 4.3 as the model to use for everything else [10]. The models markdown and the pricing page, the latter carrying a 2026-10-10 stamp in search, list grok-4.7 as the code-and-general flagship and grok-build-0.1 as the fast coding model [10][11]. This report uses the October pricing table for rates and does not treat the May index as current.
- **Grok 4.5** was dropped from the Terminal-Bench 3.0 cost chart because of a cost-reporting bug in the Cursor CLI harness [2]. No Grok pass rate is stated in that post.
- **Aider polyglot** was not used. Two readings of the same board disagree, and both stop before July 2026: the docs page extract still shows Gemini 2.5 Pro Preview 03-25 at 72.9% near the top [21], while a 2026-10-10 check of the maintainer board reports gpt-5 (high) at 88% dated 2025-08-23 and no newer entry since 2025-10-03 [21].

## Sources

1. BenchLeader, "SWE-bench Verified (any scaffold)", https://www.benchleader.com/benchmarks/swe_bench_verified_any, data as of 2026-10-13, citing https://www.swebench.com/. Measures percent of 500 human-filtered GitHub issues resolved. Full page fetched 2026-10-14. The page text says the bash-only mini-SWE-agent board is the comparable one, then prints a mixed-scaffold table. Rows used here are the ones whose scaffold cell is `mini-SWE-agent`. A second mirror, https://models.fru.dev/boards/swe-bench-verified (captured 2026-10-13), calls this board stale since 2026-02-26. The swebench.com HTML fetched via search did not include numeric rows; it does describe the bash-only setup as mini-SWE-agent on 500 instances (https://www.swebench.com/verified.html).
2. Terminal-Bench 3.0 announcement, https://www.tbench.ai/news/terminal-bench-3-0. Page undated; full page fetched 2026-10-14. First release: 74 tasks, 7 domains. Best models about 34%. Stated pass rates: GPT-5.6 Sol 34.4%, Fable 5 in Claude Code 33.8%, Opus 4.8 in Claude Code 21.1%, GPT-5.6 Terra 20.8%. Fable 5 and Opus 4.8 are 4.9 points apart on Terminal-Bench 2.1 and 12.7 points apart on 3.0. GPT-5.6 Sol is about 40% cheaper and uses about 50% fewer tokens than Fable 5, per the post. Not a backend-only benchmark.
3. Anthropic, "Introducing Claude Sonnet 5", https://www.anthropic.com/news/claude-sonnet-5, 2026-06-30, pricing edit 2026-08-10. Full page fetched 2026-10-14. Sonnet 5 is the default on Free and Pro, API id `claude-sonnet-5`, $2 / $10 per million, made permanent on 2026-08-10. The same post prices Opus 4.8 at $5 / $25. The coding comparison with Sonnet 4.6 and Opus 4.8 is an image; those percentages are not in the HTML and are not transcribed here. Tokenizer note: the same input can be about 1.0–1.35× more tokens than Sonnet 4.6. Partner quotes describe planning, tool use, and an unprompted reproducing test. Those are anecdotes, not a score.
4. OpenCode, "Models", https://opencode.ai/docs/models/. Search extract dated 2026-10-13. Recommended-model list quoted above. States the list is not exhaustive and not necessarily current.
5. OpenCode v2, "Models", https://opencode.ai/v2/docs/models/. Search extract. Configured default, session override, and fallback to the newest available supported model.
6. Z.AI, "Pricing", https://docs.z.ai/guides/overview/pricing and https://docs.z.ai/guides/overview/pricing.md. Search extract, page timestamp 2026-10-10. USD per 1M tokens. Also lists Web Search at $0.01 per use. That is a tool price, not a research-quality score. GLM-5.1 context of 200k is from the model overview linked from this docs set (https://docs.z.ai/guides/llm/glm-5.1), same crawl.
7. Z.AI, "GLM-5", https://docs.z.ai/guides/llm/glm-5. Search extract. Context 200k, max output 128k. Vendor SWE-bench Verified 77.8 and Terminal-Bench 2.0 56.2. Self-report. Release note dates GLM-5 to 2026-02-12 (https://docs.z.ai/release-notes/new-released).
8. Z.AI, "GLM-5.3", https://docs.z.ai/guides/llm/glm-5.3, and the family overview https://docs.z.ai/guides/overview/overview. Search extract, page timestamp 2026-10-10. 1M context, 128k max output, text only, reasoning always on (`low`, `high`, `max`). Vendor Terminal-Bench 3.0 figures quoted above. Release note dates GLM-5.3 to 2026-08-18 and GLM-5.3-Flash to 2026-08-26. The overview's "matches Claude Fable 5" and "1/40 the price of Opus 4.8" lines are marketing and were not used as scores.
9. Z.AI, "GLM-5.2", https://docs.z.ai/guides/llm/glm-5.2. Search extract, page timestamp 2026-10-10. 1M context. Vendor Terminal-Bench 2.1 and SWE-bench Pro figures quoted above. Self-report.
10. xAI models markdown, https://x.ai/docs/developers/models.md, search extract, and the HTML index https://docs.x.ai/developers/models, which says last updated 2026-05-29. Rates and windows for grok-4.7, grok-4.6, grok-4.5, grok-4.3, grok-build-0.1. The markdown says to use Grok 4.7 for code and everything else, and gives Grok 4.7 a knowledge cutoff of May 2026. The May index still recommends Grok 4.3.
11. xAI, "Pricing", https://docs.x.ai/developers/pricing. Search extract published 2026-10-10. Same token rates as [10]. States that Grok 4.7 Fast is 2× standard (1.5× on long context), is only in Cursor and Grok Build, and is not on the public API.
12. Koray Kavukcuoglu, "Gemini 4 Argon is now available for everyone", https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon, 2026-10-13. Search extract. Introductory API price $2 / $10 per million, cached input 95% off. Available in Antigravity for Google AI Ultra subscribers.
13. Google Antigravity, "Gemini 4 Argon in Google Antigravity", https://antigravity.google/blog/gemini-4-argon-in-google-antigravity, 2026-10-13. Search extract. Rollout to the desktop app and the CLI for AI Ultra. Internal Google claim of more than 35% more agentic code submissions and nearly a third fewer rollbacks.
14. GitHub Changelog, "Gemini 4 Argon in GitHub Copilot", https://github.blog/changelog/2026-10-13-gemini-4-argon-in-github-copilot/, 2026-10-13. Search extract. Model picker includes Copilot CLI, for Pro+, Max, Business, and Enterprise. No numeric score.
15. GitHub Changelog, "GitHub Copilot CLI now supports Copilot auto model selection", https://github.blog/changelog/2026-04-17-github-copilot-cli-now-supports-copilot-auto-model-selection/, 2026-04-17. Possibly stale as a model list. Auto routes among models "like" GPT-5.4, GPT-5.3-Codex, Sonnet 4.6, and Haiku 4.5; the set changes; 10% off the selected model's premium-request multiplier. Measures a routing policy, not quality.
16. GitHub Changelog, weekly releases dated October 5, https://github.blog/changelog/2026-10-09-github-copilot-weekly-releases-october-5/, 2026-10-09, and "Discover local models in GitHub Copilot CLI", https://github.blog/changelog/2026-10-07-discover-local-models-in-github-copilot-cli/, 2026-10-07. Claude Haiku 5.5 added. CLI 1.0.94-0 discovers local Ollama models.
17. GitHub Changelog, weekly releases dated September 28, https://github.blog/changelog/2026-10-02-github-copilot-weekly-releases-september-28/, 2026-10-02. Claude Sonnet 5.5 for Pro, Pro+, Max, Business, and Enterprise. GPT-6.1 Sol for Pro+, Max, Business, and Enterprise.
18. GitHub Changelog, "Upcoming deprecation of selected GitHub Copilot models", https://github.blog/changelog/2026-09-03-upcoming-deprecation-of-selected-github-copilot-models/, 2026-09-03. Deprecation date 2026-10-02. Names Claude Opus 5 as the suggested alternative to Claude Opus 4.7. This is evidence the name is on the Copilot roster, not a benchmark.
19. npm readme for `@github/copilot` 1.0.97, https://www.npmjs.com/package/@github/copilot. Search extract dated 2026-10-13. "By default, `copilot` utilizes Claude Sonnet 4.5." Conflicts with [15] and [17]. Possibly stale.
20. OpenAI, "Pricing – Codex", https://developers.openai.com/codex/pricing. Search extract, page undated, retrieved 2026-10-14. Subscription prices: Free $0, Go $8, Plus $20, Pro from $100. Credit rates per 1M tokens (input / cached input / output): GPT-5.5 125 / 12.50 / 750; GPT-5.4 62.50 / 6.250 / 375; GPT-5.4-mini 18.75 / 1.875 / 113; GPT-5.3-Codex 43.75 / 4.375 / 350; GPT-5.2 43.75 / 4.375 / 350. The extract does not give a dollar value per credit, so this report does not convert those rows to $/MTok. A secondary page (https://usagebox.com/articles/openai-codex-pricing-usage-limits-2026, 2026-10-10) claims a GPT-6 lineup and a GPT-5.5 retirement on 2026-10-14. That claim is not on the official extract that was read, so it is not used.
21. Aider leaderboards, https://aider.chat/docs/leaderboards (search extract, undated) and https://canagentswork.com/benchmarks/aider-polyglot/ (says last checked 2026-10-10). Polyglot is 225 Exercism exercises across C++, Go, Java, JavaScript, Python, and Rust. The two readings disagree on the current top row. Newest dated result in the second reading is 2025-08-23. Possibly stale. Not used for labels.
22. Discarded aggregators, searched 2026-10-14 and not used for any cell: https://benchlm.ai/benchmarks/swe-bench-verified (2026-10-13), https://anotherwrapper.com/tools/llm-pricing/evals/swe-bench-verified (2026-10-13), https://llmstiger.com/benchmarks/swe-verified (2026-10-13), https://genztech.blog/ai-coding-leaderboard/ (page says data last changed 2026-09-28). Each publishes a SWE-bench Verified leader whose top names and percentages are absent from [1], and they disagree with each other. Their percentages are intentionally not repeated here.

Not examined, so no cell depends on them: LiveCodeBench, the LMArena WebDev slice, an independent SWE-bench Pro maintainer board, OpenRouter rankings, and any Martian or NotDiamond router write-up. Searches did not return a primary table for those that this pass could check.

## Seed format proposal

One entry is one lane family plus one model id pattern. Scores are raw benchmark rates on 0..1 (0.728 means 72.8% resolved), never a blend across benchmarks and never a rescaled "utility". A missing task key means no data. It does not mean zero. `stale` is true when the result's publication date is before 2026-07, even if a mirror re-read the row in October.

```json
{
  "laneFamily": "openai-codex",
  "modelIdPattern": "gpt-5.2-codex",
  "contextTokens": null,
  "pricePerMillion": null,
  "tasks": {
    "implement-backend": {
      "label": "strong",
      "score": 0.728,
      "benchmark": "SWE-bench Verified, mini-SWE-agent",
      "source": "https://www.benchleader.com/benchmarks/swe_bench_verified_any",
      "asOf": "2026-02-19",
      "readOn": "2026-10-13",
      "stale": true
    }
  }
}
```

Example 1, from the GPT-5.2-Codex row:

```json
{
  "laneFamily": "openai-codex",
  "modelIdPattern": "gpt-5.2-codex",
  "contextTokens": null,
  "pricePerMillion": null,
  "tasks": {
    "implement-backend": {
      "label": "strong",
      "score": 0.728,
      "benchmark": "SWE-bench Verified, mini-SWE-agent",
      "source": "https://www.benchleader.com/benchmarks/swe_bench_verified_any",
      "asOf": "2026-02-19",
      "readOn": "2026-10-13",
      "stale": true
    }
  }
}
```

Example 2, from the Claude Opus 4.5 row. Run cost on that row was $376.95 for the full eval [1], which is not a per-token price, so `pricePerMillion` stays null.

```json
{
  "laneFamily": "anthropic",
  "modelIdPattern": "claude-opus-4-5",
  "contextTokens": null,
  "pricePerMillion": null,
  "tasks": {
    "implement-backend": {
      "label": "strong",
      "score": 0.768,
      "benchmark": "SWE-bench Verified, mini-SWE-agent",
      "source": "https://www.benchleader.com/benchmarks/swe_bench_verified_any",
      "asOf": "2026-02-17",
      "readOn": "2026-10-13",
      "stale": true
    }
  }
}
```

Example 3, from the GLM-5 row. The vendor's 77.8 is a different scaffold [7] and is not the score.

```json
{
  "laneFamily": "glm-ollama-cloud",
  "modelIdPattern": "glm-5",
  "contextTokens": 200000,
  "pricePerMillion": { "input": 1.0, "output": 3.2, "source": "https://docs.z.ai/guides/overview/pricing", "asOf": "2026-10-10" },
  "tasks": {
    "implement-backend": {
      "label": "strong",
      "score": 0.728,
      "benchmark": "SWE-bench Verified, mini-SWE-agent",
      "source": "https://www.benchleader.com/benchmarks/swe_bench_verified_any",
      "asOf": "2026-02-17",
      "readOn": "2026-10-13",
      "stale": true,
      "disagreesWith": {
        "score": 0.778,
        "source": "https://docs.z.ai/guides/llm/glm-5",
        "note": "Vendor figure, scaffold not the mini-SWE-agent row"
      }
    }
  }
}
```

`modelIdPattern` is a pattern, not a promise that the lane has that id installed. opencode and Copilot CLI should not get a score of their own. A seed row for those families should point at the model id the harness actually selected.

## Caveats

- **The only cross-family table that was fetched in full is already old.** Source [1] was re-read on 2026-10-13, but the mini-SWE-agent results it shows were published by 2026-02-19. Models shipped after that (Sonnet 5, Opus 4.8, Fable 5, GPT-5.3-Codex and later, grok-4.7, grok-build-0.1, GLM-5.1 and later, Gemini 4 Argon) have no cell in that table. Copying a February rank onto an October model id would route to the wrong generation.
- **Terminal-Bench 3.0 reorders the names that do have a fresh number.** On source [2], GPT-5.6 Sol (34.4%) and Fable 5 in Claude Code (33.8%) sit at the ceiling, and Opus 4.8 in Claude Code is at 21.1%. A matrix that still calls "the latest Opus" the backend implementer, because Opus 4.5 led SWE-bench in February, contradicts this post.
- **Harness and scaffold move the number.** Source [1] mixes mini-SWE-agent with other scaffolds and still titles one view "any scaffold". GLM-4.6 at 68.2% and GLM-4.5 at 64.2% are "Undisclosed" and were not labeled. Z.ai's GLM-5 figure is 5 points higher than the mini-SWE-agent row. TB3 names Claude Code for Fable 5 and Opus 4.8, and names no harness for the GPT-5.6 rows. A lane score is a model-plus-harness score. opencode, Copilot CLI, Codex CLI, Grok CLI, and Antigravity CLI are not mini-SWE-agent.
- **Vendor self-reporting is the bulk of the October claims.** Argon's Google-internal rollout stats [13], Copilot's "every coding benchmark" sentence [14], and the Z.ai Terminal-Bench and SWE-bench Pro sentences [7][8][9] did not come with a public run log in the pages that were read. They stay in Sources and out of the label column.
- **Aggregator pages dated October 2026 contradict the maintainer mirror and each other** [22]. Several are written as if they were leaderboards. They were discarded rather than averaged.
- **Contamination and saturation are why TB3 exists.** The TB3 post says many Terminal-Bench tasks are saturated and the old leaderboard is compressed into a narrow band [2]. SWE-bench Verified is a fixed set of 500 public issues. A high score on it, especially a vendor score with a private scaffold, can be memorization or scaffold tuning. This pass did not test contamination.
- **This goes stale in weeks, not quarters.** Between 2026-09-03 and 2026-10-13 the Copilot changelog alone deprecated four models, added Haiku 5.5, Sonnet 5.5, GPT-6.1 Sol, and Gemini 4 Argon, and shipped Ollama discovery [14][16][17][18]. xAI's own docs index is still on a May 2026 "current model" [10]. A seed needs `asOf` and `stale`, and local lane outcomes have to be allowed to override it. The task context already says that. The public data here is too thin to do anything else.
- **Nine of the ten task kinds have no checked public number** for these lane families: plan, architecture, UI implementation, logic review, style review, test writing, web research, documentation, and long-context quality. Published context length is capacity, not a survey score. Published web-search tool prices (Grok's older tool card was not re-verified; Z.ai lists web search at $0.01 per use [6]) are not a research score. Sonnet 5's partner quotes about staying on plan and writing a reproducing test [3] are not a test-writing benchmark.
- **Ollama Cloud was not queried.** GLM rows are Z.ai's API model cards. Whether Ollama Cloud serves the same checkpoint, the same context, or a quant under a different id was not checked.

## Decisions

- **Trust order.** A full-page fetch of a maintainer or vendor primary page beats a search extract. A search extract of a primary page beats an aggregator. Aggregators that disagree with source [1] were dropped [22]. Where two primary pages disagree (GLM-5 72.8% vs 77.8%; Copilot readme default vs changelog; xAI May index vs October pricing), both are recorded and the label uses the comparable independent row, or no label.
- **One benchmark, one scale.** Implement (backend) labels use only mini-SWE-agent SWE-bench Verified [1]. Terminal-Bench 3.0 is stored beside the cell and is not mapped onto strong / good / weak [2].
- **Thresholds** are the ones stated above the matrix: strong ≥ 72.8%, good 64.0–71.9%, weak < 60%, on that one board. They are a reading aid for a 4-point cluster, not a general law.
- **Possibly stale** means the result's own publication date is before 2026-07. Re-reading it on 2026-10-13 does not make it fresh. Every strong / good / weak cell in this report is possibly stale.
- **No default model for opencode** [4][5]. The seed must not hard-code one.
- **Copilot CLI and opencode are harnesses.** Their seed entry should record the selected model id, then use that model's row. Auto's April model list [15] is a policy snapshot, not a quality ranking.
- **Empty cells stay empty.** Plan, architecture, UI, both review kinds, tests, web research, docs, and long-context quality are no data. Filling them from SWE-bench, or from a vendor adjective, would invent the matrix this seed is supposed to avoid.
- **What was not settled.** Which October flagship is best at backend work. Source [2] puts GPT-5.6 Sol and Fable 5 ahead of Opus 4.8 on a hard mixed terminal bench, and source [1] cannot score those names at all. Which GLM id Ollama Cloud actually serves. The dollar price of a Codex credit [20]. Sonnet 5's context window (the HTML states price and a tokenizer expansion, not the window [3]). LiveCodeBench, LMArena WebDev, and SWE-bench Pro as independent boards.

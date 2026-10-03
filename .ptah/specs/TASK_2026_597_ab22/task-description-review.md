# Review - task-description.md (TASK_2026_597_ab22)

| Field             | Value                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Artifact          | `task-description.md`                                                                                   |
| Author            | project-manager subagent                                                                                |
| Reviewer          | independent document reviewer (Claude subagent, same-side; reason: user disabled CLI lanes at Gate 0.1) |
| Artifact revision | 2                                                                                                       |
| Round             | 2                                                                                                       |
| Verdict           | **APPROVED** (minor notes N1-N6 carried to the architect; none blocks Gate 1)                           |

Round 1 (revision 1) gave REVISE: F1 was Blocking and F2-F6 were Serious. Revision 2 resolves all twelve findings. Two
new inputs settle the points that were open in round 1:

- context.md § User Decisions item 6: live proof through small budgeted runs, done by the senior-tester at QA only.
- `research-report.md`: verified Codex keys, a measured prefix, and source-level answers to E2-E5.

The revision adds no Blocking or Serious defects. Six Minor items are listed in § 2.

## 1. Round-1 findings: status

| #   | Sev.     | Finding (round 1)                                                 | Status                          | Evidence in revision 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------- | ----------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Blocking | Live measurements conflict with the lanes-disabled rule; no owner | **Resolved**                    | Verification method M (offline) and L (:82-100) follow decision 6. The senior-tester owns L, which runs only at QA, uses direct `codex exec` / `opencode run`, and is capped at 5 runs per runtime. L runs use adapter-generated config. The Codex "before" figures come from existing rollouts. Every live criterion names its owner. The NFR on quota is at :352.                                                                                                                                                                                                      |
| F2  | Serious  | Role block never reduced; the R3.3 target is at risk              | **Resolved**                    | R3.6 (:185-192) caps the rendered lane role at 10,000 chars on every rendering adapter and keeps Wave 4.5 fields out (:72-74). R3.7 (:193) is the measurable <18k outcome. See N2 on the margin.                                                                                                                                                                                                                                                                                                                                                                         |
| F3  | Serious  | Codex capabilities unverified                                     | **Resolved**                    | Each item is now verify-first with a stated fallback: R3.1 (`enabled_tools` in code-mode), R4.2 (`tool_output_token_limit`), R9.1 (per-request usage read from rollout or db, else a labelled estimate), R9.3 (steer delivered at the turn boundary or on resume), R9.6 (`agents.enabled=false`, then `max_depth`, then stop on the event). The isolated `CODEX_HOME` option is dropped with a reason (:78-79, research Option B). R3.3 now allows runtime-written rollouts, which removes the round-1 internal conflict. `tool_timeout_sec` is verified (research :20). |
| F4  | Serious  | Cost weights invented and Claude-specific                         | **Resolved**                    | R7.3 (:286-290) uses `findModelPricing` (`libs/shared/src/lib/utils/pricing.utils.ts:221`) and records "unknown" when a model has no entry. See N4.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F5  | Serious  | Effort precedence and reviewer identification ambiguous           | **Resolved**                    | R2.3 gives a six-step order; R2.4 gives the identification rule (`-reviewer` suffix or `senior-tester`) and a unit test per step.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F6  | Serious  | R3.5 accepts the resume resend                                    | **Resolved**                    | R3.5 (:180-184) requires the role at most once, measured on a resumed L run. Any unavoidable duplicate must have its cost and reason recorded.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F7  | Minor    | Vague wording                                                     | **Resolved** (one item carried) | R1.1 now uses exact figures. R5.1 adds a threshold mapping and a visible rejection of out-of-range values. R5.3 and R5.4 now name a setting and a default, and R5.3 is scoped to SDK subagents. The R9.2 size bound is carried as an architect open note (:377), which is acceptable because no source gives a number.                                                                                                                                                                                                                                                   |
| F8  | Minor    | Repeat threshold of 20 had no source                              | **Resolved**                    | Tokaudit W4.4 states it ("20 identical tool+args calls per message"), and R9.4 makes it a setting. See N1 on the citation path.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F9  | Minor    | Web search control vs the NFR                                     | **Resolved**                    | R4.4 (:217): on by default, and turning it off is a user choice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F10 | Minor    | Hexagonal boundary missing from the NFR                           | **Resolved**                    | The NFR "Platform boundary" (:343-346) now states it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F11 | Minor    | Line drift                                                        | **Resolved**                    | Context cites `:684` and `:71,382,404,426`, which match `main` and research :39.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F12 | Minor    | Keeping the PreCompact reactor not explicit                       | **Resolved**                    | R5.5 (:256-257).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| —   | —        | Missed defects (role size, resume resend, OpenCode user config)   | **Resolved**                    | R3.6, R3.5, R1.3 (OpenCode MCP servers and plugins) and R8.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Scope check (round 2):

- Nothing from Track B, Wave 4.1, Wave 4.5 or Wave 0.5 is in scope.
- A1 stays gated on the E2 live confirmation, per model class (R5.1).
- The default model is still the architect's Gate 2 proposal. `gpt-6-sol` is cited only as research's recommendation (R2.1).
- Decision 5 holds (R3.3, R4.5, NFR).

## 2. New defects introduced by revision 2 (all Minor)

1. **N1 - Ambiguous citation.**
   - R9.4 (:323-324) cites `research-report.md:319`. The task folder's `research-report.md` has 114 lines.
   - The line meant is in `.ptah/specs/TASK_2026_557_tokaudit/research-report.md:319`. Fix the path.
2. **N2 - The R3.6 rationale is mislabeled, and its budget is thin.**
   - It says "R3.4 budget arithmetic"; the target is in R3.7.
   - Its sum leaves about 600 tokens of margin: 21.4k + 12.4k + 2k + 10k ≈ 45.8k chars ≈ 17.4k tokens at 0.38 tokens per
     char.
   - The "permissions and environment ~2k" figure comes from the rollout (about 1.8k: 363 + 920 + 474). The local
     `debug prompt-input` render shows permissions at 5,378 (research :25).
   - The architect should confirm which figure applies to lanes. R3.7 stays the binding test, so this is not blocking.
3. **N3 - The L scope reaches beyond the wording of decision 6.**
   - Decision 6 names `codex exec` / `opencode run`.
   - L also uses headless Claude-side sessions for Ollama Cloud (R1.3, R6.1, R8.3) and for E2, E3 and E4 (R1.4, R5.1).
     These spend Claude or Ollama quota, and the "5 per runtime" cap does not say which runtime they count against.
   - Fix: state a Claude-side and Ollama run budget, or have the coordinator confirm with the user at Gate 1.
4. **N4 - R7.3 can still produce a guessed zero.**
   - `ModelPricing.cacheReadCostPerToken` and `cacheCreationCostPerToken` are optional (`pricing.utils.ts:24,26`).
   - A model with an entry but no cache price would cost cached tokens at 0. R7.3 should treat a missing cache price as
     "unknown" as well.
   - No `gpt-6-*` entry was found in the file, so Codex lane cost will read "unknown" until the pricing catalogue is
     extended. Record that as expected.
5. **N5 - The L cheap model must be a code-mode GPT-6 model.**
   - R3.7, R4.2, R4.3 and R9.6 run L "on the cheap model".
   - Tool routing differs by `tool_mode` (research :23): GPT-6 models are `code_mode_only`.
   - Require a GPT-6 model (for example `gpt-6-luna`) so the results transfer to the shipped default.
6. **N6 - Two small gaps.**
   - R8.1's "leave `compaction.prune` off if the L run shows a regression" does not define regression. Suggest: task not
     completed, or total input higher than the run without prune.
   - Revision 1's R8.2 surfaced the "Ollama Cloud does not cache" finding in the settings description. Revision 2 drops
     that; R7.4 covers only the usage display. Consider restoring the settings hint.

## 3. Verdict

APPROVED for Gate 1. N1-N6 are Minor. They can be fixed in a quick revision or carried into the architect's plan as
open notes; N3 is the one worth raising with the user at Gate 1.

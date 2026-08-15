---
title: Skill Synthesis Settings
description: Every skillSynthesis.* key — thresholds, the drain queue, lane routing, and the phase-3 gates.
---

# Skill Synthesis Settings

All 76 `skillSynthesis.*` keys live in `~/.ptah/settings.json` (file-based settings, not `package.json`). **Settings → Skill Synthesis** edits the core thresholds, the budget, and most of the drain queue. The triggers, the four lane sub-trees, and the three phase-3 gates have no panel UI yet — edit those directly in the settings file.

:::caution[Background learning spends tokens by default]
`skillSynthesis.enabled` defaults to `true`. The moment a session ends, Ptah may spend LLM calls analyzing it, judging candidates, and (on the weekly tier) running the phase-3 gates — all before you touch a setting. `skillSynthesis.enabled` is the master switch and the **first** gate the drain checks; the Electron tray's "Pause background learning" toggle writes this same key.
:::

## How a skill actually gets promoted

Two independent tracks read these settings, and several keys only make sense once you know which track they belong to:

- **Track 1 — single-session, fully automated.** A candidate that repeats `successesToPromote` (3) times, clears `minJudgeScore` (6.0) on a `scored` judge verdict, and either has no replay confidence or clears the replay floor, is promoted straight to `~/.ptah/skills/<slug>/` — no human gate.
- **Track 2 — cluster, human-in-the-loop.** The curator clusters similar candidates (`suggestionMinClusterSize`), drafts one generalized skill, judges it, and inserts a pending suggestion under Skills → Recommended. It ships only when you accept it.

## Core

| Key                                             | Default     | What it does                                                                                                                                                                                                              |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skillSynthesis.enabled`                        | `true`      | Master switch. First gate the drain checks; disabling it stops both detection and promotion.                                                                                                                              |
| `skillSynthesis.successesToPromote`             | `3`         | Successful repetitions before Track 1 promotes a candidate directly.                                                                                                                                                      |
| `skillSynthesis.dedupCosineThreshold`           | `0.85`      | Embedding similarity above which a trajectory is treated as a duplicate of an already-active skill.                                                                                                                       |
| `skillSynthesis.maxActiveSkills`                | `200`       | Residency cap. The weakest resident (by `evictionDecayRate`-weighted recency) is demoted to `dormant`, never deleted, when exceeded.                                                                                      |
| `skillSynthesis.candidatesDir`                  | `''`        | Override location for promoted skills. `''` means `~/.ptah/skills/`.                                                                                                                                                      |
| `skillSynthesis.eligibilityMinTurns`            | `5`         | Minimum session turns for the prefilter's depth-based acceptance path (paired with `prefilterMinChars`).                                                                                                                  |
| `skillSynthesis.evictionDecayRate`              | `0.95`      | Exponential decay (0–1) applied to invocation recency when ranking residents for `maxActiveSkills` eviction.                                                                                                              |
| `skillSynthesis.generalizationContextThreshold` | `3`         | Distinct-context count at which the promotion bar halves: `ceil(successesToPromote / 2)` instead of the full `successesToPromote`.                                                                                        |
| `skillSynthesis.dedupClusterThreshold`          | `0.78`      | Cosine distance for Track 2's cluster-centroid grouping. Distinct from `dedupCosineThreshold`, which is Track 1's active-skill dedup.                                                                                     |
| `skillSynthesis.prefilterMinEdits`              | `1`         | Minimum file edits for the prefilter's edit-only acceptance path (accepted alone).                                                                                                                                        |
| `skillSynthesis.prefilterMinChars`              | `800`       | Minimum transcript length, paired with `eligibilityMinTurns`, for the depth-based acceptance path.                                                                                                                        |
| `skillSynthesis.prefilterMinToolUses`           | `2`         | Minimum tool calls for the prefilter's tool-heavy acceptance path (accepted alone).                                                                                                                                       |
| `skillSynthesis.judgeEnabled`                   | `true`      | Whether the LLM judge gate runs during promotion and the suggestion pass.                                                                                                                                                 |
| `skillSynthesis.minJudgeScore`                  | `6.0`       | Minimum average judge score (0–10, across five criteria) a `scored` verdict must clear. The judge never fabricates a score — `unscored` and `disabled` verdicts are neither a pass nor a block, regardless of this value. |
| `skillSynthesis.judgeModel`                     | `'inherit'` | Legacy model resolution used where a per-lane model isn't yet wired (still read by the skill enhancer). Superseded elsewhere by the `judge` lane below.                                                                   |
| `skillSynthesis.maxPinnedSkills`                | `10`        | Cap on manually pinned skills; pinning past it throws rather than silently evicting another pin.                                                                                                                          |
| `skillSynthesis.curatorEnabled`                 | `true`      | Whether the periodic Track 2 curator pass runs (clustering, suggestions, auto-enhancement).                                                                                                                               |
| `skillSynthesis.curatorIntervalHours`           | `24`        | How often the curator pass runs.                                                                                                                                                                                          |
| `skillSynthesis.suggestionMinClusterSize`       | `2`         | Similar candidates required before Track 2 drafts a Recommended suggestion.                                                                                                                                               |
| `skillSynthesis.suggestionMaxCandidates`        | `200`       | Cap on candidates considered per curator pass.                                                                                                                                                                            |
| `skillSynthesis.trayKeepalive`                  | `false`     | Electron only. Keeps the tray process alive so scheduled drains can still run with the main window closed.                                                                                                                |

## Triggers (`skillSynthesis.triggers.*`)

Not exposed in the settings panel — edit `~/.ptah/settings.json` directly. These decide when a session gets queued for analysis, not whether it is promoted.

| Key                                                | Default  | What it does                                                     |
| -------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `skillSynthesis.triggers.sessionEnd`               | `true`   | Queue an analysis pass when a session ends.                      |
| `skillSynthesis.triggers.idleMs`                   | `600000` | Queue an analysis pass after this many idle milliseconds.        |
| `skillSynthesis.triggers.bootScan`                 | `true`   | Scan for un-analyzed sessions on host startup.                   |
| `skillSynthesis.triggers.subagentStop.enabled`     | `true`   | Queue an analysis pass when a subagent run stops.                |
| `skillSynthesis.triggers.postToolUse.enabled`      | `true`   | Queue an analysis pass after a burst of tool use.                |
| `skillSynthesis.triggers.postToolUse.minEditCount` | `3`      | Edit count that counts as a "burst" for the trigger above.       |
| `skillSynthesis.triggers.maxAnalyzesPerHour`       | `6`      | Rate limit on analysis passes triggered this way, per workspace. |

Every trigger funnels into the same `prefilter` queue row — queuing is free (a cheap regex pass); the token spend starts at `archaeology`.

## Drain / queue (`skillSynthesis.drain.*`)

The durable SQLite queue that replaced inline session-end analysis. Gate order on every tick: `skillSynthesis.enabled` → daily token budget → battery → foreground backoff.

| Key                                          | Default          | What it does                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skillSynthesis.drain.cronExpr`              | `'*/15 * * * *'` | Frequent-tier cron — fires 96×/day.                                                                                                                                                                                                                                                                                                                |
| `skillSynthesis.drain.nightlyCronExpr`       | `'0 3 * * *'`    | Nightly-tier cron — fires once/day.                                                                                                                                                                                                                                                                                                                |
| `skillSynthesis.drain.weeklyCronExpr`        | `'0 4 * * 0'`    | Weekly-tier cron — fires once/week. The three phase-3 gates only run on this tier.                                                                                                                                                                                                                                                                 |
| `skillSynthesis.drain.maxItemsPerRun`        | `4`              | Frequent tier's item cap per tick, taken in one round-robin round.                                                                                                                                                                                                                                                                                 |
| `skillSynthesis.drain.nightlyMaxItemsPerRun` | `40`             | Nightly tier's whole-day item supply, dealt out over repeated rounds. **File-settings only — not on the RPC wire.** The settings panel's "Max items per run" field is bound to `drain.maxItemsPerRun` alone; it does not read or write this key, and the nightly tier ignores whatever the panel shows. Edit `~/.ptah/settings.json` to change it. |
| `skillSynthesis.drain.perWorkspaceBatch`     | `1`              | Per-workspace fairness quantum per round. Must stay `1` for every tier — raising it re-creates the starvation bug it was set to fix.                                                                                                                                                                                                               |
| `skillSynthesis.drain.foregroundBackoffMs`   | `300000`         | How recently you must have chatted before the drain skips a tick to avoid competing with foreground work. `0` disables this gate.                                                                                                                                                                                                                  |
| `skillSynthesis.drain.pauseOnBattery`        | `true`           | Skip draining while the host is on battery power.                                                                                                                                                                                                                                                                                                  |
| `skillSynthesis.drain.maxAttempts`           | `5`              | Retry ceiling — applies to `timeout` failures only. An unresolvable-auth row stalls indefinitely and never counts against this ceiling; that's a configuration fault meant to be fixed, not given up on.                                                                                                                                           |
| `skillSynthesis.drain.staleClaimTtlMs`       | `900000`         | How long a claimed-but-not-heartbeated row waits before another worker reclaims it. Should stay at least 3× the longest lane `timeoutMs`.                                                                                                                                                                                                          |

:::note
The item caps above are throughput throttles, nothing more. The daily token **budget** below is the only real cost ceiling — raising `nightlyMaxItemsPerRun` cannot outspend it, it only stops the queue from growing while the budget sits mostly unused.
:::

## Budget (`skillSynthesis.budget.*`)

| Key                                     | Default   | What it does                                                                                                                                                                                                                          |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skillSynthesis.budget.maxTokensPerDay` | `2000000` | Hard daily token ceiling across every background stage, checked once per drain tick and once per item. `0` means unlimited. This is the only real cost control in the section — the drain's item caps above only throttle throughput. |

## Lanes (`skillSynthesis.<lane>.*`)

The most valuable keys on this page. Every background LLM call — `archaeologist`, `synthesis`, `judge`, `replay` — runs on its own **lane**: a declared-capability record read from `skillSynthesis.<lane>.<field>`. This is what lets you move background learning off your foreground Anthropic quota onto Ollama, Z.AI, Moonshot, or OpenRouter, one lane at a time, without touching your active chat provider. No lane is provider-privileged — they differ only by these eight fields, so pointing `judge` at a local Ollama model behaves identically in kind to pointing it at Anthropic; only capability and latency change.

Same eight fields on every lane. Not exposed in the settings panel — edit `~/.ptah/settings.json` directly, e.g. `skillSynthesis.judge.provider`.

| Field              | What it controls                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`         | Registry provider id to run this lane on. `''` (default) = inherit the active workspace provider — an install that never touches this behaves exactly as it did before lanes existed. |
| `model`            | Concrete model id, a bare tier alias, or `''` = fall back to `judgeModel` resolution.                                                                                                 |
| `defaultTier`      | Tier alias (`haiku` \| `sonnet` \| `opus`) used when `model` is `''` and `provider` **is** set.                                                                                       |
| `structuredOutput` | `sdk` (endpoint honours JSON-Schema constrained output) or `parse` (manual JSON extraction — required for endpoints that can't).                                                      |
| `toolUse`          | `required` or `none`. `none` collapses a multi-pass lane to a single pass instead of letting a model that can't drive tools burn the whole timeout discovering that.                  |
| `timeoutMs`        | Wall-clock budget for one LLM call on this lane.                                                                                                                                      |
| `maxInputChars`    | Prompt input budget in characters, applied per lane.                                                                                                                                  |
| `maxPasses`        | Upper bound on retrieval passes. Only `archaeologist` exceeds 1.                                                                                                                      |

Per-lane defaults:

| Lane            | provider | model | defaultTier | structuredOutput | toolUse    | timeoutMs | maxInputChars | maxPasses |
| --------------- | -------- | ----- | ----------- | ---------------- | ---------- | --------- | ------------- | --------- |
| `archaeologist` | `''`     | `''`  | `haiku`     | `sdk`            | `required` | `120000`  | `12000`       | `4`       |
| `synthesis`     | `''`     | `''`  | `haiku`     | `sdk`            | `none`     | `90000`   | `8000`        | `1`       |
| `judge`         | `''`     | `''`  | `haiku`     | `sdk`            | `none`     | `45000`   | `3000`        | `1`       |
| `replay`        | `''`     | `''`  | `haiku`     | `sdk`            | `none`     | `90000`   | `8000`        | `1`       |

:::caution[Naming trap: `skillSynthesis.replay.*` is not the replay gate]
`skillSynthesis.replay.*` is the **replay lane** above — its eight capability fields, same as any other lane. The replay **gate** lives at `skillSynthesis.replayValidation.*` (next section), a different sub-tree entirely. A user who edits `skillSynthesis.replay.enabled` expecting to toggle the gate is editing a key that has never existed on either side — nothing happens, and nothing tells you why. This exact collision was caught by a guard on the first attempt to ship it; the two sub-trees are validated separately for exactly this reason.
:::

## Gates (`skillSynthesis.replayValidation.*`, `skillSynthesis.triggerEval.*`, `skillSynthesis.judgePanel.*`)

Phase 3's empirical measurements, all weekly-tier. Each carries its own `enabled` rather than sharing one switch, because their costs differ: replay and judge-panel each spend a lane call per candidate, while trigger-eval's retrieval is local-embedding only. Not exposed in the settings panel — edit `~/.ptah/settings.json` directly.

| Key                                               | Default | What it does                                                                                                                                                                                                               |
| ------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skillSynthesis.replayValidation.enabled`         | `true`  | Toggles the replay-validation gate — grades a candidate by replaying it against one held-out cluster member. See the note below: this gate has no producer yet.                                                            |
| `skillSynthesis.replayValidation.minConfidence`   | `0.5`   | Floor (0–1, same scale as the stored `replay_confidence`) a replay must clear to count as corroborating evidence. `NULL` (never measured) is not "below threshold" — only a measured value below `0.5` fails.              |
| `skillSynthesis.triggerEval.enabled`              | `true`  | Toggles the zero-LLM trigger-retrieval eval. Spends embedding compute only, no LLM tokens.                                                                                                                                 |
| `skillSynthesis.judgePanel.enabled`               | `true`  | Toggles the two-panellist judge. The second panellist is shown the candidate's nearest description neighbours and whatever gate results are already measured on its row, and is asked a different question from the first. |
| `skillSynthesis.judgePanel.disagreementThreshold` | `3`     | Point gap (0–10 scale, same scale as `minJudgeScore`) between the two panellists' headline scores that escalates to a third call.                                                                                          |

:::caution[The replay gate has no producer]
`skillSynthesis.replayValidation.enabled` is wired end-to-end — settings, queue stage, handler — but nothing currently enqueues a `replay` row in production. Drafting one requires a candidate built from a held-out cluster member, and the only cluster-drafting path today (the curator's suggestion pass) produces Recommended suggestions, not candidate rows; wiring the two together is a separate change with its own review. Until then, toggling these two keys changes nothing observable. It's documented here as designed and landed, not as a gate currently doing anything.
:::

## Tuning notes

- **Lowering `successesToPromote`** makes Track 1 promote faster, with less evidence per skill. Nothing reviews a Track 1 promotion before it lands — pair a lower value with active review of the resulting skills.
- **Lowering `minJudgeScore`** lets weaker skills through on both tracks. The judge never fails open, so an unavailable model blocks nothing regardless of this value — it just means fewer `scored` verdicts to compare against it.
- **`maxActiveSkills`** is a soft governance cap; demotion is to `dormant`, never deletion.
- **Moving a lane off Anthropic** is the highest-leverage change on this page: set `skillSynthesis.<lane>.provider` to a third-party id (`ollama`, `z-ai`, `moonshot`, `openrouter`) to take that stage off your foreground quota entirely. Start with `archaeologist` — it's the most expensive lane (largest `maxInputChars`, up to 4 passes) and the one net-new to background analysis.
- **The daily budget, not the item caps, is what stops runaway spend.** Tune `skillSynthesis.budget.maxTokensPerDay` first; the drain caps only decide how evenly that budget gets spent across a day.

:::tip
Want candidates to accumulate for review without ever auto-promoting? Set `skillSynthesis.successesToPromote` to a very high number and use the **Promote now** action selectively.
:::

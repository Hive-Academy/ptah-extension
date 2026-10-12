---
name: ptah-surface-authoring
description: Use when an agent wants to show a turn summary, stats, a file-change table, test results, a chart, a subagent usage dashboard, or CLI plan limits in Ptah chat or in the Ptah display panel. It explains how to author compact ptah-ui blocks that let the host render verified data.
---

Use a `ptah-ui` block for a compact recap, a comparison, a small set of statistics, changed files, test results, subagent usage, CLI plan limits, or a chart. Use ordinary prose for normal explanation, and use ordinary code fences for code the user needs to copy.

Two targets exist. A plain ` ```ptah-ui ` fence renders inline in the message. A ` ```ptah-ui display ` or ` ```ptah-ui display <id> ` fence sends the same block to the side display panel. Reusing an id replaces that panel surface in place, so a dashboard can be refreshed instead of repeated.

Prefer host-backed sources over repeating information the host already owns. Write the source reference and let the host render the real values; never type file lists, test counts, costs, agent names or limits that a source provides. This keeps the reply compact and saves context tokens.

| Source    | Gives you                                                                              |
| --------- | -------------------------------------------------------------------------------------- |
| `$diff`   | Changed files of this turn: file, addition and deletion counts, per-file rows          |
| `$tests`  | Test runs of this turn: totals and one row per command                                 |
| `$usage`  | Tokens, cost and duration of this turn                                                 |
| `$agents` | Subagents and CLI lanes: counts, tokens, cost, per-agent rows with duration and context |
| `$limits` | Plan limits of the CLI lanes: per lane and window, used, state and reset               |

`$agents session` (and `$agents.session.<field>`) widens `$agents` from this turn to every turn of the session up to and including the block's own turn, never a later one. No other source takes `session`.

Blocks render only in the Ptah Electron app. An invalid block, or a `display` block that is invalid, stays an ordinary code block with a short reason line, and the display panel is left unchanged. Keep the grammar exact.

Read [the ptah-ui reference](references/ptah-ui.md) before authoring a block: it carries the grammar, the display and id rules, the `$agents` and `$limits` details, worked examples and common mistakes. For the interactive surface contract read [the surface catalog reference](references/catalog.md): it documents every `dashboard-catalog/3` component kind with one validated JSON example per kind, and lists the `dashboard-catalog/4` kinds that ptah-ui blocks produce.

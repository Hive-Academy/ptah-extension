---
name: ptah-surface-authoring
description: Use when an agent wants to show a turn summary, stats, a file-change table, test results, or a chart in Ptah chat. It explains how to author compact ptah-ui blocks that let the host render verified turn data.
---

Use a `ptah-ui` block for a compact recap, a comparison, a small set of statistics, changed files, test results, or a chart. Use ordinary prose for normal explanation, and use ordinary code fences for code the user needs to copy.

Prefer host-backed sources over repeating information the host already owns. The host fills `$diff`, `$tests`, and `$usage`; never type file lists, test counts, or costs that those sources provide. Write the source reference and let the host render the real turn values. This keeps the reply compact and saves context tokens.

Blocks render only in the Ptah Electron app. An invalid block remains a code block with a short reason line, so keep the grammar exact.

Read [the ptah-ui reference](references/ptah-ui.md) before authoring a block.

# Batch B10 report: `ptah-surface-authoring`

## Files

- Created `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`.
- Created `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/ptah-ui.md`.
- Regenerated `content-manifest.json` using `npm run manifest:generate`; it now includes the new skill files.

`SKILL.md` description:

> Use when an agent wants to show a turn summary, stats, a file-change table, test results, or a chart in Ptah chat. It explains how to author compact ptah-ui blocks that let the host render verified turn data.

The skill directs agents to use blocks for compact summaries, recaps, stats, and comparisons; to use prose or ordinary code fences when appropriate; and to reference host-filled `$diff`, `$tests`, and `$usage` rather than duplicating host-owned data. The reference contains the normative EBNF, lexical rules, the three active sources (without `$context`), caps, release element kinds, six corpus examples, and parser-derived common mistakes.

## Fenced-example parse results

Validated with a throwaway `npx tsx -e` script importing `parsePtahUi` from `./libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts` and extracting every `ptah-ui` fence from the reference.

| Corpus example | Parse result |
| --- | --- |
| `turn-summary-sources-crlf` | `ok` |
| `literal-table-escapes-unicode` | `ok` |
| `changed-files-columns` | `ok` |
| `test-run-list` | `ok` |
| `coverage-trend-chart` | `ok` |
| `release-checklist-mixed` | `ok` |

## Manifest check

`npm run manifest:check` passed:

```text
content-manifest.json is up to date (sha256:c847c91c263e9081ece85808147048bc1ce18fa34034e97a4e636ebb45e18bed, 228 files).
```

## Suggested hint revision

Proposed only; do not edit `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts` in this batch.

> Use ```ptah-ui blocks for compact turn summaries, stats, comparisons, changed files, test results, or charts in Ptah Electron. For host-held data, reference $diff, $tests, or $usage; the host supplies real files, counts, and costs—never type them yourself. Load the ptah-surface-authoring skill for grammar and examples.

`gpt-tokenizer` count: **74 tokens**.

# Batch C3 report: hint and skill host sources

## Hint

Old hint (99 `gpt-tokenizer` tokens):

````text
Use ```ptah-ui:
```ptah-ui
title Summary
stats
  Files | $diff.files
  Passed | $tests.passed
  Cost | $usage.cost
table
  Name | Value
  Status | ready
list
  - Complete
chart bar Changes
  Added | 3
````
Kinds: title, stats, table, list, chart. $diff, $tests, $usage. Grammar: ptah-surface-authoring skill.
```

New hint (77 `gpt-tokenizer` tokens):

````text
Use ```ptah-ui blocks for compact turn summaries, stats, comparisons, changed files, test results, or charts in Ptah Electron. For host-held data, reference $diff, $tests, or $usage; the host supplies real files, counts, and costs—never type them yourself. Load the ptah-surface-authoring skill for grammar and examples.
````

The example was dropped. The B10 wording plus the minimal two-source `stats` example measured 107 tokens, over the 100-token cap.

## Source table

No reference change was needed: B10 already states that the host fills `$diff`, `$tests`, and `$usage` and agents must not type host-owned file lists, test counts, or costs. Its source names and resolver fields/columns match `PTAH_UI_SOURCES`:

- `$diff`: scalars `files`, `additions`, `deletions`; columns `path`, `status`, `additions`, `deletions`.
- `$tests`: scalars `total`, `passed`, `failed`, `unknown`; columns `command`, `outcome`.
- `$usage`: scalars `input`, `output`, `cost`, `duration`; no columns.

No mismatch found.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.spec.ts --runInBand`: passed — 3 suites, 19 tests, 0 snapshots.
- `npm run manifest:generate`: ran successfully; generated manifest reports 228 files and hash `c847c91c263e9081ece85808147048bc1ce18fa34034e97a4e636ebb45e18bed`.
- `npm run manifest:check`: passed; `content-manifest.json` is up to date at 228 files.
- Scoped TypeScript diagnostics after the edits: 0 errors, 0 warnings.

## Batch B9 report

### Hint

Measured with `gpt-tokenizer` `encode(...).length`: **99 tokens** (limit: 100).

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
```
Kinds: title, stats, table, list, chart. $diff, $tests, $usage. Grammar: ptah-surface-authoring skill.
````

The example parses through `parsePtahUi`; it uses only PR-B elements and contains neither `note` nor a host-data sentence.

### Electron gate

[`sdk-query-options-builder.ts:1710`](../../../../libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1710) uses:

```ts
ptahUiHint:
  this.hostKind === 'electron' &&
  (sessionConfig?.mcpToolProfile ?? 'coding') === 'coding' &&
  sessionConfig?.ptahUiFence === true,
```

`assembleSystemPrompt` appends the hint exactly once immediately after `PTAH_CORE_SYSTEM_PROMPT` at `sdk-query-options-builder.ts:312-314`.

### L-7 truth table

| Host | Profile | Fence | Result |
| --- | --- | --- | --- |
| electron | coding (including default) | true | present once, directly after core prompt |
| electron | coding | false or absent | absent |
| electron | apps | true | absent |
| undefined | coding | spoofed true | absent |
| vscode | coding | spoofed true | absent |
| tui | coding | spoofed true | absent |
| cli | coding | spoofed true | absent |

All rows pass in `sdk-query-options-builder.ptah-ui-hint.spec.ts`; the direct assembly test also confirms omission when `ptahUiHint` is absent.

### Files changed

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts` (created)
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts` (created)
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ptah-ui-hint.spec.ts` (created)
- `libs/backend/vscode-core/src/index.ts`

### Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ptah-ui-hint.spec.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.spec.ts --runInBand` — 3 suites, 18 tests passed.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.lib.json --noEmit` — passed.
- `npx tsc -p libs/backend/vscode-core/tsconfig.lib.json --noEmit` — passed.

### Deviations

None.

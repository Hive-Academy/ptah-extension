# PR fix 4: settingSources single-definition guard (CI test shard 4)

## Problem

`libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts` (describe
"settingSources predicate — single-definition guard", lines 181-202) expects the builder
source to contain `settingSources: includesUserSettingSource(`. The named-account change
had nested the predicate under a `named ? ... :` ternary, so the literal was gone.

## Change

File: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (only file changed)

Lines 1427-1434 (the existing comment block at 1420-1426 is unchanged):

```ts
settingSources: includesUserSettingSource(
  effectiveAuthEnv.ANTHROPIC_BASE_URL,
)
  ? ['user', 'project', 'local']
  : ['project', 'local'],
// A named run replaces the ambient sources with its certified launch
// sources. This spread must stay after the ambient key so it wins.
...(named ? { settingSources: [...named.launch.settingSources] } : {}),
```

- The behavior at runtime does not change. Named runs still get `[...named.launch.settingSources]`,
  because the spread comes after the ambient key. Ambient runs still get the predicate result.
- I checked the rest of the options object. No later property or spread sets `settingSources`.
  The other matches in the file (lines 918 and 945) belong to other functions.
- The second guard test still holds: the change adds no localhost regex.

## Checks

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json` | no output, exit 0 |
| `npx eslint libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` | 0 errors, 1 warning: `max-lines` (1378 > 700). The warning existed before this fix; the file grew by 3 lines |
| `npx jest -c libs/backend/output-styles/jest.config.ts .../output-style-activation.resolver.spec.ts --maxWorkers=2` | 1 suite passed, 19/19 tests passed |
| `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers --maxWorkers=2` | 121 suites passed, 1 skipped; 2624 tests passed, 1 skipped, 0 failed |

The helpers run includes every builder spec that pins `settingSources`, including the
named-account specs (`sdk-query-options-builder.spec.ts`, `.capabilities.spec.ts`,
`.cli-notice.spec.ts`, `.auto-compact-argv.spec.ts`, `session-query-executor.accounts.spec.ts`).

## Decisions

- Decision: keep the ambient key as the literal guarded expression and override it with a
  conditional spread placed after it.
  - Options: (a) conditional spread override; (b) change the guard spec. Option (b) was
    forbidden by the brief.
  - Evidence: guard spec lines 190-192; the object has no later `settingSources` writer.
  - Reversible: yes.

No git commands were run.

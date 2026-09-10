## Backend implementation — `TASK_2026_391`, batch 5 review remediation

**Tasks completed**: Replaced the rejected per-model context field with one dedicated resume-level `contextSnapshot`, aligned its token formula with live streaming, and isolated it from aggregate-cost ranking and agent usage.

**Files**:

- MODIFIED `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` — returns the globally latest valid post-boundary main-session assistant context snapshot.
- MODIFIED `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` — proves latest-model selection, agent isolation, post-compaction selection, and output-token exclusion.
- MODIFIED `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-chat.types.ts` — declares optional `stats.contextSnapshot: { model; contextTokens }` and removes the rejected `modelUsageList.lastTurnContextTokens` field.

### Root cause and corrected contract

Before Batch 5, `chat:resume` returned aggregate token/cost data only. The first implementation attached `lastTurnContextTokens` to every `modelUsageList` entry. Review correctly rejected that shape because `modelUsageList` is cost-ranked aggregate data: selecting its first entry can select an older or agent-heavy model rather than the globally latest root-session context.

The remediated contract is a separate optional `stats.contextSnapshot` at `rpc-chat.types.ts:268-271`. `SessionHistoryReaderService` declares the same result shape at lines 150-153 and 671-674 and emits it at line 882. The old per-model field is absent from all three owned files.

`aggregateUsageStats()` starts from the existing post-last-`compact_boundary` main-message slice. While walking those main messages in transcript order, each valid assistant usage frame replaces the prior snapshot (`session-history-reader.service.ts:786-793`). Its model uses the same resolved model key as per-model accounting. The formula matches live `StreamTransformer` semantics exactly:

```text
contextTokens = input + cacheRead + cacheCreation
```

Output tokens are intentionally excluded. Agent-session loops continue contributing to aggregate tokens, cost, and `modelUsageList`, but never read or write `contextSnapshot`. If no valid post-boundary main assistant frame with a model exists, the optional snapshot is omitted so the frontend can render an honest unknown state.

All cumulative aggregate behavior remains on its original paths: top-level token totals, per-model input/output totals, costs, primary-model selection, message count, and agent-session count are unchanged.

### Red then green evidence

Tests were changed before production code. The initial runtime-red focused run was:

```text
npx nx test @ptah-extension/agent-sdk --runInBand --testPathPattern=session-history-reader.service.spec.ts
Test Suites: 1 failed, 1 skipped, 85 passed, 86 of 87 total
Tests:       2 failed, 2 skipped, 1439 passed, 1443 total
```

Both new assertions failed because `contextSnapshot` was absent. The received payload also demonstrated why the rejected design was unsafe: `modelUsageList[0]` was `gpt-4o` due to dominant aggregate cost while the globally latest main turn used `gpt-4o-mini`; the old fields included output in context (`11,400` instead of the required `11,000`, and `11,016` instead of `10,816`). No pre-existing test was weakened.

The final independent regression cases are:

- `uses the globally latest main-session model for the context snapshot regardless of aggregate cost` (`session-history-reader.service.spec.ts:332`)
- `never lets agent usage select or overwrite the main-session context snapshot` (`session-history-reader.service.spec.ts:402`)
- `uses the live input plus cache formula for the latest post-compaction context snapshot` (`session-history-reader.service.spec.ts:473`)

The final focused run was green:

```text
NX   Successfully ran target test for project @ptah-extension/agent-sdk
Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1442 passed, 1444 total
Snapshots:   0 total
```

### Verification

```text
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared
NX   Running target typecheck for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/shared
NX   Successfully ran target typecheck for 2 projects
```

```text
npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/shared --parallel=2
NX   Running target lint for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/shared
NX   Successfully ran target lint for 2 projects
```

Lint produced zero errors and only repository-pre-existing warnings (38 in `agent-sdk`, 2 in `shared`); none point to the changed files.

```text
npx nx test @ptah-extension/shared --runInBand
NX   Successfully ran target test for project @ptah-extension/shared
Test Suites: 55 passed, 55 total
Tests:       1310 passed, 1310 total
Snapshots:   0 total
```

The initial combined `npx nx run-many -t test lint ...` attempt reached the 180-second command timeout without returning target output, so it was not reported as a result; the targets were rerun separately as shown above. `git diff --check` passed.

**Stack observed**: TypeScript 5.9 strict, Nx 22.6, tsyringe backend services, shared compile-time RPC contracts, and existing SDK JSONL usage extraction. Sources: root `package.json`, root `CLAUDE.md`, and `libs/backend/agent-sdk/CLAUDE.md`.

**Plan deviations**: The review remediation intentionally supersedes the first per-model design. No RPC method or namespace changed, so `ALLOWED_METHOD_PREFIXES` remains untouched.

**Out-of-scope observations**: Existing lint warnings, Jest ESM-config warnings, and the combined-run timeout were not caused by these files. No frontend or non-resume session-stats contract was edited.

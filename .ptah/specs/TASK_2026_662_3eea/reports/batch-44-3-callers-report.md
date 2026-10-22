# Task 44.3 follow-up: scorecard caller workspace roots

## Call sites

| Caller | Root source |
| --- | --- |
| `skills-synthesis-rpc.handlers.ts:1820` `getInvocationStats` for `skillSynthesis:invocationStats` | Existing `agentScope()`, converted from `undefined` to `null` when no folder is open. |
| `skills-synthesis-rpc.handlers.ts:1866` `getScorecards` for `skillSynthesis:getScorecards` | One `agentScope() ?? null` value shared with the win-rate read. |
| `skills-synthesis-rpc.handlers.ts:1867` `getWinRates` for `skillSynthesis:getScorecards` | Same active root as the aggregate read. |
| `skills-synthesis-rpc.handlers.ts:1904` `getScorecardDetail` for `skillSynthesis:getScorecardDetail` | Existing `agentScope() ?? null`. |
| `skills-synthesis-rpc.handlers.ts:2383` `getInvocationStats` for clone summaries | Existing `agentScope() ?? null`, also used by clone history. |
| `skill-enhancer.service.ts:948` `getScorecards` for agent enhancement | Existing `resolveAgentScope() ?? null`, used for the same agent clone. |

These are all production calls to `SkillScorecardService` found by `rg -n "getInvocationStats\(|getScorecards\(|getWinRates\(|getScorecardDetail\(" libs apps`. Other matches belong to `SkillCandidateStore` or frontend RPC wrappers, rather than these scorecard methods. Every scorecard call above supplies a root argument.

## Final signatures

```ts
getInvocationStats(kind: SkillRegistryKind, slug: string, workspaceRoot: string | null)
getScorecards(slugs: readonly string[], workspaceRoot: string | null)
getWinRates(slugs: readonly string[], workspaceRoot: string | null)
getScorecardDetail(slug: string, workspaceRoot: string | null, limit?: number)
```

The detail root precedes the optional limit so both are correctly typed. All callers and service spec calls use the new order.

## Specs changed

- `skill-scorecard.service.spec.ts`: adjusted detail calls to the required-root signature; existing workspace-isolation coverage remains.
- `skills-synthesis-rpc.handlers.spec.ts`: updated scorecard double expectations with the root and added a case proving that a nondefault active root reaches both scorecard reads.
- `skill-enhancer.service.spec.ts`: asserted that agent enhancement passes its active root to `getScorecards`.

Checks were not run, as requested.

## Decisions

- Reused each class's existing agent workspace scope helper. With no active folder, `undefined` becomes `null`, retaining the no-grade behavior.
- Kept the scorecard aggregate and win-rate reads on one captured root so a folder change cannot give them different scopes.
- Placed the required detail root before `limit?: number` and updated every detail caller.

## Clarifications Needed

none

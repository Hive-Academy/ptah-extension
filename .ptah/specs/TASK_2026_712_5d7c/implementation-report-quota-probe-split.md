# Session quota probe entry-point split

Restored ambient-only reads and added explicit named-route reads. Updated named callers and account specs, completed existing mocks, and preserved the named read helper unchanged.

## Files changed

- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts`
- `libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-limit-ledger.service.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.accounts.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/owner-lifecycle.integration.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts`

The ledger implementation and plan-limit-owner-discovery.service.ts needed no edits: the former has no named overload calls; the latter consumes only Pick<SessionQuotaProbe, 'sessionRoute'>. The existing ambient service spec needed no edits.

## Method signatures

```typescript
readAccount(sessionId: string): Promise<AccountInfo | null>;
readPlanUsage(sessionId?: string): Promise<ClaudePlanUsage | null>;
readAccountForRoute(
  sessionId: string,
  route: ClaudeAccountNamedRoute,
): Promise<AccountQuotaResult<AccountInfo>>;
readPlanUsageForRoute(
  sessionId: string | undefined,
  route: ClaudeAccountNamedRoute,
): Promise<AccountQuotaResult<ClaudePlanUsage>>;
```

Both new implementations delegate to the existing readNamed helper with the same callbacks. Binding matching, auth epochs, unavailable codes, sharing, timeouts and stale-result rejection remain unchanged. ProviderOwnerResolver and the named usage reader use the new methods; ambient paths retain their original names and nullable return types. The usage reader re-proves account identity before and after usage as before.

## Diagnostics result

ptah_get_diagnostics was called with all nine changed TypeScript files, including plan-limit-ledger.service.spec.ts and provider-owner.resolver.spec.ts, plus the unchanged plan-limit-owner-discovery.service.ts.

The first call reported the TypeScript check still running after 45 seconds. One subsequent cache/completion check returned:
- Source: typescript-compiler.
- Errors: 0; warnings: 0 (error severity requested).
- Coverage: clean.
- 0 issues in requested files; 0 sibling issues omitted.

No nx, jest, tsc, lint, build, serve, e2e or package commands were run. No explicit any, as unknown as, or ts-ignore was added. Existing casts outside the change remain.

Historical verification limitation: the requested git show of 35196a63a^ was not run because this lane's higher-priority backend role prohibits all Git commands. Ambient signatures were restored from the current ambient implementations and their existing callers/specs; historical signature comparison remains unverified. No Git commands were run.

## Decisions

- Use the requested ForRoute names and delegate directly to readNamed. Options: separate entry points or retain overloads. Evidence: the explicit task and the existing helper already isolate named behavior. Reversible: yes, local interface/call-site refactor.
- Keep named methods optional only on ClaudePlanUsageProbe, while requiring both on SessionQuotaProbe. Options: require them on every ambient-only adapter or preserve the reader's partial adapter contract. Evidence: the existing reader deliberately supports ambient-only adapters; its named branch now checks both capabilities and fails closed. Reversible: yes.
- Give the plan-usage account harness independent ambient and named mocks. Options: share an overloaded mock or split mocks. Evidence: the spec exercises both named result envelopes and raw ambient usage. Existing satisfies SessionQuotaProbe checks remain, and the lifecycle mock now also uses satisfies. Reversible: yes.


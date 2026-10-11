# Lane A revision 2 — backend identity and Codex

## Defect A and 14

- `ProviderOwnerResolver` now produces typed live `OwnerResolutionDetails` beside each strict `QuotaOwnerRef`, including `unknownReason`, native Claude route evidence, and whether `accountInfo()` positively returned an object without email. See `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:117,405,474,549`.
- Discovery reads that metadata for known snapshots and read entries. Label regex and label equality checks are gone. See `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:533,549`.
- **Remaining scope boundary:** read entries carry `unknownReason`, but `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:159-162` converts read entries to snapshots using only `entry.target`; therefore read snapshots still omit it. That file is explicitly excluded from this lane's edit scope. The caller must copy `entry.unknownReason` onto the returned snapshot, including its unread fallback. This defect is incomplete until that handoff changes.

## Defect 4

- Discovery suppresses an unknown Anthropic read entry only when typed metadata identifies a native Claude route, the sole verified account in the result, and either a positively confirmed missing email or an unresolved native route. Null/error account reads remain visible; two verified accounts remain separate. See `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:239-260`.
- Regression cases cover unresolved route suppression, transient null read retention, and two verified accounts in `plan-limit-owner-discovery.service.spec.ts:144-181`. Resolver metadata cases are in `provider-owner.resolver.spec.ts:600-633`.

## Defect 5

- On a changed Codex account key, clear the prior cached quota and update the owner key together before rate-limit read. A failed read cannot return account A quota under B. See `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:257-263` and `.spec.ts:496`.

## Defect 9

- The optional activity catch rethrows on abort; the outer read also propagates abort rather than returning stale data. See `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:191,275` and `.spec.ts:508`. The existing silent-server abort expectation was updated to reject.

## Verification

- Auth providers Jest command, both changed specs, `--coverage=false --maxWorkers=1`: `Test Suites: 2 passed, 2 total`; `Tests: 88 passed, 88 total`.
- CLI runtime limits Jest command, `--coverage=false --maxWorkers=1`: `Test Suites: 5 passed, 5 total`; `Tests: 108 passed, 108 total`.
- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`: successful, exit 0. Nx Cloud printed a free-plan warning after the local target passed.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`: successful; Nx printed the local target success line and a Cloud warning.

## Decisions

- `QuotaOwnerRef` remains strict and unchanged. Live metadata uses a resolver-owned WeakMap keyed by the returned owner object. Null `readAccount()` is treated as unconfirmed because the probe returns null for timeout, rejection, unknown session, and absent query.
- No source outside the allowed scope was edited. The read-snapshot handoff needs a scoped follow-up in `rpc-handlers`.
- The `ptah_agent_report` tool was not exposed in this agent session, so a report call could not be made; this file records the outcome for the spawning session.

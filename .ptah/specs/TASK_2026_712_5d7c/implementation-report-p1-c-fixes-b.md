# P1-C fixes ? lane B (agent-sdk)

Implemented findings 4 (agent-sdk), 6 and 7 in the six assigned source/spec files. SessionQuotaProbe's public interface is unchanged. No git operations or out-of-scope source edits were performed.

## Finding 4 ? named-context logging

- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:562`: oversized-file warnings use the basename for named contexts.
- Same file, `:1007` and `:1039`: scan and unreadable-agent logs use basenames for named contexts, closing the adjacent scan-log path exposure as well.
- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:351`, `:389`, `:449`: named stats failures log structural string filesystem codes, otherwise error names/fixed text, never raw messages. Ambient branches retain their original payloads.
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:194` and `:225`: regressions for oversized/unreadable named files and a plain-object EACCES failure containing a private directory in its message.

## Finding 6 ? LRU epochs protected for active work

- `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts:155`, `:316`, `:326`, `:349`, `:421`: reference-count active readers by identity; delete then set epoch entries using the maximum observed epoch; skip active identities during LRU trimming; release references and trim in finally. Stale callers refresh recency without lowering the epoch.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:290`, `:371`, `:453`, `:464`, `:478`: equivalent protection spans installation discovery, shared probes, cancellation, cached returns and failures.
- `libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.accounts.spec.ts:205`, `:237`, `:258`: pressure from 140 identities preserves current quota/model work, rejects older epochs after advancement, and refreshes quota LRU order. Model coverage includes both pending installation discovery and an active model probe; all cases fit in the assigned spec.

## Finding 7 ? isolate invalid project entries

- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:277`: catch bound/stat failures per entry, count skipped entries, retain valid canonical directories, and emit fixed text with only the count. Recheck root readability before returning so an unusable root remains unavailable.
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:159`: one escaping link and one dangling link do not hide a valid session directory; missing roots remain unavailable; skipped-entry logs omit paths.

## Verification

`ptah_get_diagnostics` was called with only the six assigned absolute file paths after final source/spec formatting. Result: source `typescript-compiler`, coverage `clean`, **0 errors, 0 warnings**, 0 sibling diagnostics.

No Nx, Jest, tsc, lint, build, serve, e2e or package command was run, as instructed. Specs were added but remain unexecuted pending CI; diagnostics are not runtime test evidence. Formatting used the repository's installed Prettier library and config only on assigned files.

## Decisions

1. Protect identities with per-service reference counts rather than inspecting only the model probe map or the quota WeakMap. Evidence: model installation discovery awaits before probe registration; quota reads are keyed by query in a non-enumerable WeakMap. Counts cover the complete read lifetime and deduplicated callers. This internal choice is reversible and preserves public contracts.
2. Treat 128 as the retention cap for idle entries, permitting temporary overflow if every retained identity is active. A strict cap would require evicting live identity state and violate finding 6. Completion trims idle entries again. Reversible internal retention policy.
3. Sanitize adjacent named scan/subagent stats log branches within the assigned files as well as the cited lines, because they carry the same private paths/messages. Ambient payloads stay unchanged. Reversible local logging change.
4. Keep the existing DI/logger, map, and fixture conventions rather than introduce a shared cache abstraction or new module. Evidence: the scoped service constructors and existing account-context/account-quota specs. All dependencies and stats request scope were checked against repository source. `ptah_code_search_symbols` returned zero hits for `SessionStatsScopeSelection`; a single native symbol search located its definition in session-usage-aggregator.ts.

## Not done

Runtime/CI execution and Electron integration verification were intentionally not performed. Output-styles findings belong to the other lane and were not touched. No remaining implementation item within this lane's assigned findings is known.

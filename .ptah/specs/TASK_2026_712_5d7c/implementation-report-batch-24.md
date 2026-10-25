## Backend implementation — `TASK_2026_712_5d7c`, batch 24

**Tasks completed**: Task 24.1, Historical Claude ledger identity and preparatory CLI display maps.

**Actual execution family**: in-process backend-developer subagent, Anthropic (Claude Opus 5.5). It was not a CLI lane.

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`, uncommitted)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/usage-analytics/src/lib/sources/claude-ledger.source.ts`. The ledger reads ambient plus observed named roots, once per physical route. Event keys are `[physical route, session/event]`. It adds a bounded route registry with `observeRoute`/`forgetRoute`, a `readRoots` entry point, and per-root unavailable/partial status. It also fixes the session id for named keys.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/usage-analytics/src/lib/sources/claude-ledger.accounts.spec.ts`. Seven cases run against a fake reader with the same key shape as the real one. They use no fs, no `process.cwd()` and no namespace spies.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts`. `CLI_LABELS` is typed `Record<CliType | 'claude', string>`, with the forward key `claude: 'Claude'`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`. It adds the forward keys `claudeModel` and `claudeReasoningEffort`, and makes `CliMatrixSources.orchestration` a Pick of the loaded keys intersected with `Partial<Record<forward keys, string>>`. The forward part becomes `never` by itself once Batch 25 adds the fields. `SYSTEM_CLIS` is typed over `SystemCliType | 'claude'`, with a Claude spec: name Claude, provider Anthropic, its own model and effort keys.

**Stack observed**

- tsyringe `@injectable`/`@inject`. `ClaudeLedgerSource` is registered by class in `libs/backend/usage-analytics/src/lib/di/registration.ts:8`. No new token or constructor parameter was added, so the registration is unchanged.
- The route carrier is `ClaudeAccountResolvedResourceContext`, with `filesystemIdentity` holding volume and file id, from `libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:57-83`. The import is type-only. The tags allow it (feature → core).
- Reader key shape comes from `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:238-244` and `claudeResourceKey` in `jsonl-reader.service.ts:43-53`. That function is not exported from the barrel, so its prefix format is mirrored in `readerKeyPrefix`.
- Frontend: plain TS maps with no Angular API change. The tuple is `SYSTEM_CLI_TYPES` in `libs/shared/src/lib/types/agent-process.types.ts:75-87`.

**Acceptance evidence**

- A physical route is counted once even when it is discovered twice. The ledger dedups by `filesystemIdentity`, so an alias with a new fingerprint or epoch reuses the route (spec "counts a physical route once").
- Two directories with the same owner stay two transcripts. Keys are scoped by route and never by owner, and quota aggregation by owner stays in the owner resolver from Batch 23 (spec "keeps two directories of one owner").
- Event-time history is preserved. Keys do not depend on the auth epoch or owner, so a re-login does not re-key events, and an unknown owner read does not merge or drop them (spec "keeps event keys stable across a re-login").
- Ambient is kept. Ambient is always scanned and is never stored or evicted (spec "retains ambient history").
- An unavailable named root makes the result partial. The other roots are still counted and nothing falls back to ambient (spec).
- The route registry is bounded at 32 entries, the same as the directory LRU, and `forgetRoute` removes a route (spec).
- The source map keeps every old member exhaustive and has the real Claude label. The matrix builds rows only from `detectedClis` filtered by `isSystemCli`, so the Claude definition cannot produce a row or claim an installation before Batch 26.
- Model, effort and account stay distinct: `claudeModel` and `claudeReasoningEffort` are separate keys, and `provider` names the sign-in family, not the model. All other rows are unchanged.

**Verification**

- `ptah_get_diagnostics` (errors) on the 4 changed files plus `cli-model-effort-popover.component.ts` (which consumes the widened key unions): **no diagnostics in the requested files**.
- The 253 sibling errors were all in other spec files of `chat`. Examples: `chat-view.component.spec.ts:1653`, `agent-card-truncation.spec.ts:137`, `chat-transcript.ptah-ui.spec.ts:7`. None of them involve a member this batch changed, and they appear to come from the diagnostics tool's spec typing, not from this change.
- nx, jest, tsc and lint were not run, as instructed. The orchestrator should run `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/usage-analytics','@ptah-extension/chat') -Hosts $H`.

**Existing specs that touch changed members**

- `libs/backend/usage-analytics/src/lib/usage-summary.service.spec.ts` stubs `UsageSource` for `claude-ledger` with its own keys. The real source is not used, so it should be unaffected. The format of ambient event keys changed, from `session:msg` to the JSON `["ambient", "session:msg"]`. The key is only a dedup key in `usage-summary.service.ts:59`.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.spec.ts` builds `Orchestration = NonNullable<CliMatrixSources['orchestration']>` fixtures. The forward keys are optional, so the existing literals stay valid. It has no snapshots.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:2125-2170` covers `toStatsLimitLaneRun` and the `CLI_LABELS` fallback. Existing labels are unchanged.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts:549-586`, the consumer of the widened unions, is not a spec. `orchestrationPatch` still assigns to `ProvidersSettingsPatch`. No caller can pass a `claude*` key until a Claude row exists.
- The real-reader ledger specs in `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.spec.ts:477-486` are unchanged.

**Plan deviations**

- No route-enumeration port exists. A grep for a contexts list, `listRoutes` or `observedRoutes` under `libs/backend` found nothing, and adding a token would need registration files outside this batch's ownership. Instead the source owns a bounded registry, `observeRoute`/`forgetRoute`, which `read()` uses, plus `readRoots` for explicit roots. Nothing calls `observeRoute` in production yet, so the named-route history path is ready but not live. A later batch must call it from the admission or run lifecycle with a certified context.
- `UsageContribution` has no owner field (`usage-source.types.ts`, not owned here). The event-time owner is therefore kept structurally: route-scoped keys that are independent of the epoch and owner, with no owner ever attached from current state. There is no explicit owner stamp.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The physical route key is `filesystemIdentity`, not the fingerprint, epoch or owner | (a) `claudeResourceKey` (fingerprint, revision, epoch); (b) the filesystem identity | Plan 206 "once per physical route"; a re-login must not re-key history (plan 209). The certified identity is in the context (port :57-79). | Yes |
| Bounded registry inside the source instead of a new port | (a) new token/port; (b) a registry inside the source | The batch owns no registration file; the existing class registration is enough. | Yes. It can be replaced by a port later. |
| Forward keys through `Exclude`/`Extract` on `keyof ProvidersOrchestration` | (a) wait for Batch 25; (b) cast; (c) self-healing conditional types | The "System tuple activation is late" row allows explicitly typed forward keys. This needs no cast, and the forward part becomes `never` once Batch 25 adds the fields. | Yes |

**Out-of-scope observations**

- A named route whose canonical directory is physically the ambient `~/.claude` would be counted twice, because ambient has no filesystem identity on the context. Admission should refuse that directory, or ambient should carry an identity.
- `cli-permission-notes.ts` `cliPermissionNote(cli: CliType)` and the other exhaustive maps (`task-agent-discovery.service.ts`, `agent-marks.ts`) must cover `claude` when Batch 26 activates the tuple.
- `ProvidersOrchestrationField` in `libs/frontend/core/src/lib/services/providers-settings.types.ts:63-75` needs `claudeModel` and `claudeReasoningEffort` in Batch 25.
- `readerKeyPrefix` mirrors the format of the unexported `claudeResourceKey`. If agent-sdk changes that format, the strip quietly falls back to the full key, which is still unique per route, and session ids would then be wrong. Exporting `claudeResourceKey` from the agent-sdk barrel would remove the duplication.

**Risk outcomes**: no credential, env or path logging; no git mutation; no live sign-in or inference; named live launch is untouched and stays fail-closed (D7).

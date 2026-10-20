# B3a HostAttentionCoordinator

## Summary

Implemented the agent SDK host attention ingress, native notice gating, generation tracking and resolution. The coordinator validates permission, lane permission and question ingress with Zod; issues only fixed labels and the authoritative session title; and catches/logs host errors using only their names. Added focused specs and singleton registration. No adapter or app wiring was changed.

## Files

- `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts` — new coordinator.
- `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.spec.ts` — focused behavior and privacy specs.
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` — added `HOST_ATTENTION_COORDINATOR`.
- `libs/backend/agent-sdk/src/lib/di/register.ts` — singleton registration.
- `.ptah/specs/TASK_2026_593_7c2e/batch-B3a-report.md` — this report.

## Public API

- `HostAttentionCoordinator implements IHostAttentionIngress`.
- `observe(type: string, payload: unknown): void` — accepts `PERMISSION_REQUEST`, `AGENT_MONITOR_PERMISSION_REQUEST`, `ASK_USER_QUESTION_REQUEST`.
- `resolve(key: string, generation: number): void` — resolves only the current generation.
- `presentFailure(conditionId: string, generation: number, scope: 'session' | 'lane' | 'task', target: AttentionTarget): void` — issues a separately gated failure notice under a hashed `c:` key.
- `SDK_TOKENS.HOST_ATTENTION_COORDINATOR = Symbol.for('HostAttentionCoordinator')`.

## Title source

`SessionMetadataStore.get(sessionId)` supplies `SessionMetadata.name` and the workspace path (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:82,87,786`). Lane requests locate the parent metadata through `getAll()` and `cliSessions[].agentId` (`host-attention-coordinator.ts:139`). Missing/blank titles use `Ptah session`; titles are truncated to 80 Unicode code points (`host-attention-coordinator.ts:210`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `IWorkspaceProvider.getConfiguration('ptah', key, default)` at issue time for the two gates. | Workspace configuration or a new settings dependency. | `IWorkspaceProvider` is the existing SDK configuration seam; `platform-core` persists these file-based keys. | Yes |
| Use the request timestamp as generation, with duplicate and older timestamps ignored. | Timestamp or a private counter. | Producer request types already carry `timestamp`; a stable generation survives duplicate transport observation. | Yes |
| Read `SessionMetadataStore` asynchronously, falling back to the active workspace root when metadata is absent. | Drop untitled notices or use active workspace root. | Metadata is the authoritative title source and its `get()` is async; ingress remains synchronous. | Yes |
| Hash failure condition IDs for `c:` keys. | Copy raw IDs or hash them. | Decision #29 reserves `c:` and raw IDs may contain private paths. | Yes |

## Not done

- No Nx, Jest, TypeScript, lint, build, diagnostics or other verification command was run, as the B3a instruction reserves verification for the orchestrator.
- Host adapters, transport attachment, resolution hook call sites and app DI guards belong to subsequent batches.

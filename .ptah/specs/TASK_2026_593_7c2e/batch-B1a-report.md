# B1a host attention ports

## Summary

Added platform-core ports for safe native request and failure notices, transport ingress observation, and Ptah view visibility. Added a shared adapter contract covering generation, eligibility, resolution, stale actions, disposal, and safe notice text for both variants. No implementation was registered.

## Files

- `libs/backend/platform-core/src/interfaces/host-attention-notifications.interface.ts` — created the safe notice and native host port.
- `libs/backend/platform-core/src/interfaces/host-attention-ingress.interface.ts` — created the ingress and disposable observer slot ports.
- `libs/backend/platform-core/src/interfaces/ptah-view-visibility.interface.ts` — created the visible/focused state and change subscription port.
- `libs/backend/platform-core/src/testing/contracts/run-host-attention-contract.ts` — created the reusable adapter contract with CLI `noOp` mode.
- `libs/backend/platform-core/src/di/tokens.ts` — added two unregistered `Symbol.for` tokens.
- `libs/backend/platform-core/src/index.ts` — exported the ports, notice type, and contract runner.
- `.ptah/specs/TASK_2026_593_7c2e/batch-B1a-report.md` — created this report.

## Contract

- `SafeHostAttentionNotice`: discriminated union. Both variants carry `key`, `generation`, fixed `actionLabel: 'Open Ptah'`, required `sessionTitle`, and `target: AttentionTarget`. Request notices use `kind: AttentionRequestKind`, `severity: 'info' | 'warning'`, and fixed request labels. Failure notices use `kind: 'failure'`, `severity: 'error'`, and fixed labels `Session failed | Lane failed | Task failed`.
- `IHostAttentionNotifications`: `present(safeNotice): void`, `resolve(key, generation): void`, `isEligible(): boolean`, `open(target: AttentionOpenTargetPayload): void`, `dispose(): void`.
- `IHostAttentionIngress`: `observe(type: string, payload: unknown): void`.
- `IHostAttentionObserverHost`: `setAttentionObserver(observer: IHostAttentionIngress): IDisposable`.
- `IPtahViewVisibility`: `anyPtahViewVisible(): boolean`, `isPtahViewFocused(): boolean`, `onDidChange(listener: (visibility: PtahViewVisibility) => void): IDisposable`.
- `runHostAttentionContract(name: string, setup: HostAttentionContractSetup): void`; setup supplies a provider factory, actual issued/pending/opened observations, eligibility control, optional teardown, and optional `noOp`.
- The contract also presents a failure notice twice per generation, propagates its session title, and checks old-generation resolve and stale-open behavior.
- `PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS` and `PLATFORM_TOKENS.PTAH_VIEW_VISIBILITY` are declared but not registered.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse shared `AttentionRequestKind`, `AttentionTarget`, and `AttentionOpenTargetPayload`; key construction in the contract uses `attentionRequestKey`. | Reuse shared types or create platform copies. | Shared public alias exports them; decision #29 requires one identity function and path-free target. | Yes |
| `open` accepts the shared keyed and generation-tagged open payload. | Accept only `AttentionTarget` or include request identity. | Stale-action no-op requires key and generation; shared open payload already has both. | Yes |
| Export the runner through the named main index. | Modify the testing barrel or use the permitted index. | Existing runners use `src/testing/contracts/index.ts`, but B1a's explicit file list permits only the main index for exports. | Yes |
| Keep eligibility synchronous and expose a disposable observer registration. | Poll visibility or subscribe; use a mutable callback without a release handle or a disposable registration. | Plan section 3 requires a settable, disposable observer before renderer fan-out; section 4 requires visibility changes. | Yes |
| Add a discriminated failure notice with only fixed labels; use a local `c:` key in its contract fixture. | Widen request kinds or give failures their own variant. | Task description lines 72 and 99 include failed turn, lane, and back-office host notices; decision #29 reserves `c:` for local conditions; the shared identity helper accepts only request kinds. | Yes |

## Not done

- No tests, Nx, Jest, TypeScript compiler, lint, build, or `ptah_get_diagnostics` run, per the batch's read/edit-only verification instruction. TypeScript AST parsing of the new files and main index reported no syntax errors; this is not type verification.
- Adapter implementations and token registrations belong to later batches.

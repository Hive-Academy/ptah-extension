# Phase 2 revision, Part B

The previous lane implemented items 1–10 in the eight allowed files. I reviewed its diff and retained those fixes. I added the tabless finalization regression at `wizard-generation-rpc.handlers.spec.ts:683`; no inherited source fix needed correction.

1. **S2 — inherited.** `wizard-generation-binding.ts:22,51-89` maps an orphan older than 30 seconds to failed with `interrupted: true` and unknown commit state; recent checkpoints remain starting. Spec: “reports an orphaned in-progress checkpoint as unconfirmed, without a terminal result” (`wizard-generation-rpc.handlers.spec.ts:473`).
2. **M3 — inherited.** `wizard-generation-rpc.handlers.ts:387` preserves the explicit `RpcUserError`. Spec: “reports an unavailable bound model through the RPC error” (:445).
3. **M4 — inherited.** `wizard-generation-checkpoint.service.ts:294-310` checks workspace root, tab path and verified source path inside the authorized workspace. Spec: “rejects a foreign %s path” (`wizard-generation-checkpoint.service.spec.ts:106`; three cases).
4. **M5 — inherited source, expanded spec here.** `wizard-generation-rpc.handlers.ts:880-903` propagates writes even if finalization throws and reports failure. Specs: “does not report completed when checkpoint finalization fails” (:667) and “propagates written agents after tabless checkpoint finalization fails” (:683).
5. **M6 — inherited.** `wizard-generation-binding.ts:24-40` compares realpaths; `wizard-generation-rpc.handlers.ts:307-308,969-986,1181,1299` stores canonical bindings for submit, preview, cancel and retry; `wizard-generation-checkpoint.service.ts:261-264` matches older spellings. Specs: “uses the authorized path for bound lookup and cancellation” (:598) and “locates an older checkpoint whose stored workspace spelling differs” (:621).
6. **M8 — inherited.** `wizard-generation-rpc.handlers.ts:293-308,360` authorizes the bound envelope before parsing and omits client analysis data. Spec: “authorizes before parsing bound analysis data and ignores it for valid tabs” (:367).
7. **Cross-tab resume — inherited.** `wizard-generation-rpc.handlers.ts:453-476,798-815` blocks another tab and permits an unbound older checkpoint to acquire an authorized binding. Specs: “blocks another tab from adopting a paused bound checkpoint” (:576) and “binds an old checkpoint only on an authorized resume and retains its outcomes and model” (:541).
8. **Resume route — inherited.** `wizard-generation-checkpoint.service.ts:367-369` stores the validated current model in both snapshot and input; `wizard-generation-binding.ts:71-72,265-270`, `wizard-generation-rpc.handlers.ts:842-843` and `wizard-generation-run.supervisor.ts:328-329` use unknown for missing snapshots. Specs: old checkpoint resume (:541) and orphan lookup (:473).
9. **Preview rejection — inherited.** `rpc-setup.types.ts:60` adds `preview-required`; `wizard-generation-rpc.handlers.ts:482-496,519-545` retains a confirmed preview until acceptance. Spec: “requires preview and keeps confirmation after a launch preparation failure” (:405); contract spec `rpc-setup-generation.contract.spec.ts:70-74`.
10. **Retry race — inherited.** `wizard-generation-rpc.handlers.ts:715-754` sends one bound terminal failed broadcast when launch rejects after acceptance. Spec: “pushes one terminal failure when launch loses the active-run race” (:702).

## Checks

- Focused RPC Jest: 5 suites, 123 tests passed before my additional spec. Focused handler Jest after that spec: 1 suite, 89 tests passed.
- Focused shared contract Jest: 1 suite, 2 tests passed.
- Nx typecheck and lint: successfully ran both targets for both changed projects with `--parallel=1`.
- Prettier verified all eight changed files; all were already formatted.
- Scoped Ptah diagnostics timed out after 45 seconds and returned unchecked. The required Nx typecheck passed.

## Final line counts

- `wizard-generation-binding.ts`: 308
- `wizard-generation-checkpoint.service.ts`: 427
- `wizard-generation-rpc.handlers.ts`: 1736
- `wizard-generation-run.supervisor.ts`: 336
- `rpc-setup.types.ts`: 561

## Notes for B07

Use `interrupted` and unknown commit state to offer Resume after an orphaned run. On `preview-required`, reopen the preview. Hide provider/model when their value is `unknown`. Render only a derived source label; do not render or log `source.analysisDir`.

## Decisions

- **30 second orphan grace.** Options: immediate failure or a grace period. The brief explicitly requires 30 seconds; lookup remains read-only. Reversible.
- **Canonical binding.** Options: preserve client spelling or use the authorized realpath. The host authorization contract returns the canonical path; old checkpoint paths are matched through realpath. Reversible.
- **Missing provider/model.** Options: guessed defaults or `unknown`. The review and brief require `unknown` to avoid a false claim. Reversible.
- **Tabless finalize regression.** Options: rely on the bound spec or test the tabless path directly. The defect specifically affected tabless propagation, so I added the direct regression. Reversible.

## Proposed Removals

None.

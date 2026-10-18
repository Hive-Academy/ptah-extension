# Phase 3 code logic review — Batches 11–16

**Score: 6/10. Verdict: REVISE.** Review family: codex (implementer: Claude).

The ordinary write, capability filter, RPC validation, and DI resolution paths are present. The score is below the sound 7–8 band because a late secret-store failure can leave persisted state different from the failure response, and concurrent catalog callers can inherit another caller's expired budget. It is above the 3–4 band because the primary paths have concrete validation, rollback, and capability checks. Scope: Phase 3 source and changed specs, relevant Phase 2 runtime readers, task context and plan, and the six named commits. No build, tests, lint, or history-changing git commands were run. Scoped `ptah_get_diagnostics` returned unavailable after its 45-second check, so it supplies no passing evidence.

## Batch 11 — decision-model writer

The RPC handler validates both key fields and the selection before calling the writer (`agent-rpc.handlers.ts:641-693`), and serializes `agent:setConfig` calls through `setConfigQueue` (`:604-618`). The writer checks D4 and the stored custom key before a write (`decision-model-writer.ts:145-176`). The persisted selection goes through `DecisionModelConfig.setSelection` to `ptah/agentOrchestration.decisionModel` (`decision-model.config.ts:184-229`); the Jev and custom slots go through `DecisionModelKeys.set` to secret storage (`decision-model.keys.ts:22-29,84-108`). Runtime selection reads use `getSelection` (`decision-model.config.ts:184-201`), and the custom key reader compares the stored origin to the requested origin (`decision-model.keys.ts:67-77`). The rollback tests cover selection-write failure after a successful key write, but their key-write failure stub rejects before simulating persistence (`agent-rpc.handlers.decision-model.spec.ts:805-825`). See defect 1.

## Batch 12 — catalog and boundary schemas

Local listing reads `/api/tags`, requests `/api/show` per valid tag, and lists only models with the `decision` capability (`decision-model.catalog.ts:200-235,441-462`). Cloud listing reads public tags without an Authorization header and applies the same capability test (`:171-195,355-364`). The boundary schemas validate the tag envelope, each entry, and show responses (`ollama-catalog.schema.ts:15-39`). The catalog has per-call abort and per-model caching, but the shared lookup uses the initiating call's signal (`decision-model.catalog.ts:249-268`); see defect 2. The response and tag count have no size ceiling (`:373,404-405`); see defect 3.

## Batch 13 — catalog DI

The catalog is registered as an instance-cached factory over the decision-model config and logger (`di/register.ts:101-113`), with its token and exports added in this batch (`di/tokens.ts:15`; `index.ts:18-29`). The registration spec resolves it without a network call (`di/register.spec.ts:77-95`). No separate Batch 13 logic defect found.

## Batch 14 — RPC and registry

The RPC method strictly parses `{source: 'ollama' | 'ollama-cloud'}` and maps unexpected catalog rejection to `unavailable` (`decision-model-catalog-rpc.handlers.ts:34-37,62-89`). The manifest declares the handler for every host (`host-profile/manifest.ts:131-139`), shared registration binds it (`register-shared-rpc-handlers.ts:83-89`), and the method is in the RPC registry (`rpc.types.ts:1412-1414,3919`). No separate Batch 14 logic defect found. The RPC inherits the catalog failure modes in defects 2–3.

## Batch 15 — VS Code and Electron DI guards

Both smoke specs resolve the catalog token and handler (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:372-385`; `apps/ptah-electron/src/di/container.smoke.spec.ts:403-416`). These checks establish construction, not the behavior of a live catalog request. No separate Batch 15 logic defect found.

## Batch 16 — CLI DI guard

The CLI smoke spec makes the same token and handler resolution assertions (`apps/ptah-cli/src/di/container.smoke.spec.ts:468-481`). No separate Batch 16 logic defect found.

## Defects

1. **MAJOR — A secret-store write that persists and then rejects escapes rollback and receives an ordinary failure response.** `libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts:134-138,207-223`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.keys.ts:84-108`. In both the key-only and key-plus-selection paths, `keys.set` is outside a catch. If `secrets.store` or `secrets.delete` changes the slot and rejects afterward, `agent:setConfig` returns the generic failure from `agent-rpc.handlers.ts:859-872`, while the key has changed and the selection has not. A replacement custom key can therefore silently replace the working key for the saved endpoint; a deletion can remove it. Snapshot before any key mutation, attempt restoration on a rejected key write, and use the existing slot-specific “may have changed” response when restoration cannot be proved. Test a store/delete fake that mutates its backing map before rejecting; the current stub rejects without mutation (`agent-rpc.handlers.decision-model.spec.ts:805-825`).

2. **MAJOR — A concurrent catalog caller can lose its own budget to the first caller's abort.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:140-146,217-225,249-268,271-307`. `showInFlight` shares a promise created with the first caller's signal. If call A starts at t=0 and call B starts shortly before A's 4000 ms deadline, B reuses A's lookup. A's abort resolves the shared request as `undetermined`, and B returns `partial` despite having nearly its full budget left and a healthy host that could still answer. Keep per-caller deadlines outside a shared lookup and give the underlying request an independent lifetime, or start a fresh lookup for B after A's aborted result. Add a staggered concurrent-call test; the current concurrency test starts both calls together and never exercises different deadlines (`decision-model.catalog.spec.ts:363-378`).

3. **MINOR — A large or malformed host listing can consume unbounded work after the 4000 ms budget.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:209-235,355-373,389-405`; `libs/backend/lane-routing/src/lib/decision-model/ollama-catalog.schema.ts:18-22`. The code reads the whole response body and synchronously parses it, then maps every tag into a lookup promise. A daemon that returns a very large JSON body or model array can block the event loop and allocate thousands of queued lookups; the abort timer cannot interrupt synchronous parsing or mapping. Bound response bytes and model count before parsing/fan-out, and report overflow as `unavailable` or `partial` with a fixed warning. Add a large-list boundary case; the existing concurrency test uses 13 names (`decision-model.catalog.spec.ts:473-486`).

## Five logic questions

1. **Silent failure:** A secret write can persist and reject; the response says only that the settings could not be saved, while the key slot changed (`decision-model-writer.ts:134-138,207-209`; `agent-rpc.handlers.ts:859-872`).
2. **Unexpected user action:** Opening the picker twice at staggered times can make the later request inherit the first request's expired lookup and show an incomplete list (`decision-model.catalog.ts:140-146,249-268`).
3. **Wrong answer from input data:** A `decision` model can be omitted from a later concurrent result solely because the earlier caller's signal aborted (`decision-model.catalog.ts:217-235,259-268`).
4. **Dependency failure, timeout, or bad shape:** A late secret-store rejection produces defect 1; a timed-out shared show lookup produces defect 2. An oversized `/api/tags` body is unbounded before schema validation (`decision-model.catalog.ts:389-405`).
5. **Requirement gap:** The plan specifies request concurrency and a 4000 ms budget but no response-size or tag-count limit (`implementation-plan.md:367-381`); defect 3 is the missing boundary needed to make that budget meaningful for large host responses.

## Decisions

- Treat a secret-store rejection after mutation as an uncertain write, not proof of no write. Options: leave the generic failure or restore a prior snapshot; restoration follows the existing selection-write rollback policy (`decision-model-writer.ts:207-235`) and is reversible.
- Keep the catalog's public result contract (`applied`/`partial`/`unavailable`) and per-call budget. Options: share a caller-owned abort signal or make the shared lookup independent; independence follows the per-call budget requirement (`implementation-plan.md:378-379`) and is reversible.

# Task 14.2a projection model

## A. D28 dedup

- `libs/frontend/command-center/src/lib/model/work-projection.ts:73`: `childBySession` is a `Set<string>` built with `flatMap`. Persisted children are filtered by `canonical(sessionId)` at line 88. Candidate children are keyed by canonical ID at line 98; a live state wins over `unknown` at lines 101–106.
- Spec: `deduplicates a persisted temporary ID by the live SDK session ID` in `libs/frontend/command-center/src/lib/model/work-projection.spec.ts:95` checks one `child:child-sdk` node in `running` state when persisted `temporary` aliases it.

## B. D33 child labels and provider IDs

- `libs/frontend/command-center/src/lib/model/work-projection.ts:11`: `OwnedChild.name` and `OwnedChild.providerId` are optional. `ProjectionInput.rootProviderId` is optional at line 39. Root provider assignment is at line 62; child name fallback and provider assignment are at lines 128–129.
- Spec: `projects child names and provider IDs for the scene label` in `libs/frontend/command-center/src/lib/model/work-projection.spec.ts:113` verifies `layoutScene` emits `Codex · Builder`, and verifies the unnamed child keeps `Child session` and null provider.

## C. Status ages producer

- `libs/frontend/command-center/src/lib/model/work-projection.ts:18,27,34,44`: optional epoch millisecond `updatedAt` is accepted on `OwnedChild`, `OwnedAgent`, `OwnedRun`, and persisted child records. Projection carries it on child, run, and agent nodes at lines 131, 147, and 226. `CommandWorkNode.updatedAt` is declared in `libs/frontend/command-center/src/lib/model/command-center.store.ts:31`.
- `computeAgesMs(nodes, now)` is exported at `libs/frontend/command-center/src/lib/model/work-projection.ts:239`. It emits an age only for a timestamped node. `buildStatusContext` already accepts the resulting map; no change to `status-context.ts` was needed.
- Spec: `computes ages only for timestamped projected nodes and includes one in status` in `libs/frontend/command-center/src/lib/model/work-projection.spec.ts:152` checks one age entry from two nodes and `4s` in status output.

## Changed existing expectations

None. Existing expectations remain valid.

## Page input contract

- `ProjectionInput.rootProviderId?: string`
- `OwnedChild.name?: string`, `OwnedChild.providerId?: string`, `OwnedChild.updatedAt?: number`
- `OwnedAgent.updatedAt?: number`
- `OwnedRun.updatedAt?: number`
- `ProjectionInput.persistedChildren[]` record `updatedAt?: number`
- The page should call `computeAgesMs(projection.nodes, Date.now())` and pass the map to `buildStatusContext`.

## Verification

- Scoped `ptah_get_diagnostics`: 0 diagnostics in changed files. Seven errors were reported in untouched sibling files: five Jest mock typing errors in `tribunal-run-coordinator.spec.ts` and two BigInt target errors in `capability-id-codec.ts`.
- `npx eslint` on the three changed TypeScript files: exit 0, no output.
- `npx prettier --write` on the three changed TypeScript files: exit 0.
- `npx prettier --check` on the three changed TypeScript files: exit 0, `All matched files use Prettier code style!`
- Jest/Nx were not run in this lane, as instructed; the orchestrator runs tests.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Canonicalize child candidate IDs before ownership and node emission, with live priority | Dedup only final nodes; dedup candidates | The persisted temporary ID can alias a live SDK ID; candidate dedup prevents duplicate nodes and preserves the live state. | Yes |
| Carry timestamps on owned input records, not on the external `VendorLane` type | Extend the external lane type; add a separate lane timestamp map; use owned inputs | Scope excludes the tribunal lane type, and this model has no standalone owned lane input. | Yes |
| Keep `buildStatusContext` unchanged | Add implicit clock lookup; pass a pure age map | It already accepts `ReadonlyMap<string, number>`; `computeAgesMs` supplies it explicitly. | Yes |

## Not done

- Lane timestamps: `VendorLane` is external to the permitted model files and has no `updatedAt` field. The page can supply timestamps for the owned child, agent, run, and persisted child inputs above.
- Page wiring and Jest/Nx execution are delegated to later lanes or the orchestrator.

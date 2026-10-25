# Batch 12 implementation report

Implemented the reduced import scope authorized by decisions.md D16. Only the four assigned implementation/spec files and this report were written. No metadata-store edits or git commands.

## Files changed

- helpers/history/jsonl-reader.service.ts: optional ClaudeAccountResolvedResourceContext on directory discovery, full transcript reads, tail reads, line projection, and agent-session loading. Named roots resolve exclusively from canonicalConfigDir/projects. Added safe closed resource errors, canonical path containment, directory alias deduplication, route-aware directory/transcript caches, and disposal.
- session-importer.service.ts: optional fourth scanAndImport parameter. Named imports reject with ClaudeAccountResourceError(code='unsupported') before any scan join, filesystem access, or metadata access/write. Private directory lookup accepts a context for the future bound read path; named persistence never reaches it. Added shutdown cancellation and disposal of the scan registry, with cancellation checks before metadata writes.
- session-stats/session-stats-reader.service.ts: optional context on readStats and scanDatedUsage, forwarded into directory lookup and transcript projection. Ledger cache keys and dated event keys include route identity. Shutdown aborts projections and clears ledgers, including late completion cleanup.
- helpers/history/jsonl-reader.account-context.spec.ts: nine focused regression cases using temporary directories and admitted route fixtures. Covers root isolation, unavailable roots, no ambient fallback, unchanged ambient lookup, directory symlink dedup and escape rejection, named import refusal without metadata calls, scoped stats/event identity, directory cache cap, and disposal.

## Acceptance evidence

- Two roots for the same workspace remain separate: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:331`; key includes workspace, route fingerprint/revision/auth epoch, and canonical projects root. Spec: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:80`.
- Symlink/root dedup: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:75` and `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:266`. Root aliases resolve to the same physical path; directory enumeration returns a Set of canonical directories. Escaping directory/file links refuse. Spec: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:121`.
- Existing caps retained: directory LRU remains 32; transcript entry/byte/size limits and streaming yields remain; stats ledger bounds and request file/record bounds remain. Directory cap spec: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:256`.
- No named-to-ambient fallback and explicit missing-root failure: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:56`, `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:31`. Fixed safe messages with closed codes unavailable/unsupported; Promise rejection preserves existing successful return signatures. Missing named roots never return an empty successful list. Spec: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:93`.
- Account-bound history/rewind primitives: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:534`, `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:682`, `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:764`, `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:947`. Explicit context validates and canonicalizes supplied paths within the selected projects root.
- Account-bound stats: `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:138`, `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:267`; context is forwarded for parent and subagent projections. Test: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:208`.
- Distinct routes are never keyed by quota owner: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:43` and `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:438`. Dated event keys include route identity. Tests exercise the same SDK session/message IDs with different usage in two roots.
- Named import refuses without writes: `libs/backend/agent-sdk/src/lib/session-importer.service.ts:240` and `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:159`. This rejection happens even when the requested named directory is absent: unsupported persistence is established before disk access.
- Ambient algorithms retained: omitted or ambient contexts use the original homedir-based discovery and matching algorithms. Import's original scan/index/JSONL logic is retained. Spec: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts:105` and the ambient zero-result assertion in the import-refusal test.
- Disposal: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:251`, `libs/backend/agent-sdk/src/lib/session-importer.service.ts:189`, `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:117`. Directory/parsed caches and byte counts clear; disposed JSONL readers do not refill caches; importer aborts scans and clears its registry; stats aborts and clears with late-projection cleanup. No timers or persistent filesystem listeners were added.

## Diagnostics result

All three scoped ptah_get_diagnostics passes reported typescript-compiler, clean coverage, zero errors and zero warnings for all four files. The final pass includes test-mock hardening and repository formatting; zero requested-file and zero sibling-file diagnostics were reported.

No Nx, Jest, tsc CLI, lint, build, serve, package, or e2e command was run. Specs are written for CI and have not been executed locally. The four files were formatted with the repository Prettier configuration.

## Decisions

1. Follow orchestrator D16: named import persistence is refused and deferred to Batch 16. Alternative was modifying the metadata store; D16 prohibits that. Reversible when validated immutable linkage is available.
2. Use a typed rejection with a closed code and safe fixed message for explicit resource failures. Alternative was widening all successful return unions. Evidence: existing Promise-returning APIs and requirement to keep signatures backward compatible. Optional context is always an additional parameter. Reversible at a future explicit API boundary.
3. Use ClaudeAccountResolvedResourceContext from auth-providers-tokens, and fingerprint/revision/auth epoch for route identity; do not use quota-owner identity. Evidence: existing certified route contracts and batch requirement that routes sharing an owner remain distinct. Physical paths are canonicalized to deduplicate aliases within a route. Reversible.
4. Use existing disposal methods as caller-owned lifecycle hooks; no registrations or consumers outside the four-file ownership boundary were changed. AbortSignal.any supplies cancellation without installing persistent application-owned listeners. Reversible.

## Anything not done

- Named imported binding persistence and same-SDK-ID metadata collision handling belong to Batch 16 under D16.
- No existing caller/composition-root files were changed: they must supply the resolved context and invoke dispose through their lifecycle. This batch implements the bounded read APIs; it does not claim end-to-end host wiring or live account certification.
- Tests were not run, per explicit instruction; CI must execute the new spec and existing reader/import/stats regression suites.

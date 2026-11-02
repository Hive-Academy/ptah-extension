# Batch 10d.fix-r2 Part H report

## Changes

- H1: `libs/backend/codex-runtime/src/lib/codex-executable-inspection.ts:24,67-73` already passes `{ cause }` through `super(message, options)`. The missing-file and directory specs now match cause properties without realm-sensitive `Error` identity (`codex-executable-inspection.spec.ts:168,177`).
- H2: `codex-executable-inspection.ts:29-37,84-139` shares a digest promise per file identity, while a default inspection and each `readVersion` callback identity have distinct cached inspection promises. Default output stays at the pinned version line. Specs cover both call orders and two callback identities (`codex-executable-inspection.spec.ts:60,72,84`).
- H3: `codex-executable-inspection.ts:40,98-104` limits the map to eight realpaths and evicts the oldest insertion. The spec checks that the first callback runs again after nine paths (`codex-executable-inspection.spec.ts:199`).
- H4: Both rejection cleanup handlers have `degradation-audit: reported` comments and leave the returned inspection rejection visible to callers (`codex-executable-inspection.ts:106-109,135-142`).
- H5: The existing pin lookup, realpath/stat validation, streamed hash, digest comparison, binary verification and file-identity invalidation remain in `codex-executable-inspection.ts:44-143`. Failed digest entries and failed callback results are evicted for retry; the callback retry spec is at `codex-executable-inspection.spec.ts:97`.

## Decisions

- Separate the digest promise from version results. Options were one combined promise or a digest promise plus mode-specific promises. The combined promise caused default and callback callers to receive each other's output; separate promises preserve both contracts. Reversible.
- Use an eight-entry insertion-order realpath map and a `WeakMap` for callback identities. Options were insertion-order eviction or recency tracking; the task explicitly permits oldest-by-insertion eviction, and weak callback keys avoid retaining callback functions. Reversible.
- Keep the error constructor unchanged. It already forwards `ErrorOptions`; matching the cause's `code` or `message` addresses the cross-realm spec failure. Reversible.

## Verification

- No verify, tests, typecheck, lint, build, Nx, npm or `ptah_get_diagnostics` were run, as required by the task hard rules. Source and spec structure were inspected only.

## Not done

- Execution checks are assigned to the coordinator by the task hard rules.

# Batch 8a-2a report

Implemented the reviewed executable pin lookup and UUID v4/v7 session validation. Five source/spec files changed; this report is the sixth file written. No git operations, dependency installation, builds, test runners, lint commands or direct typecheck commands were run.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-executable-pin.ts`: loads the checked-in reviewed manifest through a literal JSON require, validates/selects its six portable fields with Zod, freezes the resulting row, and returns it only for the exact reviewed platform/architecture. No diagnostic binary path is exposed.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-executable-pin.spec.ts`: compares the win32/x64 pin against the manifest, checks the exact portable keys and frozen state, and checks unsupported platform/architecture combinations.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts`: publicly exports `findCodexExecutablePin` for host consumers.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\branded.types.ts`: changes the UUID version nibble to `[47]`, preserving anchors, case insensitivity and RFC variant `[89ab]`; documents Claude/Ptah v4 and Codex v7 provenance with the schema path. Creation remains v4.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\branded.types.spec.ts`: adds supported/unsupported UUID cases across the regex and SessionId constructors and explicitly checks creation still produces version 4.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8a-2a-report.md`: this deliverable.

## Spec cases

- Pin: win32/x64 has the manifest values and exactly `arch`, `binarySha256`, `pinnedVersion`, `platform`, `schemaSha256`, `version`; returned row is frozen. Unknown platform, unknown architecture, and darwin/arm64 return undefined.
- UUID: fixed v4, fixed v7, and uppercase v7 pass UUID_REGEX, SessionId.validate, SessionId.from and SessionId.safeParse.
- Versions 1, 3, 5, 8 and 9, variant c, nil UUID, maximum UUID, and prefixed/suffixed v7 strings fail the regex and validate, throw TypeError from from, and return null from safeParse.
- SessionId.create retains its v4 generation and now has an explicit version-nibble assertion.

## V7 rejection assertion audit

Searched spec files under both `libs` and `apps` for UUIDv7 descriptions, version-7 UUID literals, and version-rejection assertions. No assertion requiring rejection of a valid v7 by UUID_REGEX, SessionId, TabId or RPC schemas was found. No additional spec was modified.

Related existing comments, not v7 rejection assertions, remain outside the named edit set:

- `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts:67`: describes UUID_REGEX as v4-only.
- `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts:466`: describes sessionId/tabId as accepting v4 only.
- `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts:59`: UUID_BAD_VERSION is version 9, so its rejection remains correct (fixture consumed at line 99).

The all-7 message-transform fixtures have a non-RFC variant and are not valid v7 UUIDs; platform storage and ACP fixtures use v7 without asserting rejection by the affected APIs. Chat-state ids, AgentId and TUI specs were not edited.

## Verification

Required scoped `ptah_get_diagnostics` for all five changed source/spec files returned source `typescript-compiler`, clean coverage, zero errors and zero warnings. This was the tool's diagnostic backend; no compiler command was launched directly. No Jest/Nx/verify/lint command was run. Deciding tests, lint and host compatibility verification remain with the team leader under the machine-wide FIFO lock.

## Decisions

1. **Load the singleton reviewed JSON through a literal require and Zod projection.** Options: reuse an existing production loader, read JSON from a runtime filesystem path, or statically bundle the reviewed JSON. Evidence: `codex-protocol-manifest.ts:18` only implements `verifyCodexBinary`; it has no JSON loader to reuse. `codex-protocol-manifest.spec.ts:1-23` uses Zod to parse the manifest in tests. The JSON contains a single top-level win32/x64 record. The runtime tsconfig does not enable resolveJsonModule. A literal require preserves bundle inclusion without adding compiler configuration or a deployment-relative filesystem lookup. This introduces no duplicate production parser. Reversible: yes, when a shared loader or multi-row format exists.
2. **Expose a frozen portable projection.** Options: return the raw manifest, a readonly-only reference, or a frozen projection. Evidence: `codex-runtime-ports.ts:9-16` explicitly excludes diagnostic developer paths and defines six readonly scalar fields. Zod's object projection strips unrelated fields; freezing enforces immutability at runtime. Reversible: yes, within the public immutable-row contract.
3. **Widen validation only, retain v4 minting.** Options: v4-only validation, v4/v7 validation, or unrestricted UUID versions. Evidence: batch 8a-2a and `codex-app-server-protocol.schema.json:20434` explicitly require Codex UUIDv7 thread ids; the batch preserves current minting and rejects other versions. Reversible: the regex edit is local, but reverting would reject Codex sessions.
4. **Report stale equivalence comments without expanding edits.** Options: edit unrelated comments or report them. Evidence: no v7 rejection assertion was found; the assignment limits edits to the named files except an actual shared rejection fix. Reversible: yes; the coordinator can update the comments separately.

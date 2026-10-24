# Batch 2e — Execution profile builder

Implemented the pure profile builder and its colocated specs. Production routing remains disabled. No contracts, entry points, registrations, task states, or other lanes' files were changed. No git commands were run.

## Files

- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-execution-profile.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts`
- This report: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/batch-2e-report.md`

The builder imports the committed `CodexExecutionProfile` and `CodexJsonValue` contracts. Its return subtype adds `approvalsReviewer: 'user'` and `fullAccessStatus: 'unproved-disabled'`, without modifying Batch 2a. Existing module patterns used: Zod strict schemas in `codex-protocol-validator.ts`, Jest in its colocated spec, and the separate Ptah approval policy in `codex-permission-policy.ts`. Repository guidance: root `CLAUDE.md` and `CONTRIBUTING.md`; file discovery found no covering nested instruction files.

## Level-to-policy mapping

All source references below are relative to `libs/backend/codex-runtime/src/lib/`.

| Level | Approval policy | Sandbox | Network | Experimental API | Evidence in implementation |
| --- | --- | --- | --- | --- | --- |
| ask | Granular: sandbox_approval, rules, skill_approval, request_permissions, mcp_elicitations all true | read-only; no writable roots | false | true | `codex-execution-profile.ts:229`, `:241`, `:246` |
| plan | on-request | read-only; no writable roots | false | false | `codex-execution-profile.ts:229`, `:241` |
| auto-edit | on-request | workspace-write; normalized cwd writable | false | false | `codex-execution-profile.ts:241` |
| yolo | on-request; ordinary approvals belong to the separate 2f Ptah policy | workspace-write; normalized cwd writable | false | false | `codex-execution-profile.ts:241` |
| Explicit lane full access | Request represented by lane.explicitFullAccess; rejected while unproved | No full-access profile emitted | No network grant | N/A | `codex-execution-profile.ts:192`, `:248` |

Reviewer is always user (`codex-execution-profile.ts:247`). Tests compare all four supported levels directly with the harness's exported `policy()` function, rather than duplicating its expected object. Runs 6e–6j and C2/C7 are the evidence boundary; no new real-binary claims are made. The harness's OUTPUT_BOUNDS are evidence-run controls, not additional profile-contract fields; they are not silently applied to sessions.

## Inputs, immutability and fingerprint

`buildCodexExecutionProfile` (`codex-execution-profile.ts:146`) accepts session, resolved settings, defaults, captured/default home, a path snapshot, and optional resume profile. Defined session fields override resolved settings, which override defaults; absent fields do not inject array defaults into higher-precedence layers (`:172`). Explicit empty arrays and prompt strings remain overrides.

The caller supplies a platform, absolute base directory, and entries keyed by lexically resolved paths. Existing entries carry caller-captured realpaths; missing entries are explicitly marked. Unknown paths and unresolved aliases fail closed; cwd must be an existing directory. The builder uses only pure path operations, never filesystem/environment reads (`:153`). Case is preserved. Home fallback is selected settings, captured CODEX_HOME, then the supplied default resolver result. Resume fixes context, consumer, account/provider/workspace identity, cwd and home (`:199`); changed model/effort returns a new profile.

Strict Zod validation clones supported inputs. Recursive freezing covers every output object and array without freezing or mutating caller data. Instructions remain separate from stdio/HTTP/SSE MCP entries. MCP references, OAuth authReference, arguments, prompts and attachments survive mapping. Duplicate MCP names, invalid budgets and non-lane lane settings are rejected. Credential-bearing or query/fragment-bearing remote URLs are rejected; credentials must be represented through opaque auth/header references, not URL values. Diagnostics do not echo caller values.

Fingerprint (`:252`): `sha256:` followed by a SHA-256 hex digest of canonical JSON containing the validated effective profile, excluding the fingerprint itself. Object keys sort recursively; array order remains significant; undefined fields are absent. Context identity is included, so same-home contexts remain distinct. Auth references participate as opaque identifiers; resolved credentials are never accepted or resolved by this builder. This is a configuration identity, not a secret store or credential hash. Callers must uphold the existing contract that reference fields and command arguments do not contain secret values.

## Specs

17 passing cases:

- Four harness parity cases: ask, plan, auto-edit, yolo, including network, writable roots, reviewer and experimental capability.
- Settings precedence, including undefined and empty overrides and retained instruction defaults.
- Complete prompt/instruction/MCP/attachment mapping, deep freeze and unchanged mutable legacy input.
- Home precedence and missing-path resolution.
- Windows relative-path normalization and case preservation.
- Five invalid-workspace cases: missing, file, unobserved, tilde alias, environment alias.
- Lane budgets, chat suppression rejection, and explicit full-access rejection.
- Resume identity invariants and immutable model/effort revision.
- Canonical fingerprint ordering, auth-reference changes and same-home context isolation.
- Invalid required input and credential-bearing URL rejection with sanitized errors.

## Verification

PowerShell equivalents of the requested tail/grep filters were used; native command exit codes were printed explicitly.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20`
   - Initial run: exit 1, 0 tests; a heterogeneous test fixture inferred an optional undefined header-reference property. Fixed by typing the fixture against the input settings contract.
   - Final run: exit 0; **1 suite passed, 17 tests passed, 0 snapshots**, 8.343 seconds. Node emitted a jest.config.ts ES-module loading warning; execution passed.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10`
   - Exit 0. `NX Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime`.
   - `4 problems (0 errors, 4 warnings)`. The prescribed filtered output included a `preserve-caught-error` warning at line 1737 but did not retain file attribution for all four warnings. No unrelated files were changed.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-execution-profile.ts libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts`
   - Exit 0. Both files formatted; the final invocation after Nx completion reported both unchanged.
4. Required `ptah_get_diagnostics`, scoped to the two source/spec files after edits: **0 errors, 0 warnings**, clean coverage, TypeScript compiler source.

No workspace-wide checks, build, e2e, install, or live model calls were performed. Full-access runtime proof and consumer integration remain outside this batch.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use caller-captured path metadata to keep the builder pure | Direct filesystem realpath; injected I/O callback; immutable snapshot | User explicitly requires pure/no I/O; plan :99 requires realpath for existing paths | Yes; composition can supply snapshots through its existing filesystem boundary |
| Reject explicit lane full access until evidence exists | Emit danger-full-access/never now; silently downgrade; reject explicitly | User says unproved/disabled; batches C7 and observed 6h only prove workspace-write | Yes, after a reviewed gate changes the requirement |
| Add reviewer and disabled evidence marker through a return subtype | Modify committed 2a; omit reviewer; return compatible subtype | Batch requires approvalsReviewer user but committed base interface has no reviewer member; 2a modifications forbidden | Yes; later contract owner can adopt these fields |
| Hash validated configuration with SHA-256 and canonical key ordering | Raw serialized fingerprint; noncanonical hash; canonical digest | Plan requires non-secret stable identity; same-home contexts must differ | Yes, via versioned consumer migration if persisted |
| Keep YOLO approval decisions in the existing 2f policy | Set never; embed an approval engine here; preserve on-request | Harness policy(), C7, and codex-permission-policy.ts implement separate local decisions | Yes, only with new evidence |

No unresolved decisions block this implementation. Integration must capture path metadata and carry the returned reviewer field into the wire configuration. No production routing was enabled.

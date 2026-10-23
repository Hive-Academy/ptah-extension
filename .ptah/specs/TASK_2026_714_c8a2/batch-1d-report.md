# Batch 1d report

Implemented the assigned evidence-harness changes in the supplied worktree.

## Changes

- `libs/backend/codex-runtime/tools/evidence-harness.ts:815`: exported pure `initializeParams` preserves client metadata and enables experimentalApi only for non-string approval policies. String policies retain the existing explicit false capability.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1290`: records the required granular initialization note and uses the helper for initialize.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:822`: exported pure `assertThreadApprovalPolicy` uses `approvalPoliciesEqual` and requires the user reviewer; missing, malformed or different values throw the existing allowlisted mismatch error.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1334`: checks granular thread/start results before recording confirmation. Non-granular handling and the existing config check remain intact.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:86`: admits only complete bounded numeric RPC error messages, without adding server text. Full-match equality also rejects the trailing newline that JavaScript's dollar anchor can otherwise permit.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:399`: added bounded RPC-code and withheld-text cases without changing existing assertions.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:1009`: added initialization and thread-response confirmation specs, including reordered object keys, missing/different policies and missing/different reviewers.

## New spec names

- `records a bounded RPC error code as-is: %s`
- `withholds unlisted RPC and server text: %s`
- `enables experimentalApi only for granular initialize params`
- `confirms an echoed granular policy and user reviewer structurally`
- `rejects missing or different thread approval policy and reviewer`

## Decisions

- Preserve explicit experimentalApi=false for string policies rather than omit capabilities. Evidence: the existing initialize payload and the batch requirement to preserve non-granular requests exactly. Reversible local helper change.
- Validate the unknown thread response directly rather than parse it through a schema that could throw a different error. Evidence: the batch requires the existing allowlisted mismatch message for missing fields. Reversible local assertion.
- Compare the entire regex match to the message rather than accept a prefix ending before a final newline. Evidence: the requirement admits numeric RPC codes only and withholds all extra text. Reversible local classification change.

## Verification and remaining work

Scoped ptah_get_diagnostics for all three assigned files returned typescript-compiler, clean coverage, zero errors and zero warnings. No tests, formatter, build, Codex binary or other prohibited command ran. The orchestrator must run scoped tests and formatting verification; no live evidence run was attempted.

Exact command/file identity, approval gates, turn budget, usage ceiling, deadline and cleanup were not changed. No git commands ran. Existing source and task artifacts were retained; pre-existing working-tree changes were not inventoried because this lane cannot run git. Only the three assigned source/spec files and this required report were written. No implementation item remains outstanding.

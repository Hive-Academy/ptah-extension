# Batch 3 implementation report

Implemented optional account binding transport without changing runtime routing.

## Files changed

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

- `libs/shared/src/lib/types/provider-profile.types.ts`: optional `accountBinding: ProviderAccountBinding` and opaque `accountBindingId` registry linkage. Existing finite `ProviderProfileAuthEnv` is unchanged.
- `libs/shared/src/lib/types/provider-profile.schemas.ts`: validates optional bindings using Batch 1's strict `ProviderAccountBindingSchema`; validates linkage using Batch 1's opaque-ID predicate. No fallback converts a malformed binding to absence.
- `libs/shared/src/lib/types/agent-adapter.types.ts`: optional `accountSelection: ProviderAccountSelection` on start, resume and slash configs. Binding snapshots travel through their existing `providerProfile` field. Comments state that selection cannot override a persisted binding.
- `libs/shared/src/lib/types/agent-process.types.ts`: optional readonly binding snapshot and registry linkage on `CliSessionReference`. Version, run ID, stable profile ID and identity evidence remain in the reused binding type. `SYSTEM_CLI_TYPES` is unchanged.
- `libs/shared/src/lib/types/provider-account-binding.spec.ts`: compatibility, malformed binding, serialization, selection, linkage and finite-key regression coverage.
- `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-03.md`: this report.

## Acceptance coverage

1. Old records: `parses old unbound profiles and references unchanged` checks profile parsing and CLI reference JSON roundtrip with absent binding classification.
2. Malformed present bindings: `refuses a malformed present binding rather than legacy absence: %j` covers null, empty object, unsupported version, empty profile ID, missing run ID, invalid identity and canonical directory injection. It checks both profile rejection and persisted-reference binding classification as invalid-bound.
3. Rename-independent ID: `preserves a rename-independent account ID through start resume slash and reference roundtrips` changes only the display label and checks selection and binding/profile serialization across all three adapter configs and the persisted reference, including registry linkage.
4. Optional fields: `keeps every new field optional for existing callers` supplies typed legacy start, resume, slash, profile and reference fixtures. Scoped diagnostics report no errors.

Additional specs: `preserves finite AuthEnv keys and excludes canonical paths from bindings` includes compile-time key checks and verifies the CLI tuple still excludes Claude; `rejects malformed registry linkage and preserves explicit ambient selection` checks linkage validation and the existing ambient discriminant.

## Verification

- Ran `ptah_get_diagnostics` scoped to exactly the five source/spec paths above after editing. Final result: source `typescript-compiler`, coverage `clean`, 0 errors and 0 warnings.
- The initial scoped diagnostic caught a mistaken smart-constructor import in the new spec; corrected it to the source-verified `AgentId.from` before the clean final check.
- Did not run Nx, Jest, tsc, lint, build or git commands. Regression specs are written and type-checked by diagnostics, but execution remains for CI. This report does not claim a test-suite pass.

## Decisions

1. Carry binding/linkage through `ProviderProfile` on adapter calls rather than duplicating them directly on each config. Options: existing profile transport or parallel config fields. Evidence: existing `providerProfile` fields on `AgentSessionStartConfig`, `AgentSessionResumeConfig` and `SlashCommandRunConfig`; Batch 3 explicitly directs following that pattern. This keeps one snapshot location per call. Reversible additive contract decision.
2. Use `accountSelection` for requested routing and `accountBinding`/`accountBindingId` for backend-issued snapshot and registry linkage. Options: reuse Batch 1 vocabulary or introduce new unions. Evidence: implementation plan lines 116-124 and 189-193, `ProviderAccountSelection`, `ProviderAccountBinding`, and the existing opaque-ID validator. Reused all vocabulary; no duplicate binding or selection definitions. Reversible field naming decision before consumers are implemented.
3. Validate optional registry IDs with the shared opaque-ID predicate. Options: unrestricted string or existing bounded opaque token. Evidence: registry linkage is non-secret and opaque, and Batch 1 already excludes paths/flags through `isProviderAccountOpaqueId`. Reversible validation choice, with malformed-linkage coverage.

## Not done / boundaries

- No runtime routing, admission, registry persistence, authoritative lookup or resume gate changes: this batch adds transport contracts only. CLI reference restore consumers still need to call binding validation in their assigned later batches; the reference remains a TypeScript interface rather than a new production parser.
- No backend-only directory carrier, public RPC changes, host feature work or Claude CLI tuple addition.
- No changes outside the five assigned source/spec files and this explicitly requested report. No task states changed.

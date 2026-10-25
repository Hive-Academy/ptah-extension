# Batch 13 implementation report

Implemented selected-account output-style discovery, activation and file operations, plus explicit unsupported imported user-state results. Existing callers can omit the extra context parameter. No git operations were run.

## Files changed

- `libs/backend/output-styles/src/lib/output-style-discovery.service.ts`
- `libs/backend/output-styles/src/lib/output-style-file.writer.ts`
- `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts`
- `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts`
- `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.ts`

## Acceptance evidence

- Selected writes and readback resolve the same `<canonicalConfigDir>/output-styles` directory: `libs/backend/output-styles/src/lib/output-style-discovery.service.ts:98`, `libs/backend/output-styles/src/lib/output-style-discovery.service.ts:179`, `libs/backend/output-styles/src/lib/output-style-file.writer.ts:378`. Save, stat, rename and delete all carry the optional context. The lifecycle regression covers these operations: `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:91`.
- Project styles remain `<workspace>/.claude/output-styles` and retain precedence over user styles: `libs/backend/output-styles/src/lib/output-style-discovery.service.ts:120`; `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:145`. No workspace policy or harness asset ownership is changed.
- Activation passes the context into discovery and rejects an unavailable named selection with the closed `unavailable` error instead of silently applying no style: `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts:157`, `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts:173`.
- Named imported MCP returns `{status: 'unsupported', code: 'unsupported'}` before reading user state: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:103`. Named approval import returns `{status: 'error', code: 'unsupported', approvals: []}` before either import source is read: `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.ts:164`. The context contract has no verified user-state locator; no HOME substitution or invented `.claude.json` location is used.
- Explicit Ptah MCP and project policy remain independent: only the imported user-state readers are changed; their named unsupported result does not mutate or remove explicit server configurations or grants. Runner integration is reserved for Batch 22 and has not been exercised here.
- No ambient file is written for a named context: named user operations use only the selected root; malformed roots return `NOT_FOUND` from the writer without filesystem writes. Discovery rejects malformed roots. Assertions cover all written paths and absent ambient styles: `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:91`, `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:200`.
- No credential, plugin or skill copying was added. Writes are existing style writer operations and temporary test fixtures only. Imported readers have no new write path.
- Omitted/ambient contexts retain the existing home resolution and read behavior, including the original one-argument discovery call shape: `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts:161`, `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:178`, `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:239`, `libs/backend/output-styles/src/lib/output-style-account-context.spec.ts:253`.

## Diagnostics and validation

- Only `ptah_get_diagnostics` was used for verification, scoped to the changed source/spec files. Initial requests exceeded the tool's 45-second compiler timeout. A completed request reported two mock type assertions in the new spec and no production or sibling errors. Both mock assertions were corrected using the existing activation spec's test-double convention. Post-fix scoped diagnostics returned **unavailable**, with all six files unchecked because the TypeScript compiler was still running after 45 seconds. No clean post-fix result is claimed.
- Added seven scoped cases (including two invalid-root parameter cases) in the one assigned spec. Tests were not executed: CI owns test execution per the task instruction. No Nx, Jest, tsc, lint, build, serve, package, e2e, sign-in or inference command was run.
- Module boundary evidence: output-styles is `scope:extension/type:feature`; auth-providers-tokens is `scope:extension/type:core`, allowed by eslint.config.mjs. The existing activation service already imports the token package and tsconfig.base.json already maps it. New production resource-context imports are type-only. No agent-generation or workspace-intelligence value imports were added.

## Decisions

1. **Reject named imported user-state until a locator is certified.** Options were derive a path from config/home or return unsupported. Chosen unsupported, required by implementation-plan.md:208 and the context definition in provider-account-admission.port.ts:70. Reversible when admission supplies a verified locator; no contract extension invented here.
2. **Preserve approval `status: 'error'` and add `code: 'unsupported'`.** Options were add a new status or retain the existing fail-closed status with an explicit reason. Existing approval consumers already handle the error status; preserving it prevents accidental successful publication. MCP uses an overload to retain the old array return type for existing two-argument callers. Additive and reversible.
3. **Reuse the existing style lifecycle and filesystem port.** The plan explicitly assigns these services and shared root resolution. Optional trailing context parameters preserve callers; project resolution is unchanged. Missing named selections reject with a safe closed error, while ambient activation keeps its prior fallback. Reversible; no registrations or new dependencies needed.
4. **Keep reader unit coverage in the single assigned spec.** The spec loads only the reader leaves with typed `jest.requireActual` instead of loading cli-agent-runtime's composition barrel. Evidence: the single-spec ownership constraint and D15's ESM regression warning. Test doubles follow the existing activation spec convention; no production cross-library test helpers added. Reversible.

## Not done / limitations

- No verified user-state locator exists in the supplied context, so full named imported MCP/approval parity remains unsupported by design.
- Runner integration and explicit-MCP end-to-end proof remain Batch 22. Existing callers are not wired to supply context in this batch; wiring outside the six assigned files remains with the owning batches.
- Tests and host validation were not run, as requested. Diagnostic availability/result is reported above without claiming CI success.
- No task state, plan, dependency configuration, registration, or files outside the six assigned code files and this expressly requested report were edited.

# Batch 5 Report — TASK_2026_859_b561

Status: IMPLEMENTATION COMPLETE; CI VERIFICATION PENDING

## Task 5.1 — Delete old registry types and references

Complete.

- Deleted `McpRegistryPackage`, `McpRegistryTransport`, `McpRegistryVersionDetail`, and `McpRegistryArgument`.
- Deleted `McpRegistryEntry.version_detail`.
- Kept the internal `McpRegistryListResponse.next_cursor` field.
- Rewrote both `REGISTRY_ENTRIES_FIXTURE` entries to `version` plus `packages[]` with `registryType`, `identifier`, `version`, and `transport`.
- Updated the brand query JSDoc to reference `remotes[].url`.

Required grep command:

```sh
grep -rnE 'version_detail|registry_name|McpRegistryTransport|McpRegistryVersionDetail|McpRegistryPackage\b' apps libs --include=*.ts
```

Output:

```text
<no output>
```

Result: zero hits in `apps/` and `libs/`.

A follow-up grep for `installConfigResult|McpRegistryArgument\b` also returned zero hits.

## Task 5.3 — Per-registry-type runtimeHint allowlist

Complete.

- Replaced the global runtime hint set with `Record<SupportedRegistryType, ReadonlySet<string>>`.
- Allowed only `npx` for npm, `uvx` for pypi, `docker` for oci, and `dnx` for nuget.
- Cross-type and hostile hints now fall back to `DEFAULT_COMMANDS[registryType]`.
- Kept argument arrays and the existing no-throw, no-logging behavior.
- Added three fixture-derived regression cases:
  - npm with `runtimeHint: "uvx"` uses `npx` with `-y`.
  - pypi with `runtimeHint: "npx"` uses `uvx` without `-y`.
  - npm with matching `runtimeHint: "npx"` still uses `npx`.
- Kept the existing hostile `"sh -c"` regression case.

## Task 5.4 — Remove unused installConfigResult state

Complete.

- Removed the `installConfigResult` signal, its four writes, and the now-unused `McpInstallConfigResult` import.
- The inline template and component spec had no reads of `installConfigResult`.
- Did not change the component spec.
- Did not change target selection or `confirmInstall` target logic.

## Task 5.2 — CI-only verification

No local verification or heavy check ran, as instructed. No `npm run verify`, Nx, Jest, TypeScript, ESLint, build, serve, dev, e2e, or package command ran. The PR CI jobs remain the verification gate. CI results are not available in this lane.

Only read-only grep searches and source reads were used for local evidence.

## Files created or modified

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-directory.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/batch-5-report.md`

## Plan validation

- R3: Old types were deleted only after Batches 2–4 moved consumers. The required old-shape grep returned zero hits.
- R6: Runtime hints are restricted by registry type. Commands remain separate from argument arrays. Cross-type and hostile hints use the default command.
- A2: The mapper remains pure TypeScript. No Zod import or runtime dependency was added.
- A5: `McpRegistryArgument` was deleted. The follow-up grep confirmed no remaining references in `apps/` or `libs/`.

## Decisions

- Used only each registry type's default runner in its allowlist. No extra runner was added because the existing argument layouts were not verified for other runners. This is reversible.
- Removed `installConfigResult` without a replacement signal. The existing `suggestedConfig`, `requiredInputs`, `installable`, and `configError` signals already expose all consumed state. This is reversible.
- Left `mcp-directory-browser.component.spec.ts` unchanged because it contained no `installConfigResult` reference.
- Deferred all compile, test, and lint verification to CI under Task 5.2 and the user instruction.

## Tool fallback

`ptah_code_search_symbols` returned zero hits with no usable symbol index for `installConfigResult`. Native grep then located all component references and confirmed that the spec had none.

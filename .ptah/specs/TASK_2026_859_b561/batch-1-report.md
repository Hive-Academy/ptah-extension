# Batch 1 report — Shared registry types and install-config mapper

Status: COMPLETE

## Task 1.1 — Types and mapper

Added the 2025-12-11 server.json contract types. Kept all old-shape types for the later removal batch.
Added `version`, `title`, `websiteUrl`, `packages`, and `remotes` to `McpRegistryEntry`.
Added the registry error codes and user-safe messages. Added optional error fields to the search and
popular result contracts.

Implemented `registryEntryToInstallConfig` as a pure TypeScript function. It selects packages in the
required npm, pypi, oci, and nuget order. It then selects streamable HTTP and SSE remotes. It returns
coded errors for missing sources, unsupported package types, and unsupported package transports.
It builds command arguments as arrays. It resolves literal values and defaults for environment
variables, headers, arguments, and URL variables. It exports the mapper and its result types from the
shared public entry.

## Task 1.2 — Fixture-driven mapper tests

Copied all 13 required recorded fixtures without changes. A `cmp` loop confirmed that every copy is
byte-identical to its source.

Added fixture-driven tests for list items, npm, pypi, OCI, nuget, HTTP, SSE, environment inputs,
remote URL variables, package priority, package arguments, and mcpb fallback. Added derived tests for
mcpb-only, OCI HTTP-only, no-source, unknown registry type, hostile runtime hint, required arguments,
URL value precedence, URL defaults, and literal headers.

## Verification

The initial verify run failed on four TS4111 index-access errors in the new spec. Changed those
accesses to bracket notation. The final scoped verify run passed all three targets.

Final command:

```text
npm run verify -- -p @ptah-extension/shared 2>&1 | tail -40
```

Final output tail:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/shared

[verify 2026-11-01T15:00:43.580Z] lock slot 1 acquired after 0s: verify lint,test,typecheck (@ptah-extension/shared)

 NX   3 tasks: 3 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      1m 0s
  Cache:             0/3 hit (0%)
  Critical path:     24.5s (1 task)
  Recoverable time:  35.8s (59% of the run)

[verify 2026-11-01T15:01:53.601Z] lock released after 70.0s, exit code 0
```

`ptah_get_diagnostics` reported zero errors and zero warnings for the four changed TypeScript source
files. No workspace-wide checks or build, serve, dev, e2e, or package targets ran.

## Risk handling

- **R1:** Added optional `errorCode` and `error` fields to `McpDirectorySearchResult` and
  `McpDirectoryGetPopularResult`. Batch 2 can now return coded failures instead of a silent empty list.
- **R4:** URL variables resolve from `value` and then `default`. Unresolved variables remain in the URL,
  produce `location: 'url'` required inputs with choices, and set `installable: false`.
- **R5:** Unresolved environment variables and headers are omitted from the config. Required or secret
  inputs are listed by name and metadata only. The `AI_2KW_API_KEY` test proves that no empty secret is
  written. The mapper contains no logging.
- **R6:** All commands use an `args` array. Runtime hints are limited to `npx`, `uvx`, `docker`, and `dnx`.
  The hostile `sh -c` test falls back to `npx` and preserves the argument array.
- **A2:** The mapper and types import no Zod module. The shared public entry exports the pure mapper.
  The full shared verification passed, including `index.zod-free.spec.ts`.
- **A5:** Kept `McpRegistryArgument` and all other old-shape types. No old-shape consumer was changed.

## Files created or modified

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-directory.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/list-page.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-both.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-env-vars.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-mcpb.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-nuget.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-oci.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-oci-http.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-package-arguments.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-package-npm.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-pypi.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-remote-only.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-remote-sse.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/detail-remote-templated.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/batch-1-report.md`

## Decisions

1. **Unresolved environment variables and headers do not block installation.**
   - Options: block installation, or return required inputs with `installable` unchanged.
   - Evidence: Batch 1 limits `installable: false` to unresolved URL variables and required arguments.
     Batches 3 and 4 also treat required secrets as installable inputs.
   - Reversible: yes.
2. **Every unresolved URL variable is marked required.**
   - Options: copy an absent or false `isRequired` flag, or mark the URL input required.
   - Evidence: an unresolved URL variable prevents a usable endpoint and R4 requires installation to be
     disabled.
   - Reversible: yes.
3. **OCI adds `-e NAME` for every declared environment variable.**
   - Options: add flags only for resolved values, or add them for every declared variable.
   - Evidence: the batch requires one flag per environment variable because Docker does not inherit the
     config `env` map automatically. Resolved values still control the separate `config.env` map.
   - Reversible: yes.
4. **Empty strings count as unresolved input values.**
   - Options: write empty strings, or omit them and collect required or secret inputs.
   - Evidence: R5 forbids empty-string secrets in generated configs.
   - Reversible: yes.

No requirements remain unmet. No git operation that changes repository state was performed.

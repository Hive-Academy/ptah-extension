# Batches - TASK_2026_859_b561

Total tasks: 13 | Batches: 5 | Complete: 5/5

Flow: BUGFIX, plan-free. Inputs: task.md, context.md, decisions.md (D3-D10 binding),
research-report.md, fixtures/. Worktree for every path, command and commit:
`/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api` (branch fix/mcp-registry-api).

Batching boundary: one batch per owning Nx project group, shared contract first; old-shape types
are removed only in the last batch so every intermediate commit still typechecks.

Execution defaults (recorded, no ordering given by the prompt): Batch 1 alone; Batches 2, 3 and
4 are file-disjoint and depend only on Batch 1, so the orchestrator may run them in parallel;
Batch 5 runs last. One phase, one code-logic review (codex lane, OpenAI family; implementers are
Claude-family per D2). No style review: no new public API beyond the shared mapper, which the
code-logic reviewer covers in the combined diff.

## Rules for every executor (repeat into every lane prompt)

- Work only inside `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api`.
- From Batch 5 on (user instruction, 2026-11-01): run NO local verify or heavy check; CI is
  the gate.
- Verify only with `npm run verify -- -p <projects>` (memory-safe lock). Never workspace-wide,
  never `nx run-many` over unchanged projects, never build/serve/dev/e2e/package targets. Filter
  output with `| tail -40`; do not re-run to read it.
- Electron first; keep every host compiling.
- Do NOT touch install-scope code: install target/scope selection (`selectedTargets`,
  `toggleTarget`, `confirmInstall` target handling), `mcp-install.service.ts`, or any install-scope
  types in `mcp-directory.types.ts`. Branch feat/session-prefix-diet-d edits those; keep the diff
  minimal around them.
- No git commands. No edits to `task.md` or `batches.md`. No stubs, TODOs or placeholders.
- Never log secret values (env vars / headers with `isSecret`).

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1: `version=latest` list items carry the full server.json (packages/remotes), so cards and
  auto-detect need no detail fetch — verified in fixtures/list-page.json and research-report
  (D5). Task 3.1 still keeps the detail fetch as fallback when an entry has neither field.
- A2: `@ptah-extension/shared`'s main barrel must stay zod-free
  (libs/shared/src/index.zod-free.spec.ts). The mapper is pure TypeScript; the Zod schema lives in
  the provider only — verified by that spec in Batch 1's verify run.
- A3: chat-ui and ptah-cli can import runtime functions from `@ptah-extension/shared` (they already
  import runtime helpers from it) — verified by Batch 3/4 typecheck.
- A4: `uvx <id>@<ver>` and `dnx <id>@<ver> --yes` syntax is inferred from docs, not executed
  (research-report Unknowns). Unverified; tests pin the produced arrays, runtime is out of reach.
- A5: `McpRegistryArgument` (mcp-directory.types.ts:144) has no consumers (grep of apps/ libs/)
  — verified; removed in Task 5.1 with the other old-shape types.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: RPC handlers swallow every provider error into `{ servers: [] }` (libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:387-399, 589-601, 423-435), so a coded `MCP_REGISTRY_SHAPE_UNKNOWN` throw would still render as a silent empty list — the exact failure goal 4 forbids. | HIGH | Task 1.1 adds optional `errorCode` + user-safe `error` to `McpDirectorySearchResult` / `McpDirectoryGetPopularResult`; Task 2.2 sets them when the thrown error carries a registry code; Task 3.1 shows the coded message. |
| R2: `McpRegistryListResponse.next_cursor` is the normalized internal field shared with Smithery (smithery-registry.source.ts:143), rpc handler (:385) and the harness namespace builder (harness-namespace.builder.ts:880, 928). Renaming it widens the diff far beyond fetch/parse. | MEDIUM | Decision below: keep the internal `next_cursor`; only the wire key changes to `metadata.nextCursor`, parsed in Task 2.1. |
| R3: Removing old types in the same commit as the new ones breaks typecheck of provider, component and CLI at intermediate commits. | MEDIUM | New types land additively in Batch 1 with non-colliding names; old types and `version_detail` are deleted in Batch 5 after all consumers moved. |
| R4: Remote URLs with unresolved `{var}` (fixtures/detail-remote-templated.json) cannot be installed as-is; writing a templated URL produces a broken config. | MEDIUM | Task 1.1 mapper contract: URL vars resolve from `value`, then `default`; otherwise listed as required inputs with `location: 'url'` and the result is `ok: true` with `config` whose URL still contains the template plus `installable: false`. Task 3.1 disables the existing Install button when `installable` is false and lists the inputs. |
| R5: Required secrets (fixtures/detail-env-vars.json `AI_2KW_API_KEY`) must not be written as empty strings nor logged. | MEDIUM | Task 1.1: unresolved env/header values are omitted from `config.env` / `headers` and surfaced in `requiredInputs` (name, description, isSecret, location); Task 1.2 asserts no empty-string secret appears. |
| R6: Shell injection through registry-provided arguments / runtimeHint. | MEDIUM | D9: args are arrays; runtimeHint allowlist {npx, uvx, docker, dnx}; Task 1.2 test with a hostile runtimeHint falls back to the registryType default. |
| R7: getServerDetails currently catches everything to `null` (mcp-registry.provider.ts:205), hiding shape errors. | MEDIUM | Task 2.1: 404 and network failure stay `null` (interface contract); a shape-parse failure rethrows the coded error; Task 2.2 maps it on `getDetails` too. |
| R8: Phase D branch (feat/session-prefix-diet-d) edits mcp-directory.types.ts and mcp-directory-browser.component.ts — merge conflicts. | LOW | Edits limited to the registry-entry type block (lines ~91-223) and result types; component edits limited to the listed methods and the fallback copy. |

Edge cases:

- mcpb-only / cargo-only entry → `MCP_PACKAGE_TYPE_UNSUPPORTED` — Task 1.1/1.2
- package with streamable-http/sse transport only (fixtures/detail-oci-http.json) →
  `MCP_PACKAGE_TRANSPORT_UNSUPPORTED` — Task 1.1/1.2
- entry with mcpb plus npm (fixtures/detail-mcpb.json) → npm config, not an error — Task 1.2
- entry with both package and remote (fixtures/detail-both.json) → package first (D3) — Task 1.2
- no packages and no remotes → `MCP_NO_INSTALL_SOURCE` — Task 1.1/1.2
- list body without `servers` array, or every item failing schema → `MCP_REGISTRY_SHAPE_UNKNOWN`
  — Task 2.1
- detail 404 (fixtures/detail-404.json) → `null` — Task 2.1
- server names with `/` in the detail path → `encodeURIComponent` — Task 2.1
- Smithery entries (no packages/remotes, carry `connections`) must keep their current path — the
  mapper is only called for `source !== 'smithery'` — Task 3.1, and Smithery spec untouched.
- oci package env vars must be passed with `-e NAME` because docker does not inherit `env` —
  Task 1.1/1.2

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep internal `McpRegistryListResponse.next_cursor`; change only the wire key to `metadata.nextCursor` | rename internal field everywhere / keep it | R2 consumers outside the fetch/parse path; prompt scope "fetch/parse/detect path only" | yes |
| Add new types under non-colliding names, delete old ones in Batch 5 | in-place rename in Batch 1 / additive then delete | R3; repo merges PRs with merge commits (git log), so intermediate commits land on main | yes |
| Surface the coded shape error through optional `errorCode`/`error` on search/popular RPC results | leave RPC swallowing / throw over RPC / additive result fields | R1; additive optional fields break no consumer | yes |
| Mapper file `libs/shared/src/lib/types/mcp-registry-config.mapper.ts`, exported from `libs/shared/src/index.ts` | lib/utils / next to types | prompt: "a new file in libs/shared next to the types" | yes |
| Unresolved URL variables → `installable: false` + required inputs, not a D7 error code | new error code / required input | D8 says required values are inputs, not failure; R4 | yes |

## Batch 1: Shared registry types and install-config mapper — COMPLETE (commit 6c9f150e2)

- Recommended executor: CLI lane, backend capability (agent shape: backend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  backend-developer
- Subagent reason: N/A
- Review family: different from implementer (phase review on codex)
- Rationale: one project, pure TypeScript contract + pure function + fixture-driven spec; the
  types and the mapper are coupled, so one executor in order.
- Tasks: 2 | Depends on: none
- Phase: registry-fix | Phase review: code-logic (combined diff, after Batch 5)

### Task 1.1: Add 2025-12-11 server.json types, result fields and the pure mapper — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-directory.types.ts` (extend)
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.ts` (create)
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/index.ts` (add export next to line 43)
- Plan reference: research-report.md "Server.json schema (2025-12-11), as served" and "Options";
  decisions.md D3, D4, D7, D8, D9.
- Pattern to follow: existing interfaces in mcp-directory.types.ts:60-223 (JSDoc per field);
  `McpServerConfig` union at :89.
- Quality requirements:
  - Types (add, do NOT remove old ones yet): `McpRegistryInput` (description, isRequired,
    format, value, isSecret, default, placeholder, choices), `McpRegistryKeyValueInput` (Input +
    name + variables), `McpRegistryPackageArgument` (positional | named, both Input + variables,
    isRepeated, valueHint), `McpRegistryPackageTransport` (`{type:'stdio'}` |
    `{type:'streamable-http'|'sse', url, headers?}`), `McpRegistryServerPackage` (registryType,
    identifier, transport, registryBaseUrl?, version?, fileSha256?, runtimeHint?,
    runtimeArguments?, packageArguments?, environmentVariables?), `McpRegistryRemote` (type
    `'streamable-http'|'sse'`, url, headers?, variables?: Record<string, McpRegistryInput>).
    `registryType` / transport `type` are `string`-tolerant (unknown values must reach the
    mapper, not be rejected by a type).
  - `McpRegistryEntry` gains optional `version?`, `title?`, `websiteUrl?`, `packages?`,
    `remotes?`. Update its JSDoc to the `/v0.1/servers?version=latest` + `{server,_meta}` shape.
  - `McpRegistryErrorCode` = `'MCP_REGISTRY_SHAPE_UNKNOWN' | 'MCP_NO_INSTALL_SOURCE' |
    'MCP_PACKAGE_TYPE_UNSUPPORTED' | 'MCP_PACKAGE_TRANSPORT_UNSUPPORTED'` and a
    `MCP_REGISTRY_ERROR_MESSAGES: Record<McpRegistryErrorCode, string>` of user-safe sentences
    (no server data, no secrets).
  - `McpDirectorySearchResult` and `McpDirectoryGetPopularResult` gain optional
    `errorCode?: McpRegistryErrorCode` and `error?: string` (R1).
  - Mapper `registryEntryToInstallConfig(entry: McpRegistryEntry): McpInstallConfigResult` where
    the result is `{ ok: true; config: McpServerConfig; requiredInputs: McpRequiredInput[];
    installable: boolean; source: 'package' | 'remote' }` or `{ ok: false; code:
    McpRegistryErrorCode; message: string }`. `McpRequiredInput` = `{ name; description?;
    isSecret: boolean; isRequired: boolean; location: 'env' | 'header' | 'url' | 'argument';
    choices?: string[] }`.
  - Selection (D3): first supported stdio package in order npm → pypi → oci → nuget; then
    remote streamable-http → `{type:'http', url, headers}`; then remote sse → `{type:'sse', ...}`.
    Error precedence when nothing is supported: no packages and no remotes →
    `MCP_NO_INSTALL_SOURCE`; else a package with non-stdio transport present →
    `MCP_PACKAGE_TRANSPORT_UNSUPPORTED`; else `MCP_PACKAGE_TYPE_UNSUPPORTED`.
  - Package commands (D9, research-report Options): npm `npx -y <id>[@ver]`; pypi
    `uvx <id>[@ver]`; oci `docker run -i --rm [runtimeArguments] [-e NAME per env var]
    <id> [packageArguments]`; nuget `dnx <id>[@ver] --yes [packageArguments]`. runtimeHint used
    as command only if in {npx, uvx, docker, dnx}, else the registryType default. Arg order:
    runtimeArguments, package spec, packageArguments; named → `name` then `value` when value
    present; positional → `value` (or `default`). Arguments with no value and `isRequired` →
    required input `location:'argument'` and `installable:false`.
  - Env / headers (D8, R5): literal `value` or `default` → included; otherwise omitted and listed
    as required input when `isRequired` or `isSecret` (optional unset ones are just omitted).
  - Remote URL `{var}` (R4): resolve from `variables[var].value`, then `.default`; unresolved →
    required input `location:'url'` (with `choices`) and `installable:false`.
  - No zod import anywhere reachable from `libs/shared/src/index.ts` (A2). No logging.
- Validation notes: R1, R4, R5, R6, A2, A5 (do not remove `McpRegistryArgument` yet).
- Implementation details: pure functions, no I/O; export mapper + `McpRequiredInput` +
  `McpInstallConfigResult` + codes/messages from the shared public entry.

### Task 1.2: Mapper unit tests on recorded fixtures — COMPLETE

- Depends on: Task 1.1
- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.spec.ts` (create)
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/__fixtures__/mcp-registry/` (copy, unmodified, from the task folder `fixtures/`: list-page.json, detail-both.json, detail-env-vars.json, detail-mcpb.json, detail-nuget.json, detail-oci.json, detail-oci-http.json, detail-package-arguments.json, detail-package-npm.json, detail-pypi.json, detail-remote-only.json, detail-remote-sse.json, detail-remote-templated.json)
- Plan reference: context.md goal 5; research-report "Recorded fixtures".
- Pattern to follow: any `*.spec.ts` under libs/shared/src/lib (Jest).
- Quality requirements: load fixtures with `readFileSync(join(__dirname, '__fixtures__/mcp-registry', f))`
  + `JSON.parse`, unwrap `.server`. Cases: every list-page item maps to `ok:true` or a coded
  error (no throw); remote-only → http; remote-sse → sse; package-npm → npx array; pypi → uvx;
  oci → docker with `-e`; nuget → dnx; package-arguments → argument order; env-vars → secret
  `AI_2KW_API_KEY` in `requiredInputs` with `isSecret:true` and absent from `config.env`;
  remote-templated → `installable:false` with `api_host` choices; both → package wins (D3);
  mcpb (+npm) → npm. Derived unsupported cases built by cloning a fixture and stripping fields,
  labelled "derived from <fixture>": mcpb-only → `MCP_PACKAGE_TYPE_UNSUPPORTED`; oci-http only →
  `MCP_PACKAGE_TRANSPORT_UNSUPPORTED`; no packages/remotes → `MCP_NO_INSTALL_SOURCE`; hostile
  runtimeHint (`"sh -c"`) → default command, args still an array.
- Validation notes: R5, R6; unknown `registryType` must not throw.

### Batch 1 verification

- Every listed artifact exists and contains real work; fixtures are byte-identical copies (`cmp`).
- `npm run verify -- -p @ptah-extension/shared` passes (includes index.zod-free.spec.ts).
- Result (team-leader, 2026-11-01): implementer kimi-code (CLI lane). Files read on disk:
  real mapper, 21 spec cases, 13 fixtures `cmp`-identical. Verify exit 0 (3/3 targets).
  Report: batch-1-report.md. Notes for the phase code-logic review: (a) an allowed
  `runtimeHint` from another registry type (e.g. `uvx` on an npm package) is used with
  the npm arg layout (`uvx -y pkg`); (b) the mapper reads `transport.type` unguarded,
  so Batch 2's Zod schema must require `transport` on every package it passes on.
- No per-batch review; covered by the phase code-logic review.

## Batch 2: Registry provider and RPC error propagation — COMPLETE (commit 09ede97d8)

- Recommended executor: CLI lane, backend capability (agent shape: backend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  backend-developer
- Subagent reason: N/A
- Review family: different from implementer (phase review on codex)
- Rationale: provider error contract and the handler that consumes it must agree; one executor.
- Tasks: 2 | Depends on: Batch 1 (may run in parallel with Batches 3 and 4)
- Phase: registry-fix | Phase review: code-logic (combined diff, after Batch 5)

### Task 2.1: Provider on the new endpoint, Zod schema and coded shape error — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.spec.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/__fixtures__/mcp-registry/` (copy list-page.json, detail-remote-only.json, detail-env-vars.json, detail-404.json from the task folder)
- Plan reference: decisions.md D5, D6, D7; research-report "Answer", "Disagreements".
- Pattern to follow: current provider (mcp-registry.provider.ts:39-96, unwrap + safeParse);
  smithery-registry.source.ts for a Zod-validated source.
- Quality requirements: Zod schema for `{ servers: [{ server: ServerDetail, _meta? }], metadata:
  { nextCursor?, count? } }` with server fields `name`, `description`, `version`, `title`,
  `websiteUrl`, `repository`, `icons`, `packages`, `remotes` (packages/remotes structurally
  validated but permissive on unknown `registryType`/`type` strings; `.passthrough()` kept).
  Map `_meta['io.modelcontextprotocol.registry/official'].publishedAt/updatedAt` to
  `created_at`/`updated_at`; set `source: 'official'`. Drop the legacy flat-shape tolerance and
  the `version_detail` field. Detail URL `${REGISTRY_BASE_URL}/servers/${encodeURIComponent(name)}/versions/latest`.
  Pagination from `metadata.nextCursor`, returned as internal `next_cursor` (Decision R2).
  Export a `McpRegistryShapeError extends Error` with `readonly code =
  'MCP_REGISTRY_SHAPE_UNKNOWN'`; throw it when the list envelope fails to parse or when a
  non-empty `servers` array yields zero valid entries; single malformed items are dropped with the
  existing warn log (no secrets in the log). Detail: 404 → `null`, network failure → `null`,
  shape failure → throw `McpRegistryShapeError` (R7).
- Spec: update URL assertions (`/versions/latest`, encoded `/`), `metadata.nextCursor`, envelope
  unwrap from list-page.json fixture, packages/remotes preserved, shape error on
  `{ items: [] }` and on all-invalid items, 404 → null, popular cache behaviour unchanged.
- Validation notes: R7, D6; keep the "returns null when getServerDetails throws" case meaning
  network failure only.

### Task 2.2: RPC handlers return the coded error instead of an empty list — COMPLETE

- Depends on: Task 2.1
- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`
- Plan reference: R1; decisions.md D7.
- Pattern to follow: the existing `SmitheryKeyMissingError` branch in the same catch blocks
  (:387-399, :423-435, :589-601).
- Quality requirements: in search and getPopular catch blocks, when the error has `code ===
  'MCP_REGISTRY_SHAPE_UNKNOWN'` (instanceof `McpRegistryShapeError` if exported from
  cli-agent-runtime's public entry, else a code check), still capture to Sentry and log, then
  return `{ servers: [], errorCode, error: MCP_REGISTRY_ERROR_MESSAGES[code] }`. getDetails keeps
  returning `{ name }` (its result type is the entry) but logs the code. Other errors unchanged.
- Spec: one case per handler proving `errorCode` and message are returned for a shape error.
- Validation notes: R1.

### Batch 2 verification

- Artifacts exist; fixtures are byte-identical copies.
- `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers` passes.
- Result (team-leader, 2026-11-01): implementer kimi-code (CLI lane). Diff read on disk: Zod
  envelope schema, `McpRegistryShapeError` thrown on bad envelope / all-invalid items / bad
  detail body, 404 and network failure still `null`; search and getPopular return
  `errorCode` + message, getDetails logs the code. 4 fixtures `cmp`-identical. No scope
  violations, no stubs. Lane-reported verify 6/6 pass (team-leader re-run was a 6/6 Nx
  cache hit). Local verify skipped by user instruction; CI is the gate.
  Report: batch-2-report.md.

## Batch 3: Directory browser auto-detect via the shared mapper — COMPLETE (commit 18dd03019)

- Recommended executor: CLI lane, frontend capability (agent shape: frontend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  frontend-developer
- Subagent reason: N/A
- Review family: different from implementer (phase review on codex)
- Rationale: one Angular component and its spec; signals already in place.
- Tasks: 1 | Depends on: Batch 1 (parallel-safe with Batches 2 and 4)
- Phase: registry-fix | Phase review: code-logic (combined diff, after Batch 5); visual
  before/after (dark + light) in Electron at completion (D10 supplies the "before").

### Task 3.1: Replace generateConfig and version_detail reads; coded messages — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts`
- Plan reference: decisions.md D3, D4, D7, D8; context.md goal 3/4.
- Pattern to follow: existing signals `suggestedConfig`, `isLoadingDetails`, `error` and the
  config preview block in the template (~line 240-300).
- Quality requirements:
  - `cards` computed (~371-387): version from `server.version`; `remoteUrls` from
    `server.remotes[].url`; `getTransportType` (~552) from the mapper's chosen source
    (`stdio` / `streamable-http` / `sse`) or first remote/package transport type.
  - `toggleInstallPanel` (~444-466): if the entry has `packages` or `remotes`, map it directly
    (A1); else fetch `mcpDirectory:getDetails` and map the result. Store the full mapper result
    in a signal (replace `suggestedConfig` usage minimally: keep `suggestedConfig` as the config,
    add signals for required inputs, installable flag and coded message).
  - Delete private `generateConfig` (~575-610).
  - Template: replace "Could not auto-detect configuration for this server." (~265) with the
    coded user-safe message from the mapper (`MCP_REGISTRY_ERROR_MESSAGES[code]`); show the
    required-inputs list (name, description, "secret" marker; never values) in the existing
    preview; disable the existing Install button when `installable` is false. Do not alter
    target selection or `confirmInstall` target logic.
  - `performSearch` / `loadPopular`: when `result.data.errorCode` is set, show `result.data.error`
    instead of the empty-state.
  - Smithery entries (`source === 'smithery'`) keep their current path untouched.
- Spec: update the `entry()` factory (~56) to the new shape; cases for npm package card + config,
  remote-only card, required secret listed and install disabled only for unresolved URL vars,
  coded message for no-source entry (replaces the `version_detail: undefined` case ~305), and the
  search `errorCode` message.
- Validation notes: R1 consumer side, R4, R5, R8 (keep diff inside listed regions).

### Batch 3 verification

- `npm run verify -- -p @ptah-extension/chat-ui` passes.
- Result (team-leader, 2026-11-01): implementer kimi-code (CLI lane). Diff read on disk:
  `generateConfig` removed, `registryEntryToInstallConfig` drives `suggestedConfig`, required
  inputs list (secret badge), install disabled when not installable, coded error messages on
  search/popular. Install target selection untouched. Local verify skipped by user
  instruction; CI is the gate. (A team-leader run started before that instruction exited 0,
  3/3 targets.) Report: batch-3-report.md. Note for the phase review: the `installConfigResult`
  signal is written but may have no reader (dead state).

## Batch 4: CLI install path via the shared mapper — COMPLETE (commit: subject "fix(cli): batch 4 - install via the shared registry mapper"; the batches.md update rides in that commit, so its SHA is the one in git log)

- Recommended executor: CLI lane, backend capability (agent shape: backend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  backend-developer
- Subagent reason: N/A
- Review family: different from implementer (phase review on codex)
- Rationale: one host command file and its spec; keeps ptah-cli compiling (D4).
- Tasks: 1 | Depends on: Batch 1 (parallel-safe with Batches 2 and 3)
- Phase: registry-fix | Phase review: code-logic (combined diff, after Batch 5)

### Task 4.1: Remove duplicate generateConfig; map with registryEntryToInstallConfig — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.spec.ts`
- Plan reference: decisions.md D4, D7, D8.
- Pattern to follow: the existing install action in mcp.ts:200-260 and its error throws.
- Quality requirements: replace the `version_detail` guard (~217-225) and delete
  `generateConfig` (~392-435) plus its header comment (~15); call the shared mapper; on
  `ok:false` throw an Error whose message is `<code>: <user-safe message>`; on
  `installable:false` throw with the required input names (no values); on required secret
  inputs that are installable, proceed and emit them in the existing notification payload as
  names only. Update the stale doc comment in mcp.spec.ts:9 and the fixture at :140-143 to the
  new `packages` shape; add a case for a coded error.
- Validation notes: R5 (names only), D4.

### Batch 4 verification

- `npm run verify -- -p ptah-cli` passes.
- Result (team-leader, 2026-11-01): implementer kimi-code (CLI lane). Diff read on disk:
  `generateConfig` deleted, `registryEntryToInstallConfig` used; `ok:false` throws
  `<code>: <message>`; `installable:false` throws with input names only; secret inputs passed
  as names only. 3 new spec cases. No stubs, no install-scope changes. Local verify skipped
  by user instruction; CI is the gate (a run in progress was stopped). Report:
  batch-4-report.md.

## Batch 5: Remove old-shape types and stale fixtures; host verification — COMPLETE (commit: subject "fix(shared): batch 5 - drop old registry types, per-type runtimeHint"; the batches.md update rides in that commit, so its SHA is the one in git log)

- Recommended executor: CLI lane, backend capability (agent shape: backend-developer); host
  checks may be run by senior-tester when a lane is not available.
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  backend-developer
- Subagent reason: N/A
- Review family: different from implementer (phase review on codex)
- Rationale: deletion is only safe after Batches 2-4 moved every consumer; it is the phase's
  last batch and carries the dependent-host checks.
- Tasks: 4 (5.4 added by the orchestrator) | Depends on: Batches 2, 3, 4
- Phase: registry-fix | Phase review: code-logic over `<parent of Batch 1 commit>..HEAD`
- Order: 5.1, then 5.3, then 5.2 (host checks run last over both).

### Task 5.1: Delete old registry types and update remaining references — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-directory.types.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts` (JSDoc at :144 only)
- Plan reference: prompt scope; A5; R3.
- Pattern to follow: n/a (deletion).
- Quality requirements: delete `McpRegistryPackage`, `McpRegistryTransport`,
  `McpRegistryVersionDetail`, unused `McpRegistryArgument`, and `McpRegistryEntry.version_detail`.
  Keep internal `next_cursor` (Decision R2). Rewrite `REGISTRY_ENTRIES_FIXTURE` (:670-705) to the
  new shape (`version`, `packages:[{registryType:'npm', identifier, version, transport:{type:'stdio'}}]`).
  Update the brand-slugs JSDoc to `remotes[].url`. Then grep apps/ and libs/ for
  `version_detail|registry_name|McpRegistryTransport|McpRegistryVersionDetail|McpRegistryPackage\b`
  and report zero hits outside `.ptah/`.
- Validation notes: R3.

### Task 5.3: runtimeHint must match the package's registry type — COMPLETE

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/shared/src/lib/types/mcp-registry-config.mapper.spec.ts`
- Source: Batch 1 note (a), confirmed as a defect by the orchestrator. Defect at
  mcp-registry-config.mapper.ts:58 and :133-138: `ALLOWED_RUNTIME_HINTS` is one global set
  (`npx`, `uvx`, `docker`, `dnx`), so an npm package with `runtimeHint: "uvx"` becomes
  `uvx -y pkg@ver` (npm arg layout under the pypi runner), and the same for every other
  cross-type pair.
- Pattern to follow: `DEFAULT_COMMANDS` (mapper.ts:51-56), a `Record<SupportedRegistryType, ...>`.
- Quality requirements: replace the global set with a per-registry-type allowlist
  (`Record<SupportedRegistryType, ReadonlySet<string>>`; npm `npx`, pypi `uvx`, oci `docker`,
  nuget `dnx`; add a further runner only if the existing arg layout for that type is correct
  for it). Use `runtimeHint` only when it is in the allowlist of the package's own
  `registryType`; otherwise fall back to `DEFAULT_COMMANDS[registryType]`. No throw, no logging,
  args stay an array. Keep the hostile-hint case (`"sh -c"`) passing.
- Spec: regression cases built by cloning a fixture, labelled "derived from <fixture>":
  npm package (detail-package-npm.json) with `runtimeHint: "uvx"` → command `npx`, args start
  `-y`; pypi package (detail-pypi.json) with `runtimeHint: "npx"` → command `uvx`, no `-y`;
  matching hint (`npx` on npm) still honoured.
- Validation notes: R6 (args array, no shell); pure function, no zod import (A2).
- Verify: CI only (Task 5.2).

### Task 5.4: Remove the unread `installConfigResult` signal — COMPLETE

- Added by the orchestrator after Batch 3.
- File: `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
- Quality requirements: delete the private signal, its writes and the now-unused
  `McpInstallConfigResult` import; no change to target selection or `confirmInstall`.

### Task 5.2: Dependent-host verification — COMPLETE (local part is a no-op under D11; CI gate open)

- Depends on: Task 5.1
- Files: none (verification only).
- Quality requirements: CI only. By user instruction (2026-11-01) no local `npm run verify`
  or other heavy check runs for this batch; the PR's CI jobs (shared, webview-e2e-harness, ui,
  and the dependent hosts ptah-electron, ptah-cli, ptah-extension-vscode,
  ptah-extension-webview, ptah-tui, marketplace, vscode-lm-tools) are the gate. The executor
  runs no checks; the team-leader reads CI results after the push.
- Validation notes: CLAUDE.md "keep every host compiling".

### Batch 5 verification

- Zero old-shape hits (Task 5.1 grep).
- Local verify: CI only (user instruction); the PR's CI jobs pass.
- Then return NEEDS REVIEW for the phase (code-logic on codex, combined diff).
- Result (team-leader, 2026-11-01): implementer kimi-code (CLI lane). Diff read on disk:
  old types (`McpRegistryPackage`, `McpRegistryTransport`, `McpRegistryVersionDetail`,
  `McpRegistryArgument`, `McpRegistryEntry.version_detail`) deleted; harness fixture on the
  `version` + `packages[]` shape; brand-slugs JSDoc only; mapper allowlist is
  `Record<SupportedRegistryType, ReadonlySet<string>>` with one runner per type, cross-type
  and hostile hints fall back to `DEFAULT_COMMANDS`; 3 new derived spec cases; Task 5.4
  removes the signal, 4 writes and the import only. Team-leader re-ran the 5.1 grep: zero
  hits; `installConfigResult|McpRegistryArgument\b`: zero hits; no TODO/STUB markers in the
  changed files. No install-scope code touched (R8). Local verify not run (D11); CI is the
  gate and its result is still open. Batch 1 note (a) is resolved by Task 5.3.
  Report: batch-5-report.md.

## Completion requirements (Mode 3)

- Visual before/after in Electron, dark + light: "before" = TASK_2026_853 Phase D finding 8
  (D10); "after" = popular list + one remote-only, one npm, one env-var server expanded.
- Parity: N/A expected (no surface replaced); confirm the component's install, target selection
  and Smithery path still work.
- Write-path trace: config written by `mcpDirectory:install` comes from the mapper; confirm
  omitted secrets are not written as empty strings and the stdio/http/sse shapes match what
  mcp-install.service.ts already writes (read-only check, no edits there).

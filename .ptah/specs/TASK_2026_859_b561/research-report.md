# Research Report - TASK_2026_859

## Question

- Decision this supports: how to rewrite the Official MCP Registry client, shared types, and auto-detect (config generation) so directory entries stop showing "Could not auto-detect configuration".
- Question: what does the live registry (checked 2026-11-01) return, what is the current server.json schema, how should each package/remote type map to a runnable config, and which code consumes the old shape?
- Bounds: Smithery source, install-service write paths, UI redesign, and `mcpb` download/verify implementation were not investigated. Registry behaviour beyond the sampled pages (first 6000 latest entries, 60 pages of 100; the scan hit my own page cap, not the end) is not claimed.

## Answer

Switch to the new envelope: every list AND detail response item is `{ server, _meta }` with camelCase `packages[]` / `remotes[]`. The list endpoint with `version=latest` already returns the complete server.json per item, so the card list and auto-detect need no per-server detail fetch (verified); the detail fetch remains useful only as a fallback, and must use `/v0.1/servers/{encodeURIComponent(name)}/versions/latest`. Replace `version_detail` / `registry_name` / `transports` everywhere with a mapping from `packages[]` and `remotes[]`; note the registry is ~88% remote-only (5306 of 6000 sampled latest entries), so remotes must be the primary path.

## Evidence

All curl against `https://registry.modelcontextprotocol.io`, date 2026-11-01 (HTTP date header Sun, 01 Nov 2026). Python used for pretty-printing because `jq` is not installed.

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| List: `GET /v0.1/servers?limit=5&version=latest` returns `{servers:[{server,_meta}], metadata:{nextCursor,count}}` | fixtures/list-page.json | 2026-11-01 | ran it |
| `nextCursor` is `name:version` (e.g. `academy.ase/periodic-system:2026.4.1`); absent when exhausted. Docs say treat as opaque | list-page.json; docs/reference/api/generic-registry-api.md L36-43 | 2026-11-01 | ran it, read doc |
| `limit` max 100 (1000 -> 422 `expected number <= 100`; 0 -> 422) | curl | 2026-11-01 | ran it |
| Without `version=latest`, same name repeated for each version (limit=2 gave `ac.inference.sh/mcp` twice) | curl | 2026-11-01 | ran it |
| `search` is a substring match on the NAME only: `pretrip` -> 1, `Pre-Trip` and a description phrase -> 0; `github` returns names containing github (fixtures/search-github.json) | curl | 2026-11-01 | ran it |
| `updated_since=<RFC3339>` accepted (200) | curl | 2026-11-01 | ran it (effect not diffed) |
| Detail: `/v0.1/servers/{enc}/versions/latest` and `/versions/{semver}` -> 200, body `{server,_meta}`; `/versions` -> 200 `{servers:[...],metadata:{count}}` (fixtures/versions-list.json) | curl | 2026-11-01 | ran it |
| `/v0.1/servers/{enc}` (old detail route) -> 404; `/v0/servers/{enc}` -> 404 | curl | 2026-11-01 | ran it |
| Unknown name: 404, body `{"title":"Not Found","status":404,"detail":"Server not found"}`; unknown version 404 | fixtures/detail-404.json | 2026-11-01 | ran it |
| Encoding: `%2F` works (200); raw `agency.kesey/pretrip/versions/latest` -> 404. So `encodeURIComponent(name)` is required | curl; docs L26 "should be URL-encoded" | 2026-11-01 | ran both |
| `/v0` list is still served (`/v0/servers?limit=1` 200, same `{server,_meta}` shape) but `/v0` root 404 and v0 detail 404; do not rely on it | curl | 2026-11-01 | ran it |
| Schema in use by 5382 of 6000 sampled entries: `static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`; older ones still present (2025-07-09: 169, 2025-09-16: 86, 2025-09-29: 331, 2025-10-17: 31) | scan of live list | 2026-11-01 | ran script |
| Schema definitions (Package, Input, KeyValueInput, NamedArgument, PositionalArgument, RemoteTransport, Icon, Repository), required fields, enums | https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | 2025-12-11 (schema id date) | fetched and parsed |
| `runtimeHint` is only described as "A hint to help clients determine the appropriate runtime... should be provided when runtimeArguments are present"; no mapping table exists in docs. Examples show `uvx`, `dnx`, `npx` | schema; docs/reference/server-json/generic-server-json.md (github.com/modelcontextprotocol/registry) | undated (main branch) | fetched and read |
| `fileSha256` required for mcpb; clients "must validate" if present | schema Package.fileSha256 | 2025-12-11 | read |
| Arguments carry command-injection warning: prefer non-shell exec / consent | schema Argument.description | 2025-12-11 | read |
| `{curly_braces}` substitution: if the variable is missing or `variables` absent, the text "should remain unchanged" | schema Input.value | 2025-12-11 | read |
| Observed registryType x transport counts in 6000 latest entries: npm/stdio 515, pypi/stdio 101, mcpb/stdio 57, oci/stdio 14, oci/streamable-http 8, npm/streamable-http 4, pypi/streamable-http 1, nuget/stdio 1, cargo/stdio 1; remotes: streamable-http 5641, sse 89 | scan of live list | 2026-11-01 | ran script |
| Observed runtimeHint values: npx 128, uvx 43, docker 13 (oci), bunx 2, node 1; absent for most packages. Never `dnx` in sample | scan | 2026-11-01 | ran script |
| 27 of 6000 entries have neither packages nor remotes (cannot be installed) | scan | 2026-11-01 | ran script |
| `_meta` key is `io.modelcontextprotocol.registry/official` with `status`, `statusChangedAt`, `publishedAt`, `updatedAt`, `isLatest` | list-page.json | 2026-11-01 | read |
| No popularity ordering: unsorted list is alphabetical (`ac.*`, `academy.*`...). "getPopular" is really "first 50 alphabetically" | list-page.json; provider.ts:220 | 2026-11-01 | inferred from output |

## Server.json schema (2025-12-11), as served

Top level (`ServerDetail`): required `name`, `description`, `version`; optional `$schema`, `title`, `websiteUrl`, `repository {url, source, id?, subfolder?}`, `icons[] {src, mimeType, sizes[], theme light|dark}`, `packages[]`, `remotes[]`, `_meta`. Note `_meta` sits next to `server` in responses, not inside it.

`packages[]` (`Package`): required `registryType`, `identifier`, `transport`; optional `registryBaseUrl`, `version` (exact, ranges rejected), `fileSha256`, `runtimeHint`, `runtimeArguments[]`, `packageArguments[]`, `environmentVariables[]`. `transport` is `{type: stdio}` or `{type: streamable-http|sse, url, headers?}` (the package-level HTTP transports observed: npm 4, oci 8, pypi 1; see detail-oci-http.json).

Argument: `{type: "positional", value|valueHint, isRepeated}` or `{type: "named", name: "--flag", isRepeated}`; both extend Input with `variables`. Input: `description, isRequired, format (string|number|boolean|filepath), value, isSecret, default, placeholder, choices[]`. `environmentVariables[]` / `headers[]` are KeyValueInput = Input + `variables` + `name`. `remotes[]`: `{type: streamable-http|sse, url (may contain {var}), headers[], variables{name: Input}}`.

## Options (mapping registryType/transport to runnable config)

Rules for any package: prefer `runtimeHint` as the command when it is one of a known allowlist; otherwise use the default for the registryType. Build `args` as an array (never a shell string). Order: runtimeArguments, then the package spec, then packageArguments (named: `name` then `value`, or `name=value`; positional: `value`). Env: emit `environmentVariables` into the config `env` map.

| registryType + transport | Recommended config | Cost / caveat | Status |
| --- | --- | --- | --- |
| npm + stdio | `npx -y <identifier>@<version>` (omit `@version` if missing). Observed example: `pretrip-mcp` 1.0.1 | Easy. runtimeHint `bunx`/`node` seen rarely: restrict to npx unless user has the tool | supported |
| pypi + stdio | `uvx <identifier>@<version>`; observed hint `uvx` | `@version` is uv syntax from uv docs (inferred, not run here); `==` form needs `--from`, so avoid `uvx pkg==ver` | supported |
| oci + stdio | `docker run -i --rm [runtimeArguments] [-e NAME for each env var] <identifier> [packageArguments]`. Identifier already includes registry and tag (`docker.io/aliengiraffe/spotdb:0.1.0`) | Env must be passed with `-e` since docker does not inherit the config `env`. Needs Docker | supported |
| nuget + stdio | `dnx <identifier>@<version> --yes` plus packageArguments | Only one doc example (`dnx Knapcode.SampleMcpServer@0.4.0-beta -- mcp start`); `--yes` is inferred; requires .NET 10 SDK. Single entry live | optional / best effort, else coded error |
| mcpb + stdio | none directly. Needs download of `identifier` URL, SHA-256 check against `fileSha256`, then extract and run manifest | 57 entries; every one in the sample also has other packages or remotes? not checked. Ptah has no MCPB runner | unsupported: coded error `MCP_PACKAGE_TYPE_UNSUPPORTED` unless another package/remote exists |
| cargo + stdio | none (docs: "no single-shot equivalent" and the binary must be pre-installed) | 1 entry | unsupported |
| any package + streamable-http / sse (npm 4, oci 8, pypi 1) | The server is started by a package but spoken to over a URL (may need port argument). Do not guess | Needs lifecycle management | unsupported: coded error `MCP_PACKAGE_TRANSPORT_UNSUPPORTED` |
| remotes[] streamable-http | `{type:'http', url, headers}` | Resolve `{var}` from `variables` (use default, else require user input; if `choices`, pick from them). Headers: only literal `value`s can be auto-filled; `isRequired`/`isSecret` headers with no value need user input | supported |
| remotes[] sse | `{type:'sse', url, headers}` | 89 entries; deprecated transport but the shared type already has `McpSseConfig` | supported |
| no packages and no remotes | n/a | 27 of 6000 | coded error `MCP_NO_INSTALL_SOURCE` |

Selection priority recommended: remote (streamable-http, then sse) when it needs no unresolved variable or secret; otherwise npm, pypi, oci, nuget. Both orders are defensible; 280 entries carry both, so this is a product decision for the architect (see Disagreements). Required secrets (`isRequired && isSecret`, e.g. `AI_2KW_API_KEY`) should surface as inputs to collect, not as a failure.

## Disagreements

- runtimeHint convention: the docs give examples only and no mapping; live data mostly omits it (npm 515 packages, hint on 131). The decision here is local: use hint only from an allowlist, else default per registryType.
- Remote vs package priority for entries with both: nothing in the docs ranks them. Remote avoids local installs (and 280 such entries exist) but may need auth headers; package is local but runs third-party code. Left to the architect.
- Docs say `nextCursor` is opaque while the observed format is `name:version`. Treat as opaque (decides: doc).
- Docs list `/v0.1` only. `/v0/servers` still answers; do not depend on it.

## Local consequences (what consumes the old shape)

Old shape (pre-2025-09): `{name, description, version_detail:{version, packages:[{registry_name, name, version, runtime}], transports:[{type:'stdio'|'http'|'sse', url}]}, created_at, updated_at}`, `next_cursor`. New shape: envelope `{server:{name, version, packages:[{registryType, identifier, version, runtimeHint, transport, ...}], remotes:[{type, url, headers, variables}]}, _meta}`, `metadata.nextCursor`.

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts`
  - L190-192: wrong detail URL; must be `/servers/${encodeURIComponent(name)}/versions/latest`. Response is `{server,_meta}`, so `unwrapRegistryEntry` (L71) already unwraps it, but gives back only name-level fields.
  - L39-49: Zod schema lists `version_detail`, `created_at`, `updated_at` (snake_case, absent in the new data); should validate `version`, `packages`, `remotes`, `websiteUrl`, `title`.
  - L172-181: reads `body.next_cursor` / `metadata.next_cursor`; the real key is `metadata.nextCursor`. As written, pagination never advances (undefined cursor).
  - L183 returns `next_cursor` (type McpRegistryListResponse, types:217).
  - L220 `getPopular` = first 50 alphabetical entries; consider noting in UI; also cache.
  - L143-146 `limit`, `version=latest`, `search` are correct and already pinned by spec (provider.spec.ts, not read in full).
- `libs/shared/src/lib/types/mcp-directory.types.ts`
  - L92-101 `McpRegistryPackage {registry_name, name, version, runtime}`: replace with `registryType`, `identifier`, `version`, `runtimeHint`, `transport`, `packageArguments`, `environmentVariables`, etc.
  - L104-109 `McpRegistryTransport` (type 'http' vs real 'streamable-http'): replace with a `remotes` type.
  - L131-141 `McpRegistryVersionDetail`, L194 `version_detail` on `McpRegistryEntry`: the field to replace (`packages`, `remotes`, `version`, `title`, `websiteUrl`).
  - L196-198 `created_at`/`updated_at` (map from `_meta` publishedAt/updatedAt if wanted). L213-219 list response `next_cursor` / `metadata`.
  - L144-153 `McpRegistryArgument` (old).
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
  - L371-372, L383-385: `version_detail?.transports` / `.version` on cards (brand slug and version). Use `remotes[].url` and `version`.
  - L444 `if (server.version_detail)` (skip detail fetch) and L458 `result.data.version_detail`: the cause of the banner at L265. Switch to "has packages or remotes".
  - L552 `getTransportType`: `version_detail?.transports?.[0]?.type`.
  - L576-614 `generateConfig`: uses `transports.find(t => t.type === 'http')` (real value is `streamable-http`), `p.registry_name === 'docker'` (real value is `oci`), `npmPkg.name` (real field `identifier`), ignores version, env vars, args, headers, variables. Replace with the mapping above.
- `apps/ptah-cli/src/cli/commands/mcp.ts` L15, L217-225, L392-407: duplicate copy of the same old-shape logic (`version_detail`, `registry_name`, `'docker'`, `'http'`). Extract one shared mapper (e.g. in `libs/shared` or cli-agent-runtime) and use it from both. `mcp.spec.ts` also uses the old shape.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts` L683-699: fixtures in the old shape; and `mcp-directory-browser.component.spec.ts`, `mcp-registry.provider.spec.ts` need new-shape fixtures (use the files below).
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts` and `mcp-registry-source.interface.ts` pass `McpRegistryEntry` through; no old field names were found by grep, but they expose `getServerDetails`. `mcp-install.service.ts` has no old-field references (grep clean).
- Smithery source (`smithery-*.ts`) also fills `McpRegistryEntry`; changing the type must keep it compiling (not investigated).

## Recorded fixtures (`fixtures/` in the task folder; all raw registry JSON, pretty-printed with Python json.dumps indent=2, not trimmed)

Base `B=https://registry.modelcontextprotocol.io`, date 2026-11-01. Detail fixtures: `curl -s "$B/v0.1/servers/<urlencoded-name>/versions/latest"`.

| File | Command / name |
| --- | --- |
| list-page.json | `curl "$B/v0.1/servers?limit=5&version=latest"` (all five are remote-only) |
| search-github.json | `curl "$B/v0.1/servers?limit=5&search=github&version=latest"` |
| detail-package-npm.json | `agency.kesey/pretrip` (npm stdio, no env) |
| detail-remote-only.json | `academy.apexai/apex-ai-academy` (streamable-http, one optional secret `Authorization` header) |
| detail-env-vars.json | `ai.2kw/mcp-server` (npm, required secret `AI_2KW_API_KEY`, optional vars, registryBaseUrl) |
| detail-pypi.json | `ai.arsentev/contextburn` (pypi, runtimeHint uvx, positional arg `mcp`) |
| detail-oci.json | `ai.aliengiraffe/spotdb` (oci stdio, secret env) |
| detail-oci-http.json | `ai.com.mcp/hapi-mcp` (oci with streamable-http package transport; large) |
| detail-both.json | `ai.achromat/mcp-server` (npm + streamable-http remote; env defaults, format filepath) |
| detail-package-arguments.json | `ai.apithreshold/apithreshold` (oci, 3 positional packageArguments, required plus secret env) |
| detail-mcpb.json | `ai.autonomous.harness/harness` (npm + mcpb with fileSha256) |
| detail-nuget.json | `cloud.anythink/anythink` (nuget stdio, no hint) |
| detail-remote-sse.json | `ai.agentrapay/agentra` (sse remote) |
| detail-remote-templated.json | `ai.autorfp/mcp` (url `https://{api_host}/mcp` with `variables` + `choices`) |
| versions-list.json | `curl "$B/v0.1/servers/agency.kesey%2Fpretrip/versions"` |
| detail-404.json | `curl "$B/v0.1/servers/does.not%2Fexist/versions/latest"`; file wraps status 404 and body (written by hand from the observed response, not raw) |

Not found in sample: a package with `runtimeArguments` + hint was counted (39 entries, e.g. `ai.aquex/stage1`) but not saved as a fixture; a named-type packageArguments example was not saved either.

## Unknowns

- Whether `updated_since` actually filters (200 only). Smallest test: query with a recent timestamp and compare counts.
- Whether `search` has any wildcard or prefix semantics beyond substring; only a few terms were tried.
- Whether the 6000-entry scan is the full catalogue (it stopped at my 60-page cap; a `nextCursor` was still present).
- Exact `uvx`/`dnx` CLI syntax with extra args was taken from docs/inference and not executed here.
- Which of the 57 mcpb entries lack a fallback package or remote.
- Electron renderer fetch constraints (CORS) were not tested; the provider runs in the backend with Node fetch, which is unaffected.

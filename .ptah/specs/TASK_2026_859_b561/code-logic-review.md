# Code Logic Review — `TASK_2026_859_b561`

Review family: codex (implementer: kimi-code)

Score: **4/10**. Verdict: **REVISE**. Findings: **2 Blocking, 4 Serious, 1 Moderate**.

The new endpoint, envelope, cursor, and fixture-based package/remote mapping are present. The score is below the 5–6 band because ordinary paths still report success for a failed registry operation or an incomplete install. It is above the 1–2 band because the central migration works. This is a static review; CI is the requested verification gate.

## Numbered findings

1. **Blocking — Missing required env/header inputs still permit installation.** `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:95-104`, `:205-214`, `:243-259`; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:307-316`; `apps/ptah-cli/src/cli/commands/mcp.ts:220-258`. The recorded `detail-env-vars.json` has required `AI_2KW_API_KEY`. The mapper omits it from `config.env` but returns `installable: true`; the UI enables Install and CLI sends the incomplete config. Missing required remote headers behave the same way. Specs explicitly assert this (`mcp-registry-config.mapper.spec.ts:160-175`, `mcp-directory-browser.component.spec.ts:335-386`, `mcp.spec.ts:346-403`). **Fix:** set `installable: false` for unresolved required env/header inputs, block installation until supplied, and continue omitting unset secrets rather than writing empty strings.

2. **Blocking — CLI search/popular turn coded shape failures into successful empty lists.** `apps/ptah-cli/src/cli/commands/mcp.ts:148-159`, `:364-375`; `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:413-420`, `:624-631`. RPC returns `{servers: [], errorCode: 'MCP_REGISTRY_SHAPE_UNKNOWN', error: ...}` inside a successful transport response. Both CLI commands ignore `errorCode`, emit an empty list, and return `ExitCode.Success`. Bad envelopes or all-invalid pages look like no matches. **Fix:** check `result.errorCode`, print `<code>: <safe message>`, exit nonzero, and test both commands.

3. **Serious — Detail shape failures lose their code at RPC.** `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:424-459`; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:522-539`; `apps/ptah-cli/src/cli/commands/mcp.ts:212-223`. A malformed detail body throws `McpRegistryShapeError` (`mcp-registry.provider.ts:281-292`), but RPC returns `{name}`. UI and CLI map that to `MCP_NO_INSTALL_SOURCE`, a false diagnosis; the RPC spec confirms the fallback (`mcp-directory-rpc.handlers.spec.ts:271-287`). **Fix:** carry a coded detail failure through RPC, distinguish it from 404/network null, and present `MCP_REGISTRY_SHAPE_UNKNOWN` to both consumers.

4. **Serious — Placeholders inside argument/header values are not resolved or flagged.** `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:68-70`, `:88-135`, `:243-259`. An argument `value: 'https://{host}'` with `variables.host.value`, or header `value: 'Bearer {token}'` with a required unresolved token, is copied literally. The nonempty string yields no `requiredInputs` and `installable: true`. Shared types and Zod accept `variables` here (`mcp-directory.types.ts:111-125`; `mcp-registry.provider.ts:55-64`). **Fix:** substitute declared variables in all input values; flag unresolved placeholders as required and block installation. Test resolved and unresolved argument/header values.

5. **Serious — Schema-marked secrets can be rendered in the preview.** `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:114-120`, `:224-248`; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:229-236`, `:644-650`. A supplied `isSecret: true` argument appears in `config.args`, all of which `getConfigSummary()` prints. A secret URL variable is substituted into `config.url`, which the preview also prints. **Fix:** redact preview values using secret metadata, while retaining the actual config for installation; test both cases.

6. **Serious — Non-shape provider failures still become empty search/popular results.** `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:401-421`, `:611-632`; `mcp-registry.provider.ts:328-350`. A timeout, network rejection, or HTTP 500 is logged then returned as `{servers: []}` without an error. UI says there are no servers, and CLI succeeds. **Fix:** return a safe availability error for official-registry failures and make both consumers present it without raw provider text.

7. **Moderate — Unsupported remote-only entry gets a package-type error.** `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:279-304`. With `packages: []` and an unsupported remote type, the final code is `MCP_PACKAGE_TYPE_UNSUPPORTED`, although there is no package. **Fix:** add a safe remote-transport code or use `MCP_NO_INSTALL_SOURCE`; test remote-only unsupported data.

## Five logic questions

1. **How does this fail silently?** A required credential is omitted from a successful install (finding 1); CLI coded errors and generic provider errors become successful empty lists (findings 2 and 6).
2. **What user action produces unexpected behavior?** Clicking Install for the recorded required-secret package writes a config without its key (finding 1). Running `ptah mcp search` against malformed data reports no matches and exit zero (finding 2).
3. **What input produces a wrong answer?** Argument/header placeholders are written literally (finding 4), and an unsupported remote-only server is called an unsupported package (finding 7).
4. **What happens when a dependency fails or returns a bad shape?** Bad list envelopes and all-invalid pages throw coded provider errors; search/popular RPC preserve the code, but detail RPC loses it (finding 3). Network/HTTP errors on search/popular lose the error entirely (finding 6). Detail 404 and network failures return null as specified.
5. **What is missing that requirements never mentioned?** Secret-bearing values need a redacted preview (finding 5). The recorded list fixture contains only 2025-12-11 entries; older-format compatibility is unverified.

## Data flow and requirements

| Path | Result |
| --- | --- |
| List parsing | Zod parses envelope; valid items survive a partially invalid page; invalid items are warned/dropped; all-invalid nonempty page throws coded error (`mcp-registry.provider.ts:251-269`). |
| Detail | Correct encoded `/servers/${encodeURIComponent(name)}/versions/latest`; 404/network -> null, malformed body -> coded provider throw (`mcp-registry.provider.ts:273-294`). RPC loses the malformed-body code. |
| Pagination | `metadata.nextCursor` becomes internal `next_cursor` (`mcp-registry.provider.ts:161-170`, `:267-270`). |
| Mapping | npm/pypi/OCI/nuget stdio priority, then HTTP/SSE remote (`mcp-registry-config.mapper.ts:48-65`, `:155-194`, `:270-282`). `uvx id@ver` matches the research note's inferred syntax. mcpb-only is unsupported and mcpb plus a remote falls through to the remote. |
| Inputs and hints | URL/argument missing values block. Required env/header values do not. Args are arrays; runner hints are allowed per registry type, with hostile hints falling back (`mcp-registry-config.mapper.ts:48-66`, `:141-194`). |
| Schema versions | Zod requires package `transport` before the mapper reads it (`mcp-registry.provider.ts:85-99`). One malformed old entry is dropped if another is valid; an all-invalid page errors. Recorded fixtures do not establish which older entries remain parseable. |
| Install scope | The combined `git diff 6c9f150e2^..HEAD -- apps libs` has no `mcp-install.service.ts` change. Target selection and `confirmInstall` target logic are unchanged (`mcp-directory-browser.component.ts:274-296`, `:545-571`). |
| Specs | Recorded list/detail/remote/package/env fixtures are loaded. Specs cover endpoint, cursor, invalid envelope, all-invalid list, 404/network, mapper priority, and hostile hints. They assert unsafe secret installability and omit CLI coded-RPC, detail-code propagation, placeholder, secret-preview, and older-schema cases. |

## Decisions

- **Keep package-first priority.** Binding D3 selects stdio packages before HTTP/SSE remotes; research considered remote-first. Evidence: `decisions.md` D3 and `mcp-registry-config.mapper.ts:270-282`. Reversible: yes.
- **Treat unsupported remote-only classification as a diagnostic defect.** The batch plan's final fallback says package-type unsupported, but that message is false when no package exists. Evidence: `mcp-registry-config.mapper.ts:284-304`. Reversible: yes.
- **Use CI as the gate.** The user forbids npm verify, Nx, Jest, and tsc here. No diagnostics tool was invoked because this host's Ptah diagnostics would run the TypeScript compiler. No skill-loading tool was listed in this lane, so the named Angular skill could not be loaded. Reversible: yes.

## Verdict

**REVISE.** Top risk: a successful install that omits a required credential. Confidence is high for the located paths and medium for older-schema compatibility. No source file or git state was changed.

# Code Logic Re-review — TASK_2026_859_b561

Review family: codex (implementer: kimi-code)

Scope: fix commit 9547ccc77 only. Score: **5/10**. Verdict: **REVISE**.

The seven prior findings are substantially addressed, but the new input collection path can expose a supplied URL token in the visible preview and can assign one value to distinct inputs. The score is below the 7–8 band because these are real correctness and disclosure gaps; it is above the 3–4 band because ordinary required-input, coded-error, and redaction paths are implemented. This is a static review; no local test or typecheck ran, per instruction.

## Prior findings

| # | Status | File:line evidence and residual impact |
| --- | --- | --- |
| 1 — required env/header inputs | **PARTIAL** | Mapper marks missing direct inputs un-installable at libs/shared/src/lib/types/mcp-registry-config.mapper.ts:197-207; panel disables Install at libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:333-342, and CLI blocks at apps/ptah-cli/src/cli/commands/mcp.ts:265-282. But confirmInstall takes result.config without checking result.installable at component:610-625, so a direct or stale invocation can send an incomplete config. Add that guard at the action boundary. |
| 2 — CLI coded list failures | **FIXED** | apps/ptah-cli/src/cli/commands/mcp.ts:137-150, :170-181, :418-427 reports coded search/popular results and returns ExitCode.GeneralError before success output. |
| 3 — detail shape code | **FIXED** | RPC returns safe shape/availability codes at libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:432-478; shared detail contract carries them at libs/shared/src/lib/types/mcp-directory.types.ts:842-848; UI and CLI inspect them at component:569-580 and CLI:196-204, :236-244. |
| 4 — argument/header placeholders | **FIXED** | For the original single-input cases, mapper substitutes declared variables or marks unresolved placeholders at libs/shared/src/lib/types/mcp-registry-config.mapper.ts:136-187, called for argument/header values at :190-220, :241-268. A distinct collision defect introduced by its key scheme is listed below. |
| 5 — schema-marked secret preview | **FIXED** | For the original cases, mapper masks marked secret arguments and nested variables at libs/shared/src/lib/types/mcp-registry-config.mapper.ts:180-181, :217-220; it builds a separate preview at :368-389, :415-435. UI renders configPreview() at component:699-705 and sends the real result.config at :610-625. A new leak when secret metadata is absent is listed below. |
| 6 — non-shape provider failure | **FIXED** | Official search/popular failures return MCP_REGISTRY_UNAVAILABLE at libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:420-427, :652-659; UI shows coded errors at component:725-735, :759-769, while CLI exits nonzero as in finding 2. |
| 7 — unsupported remote-only code | **FIXED** | libs/shared/src/lib/types/mcp-registry-config.mapper.ts:464-477 returns MCP_REMOTE_TRANSPORT_UNSUPPORTED when remotes exist without packages; code and safe message are in libs/shared/src/lib/types/mcp-directory.types.ts:192-215. |

## New defects introduced by the fix commit

### Serious — supplied URL token appears in the visible preview

- **Evidence:** libs/shared/src/lib/types/mcp-registry-config.mapper.ts:162-181 accepts a supplied value for an undeclared URL placeholder, assigns isSecret false through toRequiredInput(variable ?? {}), and copies the value into preview. libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:279-286 renders a text field, and :699-705 renders the preview URL.
- **Failure scenario:** A registry remote has URL https://example.test/{token} and omits optional variables metadata. The user enters an access token into the generated field. The full token appears in the configuration summary. Before this fix, the unresolved URL placeholder could not be supplied through the panel.
- **Fix:** Treat every user-supplied placeholder value as sensitive for preview purposes; mask its field by default when metadata is absent. Keep the real value only in config.

### Serious — nested input keys collide across distinct arguments or headers

- **Evidence:** libs/shared/src/lib/types/mcp-registry-config.mapper.ts:113-129, :162-174 key nested variables only as location:name and deduplicate that key. :241-268 maps all package arguments through one state. The panel tracks fields by the same key at libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:247-271.
- **Failure scenario:** Two package arguments each declare a different {value} variable, such as client ID and client secret. Both become argument:value; only one field appears, and its supplied value is written to both arguments. If one declaration marks the value secret and the other does not, the second preview copy can also reveal it.
- **Fix:** Include the parent argument/header identity or stable index in nested input keys, and use that key throughout UI and CLI mapping. Preserve a shared key only when the registry explicitly describes one shared variable.

### Moderate — CLI name matching silently assigns one input to multiple locations

- **Evidence:** apps/ptah-cli/src/cli/commands/mcp.ts:250-263 matches --input against requiredInput.name and writes every matching key. Mapper keys distinguish env and header at libs/shared/src/lib/types/mcp-registry-config.mapper.ts:106-120.
- **Failure scenario:** A remote has a required header named TOKEN and a separate URL {TOKEN} variable with a different credential. --input TOKEN=abc fills both, so CLI treats the config as installable and sends the wrong value to one destination. Unknown names are also accepted without an error when no required input remains.
- **Fix:** Reject ambiguous and unknown names with an actionable message, or accept qualified keys such as header:TOKEN and url:TOKEN while retaining bare names when unique.

## Five logic questions

1. **How can it fail silently?** CLI name matching can fill two distinct keys from one assignment and proceed (apps/ptah-cli/src/cli/commands/mcp.ts:250-265).
2. **What user action is surprising?** Entering a URL token can print that token in the preview (libs/shared/src/lib/types/mcp-registry-config.mapper.ts:162-181; component:699-705).
3. **What input gives a wrong answer?** Two per-argument {value} variables collapse to one key (libs/shared/src/lib/types/mcp-registry-config.mapper.ts:113-129, :241-268).
4. **What happens when a dependency fails?** The changed official-registry RPC paths return safe coded availability errors (libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:420-427, :471-477, :652-659).
5. **What implicit requirement is missing?** Identically named inputs in different places need distinct assignments; the mapper has distinct location keys but the CLI ignores them (libs/shared/src/lib/types/mcp-registry-config.mapper.ts:106-120; apps/ptah-cli/src/cli/commands/mcp.ts:250-263).

## Decisions

- **Finding 1 is PARTIAL.** Options were FIXED or PARTIAL. The disabled button and CLI check satisfy the ordinary interaction, but the action itself accepts a config the mapper marks incomplete. Evidence is component:333-342, :610-625. Adding an action guard is reversible.
- **Original finding 5 is FIXED, with a separate new finding.** The prior case concerned isSecret true values; those are redacted in mapper:180-181, :217-220. The undeclared URL placeholder leak is a new path opened by supplied input support. Masking supplied preview values is reversible.

## Verification and scope

Read git show 9547ccc77 and the prior review, D13/D14, fix report, task context, root instructions, changed mapper/component/CLI/RPC/provider paths, shared exports and contracts, and the install-service handoff. Shared public exports are present at libs/shared/src/index.ts:43-44; the new detail type is an intersection retaining McpRegistryEntry fields at libs/shared/src/lib/types/mcp-directory.types.ts:842-848. No likely missing export or wrong field name was found in the reviewed paths. The fix changes the config chosen by confirmInstall, while target selection and targets: Array.from(this.selectedTargets()) remain as before at component:547-550, :598-625 (R8).

ptah_code_search_symbols returned zero indexed symbols, so one native search located the unchanged install service. No npm run verify, Nx, Jest, tsc, or diagnostics/typecheck ran; CI remains the gate. Runtime behavior and compilation remain unverified here.

# Batch 10b.0a report

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` — adds typed lane-only config inputs to the profile contract.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts` — validates those inputs and fixes D26 lane policy to workspace-write at the resolved working directory, with network disabled and approval policy `never`.
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts` — checks D26 policy, lane isolation, and literal pre-change chat and gateway fingerprints.
- `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.ts` — builds and strictly validates the nested lane App Server config with one MCP server merge.
- `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.spec.ts` — covers exact config keys and values, quoted names, Ptah coexistence, zero and invalid limits, and unknown keys.
- `libs/backend/codex-runtime/src/index.ts` — exports the lane builder, schema, and config type for the later adapter.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10b-0a-report.md` — records this batch and its constraints.

## Config shape

`agents.enabled=false`, `features.plugins=false`, `features.apps=false`, `skills.include_instructions=false`, `web_search` (`live` or `disabled`), and `approval_policy=never`. Positive `model_auto_compact_token_limit` and `tool_output_token_limit` are optional; zero omits each key. `mcp_servers` is one nested object keyed by literal user-server names, including names with dots or quotes. Each listed user server has `{ enabled: false }`; a configured Ptah server has `{ url, tool_timeout_sec }` and wins over a user disable entry named `ptah`. Its timeout defaults to 960 seconds. Strict Zod objects reject unknown config and profile lane keys. Invalid numeric values fail profile construction before spawn.

## Fingerprint stability

The unchanged chat/gateway D14 `ask` policy at `/real/work` canonically encodes as `{"approvalPolicy":"untrusted","permissionLevel":"ask","sandboxPolicy":{"mode":"workspace-write","networkAccess":false,"writableRoots":["/real/work"]}}`. SHA-256 of those bytes is hard-coded in the spec as `sha256:0fbec108e7892de9508f32351f0042c4fe9fd45baf1a6cf4673ed50f5a9ad034` for both chat and gateway. The test also builds a lane profile between baseline and repeat chat/gateway profiles and checks equality. Consumer-specific lane policy branches before the original chat/gateway mapping; the fingerprint algorithm is unchanged.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the existing generic `suppressedTools` field and add typed lane fields. | Replace it immediately; add fields alongside it. | `codex-runtime.ts` and existing specs still consume it; the 10b.0b/0c bridge is later. | Yes, after the runtime and bridge migrate. |
| Build a nested `mcp_servers` object from one ordered list. | Dotted keys; separate Ptah override; one nested object. | Plan 10b.0a requires a nested config and one canonical merge; a literal key preserves quoted user names and Ptah wins. | Yes. |
| Set lane approval policy to `never` and sandbox to restricted workspace-write for every lane permission level. | Reuse the older per-level mapping; use D26's fixed lane policy. | Binding R1/D26 and legacy lane `approval_policy=never`; the adapter's request-decline behavior belongs to a later batch. | Yes, with a policy migration. |
| Use a fixed fingerprint literal. | Compare only with the current builder; hash the pre-change canonical D14 policy. | R2 requires resistance to accidental changes in the builder itself. | Yes. |

## Not done

No routes, runtime transport, or lane selection were changed. The later adapter must consume this config and decline App Server approval requests under R1. Tests, lint, typecheck, build, diagnostics, and all Nx commands were not run because the lane rules prohibit them; coordinator verification remains required. A CLI skill loader was not exposed in the available tools and no local `SKILL.md` was found, so no matching skill could be loaded.

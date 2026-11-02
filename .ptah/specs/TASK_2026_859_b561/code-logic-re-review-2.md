# Code Logic Re-review 2 — TASK_2026_859_b561

Review family: codex (implementer: kimi-code; two specs: claude)

Scope: commit `4d7832f51` only. **Score: 8/10. Verdict: APPROVED.** The four reported paths are addressed; the score stays below 9 because verification is static and CI has not run.

| Re-review item | Status | Evidence |
| --- | --- | --- |
| 1. `confirmInstall` guard | **FIXED** | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:610-614` requires `result.installable` before taking the config or calling install. |
| 2. Supplied URL token in preview | **FIXED** | `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:165-193` marks undeclared placeholders secret and masks any supplied placeholder value in preview; `:437-459` keeps the real URL and preview separate. The new mapper assertion at `mcp-registry-config.mapper.spec.ts:629-651` matches this path. |
| 3. Nested key collisions | **FIXED** | `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:168-180,245-254,264-280,311-320` qualifies header variables by header name and argument variables by kind and index. The two-argument spec at `mcp-registry-config.mapper.spec.ts:653-690` matches the mapping and preview arrays. |
| 4. CLI `--input` ambiguity and unknown names | **FIXED** | `apps/ptah-cli/src/cli/commands/mcp.ts:258-278` accepts an exact qualified key or unique bare name, rejects ambiguous/unknown names before install, and excludes the supplied value from error text. |

## New Blocking or Serious defects

None identified in this commit. The changed specs' assertions were checked against the mapper and CLI branches; no likely compile error or failing assertion was found by inspection.

## Five logic questions

1. **Silent failure:** unresolved input is rejected at the component action boundary (`mcp-directory-browser.component.ts:610-614`) and CLI install boundary (`mcp.ts:281-299`).
2. **Unexpected user action:** a bare `--input` name shared by two fields now fails with qualified choices (`mcp.ts:261-278`).
3. **Wrong input data:** same-named nested argument variables now resolve through distinct keys (`mcp-registry-config.mapper.ts:272-280`).
4. **Dependency failure:** this commit does not change RPC or registry failure handling; the new CLI rejection happens before its install RPC (`mcp.ts:258-281,318-327`).
5. **Missing requirement:** no new Blocking or Serious gap found in the four requested cases; the review does not establish behavior outside the changed paths.

Static review of `git show 4d7832f51`, changed source/specs, shared types, and fixture shapes. No local checks were run; CI is the verification gate. No skill loader was available in this lane.

Verdict: REVISE
Score: 8/10
Review family: kimi-code (implementer: codex)

The contract matches the requested lane policy and legacy config behavior. One major immutability defect remains.

## Defects

1. **The returned lane config is mutable.**  
   **Location:** `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.ts:113-117`  
   **Severity:** major  
   `safeParse` returns a new object graph, and the builder returns it without a deep freeze. The exported `CodexLaneThreadConfig` type also has mutable nested fields. A caller can change `approval_policy`, sandbox-related transport input, MCP entries, or suppression values after validation and before the runtime sends the frame. The profile builder freezes its output at `codex-execution-profile.ts:341-344`, but the new config builder does not preserve that guarantee. The specs at `codex-lane-thread-config.spec.ts:45-148` do not check immutability.  
   **Fix:** Deeply freeze the parsed config before return, expose readonly nested config fields, and add recursive `Object.isFrozen` assertions for the root, nested objects, and MCP server entries.

## Checked

1. **Chat, gateway, and fingerprint stability (R2):** The pre-change `HEAD` algorithm sorts object keys, canonically encodes the policy, and hashes those bytes with SHA-256. For the unchanged D14 `ask` policy at `/real/work`, the canonical bytes are `{"approvalPolicy":"untrusted","permissionLevel":"ask","sandboxPolicy":{"mode":"workspace-write","networkAccess":false,"writableRoots":["/real/work"]}}`. They produce `sha256:0fbec108e7892de9508f32351f0042c4fe9fd45baf1a6cf4673ed50f5a9ad034`, which matches `codex-execution-profile.spec.ts:44-47`. The test catches changes to the hash algorithm, canonical encoding, and this chat/gateway policy mapping. It does not independently pin every other permission level, but the diff leaves those mappings unchanged.
2. **Lane policy (R1/D26):** `codex-execution-profile.ts:184-192` fixes every lane to workspace-write at the resolved lane cwd with `networkAccess: false`. `codex-execution-profile.ts:278-279` rejects `explicitFullAccess`. `approvalPolicy: 'never'` is safe: it does not approve escalations, and it matches legacy `codex-lane-config.builder.ts:124`. It does not replace the later adapter duty to decline every App Server approval request immediately and let the turn continue. **Recommendation: keep `never`.**
3. **Legacy config parity:** The builder maps `agents.enabled`, `features.plugins`, `features.apps`, `skills.include_instructions`, both token limits, `web_search`, `approval_policy`, disabled user servers, Ptah URL, and Ptah timeout. Legacy `model_reasoning_effort` belongs in the dedicated `turn/start.effort` field at `codex-context.ts:515`. Legacy `developer_instructions` belongs in the thread instructions at `codex-context.ts:224-244`. Neither needs a nested config duplicate.
4. **MCP merge and names:** `codex-lane-thread-config.ts:78-111` creates one nested `mcp_servers` object. Literal object keys preserve dotted and quoted user names. A user entry named `ptah` is filtered at lines 82-85, and the real Ptah server is appended at lines 87-98. The spec proves coexistence at `codex-lane-thread-config.spec.ts:46-75`.
5. **Validation:** Zero token limits are omitted at `codex-lane-thread-config.ts:103-108`. Profile schemas reject negative, fractional, infinite, unsafe, and unknown lane inputs before spawn at `codex-execution-profile.ts:87-103`. Strict nested schemas reject unknown output keys at `codex-lane-thread-config.ts:23-45`. The specs cover these paths at `codex-lane-thread-config.spec.ts:77-147`.
6. **Isolation:** `codex-execution-profile.ts:276-277` rejects lane settings on a non-lane consumer. The lane policy branch returns before chat/gateway mapping. The execution profile is deeply frozen at lines 341-344. The mutable standalone config output is defect 1.
7. **Repository rules and scope:** The changed source and specs contain no `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`. No readonly mock assignment, private bracket access, or pending timer appears. The changes stay within the listed files plus the batch report and this review.
8. **10b.0b readiness:** The nested config fits the existing thread frame `config` object. No contract blocker found. The transport batch must use this builder as the single lane MCP source instead of combining it with the generic dotted `mcp_servers.ptah` overrides from `buildCodexMcpConfigOverrides`.

Static review only. Lane rules prohibited tests, lint, typecheck, diagnostics, and Nx commands. The fingerprint value was recomputed with a standalone SHA-256 calculation from the pre-change canonical policy.

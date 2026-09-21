# Harness contract audit

## Verdict

The landed fix is insufficient: it repairs four container shapes, but an accepted proposal still does not guarantee that the user's decisions survive the preview merge or reach Apply. The largest remaining hole is the absence of a validated, acknowledged configuration contract across those stages: successful incremental calls can erase install inputs, arbitrary nested entries can fail later, and an agent assertion can mark the remaining configuration ready. Six findings below identify concrete failures beyond the already-fixed array-to-record coercions.

Audit basis: the working tree on 2026-09-21, including the landed coercions. Read-only inspection covered all requested inputs, the proposal message handler, protocol dispatcher, document builder, and Apply consumers. In-memory Node probes used the actual TypeScript schema and extracted pure methods; they confirmed unknown-key stripping, acceptance of malformed nested entries, name/MCP/skill-origin loss, omitted document sections, and the two document-generation exceptions described below. No installer, Apply operation, source edit, or history-changing Git command was run.

## Findings

### F1 — Untyped nested entries cross validation and fail or disappear downstream

- **Severity**: high
- **Location**: `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:218`, `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:220`, `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:232`, `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:267`
- **What an agent would send**: These are independent `propose_config` calls, not a required combined payload:

  ```json
  {"configUpdates":{"agents":{"harnessSubagents":[{"name":"reviewer","tools":"Read,Glob","instructions":"Review changes"}]}}}
  ```

  ```json
  {"configUpdates":{"skills":{"createdSkills":[{"name":"review","description":"Review changes","instructions":"Inspect changed files"}]}}}
  ```

  ```json
  {"configUpdates":{"mcp":{"servers":[{"name":"demo","url":"https://example.test/mcp","config":{"type":"http","url":"https://example.test/mcp"}}]}}}
  ```

- **What happens**: All three pass the actual boundary probe. The canonical types require structured subagents, skill definitions, and MCP entries, but the boundary validates only their array containers. The subagent's string `tools` crashes default document generation at `libs/backend/rpc-handlers/src/lib/harness/config/harness-prompt-builder.service.ts:119`: `(sub.tools ?? []).join is not a function`. Disabling document generation does not make the entry usable: the agent writer calls `.map()` on tools at `libs/backend/rpc-handlers/src/lib/harness/config/harness-agent-file-writer.service.ts:75`. The skill example supplies the natural field `instructions`, but the materializer reads `content` at `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:120`; joining an undefined content value produces an empty skill body. The MCP example omits `enabled`: the preview filters it out at `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts:255`, and the installer skips it before warning generation at `libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts:68`.

  The remaining record **value** hole is separate from the fixed record/list conversion: `{"configUpdates":{"agents":{"enabledAgents":{"reviewer":true}}}}` also passes. Both the preview at `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts:205` and settings writer at `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:118` require `override.enabled`; a boolean value silently counts as disabled. The prose now gives the correct `{enabled:true}` example, so this is an accepted-invalid-value gap, not a claim that the repaired example is absent.

  A further accepted partial shape, `{"configUpdates":{"persona":{"label":"Website manager"}},"isConfigComplete":true}`, survives whole-persona defaults at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:822` and `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:155`. Default Apply then throws on `goals.length` at `libs/backend/rpc-handlers/src/lib/harness/config/harness-prompt-builder.service.ts:83`. The preset is already written at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:495`.
- **User-visible effect**: A proposed custom skill is counted as configured but has no instructions; a proposed server or agent disappears from enabled counts; or Apply fails after writing a preset. Errors converted to warnings are also easy to miss: Apply returns warnings at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:601`, but the current builder discards that response at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:851` and displays only thrown errors. A valid custom-only fleet has an additional preview limitation: its badge is inside `agentCount() > 0` at `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts:75`, so custom subagents alone do not produce an Agents section.
- **Recommended fix**: Define shared nested schemas for `AgentOverride`, `HarnessSubagentDefinition`, `NewSkillDefinition`, and `McpServerEntry`, including transport configuration and install targets, and publish their input shapes in the tool schema. Keep partial authoring valid, but normalize persona properties individually and validate the assembled configuration before declaring readiness or beginning writes. Return field-specific repair instructions, display Apply warnings, and render custom subagents independently of built-in enabled-agent counts.

### F2 — Successful incremental proposals erase previous decisions or ignore the name

- **Severity**: high
- **Location**: `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts:311`, `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts:355`, `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:243`
- **What an agent would send**: Two successful calls, following the advertised instruction to send only changing fields:

  ```json
  {"configUpdates":{"name":"Website manager","mcp":{"servers":[{"name":"demo","url":"","enabled":true,"config":{"type":"stdio","command":"demo-server"}}]},"skills":{"selectedSkillRefs":[{"skillId":"review","source":"skills.sh","installSource":"owner/repo"}]}}}
  ```

  ```json
  {"configUpdates":{"mcp":{"enabledTools":{"demo":["read"]}},"skills":{"selectedSkills":["review"]}},"isConfigComplete":true}
  ```

- **What happens**: The MCP update replaces the entire previous `mcp` object at state-service line 355, dropping `servers`. Skill normalization emits both selected IDs and refs whenever either field is touched; the second call therefore emits `selectedSkillRefs: []`, which overwrites the saved origin at state-service line 340. The `applyConfigUpdates` method never assigns `updates.name` at all. In-memory execution of the real schema and merge method confirmed all three results: the name is absent, only `enabledTools` remains under MCP, and `review` remains selected with an empty refs array. Apply defaults missing servers to `[]` at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:838`; the skill installer returns without installation when refs contain no marketplace entries at `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:65`. The proposed name falls back to the workspace name at view-component line 818.
- **User-visible effect**: The final preview can still count a marketplace skill as selected although it will never be installed on a machine where it is absent. The previously accepted server vanishes. The saved harness uses the workspace name instead of the user's chosen name. There is no rejected call to alert the agent to any of these losses.
- **Recommended fix**: Specify and implement patch semantics consistently: preserve omitted sibling properties, apply supported scalar fields such as `name`, and normalize the merged skill selection without clearing origin metadata merely because an ID list was supplied. Make explicit removal distinguishable from omission. Return the resulting configuration or an acknowledged revision/diff so the agent can verify what the surface actually retained; pin the two-call cases above as regression checks.

### F3 — Correctly shaped guidance and tool-selection maps have no Apply effect

- **Severity**: high
- **Location**: `libs/backend/rpc-handlers/src/lib/harness/config/harness-prompt-builder.service.ts:136`, `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:547`
- **What an agent would send**: On an otherwise valid harness, with `demo` already configured:

  ```json
  {"configUpdates":{"prompt":{"enhancedSections":{"Safety":"Never delete production data."}},"claudeMd":{"customSections":{"Review policy":"Require review before deployment."}},"mcp":{"enabledTools":{"demo":["read"]}}},"isConfigComplete":true}
  ```

- **What happens**: All three maps validate and survive normalization at `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:177`, `:181`, and `:186`; they can be saved in the preset. Independently of F2's MCP merge defect, they do not reach the effective outputs. The document writer at config-store line 77 selects either `previewContent` verbatim or `buildClaudeMdContent`. That builder emits `prompt.systemPrompt` at prompt-builder line 136 and returns at line 152 without using enhanced sections or custom sections; its parameter type explicitly omits `claudeMd` at line 68. A pure-method probe confirmed neither supplied section appears. MCP Apply passes only `config.mcp.servers` at handler line 547; the installer forwards each transport config and targets at `libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts:98`, with no `enabledTools` input.
- **User-visible effect**: User-approved instructions remain in preset JSON but are absent from generated project guidance. The proposed tool list does not restrict the installed MCP server's exposed tools through this Apply path. The prompt preview only reads `systemPrompt` at `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts:244`, so it does not reveal the lost sections either. This finding concerns materialization, not the already-fixed shapes of these fields.
- **Recommended fix**: Implement and document how enhanced sections and custom sections compose into the effective guidance, including precedence when `previewContent` is present. Connect tool selections to a supported runtime/target filtering mechanism, or reject that unsupported control with an explicit explanation. The preview should show the effective output that Apply will produce, including any fields that cannot be honored.

### F4 — Rejection leaves no reconciliation state, and readiness trusts only the agent

- **Severity**: high
- **Location**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:941`, `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:118`, `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:335`
- **What an agent would send**: After an earlier valid persona update, send these calls in order:

  ```json
  {"configUpdates":{"skills":{"selectedSkills":"review"},"prompt":{"systemPrompt":"Require review before deployment."}}}
  ```

  ```json
  {"configUpdates":{},"isConfigComplete":true}
  ```

- **What happens**: The first call is atomically rejected: `skills.selectedSkills` expects an array. The valid sibling `prompt.systemPrompt` is also unrecorded because the throw at namespace-builder line 946 precedes the broadcast at line 949. The preview keeps exactly its prior configuration; there is no proposal-failure event, pending-decisions ledger, or returned accepted snapshot in this path. The error identifies the invalid field, but does not enumerate valid sibling decisions that were not recorded. The empty second call parses, broadcasts completion, and returns “Configuration marked complete” at line 960. The message handler sets completion on a truthy flag at line 123; it does not inspect content, and a later `false` proposal does not clear a previously true flag.

  The ready banner checks only `state.isConfigComplete()` and `!isProcessing()` at view-component line 335. Its button checks only `isApplying()` at line 350. The separate side-panel Apply button is weaker still: it requires merely one truthy config section (`hasAnyConfig`, line 626), and is disabled only during processing/applying at line 422. Backend Apply validates the workspace pin, then normalizes the config at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:488`; its parameter schema explicitly leaves the config unchecked at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts:57`. Defaults are not completeness checks.
- **User-visible effect**: The user can see “Configuration looks ready to apply” while both the selected skill and an approved prompt rule are absent. This is reachable for any field bundled into a rejected call, not just the incident's enabled-agent field. An earlier ready state can also survive a subsequent unsuccessful edit.
- **Recommended fix**: Maintain acknowledged draft state and unresolved failed proposals, and include rejected paths plus the unchanged revision/snapshot in error responses. Treat `isConfigComplete` as a request for completion validation: check the assembled content and unresolved proposal failures before granting readiness, and invalidate readiness when the draft changes. Put the authoritative validator before any writes in `harness:apply`, reuse it for the UI gate, and return a checklist of missing/invalid decisions. No validator can infer arbitrary user intent from content alone; preserving decision acknowledgements is necessary to catch a lost but otherwise optional field.

### F5 — Unknown keys are silently stripped despite an explicit rejection promise

- **Severity**: medium
- **Location**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1535`, `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:203`
- **What an agent would send**:

  ```json
  {"configUpdates":{"prompt":{"instructions":"Require review before deployment."}},"isConfigComplete":true}
  ```

- **What happens**: The MCP description says unknown keys are rejected and the error identifies their path. The actual top-level and nested `z.object(...).partial()` schemas are non-strict. The runtime probe returned success with `{"prompt":{}}`; a top-level `{"systemPrompt":"..."}` similarly became `{}`. Only the stripped result is broadcast at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:949`, followed by a success acknowledgement. The explicit legacy `skillRef.scope` stripping policy at schema line 17 is a different, documented compatibility case.
- **User-visible effect**: An ordinary authoring-name mistake loses the instruction without producing the promised repair error, and can still turn on the ready banner.
- **Recommended fix**: Reject unrecognized authoring keys at every relevant object boundary, and return their exact paths and supported alternatives. Keep any intentional legacy stripping exception explicit and narrow. Generate the published JSON schema from the same authoring contract so its additional-property policy agrees with runtime parsing.

### F6 — The other tools still advertise inputs that their handlers reject

- **Severity**: medium
- **Location**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1475`, `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:172`
- **What an agent would send**: To `ptah_harness_install_mcp_server`:

  ```json
  {"serverName":"demo","config":{"type":"stdio","command":"npx","args":["demo-server"],"env":{"PORT":3000}}}
  ```

  A second example is `{"serverName":"demo","config":{"type":"stdio","command":"demo-server"},"targets":[]}`.
- **What happens**: The advertised `config` is a bare object, so the first payload satisfies its JSON schema. The parsed discriminated union requires string-valued `env` and `headers`, and rejects `env.PORT` at namespace-builder line 860, with the error thrown at line 866. The target array has no advertised `minItems` at tool-description line 1486, but parsing requires `.nonempty()` at namespace-builder line 205 and rejects the second payload at line 886. Basic transport examples **are** in the MCP prose at tool-description line 1478; the claim is that its enforced constraints are incomplete, not that no transport guidance exists. Help only says “transport config” at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:100`, and the workflow prompt's tool list omits this method at `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts:46`.
- **User-visible effect**: The call fails before installation, requiring the agent to learn a contract from an error. Other smaller mismatches in the five-tool inventory below likewise reject JSON-schema-valid calls.
- **Recommended fix**: Publish the actual discriminated transport schema, string maps, URL requirements, nonempty command/server name, and target-array minimum. Derive it from shared validators and document sanitization rules. Align the smaller string constraints on create/search tools and remove contradictory installation guidance from the discovery tool.

#### Five-tool input-contract inventory

| Tool | Advertised versus parsed behavior |
| --- | --- |
| `ptah_harness_install_mcp_server` | F6 covers `config` and `targets`. `serverName` is a plain string at `tool-description.builder.ts:1470` but whitespace-only values fail at `harness-namespace.builder.ts:853`. Default key derivation is described as sanitized at tool-description line 1484; supplied keys are also sanitized, and an unusable/reserved `unnamed` result fails at namespace line 874. |
| `ptah_harness_create_skill` | `name`, `description`, and `content` are required strings without minimum lengths at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1334`; empty strings fail the dispatcher guard at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1424`. `{"name":"مهارة","description":"Review code","content":"Review changes"}` satisfies that schema but sanitizes to `unnamed` under the ASCII expression at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:343` and is rejected at line 573. Literal `name:"unnamed"` is also rejected. Kebab-case sanitization is advertised; the ASCII requirement and reserved result are not. `allowedTools` and `scope` shapes agree. |
| `ptah_harness_search_mcp_registry` | `query` is a required string without `minLength` at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1415`; `{"query":""}` fails at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1463`. Numeric limits are normalized at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:682`, not rejected for being fractional. |
| `ptah_harness_search_skills` | No material input-shape mismatch found: optional query and numeric limit/offset match the handler; paging values are clamped/truncated at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:413`. Separate prose drift: the MCP description tells the caller to shell-install at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1265`, while the workflow prompt expressly says not to at `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts:48`. This disagreement is established; it is not evidence that every such shell install necessarily loses data. |
| `ptah_harness_list_installed_mcp` | The empty input schema at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1443` matches the no-argument handler at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1496`. No unstated input shape found. |

#### Complete field walk and four-surface parity

The following locators identify the four authoring surfaces: **S** = `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts`; **D** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`; **H** = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`; **W** = `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts`. **T** = canonical `libs/shared/src/lib/types/rpc/rpc-harness.types.ts`. Line references in this inventory use those exact paths. D's actual `configUpdates` JSON schema remains a bare object at D:1541; its field guidance below is prose, not a machine-readable nested schema.

| Field(s), checked against canonical model | Boundary and downstream result | Remaining surface disagreement or silence |
| --- | --- | --- |
| `name` (T:22) | String, S:205. Accepted but ignored by frontend proposal merge: F2. | Named at D:1527; H:90 and W:54 do not specify it. |
| `persona.label`, `persona.description`, `persona.goals`, `persona.templateId` (T:34) | String/string/string-array/optional string, S:206; individual fields optional for updates. Canonical model requires the first three. Partial persona can fail Apply: F1. `templateId` has no separate promised Apply action. | D:1527 lists field names and `goals[]`; H is silent on persona shape, W:54 only names persona. No surface describes the hidden full-persona requirement before default document generation. |
| `agents.enabledAgents`, including `enabled`, `modelTier`, `autoApprove`, `customInstructions` (T:49) | Record values remain unknown, S:218; canonical values require boolean `enabled`, optional `opus/sonnet/haiku`, boolean approval, string instructions. Consumers assume override objects: F1. | D:1531, H:95, W:54 agree on the repaired basic object example. None defines the optional override properties/types; S does not validate them. |
| `agents.harnessSubagents`, including `id`, `name`, `description`, `role`, `tools`, `executionMode`, `triggers`, `instructions` (T:57) | Unknown entries, S:220, despite canonical strings, string arrays, and `background/on-demand/scheduled` mode. Real writer exists; malformed inputs fail or degrade: F1. | D:1528 only says `harnessSubagents[]`; H/W do not specify element shape. |
| `skills.selectedSkills` (T:96) | S:228 accepts string IDs or inline refs, then normalizes to IDs. Valid deliberate compatibility extension; subsequent normalization can lose origins: F2. Empty IDs are dropped by S:54. | D:1528 names the list without item schema; W:65 gives an ID example; H omits selection shape. Inline refs are accepted but not clearly advertised as a selectedSkills alternative. |
| `skills.selectedSkillRefs`, including `skillId`, `source`, `installSource` (T:123) | S:21 validates nonempty ID, optional enum source and optional string origin; S:48 infers canonical source. Explicit skills.sh refs missing origin cause an installer warning, while refs lost under F2 cause no install attempt. | D:1534 and W:65 explain refs/origin; H is silent. W:67 documents legacy `scope` stripping; D's blanket unknown-key rejection claim conflicts with actual stripping (F5). |
| `skills.createdSkills`, including `name`, `description`, `content`, `allowedTools` (T:133) | Unknown entries, S:232; canonical strings and optional string tool list are not enforced: F1. | D:1528 only names `createdSkills[]`; W:60 names the output path but not entry shape. H does not state the proposal shape, although it documents the separate createSkill arguments. |
| `prompt.systemPrompt` (T:142) | String, S:258; consumed in generated guidance unless a nonempty preview document takes precedence. | D:1529 names it; W:54 names system prompt without the nested shape; H's proposal section is silent. No new scalar type mismatch found. |
| `prompt.enhancedSections` (T:143) | String map/coercion, S:259. Shape repaired; effective output still absent: F3. | D:1533, H:97, W:54 agree on canonical map shape. Their “not lists” wording is narrower than the intentionally accepted list coercion; this is not another reported coercion defect. No surface explains the lack of materialization. |
| `mcp.servers`, including `name`, `url`, `description`, `enabled`, `config`, `serverKey`, `installTargets` (T:153) | Unknown entries, S:267; required entry fields and the transport/target types are unenforced: F1. Whole section replacement: F2. | D:1529 only says `servers[]`; H gives no proposal entry schema. W:70 provides a useful local/remote entry example, config requirement, and defaults, but no complete transport/target constraints. S does not encode those examples. |
| `mcp.enabledTools` (T:149) | Server-keyed string arrays/coercion, S:268; effective tool selection absent: F3. | Canonical shape agrees at D:1532, H:96, W:54. No surface states that Apply ignores the control. |
| `claudeMd.generateProjectClaudeMd` (T:180) | Boolean, S:276; gates writing at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:500`. | D:1530 names it; H/W do not define this flag or its default. Normalization defaults it to true at `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:184`. |
| `claudeMd.customSections` (T:181) | String map/coercion, S:277; materialization absent: F3. | Canonical shape agrees at D:1533, H:98, W:54; lack of Apply effect is unstated. |
| `claudeMd.previewContent` (T:182) | String, S:281; nonempty content overrides generated guidance at `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:77`. | D:1530 names it without explaining precedence; H/W omit its shape and precedence. An agent updating `systemPrompt` after supplying previewContent must regenerate the preview to affect the written document; no surface states this obligation. |
| `createdAt`, `updatedAt` (T:29) | Strings, S:284. Accepted by boundary, ignored by proposal merge. Apply supplies a creation time when absent and always refreshes update time at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:847`. | All three prose surfaces omit them; D:1544 even says only listed fields are accepted. Treat as server-owned metadata explicitly instead of advertising an unqualified Partial HarnessConfig. |
| `isConfigComplete` (tool envelope, not HarnessConfig) | Boolean advertised at D:1546; passed to proposal broadcast without content validation: F4. | D:1526, H:92, W:54 all ask the agent to assert completion. None defines a content checklist or recovery after a failed partial update. |

Further parity detail: W:48 omits the supported `searchSkills` offset argument, while H:56 and the MCP tool expose paging. This is discoverability drift, not an additional hard-failure/loss finding. The direct MCP install tool rejects `targets:[]`, while proposed server entries with `installTargets:[]` fall back to defaults at `libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts:92`; the two installation surfaces should state or unify that distinction.

## Non-findings

- The four reported list-to-record coercions and their shape hints are present at `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:126` and `:175`; this audit does not re-report them.
- Skill selection normalization correctly infers source, deduplicates IDs/refs, and promotes ref-only selections at `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:40`; F2 concerns later partial updates, not initial normalization.
- Rejected proposals are atomic, not partially committed: the broadcast follows successful parsing at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:941`; the missing recovery/readiness contract is F4.
- Subagents and created skills have real Apply-time writers at `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:518` and `:573`; their problem is the accepted input contract, not absent writers.
- Enabled MCP entries without transport config and explicit marketplace refs without installSource produce backend warnings at `libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts:74` and `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:80`; F1 identifies why those warnings are not shown by this builder.
- Plain systemPrompt, document-generation enablement, and previewContent have actual consumers at `libs/backend/rpc-handlers/src/lib/harness/config/harness-prompt-builder.service.ts:136`, `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:500`, and `libs/backend/rpc-handlers/src/lib/harness/config/harness-config-store.service.ts:77`.
- The installed-MCP discovery scope is explicitly limited to `.vscode/mcp.json` and `.mcp.json` at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1440`; not listing every possible CLI file is not an unstated input contract.

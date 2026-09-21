# Deferred findings

The codex audit (`agent-output-root.md`) found six defects. Three are fixed in
this task. The rest are real, are evidenced at `file:line`, and are deferred
because each needs a product decision rather than a repair.

## Fixed here

- **F1 (part)** — list ELEMENTS are now validated: `harnessSubagents`,
  `createdSkills`, `mcp.servers` and the VALUES of `enabledAgents`. A subagent
  with `tools: 'Read,Glob'` no longer reaches
  `harness-prompt-builder.service.ts:119` and throws `.join is not a function`.
- **F2** — `name`, `mcp.servers` and `selectedSkillRefs` are no longer erased by
  a later partial proposal.
- **F5** — unknown keys are reported instead of stripped, which is what the
  MCP tool description has always promised.
- **F6 (part)** — `ptah_harness_install_mcp_server` now advertises the string-map
  constraint on `env` / `headers` and the non-empty `targets` rule.

## Deferred

### F3 — accepted fields that Apply never materializes

`prompt.enhancedSections` and `claudeMd.customSections` validate, normalize,
store and save into the preset, and `buildClaudeMdContent`
(`harness-prompt-builder.service.ts:67-153`) never reads either. Its parameter
type is `Omit<HarnessConfig, 'claudeMd' | …>`, so `customSections` is not even
reachable from it. `mcp.enabledTools` has the same shape of problem: Apply
passes only `config.mcp.servers` to the installer
(`harness-rpc.handlers.ts:547`), so the proposed tool list restricts nothing.

The user approves guidance that is then absent from the generated file.

**Why deferred**: the fix needs a decision on precedence. `claudeMd.previewContent`
already overrides the generated document when non-empty, so "compose the
sections in" has three plausible orderings and only the product owner can pick
one. For `enabledTools` the honest options are to implement per-server tool
filtering or to reject the field as unsupported — both are larger than a repair.

### F4 — readiness is an agent assertion, not a content check

`isConfigComplete: true` is passed straight through
(`harness-namespace.builder.ts`), the message handler sets the flag on
truthiness alone, and the ready banner checks only `state.isConfigComplete()`
(`harness-builder-view.component.ts:335`). An empty `{}` proposal with the flag
set turns the banner on. A previously-true flag also survives a later failed
proposal.

There is also no reconciliation state after a rejection: a call is atomic, so
valid siblings bundled with one invalid field are discarded with it, and nothing
tells the agent which of its decisions the surface did not keep. That is the
mechanism behind the original incident, and element validation narrows it
without closing it.

**Why deferred**: the fix is a design — an acknowledged-draft model with a
returned snapshot or revision, plus one authoritative validator shared by the UI
gate and `harness:apply`. It is the right next task, not an addendum to this one.

### F1 (remainder) — Apply warnings are discarded by the builder

`harness:apply` returns `warnings` (`harness-rpc.handlers.ts:601`) and the view
discards the response (`harness-builder-view.component.ts:851`), so a skipped
server or an uninstallable skill is invisible. Small fix, but it belongs with
F4's "show the user what actually happened" work rather than on its own.

Related: the preview's Agents section is nested inside `agentCount() > 0`
(`harness-config-preview.component.ts:75`), so a harness whose fleet is entirely
custom subagents renders no Agents section at all.

# TASK_2026_270 — Implementation report (2026-08-17)

Branch `ak/tui-defects`. Commits: `9334758c5`, `ef163737b`, `dccd35b38`, `0f6c50ee7`.

## What shipped

**Batch 1 — StackProfile registry.** `libs/shared/src/lib/constants/stack-profiles.ts`
binds detection signals, intake vocabulary, toolchain probe, scaffold commands and
initializer skills per platform (`node-ts`, `dotnet`, `python`). Four detectors now
read from it. Fixed two live bugs: `Languages: (none detected)` on C# repos, and a
`.sln`-only workspace reading as EMPTY.

**Batch 1b — C# AST.** Grammar was already in `@vscode/tree-sitter-wasm`. Queries
written against a dumped parse tree; `using_directive` needs a `!name` negation or
every aliased using reports its alias as a phantom import. Partial classes stay as
N entries (the symbol sink keys by file path). 14-test real-grammar integration spec.

**Batch 2 — External marketplaces.** `libs/backend/plugin-marketplace`: install from
any GitHub repo publishing `.claude-plugin/marketplace.json`, behind a two-call
consent protocol. First call writes nothing and returns a plan; the token is bound to
the resolved version + per-file hashes; only a second call carrying that token writes.
`KNOWN_PLUGIN_IDS` consults the consent record, never `fs.existsSync`.

**Batch 3 — `ptah-dotnet`.** Three skills (initializer, solution architect,
nx-dotnet-workspace) that own discovery, domain modelling and the Nx decision, and
hand execution to Microsoft's `dotnet/skills` plugins by name.

**Batch 4 — Intake + routing.** Platform question before stack; both hardcoded label
mirrors deleted; `requiredPlugins`/`skills` come from the profile. `platform` is
OMITTED when `node-ts` so pre-existing payloads stay byte-identical.

**Batch 5 — E2E.** `new-project-dotnet.spec.ts` (5), `external-marketplace.spec.ts`
(7), one real-RPC C# AST test, `verify-packed-wasm.js` extended.

## Review outcomes

Logic review confirmed the consent boundary holds on all five sub-questions,
including that `pluginPaths` never reaches the SDK's native plugin option — so an
external plugin's MCP server cannot be spun up even with consent. Two findings fixed:
orphaned partial install (now unwinds), redirect host-pinning (now GitHub-only).

Style review caught a real build break: `ptah-tui` was left unresolvable while the
same commit fixed the other two hosts. Root cause was `plugin-marketplace` shipping
with no `package.json` at all.

## Verification

Unit: shared 806, harness-builder 101, rpc-handlers 2211, agent-sdk 938,
workspace-intelligence 865, plugin-marketplace 100, marketplace 77. Typecheck/lint 0
errors. All four hosts build.
E2E: full Electron suite **156 passed, 13 skipped, 0 failed**. TASK_2026_263's six
tests pass UNEDITED — the regression bar.

## Known gaps (each deliberate)

1. `verify-packed-wasm.js`'s C# entry is unverified against a real packaged asar
   (needs the electron-builder `package` target).
2. `ptah-cli`/`ptah-tui` AST is broken for ALL five grammars — `copy-wasm` never runs
   for them and their npm `files` omits `wasm/`. Pre-existing; needs its own carrier
   and a ~7.4 MB package-size decision.
3. `IProcessRunner` port not added. Style review argued against it (zero
   implementation variance across hosts) and proposed a concrete `spawnAndCapture`
   utility in `platform-core` instead, collapsing ~150 duplicated lines.
4. `external-marketplaces.component.ts` is 961 lines running five state machines —
   extract an injectable store before the next feature lands there.
5. `PluginRpcHandlers` is at 8 constructor params, the stated smell threshold.
6. Python profile names two skills that do not exist yet; `requiredPlugins` is empty
   so nothing routes to them.

# Batch breakdown — TASK_2026_199

## Batch 1 — single source of truth for spawnable CLIs (Defect 1)

- [x] Add `SYSTEM_CLI_TYPES` + `SystemCliType` to
      `libs/shared/src/lib/types/agent-process.types.ts`; derive `CliType` from it.
- [x] `tool-description.builder.ts` — `enum: [...SYSTEM_CLI_TYPES]`, and rewrite
      the `cli` param description to name the full set plus the
      "only installed CLIs will succeed" caveat.
- [x] `agent-tool.dispatcher.ts` — `z.enum(SYSTEM_CLI_TYPES)`; drop the now-dead
      `as CliType | undefined` cast and the `CliType` import.
- [x] `agent-process-manager.service.ts:getPreferredCli` — `new Set(SYSTEM_CLI_TYPES)`.
- [x] Repo-wide audit of `'codex'`/`'copilot'`/`'cursor'` triples; classify each
      as intentional vs stale (report).

## Batch 2 — stream-json adapter (Defect 2)

- [x] Capture real `agy --output-format stream-json` output; write the observed
      schema to `stream-json-capture.md`.
- [x] `runSdk` — add `--output-format stream-json`; map `reasoningEffort` to
      `--effort` (allowlist `low|medium|high`).
- [x] Replace the heuristic `handleLine` with a JSONL event loop
      (`init` / `step_update` / `result`); keep verbatim text only as the
      non-JSON fallback; delete `NARRATION_PREFIX`.
- [x] Take the session id from the `init` event; delete `resolveSessionId` and
      its `readdirSync`/`statSync` imports.
- [x] Raise `LINE_BUF_CAP` 64 KB → 1 MB (a stream-json line carries a whole
      tool output).
- [x] Rewrite the file header doc block.
- [x] Wire `resolveReasoningEffort` for antigravity so `--effort` has a caller.

## Batch 3 — tests

- [x] New `agent-tool.dispatcher.spec.ts` — every `SYSTEM_CLI_TYPES` member
      validates, `antigravity` explicitly, unknown CLI and `ptah-cli` rejected.
- [x] `agent-process-manager.service.spec.ts` — `getPreferredCli` honours
      antigravity/opencode/pi; still skips a disabled preferred CLI.
- [x] `antigravity-cli.adapter.spec.ts` — stream-json fixtures copied from the
      real capture (tool ACTIVE/DONE, incremental `text_delta`, structural
      steps, SUCCESS/non-SUCCESS `result`), malformed-line fallback, unknown
      event, `--effort` on/off, session-id capture.

## Batch 4 — Tribunal panel lanes (follow-up on the Batch 1 audit finding)

- [x] Add antigravity/opencode/pi to `CLI_FAMILIES` in
      `tribunal-discovery.service.ts`, with a comment tying it to
      `TribunalRunService.spawnArgsFor`.
- [x] Add a second model source: `cliModelKey` routes to `agent:listCliModels`
      (the three new CLIs own their catalogs; `provider:listModels` has no
      entry for them).
- [x] Narrow `listModelsFor` to `TribunalModelOption` (`id` + `name`) so
      `CliModelOption` needs no fabricated `contextLength`/`supportsToolUse`;
      update `step-panel-preview.component.ts` to match.
- [x] Discovery spec: lanes emitted, availability, model source, RPC slice,
      RPC failure.

## Batch 5 — model-identity prompt (Defect 3)

- [x] `buildModelIdentityPrompt(providerId, resolvedModel)` — drop the
      `OPUS || SONNET || HAIKU` fallback and the `AuthEnv` parameter.
- [x] `AssembleSystemPromptInput.authEnv` → required `resolvedModel` (the field
      had no other consumer; required so the compiler forces every call site).
- [x] Thread `build()`'s `model` local through `buildSystemPrompt`.
- [x] Delete `SdkQueryRunner.buildOneShotIdentityPrompt`; call the shared
      builder, resolving the model against `input.auth?.env`.
- [x] Omit the block for unresolved ids (`default`, bare tier names) instead of
      asserting them — `UNRESOLVED_MODEL_IDS` derived from `TIER_ENV_VAR_MAP`.
- [x] `model-identity-prompt.spec.ts` — per-tier assertions on Moonshot's
      distinct mappings, omission cases, and an end-to-end `build()` check that
      the block matches `options.model`.
- [x] Teach the `sdk-query-runner` harness's `resolveModelId` stub the tier
      remap so its override-identity test still expresses its intent.

## Batch 6 — `disabledClis` semantics (Defect 4)

- [x] Decide: **(a) hard disable** — three code paths already implement it, and
      `providers/ollama.md` leans on it for a privacy guarantee.
- [x] `CliDetectionResult.disabled?: boolean` in `libs/shared`.
- [x] `agent-namespace.builder.ts` `list()` marks instead of drops.
- [x] `formatAgentList` renders `disabled (installed)` / `disabled`.
- [x] Fix `chat/autopilot.md` and `providers/ptah-cli.md`; verify
      `providers/codex.md` + `providers/ollama.md` need no change.
- [x] Tests: list marks disabled, ptah-cli ids stay unmarked, formatter output.

## Batch 7 — Codex 0.133.0 environment note (report only)

- [x] Reproduce; establish it is NOT a total startup failure (`-m gpt-5.5`
      succeeds, exit 0).
- [x] Identify the real blocker (400 on the default `gpt-5.6-luna`) and confirm
      `max` originates in the server's model list, not in anything Ptah sends.
- [x] Check pins: `@openai/codex-sdk ^0.133.0` (latest 0.147.0); `@openai/codex`
      is transitive and version-locked to the SDK.
- [x] Confirm `codex-cli.adapter.ts` surfaces the failure as an error segment,
      not a hang.

## Batch 8 — build repair + Codex SDK bump

- [x] Full `nx run-many -t typecheck --all` — found a FOURTH
      `assembleSystemPrompt` call site the grep missed:
      `ptah-cli-spawn-options.service.ts:86`, the ptah-cli spawn path that the
      original Defect 3 repro actually used. Threaded `resolvedModel` from
      `ptah-cli-registry.ts:545-553`, where `modelTier` is resolved.
- [x] `apps/ptah-tui/tsconfig.build.json` — add the missing
      `@ptah-extension/output-styles` path alias (pre-existing build break from
      TASK_2026_197; `apps/ptah-cli` already had it).
- [x] `npm install @openai/codex-sdk@0.147.0`; align the three workspace
      manifests that still pinned `^0.133.0` (Nx's pruned-lockfile step fails
      otherwise).
- [x] Verify the bump fixes it: default model runs, exit 0, zero ERROR lines,
      `max` enum failure gone. No change needed in `codex-cli.adapter.ts`.

## Batch 9 — verification

- [x] `nx lint` for the three touched libs.
- [x] Unit tests for the three touched libs.
- [x] Confirm `resolveDirectSpawn` handles a real `.exe` on Windows (report).

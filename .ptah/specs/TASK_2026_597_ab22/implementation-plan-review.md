# Review - implementation-plan.md (TASK_2026_597_ab22)

| Field             | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Artifact          | `implementation-plan.md`                                                                                               |
| Author            | software-architect subagent                                                                                            |
| Reviewer          | independent document reviewer (Claude subagent, same-side; reason: the user disabled CLI lanes for this task)          |
| Artifact revision | 2                                                                                                                      |
| Round             | 2                                                                                                                      |
| Base              | HEAD `4e246388a` (revision 1 was written on `4ad10d856`; round 1 added a rebase-impact section)                        |
| Verdict           | **APPROVED** (round 1: REVISE, F1-F19. Round 2: all 19 resolved; 3 new Minor notes, N-A to N-C, go to the team-leader) |

Revision 2 resolves every round-1 finding, including the three rebase items (F17-F18 Serious, F19 Minor).

- **S1a split:** S1a now ships on its own on the existing Codex SDK path. It feeds the builder's `string[]` into the
  SDK's real `configOverrides` option (`index.d.ts:234`; emitted as raw `--config` at `index.js:183-185`) and creates
  one `Codex` instance per turn. It keeps today's role resend.
- **Rebase citations:** re-checked on HEAD, and all hold:
  - routing-form reads `:124-127`, `:147-150`, `:173-175`;
  - validate-before-write `agent-rpc.handlers.ts:282-295`, generic catch `:394-406`;
  - `ConfigManager` routing `config-manager.ts:91-117`;
  - Jest `vscode` mapping `cli-agent-runtime/jest.config.ts:18`, `agent-sdk/jest.config.ts:17`;
  - `RPC_METHOD_ENTRIES` `rpc.types.ts:3665`;
  - the `orchestration-settings` deferred matrix block `:44-49`;
  - `EFFORT_LABELS` `cli-model-effort-popover.component.ts:19-21`;
  - the vendor layout depth (`relsFromPkg` `:258-260`; package root is 4 levels up).

The three new items are Minor and local to single batches. None blocks Gate 2.

## 1. Round-1 findings: status

| #   | Sev.    | Finding (round 1)                                                             | Status       | Evidence in revision 2                                                                                                                                                                                                                                                                                    |
| --- | ------- | ----------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Serious | Capture script cannot load (`vscode` reached through the harness-sync barrel) | **Resolved** | Component 10: opt-in Jest entries under the lib configs that map `vscode` to the mock (verified). `describe.skip` unless `PTAH_LANE_CAPTURE_DIR` is set; launched by `scripts/lane-capture.mjs` through `nx test`.                                                                                        |
| F2  | Serious | Version read from the wrong binary; no no-binary path                         | **Resolved** | 3a `resolveCodexNativeBinaryInfo()` reads the platform package `package.json`, with a cached probe as fallback. `detect()` is not used. D2: S1a keeps the SDK `findCodexPath` fallback; S1b fails with a named message.                                                                                   |
| F3  | Serious | AS6 shipped in S1 with no fallback                                            | **Resolved** | `CODEX_RESUME_RESENDS_ROLE = true` in S1a, which is today's behaviour. Omission is an S5 switch gated on the S2 offline `--resumed` report plus C2. R3.5's cost record is in the resume-site comment.                                                                                                     |
| F4  | Serious | Runner in the urgent slice                                                    | **Resolved** | S1a (1, 3a, 4, 5, 6) runs on the SDK path; S1b (2, 3b) can be reverted alone. Verified: SDK raw overrides exist and are emitted unchanged.                                                                                                                                                                |
| F5  | Serious | No L inputs for Claude-side and Ollama runs; U1 order                         | **Resolved** | An agent-sdk capture entry writes `options.json` for three routes. U1 runs on `4e246388a` with the entry from the S2 commit, and its baseline is recorded before the PR merges (:1400-1403).                                                                                                              |
| F6  | Serious | R3.4 partly covered                                                           | **Resolved** | Component 5 table, item by item. Codex skill and agent blocks are absent. Guidance is reduced. Preambles are dropped on restored-context resume. The Ptah-CLI skill listing and agent-listing delta are kept, with measured counts and a stated reason, which is the justification route round 1 offered. |
| F7  | Serious | No write path for `compaction.*`                                              | **Resolved** | Component 6b: the keys become file-based, with a one-shot migration and `compaction:getConfig` / `compaction:setConfig` validated before any write. Host reads go through `ConfigManager` → file store. AS14 verifies each host's key set first.                                                          |
| F8  | Minor   | R4.5 "user set"                                                               | **Resolved** | Per-key checkbox, unticked by default; only ticked keys are written. Quoted key forms are normalised.                                                                                                                                                                                                     |
| F9  | Minor   | R5.3 / R5.1 wording                                                           | **Resolved** | "Spawn fresh" is delegated to the parent model. The 88/88 re-run is in S5.                                                                                                                                                                                                                                |
| F10 | Minor   | Default model rejected                                                        | **Resolved** | 3a error segment names `agentOrchestration.codexModel`; no retry with another model.                                                                                                                                                                                                                      |
| F11 | Minor   | Parallel wording                                                              | **Resolved** | Handoff: only new files are parallel; shared files are serialised.                                                                                                                                                                                                                                        |
| F12 | Minor   | Retry definition                                                              | **Resolved** | AS15 pattern, with a captured no-model-call fixture. The `Lane policy` line is re-emitted with `prefixKeys: 'dropped (config rejected)'`. Also applies to the SDK error text in S1a.                                                                                                                      |
| F13 | Minor   | D9 vs the NFR                                                                 | **Resolved** | Marked as a Gate 2 question for the user (D9).                                                                                                                                                                                                                                                            |
| F14 | Minor   | Translator change unverified live                                             | **Resolved** | Pinning spec required; the QA notes list it as unverified against the backend.                                                                                                                                                                                                                            |
| F15 | Minor   | Citations and counts                                                          | **Resolved** | `index.js:254-255`; node_modules noted; project count updated.                                                                                                                                                                                                                                            |
| F16 | Minor   | harness-sync barrel over 150 lines                                            | **Resolved** | Deep-import entry `@ptah-extension/harness-sync/codex-config` plus a `tsconfig.base.json` path; `index.ts` untouched.                                                                                                                                                                                     |
| F17 | Serious | Rebase: key form; spec pins the old precedence; catch masking                 | **Resolved** | Routed key form for all reads. The `settings-routing.spec.ts` case at `:111` is rewritten to the R2.3 order and added to the MODIFY list. Validation sits inside `:282-295`, before the catch, with a spec case for the message. D3 evidence note added.                                                  |
| F18 | Serious | Rebase: component 7 targeted a deleted component                              | **Resolved** | Re-anchored on `orchestration-settings`, `cli-model-effort-popover`, `cli-matrix-rows`, `providers-commit.service.ts`, `providers-settings.types.ts`, plus the e2e matrix scenarios. Citations verified.                                                                                                  |
| F19 | Minor   | Rebase: redact secrets in runner logs                                         | **Resolved** | Runner bad-line log and stderr go through `redactSecrets`; spec with a fake key.                                                                                                                                                                                                                          |

## 2. New defects introduced by revision 2 (all Minor)

1. **N-A - On the S1a SDK path, some keys are emitted twice and the SDK's copy wins.**
   - The SDK emits raw `configOverrides` first (`index.js:183-185`). Then it appends `--config` args built from the
     thread options (`:218`, `:227-234`).
   - 3a leaves today's thread options in place (`codex-cli.adapter.ts:650-668`): `webSearchEnabled: true`,
     `approvalPolicy`, `modelReasoningEffort`. Each later `-c` overrides the builder's `web_search`, `approval_policy`
     and `model_reasoning_effort`.
   - Effect: `codexWebSearch = false` is silently ignored in S1a (R4.4). Effort comes from two sources.
   - Fix in the 3a batch: on the SDK path, keep only `model`, `sandboxMode`, `workingDirectory` and
     `skipGitRepoCheck` as thread options. Leave `web_search`, `approval_policy` and `model_reasoning_effort` to the
     builder alone, or set `webSearchMode` from the setting. Pin it with an adapter spec on the argv the SDK double
     receives.
   - The impact window is S1a-only, because S1b's runner takes its args from the builder alone.
2. **N-B - The plan contradicts itself on the S1b dependency.**
   - Header :10 says "S1b ... is independent of S1a".
   - Sequencing :1376 says S1b depends on S1a (component 1 output format, adapter seam).
   - Sequencing is correct; fix the header line.
3. **N-C - The cli-agent-runtime capture entry can't run in parallel with S1a, as S2 claims.**
   - S2 is "parallel with S1a and S1b", but `lane-capture.capture.spec.ts` calls components 1 and 5 (S1a) and 11 (S3).
   - The team-leader should place that entry after S1a. The OpenCode part should be extended in S3, the same way the
     plan already extends the agent-sdk entry.
   - The M tool and the AS6 `--resumed` report have no such dependency.

## 3. S1a ships alone on the existing SDK path: check

| Check                                  | Result                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No dependency on S1b-S5                | OK. S1a = 1, 3a, 4 (minus R9.5), 5, 6 (Codex budget keys + `inherit`). Depends on nothing (:1375).                                                                                       |
| Uses only existing SDK surface         | OK. `CodexOptions.configOverrides` (`index.d.ts:234`), `resumeThread`, `codexPathOverride`. Per-turn instances add no process, because the SDK already spawns one `codex exec` per turn. |
| E2- and L-dependent switches held back | OK. A1 defaults are `null`. Role omission, `agents.max_depth`, `enabled_tools`, `prune` and the R4.2 text are all in S5. The early assumptions fail safe (AS1, AS4, AS9; :1388-1392).    |
| Failure paths                          | OK. Version warning from the binary actually run; config-rejection retry on SDK error text; F10 message; the no-binary case keeps today's SDK fallback.                                  |
| Defect                                 | N-A (duplicate keys between the SDK thread options and the builder).                                                                                                                     |

## 4. Verdict

**APPROVED** for Gate 2. Carry N-A into the component 3a batch, where it must be fixed. Carry N-B and N-C as
team-leader notes. The Gate 2 message should still put D9 (F13) to the user, as the plan states.

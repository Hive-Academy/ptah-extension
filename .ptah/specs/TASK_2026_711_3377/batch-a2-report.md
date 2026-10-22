# Batch A2 report

## Probe evidence

All prompts were exactly `Reply with only your lane policy id.`; the prompt did not contain `probe-canary-a2`. Probe processes had a 120-second hard limit. The disposable files were under `.ptah/lanes/probe-a2/` and were removed after probing.

| CLI | Command / input | Output excerpt | Verdict |
| --- | --- | --- | --- |
| OpenCode 2.0.12 | `OPENCODE_CONFIG_CONTENT={"instructions":["<absolute probe-a2/agent.md>"]} opencode run --format json "Reply with only your lane policy id."` (PowerShell `Start-Process`, `WaitForExit(120000)`) | Timed out; output contained `ptah-lane-policy-v1`, but no `probe-canary-a2`. | FAIL; keep task prompt. The test did not establish that the per-process v2 instruction file was ingested. |
| Antigravity 1.4.3 | `agy --agent <absolute probe-a2/agent.md> --print "Reply with only your lane policy id." --output-format json --print-timeout 30s` (`spawnSync`, timeout 120000) | `unknown agent "<absolute path>" (no custom agents are available)` | FAIL; `--agent` does not accept this path on this installation. Keep stream-JSON task text and capped `--print` fallback. |
| Copilot CLI 1.0.83 | `COPILOT_CUSTOM_INSTRUCTIONS_DIRS=<absolute probe-a2> copilot -p "Reply with only your lane policy id." --no-color --output-format json` (`spawnSync`, timeout 120000) | Initial probe with cwd inside `probe-a2` contained canary, which could be normal cwd `AGENTS.md` discovery. Corrected probe with workspace cwd exited 0 and had no canary. | FAIL; the env-only channel was not proved. Keep capped task prompt. [Official GitHub instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) document the environment variable, but the actual headless run is decisive here. |
| Pi | `Get-Command pi` | `MISSING` | UNVERIFIED. [Official CLI reference](https://pi.dev/docs/latest/cli) documents `--append-system-prompt <text\|path>` and file append semantics. Implemented the additive file channel with a task-text fallback if the store or agent id is absent. |
| Grok 1.0.62 | `grok agent --agent-profile <absolute probe-a2/grok-profile.md> --no-leader stdio`; ACP `initialize`, `session/new`, `session/prompt` with neutral prompt (`grok-probe.cjs`, 120-second timer) | Plain one-line profile failed `missing frontmatter delimiters`. A valid frontmatter profile created a session and completed the prompt (`stopReason: end_turn`) but did not output `probe-canary-a2`. | FAIL; default system prompt and Ptah MCP retention were also unproved. Keep ACP task text. |

The canary policy file `agent.md` contained only `Lane policy id: probe-canary-a2`. Grok also required a profile file with YAML frontmatter and the same canary line; its failed result did not justify enabling the profile path.

## Chosen channels as coded

| CLI | Chosen channel | Fallback and evidence |
| --- | --- | --- |
| Copilot | `task-prompt` (`copilot-sdk.adapter.ts:164,479`) | Capped argv through `buildArgvTaskPrompt`; whole command checked at `:369`. Env file channel disabled after failed corrected canary. |
| Antigravity | `task-prompt` (`antigravity-cli.adapter.ts:340,683`) | Stream-JSON stdin; capped argv `--print` path at `:690-701`. File channel disabled after path rejection. |
| OpenCode | `task-prompt` (`opencode-cli.adapter.ts:292,623`) | Capped argv and whole-command check at `:692`; existing MCP `OPENCODE_CONFIG_CONTENT` at `:666-673` remains. Instruction-file config disabled after timeout. |
| Pi | `system-prompt` when a store and agent id exist (`pi-cli.adapter.ts:187,322-341,396,543`) | `LaneInstructionFileStore.write(workingDirectory, agentId, 'pi-append-system.md', guidance + role + policy)` writes under `.ptah/lanes/<agentId>/`; the manager's A1 removal path owns cleanup. Without store/id, effective channel is `task-prompt` and the policy stays in RPC text. The file flag is reapplied on each Pi process, including continuation. |
| Grok | `task-prompt` (`grok-cli.adapter.ts:141,245-252`; `acp/acp-session-handle.ts:719-723`) | ACP prompt. `fullPromptPreambles` now records the delivered policy when ACP restores context (`acp-session-handle.ts:720`), preventing repeated task-text policy. |

`lane-channels.md` now records these static choices and probe outcomes.

## Tool-name hint and specs

`cli-adapter.utils.ts:421` tells lanes to search the tool list for `ptah_` and use the CLI's qualified MCP name. Policy size is 2,553 UTF-8 bytes, below 3,500. `TWO_WAY_MESSAGING_GUIDANCE` already names the server-prefix form and makes no messaging-mode promise. `lane-reporting-contract.ts:54` adds the same lookup hint for the completion tool.

Added or updated assertions in `cli-adapter.utils.spec.ts`, `copilot-sdk.adapter.spec.ts`, `antigravity-cli.adapter.spec.ts`, `opencode-cli.adapter.spec.ts`, `pi-cli.adapter.spec.ts`, and `grok-cli.adapter.spec.ts` for the policy canary, channel or delivery. Pi's new case checks the file argument, exactly one canary in the file content, role and guidance placement, and absence of the policy from RPC task text. A1 already covers instruction-store removal through manager paths; no new cleanup implementation was needed.

No Nx, Jest, TypeScript, lint, or build command was run, per the batch instruction. `ptah_get_diagnostics` was called twice after edits but its compiler backend returned `Unavailable` after 45 seconds both times; the changed source files parsed cleanly with `ptah_ast_analyze`. The orchestrator must run the scoped specs. Pi's live CLI behavior and Grok profile/MCP retention remain unverified.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Keep Copilot, Antigravity, OpenCode, and Grok on task prompts | Enable stronger file/profile channels or keep existing channels | Corrected canary failed for Copilot; Agy rejected absolute path; OpenCode timed out without canary; Grok completed without canary or MCP proof | Yes |
| Enable Pi's additive file channel despite no binary | Documented flag or task prompt only | Official Pi CLI reference explicitly supports existing file paths, while the binary is missing here; fallback is retained | Yes |
| Account for ACP restored-context policy | Repeat or omit a delivered policy block | `buildTaskPrompt` supports `ResumeDeliveredPreambles`; ACP runner knew restoration but did not pass that bookkeeping | Yes |

## Remaining limits

- The five adapter specs and ACP resume behavior were edited but not executed because the orchestrator owns the heavy test run.
- Pi cannot be canary-tested until its binary is installed. Grok profile retention of the default system prompt and Ptah MCP was not established, so the profile was not enabled.
- A live end-to-end manager cleanup assertion for Pi's new file path was not added in this batch; the existing A1 manager removal and instruction-store specs cover the shared path.

## Review revise round 1

| Finding | Fix | Regression spec |
| --- | --- | --- |
| 1. Pi follow-up loses the file | Keep the claimed directory through continuation and remove it on terminal release (`agent-process-manager.service.ts:2356`, `:2338`); rewrite the Pi file before every follow-up spawn, with RPC text fallback when writing fails (`pi-cli.adapter.ts:327`, `:558`). | `keeps a continuation policy file after turn settlement until subprocess release` (`agent-process-manager.service.spec.ts:3029`); `rewrites the policy file before each follow-up process and falls back to RPC text on write failure` (`pi-cli.adapter.spec.ts:426`). |
| 2. Codex chooses fallback too late | Preflight the resume argv before building the continuation prompt (`codex-cli.adapter.ts:854`). | `puts policy in continue text when the resume thread id makes developer argv too long` (`codex-cli.adapter.spec.ts:922`). |
| 3. Pi assumes a session restored text | Without a confirmed file channel, build the full resumed prompt (`pi-cli.adapter.ts:535`). | `includes the policy in a new resumed process when no instruction file proves delivery` (`pi-cli.adapter.spec.ts:451`). |
| 4. Cursor drops guidance and role on external resume | Send the full prefix for a new handle with no delivery record, then use recorded `ResumeDeliveredPreambles` for follow-ups on the captured agent (`cursor-cli.adapter.ts:332`, `:533`). | `sends policy, guidance and role on an external resume with no delivery record` (`cursor-cli.adapter.spec.ts:425`); existing continuation specs assert no duplicate policy. |
| 5. Failed delete loses its claim | Delete the claim only after filesystem deletion succeeds (`lane-instruction-file-store.ts:59`); release logs failure with the manager's injected Logger and permits a later terminal cleanup retry (`agent-process-manager.service.ts:2298`, `:2338`). | `retains its claim after delete fails so a terminal retry removes the directory` (`lane-instruction-file-store.spec.ts:33`). |

## Decisions

- Cursor external resumes receive the full prefix because a new handle cannot prove an earlier process delivered it. The alternatives were assuming delivery from a session id or resending; `buildTaskPrompt` explicitly treats an unknown resume as requiring the full prefix. This is reversible if persistent delivery bookkeeping is added.
- Pi's unverified `--session` restoration does not prove text delivery. The alternatives were omitting the text or resending it; the safe choice is resending when the file channel is unavailable. This is reversible if restoration can be verified.

Verification: five scoped Jest suites passed before the final release cleanup adjustment: `Tests:       346 passed, 346 total`. The changed manager suite passed after that adjustment: `Tests:       177 passed, 177 total`. Scoped `ptah_get_diagnostics` found 0 errors and 0 warnings after edits.

## Review revise round 2

| Finding | Fix | Regression spec |
| --- | --- | --- |
| 6. Pi loses the policy when both instruction writes fail | Use the selected file channel and this spawn's written path to choose RPC text fallback (`pi-cli.adapter.ts:569`). | `keeps the policy in follow-up RPC text when neither instruction write succeeds` (`pi-cli.adapter.spec.ts:451`). |
| 7. Codex repeats policy after argv fallback | Record policy delivery on the handle when a continuation prompt includes it (`codex-cli.adapter.ts:868`). | `puts policy in continue text once when the resume thread id makes developer argv too long` (`codex-cli.adapter.spec.ts:922`), now checking a later continuation. |

Verification: tests and diagnostics were not run in this lane because the orchestrator's scoped test run was in flight.

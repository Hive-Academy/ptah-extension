# Batch 1a ? evidence spike tooling

Implemented source-only tooling in the assigned worktree. No Codex executable was invoked, no authenticated app server was started, no model turns were used, and no schema or runtime evidence was fabricated. Production exports remain empty. Real execution remains subject to the scheduled safety review.

## Files created / modified

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/`:

- Created `libs/backend/codex-runtime/project.json`.
- Created `libs/backend/codex-runtime/package.json`.
- Created `libs/backend/codex-runtime/tsconfig.json`.
- Created `libs/backend/codex-runtime/tsconfig.lib.json`.
- Created `libs/backend/codex-runtime/tsconfig.spec.json`.
- Created `libs/backend/codex-runtime/jest.config.ts`.
- Created `libs/backend/codex-runtime/eslint.config.mjs`.
- Created `libs/backend/codex-runtime/src/index.ts`.
- Created `libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs`.
- Created `libs/backend/codex-runtime/tools/evidence-harness.ts`.
- Created `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`.
- Created `libs/backend/codex-runtime/tools/evidence-cases.json`.
- Modified `tsconfig.base.json`: added only the new package path alias.
- Created `.ptah/specs/TASK_2026_714_c8a2/batch-1a-report.md` (this deliverable).

The Nx project name is `@ptah-extension/codex-runtime`. Target/tag/TypeScript/Jest conventions come from `libs/backend/lane-outcomes/`; package metadata follows `libs/backend/auth-providers-tokens/package.json`. Strict typechecking includes tools. The native binary detector was read; its resolution code was not imported or copied.

## Tool behavior

The offline generator requires an explicit native executable, verifies `codex 0.155.1` / `codex-cli 0.155.1`, runs `app-server generate-json-schema --out <temporary-export>`, and exports the aggregate JSON schema plus manifest into `src/lib/protocol/`. It records binary/schema SHA-256, native path/version, platform/architecture, method-direction groups, command provenance and an artifact table. It never generates TypeScript. It requires the aggregate export to contain ClientRequest and all four method groups; unknown export formats stop without guessing. The subcommand is supported by `research-report.md:99`; its installed-binary behavior was not exercised.

The harness defaults to dry-run. An explicitly requested run creates an experiment workspace, sibling scratch directory and temporary CODEX_HOME initially containing only an auth.json copy. Child environments are constructed from an OS-variable allowlist; HOME/USERPROFILE/TMP variants also point into the experiment. No shared config.toml is read/copied/written and process.env is not mutated. CLI argv overrides configure a separate local stdio marker fixture for each child, enabled only for the MCP case. Each fixture accepts only two fixed marker slots, never arbitrary paths or network connections.

A single shared counter charges before every turn/start and conservatively before thread/compact/start, including failed sends. There are no automatic retries. Protocol requests have deadlines; JSONL envelopes and method names are validated with Zod, with a 1 MiB per-frame limit and a bounded event ledger. Approval requests remain pending for a 200 ms marker-absence observation. Command accept/deny requires the exact fixed marker command; file accepts require a matching file-change item; MCP requests require the fixed server/tool/slot. Unrecognized requests stop the case. Windows uses process-tree termination; POSIX uses a detached process group. Signal handling cancels active work and proceeds through teardown. Home/auth are always scheduled for deletion, including --keep; --keep retains only files outside CODEX_HOME. Cleanup failures are reported rather than hidden.

Results contain method-only event summaries, marker states, numeric token totals, selected effective-config fields and explicit capability gaps. Full prompts, wire parameters, model text, stderr and auth contents are excluded. JSON output replaces the --out .md suffix with .json; Markdown appends a case table. Both artifact paths are checked against the original credentials before experiment setup.

## Commands for the later reviewed run

Run from the worktree root. Replace the two explicit paths with the reviewed native executable and auth source; these are placeholders, not paths discovered by this batch. Do not use a .cmd/.js launcher.

```powershell
node libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs --binary 'C:/ABSOLUTE/PINNED/codex.exe'

npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --dry-run

npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --run --binary 'C:/ABSOLUTE/PINNED/codex.exe' --auth-source 'C:/ABSOLUTE/AUTH-SOURCE/auth.json' --model gpt-5.1-codex-mini --out 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/batch-1b-evidence.md'
```

The run checks the binary path, version pin, platform, architecture and both digests against the generated manifest. Before each case's model invocation it checks model/list and config/read. Model availability is checked on the first returned page only; absence refuses inference. The requested output allowance is 1,024 tokens; the harness refuses inference unless config/read exposes that value and the expected approval/sandbox settings. This is a prerequisite check, not a claim that the pinned binary supports that option.

## Planned cases and budget

| Case | Turn cost | Required observations / limits |
| --- | ---: | --- |
| schema-handshake | 0 | Method list, initialize/model/config preflights on children; user-input/plan/subagent/history schema presence |
| ask-command-accept | 1 | Command approval pending before effect; accept marker; usage events |
| ask-command-deny | 1 | Deny leaves original marker absent |
| modified-input-schema | 0 | Detect modifiedInput schema property; behavioral replacement explicitly unverified |
| file-change-accept | 1 | File approval pending before sibling-scratch marker creation |
| plan-read-only | 1 | Read fixture positively; workspace and sibling writes absent |
| auto-edit-boundary | 1 | Workspace write positive, sibling write denied |
| yolo-interrupt | 1 | Workspace and sibling writes; interrupt acknowledgement/terminal status |
| mcp-approval | 1 | Per-child local stdio marker: first accepted, second denied |
| compaction | 1 | Reserved model invocation on retained accepted-command child; completion event |
| **Total maximum** | **8** | One counter across all children; failures also consume claims |

Compaction runs immediately after the accepted-command turn while that child is alive. Its charge is moved to the compaction row in the final table. If an earlier gate fails or isolation is breached, remaining behavioral cases are marked not run; no replacement trials or retries are scheduled. Schema discovery does not certify behavior. The eight harness-capability table rows have explicit unverified status and matching schema-method candidates in JSON.

## Model recommendation and limits

Conditional candidate: `gpt-5.1-codex-mini`. The repository includes it in `libs/shared/src/lib/providers/entries/opencode-model-routes.ts:111`, and OpenAI publishes it as a cost-efficient Codex model: [official model page](https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini). This is evidence for a low-cost candidate, not evidence that this user's installed binary/account supports it or that it is the cheapest currently available subscription choice. That cannot be established without the prohibited authenticated model/list preflight. The later runner must compare available account models and pricing before using the example command; the harness rejects an unavailable selection rather than substituting a more expensive model.

## Unverified work / review blockers

- Generated schema/manifest files do not exist yet: the generator was intentionally not executed in this source-only batch.
- No real approval, sandbox, MCP, interrupt, usage, compaction or isolation behavior has been proven. This batch supplies tooling and fake-only safety tests.
- The exact modifiedInput response contract is not established in the research. The case is schema-only; no speculative modified-input response or behavioral replacement was implemented. A reviewed wire mapping and an explicitly rebalanced eight-turn plan are needed for behavioral proof.
- Native MCP approval method/parameter/decision shapes, file-change item ordering, command-string normalization and model_max_output_tokens readback require pinned-schema review. Unsupported shapes stop safely; they are not reported as parity. The exact output-budget option is a preflight blocker if absent.
- YOLO explicitly removes the native filesystem sandbox. Temporary paths and prompts do not provide OS containment or an egress firewall. The safety reviewer must resolve that before a real run. Windows descendant teardown also needs real observation; mocks do not prove OS behavior.
- Native plan entry/exit, user answers/cancellation, remembered permissions, subagent lifecycle, instructions/skills/images/effort/resume, remote MCP/OAuth/Smithery, concurrent same-home profiles, different-account isolation, rewind/history/stats and packaged binary digests remain explicit gaps.
- API model documentation does not prove account availability or cheapest subscription usage. No user config/auth contents were inspected to infer it.

## Verification

Scoped ptah diagnostics: clean for the harness and safety spec. `npx nx typecheck @ptah-extension/codex-runtime` ran once and passed (exit 0); Nx Cloud additionally reported the existing organization plan-disabled 401. The single permitted Jest run passed: 1 suite, 14 tests, exit 0 (5.178 seconds). Jest emitted a Node ESM-loader warning but completed successfully. A final auth/artifact-path collision guard was added after the Nx invocation and while Jest was in flight; final scoped ptah diagnostics on that source and the spec passed. The two commands were not rerun, so that final guard has compiler diagnostics but no separately executed regression test. No workspace-wide check, build, serve, e2e, native schema export or model execution was run. No git command was run.

## Decisions

1. **Extend the assigned new library scaffold, keep runtime exports empty.** Options: import agent-sdk tooling or accept the native executable explicitly. Chosen explicit path, per batch instruction and the detector's native-vs-shim distinction. Reversible in a later assigned binary-resolution batch.
2. **Reserve one of eight invocations for compaction.** Options: treat it as free or conservatively charge it. Chosen charged invocation because compaction may invoke the model (plan bounded-spike requirement). Reversible only when protocol evidence establishes safe accounting.
3. **Keep modifiedInput schema-only until its response contract is known.** Options: invent a response shape or expose an unverified gap. Chosen gap, following the plan's no-fabricated-parity gate and research's missing response contract. Reversible after schema review; no production capability was removed.
4. **Retain only non-home files with --keep.** Options: delete auth.json alone or the entire temporary CODEX_HOME. Chosen whole-home deletion because runtime refresh/session files can contain credentials or sensitive context. Reversible retention policy only after a specific safe artifact list is established.
5. **Stop remaining behavioral cases after a failed gate.** Options: continue collecting unrelated turns or stop. Chosen stop per the plan's isolation/unsupported-gate rule, with no automatic retry. Reversible through a reviewed future experiment plan.

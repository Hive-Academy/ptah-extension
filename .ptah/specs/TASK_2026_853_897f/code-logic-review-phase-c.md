# Code Logic Review — Phase C, TASK_2026_853_897f

Score: **8/10**  
Verdict: **APPROVED** for the scoped logic diff; the Phase C verification gate remains open.  
Review family: reviewer: codex; implementers: kimi-code (B13), claude (B15-16)

The score reflects a sound preservation change with direct source checks, above a 5–6 review with a concrete behavior gap. It stays below 9–10 because the Batch 13 verify run had not completed when reviewed. I ran no build, test, verify, Nx target, or diagnostics compiler: the request prohibited heavy commands while verification held the machine lock. Batch 15's recorded generation and manifest checks passed; its agent-generation lint, test, and typecheck passed. Batch 16's recorded agent-generation checks passed. The wider recorded runs have unrelated environment and pre-existing failures, so they are not a clean Phase C gate.

## Preserve list check

Paths in the table: `CORE` = `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`; `PARTIAL` = `libs/backend/agent-generation/templates/agents/_shared`; `PRESET` = `/home/amun/.local/share/claude/versions/2.1.312`. `PLAN` is `.ptah/specs/TASK_2026_853_897f/implementation-plan.md`. PRESET strings were independently searched in the installed executable; its internal line positions are an implementation detail, and preset-only rows should be rechecked if the bundled Claude runtime changes.

| Rule | Retained home file:line | OK/LOST |
| --- | --- | --- |
| R1 | CORE:94-103 | OK |
| R2 | PRESET:344705 | OK |
| R3 | CORE:206-210 | OK |
| R4 | PRESET:344695 | OK |
| R5 | PRESET:344695 | OK |
| R6 | PRESET:344705 | OK |
| R7 | PLAN:237 — intentional deletion of overlapping objectivity rule | OK, intentional deletion |
| R8 | PLAN:238 — intentional deletion of overlapping time-estimate rule | OK, intentional deletion |
| R9 | CORE:23-25; PARTIAL/tooling-precedence.md:3 | OK |
| R10 | CORE:27-46; PARTIAL/tooling-precedence.md:6-15 | OK |
| R11 | CORE:48-49; PARTIAL/tooling-precedence.md:4,17 | OK |
| R12 | CORE:51-52 | OK |
| R13 | CORE:54-60 | OK |
| R14 | CORE:43,62-63 | OK |
| R15 | CORE:31-46,34 (refactor prerequisite) | OK |
| R16 | CORE:65-67 | OK |
| R17 | CORE:68 | OK |
| R18 | CORE:69-70 | OK |
| R19 | CORE:40-41,71 | OK |
| R20 | CORE:48-49,182-200; PRESET:344695 | OK |
| R21 | CORE:109-111 | OK |
| R22 | CORE:83,113; PARTIAL/cli-delegation.md:1 | OK |
| R23 | CORE:82-86,115; PARTIAL/cli-delegation.md:1 | OK |
| R24 | CORE:117; PARTIAL/cli-delegation.md:1 | OK |
| R25 | CORE:119 | OK |
| R26 | CORE:121 | OK |
| R27 | CORE:125-140; PARTIAL/clarification-protocol.md:1-3 | OK |
| R28 | CORE:142-144; PRESET:344695 | OK |
| R29 | CORE:146-148 | OK |
| R30 | PRESET:344695 (boundary validation, simplicity, compatibility); PARTIAL/replacement-policy.md:1; inline roles at backend-developer.template.md:43, frontend-developer.template.md:44, software-architect.template.md:48, code-style-reviewer.template.md:41 | OK |
| R31 | CORE:206-210 | OK |
| R32 | CORE:150-200 | OK |
| R33 | CORE:202-204; PRESET:344734,345152 | OK |
| R34 | PRESET:345222 (PR format); CORE:204 (authorization) | OK |
| R35 | PRESET:338067 | OK |
| R36 | CORE:82-86,109-117 | OK |

The single full MCP substitution table is at CORE:29-46; the assembled core references that section once at CORE:107. The removed hardcoded `nx test`, `nx affected`, and commit-only-on-explicit-request text is absent from the core; verification and commit authorization defer to workspace instructions at CORE:68,204. The MCP server handshake file has no working-tree diff. A symbol index query returned zero indexed symbols, so I used one native `rg` fallback: no `PTAH_MCP_MANDATE_PROMPT` importer remains under `libs/` or `apps/`.

Independent static reconstruction of the two template interpolations gives `PTAH_CORE_SYSTEM_PROMPT.length = 12,570`, or `ceil(chars / 4) = 3,143` estimated tokens. The spec pin at `ptah-core-prompt.spec.ts:16` is 3,301, exactly `ceil(3,143 × 1.05)`. This is an estimated token budget, not a tokenizer measurement.

The four current inline hygiene blocks each have seven identical lines, from `- Engineering hygiene:` through `- Runtime cost:`. The guard at `template-sharing.guard.spec.ts:1167-1220` compares the other three against backend, rejects parsed `STATIC` references, and requires the removed ID and file to be absent. The manifest diff removes only that partial from its file list and updates hash/time; the recorded `manifest:generate` and `manifest:check` logs both exit 0 with the same hash. Batch 16's literal 13-name pin at `subagent-tool-allowlist.spec.ts:101-149` matches production names and order at `subagent-tool-allowlist.ts:30-57,69-74`; the other nine production rows remain as before.

## Logic defects

None found in the scoped diff. No blocking, serious, moderate, or minor defect has a concrete changed file:line. Verification is an outstanding gate, not a code defect.

## Style defects

None found in the scoped diff. The incidental formatting in the guard spec does not change behavior.

## Five logic questions

1. **How does this fail silently?** A lost preset-only rule would disappear without a compiler error. I checked the installed preset strings and every core/partial retained home listed above; none was lost. The prompt budget and table-count assertions at `ptah-core-prompt.spec.ts:15-24` catch growth or a second full table.
2. **What user action produces unexpected behaviour?** A user on an older Electron app downloading current templates could fail on a new `STATIC:ENGINEERING_HYGIENE` marker. The corpus contains no such marker, and the guard at `template-sharing.guard.spec.ts:1202-1212` rejects both tight and spaced marker forms.
3. **What input data produces a wrong answer?** A role name using the six restricted policies could receive a shortened deny list. The literal assertion at `subagent-tool-allowlist.spec.ts:134-149` compares all 13 ordered names and rendered frontmatter to production; no discrepancy was found.
4. **What happens when a dependency fails?** Manifest generation or the pending Batch 13 verification could fail before delivery. The generated manifest was checked against its script log; Batch 13's verify and diagnostics had no completed result in its report, so the coordinator must complete that gate before Phase C delivery.
5. **What is missing that requirements never mentioned?** The installed preset is an external retained home for several rules. A future preset update could move or remove those rules; this review establishes the present installed executable's content, not a permanent SDK guarantee.

## Decisions

1. **Approve the scoped logic diff, while leaving Phase C verification open.** Options: approve the reviewed logic or demand a code revision without a concrete defect. Evidence: the 36-row check, exact budget arithmetic, manifest script logs, and production deny-set comparison above. Reversible: yes, if the pending verification exposes a failure.
2. **Treat R7 and R8 as explicitly removed, not LOST.** Options: require a retained prompt home or honor the inventory's intentional deletion. Evidence: PLAN:237-238 and the supplied acceptance text. Reversible: yes.

## Batch 14 follow-up review

Verdict: **APPROVED**. Defects: **none** in the Batch 14 diff.

The revised JSDoc at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:320-328` removes the obsolete overlap explanation and matches the current core's single substitution table, handshake summary, workspace instruction deferral, and webview guidance (`ptah-core-prompt.ts:19-23,107,204-210`). The diff changes no runtime code. The three assertions at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:289-309` inspect the options handed to the SDK, including `toolAccess: 'none'` and caller append ordering. Removing the core append at `sdk-query-runner.service.ts:718` would fail them. The Batch 14 report records a targeted rerun passing 2 agent-sdk suites (62 tests) and 2 vscode-lm-tools suites (127 tests); I did not run tests or diagnostics under this review's read-only, no-heavy-command constraint. The report also records a known wider-suite flake, so that evidence does not establish a clean wider gate.

Five logic questions: (1) A missing core append would silently weaken the internal query; the new captured-options assertions detect it. (2) A one-shot caller selecting no tools still receives the core, as the second assertion checks. (3) A caller-provided append follows the core, as the third assertion checks. (4) Failure of the mocked SDK query would reject `runOneShot` before the captured-options assertion; no new dependency handling is introduced. (5) The assertions do not pin every word of the core prompt, which is covered by the separate core-prompt specs and Batch 13 review.

Decision: approve this bounded documentation and regression-test change. Options were approve or request a revision; the current source, runner path, and captured-options tests support approval. Reversible: yes.

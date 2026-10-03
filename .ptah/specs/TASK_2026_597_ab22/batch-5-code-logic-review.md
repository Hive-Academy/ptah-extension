# Code Logic Review — `TASK_2026_597_ab22`, Batch 5 (role cap, guidance once, resume preambles)

## Summary

| Metric              | Value                                                           |
| ------------------- | --------------------------------------------------------------- |
| Overall score       | 7/10                                                            |
| Assessment          | APPROVED (no blocking or serious issues; 4 moderate follow-ups) |
| Blocking issues     | 0                                                               |
| Serious issues      | 0                                                               |
| Moderate issues     | 4                                                               |
| Failure modes found | 7                                                               |

Scope read in full: `lane-role-condenser.ts`, `cli-adapter.utils.ts` (diff plus `renderRoleBlock` and `buildTaskPrompt`), `ptah-cli-spawn-options.service.ts`, `ptah-cli-registry.ts` diff, `agent-namespace.builder.ts` (lines 160-330), `ptah-api-builder.service.ts` diff, and every spec diff in the batch list. Also read: `enhanced-prompts.service.ts` (guidance cap and marker), `sdk-query-options-builder.ts:292-326` (`assembleSystemPrompt`), and the Codex and OpenCode call sites of `buildTaskPrompt`.

Checks run:

- Jest on the 5 suites `lane-role-condenser*`, `cli-adapter.utils.spec`, `ptah-cli-spawn-options.role`, `ptah-cli-registry-auto-compact-argv`: 144 passed.
- The condenser bundled with esbuild and exercised with 14 adversarial inputs (outside the repo; no repo file left behind).
- `grep` for `getSystemPrompt`, `projectGuidance`, `systemPrompt` across `apps/` and `libs/`.

The first-turn prompt is byte-identical to before. The ternary at `cli-adapter.utils.ts:524-526` yields the same string when `restoredContext` is false, the messaging block keeps its position (`:548-550`), and the 826-byte pin (`cli-adapter.utils.spec.ts:526`) and completion-contract specs pass.

## Five logic questions

### 1. How does this fail silently?

- A role whose first block has no blank line (a single huge paragraph, or a long list of single-newline lines) is dropped whole, and so is every later section. Measured: `'x'.repeat(50000)`, and 5,000 single-newline lines, both give a 173-char result (header plus pointer). A first section `## A` holding one 30k paragraph followed by a small `## B` gives 161 chars, with B dropped too (`lane-role-condenser.ts:67-77`). The loss is announced ("omitted: the opening text" / "omitted: A; B") and the path is present, so it is not silent. But the header (`cli-adapter.utils.ts:479-481`) still says "the definition below governs this task and outranks any generic persona above", and nothing is below it. The Codex test (`codex-cli.adapter.spec.ts:1218-1231`) feeds a 1.1 MB `x` body and asserts only `<= 10_000` and equality with `renderRoleBlock`, so it passes with the entire role gone.
- Pointer sized without regard to kept text: see "Pointer crowds out content" below. With more than about 400 sections the result keeps nothing and the pointer is about 9,900 chars of heading names.
- The Codex `assertCommandLineWithinLimit` guard (`codex-cli.adapter.ts:637-640`) is now unreachable by any role (cap 10,000 against a 32,767 limit) and no test reaches it. It is not a silent failure, but it is dead code that looks like protection.

### 2. What user action produces unexpected behaviour?

- Resume where the first turn never carried the preambles. A lane first spawned without `agentId` or `mcpPort` (MCP server not yet up) never got the messaging block. A later restored-context resume now omits it (`cli-adapter.utils.ts:548`), so the lane is never told about `ptah_agent_report`. Before this batch the resume would have supplied it. Only Codex (`codex-cli.adapter.ts:675`) and Cursor (`cursor-cli.adapter.ts:315`) set `resumeRestoresContext`, so the exposure is limited to those two.
- A Codex or Cursor resume whose backend thread has expired or been compacted away and so starts empty. Guidance was already skipped on resume (pre-existing); the tool and cost policy now goes with it. Nothing detects "restored" being false. Low probability, and the plan accepts the assumption (F6).
- `ptah.agent.spawn({ systemPrompt })` from `execute_code` still passes `systemPrompt` through `...requestFields` (`agent-namespace.builder.ts:304-317`), and `buildTaskPrompt` prefers it over guidance (`cli-adapter.utils.ts:507`). That is an explicit caller choice and still yields one copy. It is not a defect, but the "nothing sets systemPrompt" claim in the verification record holds only for Ptah-owned callers.

### 3. What input data produces a wrong answer?

- Multibyte text. The cap is in UTF-16 units, which matches the Windows guard (`cli-adapter.utils.ts:226-247`, "UTF-16 units"). A 10,000-char CJK role is about 30 KB in UTF-8. On Linux the guard is per-arg bytes (limit 131,071), so there is no breach. Cuts land only on `\n\n` offsets, so surrogate pairs are never split. The final `clamp` (`:227-229`) can split one, but only for a pathological path or header. Measured: a multibyte paragraph body is dropped whole (no breaks), and a 100-paragraph CJK body gives 9,677 chars with a pointer.
- Fenced content. `## ` inside a fence is not a section, and no cut lands inside a fence (measured: the cut kept `## A` and named "A (cut short); B", never "Not a section"). An unclosed fence makes the rest of the unit unbreakable and cuts back to before the fence. That is safe.
- Fence closing deviates from CommonMark. `forEachLine` (`lane-role-condenser.ts:176-181`) closes a fence on any same-character fence of at least the opening length, including a line with an info string such as "`ts". A role that shows a nested "`ts" example inside a three-backtick fence would end the fence early and treat a following `## ` as a section. This needs an already-malformed document, so it is minor.
- CRLF bodies are handled: `line.trim()` strips `\r`, headings are trimmed, offsets use `line.length + 1`. Measured 9,993 chars, and the kept text is intact.

### 4. What happens when a dependency fails?

- `getProjectGuidance` throwing is swallowed in `ptah-api-builder.service.ts` (the existing try/catch returning `undefined`), so the lane gets zero guidance copies and the spawn proceeds. This is the existing optional-capability pattern, unchanged by the batch.
- `getProjectGuidanceContent` returns `null` when the generated prompt has no `## Project-Specific Guidance` marker (`enhanced-prompts.service.ts:772-774`). Before, the system-CLI path used `getEnhancedPromptContent`, which returns the whole prompt in that case. A workspace whose stored prompt predates the marker, or was hand-edited, would have had guidance before and has none now. The generator always writes the marker (`:1269`), so this affects only legacy or edited state. The cap and the removed `systemPrompt` are the intent here.
- `resolveEnhancedPromptsContent` (Ptah CLI) logs and degrades to `undefined` (`ptah-cli-spawn-options.service.ts:360-366`), which is logged, not hidden.
- Role source path: the pointer names `role.sourcePath`. The batch record shows one producer, which sets the absolute path just read. An empty `sourcePath` would give "at ``". The type does not forbid it. This is a theoretical risk.

### 5. What is missing that the requirements never mentioned?

- A hard-cut fallback for paragraph-less text (see Moderate 1).
- A bound on pointer size relative to kept content (Moderate 2).
- An explicit check that the 10,000 cap is below the narrowest argv limit. The Windows `.cmd` shim limit is 8,191 (`cli-adapter.utils.ts:162`). Eight of the 15 roles render at 9,327-9,997 chars (executor report table), plus up to 4,000 bytes of guidance and the preambles. On a shim-fallback host a condensed role on an argv adapter can still raise `CliCommandLineTooLongError`. That is loud, and it also happened before (worse), so it is not a regression. But "role cannot breach the command line" is true only for the non-shim limit.
- Resume-side detection of "restored context was actually restored" (see question 2).

## Failure modes

### Whole-body loss on paragraph-less text

- Trigger: a unit (opening text or the first section that does not fit) with no blank line before the cap, such as a long unbroken list or one huge paragraph.
- Symptom: the lane gets header plus pointer only; all later sections are dropped too, even small ones.
- Evidence: `lane-role-condenser.ts:67-77`. The fallback is `assemble(keptEnd, [unit.omittedName, ...laterNames])`. Spec at `lane-role-condenser.spec.ts:116-124` pins this deliberately.
- Current handling: announced in the pointer, full path present.
- Recommendation: when no paragraph break fits, fall back to the last line break, then to a hard cut at a code-point boundary, for the opening unit at least. The identity text is the thing the plan says to keep ("keeps its opening identity and contract text", implementation-plan.md:274). Alternatively change the header sentence when nothing follows it.

### Pointer crowds out content

- Trigger: more than about 400 `## ` sections (full omitted-name list longer than about 9.9k chars).
- Symptom: measured with 3,000 sections: kept text is empty, pointer is 9,980 chars listing "Heading number 0 ... 495; and 2504 more".
- Evidence: `assemble` passes `maxChars - header.length - BLOCK_SEPARATOR.length` as the pointer room (`lane-role-condenser.ts:49-53`) without subtracting `kept.length`. `pointerLine` therefore fills the whole room whenever the list is long, so any non-empty `kept` overflows and is rejected in the loop at `:62`.
- Current handling: the result is still within the cap and the path is present.
- Recommendation: pass `maxChars - header.length - 2 - kept.length` as room, or cap the listed names to a fixed count or char budget.

### Quadratic cost on sectioned bodies

- Trigger: a role with thousands of `## ` sections.
- Symptom: measured 68 ms at 2,000 sections and 3.4 s at 8,000 (synchronous, on the spawn path). Paragraph-heavy bodies are fine (40,000 paragraphs gave 15 ms).
- Evidence: the per-unit `assemble` call re-runs `pointerLine`, which loops from `omitted.length` down (`:59-62`, `:217-222`).
- Current handling: none. The cap on role file size, if any, is outside this batch.
- Recommendation: bound the listed names before the loop. This also fixes the previous mode.

### Preamble omitted on a resume whose first turn never carried it

- Trigger: restored-context resume (Codex or Cursor) of a lane first spawned without `agentId`/`mcpPort`, or whose thread history was lost.
- Symptom: no messaging block and no tool or cost policy for the rest of the lane.
- Evidence: `cli-adapter.utils.ts:521-526` and `:548`; callers at `codex-cli.adapter.ts:675`, `cursor-cli.adapter.ts:315`.
- Current handling: plan accepts it (implementation-plan.md:742-745).
- Recommendation: record the limitation next to the resume-site comment. Optionally keep the messaging block when the previous turn lacked an agent id.

### Legacy generated prompt without the guidance marker loses guidance on system-CLI lanes

- Trigger: stored `generatedPrompt` with no `## Project-Specific Guidance` heading.
- Symptom: `getProjectGuidanceContent` returns `null`; the lane has no guidance. Before the batch it received the full prompt.
- Evidence: `enhanced-prompts.service.ts:772-774` against the removed `getSystemPrompt` wiring (`ptah-api-builder.service.ts` diff).
- Current handling: none. The generator always writes the marker (`enhanced-prompts.service.ts:1269`).
- Recommendation: accept, and note it in the record, or fall back to a capped slice of the whole prompt.

### Dead Codex command-line guard

- Trigger: n/a (unreachable).
- Evidence: `codex-cli.adapter.ts:636-640` wraps `developer_instructions` in `assertCommandLineWithinLimit`; the spec case that reached it was converted to a cap assertion (`codex-cli.adapter.spec.ts:1218-1231`) and no Codex spec reaches `CliCommandLineTooLongError` now.
- Current handling: guard stays, untested.
- Recommendation: Batch 1 owns that file. Delete the guard, or keep it with a test that drives it through the actual path, per the "delete unused code" rule.

### Fence closed by an info-string line

- Trigger: a role body with a nested fence line such as "```ts" inside a three-backtick fence.
- Symptom: a following `## ` is treated as a section boundary.
- Evidence: `lane-role-condenser.ts:176-181`.
- Recommendation: a closing fence must have no text after the markers.

## Blocking issues

None found.

## Serious issues

None found. The nearest candidate is the whole-body loss on paragraph-less text. It is announced, plan-specified, pinned by a spec, and does not occur for any of the 15 repository roles (the table spec renders all of them for Codex and OpenCode), so it is held at Moderate.

## Moderate and minor issues

1. Moderate: no hard-cut fallback; whole unit and all later sections dropped (`lane-role-condenser.ts:67-77`).
2. Moderate: pointer room ignores kept length (`:49-53`).
3. Moderate: cap 10,000 is above the 8,191 `.cmd` shim limit (`cli-adapter.utils.ts:162`), so the guarantee "a role cannot breach the command line" is partial. Pre-existing and loud.
4. Moderate: preamble omission assumes the first turn delivered it (`cli-adapter.utils.ts:521-526`, `:548`).
5. Minor: O(n²) in section count (`lane-role-condenser.ts:59-62`, `:217-222`).
6. Minor: fence close with info string (`:176-181`).
7. Minor: the Codex cap test asserts only length and equality with its own function (`codex-cli.adapter.spec.ts:1226-1230`). It would pass with the whole role removed. Add an assertion that the identity paragraph survives for a body that has paragraph breaks, or that the pointer is present.
8. Minor: the 64 KiB Ptah CLI test (`ptah-cli-registry-auto-compact-argv.spec.ts:515-535`) still reaches its assertion (opening marker kept, capped block delivered in the initialize request, marker absent from argv and env), but it now delivers about 10k, not 64 KiB, so "a large payload goes over initialize, not argv" is no longer shown by this case. The name and the retained 64 KiB fixture are slightly misleading; a pure rename would do.
9. Minor: the `clamp` at `:227-229` can split a surrogate pair or cut the pointer, only when header plus pointer alone exceed the cap (pathological `sourcePath` or header). Measured 10,000 exactly with a 12k-char path or header, so the cap holds.

## Data flow

1. `ptah.agent.spawn` (namespace builder, `agent-namespace.builder.ts:178-319`). Role resolved at `:184-198` (OK). The system-CLI branch fetches `getProjectGuidance` and plugin paths in parallel at `:293-296` (OK; no `systemPrompt`). The Ptah CLI branch no longer fetches guidance (OK; spawn-options reads it).
2. `agentProcessManager.spawn` passes `projectGuidance` and `systemPrompt` through unchanged (`agent-process-manager.service.ts:348-349`). `systemPrompt` is now never set by Ptah-owned callers (OK; leftover dead field slated for Task 6.5).
3. Adapter calls `buildTaskPrompt(options, cli)` (opencode `opencode-cli.adapter.ts:555`; Codex `codex-cli.adapter.ts:674`, role stripped; Cursor `cursor-cli.adapter.ts:315`).
   - First turn: guidance, then role (capped), then tool policy plus task, files, task folder, messaging, completion contract (OK, identical to before).
   - Restored resume: guidance, role, tool policy and messaging omitted; contract kept (OK; gap when the first turn never carried them).
   - Non-restoring resume (OpenCode and others that do not set the flag): everything kept (OK, spec at `cli-adapter.utils.spec.ts` "keeps all three on a resume whose adapter does not restore context").
4. `renderRoleBlock` builds the header and the transformed body, then `condenseLaneRole` (`cli-adapter.utils.ts:472-483`). A role within the cap is returned byte-identical (OK). Over the cap, units are kept in order up to the cap (see failure modes for the paragraph-less and many-section gaps).
5. Codex: the role goes to `developer_instructions` on every spawn and resume (`codex-cli.adapter.ts:635-641`). Guidance is in the task prompt on the first turn only. Together that is exactly one copy of guidance (OK).
6. Ptah CLI: `assembleSpawnOptions` builds `[PTAH_CORE + enhancedPromptsContent (capped guidance), renderRoleBlock(role,'ptah-cli')]` (`ptah-cli-spawn-options.service.ts:177-205`). One guidance copy; the role is capped (OK).

## Requirements fulfilment

| Requirement                                                          | Status                                                                                                                                                                       | Gap                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| R3.6 role block <= 10,000 chars for every role                       | COMPLETE for all 15 repo roles and for synthetic 5k/12k/25k/1.1M bodies. Verified by the adversarial run: every output <= 10,000, pointer present in every condensed case.   | Content retained for paragraph-less units is nil (Moderate 1). |
| R3.4 guidance at most once in the first request                      | COMPLETE on first turn. Namespace spec (`agent-namespace.builder.spec.ts` new case) pins the spawn request; utils spec pins opencode and Codex; Ptah CLI role spec counts 1. | Legacy prompt without marker yields zero (failure mode).       |
| R3.4 resume: tool policy and messaging omitted, contract kept        | COMPLETE (`cli-adapter.utils.ts:521-526`, `:548`).                                                                                                                           | Assumption that the first turn delivered them.                 |
| R9.7 per-lane prefix, no shared state                                | COMPLETE. The condenser is pure; the spec interleaves builds.                                                                                                                | None.                                                          |
| 826-byte pin and TASK_2026_515 contract unchanged on first turn      | COMPLETE. Pin spec `cli-adapter.utils.spec.ts:526` and contract specs pass in the run.                                                                                       | None.                                                          |
| Task 5.3: no `systemPrompt` fetched or attached for system-CLI lanes | COMPLETE.                                                                                                                                                                    | None.                                                          |
| Task 5.4: second guidance copy removed                               | COMPLETE.                                                                                                                                                                    | None.                                                          |

Implicit requirements not addressed: pointer budget awareness of kept text; detection of un-restored resume; cap versus `.cmd` shim limit.

## Edge cases

| Case                                                       | Handled | How                                              | Concern                                                                                           |
| ---------------------------------------------------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| No headings, paragraph breaks present                      | YES     | Cut at last fitting paragraph break              | None                                                                                              |
| No headings, no blank line / one huge paragraph            | PARTIAL | Whole unit dropped, pointer says so              | Identity text lost (Moderate 1)                                                                   |
| Multibyte text                                             | YES     | UTF-16 length, cut only at `\n\n`                | 10k CJK is about 30 KB UTF-8; fine against the Windows (UTF-16) and Linux (131 KB per arg) guards |
| `## ` inside a fence                                       | YES     | Fence-aware split and break search               | Info-string closing fence                                                                         |
| Unclosed fence                                             | YES     | Unit unbreakable after the fence; cut before it  | None                                                                                              |
| CRLF                                                       | YES     | Trim-based                                       | None                                                                                              |
| Long `sourcePath` or header                                | YES     | Pointer shrinks, final clamp                     | Clamp can cut the pointer; pathological                                                           |
| Thousands of sections                                      | PARTIAL | Pointer shrinks to "and N more"                  | Content crowded out; quadratic time                                                               |
| Restored resume                                            | YES     | Preambles omitted, contract kept                 | First-turn assumption                                                                             |
| Non-restoring resume                                       | YES     | Everything kept                                  | None                                                                                              |
| No MCP port or agentId                                     | YES     | Messaging block skipped on all turns (unchanged) | Interacts with resume                                                                             |
| Namespace spawn, `getProjectGuidance` undefined or rejects | YES     | Guidance omitted; spawn proceeds                 | Optional capability, logged upstream                                                              |
| Caller-supplied `systemPrompt` through `execute_code`      | YES     | Replaces guidance, one copy                      | Explicit caller choice                                                                            |

Reworked guard tests, each checked for whether it still reaches its guard:

- Antigravity (`antigravity-cli.adapter.spec.ts:539-562`): reaches it. A 1.1M-char task makes the prompt arg oversize; it asserts `CliCommandLineTooLongError` and that the MCP write was not made. OK.
- Copilot (`copilot-sdk.adapter.spec.ts:996-1015`): reaches it through the real `spawnCli`. OK.
- Codex (`codex-cli.adapter.spec.ts:1218-1231`): no longer exercises a guard; it now asserts the cap. The source guard at `codex-cli.adapter.ts:637` is unreachable and unpinned (see failure modes). The test is also weak (equality with its own function).
- Ptah CLI 64 KiB (`ptah-cli-registry-auto-compact-argv.spec.ts:359-370`, `:515-535`): the fixture was rewritten with paragraph breaks so the opening marker survives; it reaches its assertions (capped block in initialize, marker not in argv or env). OK, with the naming caveat above.
- Registry capabilities (`ptah-cli-registry-capabilities.spec.ts:305`): index 7 to 6 matches the removed positional `projectGuidance` argument. OK.

Removal of the `getSystemPrompt` getter and the namespace `systemPrompt`: grep finds no remaining reference to `getSystemPrompt` under `apps/` or `libs/`. The remaining `systemPrompt` references are pass-throughs and the unrelated chat path. `getEnhancedPromptContent` stays on the real service and is still used by three other callers, so only the local structural interface member was dropped. Nothing a caller still needs is dropped, except the legacy-marker case above.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the condenser and `buildTaskPrompt` (read in full, executed against 14 adversarial inputs, 144 tests re-run), MEDIUM on host wiring of other adapters (not read, since out of scope).
- Top risk: a role whose first block has no blank line collapses to header plus pointer, which contradicts the header's own claim that a definition follows. It is announced, but the lane loses its identity text.
- What a robust implementation would add:
  1. Line-boundary then code-point hard-cut fallback when no paragraph break fits (at least for the opening unit), or an adapted header sentence when no body follows.
  2. Pointer room that accounts for kept text, and a cap on the listed name count (this also removes the quadratic cost).
  3. A closing-fence rule that rejects info strings.
  4. A Codex test that asserts the identity paragraph survives; remove or truly cover the Codex command-line guard.
  5. A note at the resume site that omitted preambles assume the first turn delivered them.
  6. Consider a cap under 8,191 for argv adapters on `.cmd` shim hosts, or record why the loud guard is acceptable (R3.7 arithmetic).

Score rationale: 7/10 ("sound"). Between 5-6 because the main paths, first-turn byte identity, and test reachability all check out under execution, and failures are loud or announced. Between 8-9 because of the two real condenser logic gaps (paragraph-less drop, pointer crowd-out) and the weak/unpinned Codex coverage.

---

## Round 2 (after fix round 1: H1-H5, H7, H8)

Round 2 supersedes the round 1 score and verdict above where they differ. H6 (dead Codex guard) is out of scope here (Task 4.3).

### Round 2 summary

| Metric        | Value                                     |
| ------------- | ----------------------------------------- |
| Overall score | 8/10                                      |
| Assessment    | APPROVED                                  |
| Blocking      | 0                                         |
| Serious       | 0                                         |
| Moderate      | 1 (the H4 saving is inert until Task 4.3) |
| Minor         | 3 new                                     |

Evidence: full read of the rewritten `lane-role-condenser.ts`, and `git diff` of `cli-adapter.utils.ts`, `enhanced-prompts.service.ts` (+ spec), `codex-cli.adapter.spec.ts` and `ptah-cli-registry-auto-compact-argv.spec.ts`. Jest re-run: 9 cli-agent-runtime suites (condenser, utils, Ptah CLI spawn-options, auto-compact argv, Codex adapter, Cursor) 266 passed, 1 snapshot; `enhanced-prompts.service.spec` 56 passed. The condenser was bundled with esbuild and driven with about 20 adversarial inputs plus a boundary scan of 2,000 body sizes across 4 shapes, outside the repo.

### Per-fix verdict

- H1 (whole-body loss): FIXED. Measured:
  - `'x'.repeat(50000)`: 9,416 chars, 8k+ chars of body kept, pointer says "the rest of the opening text".
  - 5,000 single-newline lines: 9,403 chars, whole lines kept.
  - `## A` with a 30k paragraph then a small `## B`: A cut short, B kept after it, "A (cut short)" named.
  - 20,000 emoji, odd and even offset: no lone surrogate in the output.
  - Unclosed backtick fence and tilde fence with a 30k line: the hard cut closes the fence inside the limit.
  - A 16 KB fenced block inside `A`: cut back to the intro, never inside the fence; B kept.
  - A 20,000-char heading line (nothing of the body fits): `headerWithoutBody` is used and the pointer is present, so the "nothing fits" header is honest.
  - Boundary scan, 2,000 sizes x 4 shapes: no output over 10,000, pointer present whenever the input exceeded the cap.
  - Later small sections that fit are kept in document order, limited to half of the remaining room (a deliberate, deterministic trade).
- H2 (pointer crowd-out): FIXED. 3,000 sections: 9,988 chars, leading sections kept, list bounded, then "and 2684 more". A heading name longer than the 600-char budget degrades to "44 sections" with kept text still present (9,210 chars). The reserve is the worst-case pointer for the unit count (`lane-role-condenser.ts` `pointerReserve`), so the pointer cannot overflow; the boundary scan confirms it.
- H3 (linear time): FIXED, and the assertion is real (`lane-role-condenser.spec.ts:206-213` times the call with `performance.now()` and asserts `< 200`). Measured: 8,000 sections 11 ms (was 3.4 s); 40,000 sections 75 ms; 100,000 sections 159 ms; 500,000 paragraphs 183 ms. Growth is linear. The bound is about 18x the measured time, so it is stable on a slow CI box yet would fail the old code by about 17x.
- H4 (`resumePreamblesDelivered`): FIXED. `omitPreambles = restoredContext && options.resumePreamblesDelivered === true` (`cli-adapter.utils.ts` about :522-524). It defaults to keeping both blocks. `grep` shows the option only in `cli-adapter.utils.ts` and specs; no adapter sets it (Codex `codex-cli.adapter.ts:675` and Cursor `cursor-cli.adapter.ts:315` still pass only `resumeRestoresContext`). Guidance and role omission on a restored resume still keys on `restoredContext`, so the earlier 559 behaviour is intact. First-turn output is byte-identical: the 826-byte pin (`cli-adapter.utils.spec.ts:526`) and the completion-contract specs pass.
- H5 (guidance never zero): FIXED. `getProjectGuidanceContent` returns the trimmed marker section, else the trimmed whole prompt, through `capProjectGuidance`; it returns `null` only when disabled, no prompt, or whitespace-only. Against the removed `getEnhancedPromptContent` path, the only case that now yields less is a whitespace-only prompt, which carried no guidance anyway. The cap applies on both paths (a marker-less prompt of about 10 KB is asserted at or below 4,000 bytes with the truncation notice).
- H7 (fence close): FIXED. `CLOSING_FENCE_PATTERN` requires a bare marker line of the same character and at least the opening length. The spec "does not close a fence on an info-string line" passes.
- H8 (specs): FIXED. The Codex case uses a 1.1 MB paragraphed body and asserts the identity paragraph, the `sourcePath`, the "condensed" line, equality with `renderRoleBlock` and a length at or below 10,000, so it fails if the body is dropped. The Ptah CLI case is renamed `capped-role`; it asserts the source exceeds the cap, the block is capped and names its source, the block reaches the initialize request, and the marker is absent from argv and env.

### New findings

1. Moderate: the F6 resume saving is not realised by any adapter after H4. The option is correct and safe, but until Task 4.3 sets `resumePreamblesDelivered`, every restored Codex or Cursor resume still resends the tool policy and the messaging block (about 1.8 KB). Task 4.3 must set it only when that handle's first turn actually carried each block. The flag is one boolean for two blocks, so it cannot express a first turn that carried the policy but not the messaging block (no MCP port); Task 4.3 should keep the flag false in that case (safe, loses the saving) or split it in two.
2. Minor: `getProjectGuidanceContent` on a marker-less prompt takes the head slice. For a legacy prompt that began with other material (for example core system-prompt text the Ptah CLI prompt already carries) the first 4,000 bytes may be boilerplate. It is bounded, legacy-only and better than the former zero, but the head is not necessarily the guidance.
3. Minor: the hard cut can leave a half word or half line (announced by the pointer), and a cut inside an opening fence marker can leave a stray one or two backticks. Cosmetic.
4. Minor: the `enhanced-prompts.service.ts` diff includes prettier-only churn in `capProjectGuidance` and in spec type annotations, unrelated to H5. The file on disk currently shows the original single-line `while`, so another actor may be reformatting it; confirm the final staged diff.

Accepted and unchanged: cap 10,000 above the 8,191 `.cmd` shim limit (recorded by the team-leader); the leftover `systemPrompt` pass-through (Task 6.5).

### Round 2 requirements recheck

| Requirement                                                                   | Status              | Note                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R3.6 role at most 10,000 chars, nothing silently lost, pointer always present | COMPLETE            | Boundary scan clean; the updated 15-role table is at most 9,502. The pointer is absent only for a pathological 12k-char `sourcePath` or header (final clamp), as before. |
| R3.4 guidance once, never zero                                                | COMPLETE            | Marker-less prompts now covered.                                                                                                                                         |
| R3.4 resume preambles                                                         | PARTIAL (by design) | Mechanism done and safe; no adapter opts in until Task 4.3.                                                                                                              |
| R9.7                                                                          | COMPLETE            | Pure function, no module state.                                                                                                                                          |
| 826-byte pin and TASK_2026_515 contract on the first turn                     | COMPLETE            | Unchanged; specs pass.                                                                                                                                                   |

### Round 2 verdict

- Recommendation: APPROVE
- Score: 8/10. Up from 7 because the round 1 condenser and guidance defects are closed with executable evidence: the cap holds on every adversarial shape, time is linear, no code point or fence is damaged, and the empty-body header is honest. Not 9 because the resume saving is inert until Task 4.3, one boolean cannot express a partially delivered first turn, and the marker-less head slice is a heuristic.
- Confidence: HIGH.
- Top risk: Task 4.3 setting `resumePreamblesDelivered` without per-block tracking, which would bring back the missing-messaging-block resume case that H4 exists to prevent.

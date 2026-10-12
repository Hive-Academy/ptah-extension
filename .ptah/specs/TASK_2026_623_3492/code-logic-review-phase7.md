# Code Logic Review — `TASK_2026_623_3492` Phase 7

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED WITH NOTES |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 0 |
| Failure modes found | 0 |

The combined `0f7b65931..21074df38` diff was reviewed in full for the named Phase 7 files, together with the Batch 29–32 requirements, R8, plan components 12–13, the listed decisions, root `CLAUDE.md`, the resolver/agents implementation and corpus. No evidence supports a logic finding.

The score is 8 rather than 9–10 because the actual production esbuild metafile has deliberately not yet been supplied to the eager-closure gate: Batch 33 owns that real-build check. It is above 7 because the static gate paths have synthetic pass/fail coverage, the new prompt and documentation contracts are directly pinned, and the manifest check was run successfully.

## Five logic questions

### 1. How does this fail silently?

No silent-success path was found in scope. The gate rejects a missing `main.js` before checking closure inputs (`scripts/eager-closure-gate.js:88-93`), missing stats paths throw (`:134-141`), and a forbidden input reached through static imports is converted into a failing error (`:94-105`). Invalid display blocks are documented to leave the prior panel unchanged (`.claude/skills/ptah-surface-authoring/SKILL.md:22`; `references/ptah-ui.md:5`), rather than claiming an update succeeded.

Residual uncertainty: only a real production metafile can prove that the emitted Electron closure does not actually contain a forbidden input; that is a Batch 33 measurement, not a source-level silent failure in this diff.

### 2. What user action produces unexpected behaviour?

No unsupported action was found. Reusing a display id is explicitly replacement, not append (`references/ptah-ui.md:19-24`), and the compact hint communicates the same update semantics (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:7`). The gate distinguishes a dynamically imported panel chunk from eager inputs (`apps/ptah-electron/src/config/eager-closure-gate.spec.ts:100-122`), so the type-only dock-port dependency does not falsely make a user-visible lazy panel fail the gate.

### 3. What input data produces a wrong answer rather than an error?

No such input was found in scope. `$agents session` is defined as turns through the block's own turn, never later turns (`references/ptah-ui.md:20`; `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts:154-178`), rows have a capped count with `+N more` propagated by the resolver (`ptah-ui-resolver.ts:353-366`), and `$limits` preserves list order and has its own capped-list note semantics (`ptah-ui-resolver.ts:369-403`). The skill’s stated sort order matches the implementation’s turn/start/key ordering contract and tests (`ptah-ui-agents-source.ts:261-310`; `ptah-ui-agents-source.spec.ts:644-650`).

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

The reviewed boundary uses visible status values rather than fabricated data: absent or non-available live `$agents`/`$limits` inputs resolve to `unavailable` or their explicit state (`ptah-ui-resolver.ts:201-218`, `:378-394`), while missing agent facts also resolve unavailable (`ptah-ui-agents-source.ts:163-170`). A missing or malformed-in-practice stats entry cannot yield a clean gate success because `main.js` is required (`scripts/eager-closure-gate.js:88-93`) and `readStats` lets JSON/read failures terminate the command (`:134-141`, `:177-186`).

### 5. What is missing that the requirements never mentioned?

The only material gap is operational evidence, not an omitted implementation contract: no reviewed code can establish the contents of a future production esbuild metafile. Decision #143 and Batch 32 defer that real closure measurement to Batch 33. The existing fixtures do cover the specified missing-main, forbidden-agent-source, dock-port pass, display-panel, and display-dock cases (`apps/ptah-electron/src/config/eager-closure-gate.spec.ts:29-36,87-153`).

## Failure modes

None found.

The review specifically checked the potential failure modes requested by the task:

- `ptah-ui-agents-source.ts` is separately forbidden and has an eager-main failure fixture (`scripts/eager-closure-gate.js:18`; `eager-closure-gate.spec.ts:87-98`).
- Matching consumes only esbuild output `inputs` keys, not source import text (`scripts/eager-closure-gate.js:67-85`); the dock-port/dynamic-panel fixture passes (`eager-closure-gate.spec.ts:100-122`).
- `display-dock.component.ts` is within the forbidden lazy-only path and has a fixture (`scripts/eager-closure-gate.js:21-23`; `eager-closure-gate.spec.ts:91-98`).
- Input normalization converts Windows separators, and each added pattern is anchored to the intended `.ts` leaf or directory (`scripts/eager-closure-gate.js:43-49`, `:27-36`). Thus Windows paths, `./` paths, and absolute paths still contain the required normalized path segment; the normal gate runs forbidden checking before growth allow-list checking (`:157-160`).
- The transcript allow-list includes all six required new transcript inputs plus dock state and both chat-ui ports (`scripts/eager-closure-gate.js:31-36`; `eager-closure-gate.spec.ts:124-143`).

## Blocking issues

None.

## Serious issues

None.

## Moderate issues

None.

## Minor issues

None.

## Data flow

1. Agent receives the compact Electron-only hint — OK: it names `display [id]`, replacement semantics, and all five sources within the 100-token gate (`ptah-ui-hint.ts:7`; `ptah-ui-hint.spec.ts:23-80`).
2. Agent loads the mirrored skill reference — OK: mirror hashes match and its three new worked examples map to corpus entries (`references/ptah-ui.md:169-227`; `libs/shared/src/mcp-apps-contracts/ptah-ui.corpus.ts:139-171`).
3. Resolver receives source references rather than host values — OK: live source absence becomes status text and values remain host-resolved (`ptah-ui-resolver.ts:58-65`, `:279-295`).
4. Follow-up chat serialisation runs — OK: seeded agent, limits, and summary values are rendered locally but excluded from outgoing params and stored source text (`libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:540-589`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts:157-221`).
5. Production closure gate reads a metafile — OK at unit level: static closure only is inspected, required entry/stats absence fails, forbidden eager inputs fail, and approved eager growth passes (`scripts/eager-closure-gate.js:52-85`, `:88-123`, `:134-165`). Real-build measurement remains Batch 33.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| R8 hint is at most 100 tokens and names target/id/sources | COMPLETE | Text and seven assertions at `ptah-ui-hint.ts:7`, `ptah-ui-hint.spec.ts:23-80`; batch evidence records 87 tokens. |
| No outdated hint rationale | COMPLETE | The former example rationale is replaced by the R8.1/R8.3 explanation at `ptah-ui-hint.spec.ts:61-79`. |
| Skill mirrors and resolver semantics | COMPLETE | Identical SHA-256 values for all three mirrored files; `$agents`/`$limits` documentation at `references/ptah-ui.md:138-227` agrees with `ptah-ui-agents-source.ts:154-228` and `ptah-ui-resolver.ts:353-403`. |
| Each worked example is a corpus case | COMPLETE | Named example headings `references/ptah-ui.md:173-359` correspond to corpus cases `ptah-ui.corpus.ts:20-171`. |
| Manifest is current | COMPLETE | `content-manifest.json:69-71`; `npm run manifest:check` passed. |
| Eager gate additions and fail-closed behaviour | COMPLETE at unit level | Gate and fixtures `scripts/eager-closure-gate.js:11-186`, `eager-closure-gate.spec.ts:28-188`; real metafile pending Batch 33. |
| Stubs/TODOs/placeholders absent | COMPLETE | Targeted search of all scoped files and both skill copies found none. |

## Edge cases

| Case | Handled | Evidence | Remaining concern |
| --- | --- | --- | --- |
| Missing `main.js` | YES | `eager-closure-gate.js:88-93`; fixture `eager-closure-gate.spec.ts:29-36` | None at unit level. |
| Missing stats file | YES | `eager-closure-gate.js:134-141` | Real build still pending. |
| Windows separator / relative / absolute esbuild input | YES | Normalize then unanchored repository path matching at `eager-closure-gate.js:43-49` | Depends on metafile path casing matching repository casing. |
| Type-only dock-panel import | YES | Input-only check `eager-closure-gate.js:67-85`; pass fixture `eager-closure-gate.spec.ts:100-122` | None. |
| More agents or limits than row cap | YES | Resolver emits `+N more` at `ptah-ui-resolver.ts:353-403` | None. |
| Missing live source / malformed availability state | YES | `ptah-ui-resolver.ts:201-218`, `:378-394` | None. |

## Verification evidence

- `npm run manifest:check` — passed: manifest current, 229 files.
- Focused gate suite, with the required absolute `marked` mapper and `--maxWorkers=2` — passed: 1 suite, 20 tests.
- `git diff --check 0f7b65931..21074df38` — no whitespace errors.
- The pre-existing Batch 29–32 reports document the focused hint and host-boundary verification; those reports were read, but their runs were not represented as a substitute for the focused checks above.

## Verdict

- Recommendation: APPROVED WITH NOTES
- Confidence: HIGH for source and fixture behaviour; MEDIUM for the as-yet-unmeasured production closure.
- Top risk: a real build may expose an unlisted or forbidden eager input that synthetic fixtures cannot know.
- What a robust implementation would add: complete Batch 33’s real-metafile eager-closure measurement and record any newly eager input before release.

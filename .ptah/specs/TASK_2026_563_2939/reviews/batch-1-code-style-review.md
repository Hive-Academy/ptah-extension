# Code Style Review — `TASK_2026_563_2939`

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 2        |
| Files reviewed  | 6        |

## Five style questions

### 1. What breaks in six months?

If the memory draft schema evolves (e.g. adding a new field to `ExtractedDraftSchema` or updating field comments in the prompt), the rigid string-comparison test `extract-prompt.spec.ts:56-65` will break immediately against `BASE_SCHEMA_BLOCK` (`extract-prompt.spec.ts:11-27`), as will `resolve-prompt.spec.ts:40-42` against `BASE_JSON_BLOCK` (`resolve-prompt.spec.ts:11-28`). Furthermore, the manual string extraction helpers `schemaBlock` (`extract-prompt.spec.ts:49-53`) and `jsonBlock` (`resolve-prompt.spec.ts:33-37`) rely on exact substring delimiters `prompt.indexOf('{\n  "memories"')` and `prompt.indexOf('\n}', start)`. If someone reformats whitespace, indentation, or leading braces in either prompt, the slice helper will return a malformed fragment or misaligned slice.

### 2. What would a new team member misread?

A new engineer might wonder why `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts` was deleted, but `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts` remains present in `memory-curator`. The explanation (that `resolve-prompt.ts` deletion in `memory-curator` is a recorded follow-up outside Batch 1 scope) is documented only in the task batch plan (`batches.md:155-156`), not in the codebase itself.

### 3. What does this cost to maintain?

Maintaining prompt assertions via exact string matching and frozen base copies (`BASE_SCHEMA_BLOCK` in `extract-prompt.spec.ts:11-27` and `BASE_JSON_BLOCK` in `resolve-prompt.spec.ts:11-28`) incurs a minor maintenance tax on future prompt refactors. However, normalizing whitespace via `replace(/\s+/g, ' ')` (`extract-prompt.spec.ts:47`, `resolve-prompt.spec.ts:31`) mitigates wrapping brittleness for semantic assertion checks, keeping the ongoing maintenance overhead predictable and justified for prompt regression prevention.

### 4. Where is this inconsistent with the rest of the repository?

In `resolve-prompt.ts:40-54`, `buildResolveUserPrompt` defines an inline, anonymous structural type for `drafts` (`drafts: readonly { kind: string; subject: string | null; ... }[]`) rather than importing `ExtractedDraft` or domain types from `extract.schema.ts` or `memory.types.ts`. This was inherited from base `ebfc73321` and preserved to minimize unnecessary churn, but differs from the repository's preference for centralized typed schemas.

### 5. What would you have done differently?

Instead of relying on fragile string index slicing (`indexOf('{\n  "memories"')` and `indexOf('\n}', start)`) in `extract-prompt.spec.ts:49-53` and `resolve-prompt.spec.ts:33-37`, a regex with named capture groups or testing `EXTRACT_SYSTEM_PROMPT` directly against regex patterns for the schema segment would prevent false negatives if prompt indentation or surrounding text changes.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Minor issues

### 1. Fragile substring slicing in prompt spec helpers

- File: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.spec.ts:49-53` and `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.spec.ts:33-37`
- Problem: `schemaBlock()` and `jsonBlock()` use `prompt.indexOf('{\n  "memories"')` and `prompt.indexOf('\n}', start)`.
- Impact: If indentation or surrounding spacing around the JSON block changes, `indexOf` could fail or slice unexpected characters, causing test failures unrelated to actual schema integrity.
- Fix: Use a multiline regex or boundary matcher to safely extract the embedded JSON block.

### 2. Inline structural type definition in `buildResolveUserPrompt`

- File: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts:40-54`
- Problem: `buildResolveUserPrompt` parameter `drafts` uses an expanded inline anonymous object shape instead of referencing an exported schema interface.
- Impact: Drift between `buildResolveUserPrompt` parameter types and `ExtractedDraft` if fields change in the future.
- Fix: Import and reference `ExtractedDraft` (or a dedicated input type) in a future cleanup pass.

---

## File-by-file

### `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts`

Score 9/10 — 0 [B], 0 [S], 0 [M]. Clean, well-structured prompt definitions for `EXTRACT_SYSTEM_PROMPT` and `buildExtractUserPrompt`. Section headers (`SUBJECTS`, `DO NOT EXTRACT`, `TOOLS`) provide clear guidance for small LLM models, and no extraneous imports or dependencies were introduced.

### `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.spec.ts`

Score 8/10 — 0 [B], 0 [S], 1 [M]. High-fidelity spec pinning the JSON schema block, prohibited patterns (`auth-service`, `ptah`), topic naming guidelines, memory search reuse, and the three `DO NOT EXTRACT` categories. Whitespace normalization via `flat` protects against wrapping churn, though `schemaBlock` slicing is slightly brittle (`:49-53`).

### `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts`

Score 8/10 — 0 [B], 0 [S], 1 [M]. Prompt rewrite correctly replaces case-insensitive matching with semantic merge guidance while explicitly restricting merge targets to the Existing list. Preserves `buildResolveUserPrompt` without unnecessary churn; retains inline typing (`:40-54`).

### `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.spec.ts`

Score 8/10 — 0 [B], 0 [S], 1 [M]. Follows the exact pattern established in `extract-prompt.spec.ts`. Asserts removal of case-insensitive matching, inclusion of semantic merge rules, enforcement of Existing-list-only target IDs, and byte-for-byte schema retention.

### `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts`

Score 9/10 — 0 [B], 0 [S], 0 [M]. Diff is completely clean with zero unrelated noise. Strictly adds `systemPromptAppend` capture to `ExecuteCapture` (`:150,172`) and introduces a focused 2-test suite (`:340-380`) verifying that `extract` and `resolve` deliver the exact prompt constants with their essential rule markers.

### `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts` (deleted)

Score 10/10 — 0 [B], 0 [S], 0 [M]. Clean deletion of dead duplicate code in `memory-curator`. Verified via `npx nx run-many -t lint typecheck -p @ptah-extension/memory-curator` that no dangling imports or broken references remain.

---

## Pattern compliance

| Repository rule or nearby convention        | Status | Evidence                                                                                                  |
| ------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Layer rule (`CONVENTIONS.md:103-118`)       | PASS   | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/` stays strictly in L3 without cross-layer leaks.     |
| Naming conventions (`CONVENTIONS.md:82-94`) | PASS   | All files follow `kebab-case.ts` and `*.spec.ts` naming.                                                  |
| Barrel hygiene (`CONVENTIONS.md:42-53`)     | PASS   | Internal adapter prompt helpers remain private to adapter folder, not leaked into `src/index.ts`.         |
| Type safety & zero `@ts-ignore` / `as any`  | PASS   | All new specs and modified prompt functions are fully typed without bypasses.                             |
| No unrelated diff noise                     | PASS   | `git diff` for `sdk-internal-query.curator-llm.spec.ts` contains only the capture wiring and 2 new tests. |
| Replace, do not accumulate                  | PASS   | Dead duplicate `curator-llm/extract-prompt.ts` deleted in place with no lingering shims.                  |
| Verification gate                           | PASS   | `npx nx run-many -t test lint typecheck -p @ptah-extension/agent-sdk` passed 3/3 tasks cleanly.           |

---

## Maintenance debt

- Introduced: Two frozen base JSON string blocks in unit specs (`BASE_SCHEMA_BLOCK` and `BASE_JSON_BLOCK`) that require deliberate updates if schema contracts change.
- Retired: One duplicate prompt file (`libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts`), reducing duplicate code drift.
- Net: Neutral to positive (eliminates dead duplicate source while adding strong regression guards on prompt contracts).

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: Ensure team members are aware that `extract-prompt.spec.ts` and `resolve-prompt.spec.ts` intentionally freeze the JSON schema block text to safeguard parsing compatibility.
- What a 10/10 version would do differently: Replace manual index-based slicing in `schemaBlock()` and `jsonBlock()` with robust regex pattern matching, and import a shared type definition for `buildResolveUserPrompt` parameters.

# Code Logic Review - batch 8p-6 (TASK_2026_714_c8a2)

Score: 9/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 0, Minor 3.

## Mechanical move check

I rebuilt the moved block from `git show HEAD:.../codex-runtime.ts`: `CodexRuntimeOptions` through the line before `/** Host-owned instance`, plus `interface Subscriber` through the end of the file. I joined them with a newline, normalised CRLF to LF and diffed them with `git diff --no-index -U0` against `codex-context.ts`.

The only differences are:
- 45 added import lines at the top of codex-context.ts (lines 1-45).
- One blank line (old line 12, between `CodexRuntimeOptions` members) removed.
- A trailing `export { RuntimeContext };` added after the class. HEAD had no final newline; the new file ends with `}\n\nexport { RuntimeContext };\n`.

No logic line, comment or degradation-audit marker changed in any other way. `CodexRuntimeOptions` keeps `export interface`. `Subscriber` stays module-private.

## Checks

- **Circular import:** none. grep found no import of `./codex-runtime` in codex-context.ts. The dependency is one way: codex-runtime.ts:11 imports codex-context.
- **Re-exports:** codex-runtime.ts:20 `export type { CodexRuntimeOptions } from './codex-context'` is the only re-export. The existing consumers still resolve through it: `index.ts:51`, `di/registration.ts:12` and `codex-runtime.spec.ts:14`.
- **Barrel:** the `index.ts` diff adds only `codex-ptah-mcp` exports (`CODEX_PTAH_TOOL_TIMEOUT_SEC`, `ptahMcpSessionUrl`). Those belong to 8p-5, not this batch. There is no export of `RuntimeContext`, `Subscriber` or codex-context from the barrel.
- **Residual imports in codex-runtime.ts:** every remaining import is used (`redactCodexDiagnostics:114`, `CodexHomeMismatchError:127`, `CodexProcessFailureError` and `CodexRequestRejectedError:95-96`, `CodexProtocolError:97`, `buildCodexMcpConfigOverrides:70`, `CodexResumeProfileChangedError:54`, `CodexPermissionRuleStore:26`, `RuntimeContext:24,77`).
- **Value/type import split:** codex-context.ts imports `CodexPermissionRuleStore` as `import type`. That is fine because it is used only as a type in the constructor. The value import stays in codex-runtime.ts:9.

## New spec

`codex-runtime.spec.ts:1676-1716`:
- It opens with systemPrompt, developerPrompt and outputStyle set to the "Original ..." values.
- It closes, then reopens with `...profile` plus new "Current ..." values for all three fields and the same `identity`. The policy stays equal because `...profile` carries the same `profileFingerprint`.
- It asserts that `resumed.identity.threadId` equals the original, so the resume succeeds.
- It asserts that the `thread/resume` frame contains `baseInstructions: 'Current base'` and `developerInstructions: 'Current developer\n\nCurrent style'`.
- The expected join matches the builder at codex-context.ts:199-214 (developerPrompt, then outputStyle). The `children[1]` indexing follows the neighbouring spec.
- It would fail if the resume path reused the stored prompts or rejected a prompt-only change.

## Findings (all minor)

1. **Byte-order mark added.** `codex-runtime.ts` and `codex-context.ts` both start with a UTF-8 BOM (bytes 239,187,191). HEAD has none, and the diff shows `+﻿import` on line 1 of codex-runtime.ts.
   - Fix: strip the BOM from both files.
2. **Mixed line endings.** `codex-runtime.ts` is CRLF (git warns that CRLF will be replaced by LF), while `codex-context.ts` is LF. Only the diff and Prettier/`.gitattributes` normalisation save this.
   - Fix: convert to LF.
3. **Spec does not recompute the fingerprint.** The spec at `codex-runtime.spec.ts:1676` relies on the fixture's static `profileFingerprint`. It proves the runtime ignores prompts at the `open()` comparison (codex-runtime.ts:53). It does not prove that the real fingerprint builder (the D23 commit f3bdd974d) excludes prompts. That belongs to a fingerprint-builder test, which exists elsewhere. This is not a defect in this batch.

## Verdict

APPROVED. The move is behaviour-preserving, the dependency direction is clean, and the public surface is unchanged. M1 from 8p-3 (the changed-prompt resume gap) is now covered by a real spec. Clear findings 1 and 2 (BOM and line endings) before commit.
